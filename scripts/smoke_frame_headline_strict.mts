/**
 * Gate: strict frame headline parsing + the non-scalar ESTIMATE waiver.
 *
 * Regression under test (ba-neutral-atom-qc, 2026-08-31): the bullet
 * "- Named (non-scalar) deliverables: `isotope_choice`, …" parsed as a
 * headline quantity id `Named`, which no ESTIMATE could ever match, so every
 * PI stop verdict was downgraded to steer — 7 STEERs, two cap kills, no
 * finish(). Curve-valued ids had the same effect for a different reason.
 *
 * Run:  npx tsx scripts/smoke_frame_headline_strict.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { parseFrameHeadline, parseFrameHeadlineDetailed } = await import(join(ROOT, "src/claims-table.js"));
const { piEstimateRule } = await import(join(ROOT, "src/claims-review.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const dir = mkdtempSync(join(tmpdir(), "frame-strict-"));
mkdirSync(join(dir, "notes"), { recursive: true });
// Verbatim shape of the frame that caused the livelock, plus a legacy bare id.
writeFileSync(join(dir, "notes", "frame.md"), `# Frame

## Headline quantities
- \`ba_g4_lifetime_n_T\` — Ba 6sng ¹G₄ Rydberg lifetime vs n (40–100), at 300 K and cryogenic, each with σ. (crux; curve)
- \`infidelity_ratio_ba_vs_refs\` — equal-footing ratio vs {Rb, Cs, Sr, Yb}. (the frontier — deliverable object)
- legacy_bare_id — an id written without backticks, as older frames did.
- Named (non-scalar) deliverables: \`isotope_choice\`, \`encoding_choice\` recommendations (quantitative rationale each).
- \`tau300\` — lifetime from an exponential fit (decay curve at 300 K)
- fidelity — the gate fidelity, written bare and single-token as older frames did
-\`tight_id\` — no space after the bullet marker
---

## Premises
- \`x\` = given — y.
`);

const parsed = parseFrameHeadlineDetailed(dir);
check("mid-line prose about a curve does NOT waive a scalar (review finding 4)", !parsed.nonScalar.includes("tau300"), JSON.stringify(parsed.nonScalar));
check("legacy single-token bare id survives (review finding 5)", parsed.ids.includes("fidelity"), JSON.stringify(parsed.ids));
check("tight bullet `-`id`` parses rather than vanishing (review finding 6)", parsed.ids.includes("tight_id"), JSON.stringify(parsed.ids));
check("a horizontal rule is not reported as a skipped bullet", !parsed.skipped.some((s: string) => /^-{3,}$/.test(s)), JSON.stringify(parsed.skipped));
check("the prose bullet yields NO phantom id (`Named` is gone)", !parsed.ids.includes("Named"), JSON.stringify(parsed.ids));
check("back-ticked ids still parse", parsed.ids.includes("ba_g4_lifetime_n_T") && parsed.ids.includes("infidelity_ratio_ba_vs_refs"));
check("legacy bare snake_case ids still parse (back-compat)", parsed.ids.includes("legacy_bare_id"), JSON.stringify(parsed.ids));
check("exactly the six real ids, no phantom", parsed.ids.length === 6, JSON.stringify(parsed.ids));
check("the skipped prose bullet is surfaced, not silently dropped", parsed.skipped.length === 1 && /^- Named/.test(parsed.skipped[0]), JSON.stringify(parsed.skipped));
check("(curve) tag marks the id non-scalar", parsed.nonScalar.length === 1 && parsed.nonScalar[0] === "ba_g4_lifetime_n_T", JSON.stringify(parsed.nonScalar));
check("parseFrameHeadline stays the id-only view", JSON.stringify(parseFrameHeadline(dir)) === JSON.stringify(parsed.ids));

// The gate itself: a stop must survive when the only "missing" estimate is a
// curve, and must still be withheld when a genuine scalar has none.
const disc = ["DISCRIMINATOR: ba_g4_lifetime_n_T — if right: n^3; if wrong: n^5; computation: fixed-l sum",
	"DISCRIMINATOR: infidelity_ratio_ba_vs_refs — if right: <1; if wrong: >1; computation: equal-footing rerun"];
const ids = ["ba_g4_lifetime_n_T", "infidelity_ratio_ba_vs_refs"];
const est = [{ quantity: "infidelity_ratio_ba_vs_refs", value: 0.76, sigma: 0.1, route: "hand estimate" }];

const waived = piEstimateRule("stop", est, ids, disc, ["ba_g4_lifetime_n_T"]);
check("stop SURVIVES when the only un-estimated id is frame-tagged non-scalar", waived.verdict === "stop" && !waived.issue, JSON.stringify(waived));
const notWaived = piEstimateRule("stop", est, ids, disc, []);
check("stop is still withheld when an un-waived id has no estimate", notWaived.verdict === "steer" && /ba_g4_lifetime_n_T/.test(notWaived.issue ?? ""));
const noDisc = piEstimateRule("stop", est, ids, ["DISCRIMINATOR: infidelity_ratio_ba_vs_refs — a; b; c"], ["ba_g4_lifetime_n_T"]);
check("the waiver does NOT excuse a missing DISCRIMINATOR for the curve", noDisc.verdict === "steer" && /ba_g4_lifetime_n_T/.test(noDisc.issue ?? ""), JSON.stringify(noDisc));

// The withheld-stop issue must match the pattern pi-agent.ts escalates on.
check("withheld-stop issue matches the escalation trigger regex", /^PI stop verdict withheld/.test(notWaived.issue ?? ""));

rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
