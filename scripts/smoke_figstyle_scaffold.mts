#!/usr/bin/env tsx
/**
 * smoke_figstyle_scaffold — verify init_report deploys a default
 * report/figstyle.mplstyle with cross-platform CJK + pdf.fonttype = 42.
 *
 * Bug A from the BOM investigation: tool_impl wrote a plot script with a
 * hardcoded Linux font path (/usr/share/fonts/truetype/wqy/wqy-microhei.ttc)
 * because it had no project-default style file to inherit from. Fix:
 * init_report scaffolds report/figstyle.mplstyle from the new
 * skills/venue-specific/figstyles/general.mplstyle so plot scripts can do
 * `plt.style.use('report/figstyle.mplstyle')` and inherit the CJK
 * fallback chain + TrueType fonts automatically.
 *
 *   npx tsx scripts/smoke_figstyle_scaffold.mts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitReportTool } from "../src/tools/init-report.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const tmp = mkdtempSync(join(tmpdir(), "luxas-figstyle-"));
try {
  console.log("1. init_report deploys report/figstyle.mplstyle");
  const tool = createInitReportTool(tmp);
  await tool.execute("call-1", { title: "Smoke Test Title" });

  const figstylePath = join(tmp, "report", "figstyle.mplstyle");
  check("report/figstyle.mplstyle exists after init_report",
    existsSync(figstylePath));

  if (existsSync(figstylePath)) {
    const content = readFileSync(figstylePath, "utf-8");

    console.log("\n2. content has the load-bearing rules");
    check("includes pdf.fonttype : 42",
      /pdf\.fonttype\s*:\s*42/.test(content));
    check("includes ps.fonttype : 42",
      /ps\.fonttype\s*:\s*42/.test(content));
    check("includes Arial Unicode MS in font.sans-serif chain",
      /font\.sans-serif.*Arial Unicode MS/.test(content));
    check("includes Hiragino Sans GB in font.sans-serif chain",
      /font\.sans-serif.*Hiragino Sans GB/.test(content));
    check("includes Noto Sans CJK SC in font.sans-serif chain",
      /font\.sans-serif.*Noto Sans CJK SC/.test(content));
    check("includes axes.unicode_minus : False (avoids U+2212 tofu)",
      /axes\.unicode_minus\s*:\s*False/.test(content));
  }

  console.log("\n3. existing figstyle.mplstyle is NOT overwritten");
  // Re-run init_report — it should not clobber a user-customized figstyle.
  const before = existsSync(figstylePath) ? readFileSync(figstylePath, "utf-8") : "";
  await tool.execute("call-2", { title: "Smoke Test Title 2" });
  // (init_report won't overwrite report.tex either, but if figstyle existed
  //  before re-run, the file should be untouched)
  const after = existsSync(figstylePath) ? readFileSync(figstylePath, "utf-8") : "";
  check("figstyle.mplstyle preserved across re-init", before === after);
} finally {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
