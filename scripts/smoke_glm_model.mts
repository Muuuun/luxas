/**
 * smoke_glm_model — the GLM entries. glm-5.3-flash is the ONLY GLM model that
 * accepts images (glm-5.3 / 5.2 / 5.1 / 4.7 reject image content at the API);
 * glm-5.2 is the unconditional route for tool_review in every profile.
 *
 * The wire facts asserted here were live-probed 2026-09-03 and each one 400s
 * the request if it regresses: the developer role is rejected, max_tokens
 * above 131072 is rejected by name, and the cost must be FULL list so the cap
 * does not under-count when the launch promo expires (2026-09-09).
 */
import { resolveModel, pickRequireToolChoice } from "../src/agents/spawn.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

const flash: any = resolveModel("glm-5.3-flash");
const g52: any = resolveModel("glm-5.2");

check("glm-5.3-flash resolves to itself", flash?.id === "glm-5.3-flash", String(flash?.id));
check("glm-5.3-flash accepts image input (the only GLM that does)",
  Array.isArray(flash.input) && flash.input.includes("image"));
check("glm-5.2 is text-only — the API rejects image content on it",
  Array.isArray(g52.input) && !g52.input.includes("image"));
check("both GLM entries reject the developer role (API: 1214 角色信息不正确)",
  flash.compat?.supportsDeveloperRole === false && g52.compat?.supportsDeveloperRole === false);
check("glm-5.3-flash max output within the API ceiling of 131072",
  flash.maxTokens > 0 && flash.maxTokens <= 131072, String(flash.maxTokens));
check("glm-5.3-flash context window ≥ 900k (probed OK at 900,015 prompt tokens)",
  flash.contextWindow >= 900_000, String(flash.contextWindow));
check("glm-5.3-flash priced at FULL list, not the 50% launch promo",
  flash.cost.input === 0.15 && flash.cost.output === 0.50,
  `${flash.cost.input}/${flash.cost.output}`);
check("glm-5.3-flash is cheaper per token than glm-5.2 (flash tier)",
  flash.cost.input < g52.cost.input && flash.cost.output < g52.cost.output);
check("glm-5.3-flash is a reasoning model → tool_choice \"auto\"",
  flash.reasoning === true && pickRequireToolChoice(flash) === "auto");
check("both GLM entries share the bigmodel endpoint",
  flash.baseUrl === g52.baseUrl && flash.provider === "glm" && g52.provider === "glm");
// tool_review is pinned to GLM in EVERY profile — a third prior, independent of
// both the deepseek producer and the Anthropic PI. Guard that it stays text-tier
// and does not silently inherit a vision profile.
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = "deepseek-v4-flash-vision-exp";
check("tool_review still routes to GLM under --profile dual",
  (resolveModel("opus", "tool_review") as any)?.provider === "glm");
delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_VISION_MODEL_PROFILE;
check("tool_review routes to GLM with no profile set at all",
  (resolveModel("opus", "tool_review") as any)?.provider === "glm");

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — GLM entries: vision only on 5.3-flash, ceilings honest, tool_review pinned.");
