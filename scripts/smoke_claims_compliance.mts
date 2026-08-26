/**
 * smoke_claims_compliance — the compliance reader (design §7.4 live-probe consumer)
 * distinguishes a retrofitted project from a legacy one and flags sub-80% fields.
 */
import { measureCompliance, renderCompliance } from "./claims_compliance.mts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

const retro = measureCompliance("fixtures/claims-297nm/retrofit");
const raw = measureCompliance("fixtures/claims-297nm/raw");
const field = (r: typeof retro, f: string) => r.fields.find((x) => x.field.startsWith(f));

check("raw legacy project declares no quantities", raw.quantities === 0 && raw.runsDeclaringQuantities === 0, JSON.stringify({ q: raw.quantities }));
check("raw: per-quantity fields report n/a, not 0%", raw.fields.filter((f) => f.field.startsWith("id")).every((f) => f.rate === null));
check("retrofit declares quantities on ≥5 runs", retro.runsDeclaringQuantities >= 5, String(retro.runsDeclaringQuantities));
check("retrofit: id and key 100% (valid)", field(retro, "id")!.rate === 1 && field(retro, "key")!.valid === field(retro, "key")!.total);
check("retrofit: observable 100%", field(retro, "observable")!.rate === 1);
check("retrofit: frame.md headline parsed", retro.brain.frameHeadline.includes("n_at_297nm"), retro.brain.frameHeadline.join(","));
check("retrofit: headline:true ids collected", retro.brain.headlineTrue.includes("fidelity_40MHz"));
check("retrofit: sparse fields land in below80 (limit_check, replaces)", retro.below80.some((f) => f.startsWith("limit_check")) && retro.below80.some((f) => f.startsWith("verdicts[].replaces")));
check("reviewer scope = declared headline set (E5 leakage excluded)", !retro.reviewer.headlineIdsInScope.includes("blockade_leakage_40MHz") && retro.reviewer.headlineIdsInScope.length === 4, retro.reviewer.headlineIdsInScope.join(","));
check("review file with DISCRIMINATOR counted", retro.reviewer.perLine.find((f) => f.field.startsWith("review files"))!.filled === 1);
const text = renderCompliance(retro);
check("render marks sub-80% rows", /◀ <80%/.test(text) && /below 80%/.test(text));
check("uncertainty validity ≤ presence", field(retro, "uncertainty (present)")!.valid! <= field(retro, "uncertainty (present)")!.filled);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — compliance reader separates retrofit from legacy and flags demotion candidates.");
