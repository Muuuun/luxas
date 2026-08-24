/**
 * Smoke test: the two architecture fixes of 2026-08-24.
 *
 *   A  Literature reaches report_writer as an INDEX of every entry (Core
 *      claim / Located results / Bears on this project), never a silent
 *      40KB truncation. Real projects carry 81-196KB of literature.md; the
 *      old cap dropped up to 80% of entries by alphabetical accident while
 *      <citation_keys> still advertised every key — cite-without-read.
 *
 *   B  Provenance artifacts are validated the moment they are WRITTEN: a
 *      claims.json entry with an illegal grade comes back with the finish
 *      gate's own findings in the same tool result, while the writing agent
 *      still has context. Previously all 29+16 checks fired only at
 *      finish() — the 67%-of-observations livelock.
 *
 * Run:  npx tsx scripts/smoke_write_time_validation.mts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { resolveContextBuilder } = await import(join(ROOT, "src/agents/context-builders.js"));
const { buildSafetyWrapper } = await import(join(ROOT, "src/agents/safety-wrappers.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── A: literature index ────────────────────────────────────────────────────
{
	const d = mkdtempSync(join(tmpdir(), "luxas-ctx-"));
	mkdirSync(join(d, "notes", "literature.d"), { recursive: true });
	// entry with the new fields
	writeFileSync(join(d, "notes", "literature.d", "Walker2008.md"),
		`- **Authors / Year / Venue**: Walker & Saffman / 2008 / PRA\n` +
		`- **Core claim**: Förster zeros limit blockade.\n` +
		`- **Located results**:\n  - [Table I] M=3 stretched pair has D_phi = 0\n` +
		`- **Bears on this project**: [Table I] — pre-empts the artefact claim\n` +
		`- **Limitations**: fine-structure limit only\n`);
	// legacy entry without them
	writeFileSync(join(d, "notes", "literature.d", "Aaa2020.md"),
		`- **Core claim**: something else entirely.\n- **Limitations**: none\n`);
	const ctx = resolveContextBuilder("report_writer")!(d);
	check("A: index block present", /<literature_index total_entries="2">/.test(ctx), ctx.slice(0, 200));
	check("A: located result with address survives into context", /\[Table I\] M=3 stretched pair/.test(ctx));
	check("A: bears-on line survives", /pre-empts the artefact claim/.test(ctx));
	check("A: legacy entry still indexed by core claim", /Aaa2020[\s\S]*something else entirely/.test(ctx));
	check("A: instruction to read full fragments on demand", /read the FULL fragment/.test(ctx));
	rmSync(d, { recursive: true, force: true });
}
{	// legacy fallback: no fragments, oversized merged file → loud banner
	const d = mkdtempSync(join(tmpdir(), "luxas-ctx2-"));
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(d, "notes", "literature.md"), "### K1\n" + "x".repeat(60_000));
	const ctx = resolveContextBuilder("report_writer")!(d);
	check("A: legacy oversize fallback is LOUD about truncation", /TRUNCATED: showing 40000 of 6\d{4} chars/.test(ctx), ctx.slice(0, 300));
	rmSync(d, { recursive: true, force: true });
}

// ── B: write-time validation through the real wrapped write tool ──────────
{
	const d = mkdtempSync(join(tmpdir(), "luxas-wtv-"));
	mkdirSync(join(d, "report"), { recursive: true });
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(d, "report", "report.tex"),
		"\\begin{document}\\begin{abstract}\nThe rate is 0.0321 per cycle.\n\\end{abstract}\\end{document}");
	writeFileSync(join(d, "notes", "experiments.md"), "headline_rate = 0.0321\n");
	// a claims.json whose grade exceeds the recomputable cap (no xval exists)
	const badClaims = JSON.stringify([{ value: 0.0321, tex_context: "rate is 0.0321",
		source_file: "notes/experiments.md", source_quote: "headline_rate = 0.0321",
		grade: "corroborated", claim_key: "computed.headline_rate" }]);
	const wrapper = buildSafetyWrapper({ allowedWriteRoots: ["report/"] })!;
	const fakeWrite = {
		name: "write",
		async execute(_id: string, params: any) {
			writeFileSync(join(d, params.file_path), params.content);
			return { content: [{ type: "text", text: "written" }] };
		},
	};
	const [wrapped] = wrapper([fakeWrite], d);
	const res = await wrapped.execute("t1", { file_path: "report/claims.json", content: badClaims });
	const text = (res.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("B: illegal grade surfaces IN the write result", /write-time validation of report\/claims\.json/.test(text), text.slice(0, 200));
	check("B: the finding is the finish gate's own (grade cap)", /exceeds the recomputed cap/.test(text));
	check("B: file still written (feedback, not a wall)", readFileSync(join(d, "report", "claims.json"), "utf8") === badClaims);
	// a clean write gets no trailer
	const goodClaims = badClaims.replace('"corroborated"', '"indicative"');
	const res2 = await wrapped.execute("t2", { file_path: "report/claims.json", content: goodClaims });
	const text2 = (res2.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("B: legal claims.json write gets NO validation trailer", !/write-time validation/.test(text2), text2.slice(0, 200));
	// unrelated file writes are untouched
	const res3 = await wrapped.execute("t3", { file_path: "report/other.txt", content: "hi" });
	const text3 = (res3.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("B: unrelated writes are untouched", text3 === "written");
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — index context + write-time validation behave." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
