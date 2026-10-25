/**
 * Usage Log — append-only file for tracking all API token consumption.
 *
 * Every API call (agent loop, completeSimple, compaction, any path) is captured
 * at the provider level and appended as one line. Multiple processes can safely
 * append concurrently (POSIX atomic for writes < PIPE_BUF = 4096 bytes).
 *
 * This is the SINGLE SOURCE OF TRUTH for cost tracking.
 */

import { UNFUNDED_RE } from "./failure-taxonomy.js";
import { setExitReason } from "./exit-state.js";
import { jobOwnerAls } from "./jobs/als.js";
import { appendFileSync, readFileSync, mkdirSync, statSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** Fields 9–10 of a row: who paid. Outside every agent's scope (preflight, autofix probes) it is never guessed as "brain" — the brain runs in its own scope. */
const UNATTRIBUTED = "unattributed";
const attributionField = (s: string | undefined) => (s || UNATTRIBUTED).replace(/[\t\r\n]/g, "_").slice(0, 200);

export function appendUsage(logPath: string, entry: UsageEntry): void {
  // The brain, its sub-agents, detached runners and review_experiment all
  // append to one ledger; without the payer on each row, one writer's spend
  // cannot be told from another's (review_experiment could only print
  // "project spend since start (includes any concurrent writer)").
  // Readers stay positional on fields 0–7, so older rows and readers both work.
  const owner = jobOwnerAls.getStore();
  const line = [
    entry.timestamp,
    entry.model,
    entry.provider,
    entry.input,
    entry.output,
    entry.cacheRead,
    entry.cacheWrite,
    entry.cost.toFixed(8),
    attributionField(owner?.agentId),
    attributionField(owner?.agentType),
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
  // Bytes, as fileSize() measures: an id with a non-ASCII byte would otherwise force a re-parse every read.
  cache.set(logPath, { totals, size: (cached?.size ?? 0) + Buffer.byteLength(line) });
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

/** Bucket for rows written before fields 9–10 existed. */
export const PRE_ATTRIBUTION = "(pre-attribution)";

/**
 * Cost and calls per agent type (field 10). `since` keeps rows whose timestamp
 * is at or after it; `idPrefix` keeps rows whose agent id (field 9) starts with
 * it — a spawn tree, e.g. "review_experiment.<EID>.". The id itself is never
 * parsed: background ids look like "<parent>.<agent>-bg-<n>". Rows without
 * fields 9–10 count under PRE_ATTRIBUTION, and never match an idPrefix.
 */
export function readUsageByAgent(logPath: string, opts: { since?: number; idPrefix?: string } = {}): Map<string, { cost: number; calls: number }> {
  const out = new Map<string, { cost: number; calls: number }>();
  let content = "";
  try { content = readFileSync(logPath, "utf-8"); } catch { return out; }
  for (const line of content.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 8) continue;
    if (opts.since !== undefined && !(Number(parts[0]) >= opts.since)) continue;
    const attributed = parts.length >= 10;
    if (opts.idPrefix !== undefined && !(attributed && parts[8].startsWith(opts.idPrefix))) continue;
    const key = attributed ? parts[9] : PRE_ATTRIBUTION;
    const acc = out.get(key) ?? { cost: 0, calls: 0 };
    acc.cost += parseFloat(parts[7]) || 0;
    acc.calls++;
    out.set(key, acc);
  }
  return out;
}

// ── Transient errors are not retried here ───────────
//
// Sessions 5 and 7 both died on a single network blip (`Connection error.`,
// `Request timed out.`). The retry for that has one owner, the patched agent
// loop (patches/pi-agent-core-no-tool-retry-guard.sh, Patch C/E). pi-ai
// delivers a provider failure as an error event and a RESOLVED
// stopReason="error" message — EventStream.result() never rejects — so a
// catch around result() in this wrapper never ran on a real failure. The loop
// learns which errors are transient from failure-taxonomy.ts, which the import
// above loads and publishes.

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

/** The cap this process enforces for this log, if one is registered (the Claude Code executor reads it instead of run_config.json, which an executor can edit). */
export function costCapFor(logPath: string): number | undefined {
  return costCaps.get(logPath);
}

/** Fraction of --max-cost at which the brain is told to wrap up (fix 4, 2026-09-01). */
export const SOFT_CAP_FRACTION = 0.9;

/**
 * Has spend reached `fraction` of the cap this process enforces for this log?
 * The brain's hook freezes new work at that line, but only between the brain's
 * own tool calls; spawns the harness makes itself (runExperimentReviewLoop's
 * revision and not-delivered re-runs) ask this instead. It is the cap that
 * actually kills the process — the brain's --max-cost ?? 250, the runner's
 * run_config ?? 250 — so false when none is registered.
 */
export function softCapReached(logPath: string, fraction: number): boolean {
  const cap = costCaps.get(logPath);
  return cap !== undefined && readUsageTotals(logPath).cost >= cap * fraction;
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
    setExitReason("budget_exhausted", `cost $${totals.cost.toFixed(2)} exceeded the $${cap} cap`);
    exit(1);
    return true;
  }
  return false;
}

/**
 * A provider refusing for lack of funds is not a transient error and not a
 * model failure: every later turn on that provider fails the same way while
 * the OTHER providers keep spending (2026-08-28: Anthropic-pinned reviewers
 * went unfunded at ~13:00; DeepSeek producers spent ~$20 more on work nobody
 * could review, and the PI's no-response placeholders fed a finish deadlock).
 */
//
// GLM reports an empty balance as HTTP **429** code 1113 "余额不足或无可用资源包"
// — not a rate limit. The old pattern missed it: 71 of ba-qc's provider
// errors were exactly this, 35/35 tool_review spawns died on turn 1, nine
// experiments shipped with zero test files and the run spent two more days
// disclosing the gap (notes/backtest-2026-09-24/bt-baqc.md). A true GLM rate
// limit is code 1302 "速率限制" and is retried in the agent loop instead
// (patches/pi-agent-core-no-tool-retry-guard.sh, Patch C).
export const UNFUNDED_PROVIDER_RE = UNFUNDED_RE;
export function isUnfundedProviderError(text: unknown): boolean {
  return typeof text === "string" && UNFUNDED_PROVIDER_RE.test(text);
}

// ── Run-wide unfunded stop ──────────────────────────
//
// process.exit only stops the process that saw the error. Background
// experiments are detached subagent-runner processes, so an unfunded
// provider inside one of them killed that runner and nothing else: the brain
// and every sibling kept spending on work the dead provider could no longer
// test or review. The sentinel makes the stop run-wide — every process that
// shares this usage.log refuses its next model call. `luxas run` archives
// the sentinel on start, so a resume after topping up is not stopped by it.
export const UNFUNDED_SENTINEL = "unfunded.json";

export function unfundedSentinelPath(logPath: string): string {
  return join(dirname(logPath), UNFUNDED_SENTINEL);
}

export function writeUnfundedSentinel(logPath: string, provider: string, message: string): void {
  try {
    writeFileSync(unfundedSentinelPath(logPath), JSON.stringify({ provider, message: message.slice(0, 500), pid: process.pid, at: new Date().toISOString() }, null, 2) + "\n");
  } catch { /* the local exit still happens */ }
}

/** Exit if another process of this run hit an unfunded provider. `exit` is injectable for the gate. */
export function enforceUnfundedSentinel(logPath: string, exit: (code: number) => void = (c) => process.exit(c)): boolean {
  if (process.env.LUXAS_UNFUNDED_EXIT === "0") return false;
  const p = unfundedSentinelPath(logPath);
  if (!existsSync(p)) return false;
  let why = "";
  try { const j = JSON.parse(readFileSync(p, "utf-8")); why = `${j.provider}: ${String(j.message).slice(0, 160)}`; } catch { /* torn write — still stop */ }
  console.error(`\n[FATAL] Run stopped: a provider refused for lack of funds (${why}; ${p}). Top up, then \`luxas run\` resumes (checkpoint is live).\n`);
  setExitReason("provider_unfunded", why);
  exit(1);
  return true;
}

/** Called by `luxas run` on start: an operator resuming has (presumably) topped up. Kept, not deleted. */
export function archiveUnfundedSentinel(agentDir: string): string | null {
  const p = join(agentDir, UNFUNDED_SENTINEL);
  if (!existsSync(p)) return null;
  const dest = join(agentDir, `unfunded.${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  try { renameSync(p, dest); return dest; } catch { return null; }
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
      // Before paying for this call: has another process of the run already
      // found a provider unfunded?
      enforceUnfundedSentinel(logPath);
      const stream: any = originalFn(model, context, options);

      // Record the call once it settles. A failed call is a resolved
      // stopReason="error" message like any other (see the note above): billed
      // here, re-streamed or not by the loop.
      const finalResult = (async () => {
        const msg = await stream.result();
        if (msg?.stopReason === "error" && isUnfundedProviderError(msg?.errorMessage) && process.env.LUXAS_UNFUNDED_EXIT !== "0") {
          writeUnfundedSentinel(logPath, String(model?.provider ?? api), String(msg.errorMessage));
          console.error(`\n[FATAL] Provider ${model?.provider ?? api} refuses for lack of funds: ${String(msg.errorMessage).slice(0, 160)}. ` +
            `Stopping the run so the other providers do not keep spending on work this one cannot review. Top up, then resume (checkpoint is live).\n`);
          setExitReason("provider_unfunded", `${model?.provider ?? api}: ${String(msg.errorMessage).slice(0, 160)}`);
          process.exit(1);
        }
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
      })();

      // The stream itself, with `.result` redirected to the promise above: a
      // consumer that reads the final message sees it only after it has been
      // billed and the unfunded and cost-cap checks have run.
      return new Proxy(stream, {
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
