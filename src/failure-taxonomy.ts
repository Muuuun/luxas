/**
 * Failure taxonomy — the ONE place that decides what kind of provider error a
 * string is.
 *
 * Before this file there were four classifiers that disagreed: TRANSIENT_RE in
 * spawn.ts, isTransientError in usage-log.ts (which knew about 503/504/timeouts),
 * the regexes baked into the patched agent-loop.js (which did not), and
 * UNFUNDED_PROVIDER_RE (whose bare `402` matched any text containing that
 * number). A 5xx was retried by one layer and treated as fatal by the loop that
 * actually owns the turn, so a single gateway blip ended a multi-hour run.
 *
 * Readers:
 *   - usage-log.ts            isTransientError / isUnfundedProviderError
 *   - agents/spawn.ts         TRANSIENT_RE (streamWithRetry, index.ts exit record)
 *   - the patched agent loop  via globalThis.__luxasFailureTaxonomy (Patch E in
 *                             patches/pi-agent-core-no-tool-retry-guard.sh). The
 *                             compiled loop cannot import TypeScript, so it reads
 *                             the same RegExp objects off the global and keeps its
 *                             baked-in copies only as the fallback for a process
 *                             that never loaded this module.
 *   - exit-state.ts           maps a final error onto a typed exit kind
 */

export type FailureClass = "unfunded" | "rate_limit" | "transient" | "fatal";

/** An HTTP status that appears AS a status, not as any number in the text. */
const status = (codes: string) => `(?:^|status(?: code)?[ :=]+|http[ /:]+)\\s*(?:${codes})\\b`;

/**
 * The provider is out of money. Not retryable and not local: the whole run
 * stops (usage-log.ts writes the run-wide sentinel).
 *
 * GLM reports an empty balance as HTTP 429 code 1113 "余额不足或无可用资源包" —
 * not a rate limit (71 of ba-qc's provider errors were exactly this).
 */
export const UNFUNDED_RE = new RegExp(
  "credit balance is too low|insufficient[_ ]balance|insufficient[_ ]quota|exceeded_current_quota|" +
  "billing hard limit|payment required|" + status("402") + "|" +
  "余额不足|无可用资源包|\"code\":\\s*\"1113\"|account\\b[^\"]{0,120}\\bis suspended|no credits remaining",
  "i",
);

/** A real rate limit (GLM code 1302 "速率限制"): retry with minute-scale backoff. */
export const RATE_LIMIT_RE = /rate.?limit|速率限制|too many requests|"code":\s*"1302"|\b429\b/i;

/** Network blips, timeouts and provider 5xx: retry the same turn with backoff. */
export const TRANSIENT_RE = new RegExp(
  "connection.?error|connection.?refused|fetch failed|terminated|other side closed|stream aborted|" +
  "ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|EAI_AGAIN|network error|overloaded|" +
  "request timed out|timed out|timeout|" +
  "internal server error|bad gateway|service unavailable|gateway time-?out|" +
  status("500|502|503|504|520|522|524|529"),
  "i",
);

export function classifyProviderError(text: unknown): FailureClass {
  const s = typeof text === "string" ? text : String((text as any)?.message ?? text ?? "");
  if (!s) return "fatal";
  // Order matters: an unfunded 429 must not be read as a rate limit, and a
  // rate limit must not be read as a generic transient.
  if (UNFUNDED_RE.test(s)) return "unfunded";
  if (RATE_LIMIT_RE.test(s)) return "rate_limit";
  if (TRANSIENT_RE.test(s)) return "transient";
  return "fatal";
}

// Hand the loop the same objects (see header). Assigned at module load: every
// agent process imports agents/spawn.ts, which imports this.
(globalThis as any).__luxasFailureTaxonomy = { transient: TRANSIENT_RE, rateLimit: RATE_LIMIT_RE, unfunded: UNFUNDED_RE };
