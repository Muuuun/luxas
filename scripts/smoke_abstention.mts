/**
 * smoke_abstention — v3 D4: a frame headline id that is disputed/conditional must
 * be abstained on in the abstract ("we could not determine <observable> …"); the
 * sentence lifts the abstract block for that row but never the ban on its number.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildClaimTable, claimTableIssues, renderClaimTable, abstractAbstains } from "../src/claims-table.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const src = "fixtures/claims-ppss";
// As-is: no frame id is disputed/conditional → no abstention obligation.
const t0 = buildClaimTable(src);
check("ppss as-is: no abstention obligation (frame ids not disputed)", t0.abstain.length === 0, t0.abstain.map((a) => a.id).join(","));

// Force a disputed row into the frame's headline list.
const dir = mkdtempSync(join(tmpdir(), "abstain-"));
cpSync(src, dir, { recursive: true });
const frame = join(dir, "notes", "frame.md");
writeFileSync(frame, readFileSync(frame, "utf-8").replace("## Fermi anchors", "- `max_gain_over_orientation` — packing-density gain at the best lattice orientation.\n\n## Fermi anchors"));
const t1 = buildClaimTable(dir);
const a = t1.abstain.find((x) => x.id === "max_gain_over_orientation");
check("disputed frame id → abstain entry", !!a && !a.satisfied, JSON.stringify(t1.abstain));
check("sentence carries 'could not determine' + observable + a route value", !!a && /^we could not determine .+gives/.test(a.sentence), a?.sentence);
const i1 = claimTableIssues(dir, t1);
const ob = i1.find((x) => x.blocking && /^\[abstain\] max_gain_over_orientation/.test(x.text));
check("finish: blocking [abstain] issue with the sentence to paste", !!ob && ob.text.includes(a!.sentence), i1.map((x) => x.text.slice(0, 80)).join(" | "));
check("render: ship line flags the missing sentence", /abstentions: max_gain_over_orientation \(SENTENCE MISSING\)/.test(renderClaimTable(t1)) && /abstract blocked \(.*max_gain_over_orientation/.test(renderClaimTable(t1)));

// Paste the sentence into the abstract (the 1.98 number stays in the abstract on purpose).
const tex = join(dir, "report", "report.tex");
writeFileSync(tex, readFileSync(tex, "utf-8").replace(/\\end\{abstract\}/, `In addition, ${a!.sentence}\n\\end{abstract}`));
const t2 = buildClaimTable(dir);
check("sentence present → satisfied", t2.abstain[0]?.satisfied === true);
const i2 = claimTableIssues(dir, t2);
check("finish: [abstain] issue cleared", !i2.some((x) => /^\[abstain\]/.test(x.text)));
check("finish: the disputed number itself (1.98) is still blocked by value-match", i2.some((x) => x.blocking && /carries a value equal to an estimate of max_gain_over_orientation/.test(x.text)), i2.filter((x) => x.blocking).map((x) => x.text.slice(0, 100)).join(" | "));
const r2 = renderClaimTable(t2);
check("render: abstained row no longer counted as abstract-blocking", /max_gain_over_orientation \(in abstract\)/.test(r2) && !/abstract blocked \([^)]*max_gain_over_orientation/.test(r2), r2.split("\n").slice(-2).join(" / "));

// Matcher unit checks
check("matcher: id match", abstractAbstains("We could not determine max_gain_over_orientation here.", "max_gain_over_orientation", "x"));
check("matcher: 4 consecutive observable words", abstractAbstains("the packing density gain at the best lattice orientation remains undetermined", "q", "packing-density gain at the best lattice orientation"));
check("matcher: phrase without the subject does not count", !abstractAbstains("we could not determine anything.", "q", "packing-density gain at the best lattice orientation"));
check("matcher: subject without the phrase does not count", !abstractAbstains("the packing density gain at the best lattice orientation is 2.", "q", "packing-density gain at the best lattice orientation"));

if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nall abstention checks passed");
