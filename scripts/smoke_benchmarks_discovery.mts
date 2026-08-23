/**
 * Smoke test: the A/B benchmark corpus is discoverable by reflect_ab and
 * every bench is well-formed.
 *
 * Until 2026-08-23 benchmarks/ did not exist, so reflect_ab exited 0 on the
 * no-benchmarks branch and every vote was rationale-only — the blinded A/B
 * the loop was designed around had never run. This gate keeps the corpus from
 * silently regressing to that state: an empty benchmarks/, a bench without a
 * RESEARCH.md, or a bench without an oracle all fail here.
 *
 * The runner's cost cap is also pinned: without --max-cost each replicate
 * inherits the $250 production backstop.
 *
 * Run:  npx tsx scripts/smoke_benchmarks_discovery.mts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCH = join(ROOT, "benchmarks");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

check("benchmarks/ exists", existsSync(BENCH));
const benches = existsSync(BENCH)
	? readdirSync(BENCH).filter((d) => statSync(join(BENCH, d)).isDirectory())
	: [];
check("at least 3 benches (enough for a split vote to mean something)", benches.length >= 3, `found ${benches.length}`);

for (const b of benches) {
	const rm = join(BENCH, b, "RESEARCH.md");
	const om = join(BENCH, b, "ORACLE.md");
	check(`${b}: RESEARCH.md present (reflect_ab discovery key)`, existsSync(rm));
	check(`${b}: ORACLE.md present (known answer)`, existsSync(om));
	if (existsSync(rm)) {
		const t = readFileSync(rm, "utf8");
		check(`${b}: RESEARCH.md carries an Original Request block`, /## Original Request/.test(t));
		check(`${b}: request is bounded (mentions short/single/one report)`, /short report|single figure|one figure|one short|Short report/i.test(t));
	}
	if (existsSync(om)) {
		const t = readFileSync(om, "utf8");
		check(`${b}: oracle has a scoring rubric`, /## How to score/.test(t));
		check(`${b}: oracle cites a production source`, /production run/i.test(t));
	}
}

// The exact predicate reflect_ab uses, so this gate and the runner agree.
const discovered = benches.filter((d) => existsSync(join(BENCH, d, "RESEARCH.md")));
check("reflect_ab would discover every bench", discovered.length === benches.length,
	`${discovered.length}/${benches.length}`);

// Cost cap wiring.
const runner = readFileSync(join(ROOT, "scripts/reflect_ab.mts"), "utf8");
check("reflect_ab passes --max-cost to every replicate", /"--max-cost",\s*String\(AB_MAX_COST_USD\)/.test(runner));
const { AB_MAX_COST_USD, AB_REPLICATES } = await import(join(ROOT, "src/meta-agents/state.js"));
const worst = benches.length * AB_REPLICATES * 2 * AB_MAX_COST_USD;
check(`worst-case A/B bill is bounded (${benches.length}×${AB_REPLICATES}×2×$${AB_MAX_COST_USD} = $${worst} ≤ $300)`, worst <= 300);

console.log(failures === 0 ? `\nALL PASS — ${benches.length} benches discoverable, cost-capped.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
