/**
 * Smoke test: the anomaly-disposition channel (src/dynamics.ts, 2026-08-25).
 *
 * computed.anomalies entries without a disposition — or PARKED while touching
 * the headline (Dunbar's gate) — surface every turn to brain and experiment;
 * an in-file disposition or ANOMALY-ACK clears them.
 *
 * Run:  npx tsx scripts/smoke_anomaly_disposition.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { buildUndispositionedAnomalies, listOpenAnomalies } = await import(join(ROOT, "src/dynamics.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const d = mkdtempSync(join(tmpdir(), "luxas-anom-"));
const run = join(d, "data", "experiments", "E1_blockade", "runs", "run_0");
function write(anomalies: unknown[]) {
	mkdirSync(run, { recursive: true });
	writeFileSync(join(run, "results.json"), JSON.stringify({ computed: { anomalies } }));
}
try {
	mkdirSync(join(d, "notes"), { recursive: true });
	write([
		{ observable: "blockade radius", predicted: "5.1 um", observed: "12 um", affects_headline: true },
		{ observable: "laser linewidth", predicted: "1 kHz", observed: "3 kHz", affects_headline: false, disposition: "parked", reason: "does not enter the headline" },
		{ observable: "C6 sign", predicted: "+", observed: "-", affects_headline: true, disposition: "parked", reason: "will look later" },
		{ observable: "ramp time", predicted: "1 us", observed: "1.1 us", affects_headline: false, disposition: "explained", reason: "AOM rise time" },
	]);
	const b = buildUndispositionedAnomalies(d, "brain");
	check("block surfaces", /<undispositioned_anomalies priority="high">/.test(b), b.slice(0, 120));
	const open = listOpenAnomalies(d);
	check("undispositioned entry is open", open.some((a: any) => a.idx === 0));
	check("parked non-headline entry is closed", !open.some((a: any) => a.idx === 1));
	check("parked HEADLINE entry stays open (Dunbar gate)", open.some((a: any) => a.idx === 2), JSON.stringify(open));
	check("explained entry is closed", !open.some((a: any) => a.idx === 3));
	check("HEADLINE tag and predicted/observed rendered", /\[E1#0\] HEADLINE blockade radius: predicted 5\.1 um, observed 12 um/.test(b), b);
	check("brain audience names ANOMALY-ACK", /ANOMALY-ACK: <EID>#<idx>/.test(b));
	const x = buildUndispositionedAnomalies(d, "experiment");
	check("experiment audience points at results.json disposition, not memory.md", /results\.json/.test(x) && !/ANOMALY-ACK/.test(x));

	writeFileSync(join(d, "notes", "memory.md"),
		"ANOMALY-ACK: E1#0 — pursued: dispatched E4 to measure radius vs n\nANOMALY-ACK: E1#2 — explained: sign convention in the cited table, see literature.md#saffman2010\n");
	check("ANOMALY-ACK clears both", buildUndispositionedAnomalies(d, "brain") === "", buildUndispositionedAnomalies(d, "brain").slice(0, 200));

	rmSync(join(d, "notes", "memory.md"));
	write([{ observable: "blockade radius", predicted: "5.1 um", observed: "12 um", affects_headline: true, disposition: "explained", reason: "n=75 not 60" }]);
	check("in-file disposition clears without an ACK", buildUndispositionedAnomalies(d, "brain") === "");

	write([{ observable: "x", predicted: 1, observed: 2, affects_headline: false, disposition: "whatever" }]);
	check("unknown disposition string counts as open", listOpenAnomalies(d).length === 1);

	const bare = mkdtempSync(join(tmpdir(), "luxas-anom2-"));
	check("no anomalies → empty block", buildUndispositionedAnomalies(bare) === "");
	rmSync(bare, { recursive: true, force: true });
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — surprises get a disposition; headline surprises cannot be parked." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
