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

// ── Luxas definition vs bare prompt (2026-10-05) ─────────────────────────────
// The pairing decides whether a definition earns its keep, so it is pinned on
// hand-made rows whose answer is known.
const { pairArms, signTestP, renderReport, itemsOf, BARE_PROMPT, latestPerSandbox } = await import("./model_bench.mts");
const row = (arm: string, items: Record<string, number>, extra: any = {}) => {
  const v = Object.values(items);
  return { role: "auditor", task: "t", model: "m", arm, score: v.reduce((a, b) => a + b, 0) / v.length, items, usage: { cost: arm === "bare" ? 1 : 2 }, ...extra };
};
{
  const rows = [
    row("luxas", { D1: 1, D2: 1, D3: 0, D4: 1 }), row("luxas", { D1: 1, D2: 0, D3: 0, D4: 1 }),
    row("bare", { D1: 1, D2: 0, D3: 0, D4: 0 }), row("bare", { D1: 1, D2: 0, D3: 1, D4: 0 }),
    { role: "auditor", task: "t", model: "m", arm: "bare", score: null, stopReason: "unfunded", usage: { cost: 0 } },
    row("luxas", { D1: 1 }, { model: "only-one-arm" }),
  ];
  const cells = pairArms(rows);
  check("pairs only role/task/model cells that have both arms", cells.length === 1, JSON.stringify(cells.map((c: any) => c.key)));
  const c = cells[0];
  check("means per arm", Math.abs(c.luxas - 0.625) < 1e-9 && Math.abs(c.bare - 0.375) < 1e-9, `${c.luxas} / ${c.bare}`);
  check("unscored rows (unfunded, cost cap) are not counted as zeros", c.nBare === 2);
  check("items paired on mean credit: D2,D4 better, D3 worse, D1 same", c.better === 2 && c.worse === 1 && c.same === 1, `${c.better}/${c.worse}/${c.same}`);
  check("cost per arm is reported next to the score", c.costLuxas === 2 && c.costBare === 1);
  const text = renderReport(rows);
  check("the report warns when a cell has fewer than 3 runs per arm", /fewer than 3 runs per arm/.test(text));
  check("the report says the p-value is optimistic", /optimistic/.test(text));
}
check("sign test: 0 vs 0 is p = 1", signTestP(0, 0) === 1);
check("sign test: 5 vs 0 is p = 0.0625", Math.abs(signTestP(5, 0) - 0.0625) < 1e-12);
check("sign test: 8 vs 1 is p ≈ 0.039", Math.abs(signTestP(8, 1) - 20 / 512) < 1e-12, String(signTestP(8, 1)));
check("sign test is symmetric", signTestP(1, 8) === signTestP(8, 1));
check("legacy auditor rows pair through per_defect", JSON.stringify(itemsOf({ per_defect: { D1: "FOUND", D2: "PARTIAL", D3: "MISSED" } })) === JSON.stringify({ D1: 1, D2: 0.5, D3: 0 }));
{
  const legacy = itemsOf({ role: "tool_review", task: "kurucz_parse", passes_reference: true, survived: ["lambda_in_nm"] })!;
  check("legacy tool_review rows are rebuilt from the fixture's mutant list", !!legacy && Object.keys(legacy).length === 12 && legacy.lambda_in_nm === 0 && legacy.no_air_to_vac === 1, JSON.stringify(legacy));
}
// The bare arm must state the deliverable and nothing about method — a bare
// prompt that leaked the definition's method would measure nothing.
const benchSrc = (await import("node:fs")).readFileSync("scripts/model_bench.mts", "utf-8");
for (const [role, prompt] of Object.entries(BARE_PROMPT as Record<string, string>)) {
  check(`bare ${role} prompt is short (< 400 chars)`, prompt.length < 400, `${prompt.length}`);
  check(`bare ${role} prompt names no method`, !/independent|cross-check|adversarial|ground truth|estimate|mutant|trap|discriminator|headline/i.test(prompt), prompt);
}
check("bare auditor writes where the scorer reads", /\.audit\/findings\.md/.test((BARE_PROMPT as any).auditor));
check("the bare arm keeps the definition's tools and replaces only the prompt", /arm === "bare" \? \{ systemPromptTemplate: BARE_PROMPT\[role\], contextBuilder: undefined \}/.test(benchSrc));

// A re-scored trial (judge failed, agent work kept) appends a second row for
// the same sandbox. Counting both would turn one run into n=2 with a null.
{
  const rows = [
    { sandbox: "/r/a", role: "auditor", model: "m", arm: "bare", score: null, note: "scoring failed" },
    { sandbox: "/r/b", role: "auditor", model: "m", arm: "luxas", score: 0.4 },
    { sandbox: "/r/a", role: "auditor", model: "m", arm: "bare", score: 0.7, rescored: true },
    { role: "brain", model: "m", score: 0.5 },
  ];
  const kept = (latestPerSandbox as any)(rows);
  check("a re-scored trial replaces its earlier row", kept.length === 3 && kept.filter((r: any) => r.sandbox === "/r/a").length === 1 && kept.find((r: any) => r.sandbox === "/r/a").score === 0.7, JSON.stringify(kept));
  check("rows without a sandbox are kept as they are", kept.some((r: any) => r.role === "brain"));
  check("the report reads rows through it", /latestPerSandbox\(readFileSync\(RESULTS/.test(benchSrc));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — bench cells run the model they are labelled with, on sound fixtures.");
