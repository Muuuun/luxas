/**
 * smoke_deepseek_model — the dual profile's DeepSeek entries request thinking
 * mode explicitly, map reasoning_effort to the levels DeepSeek defines, and
 * carry documented peak prices (cost cap must not under-count).
 */
import { resolveModel } from "../src/agents/spawn.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
for (const key of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
  const m: any = resolveModel(key);
  check(`${key}: resolves to itself`, m?.id === key, String(m?.id));
  check(`${key}: reasoning model with deepseek thinking format`, m.reasoning === true && m.compat?.thinkingFormat === "deepseek");
  check(`${key}: echoes reasoning_content on assistant turns`, m.compat?.requiresReasoningContentOnAssistantMessages === true);
  check(`${key}: no developer role / store (DeepSeek rejects both)`, m.compat?.supportsDeveloperRole === false && m.compat?.supportsStore === false);
  check(`${key}: reasoning_effort only for high/max`, m.thinkingLevelMap?.high === "high" && m.thinkingLevelMap?.max === "max" && m.thinkingLevelMap?.medium === null);
  check(`${key}: 1M context, ≥384K output`, m.contextWindow >= 1_000_000 && m.maxTokens >= 384_000);
}
const pro: any = resolveModel("deepseek-v4-pro"), flash: any = resolveModel("deepseek-v4-flash");
check("pro priced at documented peak ($1.32 / $3.96 per M)", pro.cost.input === 1.32 && pro.cost.output === 3.96);
check("flash priced at documented peak ($0.44 / $1.32 per M)", flash.cost.input === 0.44 && flash.cost.output === 1.32);
check("pro is the more capable (pricier) tier", pro.cost.output > flash.cost.output);
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — DeepSeek V4 entries: thinking on, effort mapped, peak-priced.");
