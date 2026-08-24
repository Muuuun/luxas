/**
 * Smoke test: the claim registry (architecture defect #1 fix, 2026-08-24).
 *
 * The registry is a pure function over results.json — never persisted, so
 * never stale. It ends claim_key invention: report_writer picks keys from
 * the injected <claim_registry>; the write tool validates claims.json and
 * results.json saves against it with nearest-key suggestions.
 *
 * Run:  npx tsx scripts/smoke_claim_registry.mts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { buildClaimRegistry, renderClaimRegistry, nearestKeys } = await import(join(ROOT, "src/claims-registry.js"));
const { resolveContextBuilder } = await import(join(ROOT, "src/agents/context-builders.js"));
const { buildSafetyWrapper } = await import(join(ROOT, "src/agents/safety-wrappers.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

function project(): string {
	const d = mkdtempSync(join(tmpdir(), "luxas-reg-"));
	const run = join(d, "data", "experiments", "E3_decay", "runs", "run_1");
	mkdirSync(run, { recursive: true });
	mkdirSync(join(d, "report"), { recursive: true });
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(run, "results.json"), JSON.stringify({
		computed: {
			gamow_factor: 42.66,
			calibration: { q_alpha_mev: 4.9087, note: "AME2020" },
			spectrum: [1.5, 2.5],
			cross_validation: [
				{ claim_key: "computed.gamow_factor", method_a: "WKB", method_b: "Viola-Seaborg", value_a: 42.66, value_b: 42.59, tolerance_rel: 0.1 },
			],
			cross_validation_plan: [{ claim_key: "computed.calibration.q_alpha_mev", control_method: "ENSDF" }],
		},
	}));
	writeFileSync(join(d, "report", "report.tex"), "\\begin{document}\\begin{abstract}\nG is 42.66.\n\\end{abstract}\\end{document}");
	writeFileSync(join(d, "notes", "experiments.md"), "gamow_factor = 42.66\n");
	return d;
}

const d = project();
try {
	const reg = buildClaimRegistry(d);
	const byKey = Object.fromEntries(reg.map((r: any) => [r.key, r]));

	check("numeric leaf registered", byKey["computed.gamow_factor"]?.value === 42.66);
	check("nested leaf registered with dotted key", byKey["computed.calibration.q_alpha_mev"]?.value === 4.9087);
	check("array elements registered as [i]", byKey["computed.spectrum[0]"]?.value === 1.5 && byKey["computed.spectrum[1]"]?.value === 2.5);
	check("non-numeric leaf listed without value", "computed.calibration.note" in byKey && byKey["computed.calibration.note"].value === undefined);
	check("bookkeeping subtrees excluded", !Object.keys(byKey).some((k) => /cross_validation|method_/.test(k)));
	check("xval status attached (corroborated)", byKey["computed.gamow_factor"]?.xval === "corroborated");
	check("planned-unrun flagged", byKey["computed.calibration.q_alpha_mev"]?.planned === true && byKey["computed.calibration.q_alpha_mev"]?.xval === null);
	check("experiment id carried", byKey["computed.gamow_factor"]?.experiment === "E3");

	const rendered = renderClaimRegistry(reg);
	check("render: corroborated key marked may-headline", /computed\.gamow_factor = 42\.66\s+\[E3\]\s+xval:CORROBORATED/.test(rendered));
	check("render: pick-never-invent instruction present", /pick, never invent/.test(rendered));
	check("render: array collapsed to a range line", /computed\.spectrum\[0\.\.1\] — 2 array elements/.test(rendered), rendered.slice(0, 400));

	// Oversize corpus: plain keys group per subtree, LOUDLY — nothing silent.
	{
		const big: any = { computed: { xval_key: 1.0, cross_validation: [{ claim_key: "computed.xval_key", method_a: "a", method_b: "b", value_a: 1.0, value_b: 1.01, tolerance_rel: 0.1 }] } };
		for (let i = 0; i < 500; i++) big.computed[`bench.case_${i}`] = { score: i };
		const run2 = join(d, "data", "experiments", "E9_big", "runs", "run_0");
		mkdirSync(run2, { recursive: true });
		writeFileSync(join(run2, "results.json"), JSON.stringify(big));
		const r2 = renderClaimRegistry(buildClaimRegistry(d));
		check("oversize: xval'd key still rendered individually", /computed\.xval_key = 1\s+\[E9\]/.test(r2), r2.slice(0, 300));
		check("oversize: plain keys grouped with counts, not dropped", /computed\.bench\.case_\d+\.\* — 1 keys|grouped=/.test(r2) && /grouped="/.test(r2), r2.slice(0, 400));
		check("oversize: grouped lines direct to results.json for exact spelling", /read (that experiment's|the) results\.json/.test(r2));
		rmSync(join(d, "data", "experiments", "E9_big"), { recursive: true, force: true });
	}

	const near = nearestKeys("computed.gamow", reg);
	check("nearestKeys suggests the real key", near[0] === "computed.gamow_factor", JSON.stringify(near));

	const ctx = resolveContextBuilder("report_writer")!(d);
	check("report_writer context carries <claim_registry>", /<claim_registry entries=/.test(ctx));

	// write-time: invented key in claims.json
	const wrapper = buildSafetyWrapper({ allowedWriteRoots: ["report/", "data/"] })!;
	const fakeWrite = { name: "write", async execute(_id: string, p: any) { writeFileSync(join(d, p.file_path), p.content); return { content: [{ type: "text", text: "written" }] }; } };
	const [w] = wrapper([fakeWrite], d);
	const bad = JSON.stringify([{ value: 42.66, tex_context: "G is 42.66", source_file: "notes/experiments.md", source_quote: "gamow_factor = 42.66", grade: "indicative", claim_key: "computed.gamow_ratio" }]);
	const r1 = await w.execute("t", { file_path: "report/claims.json", content: bad });
	const t1 = (r1.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("write-time: invented claim_key flagged with nearest suggestion", /not in the claim registry/.test(t1) && /computed\.gamow_factor/.test(t1), t1.slice(0, 250));

	const good = bad.replace("computed.gamow_ratio", "computed.gamow_factor");
	const r2 = await w.execute("t", { file_path: "report/claims.json", content: good });
	const t2 = (r2.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("write-time: registry key passes clean", !/not in the claim registry/.test(t2), t2.slice(0, 250));

	// write-time: phantom xval key in results.json
	const badResults = JSON.stringify({ computed: { gamow_factor: 42.66,
		cross_validation: [{ claim_key: "computed.gamov_factor", method_a: "a", method_b: "b", value_a: 1, value_b: 1.01, tolerance_rel: 0.1 }] } });
	mkdirSync(join(d, "data", "experiments", "E3_decay", "runs", "run_2"), { recursive: true });
	const r3 = await w.execute("t", { file_path: "data/experiments/E3_decay/runs/run_2/results.json", content: badResults });
	const t3 = (r3.content ?? []).map((c: any) => c.text ?? "").join("\n");
	check("write-time: phantom xval claim_key flagged on results.json save", /names no computed\.\* leaf/.test(t3) && /gamow_factor/.test(t3), t3.slice(0, 300));
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — claim registry ends key invention." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
