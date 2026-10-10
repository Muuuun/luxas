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
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { SOFT_CAP_FRACTION, finalizationAllows, finalizationDenyText } = await import(join(ROOT, "src/hooks.js"));
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
// C5: the notice and the hook must agree. reader is admitted through
// prior_art_auditor's closure, so the notice may not list readers as refused.
check("C5: does not call readers refused while the hook admits them",
	!(/\breaders?\b/.test(block) && finalizationAllows("spawn_agent", "reader", false)));

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
// C5: finish check 1d names report_writer and the compile_latex footer names
// fixer; idle is how the brain waits for either without paying for turns.
check("C5: at 90%: report_writer is still spawnable",
	(await callFresh(95, "spawn_agent", { agent: "report_writer" })) === "");
check("C5: at 90%: fixer is still spawnable",
	(await callFresh(95, "spawn_agent", { agent: "fixer" })) === "");
check("C5: at 90%: idle is still allowed", (await callFresh(95, "idle", {})) === "");

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
// Three probes above are refused (experiment, search, bash); every allowed
// one must leave no entry, or the trace stops meaning "refused".
check("only refusals are logged (allowed calls are not)",
	blockLog.length === 3, `${blockLog.length} entries for 3 refused probes`);

// ── C4: the cost freeze has no dispute hatch ──────────────────────────────
// The PI-STOP hatch admits experiment (and its tool_impl/tool_review) while a
// headline row is DISPUTED/CONDITIONAL. Under the cost trigger that hatch let
// a brand-new experiment start with <10% of the cap left, which cannot finish
// in what remains. Its own copy of the ppss fixture, so the log count above
// is untouched; its own usage log per probe for the same size-cache reason.
const { buildClaimTable } = await import(join(ROOT, "src/claims-table.js"));
const { cosmeticSpawnNotice } = await import(join(ROOT, "src/claims-review.js"));
const ddir = mkdtempSync(join(tmpdir(), "softcap-disputed-"));
cpSync(join(ROOT, "fixtures/claims-ppss"), ddir, { recursive: true });
mkdirSync(join(ddir, ".agent"), { recursive: true });
const callIn = async (total: number, name: string, args: any = {}, initialState?: any) => {
	const log = join(ddir, ".agent", `usage-${probe++}.log`);
	writeFileSync(log, `1788000000000\tm\tp\t1\t1\t0\t0\t${total}\n`);
	const h = buildResearchHooks({ projectDir: ddir, maxCostUsd: 100, usageLogPath: log, initialState } as any);
	const r = await h.before({ toolCall: { name }, args });
	return r?.block ? String(r.reason) : "";
};
const listed = (t: string) => (t.match(/spawn_agent for ([a-z_/]+)\)/) ?? [])[1]?.split("/") ?? [];
const SETTLERS = ["experiment", "tool_impl", "tool_review", "math"];

check("C4: guard: fixture has a DISPUTED/CONDITIONAL headline row",
	buildClaimTable(ddir).rows.some((r: any) => r.headline && (r.status === "disputed" || r.status === "conditional")));
const fg = await callIn(95, "spawn_agent", { agent: "experiment" });
check("C4: 95% + disputed: experiment REFUSED (foreground)", fg !== "");
check("C4: 95% + disputed: experiment REFUSED (background)",
	(await callIn(95, "spawn_agent", { agent: "experiment", background: true })) !== "");
check("C4: 95% + disputed: math REFUSED (only the hatch admitted it)",
	(await callIn(95, "spawn_agent", { agent: "math" })) !== "");
const costRefusals = [
	["experiment", fg],
	["search", await callIn(95, "spawn_agent", { agent: "search" })],
	["bash", await callIn(95, "bash", { command: "python3 x.py" })],
] as const;
for (const [lbl, t] of costRefusals) {
	check(`C4: cost refusal (${lbl}): allowed list omits ${SETTLERS.join("/")}`,
		t !== "" && listed(t).length > 0 && !listed(t).some((a) => SETTLERS.includes(a)), listed(t).join("/"));
	check(`C4: cost refusal (${lbl}): never says settling work / settling agents are open`,
		!/settling work .* is open|settling agents open automatically/.test(t));
	check(`C4: cost refusal (${lbl}): names abstention and CLAIM-DISCLOSE`,
		/abstain/i.test(t) && /CLAIM-DISCLOSE/.test(t), t.slice(0, 200));
}
check("C4: 95% + disputed: replicator ALLOWED", (await callIn(95, "spawn_agent", { agent: "replicator" })) === "");
check("C4: 95% + disputed: finish/compile_latex/edit ALLOWED",
	(await callIn(95, "finish", {})) === "" && (await callIn(95, "compile_latex", {})) === "" &&
	(await callIn(95, "edit", { path: "report/report.tex" })) === "");
