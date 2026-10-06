/**
 * Regression guard for the opus-5 refusal incident (2026-09-04).
 * claude-opus-5 refuses ordinary physics-review prompts with
 * stop_reason "refusal" / category "cyber" and zero output. That tier feeds
 * reviewer / experiment_reviewer / ledger_writer, and Luxas has no refusal
 * handling, so the verification layer would silently produce nothing.
 * Offline: asserts the pin, not the API.
 */
import { resolveModel, pickRequireToolChoice } from "../src/agents/spawn.ts";
let fails = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "✓" : "✗ FAIL"} ${n}${ok || !d ? "" : ` — ${d}`}`); if (!ok) fails++; };

const opus: any = resolveModel("opus");
const sonnet: any = resolveModel("sonnet");
check("opus tier is NOT claude-opus-5 (it refuses physics review, cat=cyber)",
  (opus?.id ?? opus?.model?.id) !== "claude-opus-5", String(opus?.id ?? opus?.model?.id));
check("opus tier is the flagship Opus (5.5; probed for review refusals 2026-10-06, none in 6 calls + 2 audits)",
  (opus?.id ?? opus?.model?.id) === "claude-opus-5-5", String(opus?.id ?? opus?.model?.id));
// 5.5 400s on forced tool choice; a tuple-form pin would lose the flag and
// every reviewer turn would be a hard 400.
check("…and it gets tool_choice \"auto\" (5.5 rejects forced choice)", pickRequireToolChoice(opus) === "auto", pickRequireToolChoice(opus));
check("the previous pin stays resolvable as the rollback",
  ((resolveModel("opus-4-6") as any)?.id) === "claude-opus-4-6");
check("sonnet tier is claude-sonnet-5 (verified end_turn on the same prompt)",
  (sonnet?.id ?? sonnet?.model?.id) === "claude-sonnet-5", String(sonnet?.id ?? sonnet?.model?.id));
// Claude Fable/Mythos 5.1 400 on forced tool choice, which Luxas sends every
// turn as its silent-exit guard. Without the "auto" branch every turn is a hard
// 400, so this is what makes the model runnable at all (verified live with a
// full tool_review spawn: 34 turns, clean stop, wrote its test file).
const fable: any = resolveModel("claude-fable-5-1");
check("claude-fable-5-1 is a real entry, not a hollow pi-ai lookup",
  fable?.id === "claude-fable-5-1", String(fable?.id));
check("fable gets tool_choice \"auto\" (it 400s on forced choice)",
  pickRequireToolChoice(fable) === "auto", pickRequireToolChoice(fable));
check("the tiers that accept it keep forced tool choice",
  pickRequireToolChoice(resolveModel("opus-4-6")) === "any" &&
  pickRequireToolChoice(resolveModel("sonnet")) === "any");
// Safety net for tuple-form models, which carry no inline capability flag.
check("an id-only fable/mythos model still gets \"auto\"",
  pickRequireToolChoice({ id: "claude-mythos-5-1", provider: "anthropic" }) === "auto");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — the verification tier is pinned to a model that does not refuse its own job.");
