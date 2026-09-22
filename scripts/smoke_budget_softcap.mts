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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// ── The freeze is mechanical, not advisory ────────────────────────────────
// ba-neutral-atom-qc-20260829 read the notice above and kept spawning past
// $144; the hard cap SIGKILLed it mid-`read` at $160.28 with a compiled report
// it never filed. Prose alone did not hold, so the last 10% is now reserved by
// the same allow-list the PI-STOP verdict uses.
const { buildResearchHooks } = await import(join(ROOT, "src/hooks.js"));
const fdir = mkdtempSync(join(tmpdir(), "softcap-hook-"));
mkdirSync(join(fdir, ".agent"), { recursive: true });
// A distinct usage.log per probe: readUsageTotals caches on file SIZE, and
// "50" and "91" are the same width, so rewriting one file in place would hand
// back the first probe's total forever. Production only ever appends.
let probe = 0;
const callFresh = async (total: number, name: string, args: any = {}) => {
	const log = join(fdir, ".agent", `usage-${probe++}.log`);
	writeFileSync(log, `1788000000000\tm\tp\t1\t1\t0\t0\t${total}\n`);
	// Fresh hooks each call: the denial counter is per-run, and these probes
	// are independent runs, not one brain grinding against the freeze.
	const h = buildResearchHooks({ projectDir: fdir, maxCostUsd: 100, usageLogPath: log } as any);
	const r = await h.before({ toolCall: { name }, args });
	return r?.block ? String(r.reason) : "";
};

check("under 90%: a new experiment is allowed", (await callFresh(50, "spawn_agent", { agent: "experiment" })) === "");
check("under 90%: bash is allowed", (await callFresh(50, "bash", { command: "ls" })) === "");

const denied = await callFresh(91, "spawn_agent", { agent: "experiment" });
check("at 90%: a new experiment is REFUSED", denied !== "");
check("the refusal names the freeze and the cap", /finalization/i.test(denied) && /\$100/.test(denied), denied.slice(0, 160));
check("the refusal says what to do instead (compile → finish → disclose)",
	/finish\(\)/.test(denied) && /DISCLOSING/.test(denied), denied.slice(0, 200));
check("at 90%: search is REFUSED", (await callFresh(95, "spawn_agent", { agent: "search" })) !== "");
check("at 90%: bash is REFUSED", (await callFresh(95, "bash", { command: "python3 sweep.py" })) !== "");

check("at 90%: finish() is still allowed", (await callFresh(95, "finish", { summary: "x" })) === "");
check("at 90%: compile_latex is still allowed", (await callFresh(95, "compile_latex", {})) === "");
check("at 90%: edit is still allowed (the report still needs writing)",
	(await callFresh(95, "edit", { path: "report/report.tex" })) === "");
check("at 90%: typesetter/illustrator/contradiction_auditor still spawnable",
	(await callFresh(95, "spawn_agent", { agent: "typesetter" })) === "" &&
	(await callFresh(95, "spawn_agent", { agent: "illustrator" })) === "" &&
	(await callFresh(95, "spawn_agent", { agent: "contradiction_auditor" })) === "");

// Every block must leave a trace: a hook that returns {block:true} skips
// afterToolCall, so before this the freeze was invisible in log.jsonl —
// `grep "PI verdict is STOP"` matched 0 lines across all six runs, two of
// which escalated to an operator *about* that freeze.
const blockLog = readFileSync(join(fdir, ".agent", "log.jsonl"), "utf-8")
	.trim().split("\n").map((l) => JSON.parse(l));
check("each refusal is recorded in .agent/log.jsonl", blockLog.length > 0, `${blockLog.length} entries`);
check("recorded as type tool_block with the tool and reason",
	blockLog.every((e) => e.type === "tool_block" && e.tool && e.reason),
	JSON.stringify(blockLog[0] ?? {}).slice(0, 200));
// Three probes above are refused (experiment, search, bash); the seven
// allowed ones must leave no entry, or the trace stops meaning "refused".
check("only refusals are logged (allowed calls are not)",
	blockLog.length === 3, `${blockLog.length} entries for 3 refused probes`);

rmSync(fdir, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
