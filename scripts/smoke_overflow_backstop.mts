/**
 * Smoke test: the deterministic overflow backstop (2026-08-25).
 *
 * The 297nm wrap-up died twice on "maximum context length … 795,871 tokens
 * in the messages": an over-window checkpoint cannot be condensed by the
 * summarizer (that call itself overflows), and the condense tail has no
 * per-message bound. The backstop is arithmetic: truncate the largest
 * non-assistant messages (middle-cut, marker, re-read pointer) until the
 * estimated request fits. A role:"system" message is the prompt, not history,
 * and is never cut (C3).
 *
 * Run:  npx tsx scripts/smoke_overflow_backstop.mts
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { overflowBackstop } = await import(join(ROOT, "src/compaction/overflow-backstop.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const big = (n: number) => "x".repeat(n);
const model: any = { contextWindow: 1_048_576, maxTokens: 393_216 }; // deepseek-sized, real completion reserve

// getContextWindow reads model.contextWindow? Build messages ~4M chars ≈ >1M tokens.
const msgs = [
	{ role: "user", content: "start" },
	{ role: "assistant", content: [{ type: "text", text: "thinking " + big(30_000) }] },
	{ role: "toolResult", content: [{ type: "text", text: "CSV DUMP " + big(1_500_000) }] },
	{ role: "assistant", content: "short reasoning" },
	{ role: "toolResult", content: [{ type: "text", text: "results.json " + big(1_500_000) }] },
	{ role: "user", content: big(1_200_000) },
	{ role: "user", content: "latest question" },
];
const before = JSON.stringify(msgs).length;
const out = overflowBackstop(msgs, model);
const after = JSON.stringify(out).length;

// Real limit from the live 400: messages+completion must fit the window, so
// message budget = (1,048,576 − 393,216) * 0.75 * 2.6 chars ≈ 1.278M chars.
const budget = Math.floor((1_048_576 - 393_216) * 0.75 * 2.6);
check("shrinks a 4M+ char history under the reserve-aware budget",
	after <= budget && after < before / 2, `before=${before} after=${after} budget=${budget}`);
check("small assistant messages untouched", out[3].content === "short reasoning");
check("truncation marker with re-read pointer present",
	/overflow backstop/.test(JSON.stringify(out[2])) && /re-read the file/.test(JSON.stringify(out[2])));
check("small messages pass through identical", out[0].content === "start" && out[6].content === "latest question");
check("under-budget history returned as-is",
	overflowBackstop([{ role: "user", content: "tiny" }], model)[0].content === "tiny");

// The REAL 297nm shape: mass in assistant thinking blocks (70-82K chars each),
// which passes 1-2 spare. Pass 3 must strip historical thinking, keep last 2.
const thinkMsg = (n: number) => ({ role: "assistant", content: [
	{ type: "thinking", thinking: big(n), thinkingSignature: "sig" },
	{ type: "text", text: "step summary" },
] });
const thinkHistory = [
	{ role: "user", content: "goal" },
	...Array.from({ length: 40 }, () => [thinkMsg(80_000), { role: "toolResult", content: [{ type: "text", text: "ok " + big(2_000) }] }]).flat(),
];
const tOut = overflowBackstop(thinkHistory, model);
const tAfter = JSON.stringify(tOut).length;
const asst = tOut.filter((m: any) => m.role === "assistant");
const stripped = asst.filter((m: any) => !JSON.stringify(m).includes('"thinking":"xxx')).length;
check("thinking-dominated history fits the budget", tAfter <= budget, `after=${tAfter} budget=${budget}`);
const hasThinking = (m: any) => JSON.stringify(m).includes('"thinking":"xxx');
check("oldest thinking stripped first, only as much as needed, newest kept",
	stripped > 0 && stripped < asst.length && !hasThinking(asst[0]) && hasThinking(asst[asst.length - 1]),
	`stripped=${stripped}/${asst.length}`);
check("text/toolCall blocks survive the strip",
	asst.every((m: any) => JSON.stringify(m).includes("step summary")));

// ── C3: the system prompt is never history ───────────────────
// pi 0.87: the transcript's leading role:"system" message IS the system prompt
// and the tool declarations. The brain's is ~110K chars (Dy), the experiment
// agent's ~100K: the largest AND the oldest message, so a backstop that treats
// it as history cuts it first (pass 1 to 50,107, pass 2 oldest-first, pass 4
// down to 1,667) — and every cut rewrites the whole prompt cache.
const { applyOverflowBackstop, createBackstopLedger } = await import(join(ROOT, "src/compaction/overflow-backstop.js"));
const fill = (n: number, ch: string) => ch.repeat(n);
const contentChars = (arr: any[]) => arr.reduce((s: number, m: any) => s + JSON.stringify(m?.content ?? "").length, 0);
const SYS_TEXT = "PROMPT-HEAD " + fill(105_000, "p") + " PROMPT-TAIL";
const sysMsg = { role: "system", content: SYS_TEXT, toolsAdded: [{ name: "read", description: "r", parameters: {} }], timestamp: 0 };
const results400 = () => Array.from({ length: 400 }, (_, k) => ({ role: "toolResult", toolCallId: `c${k}`, toolName: "read", content: [{ type: "text", text: big(3_500) }] }));
{ // S1: one shot, over budget
	const o = overflowBackstop([sysMsg, { role: "user", content: "goal" }, ...results400()], model);
	check("C3 S1: the leading system prompt is never cut (one-shot, over budget)", o[0] === sysMsg, `system ${SYS_TEXT.length} → ${String(o[0]?.content ?? "").length} chars`);
	check("C3 S1: the history still fits the budget (system chars count)", contentChars(o) <= budget, `total=${contentChars(o)} budget=${budget}`);
}
{ // S2: the real regime — one persistent ledger, history growing a step at a time
	const ledger = createBackstopLedger();
	const h: any[] = [sysMsg, { role: "user", content: "goal" }];
	let cut = 0, over = 0, first = "";
	for (let s = 0; s < 760; s++) {
		h.push({ role: "assistant", content: [{ type: "thinking", thinking: big(1_500), thinkingSignature: "s" }, { type: "toolCall", id: `c${s}`, name: "read", arguments: {} }] });
		h.push({ role: "toolResult", toolCallId: `c${s}`, content: [{ type: "text", text: big(3_500) }] });
		const o = applyOverflowBackstop(h, model, ledger).messages;
		if (o[0] !== sysMsg) { cut++; first ||= `step ${s}: ${String(o[0]?.content ?? "").length} chars`; }
		if (contentChars(o) > budget) over++;
	}
	check("C3 S2: growing history (to ~3× budget): system prompt byte-identical on every call", cut === 0, `${cut} of 760 calls cut it; first at ${first}`);
	check("C3 S2: every call still fits the budget", over === 0, `${over} calls over budget`);
	check("C3 S2: the fixture really drove the backstop", contentChars(h) > 2.5 * budget, `raw=${contentChars(h)}`);
}
{ // S3: a later system message (tool delta, prompt section) is prompt state too
	const midSys = { role: "system", content: fill(60_000, "q"), timestamp: 5 };
	const o = overflowBackstop([sysMsg, { role: "user", content: "goal" }, midSys, ...Array.from({ length: 30 }, () => ({ role: "toolResult", content: [{ type: "text", text: big(120_000) }] }))], model);
	check("C3 S3: a mid-transcript system message is not cut", o[2] === midSys, `${String(o[2]?.content).length} chars`);
}
{ // S4: through the factory every agent uses (pre-pack AND post-pack backstop)
	const { createCompactionTransform } = await import(join(ROOT, "src/compaction/create-transform.js"));
	const { transformContext } = createCompactionTransform({ model, thresholds: { windowLimit: model.contextWindow } });
	const o = await transformContext([sysMsg, { role: "user", content: "goal" }, ...results400()]);
	check("C3 S4: createCompactionTransform (pre- and post-pack) sends the system prompt intact", o[0]?.role === "system" && o[0]?.content === SYS_TEXT, `${String(o[0]?.content ?? "").length} chars`);
}

console.log(failures === 0 ? "\nALL PASS — overflow is now arithmetically impossible." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
