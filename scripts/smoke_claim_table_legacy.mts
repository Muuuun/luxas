/**
 * Smoke test: legacy projects (no computed.quantities[]) are grandfathered —
 * the claim table is empty, renders nothing, raises no claim-status issue,
 * and never throws (fixtures/claims-297nm/raw is the real project as shipped).
 *
 * Run:  npx tsx scripts/smoke_claim_table_legacy.mts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "fixtures", "claims-297nm", "raw");
const { buildClaimTable, claimTableIssues, renderClaimTable } = await import(join(ROOT, "src/claims-table.js"));
const { reportIntegrityIssues } = await import(join(ROOT, "src/tools/report-integrity.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const t = buildClaimTable(RAW);
check("raw project: no declarations", t.declared === false);
check("raw project: no rows, no malformed, no reads-drops", t.rows.length === 0 && t.malformed.length === 0 && t.readsDrops.length === 0);
check("raw project: no claim-status gate issues", claimTableIssues(RAW, t).length === 0);
check("raw project: renders nothing", renderClaimTable(t) === "");
const kinds = reportIntegrityIssues(RAW).filter((i: any) => i.kind === "claim-status");
check("reportIntegrityIssues emits no claim-status issue for a legacy project", kinds.length === 0, kinds.map((i: any) => i.text.slice(0, 80)).join(" | "));

const bare = mkdtempSync(join(tmpdir(), "luxas-ct-empty-"));
try {
	const t2 = buildClaimTable(bare);
	check("empty project: declared=false, nothing rendered, no throw", t2.declared === false && renderClaimTable(t2) === "" && claimTableIssues(bare, t2).length === 0);
} finally {
	rmSync(bare, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS — legacy projects are grandfathered." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
