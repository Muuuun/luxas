/**
 * Regression guard for the opus-5 refusal incident (2026-09-04).
 * claude-opus-5 refuses ordinary physics-review prompts with
 * stop_reason "refusal" / category "cyber" and zero output. That tier feeds
 * reviewer / experiment_reviewer / ledger_writer, and Luxas has no refusal
 * handling, so the verification layer would silently produce nothing.
 * Offline: asserts the pin, not the API.
 */
import { resolveModel } from "../src/agents/spawn.ts";
let fails = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "✓" : "✗ FAIL"} ${n}${ok || !d ? "" : ` — ${d}`}`); if (!ok) fails++; };

const opus: any = resolveModel("opus");
const sonnet: any = resolveModel("sonnet");
check("opus tier is NOT claude-opus-5 (it refuses physics review, cat=cyber)",
  (opus?.id ?? opus?.model?.id) !== "claude-opus-5", String(opus?.id ?? opus?.model?.id));
check("opus tier is a model verified to answer the E6 adjudication prompt",
  (opus?.id ?? opus?.model?.id) === "claude-opus-4-6", String(opus?.id ?? opus?.model?.id));
check("sonnet tier is claude-sonnet-5 (verified end_turn on the same prompt)",
  (sonnet?.id ?? sonnet?.model?.id) === "claude-sonnet-5", String(sonnet?.id ?? sonnet?.model?.id));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the verification tier is pinned to a model that does not refuse its own job.");
