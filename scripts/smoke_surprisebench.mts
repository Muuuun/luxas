/**
 * Smoke test: the planted-surprise benches (surprisebench/) and their scorer,
 * offline and free. What it pins:
 *   1. every oracle.json still matches what generate.py makes (true and naive
 *      answers): a key that drifts from its generator grades the wrong thing;
 *   2. X grading on the hand-written validation cases: a run that ignores an
 *      X-biasing plant lands on "naive", one that follows it lands on
 *      "correct", and an orthogonal plant (s3, s6) leaves X correct either way;
 *   3. quote checking and report reading: a Markdown "30%" is text, not a
 *      LaTeX comment (stripping it cut a prediction in half and both judges
 *      then said no); a quote that is not in the run is not found;
 *   4. the transcript digest reads Claude Code's stream-json.
 * The judges themselves cost money and are checked by
 * `surprise_score.mts --validate`, not here.
 *
 * Run:  npx tsx scripts/smoke_surprisebench.mts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const S = await import(join(ROOT, "scripts/surprise_score.mts"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// 1. answer keys against the generator
const gen = spawnSync("python3", [join(ROOT, "surprisebench/_lib/generate.py"), "--check"], { encoding: "utf-8" });
check("generate.py --check: every oracle.json matches its generator", gen.status === 0, (gen.stdout + gen.stderr).split("\n").filter((l) => l.startsWith("BAD") || /Error/.test(l)).join(" | ").slice(0, 400));

// 2. X grading on the validation cases
const cases = JSON.parse(readFileSync(join(ROOT, "surprisebench/_validation/cases.json"), "utf-8"));
const orthogonal = new Set(["s3-lc-sweep", "s6-pendulum"]);
for (const c of cases) {
	const kind = c.id.split("-").slice(1).join("-");
	const x = S.gradeX(c.answer, S.loadOracle(c.bench));
	const verdicts = Object.values<any>(x.keys).map((k) => k.verdict);
	let want: string;
	if (kind === "full" || kind === "clean" || orthogonal.has(c.bench)) want = "correct";
	else if (kind === "false-alarm") want = c.bench === "c2-orbit" ? "correct" : "wrong";
	else want = "naive";
	check(`X ${c.id}: ${want}`, verdicts.every((v) => v === want), verdicts.join(","));
}
check("X: a missing answer.json is 'missing', not 'wrong'", Object.values<any>(S.gradeX(null, S.loadOracle("s5-halflife")).keys).every((k) => k.verdict === "missing"));

// 3. quotes and report reading
const dir = mkdtempSync(join(tmpdir(), "surprise-smoke-"));
try {
	mkdirSync(join(dir, "report"), { recursive: true });
	writeFileSync(join(dir, "report/report.md"), "Next: we predict the values rise by about 30% (from 0.054 to 0.070 rad/orbit).\n");
	check("Markdown: text after a % is kept", /from 0\.054 to 0\.070/.test(S.reportText(dir)), S.reportText(dir));
	rmSync(join(dir, "report/report.md"));
	writeFileSync(join(dir, "report/report.tex"), "Loss of 44\\% at start. % a real comment\nNext line.\n");
	const tex = S.reportText(dir);
	check("LaTeX: an escaped \\% stays, a comment goes", /44\\% at start/.test(tex) && !/real comment/.test(tex) && /Next line/.test(tex), tex);
	const surface = "The residuals oscillate with a period of 1.25~s and the envelope beats.";
	check("quote: the same sentence with LaTeX spacing is found", S.quoteFound("the residuals oscillate with a period of 1.25 s", surface));
	check("quote: a sentence the run never wrote is not found", !S.quoteFound("The envelope beats strongly at 2 Hz and a third mode appears", surface));
	check("quote: under 3 words never counts", !S.quoteFound("beats", surface));
	const src = "The apparent conductivity $\\kap_\\mathrm{app}=PL/(A\\Delta T)$ (file \\texttt{data/results/per\\_point.csv})\nrises steadily from 23.10\\Wmk\\ (row 1, mean rod temperature 309\\,K) to 25.24\\Wmk\\ (row 13, 418\\,K).\nIn vacuum (10$^{-6}$ mbar) the heater power splits between the rod and radiation.";
	check("quote: LaTeX read as symbols, a parenthetical dropped (pilot s4)", S.quoteFound("The apparent conductivity κ_app=PL/(AΔT) rises steadily from 23.10 W m–1 K–1 (row 1, mean", src));
	check("quote: superscript digits match LaTeX exponents", S.quoteFound("In vacuum (10⁻⁶ mbar) the heater power splits between the rod and radiation", src));
	check("quote: fragments joined by ... each found", S.quoteFound("The apparent conductivity ... rises steadily from 23.10 ... (row 13, 418 K)", src));
	check("quote: a fragment the run never wrote sinks the quote", !S.quoteFound("The apparent conductivity ... falls sharply below 20 W/m/K at high power", src));
	check("quote: a plausible sentence the run never wrote is not found", !S.quoteFound("The conductivity is constant within 1% across the whole power range", src));

	// 4. the transcript digest
	const t = [
		{ type: "system", subtype: "init" },
		{ type: "assistant", message: { content: [{ type: "text", text: "Plotting the envelope." }, { type: "tool_use", id: "a", name: "Bash", input: { command: "python3 fit.py" } }] } },
		{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: [{ type: "text", text: "Q=17060" }] }] } },
		{ type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "Write", input: { file_path: "/x/answer.json", content: "{\"Q\": 17060}" } }] } },
		{ type: "result", subtype: "success", result: "done" },
	];
	writeFileSync(join(dir, "claude_transcript.jsonl"), t.map((x) => JSON.stringify(x)).join("\n") + "\n");
	const d = S.transcriptDigest(dir);
	check("digest: text, command, result and written file appear in order", /\[assistant\] Plotting[\s\S]*\[tool Bash\] python3 fit\.py[\s\S]*\[result\] Q=17060[\s\S]*\[tool Write\] \/x\/answer\.json/.test(d), d);
	check("digest: a long transcript keeps its head and tail", (() => {
		const many = Array.from({ length: 400 }, (_, i) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: `line ${i} ` + "x".repeat(300) }] } }));
		writeFileSync(join(dir, "claude_transcript.jsonl"), many.join("\n"));
		const dd = S.transcriptDigest(dir, 8000);
		return dd.length < 9000 && /line 0 /.test(dd) && /line 399 /.test(dd) && /omitted/.test(dd);
	})());
	const lax = S.parseJudgeJson('{"stages": {"S1_noticed": {"verdict": "yes", "quote": "turns by 11.2$^\\circ$ per hour (\\SI{11.2}{deg})"}}}');
	check("judge JSON: a raw LaTeX backslash in a quote still parses (pilot s6)", /\\circ/.test(lax?.stages?.S1_noticed?.quote ?? ""), JSON.stringify(lax));
	// 5. how judge verdicts combine (a stub stands in for the paid judges)
	writeFileSync(join(dir, "report/report.tex"), "The rate curves at early times: dead time.\n");
	const o = S.loadOracle("s5-halflife");
	const say = (v: string, q = "The rate curves at early times") => ({ verdict: v, quote: q });
	const reply = (v: any) => async () => ({ raw: { stages: Object.fromEntries(S.PLANTED_STAGES.map((s: string) => [s, v])) }, cost: 0 });
	const err = async () => ({ raw: null, cost: 0, error: "no JSON (stop=length )" });
	const run = async (a: any, b: any) => {
		let n = 0;
		const r = await S.judgeRun(dir, o, "task", ["a", "b"], async (j: string, u: string, mt?: number) => { n++; return (j === "a" ? a : b)(j, u, mt); });
		return { v: r.stages.S1_noticed.verdict, calls: n };
	};
	check("judges: both yes with a found quote → yes", (await run(reply(say("yes")), reply(say("yes")))).v === "yes");
	check("judges: one no → no", (await run(reply(say("yes")), reply(say("no", "")))).v === "no");
	check("judges: a yes whose quote is not in the run → no", (await run(reply(say("yes")), reply(say("yes", "a sentence that is nowhere in this run at all")))).v === "no");
	const e = await run(reply(say("yes")), err);
	check("judges: a judge that fails twice → unjudged, not no (pilot s5)", e.v === "unjudged", e.v);
	check("judges: …after exactly one retry", e.calls === 3, String(e.calls));
	check("judges: a failed judge does not hide the other's no → no", (await run(reply(say("no", "")), err)).v === "no");
	let flaky = 0;
	const emptyThenFull = async () => (flaky++ === 0 ? { raw: { verdicts: "none" }, cost: 0 } : { raw: { stages: Object.fromEntries(S.PLANTED_STAGES.map((s: string) => [s, say("yes")])) }, cost: 0 });
	const fl = await run(reply(say("yes")), emptyThenFull);
	check("judges: a reply with JSON but no verdicts is asked again (deepseek-flash, 2026-10-23)", fl.v === "yes" && fl.calls === 3, `${fl.v} after ${fl.calls} calls`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// 6. the long-horizon projects (notes/surprise-ruler-long-design-2026-10-23.md)
const longCases = JSON.parse(readFileSync(join(ROOT, "surprisebench/_validation/cases_long.json"), "utf-8"));
for (const c of longCases) {
	const kind = c.id.split("-").slice(1).join("-");
	if (kind === "false-alarm") continue;
	const o = S.loadOracle(c.bench);
	const x = S.gradeX(c.answer, o);
	const right = kind === "full" || kind === "clean" || !!o.orthogonal;
	const plantKeys = Object.keys(o.answer).filter((k) => o.answer[k].plant_key || o.orthogonal);
	// A route that ignores the plant must miss at least one key it biases (L1's envelope route gets b right by accident and Q_int naive).
	check(`long X ${c.id}: ${right ? "every key the plant biases is correct" : "a key the plant biases is naive"}`,
		plantKeys.length > 0 && (right ? plantKeys.every((k) => x.keys[k].verdict === "correct") : plantKeys.some((k) => x.keys[k].verdict === "naive")), JSON.stringify(x.keys));
	check(`long X ${c.id}: plantCorrect = ${right}`, x.plantCorrect === right);
}
check("long X: a wrong key the plant does not bias leaves plantCorrect true", (() => {
	const x = S.gradeX({ dfdT_Hz_per_K: -0.05, Q_int: 12000, b_per_mbar: 0.2 }, S.loadOracle("l1-loss-budget"));
	return x.plantCorrect && !x.correct;
})());
check("long X: L1's one-damped-cosine least-squares route (Q_int right, b biased) is not plantCorrect (review 2026-10-23)", (() => {
	const x = S.gradeX({ dfdT_Hz_per_K: -0.03, Q_int: 12483, b_per_mbar: 0.265 }, S.loadOracle("l1-loss-budget"));
	return x.keys.Q_int.verdict === "correct" && !x.plantCorrect;
})());
check("stages: long planted gets D and A, orthogonal and short do not, a control gets false_alarm",
	S.stagesFor(S.loadOracle("l2-rod-prior")).join() === [...S.PLANTED_STAGES, ...S.LONG_STAGES].join()
	&& S.stagesFor(S.loadOracle("l5-foucault-g")).join() === S.PLANTED_STAGES.join()
	&& S.stagesFor(S.loadOracle("s5-halflife")).join() === S.PLANTED_STAGES.join()
	&& S.stagesFor(S.loadOracle("l4c-activation-flux")).join() === "false_alarm");
const st = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { verdict: v, byJudge: {} }]));
const longO = S.loadOracle("l1-loss-budget");
const oc = (m: Record<string, string>, xc = false) => S.outcome(longO, st(m), { correct: xc });
check("outcome: S4 and A → followed_through", oc({ S1_noticed: "yes", S4_mechanism: "yes", D_diagnosed: "yes", A_in_deliverable: "yes" }) === "followed_through");
check("outcome: D without A → diagnosed_shipped (the F.4 analog)", oc({ S1_noticed: "yes", S4_mechanism: "no", D_diagnosed: "yes", A_in_deliverable: "no" }) === "diagnosed_shipped");
check("outcome: S4 without A → diagnosed_shipped", oc({ S1_noticed: "yes", S4_mechanism: "yes", D_diagnosed: "no", A_in_deliverable: "no" }) === "diagnosed_shipped");
check("outcome: D and A without S4 → qualified_no_mechanism", oc({ S1_noticed: "yes", S4_mechanism: "no", D_diagnosed: "yes", A_in_deliverable: "yes" }) === "qualified_no_mechanism");
check("outcome: S1 only → noticed_not_followed", oc({ S1_noticed: "yes", S4_mechanism: "no", D_diagnosed: "no", A_in_deliverable: "no" }) === "noticed_not_followed");
check("outcome: nothing → missed", oc({ S1_noticed: "no", S4_mechanism: "no", D_diagnosed: "no", A_in_deliverable: "no" }) === "missed");
check("outcome: an unjudged stage it needs → unjudged", oc({ S1_noticed: "yes", S4_mechanism: "unjudged", D_diagnosed: "yes", A_in_deliverable: "no" }) === "unjudged");
check("outcome: orthogonal needs S4 and X", S.outcome(S.loadOracle("l5-foucault-g"), st({ S1_noticed: "yes", S4_mechanism: "yes" }), { correct: true }) === "followed_through"
	&& S.outcome(S.loadOracle("l5-foucault-g"), st({ S1_noticed: "yes", S4_mechanism: "no" }), { correct: true }) === "noticed_not_followed");
check("outcome: controls → clean / false_alarm", S.outcome(S.loadOracle("l1c-loss-budget"), st({ false_alarm: "no" }), { correct: true }) === "clean"
	&& S.outcome(S.loadOracle("l1c-loss-budget"), st({ false_alarm: "yes" }), { correct: true }) === "false_alarm");
check("A: right on every plant key → yes without the judges; otherwise their verdict stands", (() => {
	const a = st({ A_in_deliverable: "no" }), b = st({ A_in_deliverable: "no" });
	S.applyMechanicalA(a, { plantCorrect: true });
	S.applyMechanicalA(b, { plantCorrect: false });
	return a.A_in_deliverable.verdict === "yes" && a.A_in_deliverable.mechanical === true && b.A_in_deliverable.verdict === "no";
})());
{
	const c = longCases.find((k: any) => k.id === "l1-shipped-notes");
	const d = S.materialize(c);
	try {
		const sigs = longO.signatures;
		const windowed = S.transcriptDigest(d, 250_000, sigs);
		const headTail = S.transcriptDigest(d, 250_000);
		check("long digest: the case's transcript is longer than the cap (the windowing is exercised)", /chars of the middle omitted/.test(headTail), String(headTail.length));
		check("long digest: a diagnosis in the middle of the run survives the windowing", /1000\.797 Hz/.test(windowed) && /events omitted/.test(windowed));
		check("long digest: …which a head-and-tail cut drops", !/1000\.797 Hz/.test(headTail));
		const inp = S.judgeInputs(d, longO);
		check("notes: the agent's notes reach the judges and the quote surface", /no time for a two-mode fit/.test(inp.notes) && /no time for a two-mode fit/.test(inp.surface));
		mkdirSync(join(d, "input"), { recursive: true });
		writeFileSync(join(d, "input", "README.txt"), "GIVEN INPUT TEXT");
		check("notes: files under input/ are not the agent's notes", !/GIVEN INPUT TEXT/.test(S.agentNotes(d)));
		check("delivered: a report and a parseable answer.json", S.delivered(d));
		rmSync(join(d, "answer.json"));
		check("delivered: no answer.json → not delivered", !S.delivered(d));
	} finally {
		rmSync(d, { recursive: true, force: true });
	}
}
await S.registerJudgeModels();
{
	const { resolveModelExact } = await import(join(ROOT, "src/agents/spawn.ts"));
	let id = "";
	try { id = (resolveModelExact("kimi-k3") as any)?.id; } catch (e) { id = String(e); }
	check("judges: kimi-k3 resolves once the bench models are registered (offline)", id === "kimi-k3", id);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
