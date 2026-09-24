/**
 * smoke_model_bench — the model bench measures what it says it measures.
 *
 * 1. exactModel really bypasses routing: tool_review is pinned to GLM by
 *    applyProfile, and a bench cell that silently ran GLM while labelled
 *    "claude-sonnet-5" would be worse than no cell.
 * 2. Unknown ids throw instead of falling back to sonnet.
 * 3. Every tool_review fixture is sound: the reference passes its gold test
 *    and every mutant is killable (an equivalent mutant caps every
 *    contestant below 1.0 for a fixture bug).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveModel, resolveModelExact } from "../src/agents/spawn.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

const routed: any = resolveModel("sonnet", "tool_review");
const exact: any = resolveModelExact("anthropic/claude-sonnet-5");
check("routing pins tool_review away from its declared tier (the thing exactModel must bypass)", routed?.provider !== "anthropic", `${routed?.provider}/${routed?.id}`);
check("resolveModelExact(provider/id) returns exactly that model", exact?.provider === "anthropic" && exact?.id === "claude-sonnet-5", `${exact?.provider}/${exact?.id}`);
check("resolveModelExact(MODEL_MAP key) returns the entry, no profile applied", (resolveModelExact("glm-5.3") as any)?.id === "glm-5.3");
let threw = false;
try { resolveModelExact("no-such-model-xyz"); } catch { threw = true; }
check("unknown model id throws (no silent sonnet fallback)", threw);
const spawnSrc = (await import("node:fs")).readFileSync("src/agents/spawn.ts", "utf-8");
check("buildAgentFromDefinition honours opts.exactModel before routing", /opts\.exactModel \? resolveModelExact\(opts\.exactModel\)/.test(spawnSrc));

const root = join("fixtures", "model-bench", "tool_review");
for (const t of readdirSync(root)) {
  const r = spawnSync("python3", [join(root, t, "gold_test.py")], { encoding: "utf-8" });
  check(`tool_review/${t}: reference passes, every mutant killable`, r.status === 0, r.stdout.split("\n").filter((l) => /FAIL|EQUIVALENT/.test(l)).join("; "));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — bench cells run the model they are labelled with, on sound fixtures.");
