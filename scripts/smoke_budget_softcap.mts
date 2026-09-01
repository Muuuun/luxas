/**
 * Gate: the soft cost cap warns the brain, and does so through a channel that
 * does not contradict itself.
 *
 * Regressions under test:
 *  - ba-neutral-atom-qc, 2026-08-31: the hard cap is a SIGKILL, so the run
 *    died twice mid-PI-review ($150.30/$150, $160.28/$160) holding a compiled,
 *    substantively approved report it never filed.
 *  - review finding 1: delivering this through notes/directives/ wrapped it in
 *    `<user_directive>`, whose preamble forbids calling finish() until every
 *    clause is addressed in report.tex or a new experiment — the two things a
 *    budget notice tells the brain NOT to do.
 *  - review finding 2: a persisted notice survives into a resume with a much
 *    higher cap and demands wrap-up from turn 1.
 *
 * Run:  npx tsx scripts/smoke_budget_softcap.mts
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { SOFT_CAP_FRACTION } = await import(join(ROOT, "src/hooks.js"));
const { buildBudgetStatus, collectActiveDirectives } = await import(join(ROOT, "src/context.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

check("soft cap fires below the hard cap", SOFT_CAP_FRACTION > 0 && SOFT_CAP_FRACTION < 1);

const dir = mkdtempSync(join(tmpdir(), "softcap-"));
mkdirSync(join(dir, ".agent"), { recursive: true });
const setCap = (c: number | null) => writeFileSync(join(dir, ".agent", "run_config.json"), JSON.stringify({ maxCost: c }));
// usage.log columns: ts, model, provider, in, out, cacheR, cacheW, cost
const setSpend = (rows: number[]) => writeFileSync(join(dir, ".agent", "usage.log"),
	rows.map((c) => `1788000000000\tm\tp\t1\t1\t0\t0\t${c}`).join("\n") + "\n");

setCap(150); setSpend([50, 30]);
check("well under the cap → no block at all", buildBudgetStatus(dir) === "", buildBudgetStatus(dir).slice(0, 80));

setSpend([100, 35]); // $135 = 90% of 150
const block = buildBudgetStatus(dir);
check("at 90% of cap → block appears", /<budget_status/.test(block));
check("names the cap", /\$150/.test(block));
check("says the hard cap kills the process", /SIGKILL/.test(block));
check("orders notes → compile → finish", block.indexOf("notes/experiments.md") < block.indexOf("finish()"));
check("tells it to disclose rather than polish", /DISCLOSING/.test(block) && /no new experiments/.test(block));
check("tells it not to iterate against a blocking gate", /do not iterate against it/.test(block));

// Cache equality: the text must not carry live spend, or it changes every turn.
setSpend([100, 36]);
check("block is byte-identical as spend moves (L3 cache equality)", buildBudgetStatus(dir) === block);
check("carries no live spend figure", !/\$135/.test(block) && !/\$136/.test(block));

// Finding 1: it must NOT travel through the directive channel.
check("writes nothing into notes/directives/", collectActiveDirectives(dir, undefined).length === 0);

// Finding 2: raising the cap on resume must silence it immediately, with no
// stale artifact left behind to contradict the new budget.
setCap(300);
check("resume with a much higher cap → silent again (no stale notice)", buildBudgetStatus(dir) === "", buildBudgetStatus(dir).slice(0, 80));
setSpend([100, 100, 80]); // $280 ≥ 90% of 300
check("and speaks again at 90% of the NEW cap, naming it", /\$300/.test(buildBudgetStatus(dir)));

// Degenerate configs must be silent, never throw.
let threw = false;
try {
	setCap(null); check("no cap configured → silent", buildBudgetStatus(dir) === "");
	rmSync(join(dir, ".agent", "run_config.json"));
	check("missing run_config → silent", buildBudgetStatus(dir) === "");
	check("missing project → silent", buildBudgetStatus(join(dir, "nope")) === "");
} catch { threw = true; }
check("never throws into the context path", !threw);

rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
