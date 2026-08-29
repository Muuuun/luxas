/**
 * smoke_figspec — figures v3: the four data figures of the pp-vs-ss run rendered from
 * declarative specs; every PDF must pass figlint-pdf at its print width with 0 errors.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const out = mkdtempSync(join(tmpdir(), "figspec-"));
const widths: Record<string, number> = { fig2: 3.4, fig3: 3.4, fig4: 3.4, fig5: 7.0, fig6: 3.4, fig7: 7.0, fig8: 3.4 };
for (const f of ["fig2", "fig3", "fig4", "fig5", "fig6", "fig7", "fig8"]) {
  const spec = readFileSync(`fixtures/figspec/${f}.figspec.json`, "utf-8").replaceAll("OUT/", out + "/");
  const sp = join(out, `${f}.json`); writeFileSync(sp, spec);
  let err = "";
  try {
    execFileSync("python3", ["skills/matplotlib-figures/scripts/figspec", sp], { env: { ...process.env, FIGSPEC_STYLE: "fixtures/figspec/figstyle.mplstyle" }, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) { err = String(e.stderr ?? e); }
  check(`${f}: renders`, !err && existsSync(join(out, `${f}.pdf`)), err.slice(-400));
  if (err) continue;
  let lint = "", code = 0;
  try { lint = execFileSync("python3", ["skills/matplotlib-figures/scripts/figlint-pdf", join(out, `${f}.pdf`), "--width", String(widths[f])], { stdio: ["ignore", "pipe", "pipe"] }).toString(); }
  catch (e: any) { code = e.status ?? 1; lint = String(e.stdout ?? "") + String(e.stderr ?? ""); }
  check(`${f}: figlint-pdf clean at ${widths[f]} in`, code === 0 && !/ERROR/.test(lint), lint.split("\n").filter((l) => /ERROR|WARN/.test(l)).join(" | ").slice(0, 300));
}
if (fails) { console.log(`\n${fails} failure(s) (renders in ${out})`); process.exit(1); }
console.log("\nall figspec checks passed");
