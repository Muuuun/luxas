/**
 * smoke_revise_binding — v3 D1: a `VERDICT: revise` at the iteration cap must
 * reach the ledger. On a copy of the pp-vs-ss fixture: a synthetic round-4
 * review with FEEDBACK → E1's quantities capped at indicative + a blocking
 * finish issue; `finding_open:` quoting the sentence clears the block;
 * `finding_answered:` with a locator lifts the cap; a `(none)` verdict never counts.
 * C15: every issue of the latest REVISE round is bound to THAT round — an
 * answer written for an earlier round, or for no round, answers nothing — and
 * the full FEEDBACK reaches the review file.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as claimsReview from "../src/claims-review.ts";
import { openReviewFindings, quotesSentence, persistReview } from "../src/claims-review.ts";
import { buildClaimTable, claimTableIssues, parseReviewerLines } from "../src/claims-table.ts";
import { finalizationAllowedAgents } from "../src/hooks.ts";
import { loadAgentDefinitions } from "../src/agents/registry.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = mkdtempSync(join(tmpdir(), "revise-binding-"));
cpSync("fixtures/claims-ppss", dir, { recursive: true });
delete process.env.LUXAS_REVISE_BINDING;

check("baseline: the fixture's latest E1 review is (none) → no open finding", !openReviewFindings(dir).has("E1"));
const sentence = "The theta=90 value 299.11 rests on a truncated basis that the diagonalization control contradicts by 10 percent.";
const feedback = sentence + " Re-run the SystemPair diagonalization with n±5 and report the converged C6 at theta=90 with its σ.";
persistReview(dir, "E1_ss_pp_c6_anisotropy", 4, [], [], "VERDICT: revise", [], feedback);
const f = openReviewFindings(dir).get("E1");
check("revise + FEEDBACK persisted → open finding for E1 with the first sentence", !!f && f.sentence === sentence && !f.answered && !f.quoted, JSON.stringify(f));
check("review file carries the FEEDBACK block", /^FEEDBACK:\n/m.test(readFileSync(join(dir, "reviews", "experiment_review_E1_ss_pp_c6_anisotropy_r4.md"), "utf-8")));
const t1 = buildClaimTable(dir);
check("E1's quantities carry the open-finding reason", t1.rows.filter((r) => r.estimates.some((e) => e.experiment === "E1")).some((r) => r.reasons.some((x) => /reviewer finding open \(E1 round 4\)/.test(x))));
check("finish issue [review-open] is blocking and quotes the sentence", claimTableIssues(dir, t1).some((i) => i.blocking && /\[review-open\] E1/.test(i.text) && i.text.includes(sentence.slice(0, 60))));

// finding_open quote → block clears, cap stays
const ledgerPath = join(dir, "notes", "experiments.md");
const ledger = readFileSync(ledgerPath, "utf-8");
const l2 = ledger.indexOf("## L2.1");
const nextSec = ledger.indexOf("\n## ", l2 + 5);
const withQuote = ledger.slice(0, nextSec) + `\n### Limitations\nfinding_open: "${sentence}"\n` + ledger.slice(nextSec);
writeFileSync(ledgerPath, withQuote);
const f2 = openReviewFindings(dir).get("E1")!;
check("finding_open quoting ≥8 words clears the finish block (quoted=true, answered=false)", f2.quoted && !f2.answered);
check("quotesSentence: partial 8-token window matches; unrelated text does not", quotesSentence("… we note: the theta=90 value 299.11 rests on a truncated basis …", sentence) && !quotesSentence("unrelated limitations text about beams", sentence));
check("no [review-open] issue once quoted", !claimTableIssues(dir).some((i) => /\[review-open\] E1/.test(i.text)));
check("cap persists while only quoted", buildClaimTable(dir).rows.filter((r) => r.estimates.some((e) => e.experiment === "E1")).some((r) => r.reasons.some((x) => /reviewer finding open/.test(x))));

// finding_answered with a locator → cap lifts
writeFileSync(ledgerPath, ledger.slice(0, nextSec) + `\n### Limitations\nfinding_answered: r4 #1 re-ran the diagonalization with n±5 — data/experiments/E1_ss_pp_c6_anisotropy/runs/run_1/results.json computed.c6_pp_theta90_60\n` + ledger.slice(nextSec));
const f3 = openReviewFindings(dir).get("E1")!;
check("finding_answered: r4 #1 with a locator → answered", f3.answered);
check("cap lifted once answered", !buildClaimTable(dir).rows.some((r) => r.reasons.some((x) => /reviewer finding open/.test(x))));
writeFileSync(ledgerPath, ledger.slice(0, nextSec) + `\n### Limitations\nfinding_answered: we fixed it\n` + ledger.slice(nextSec));
check("finding_answered WITHOUT a locator does not count", !openReviewFindings(dir).get("E1")!.answered);
process.env.LUXAS_REVISE_BINDING = "0";
check("LUXAS_REVISE_BINDING=0 disables", openReviewFindings(dir).size === 0);
delete process.env.LUXAS_REVISE_BINDING;

// C15. Dy E1 round 3 had three issues; the ledger's round-1/round-2
// `finding_answered` lines were counted as answering them (any line with a
// locator did), and the file kept only the first 1200 chars of FEEDBACK.
console.log("\nC15. every issue of the latest REVISE round is bound to that round; the full FEEDBACK is persisted");
{
  const d = mkdtempSync(join(tmpdir(), "revise-binding-c15-"));
  cpSync("fixtures/claims-ppss", d, { recursive: true });
  const EID = "E1_ss_pp_c6_anisotropy";
  const I1 = "The clock list in computed.clock_points omits a smooth 163 m_I=-1/2->+1/2 clock at 484.7 G (f=-1256.80 MHz, f''=-88 Hz/G^2, purity 0.81) because the purity>=0.9 labeling cut hides it. Re-run the root search with eigenstates tracked by overlap between adjacent field points, list every root with its purity, and either justify excluding this clock on physical grounds (e.g. the RF matrix element) or add it to clock_points along with its T2* and an updated lowest clock statement.";
  const I2 = "The second-order white-noise 277.4 s floor wrongly plugs S0*BW (1 kHz bandwidth) into the quasi-static Gaussian formula over a ~280 s timescale, where that noise averages out. Recompute this channel in the fast-noise limit (rate ~ (2pi)^2 (f''/2)^2 2 sigma^4/BW, plus a calibratable mean shift f'' sigma^2/2), then update T2star_at_clock_s (139.8 s and 274.7 s) and the headline findings.";
  const I3 = "The +-0.31 G (161) and +-77.1 G (163) clock-field budgets in computed.clock_uncertainty omit the diamagnetic shielding correction to g_I; a 0.9% correction shifts them by -0.32 G and +118 G. Add the shielding correction (cite a sigma_d value) as a systematic term, or show that the Stone2014 moments already include it; SENTINEL_TAIL_OF_ISSUE_3 report sigma_d with its source and the shifted budgets in clock_uncertainty_shielded.";
  const fb = [I1, I2, I3].map((t, i) => `- Issue ${i + 1}: ${t}`).join("\n");
  persistReview(d, EID, 3, [], [], "VERDICT: revise", [], fb);
  const file = readFileSync(join(d, "reviews", `experiment_review_${EID}_r3.md`), "utf-8");
  check("C15 (a) FEEDBACK past 1200 chars is persisted (the sentinel in Issue 3)",
    fb.indexOf("SENTINEL_TAIL_OF_ISSUE_3") > 1200 && file.includes("SENTINEL_TAIL_OF_ISSUE_3"),
    `${fb.length} chars of FEEDBACK, sentinel at ${fb.indexOf("SENTINEL_TAIL_OF_ISSUE_3")}; file holds it: ${file.includes("SENTINEL_TAIL_OF_ISSUE_3")}`);

  const ledger15 = join(d, "notes", "experiments.md");
  const base15 = readFileSync(ledger15, "utf-8");
  const end1 = base15.indexOf("\n## ", base15.indexOf("## L2.1") + 5);
  const limitations = (...lines: string[]) => writeFileSync(ledger15, base15.slice(0, end1) + `\n### Limitations\n${lines.join("\n")}\n` + base15.slice(end1));
  const e1 = () => openReviewFindings(d).get("E1") as any;
  const states = () => ((e1()?.issues ?? []) as any[]).map((i) => `${i.n}:${i.answered ? "A" : i.quoted ? "Q" : "-"}`).join(" ");
  const reviewOpen = () => claimTableIssues(d).filter((i) => /\[review-open\] E1\b/.test(i.text));
  const blocking = () => reviewOpen().filter((i) => i.blocking);
  const advisory = () => reviewOpen().filter((i) => !i.blocking);
  const capReason = () => buildClaimTable(d).rows.filter((r) => r.estimates.some((e) => e.experiment === "E1")).flatMap((r) => r.reasons).find((x) => /reviewer finding open \(E1 round 3\)/.test(x));
  const brief = () => `issues [${states()}] ${JSON.stringify(reviewOpen().map((i) => `${i.blocking ? "B" : "-"} ${i.text.slice(0, 140)}`))}`;
  const words = (s: string, n = 12) => s.split(" ").slice(0, n).join(" ");

  check("C15 reviewOpenIssues is exported from claims-review.ts (the file the freeze gate scans for spawn routes)",
    typeof (claimsReview as any).reviewOpenIssues === "function");

  limitations(
    "- finding_answered: round-1 issues 1–4 — runs/run_1/results.json",
    "- finding_answered: r2 #1 the clock T2* uses the exact Gaussian prefactor plus a white-noise floor — runs/run_2/results.json#computed.coherence",
  );
  const f15 = e1();
  check("C15 (b) round-1 and round-2 answers leave round 3's Issues 1, 2, 3 open",
    !!f15 && f15.round === 3 && f15.experimentId === EID && states() === "1:- 2:- 3:-" && f15.answered === false && f15.quoted === false, brief());
  const b15 = blocking(), a15 = advisory();
  check("C15 (b) exactly one blocking [review-open] E1: round 3 Issue 1 quoted, the r3 #1 form, the ledger_writer route with the eid",
    b15.length === 1 && /round 3 Issue 1\b/.test(b15[0].text) && b15[0].text.includes(I1.slice(0, 60)) && b15[0].text.includes("finding_answered: r3 #1")
      && b15[0].text.includes('spawn_agent(agent="ledger_writer"') && b15[0].text.includes(EID), brief());
  check("C15 (b) and one non-blocking [review-open] E1 naming Issues 2 and 3",
    a15.length === 1 && /Issue 2\b/.test(a15[0].text) && /Issue 3\b/.test(a15[0].text), brief());
  check("C15 (b) the cap reason names the round-bound form r3 #1", !!capReason()?.includes("r3 #1"), String(capReason()));

  limitations("- finding_answered: re-ran the clock root search with overlap tracking — results.json");
  check("C15 (c) a round-less finding_answered with a locator leaves Issue 1 open",
    e1()?.issues?.[0]?.answered === false && e1()?.answered === false && blocking().length === 1, brief());

  limitations(
    "- finding_answered: r3 #1 re-ran the root search with overlap tracking; the 484.7 G clock is listed — runs/run_3/results.json",
    "- finding_answered: round 3 issue 3 the shielding correction is a systematic term — computed.clock_uncertainty",
  );
  check("C15 (d) 'r3 #1' and 'round 3 issue 3' answer Issues 1 and 3", states() === "1:A 2:- 3:A" && e1()?.answered === true, brief());
  check("C15 (d) no blocking [review-open] E1; the non-blocking one names only Issue 2",
    blocking().length === 0 && advisory().length === 1 && /Issue 2\b/.test(advisory()[0].text) && !/Issue [13]\b/.test(advisory()[0].text), brief());
  check("C15 (d) the E1 cap reason is gone", capReason() === undefined, String(capReason()));

  limitations("- finding_answered: r3 #1 re-ran the root search with overlap tracking");
  check("C15 (e) 'r3 #1' without a locator does not count", e1()?.issues?.[0]?.answered === false && blocking().length === 1, brief());

  limitations("- finding_answered: round-3 issues 1–3 — runs/run_3/results.json");
  check("C15 (f) 'round-3 issues 1–3' (Dy's real form) answers all three; no [review-open] E1 left", states() === "1:A 2:A 3:A" && reviewOpen().length === 0, brief());
  limitations("- finding_answered: r3 issues 1, 2 and 3 — runs/run_3/results.json");
  check("C15 (f) 'r3 issues 1, 2 and 3' answers all three", states() === "1:A 2:A 3:A", brief());
  limitations(`- finding_answered: ${words(I2, 14)} is now computed in the fast-noise limit — runs/run_3/results.json`);
  check("C15 (f) an answer quoting ≥8 words of Issue 2 with a locator answers Issue 2 only", states() === "1:- 2:A 3:-", brief());
  limitations(`- finding_answered: r2 #2 ${words(I2, 14)} is now computed in the fast-noise limit — runs/run_2/results.json`);
  check("C15 (f) the same quote labelled for round 2 answers nothing (an unfixed issue repeated verbatim)", states() === "1:- 2:- 3:-", brief());

  limitations(`- finding_open: "${words(I2)}"`);
  check("C15 (g) a finding_open quoting ≥8 words of Issue 2 drops it from the non-blocking list",
    states() === "1:- 2:Q 3:-" && blocking().length === 1 && advisory().length === 1 && /Issue 3\b/.test(advisory()[0].text) && !/Issue 2\b/.test(advisory()[0].text), brief());
  limitations(`- finding_open: "${words(I1)}"`);
  check("C15 (g) a finding_open quoting Issue 1 clears the block; the cap stays",
    blocking().length === 0 && e1()?.quoted === true && e1()?.answered === false && capReason() !== undefined, brief());
  const rj = join(d, "data", "experiments", EID, "runs", "run_1", "results.json");
  const results = JSON.parse(readFileSync(rj, "utf-8"));
  writeFileSync(rj, JSON.stringify({ ...results, computed: { ...results.computed, reviewer_open_issues: [words(I3, 16)] } }));
  check("C15 (g) a computed.reviewer_open_issues string quoting Issue 3 discloses it", states() === "1:Q 2:- 3:Q", brief());
  writeFileSync(rj, JSON.stringify(results));

  persistReview(d, "E9_probe", 1, [], [], "VERDICT: revise", ["some_q"],
    "- Issue 1: the scaling claim is untested and needs a sweep over at least one decade.\nINDEPENDENT: some_q a vs b — shared: none — leaked into FEEDBACK\nDISCLOSE-OK: some_q — leaked into FEEDBACK");
  const rl = parseReviewerLines(d);
  check("C15 (h) an incomplete review's FEEDBACK lines attest nothing (INDEPENDENT / DISCLOSE-OK)",
    !rl.independent.has("some_q") && !rl.discloseOk.has("some_q") && !rl.independentLines.some((l) => l.id === "some_q"),
    `independent ${rl.independent.has("some_q")}, discloseOk ${rl.discloseOk.has("some_q")}`);

  const brainTypes = loadAgentDefinitions().get("brain")?.spawn?.allowedTypes ?? [];
  check("C15 (i) the brain may spawn ledger_writer and the finalization freeze allows it",
    brainTypes.includes("ledger_writer") && finalizationAllowedAgents(false).has("ledger_writer"), `brain allowedTypes [${brainTypes}]`);
  rmSync(d, { recursive: true, force: true });
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — a diagnosed flaw must reach the ledger before the report ships.");
