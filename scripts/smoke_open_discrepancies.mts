/**
 * Smoke test: <open_discrepancies> (src/context.ts) — the prior check the
 * claims-first design (§3.7) requires before a full claim table is injected
 * into the brain's snapshot. Lists every harness-DISCREPANT cross-validation,
 * ignoring the producer's cross_validation_resolved; deterministic; empty when
 * nothing is disputed.
 *
 * Run:  npx tsx scripts/smoke_open_discrepancies.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "fixtures", "claims-297nm", "raw");
const { buildOpenDiscrepancies } = await import(join(ROOT, "src/context.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const b = buildOpenDiscrepancies(RAW);
check("block present on the 297nm project", /<open_discrepancies priority="high">/.test(b), b.slice(0, 120));
check("lists E5's blockade shift and leakage disputes with both values", /E5 computed\.pair_potential\.v_4um_ghz: -0\.151863/.test(b) && /E5 computed\.master_equation\.leakage_40MHz: 0\.0002555/.test(b) && /0\.001107/.test(b), b);
check("ignores producer cross_validation_resolved", (b.match(/^- E5/gm) ?? []).length === 2);
check("does not list agreeing or wiring entries", !/E6/.test(b) && !/E1/.test(b));
check("names the legal ways to settle a dispute, not a paragraph", /third independent estimate/.test(b) && /not a paragraph/.test(b));
check("deterministic over equal state", b === buildOpenDiscrepancies(RAW));

const d = mkdtempSync(join(tmpdir(), "luxas-od-"));
try {
	const run = join(d, "data/experiments/E1_x/runs/run_0");
	mkdirSync(run, { recursive: true });
	writeFileSync(join(run, "results.json"), JSON.stringify({ computed: { cross_validation: [{ claim_key: "computed.a", method_a: "x", method_b: "y", value_a: 1.0, value_b: 1.05, tolerance_rel: 0.1 }] } }));
	check("no disputes → empty block", buildOpenDiscrepancies(d) === "");
	writeFileSync(join(run, "results.json"), "{not json");
	check("unparseable results.json is a MALFORMED line, not silence", /unparseable/.test(buildOpenDiscrepancies(d)));
} finally {
	rmSync(d, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — disputes reach the brain as state." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
