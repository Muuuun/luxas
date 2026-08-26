/**
 * Usage Log — append-only file for tracking all API token consumption.
 *
 * Every API call (agent loop, completeSimple, compaction, any path) is captured
 * at the provider level and appended as one line. Multiple processes can safely
 * append concurrently (POSIX atomic for writes < PIPE_BUF = 4096 bytes).
 *
 * This is the SINGLE SOURCE OF TRUTH for cost tracking.
 */

import { appendFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  getApiProviders,
  registerApiProvider,
} from "@earendil-works/pi-ai/compat";

// ── Types ───────────────────────────────────────────

export interface UsageEntry {
  timestamp: number;
  model: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface UsageTotals {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

// ── In-memory cache (per-process) ───────────────────

const cache = new Map<string, { totals: UsageTotals; size: number }>();

function zeroed(): UsageTotals {
  return { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 };
}

function fileSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

// ── Append ──────────────────────────────────────────

export function appendUsage(logPath: string, entry: UsageEntry): void {
  const line = [
    entry.timestamp,
    entry.model,
    entry.provider,
    entry.input,
    entry.output,
    entry.cacheRead,
    entry.cacheWrite,
    entry.cost.toFixed(8),
  ].join("\t") + "\n";

  try {
    appendFileSync(logPath, line);
  } catch {
    return; // best-effort — never crash the agent
  }

  // Update in-memory cache
  const cached = cache.get(logPath);
  const totals = cached?.totals ?? zeroed();
  totals.inputTokens += entry.input;
  totals.outputTokens += entry.output;
  totals.cacheReadTokens += entry.cacheRead;
  totals.cacheWriteTokens += entry.cacheWrite;
  totals.cost += entry.cost;
  totals.calls++;
  cache.set(logPath, { totals, size: (cached?.size ?? 0) + line.length });
}

// ── Read totals ─────────────────────────────────────

/**
 * Returns usage totals. Uses in-memory cache when the file hasn't been
 * modified by another process (detected via file size comparison).
 */
export function readUsageTotals(logPath: string): UsageTotals {
  const cached = cache.get(logPath);
  if (cached && fileSize(logPath) === cached.size) {
    return { ...cached.totals };
  }

  // Cold start or external writes detected: re-parse file
  const totals = zeroed();
  let size = 0;
  try {
    const content = readFileSync(logPath, "utf-8");
    size = Buffer.byteLength(content);
    for (const line of content.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 8) continue;
      totals.inputTokens += parseInt(parts[3]) || 0;
      totals.outputTokens += parseInt(parts[4]) || 0;
      totals.cacheReadTokens += parseInt(parts[5]) || 0;
      totals.cacheWriteTokens += parseInt(parts[6]) || 0;
      totals.cost += parseFloat(parts[7]) || 0;
      totals.calls++;
    }
  } catch {
    // File doesn't exist yet — return zeros
  }

  cache.set(logPath, { totals, size });
  return totals;
}

// ── Transient error retry ───────────────────────────
//
// Sessions 5 and 7 both died on a single network-layer transient failure
// (`Connection error.`, `Request timed out.`) — pi-ai surfaces the rejection
// to the agent loop, which has no retry path and exits. We wrap the provider
// stream functions to retry once on recognized transient errors before
// surfacing to the loop. Non-transient errors (e.g. context-length, rate
// limit policy denials, malformed request) propagate unchanged.

const TRANSIENT_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

/**
 * Heuristic: does this error look like a temporary network / provider
 * blip we should retry? Matches phrases pi-ai's adapters surface from
 * fetch / undici / Anthropic SDK on connection drops, timeouts, and
 * provider 5xx. Pattern is intentionally inclusive — false-positive
 * retries cost time but never lose work; false negatives (real error
 * mistakenly retried) cost the wait time but ultimately throw at attempt
 * exhaustion.
 */
export function isTransientError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("connection error") ||
    msg.includes("request timed out") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529") // Anthropic "overloaded"
  );
}

/**
 * Run `attemptFn` with exponential-backoff retry on transient failures.
 * Each attempt receives a fresh call to `attemptFn` — important when the
 * underlying resource (stream, request) is single-use and must be recreated
 * after a failure, not re-awaited.
 *
 * Defaults match the agent-loop case: [10s, 30s, 60s] = up to 4 total
 * attempts, ≤100s aggregate wait. Tests pass tiny delays.
 */
