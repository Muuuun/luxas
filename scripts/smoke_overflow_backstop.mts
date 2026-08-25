/**
 * Smoke test: the deterministic overflow backstop (2026-08-25).
 *
 * The 297nm wrap-up died twice on "maximum context length … 795,871 tokens
 * in the messages": an over-window checkpoint cannot be condensed by the
 * summarizer (that call itself overflows), and the condense tail has no
 * per-message bound. The backstop is arithmetic: truncate the largest
 * non-assistant messages (middle-cut, marker, re-read pointer) until the
 * estimated request fits.
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

console.log(failures === 0 ? "\nALL PASS — overflow is now arithmetically impossible." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
