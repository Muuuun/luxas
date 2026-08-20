/**
 * Smoke test: the three agent-loop patches are applied AND actually work.
 *
 * patches/pi-agent-core-no-tool-retry-guard.sh rewrites pi-agent-core's
 * compiled agent-loop.js by string anchor. Two failure modes matter and
 * neither is visible at install time:
 *   1. an anchor stops matching  → the patch silently does not apply
 *      (postinstall runs it with `|| true`, and the script's own python
 *      failure did not propagate);
 *   2. an anchor still matches but the surrounding code was refactored →
 *      the patch applies and produces broken code.
 * Mode 2 is what a pi upgrade actually does: 0.58.1's `steeringAfterTools`
 * was deleted upstream, so Patch A would apply and then throw ReferenceError
 * on the first text-only orchestrator turn.
 *
 * Marker presence catches (1). Driving the real loop with a scripted stream
 * catches (2).
 *
 * Run:  npx tsx scripts/smoke_agent_loop_patches.mts
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── locate the installed agent-loop, whichever scope is in use ────────────
// Both scopes on purpose: the gate must work before and after the pi-mono
// rename so a rollback is still covered. Do not collapse these to one.
const SCOPES = ["@earendil-works/pi-agent-core", "@mariozechner/pi-agent-core"];
let pkgRoot = "";
for (const s of SCOPES) {
	try { pkgRoot = require_.resolve(`${s}/package.json`).replace(/\/package\.json$/, ""); break; } catch {}
}
if (!pkgRoot) {
	console.log("✗ FAIL no pi-agent-core installed under any known scope");
	process.exit(1);
}
const loopPath = `${pkgRoot}/dist/agent-loop.js`;
const src = readFileSync(loopPath, "utf8");
console.log(`agent-loop: ${loopPath}\n`);

// ── 1. every patch marker is present ──────────────────────────────────────
for (const marker of ["[no-tool-retry-guard patched]", "[transient-error-retry patched]", "[finish-tool-exit patched]"]) {
	check(`marker present: ${marker}`, src.includes(marker));
}

// ── 2. the patched code references no undeclared identifier ───────────────
// Catches the steeringAfterTools class of breakage statically.
for (const ident of ["__transientRetryStreak", "hasMoreToolCalls"]) {
	if (!src.includes(ident)) continue;
	check(`${ident} is declared, not just assigned`, new RegExp(`\\blet\\s+${ident}\\b|\\bconst\\s+${ident}\\b|\\bvar\\s+${ident}\\b`).test(src));
}
const assignedOnly = [...src.matchAll(/^\s*(\w+) = \[\{\s*$/gm)].map((m) => m[1])
	.filter((id) => !new RegExp(`\\b(let|const|var)\\s+${id}\\b`).test(src));
check("no patch-introduced assignment to an undeclared variable", assignedOnly.length === 0, assignedOnly.join(", "));

// ── 3. behavior: the loop retries a transient stream error ────────────────
const { runAgentLoop } = await import(`${pkgRoot}/dist/agent-loop.js`);

/** Scripted stream: hands back one prepared assistant message per call. */
function scripted(messages: any[], throwAfter = Infinity) {
	let calls = 0;
	const fn = async () => {
		if (calls >= throwAfter) throw new Error("__scripted_stop__");
		const msg = messages[Math.min(calls, messages.length - 1)];
		calls++;
		return {
			async *[Symbol.asyncIterator]() { yield { type: msg.stopReason === "error" ? "error" : "done" }; },
			result: async () => msg,
		};
	};
	return { fn, calls: () => calls };
}

const textMsg = (text: string, stopReason = "stop") => ({
	role: "assistant", content: [{ type: "text", text }], stopReason, timestamp: Date.now(),
});
const errMsg = (errorMessage: string) => ({
	role: "assistant", content: [], stopReason: "error", errorMessage, timestamp: Date.now(),
});

const baseConfig = { model: { provider: "test", id: "test" }, convertToLlm: (m: any[]) => m as any };
const baseCtx = (tools: any[]) => ({ systemPrompt: "s", messages: [] as any[], tools });
const prompt = [{ role: "user", content: [{ type: "text", text: "go" }], timestamp: Date.now() }];

{
	// "terminated" is in the transient regex: expect a retry, not a clean exit.
	const s = scripted([errMsg("fetch failed: terminated"), textMsg("recovered")]);
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), 20_000);
	await runAgentLoop(prompt as any, baseCtx([]) as any, baseConfig as any, async () => {}, ac.signal, s.fn as any);
	clearTimeout(t);
	check("transient stream error is retried, not fatal", s.calls() >= 2, `streamFn called ${s.calls()}x`);
}

{
	// Non-transient error must still end the loop on the first turn.
	const s = scripted([errMsg("400 invalid_request: bad schema"), textMsg("should never run")]);
	await runAgentLoop(prompt as any, baseCtx([]) as any, baseConfig as any, async () => {}, undefined, s.fn as any);
	check("non-transient error still exits immediately", s.calls() === 1, `streamFn called ${s.calls()}x`);
}

// ── 4. behavior: a text-only turn does not silently end a finish-tool agent ─
{
	// The guard re-steers for as long as the model stays text-only, so the
	// stream itself bounds the test rather than an abort the loop ignores.
	const s = scripted([textMsg("I'll wait for the search to come back")], 3);
	const finishTool = { name: "finish", label: "finish", description: "d", parameters: { type: "object", properties: {} } };
	try {
		await runAgentLoop(prompt as any, baseCtx([finishTool]) as any, baseConfig as any, async () => {}, undefined, s.fn as any);
	} catch (e: any) {
		if (!String(e?.message).includes("__scripted_stop__")) throw e;
	}
	check("text-only turn re-steers an agent holding finish()", s.calls() >= 2, `streamFn called ${s.calls()}x`);
}

{
	// Without a finish tool the same turn must end the loop naturally.
	const s = scripted([textMsg("done thinking")]);
	await runAgentLoop(prompt as any, baseCtx([]) as any, baseConfig as any, async () => {}, undefined, s.fn as any);
	check("text-only turn still ends a sub-agent with no finish()", s.calls() === 1, `streamFn called ${s.calls()}x`);
}

console.log(failures === 0 ? "\nALL PASS — agent-loop patches applied and behaving." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