// The PI-STOP hatch is unchanged: a STOP with budget left can still settle.
check("C4: PI STOP at $10 keeps the hatch: experiment ALLOWED",
	(await callIn(10, "spawn_agent", { agent: "experiment" }, { piStopped: true })) === "");
check("C4: PI STOP at $10: search refused",
	(await callIn(10, "spawn_agent", { agent: "search" }, { piStopped: true })) !== "");
check("C4: PI STOP + 95%: experiment REFUSED",
	(await callIn(95, "spawn_agent", { agent: "experiment" }, { piStopped: true })) !== "");

// ── F6: a PI STOP past 90% tells the truth about the cost freeze ──────────
// The PI branch runs before the cost branch. With a DISPUTED row it answered
// every refused call with "settling work (replicator / experiment …) is open",
// and the experiment it pointed at was then refused by the cost branch — on
// every PI-refused spawn, not once. Below 90% the hatch is real and so is its text.
const STOP = { piStopped: true };
const HATCH_PROMISE = /settling work .* is open|settling agents open automatically/;
for (const [lbl, name, args] of [
	["spawn_agent(search)", "spawn_agent", { agent: "search" }],
	["bash", "bash", { command: "python3 x.py" }],
] as const) {
	const t = await callIn(95, name, args, STOP);
	check(`F6: PI STOP + 95% + disputed: ${lbl} refusal names the cost freeze`,
		/^PI verdict is STOP\./.test(t) && /No new experiment starts/.test(t), t.slice(0, 240));
	check(`F6: PI STOP + 95% + disputed: ${lbl} refusal promises no settling hatch`,
		t !== "" && !HATCH_PROMISE.test(t) && !listed(t).some((a) => SETTLERS.includes(a)), listed(t).join("/"));
}
// The cost branch still owns the experiment refusal, so the 10-denial stop
// still counts a brain retrying it (one hooks instance, exit trapped).
{
	const log = join(ddir, ".agent", `usage-${probe++}.log`);
	writeFileSync(log, `1788000000000\tm\tp\t1\t1\t0\t0\t95\n`);
	const h = buildResearchHooks({ projectDir: ddir, maxCostUsd: 100, usageLogPath: log, initialState: STOP } as any);
	const realExit = process.exit, realErr = console.error;
	let exitedAt = 0;
	(process as any).exit = (c: number) => { throw new Error(`EXIT ${c}`); };
	console.error = () => {};
	try {
		for (let i = 1; i <= 12 && !exitedAt; i++) {
			try { await h.before({ toolCall: { name: "spawn_agent" }, args: { agent: "experiment" } }); }
			catch (e: any) { if (/^EXIT /.test(e.message)) exitedAt = i; else throw e; }
		}
	} finally { (process as any).exit = realExit; console.error = realErr; }
	check("F6: PI STOP + 95%: experiment retries still end at the 10-denial stop (call 11)", exitedAt === 11, `exited at ${exitedAt || "never"}`);
}
const lowSearch = await callIn(50, "spawn_agent", { agent: "search" }, STOP);
check("F6: PI STOP at 50% + disputed: search refusal keeps the hatch text",
	lowSearch === `PI verdict is STOP. ${finalizationDenyText("spawn_agent", "search", true)}` && /settling work .* is open/.test(lowSearch),
	lowSearch.slice(0, 240));
const lowBash = await callIn(50, "bash", { command: "python3 x.py" }, STOP);
check("F6: PI STOP at 50% + disputed: bash refusal keeps its text",
	lowBash === `PI verdict is STOP. ${finalizationDenyText("bash", "", false)}` && /settling agents open automatically/.test(lowBash),
	lowBash.slice(0, 240));

