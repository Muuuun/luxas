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
} from "@mariozechner/pi-ai";

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

// ── Install provider-level tracking ─────────────────

let installed = false;

export function installUsageTracking(logPath: string): void {
  if (installed) return;
  installed = true;

  mkdirSync(dirname(logPath), { recursive: true });

  // Seed cache from existing file (crash recovery / session resume)
  readUsageTotals(logPath);

  function wrapStreamFn(originalFn: Function, api: string) {
    return (model: any, context: any, options: any) => {
      const eventStream = originalFn(model, context, options);
      eventStream.result().then((msg: any) => {
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
        }
      }).catch(() => {});
      return eventStream;
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
