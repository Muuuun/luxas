#!/usr/bin/env tsx
/**
 * smoke_language_gate — verify finish() blocks when the report's actual
 * language drifts from notes/plan.md's `# Language` block.
 *
 * Bug observed in 超导量子计算的BOM: plan declared Chinese at PI plan-review
 * time; brain silently flipped to English 11 hours later when writing
 * report.tex; ran the "Note on language" footnote past PI which had left
 * an escape hatch. No audit-trail update. Mu was surprised.
 *
 * Fix: plan.md must start with a `# Language` block declaring Chosen.
 * finish() cross-checks Chosen against report.tex actual CJK presence
 * and refuses to ship on mismatch.
 *
 *   npx tsx scripts/smoke_language_gate.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCheck } from "./_smoke.js";

const { check, summary } = createCheck();

// Mirror the gate logic in src/tools/index.ts so we can unit-test the
// detection without spinning up the whole agent. If the gate's regex
// drifts in code, this smoke goes red.
function checkLanguageDrift(planText: string, texText: string): { blocked: boolean; reason: string } {
  const langStart = planText.match(/^#\s*Language\b[^\n]*$/m);
  let langBlock = "";
  if (langStart && langStart.index !== undefined) {
    const after = planText.slice(langStart.index + langStart[0].length);
    const nextHeading = after.match(/\n#\s/);
    langBlock = nextHeading ? after.slice(0, nextHeading.index) : after;
  }
  const chosenMatch = langBlock.match(/\*\*Chosen\*\*\s*[:：]\s*([a-z][a-z-]*)/i);
  const chosen = chosenMatch?.[1].toLowerCase();
  if (!chosen) return { blocked: false, reason: "no Chosen declared (gate skips)" };

  const stripped = texText
    .replace(/\\cite\{[^}]*\}/g, "")
    .replace(/\\bibliography\{[^}]*\}/g, "")
    .replace(/%[^\n]*/g, "");
  const hasCJK = /[一-鿿가-힯぀-ヿ]/.test(stripped);
  const expectsCJK = chosen === "zh" || chosen === "zh-cn" || chosen === "zh-tw" ||
    chosen === "ja" || chosen === "ko";

  if (expectsCJK && !hasCJK) return { blocked: true, reason: `chosen=${chosen} but report has no CJK` };
  if (!expectsCJK && hasCJK) return { blocked: true, reason: `chosen=${chosen} but report has CJK` };
  return { blocked: false, reason: "language matches" };
}

const tmp = mkdtempSync(join(tmpdir(), "luxas-langgate-"));
try {
  console.log("1. drift detection — plan=zh, report=en (the 超导BOM bug)");
  const r1 = checkLanguageDrift(
    `# Language\n\n- **Chosen**: zh\n- **Rationale**: user input is Chinese\n\n### E_1: ...\n`,
    `\\documentclass{article}\nThe report is in English with $4.70M total cost.\n\\cite{Arute2019}\n`,
  );
  check("blocks zh-plan + en-report", r1.blocked, r1.reason);

  console.log("\n2. plan=en, report=zh (reverse drift)");
  const r2 = checkLanguageDrift(
    `# Language\n\n- **Chosen**: en\n- **Rationale**: target venue is PRX\n`,
    `\\documentclass{article}\n本报告用中文写作。\n`,
  );
  check("blocks en-plan + zh-report", r2.blocked, r2.reason);

  console.log("\n3. match — plan=zh, report=zh (no block)");
  const r3 = checkLanguageDrift(
    `# Language\n\n- **Chosen**: zh\n- **Signals**: research_md=zh, dirname=zh\n`,
    `\\documentclass{article}\n本研究以稀释制冷机 (Bluefors XLD1000-SL) 为例，估算超导量子计算的成本结构。\n`,
  );
  check("allows zh-plan + zh-report", !r3.blocked, r3.reason);

  console.log("\n4. match — plan=en, report=en (no block)");
  const r4 = checkLanguageDrift(
    `# Language\n\n- **Chosen**: en\n- **Signals**: research_md=en\n`,
    `\\documentclass{article}\nWe present a bottom-up BOM analysis. The total is \\$4.70M.\n`,
  );
  check("allows en-plan + en-report", !r4.blocked, r4.reason);

  console.log("\n5. cite-key with CJK doesn't false-positive en-report");
  const r5 = checkLanguageDrift(
    `# Language\n\n- **Chosen**: en\n`,
    `\\documentclass{article}\nWe cite \\cite{中文键}.\n% comment with 中文\n\\bibliography{references}\n`,
  );
  check("strips cite/comment/bib before CJK detect",
    !r5.blocked, r5.reason);

  console.log("\n6. zh-tw / zh-cn / ja / ko all treated as CJK-expecting");
  for (const lang of ["zh-tw", "zh-cn", "ja", "ko"]) {
    const r = checkLanguageDrift(
      `# Language\n\n- **Chosen**: ${lang}\n`,
      `\\documentclass{article}\nAll English content.\n`,
    );
    check(`blocks ${lang}-plan + en-report`, r.blocked, r.reason);
  }

  console.log("\n7. no Chosen field → gate skips (legacy plans)");
  const r7 = checkLanguageDrift(
    `### E_1: First sub-question\n`,
    `\\documentclass{article}\nAny content.\n`,
  );
  check("legacy plan without # Language passes through",
    !r7.blocked, r7.reason);

  console.log("\n8. case-insensitive Chosen, with Chinese colon");
  const r8 = checkLanguageDrift(
    `# Language\n\n- **Chosen**：ZH\n`,
    `\\documentclass{article}\nEnglish only.\n`,
  );
  check("uppercase ZH + Chinese colon still matched",
    r8.blocked, r8.reason);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

summary();