// The cosmetic speed bump must not advise the move the hook now refuses.
writeFileSync(join(ddir, ".agent", "run_config.json"), JSON.stringify({ maxCost: 100 }));
writeFileSync(join(ddir, ".agent", "usage.log"), `1788000000000\tm\tp\t1\t1\t0\t0\t95\n`);
delete process.env.LUXAS_COSMETIC_WHILE_DISPUTED;
const nHigh = cosmeticSpawnNotice(ddir, "illustrator").notice;
check("C4: cosmetic notice at 95%: still shown (ship line)", nHigh.includes("[claim gate]"));
check("C4: cosmetic notice at 95%: does not advise a DISCRIMINATOR experiment",
	!/DISCRIMINATOR as an experiment/.test(nHigh), nHigh.slice(0, 300));
check("C4: cosmetic notice at 95%: names CLAIM-DISCLOSE and abstention",
	/CLAIM-DISCLOSE/.test(nHigh) && /abstain/i.test(nHigh), nHigh.slice(0, 300));
// "50.0", not "50": readUsageTotals caches on size, and "50" is as wide as "95".
writeFileSync(join(ddir, ".agent", "usage.log"), `1788000000000\tm\tp\t1\t1\t0\t0\t50.0\n`);
const nLow = cosmeticSpawnNotice(ddir, "illustrator").notice;
check("C4: cosmetic notice at 50%: still advises the DISCRIMINATOR experiment",
	/DISCRIMINATOR as an experiment/.test(nLow), nLow.slice(0, 200));

const brainMd = readFileSync(join(ROOT, "src/agents/definitions/brain.md"), "utf-8");
const dispatch = brainMd.slice(brainMd.indexOf("<claim_status_dispatch>"), brainMd.indexOf("</claim_status_dispatch>"));
const item1 = (dispatch.match(/^1\..*$/m) ?? [""])[0];
check("C4: brain.md dispatch item 1 names the <budget_status> exception", /budget_status/.test(item1), item1.slice(0, 160));
rmSync(ddir, { recursive: true, force: true });

// ── C4b: the review loop starts no new experiment run past 90% either ─────
// The hook above sits between the BRAIN's tool calls only. An experiment
// launched before the line that delivers after it comes back through
// runExperimentReviewLoop, which spawns its revision and not-delivered re-runs
// directly: at $95/$100 it started two fresh experiments the hook refuses, and
// in the foreground the hard cap then kills the brain mid-revision, no finish().
// The cap is the one that kills the process (setCostCap); none set = no freeze.
// Each case gets its own project, so its usage.log never hits the size cache.
const { runExperimentReviewLoop } = await import(join(ROOT, "src/tools/spawn-agent.js"));
const usageLog = await import(join(ROOT, "src/usage-log.js"));
process.env.LUXAS_BLIND_ESTIMATE = "0";
process.env.LUXAS_REVIEW_IMAGES = "0";
delete process.env.LUXAS_MAX_REVIEW_ITERATIONS;
const LOOP_EID = "E3_late";
const FLAW = "the gate error omits the Doppler term entirely and must be recomputed with it.";
const reviewAt = async (spent: number, cap: number | undefined, delivered = true) => {
	const p = mkdtempSync(join(tmpdir(), "softcap-loop-"));
	mkdirSync(join(p, ".agent"), { recursive: true });
	mkdirSync(join(p, "data/experiments", LOOP_EID, "runs/run_1"), { recursive: true });
	if (delivered) writeFileSync(join(p, "data/experiments", LOOP_EID, "runs/run_1/results.json"), "{\"computed\":{}}");
	const log = join(p, ".agent", "usage.log");
	writeFileSync(log, `1788000000000\tm\tp\t1\t1\t0\t0\t${spent}\n`);
	usageLog.setCostCap(log, cap);
	const calls: string[] = [];
	const stub = async (o: any) => {
		calls.push(o.name);
		const base = { elapsed: 1, success: true, agentId: `${o.name}-x`, exit: { stopReason: "stop", filesTouched: [], elapsedMs: 1, toolCallCount: 0, endedAt: "" } };
		if (o.name === "experiment_reviewer") return { ...base, output: `VERDICT: revise\nFEEDBACK:\n- Issue 1: ${FLAW}` };
		return { ...base, output: "revised run" };
	};
	try {
		const out: any = await runExperimentReviewLoop({ output: "delivered", success: true }, {
			projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: LOOP_EID, PROJECT_DIR: p },
			baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: LOOP_EID }, projectDir: p, getApiKey: () => undefined },
			initialTask: "run E3", getApiKey: () => undefined, parentAgentId: "brain", depth: 0, makeSpawnTool: () => null, spawn: stub,
		});
		let r1 = "";
		try { r1 = readFileSync(join(p, "reviews", `experiment_review_${LOOP_EID}_r1.md`), "utf-8"); } catch { /* checked below */ }
		return { calls, out, r1 };
	} finally {
		usageLog.setCostCap(log, undefined);
		rmSync(p, { recursive: true, force: true });
	}
};
const experiments = (calls: string[]) => calls.filter((c) => c === "experiment").length;

