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

console.log(failures === 0
	? "\nALL PASS — compaction views are byte-stable between advances."
	: `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
