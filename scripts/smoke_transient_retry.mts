#!/usr/bin/env tsx
/**
 * Smoke: transient error retry in usage-log adapter wrap.
 *
 * Sessions 5 and 7 both ended on a single network-layer transient
 * (`Connection error.`, `Request timed out.`) — pi-ai's stream rejection
 * propagated to the agent loop with no retry. This smoke verifies the
 * retry logic in src/usage-log.ts:
 *   - isTransientError matches all observed network-error phrases
 *   - withTransientRetry retries up to N delays on transient errors
 *   - Non-transient errors propagate immediately (no waste)
 *   - Retry exhaustion throws the last transient error
 *   - Successful retry returns the success value
 */
import { isTransientError, withTransientRetry } from "../src/usage-log.js";

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// ── isTransientError pattern recognition ─────────────────────────────
{
  console.log(`\n[isTransientError patterns]`);
  // Patterns observed in production sessions 5 and 7:
  assert(isTransientError(new Error("Connection error.")), "Connection error matched");
  assert(isTransientError(new Error("Request timed out.")), "Request timed out matched");
  // Network-stack idioms surfaced by undici/fetch/Node:
  assert(isTransientError(new Error("ECONNRESET")), "ECONNRESET matched");
  assert(isTransientError(new Error("ETIMEDOUT")), "ETIMEDOUT matched");
  assert(isTransientError(new Error("ECONNREFUSED")), "ECONNREFUSED matched");
  assert(isTransientError(new Error("socket hang up")), "socket hang up matched");
  assert(isTransientError(new Error("fetch failed")), "fetch failed matched");
  assert(isTransientError(new Error("network error")), "network error matched");
  // Provider 5xx (Anthropic 529 = overloaded; also generic 503/504)
  assert(isTransientError(new Error("HTTP 503 Service Unavailable")), "HTTP 503 matched");
  assert(isTransientError(new Error("status 504")), "status 504 matched");
  assert(isTransientError(new Error("Anthropic overloaded (529)")), "529 matched");

  // Non-transient — must NOT retry
  assert(!isTransientError(new Error("invalid_request_error: prompt is too long")), "context-length not transient");
  assert(!isTransientError(new Error("authentication_error: invalid API key")), "auth error not transient");
  assert(!isTransientError(new Error("permission_denied")), "permission denied not transient");
  assert(!isTransientError(new Error("rate_limit_error: 1000 RPM exceeded for ...")), "rate limit not transient");
  assert(!isTransientError(new Error("Tool execution failed")), "tool failure not transient");
  assert(!isTransientError(new Error("malformed JSON")), "malformed not transient");
  // Edge cases
  assert(!isTransientError(undefined), "undefined err not transient");
  assert(!isTransientError(null), "null err not transient");
  assert(!isTransientError("plain string"), "plain string not transient");
}

// ── withTransientRetry: success on first attempt ──────────────────────
{
  console.log(`\n[success on first attempt]`);
  let calls = 0;
  const result = await withTransientRetry(
    async () => { calls++; return "ok"; },
    [1, 1, 1],
    () => {},
  );
  assert(result === "ok", "result returned");
  assert(calls === 1, "called exactly once (no retry on success)");
}

// ── withTransientRetry: success after one transient failure ───────────
{
  console.log(`\n[recovery after one transient failure]`);
  let calls = 0;
  const logs: string[] = [];
  const result = await withTransientRetry(
    async () => {
      calls++;
      if (calls === 1) throw new Error("Connection error.");
      return "recovered";
    },
    [5, 5, 5],
    (m) => logs.push(m),
  );
  assert(result === "recovered", "got recovered value");
  assert(calls === 2, "called twice (1 fail + 1 retry)");
  assert(logs.length === 1 && logs[0].includes("transient-retry"), "logged 1 retry");
}

// ── withTransientRetry: success after two transient failures ──────────
{
  console.log(`\n[recovery after two transient failures]`);
  let calls = 0;
  const result = await withTransientRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("Request timed out.");
      return "third-time-lucky";
    },
    [5, 5, 5],
    () => {},
  );
  assert(result === "third-time-lucky", "got success on attempt 3");
  assert(calls === 3, "called 3 times");
}

// ── withTransientRetry: exhausts retries on persistent transient ──────
{
  console.log(`\n[retry exhaustion on persistent transient]`);
  let calls = 0;
  let thrown: any = null;
  try {
    await withTransientRetry(
      async () => { calls++; throw new Error("ECONNRESET"); },
      [5, 5, 5],
      () => {},
    );
  } catch (e) { thrown = e; }
  assert(thrown !== null, "threw after exhausting retries");
  assert(String((thrown as any)?.message).includes("ECONNRESET"), "threw the original error");
  assert(calls === 4, "called 4 times (initial + 3 retries)");
}

// ── withTransientRetry: non-transient error throws immediately ────────
{
  console.log(`\n[non-transient error skips retry]`);
  let calls = 0;
  let thrown: any = null;
  const start = Date.now();
  try {
    await withTransientRetry(
      async () => { calls++; throw new Error("invalid_request_error: prompt is too long"); },
      [10_000, 30_000, 60_000], // would block ~100s if we retried
      () => {},
    );
  } catch (e) { thrown = e; }
  const elapsed = Date.now() - start;
  assert(thrown !== null, "threw");
  assert(calls === 1, "called only once (no retry on non-transient)");
  assert(elapsed < 500, `returned fast (${elapsed}ms < 500ms — confirms no sleep)`);
}

// ── withTransientRetry: mixed errors (transient then non-transient) ───
{
  console.log(`\n[transient then non-transient — stops on non-transient]`);
  let calls = 0;
  let thrown: any = null;
  try {
    await withTransientRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("Connection error.");
        throw new Error("authentication_error");
      },
      [5, 5, 5],
      () => {},
    );
  } catch (e) { thrown = e; }
  assert(thrown !== null, "threw");
  assert(String((thrown as any)?.message).includes("authentication"), "threw non-transient (not first transient)");
  assert(calls === 2, "called 2 times: 1 transient retry, 1 non-transient terminal");
}

if (failures === 0) {
  console.log(`\nPASS — transient retry layer protects against single network blips`);
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