const hi = await reviewAt(95, 100);
check("C4b: REVISE at $95/$100: no revision experiment starts", experiments(hi.calls) === 0, hi.calls.join(", "));
check("C4b: REVISE at $95/$100: the reviewer round itself still runs (landing work)",
	hi.calls.length === 1 && hi.calls[0] === "experiment_reviewer", hi.calls.join(", "));
check("C4b: REVISE at $95/$100: the output names the freeze and ledger_writer",
	/round 1: REVISE — not re-run: past the 90% cost freeze; disclose or answer the open issues via ledger_writer/.test(hi.out.output),
	JSON.stringify(hi.out.output.slice(-240)));
check("C4b: REVISE at $95/$100: the outstanding feedback travels with it",
	/Outstanding reviewer feedback:\n- Issue 1: the gate error omits the Doppler term/.test(hi.out.output) && hi.out.success === true);
check("C4b: REVISE at $95/$100: the review is persisted with its FEEDBACK (what the finish gate reads)",
	/VERDICT: revise/.test(hi.r1) && hi.r1.includes(FLAW), hi.r1.slice(0, 200));
check("C4b: the ledger_writer the note names is spawnable at 95%",
	(await callFresh(95, "spawn_agent", { agent: "ledger_writer" })) === "");

const lo = await reviewAt(50.0, 100);
check("C4b: REVISE at $50/$100: revisions still re-run (below the line nothing changes)",
	lo.calls.join(", ") === "experiment_reviewer, experiment, experiment_reviewer, experiment, experiment_reviewer", lo.calls.join(", "));
check("C4b: REVISE at $50/$100: ends at the iteration cap, no freeze note",
	/iteration cap reached/.test(lo.out.output) && !/cost freeze/.test(lo.out.output));

const uncapped = await reviewAt(95, undefined);
check("C4b: no cap registered → no freeze (stub gates unaffected)", experiments(uncapped.calls) === 2, uncapped.calls.join(", "));

const nd = await reviewAt(95, 100, false);
check("C4b: not delivered at $95/$100: not re-sent, nothing spawned", nd.calls.length === 0, nd.calls.join(", "));
check("C4b: not delivered at $95/$100: says so and names the freeze",
	/NOT DELIVERED — not re-sent: past the 90% cost freeze/.test(nd.out.output), JSON.stringify(nd.out.output.slice(-240)));
const ndLo = await reviewAt(50.0, 100, false);
check("C4b: not delivered at $50/$100: still re-sent once", experiments(ndLo.calls) === 1 && /returned twice/.test(ndLo.out.output), ndLo.calls.join(", "));

// One predicate, the hook's line: >= cap × SOFT_CAP_FRACTION, on the cap that kills.
const { softCapReached } = usageLog;
check("C4b: usage-log exports softCapReached", typeof softCapReached === "function");
if (typeof softCapReached === "function") {
	const pdir = mkdtempSync(join(tmpdir(), "softcap-pred-"));
	const at = (spent: string, cap: number | undefined) => {
		const log = join(pdir, `usage-${probe++}.log`);
		writeFileSync(log, `1788000000000\tm\tp\t1\t1\t0\t0\t${spent}\n`);
		usageLog.setCostCap(log, cap);
		try { return softCapReached(log, SOFT_CAP_FRACTION); } finally { usageLog.setCostCap(log, undefined); }
	};
	check("C4b: predicate: no cap → false at any spend", at("1000", undefined) === false);
	check("C4b: predicate: $89.99/$100 → false", at("89.99", 100) === false);
	check("C4b: predicate: $90/$100 → true (the hook's >=)", at("90", 100) === true);
	check("C4b: hooks.ts and usage-log.ts share one SOFT_CAP_FRACTION", usageLog.SOFT_CAP_FRACTION === SOFT_CAP_FRACTION && SOFT_CAP_FRACTION === 0.9);
	rmSync(pdir, { recursive: true, force: true });
}

rmSync(fdir, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
