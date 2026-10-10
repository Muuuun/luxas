/**
 * Smoke test: byte-stable compaction views (cache-debate verdict 2026-08-26).
 *
 * Live usage.log on the 297nm run showed ~144K cache-miss tokens per turn
 * with the hit stuck at 132K: both the overflow backstop and the tool-pruner
 * re-derived their mutation decisions from the growing total every call, so
 * the bytes of already-mutated mid-history messages shifted every turn and
 * the provider prefix cache was invalidated from the first changed byte.
 *
 *   A  Backstop pinning: once a message is truncated at cap C (or its
 *      thinking stripped), replays are byte-identical on later calls with a
 *      grown history; new pressure lands only on unpinned messages.
 *   B  Ledger reset: a rebuilt (shrunk) array clears the pins.
 *   C  Pruner ratchet: the prune boundary advances only in batches, so
 *      between advances the pruned view is byte-identical across calls.
 *   D  Trimming latch: once trimming starts it stays on, so the request does
 *      not alternate between the trimmed and the full history.
 *   S  Snip leaves the head: the task (or carry-forward note) and everything
 *      before the first tool result are never replaced by the placeholder.
 *   C77 DeepSeek sub-agents start trimming at 400K; every other provider and
 *      the default plan stay at 160K.
 *
 * Run:  npx tsx scripts/smoke_compaction_ratchet.mts
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { applyOverflowBackstop, createBackstopLedger } =
	await import(join(ROOT, "src/compaction/overflow-backstop.js"));
const { pruneHistoricToolOutputs } = await import(join(ROOT, "src/compaction/tool-pruner.js"));
const { createBlockConversationAdapter } = await import(join(ROOT, "src/compaction/adapter.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const big = (n: number, ch = "x") => ch.repeat(n);
const model: any = { contextWindow: 1_048_576, maxTokens: 393_216 };

// ── A: backstop pinning ──────────────────────────────────────
{
	const mk = (n: number) => [
		{ id: "u0", role: "user", content: "goal" },
		...Array.from({ length: n }, (_, k) => [
			{ id: `a${k}`, role: "assistant", content: [
				{ type: "thinking", thinking: big(60_000), thinkingSignature: "s" },
				{ type: "text", text: `turn ${k}` },
			] },
			{ id: `t${k}`, role: "toolResult", content: [{ type: "text", text: `out${k} ` + big(120_000) }] },
		]).flat(),
	];
	const ledger = createBackstopLedger();
	const r1 = applyOverflowBackstop(mk(20), model, ledger);
	check("A1: first call bounds the history", r1.active === true);
	// SNAPSHOT the pins as of call 1 — only those carry the stability promise.
	const pinnedAfter1 = new Set([...ledger.caps.keys(), ...ledger.strippedThinking]);
	// Grow the history (append-only, modest growth so no pass-4 escalation)
	// and re-apply with the same ledger.
	const r2 = applyOverflowBackstop(mk(22), model, ledger);
	const byId = (arr: any[]) => new Map(arr.map((m: any) => [m.id, JSON.stringify(m)]));
	const m1 = byId(r1.messages), m2 = byId(r2.messages);
	const unstable = [...pinnedAfter1].filter((id) => m1.has(id) && m2.has(id) && m1.get(id) !== m2.get(id));
	check("A2: call-1 pins replay byte-identical on the grown history",
		unstable.length === 0 && pinnedAfter1.size > 0,
		`unstable: ${unstable.slice(0, 5).join(",")} of ${pinnedAfter1.size} pins`);
	const total = (arr: any[]) => arr.reduce((s: number, m: any) => s + JSON.stringify(m?.content ?? "").length, 0);
	const budget = Math.floor((1_048_576 - 393_216) * 0.75 * 2.6);
	check("A3: both calls fit the reserve-aware budget",
		total(r1.messages) <= budget && total(r2.messages) <= budget,
		`t1=${total(r1.messages)} t2=${total(r2.messages)} budget=${budget}`);
	// Pathological growth: budget unreachable on permanent pins alone — the
	// pass-4 safety valve must fire and the result must STILL fit.
	const r3 = applyOverflowBackstop(mk(60), model, ledger);
	check("A4: pass-4 safety valve keeps extreme growth under budget",
		total(r3.messages) <= budget, `t3=${total(r3.messages)} budget=${budget}`);
}

// ── B: ledger reset on rebuilt array ─────────────────────────
{
	const ledger = createBackstopLedger();
	const bigHist = [
		{ id: "u0", role: "user", content: "goal" },
		...Array.from({ length: 30 }, (_, k) =>
			({ id: `t${k}`, role: "toolResult", content: [{ type: "text", text: big(120_000) }] })),
	];
	applyOverflowBackstop(bigHist, model, ledger);
	check("B1: pins recorded on the big history", ledger.caps.size > 0);
	const rebuilt = [
		{ id: "summary", role: "user", content: "[condensed summary]" },
		{ id: "t29", role: "toolResult", content: [{ type: "text", text: "small tail" }] },
	];
	const r = applyOverflowBackstop(rebuilt, model, ledger);
	check("B2: shrunk/rebuilt array clears the ledger and passes through",
		ledger.caps.size === 0 && JSON.stringify(r.messages) === JSON.stringify(rebuilt));
}

// ── C: pruner ratchet ────────────────────────────────────────
{
	const adapter = createBlockConversationAdapter();
	const mkHist = (outs: number) => Array.from({ length: outs }, (_, k) => [
		{ role: "assistant", content: [{ type: "toolCall", id: `c${k}`, name: "bash", arguments: {} }] },
		{ role: "toolResult", toolCallId: `c${k}`, toolName: "bash",
		  content: [{ type: "text", text: `result ${k} ` + big(3_000) }] },
	]).flat();
	const ratchet = { floor: 0, batch: 8 };
	const r1 = pruneHistoricToolOutputs(mkHist(25), adapter, { ratchet });
	check("C1: first call advances the ratchet (target 15 ≥ 0+8)",
		ratchet.floor === 15 && r1.modified === true, `floor=${ratchet.floor}`);
	// Grow by 3 outcomes: sliding target 18 < 15+8 → boundary must NOT move.
	const r2 = pruneHistoricToolOutputs(mkHist(28), adapter, { ratchet });
	check("C2: small growth does not move the boundary", ratchet.floor === 15);
	const prunedIds = (r: any) => r.messages
		.map((m: any, i: number) => ({ m, i }))
		.filter(({ m }: any) => m.role === "toolResult" && JSON.stringify(m).includes("cleared to reduce"))
		.map(({ i }: any) => i);
	check("C3: same messages pruned in both calls (byte-stable view)",
		JSON.stringify(prunedIds(r1)) === JSON.stringify(prunedIds(r2)),
		`r1=${prunedIds(r1).length} r2=${prunedIds(r2).length}`);
	// Grow to 25+? sliding target 23 ≥ 15+8 → boundary advances in one batch.
	pruneHistoricToolOutputs(mkHist(33), adapter, { ratchet });
	check("C4: batch growth advances the boundary once", ratchet.floor === 23, `floor=${ratchet.floor}`);
	// Legacy behavior without ratchet: sliding boundary, still works.
	const rLegacy = pruneHistoricToolOutputs(mkHist(25), adapter, {});
	check("C5: legacy sliding window unchanged without ratchet", rLegacy.modified === true);
}

// ── D: trimming does not flap with the token tap's feedback ──
// The engine is told the size of the LAST REQUEST. The last request was the
// trimmed view, so a stateless "trim when over the warning line" decision
// alternates: trimmed, full, trimmed, full — two contexts on alternate calls,
// each one re-writing the other's prompt cache (Dy run, 2026-10-06: three Opus
// experiment agents wrote 540-630K cache tokens each this way).
{
	const { ContextPacker } = await import(join(ROOT, "src/compaction/engine.js"));
	const hist = (n: number) => [
		{ role: "user", content: [{ type: "text", text: "goal" }], timestamp: 1 },
		...Array.from({ length: n }, (_, k) => [
			{ role: "assistant", content: [{ type: "toolCall", id: `c${k}`, name: "bash", arguments: { command: `step ${k}` } }], timestamp: 1 },
			{ role: "toolResult", toolCallId: `c${k}`, toolName: "bash", content: [{ type: "text", text: `out${k} ` + big(20_000) }], isError: false, timestamp: 1 },
		]).flat(),
	];
	const tokens = (msgs: any[]) => Math.ceil(JSON.stringify(msgs).length / 4);
	const packer = new ContextPacker({ adapter: createBlockConversationAdapter(), thresholds: { windowLimit: 1_048_576 } } as any);
	const modes: string[] = [], heads: string[] = [], sizes: number[] = [];
	let prev: any[] | null = null;
	for (let step = 0; step < 12; step++) {
		const msgs = hist(40 + step);                       // the agent's stored history: always the full one
		const out = await packer.runCycle({ messages: msgs, usageTokens: tokens(prev ?? msgs) });
		modes.push(out.mode); heads.push(JSON.stringify(out.messages.slice(0, 21))); sizes.push(tokens(out.messages));
		prev = out.messages;
	}
	check("D1: the fixture crosses the warning line and trims", modes[0] === "trimmed" && sizes[0] < 160_000, `mode=${modes[0]} size=${sizes[0]}`);
	check("D2: the trimmed request alone reads as 'no pressure' (so a stateless rule would stop trimming)", sizes[0] < 160_000 * 0.85);
	check("D3: trimming stays on for every later call", modes.every((m) => m === "trimmed"), modes.join(","));
	check("D4: the request size never jumps back to the full history", Math.max(...sizes) < 160_000, `max ${Math.max(...sizes)}`);
	check("D5: the old part of the context is the same bytes on consecutive calls (at most one ratchet advance in 12 steps)", new Set(heads).size <= 2, `${new Set(heads).size} distinct versions`);
}

// ── S: snip leaves the head (C16) ────────────────────────────
// The first user message is the task (after a condense, the carry-forward
// note), and what precedes the first tool result was handed to the agent, not
// written by it. Snip replaced the brief with its placeholder on Dy solo agents
// (2026-10-06, 10 requests) and changed the bytes in front of every later turn.
{
	const { snipHistoricText } = await import(join(ROOT, "src/compaction/snip.js"));
	const { ContextPacker } = await import(join(ROOT, "src/compaction/engine.js"));
	const adapter = createBlockConversationAdapter();
	const TASK = "TASK-SENTINEL. Compute the 626 nm nuclear-spin flip probability per photon. " + big(2_200, "t");
	const sys = { role: "system", content: "SYSTEM PROMPT " + big(5_000, "s"), timestamp: 1 };
	const task = { role: "user", content: [{ type: "text", text: TASK }], timestamp: 2 };
	const round = (k: number) => [
		{ role: "assistant", content: [
			{ type: "thinking", thinking: big(4_000, "r"), thinkingSignature: "sig" },
			{ type: "toolCall", id: `c${k}`, name: "bash", arguments: { command: `step ${k}` } },
		], timestamp: 3 + k },
		{ role: "toolResult", toolCallId: `c${k}`, toolName: "bash", content: [{ type: "text", text: `out${k} ` + big(20_000) }], isError: false, timestamp: 3 + k },
	];
	const rounds = (n: number, from = 0) => Array.from({ length: n }, (_, k) => round(from + k)).flat();
	const hist = (n: number) => [sys, task, ...rounds(n)];
	const taskText = (msgs: any[]) => msgs.find((m: any) => m.role === "user")?.content?.[0]?.text;

	for (const n of [14, 17, 20]) {
		const out = snipHistoricText(hist(n), adapter);
		check(`S1 n=${n}: the task is byte-identical after snipHistoricText`,
			JSON.stringify(out.messages[1]) === JSON.stringify(task),
			`task now: ${String(taskText(out.messages)).slice(0, 70)}… modified=${out.modified}`);
	}

	const packer = new ContextPacker({ adapter, thresholds: { windowLimit: 1_048_576 } } as any);
	const cycled = await packer.runCycle({ messages: hist(14), usageTokens: 170_000 });
	check("S2: through runCycle (14 rounds, 170K tokens, 1M window) the task survives",
		taskText(cycled.messages) === TASK, `mode=${cycled.mode} task now: ${String(taskText(cycled.messages)).slice(0, 70)}…`);

	// Control: long text the agent was given later is still history.
	const followUp = { role: "user", content: [{ type: "text", text: "FOLLOWUP " + big(2_000, "f") }], timestamp: 50 };
	const withFollowUp = [sys, task, ...round(0), followUp, ...rounds(10, 1)];
	const snippedFollowUp = snipHistoricText(withFollowUp, adapter).messages[withFollowUp.indexOf(followUp)];
	check("S3 control: a long user message after the first tool result, outside the last 12, is still snipped",
		snippedFollowUp !== followUp && !JSON.stringify(snippedFollowUp).includes("FOLLOWUP"));

	const note = { role: "user", content: [{ type: "text", text: "<carryforward_note>\n" + big(3_000, "n") + "\n</carryforward_note>" }], timestamp: 1 };
	const preamble = { role: "assistant", content: [{ type: "text", text: "I have reviewed the carried-forward state and will continue from the latest preserved context." }], timestamp: 1 };
	const attachment = { role: "user", content: [{ type: "text", text: "<attachment path=\"notes/plan.md\">" + big(4_000, "p") + "</attachment>" }], timestamp: 1 };
	const condensed = snipHistoricText([sys, note, preamble, attachment, ...rounds(14)], adapter).messages;
	check("S4 post-condense: the carry-forward note is unchanged", condensed[1] === note, String(adapter.getPlainText(condensed[1])).slice(0, 60));
	check("S4 post-condense: an attachment before the first tool result is unchanged", condensed[3] === attachment, String(adapter.getPlainText(condensed[3])).slice(0, 60));
}

// ── C77: DeepSeek sub-agents trim at 400K, not 160K ──────────
// DeepSeek bills nothing for cache writes, so every trim that moves the prefix
// re-bills the whole context at the uncached price. The C77 replay of the Dy
// transcripts measured DeepSeek E1 orchestrators 20% cheaper with the trim line
// at 400K; the Opus solo agents and the brain measured cheaper at 160K.
{
	const { buildWindowPlan } = await import(join(ROOT, "src/compaction/thresholds.js"));
	// Through the namespace, so a missing export is a counted failure, not an import crash.
	const spawn: any = await import(join(ROOT, "src/agents/spawn.js"));

	const base = buildWindowPlan({ windowLimit: 1_000_000 });
	check("C77a: the default plan on a 1M window still trims at 160K", base.warningThreshold === 160_000, `got ${base.warningThreshold}`);

	const raised = buildWindowPlan({ windowLimit: 1_000_000, microCompactionCap: 400_000 });
	check("C77b: microCompactionCap 400K on a 1M window trims at 400K", raised.warningThreshold === 400_000, `got ${raised.warningThreshold}`);
	check("C77b: the cap moves only the trim line, not condense or blocking",
		raised.condenseThreshold === base.condenseThreshold && raised.blockingThreshold === base.blockingThreshold,
		`condense ${raised.condenseThreshold} vs ${base.condenseThreshold}`);

	for (const windowLimit of [200_000, 400_000]) {
		const p = buildWindowPlan({ windowLimit, microCompactionCap: 400_000 });
		const clamp = Math.floor(p.condenseThreshold * 0.85);
		check(`C77c: on a ${windowLimit / 1000}K window the 400K cap is clamped to 85% of condense (${clamp})`,
			p.warningThreshold === clamp && p.warningThreshold < p.condenseThreshold, `got ${p.warningThreshold}`);
	}

	const limitsFor = spawn.subAgentCompactionLimits;
	check("C77d: spawn.ts exports subAgentCompactionLimits", typeof limitsFor === "function");
	if (typeof limitsFor === "function") {
		const trimLine = (key: string) => buildWindowPlan(limitsFor(spawn.resolveModelExact(key))).warningThreshold;
		for (const key of ["deepseek-v4-pro", "deepseek-flash"]) {
			check(`C77d: a ${key} sub-agent trims at 400K`, trimLine(key) === 400_000, `got ${trimLine(key)}`);
		}
		for (const key of ["claude-opus-5-5", "claude-fable-5-1", "glm-5.3", "gpt-6-astra"]) {
			check(`C77d: a ${key} sub-agent stays at 160K`, trimLine(key) === 160_000, `got ${trimLine(key)}`);
		}
		const ds = spawn.resolveModelExact("deepseek-v4-pro");
		check("C77d: the window limit is still the model's own", limitsFor(ds).windowLimit === ds.contextWindow,
			`got ${limitsFor(ds).windowLimit}`);
	}

	// The helper is only worth testing if the spawn path actually passes it.
	const { readFileSync } = await import("node:fs");
	const src = readFileSync(join(ROOT, "src/agents/spawn.ts"), "utf8");
	check("C77e: buildAgentFromDefinition hands the helper's limits to createCompactionTransform",
		/createCompactionTransform\(\{[^}]*thresholds:\s*subAgentCompactionLimits\(model\)/.test(src));
}

console.log(failures === 0
	? "\nALL PASS — compaction views are byte-stable between advances."
	: `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
