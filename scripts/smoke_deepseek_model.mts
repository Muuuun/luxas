/**
 * smoke_deepseek_model — the dual profile's DeepSeek entries request thinking
 * mode explicitly, map reasoning_effort to the levels DeepSeek defines, and
 * carry documented peak prices (cost cap must not under-count).
 *
 * Also pins the 2026-09-15 rename: DeepSeek folded `deepseek-v4-flash` and
 * `deepseek-v4-flash-vision-exp` into `deepseek-flash`, and the retired ids
 * are aliases now. The load-bearing assertion is the LAST one — the text
 * producer must stay blind. Live probe that day: handed the same PNG of the
 * digits "74629" to both, `deepseek-flash` read them back in 1.2 s and
 * `deepseek-v4-pro` answered "the image is not available" while still
 * returning HTTP 200 and a well-formed tool_call. If pro ever starts claiming
 * image input, the vision slot silently collapses onto a model that cannot
 * see, which is the Ba-run figure failure all over again.
 */
import { resolveModel } from "../src/agents/spawn.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

// Real ids: resolve to themselves.
for (const key of ["deepseek-v4-pro", "deepseek-flash"]) {
  const m: any = resolveModel(key);
  check(`${key}: resolves to itself`, m?.id === key, String(m?.id));
  check(`${key}: reasoning model with deepseek thinking format`, m.reasoning === true && m.compat?.thinkingFormat === "deepseek");
  check(`${key}: echoes reasoning_content on assistant turns`, m.compat?.requiresReasoningContentOnAssistantMessages === true);
  check(`${key}: no developer role / store (DeepSeek rejects both)`, m.compat?.supportsDeveloperRole === false && m.compat?.supportsStore === false);
  check(`${key}: reasoning_effort only for high/max`, m.thinkingLevelMap?.high === "high" && m.thinkingLevelMap?.max === "max" && m.thinkingLevelMap?.medium === null);
  check(`${key}: 1M context, ≥384K output`, m.contextWindow >= 1_000_000 && m.maxTokens >= 384_000);
}

// Retired ids (2026-09-15): still resolve, but to the LIVE id — never to
// themselves, or the freshness check would be looking at a model that is gone.
for (const retired of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
  const m: any = resolveModel(retired);
  check(`${retired}: aliases onto the live deepseek-flash`, m?.id === "deepseek-flash", String(m?.id));
}

const pro: any = resolveModel("deepseek-v4-pro"), flash: any = resolveModel("deepseek-flash");
check("pro priced at documented peak ($1.32 / $3.96 per M)", pro.cost.input === 1.32 && pro.cost.output === 3.96);
check("flash priced at documented peak ($0.44 / $1.32 per M)", flash.cost.input === 0.44 && flash.cost.output === 1.32);
check("pro is the more capable (pricier) tier", pro.cost.output > flash.cost.output);

// The vision half of --profile dual.
check("flash accepts image input", Array.isArray(flash.input) && flash.input.includes("image"));
check("flash shares the deepseek provider/endpoint (one key for a dual run)",
  flash.provider === "deepseek" && flash.baseUrl === "https://api.deepseek.com/v1");
check("text producer stays blind — pro must never be used as a vision fallback",
  !(pro.input ?? []).includes("image"));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — DeepSeek entries: thinking on, effort mapped, peak-priced, rename aliased.");
