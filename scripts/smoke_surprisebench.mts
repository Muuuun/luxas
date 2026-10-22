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
	check("quote: under 8 characters never counts", !S.quoteFound("beats", surface));

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
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