export async function withTransientRetry<T>(
  attemptFn: () => Promise<T>,
  delaysMs: number[] = TRANSIENT_RETRY_DELAYS_MS,
  log: (msg: string) => void = (m) => console.error(m),
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await attemptFn();
    } catch (err: unknown) {
      if (attempt >= delaysMs.length || !isTransientError(err)) throw err;
      const delay = delaysMs[attempt];
      const errMsg = String((err as any)?.message ?? err).slice(0, 120);
      log(`[transient-retry] ${errMsg} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${delaysMs.length})`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ── Install provider-level tracking ─────────────────

let installed = false;

// ── Cost cap at the point of record ──────────────────
//
// The brain's beforeToolCall hook (hooks.ts) also checks the cap, but it only
// runs between the BRAIN's tool calls. While the brain sits inside one
// foreground spawn_agent(experiment) — routinely an hour or more — every
// sub-agent turn is paid without a single check: on 2026-08-26 a
// `--max-cost 5` probe reached $13 with the experiment still running.
// Enforcing here, right after each usage line is appended, covers every
// agent that shares this process; detached background runners read the cap
// from .agent/run_config.json and install it the same way.
const costCaps = new Map<string, number>();

export function setCostCap(logPath: string, maxCostUsd: number | undefined): void {
  if (maxCostUsd !== undefined && Number.isFinite(maxCostUsd)) costCaps.set(logPath, maxCostUsd);
  else costCaps.delete(logPath);
}

/**
 * Kill the process when the recorded total exceeds the cap. `exit` is
 * injectable for the gate; the default is process.exit (non-swallowable —
 * a thrown error would just become one more paid model turn).
 */
export function enforceCostCap(logPath: string, exit: (code: number) => void = (c) => process.exit(c)): boolean {
  const cap = costCaps.get(logPath);
  if (cap === undefined) return false;
  const totals = readUsageTotals(logPath);
  if (totals.cost > cap) {
    console.error(`\n[FATAL] Cost limit exceeded at usage record: $${totals.cost.toFixed(2)} > $${cap}. Killing process.\n`);
    exit(1);
    return true;
  }
  return false;
}

export function installUsageTracking(logPath: string, opts: { maxCostUsd?: number } = {}): void {
  if (opts.maxCostUsd !== undefined) setCostCap(logPath, opts.maxCostUsd);
  if (installed) return;
  installed = true;

  mkdirSync(dirname(logPath), { recursive: true });

  // Seed cache from existing file (crash recovery / session resume)
  readUsageTotals(logPath);

  function wrapStreamFn(originalFn: Function, api: string) {
    return (model: any, context: any, options: any) => {
      // Each attempt creates a fresh stream — retried attempts replace
      // `activeStream` so the eventStream wrapper exposes the latest one.
      let activeStream: any = originalFn(model, context, options);

      // result() promise: retry chain wrapped around the stream's own
      // result(). On transient failure we recreate the stream and retry.
      // Usage logging fires once on the eventually-successful msg.
      const finalResult = (async () => {
        let attempt = 0;
        while (true) {
          try {
            const msg = await activeStream.result();
            if (msg?.usage) {
              appendUsage(logPath, {
                timestamp: Date.now(),
                model: model.id ?? "unknown",
                provider: model.provider ?? api,
                input: msg.usage.input ?? 0,
                output: msg.usage.output ?? 0,
                cacheRead: msg.usage.cacheRead ?? 0,
                cacheWrite: msg.usage.cacheWrite ?? 0,
                cost: msg.usage.cost?.total ?? 0,
              });
              enforceCostCap(logPath);
            }
            return msg;
          } catch (err: unknown) {
            if (attempt >= TRANSIENT_RETRY_DELAYS_MS.length || !isTransientError(err)) throw err;
            const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
            const errMsg = String((err as any)?.message ?? err).slice(0, 120);
            console.error(`[transient-retry] ${api} ${errMsg} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${TRANSIENT_RETRY_DELAYS_MS.length})`);
            await new Promise((r) => setTimeout(r, delay));
            activeStream = originalFn(model, context, options);
            attempt++;
          }
        }
      })();

      // Proxy the first stream but redirect `.result` to the retrying
      // promise. Other props (events iterator, etc.) come from the active
      // stream's first attempt — retries override only result, since that's
      // what consumers actually depend on for state.
      return new Proxy(activeStream, {
        get(target, prop, receiver) {
          if (prop === "result") return () => finalResult;
          return Reflect.get(target, prop, receiver);
        },
      });
    };
  }

  for (const provider of getApiProviders()) {
    registerApiProvider({
      api: provider.api,
      stream: wrapStreamFn(provider.stream, provider.api),
      streamSimple: wrapStreamFn(provider.streamSimple, provider.api),
    }, "usage-tracking");
  }
}
