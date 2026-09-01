/**
 * Gate: the PI path has a repeat-gate deadman.
 *
 * Regression under test (ba-neutral-atom-qc, 2026-08-31): the PI returned the
 * SAME withheld-stop issue on seven consecutive reviews because the gate was
 * unsatisfiable as posed. FinishEscalation existed and was wired only to
 * finish(), which the brain never reached — it was waiting for the PI. Two
 * cost-cap kills, no finish().
 *
 * Run:  npx tsx scripts/smoke_pi_gate_escalation.mts
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { FinishEscalation, writeNeedsOperator, piEstimateRule } = await import(join(ROOT, "src/claims-review.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// The real issue text the PI produces, not a hand-written stand-in.
const issue = piEstimateRule("stop", [], ["ba_g4_lifetime_n_T", "c6_rb87_78s"],
	["DISCRIMINATOR: ba_g4_lifetime_n_T — a; b; c"], []).issue ?? "";
check("piEstimateRule produced a withheld-stop issue to escalate on", issue.length > 0);
check("pi-agent's trigger regex matches that issue verbatim", /^PI stop verdict withheld/.test(issue));

const esc = new FinishEscalation(3);
check("first identical withholding does not escalate", esc.record(issue) === false);
check("second identical withholding does not escalate", esc.record(issue) === false);
check("third identical withholding escalates", esc.record(issue) === true);

// Progress (a different missing-id set) must reset, or ordinary steering would
// escalate a run that is genuinely converging.
const esc2 = new FinishEscalation(3);
esc2.record(issue); esc2.record(issue);
const other = piEstimateRule("stop", [], ["totally_different_id"], ["DISCRIMINATOR: totally_different_id — a; b; c"], []).issue ?? "";
check("a different withheld-id set resets the counter", esc2.record(other) === false && esc2.count === 1);

// Review finding 7b: a placeholder verdict (reviewer infra/credit failure,
// no structured response) is neither progress nor a repeat. Resetting on it
// would starve the deadman in exactly the condition that co-occurs with the
// livelock — a half-dead reviewer between identical withheld stops.
{
	const { createPIReviewTool } = await import(join(ROOT, "src/pi-agent.js"));
	const d = mkdtempSync(join(tmpdir(), "pi-placeholder-"));
	let escalated = 0;
	const pi = createPIReviewTool({ projectDir: d, fallbackInterval: 50, onEscalate: () => { escalated++; } });
	const withheldVerdict = { verdict: "steer" as const, assessment: "", issues: [issue] };
	const placeholder = { verdict: "steer" as const, placeholder: true, assessment: "no response", issues: [] };
	check("first withheld stop does not escalate", pi.noteVerdictForEscalation(withheldVerdict) === null);
	check("second withheld stop does not escalate", pi.noteVerdictForEscalation(withheldVerdict) === null);
	check("a placeholder (reviewer infra failure) neither escalates nor resets", pi.noteVerdictForEscalation(placeholder) === null);
	const hit = pi.noteVerdictForEscalation(withheldVerdict);
	check("third withheld stop escalates THROUGH the infra blip", hit !== null && hit.count === 3, JSON.stringify(hit));
	check("onEscalate fired exactly once", escalated === 1);

	// A verdict that raises different, real issues is progress and resets.
	const pi2 = createPIReviewTool({ projectDir: d, fallbackInterval: 50 });
	pi2.noteVerdictForEscalation(withheldVerdict); pi2.noteVerdictForEscalation(withheldVerdict);
	check("a substantive non-withheld verdict resets the counter",
		pi2.noteVerdictForEscalation({ verdict: "steer" as const, assessment: "", issues: ["Fix the legend on Fig. 2"] }) === null
		&& pi2.noteVerdictForEscalation(withheldVerdict) === null);
	rmSync(d, { recursive: true, force: true });
}

// Review finding 9: the counter must survive a resume.
const esc3 = new FinishEscalation(3);
esc3.record(issue); esc3.record(issue); esc3.record(issue);
const saved = esc3.getState();
const restored = new FinishEscalation(3);
restored.restore(saved);
check("escalation state round-trips for checkpoint persistence", restored.count === esc3.count);
const fresh = new FinishEscalation(3);
fresh.restore({ last: null, repeats: 2 });
check("a resumed run does not get two fresh strikes", fresh.count === 2);
check("restore(undefined) is a no-op, not a crash", (() => { const e = new FinishEscalation(3); e.restore(undefined); return e.count === 0; })());

// The escalation artifact must name the PI failure mode, not finish()'s.
const dir = mkdtempSync(join(tmpdir(), "pi-esc-"));
const path = writeNeedsOperator(dir, issue, 3, { gate: "pi" });
const body = readFileSync(path, "utf-8");
check("writes notes/escalations/needs-operator.md", path.endsWith(join("notes", "escalations", "needs-operator.md")));
check("names the PI gate, not the finish gate", /PI withheld its stop verdict/.test(body) && !/finish\(\) was blocked/.test(body));
check("calls the gate unsatisfiable as posed", /unsatisfiable as posed/.test(body));
check("carries the blocking text verbatim for the operator", body.includes(issue));

// Back-compat: the finish narrative is unchanged when no gate is named.
const path2 = writeNeedsOperator(dir, "Cannot finish: something", 4);
check("default narrative is still the finish one", /finish\(\) was blocked by the SAME gate/.test(readFileSync(path2, "utf-8")));

rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
