/**
 * Gate: per-run agent liveness — a verifier that is spawned and never once
 * succeeds must block finish() and appear in the brain's context.
 *
 * Regression under test (ba-neutral-atom-qc, 2026-08-29..31): tool_review
 * routes to glm-5.2, that provider was out of credit, all 15 spawns returned
 * 429 at $0.00 each, and the run shipped nine experiments whose tools were
 * written by the producer family and blind-tested by nobody. Nothing in cost,
 * logs, or gates said so.
 *
 * Run:  npx tsx scripts/smoke_agent_liveness.mts
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const L = await import(join(ROOT, "src/agent-liveness.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

const dir = mkdtempSync(join(tmpdir(), "liveness-"));
mkdirSync(join(dir, ".agent"), { recursive: true });

// Nothing recorded yet: silence, not accusation.
check("no ledger → no dead capabilities, no issues", L.deadCapabilities(dir).length === 0 && L.livenessFinishIssues(dir).length === 0 && L.livenessContextBlock(dir) === "");

// Two failures is unlucky, not dead (MIN_ATTEMPTS = 3).
L.recordAgentOutcome(dir, "tool_review", false, "429 Insufficient Balance");
L.recordAgentOutcome(dir, "tool_review", false, "429 Insufficient Balance");
check("2 failures do not yet count as a dead capability", L.deadCapabilities(dir).length === 0, JSON.stringify(L.deadCapabilities(dir)));

L.recordAgentOutcome(dir, "tool_review", false, "429 Insufficient Balance");
const dead = L.deadCapabilities(dir);
check("3 failures, 0 successes → dead capability", dead.length === 1 && dead[0].agent === "tool_review" && dead[0].attempts === 3, JSON.stringify(dead));
check("the provider's own error text is carried, so the cause is actionable", /429/.test(dead[0].lastError ?? ""));

const issues = L.livenessFinishIssues(dir);
check("a dead MANDATORY verifier blocks finish()", issues.length === 1 && /^Cannot finish:/.test(issues[0]), JSON.stringify(issues).slice(0, 200));
check("the block names the agent and refuses the per-experiment waiver", /tool_review/.test(issues[0]) && /accept-with-disclosure/.test(issues[0]));
check("the block points at the operator escalation rather than dead-ending", /needs-operator/.test(issues[0]));

const ctx = L.livenessContextBlock(dir);
check("brain context carries a <dead_capabilities> block", /<dead_capabilities>/.test(ctx) && /tool_review/.test(ctx));
check("context block flags the finish() consequence", /MANDATORY VERIFIER/.test(ctx));

// One success is enough to prove the capability exists; it stops being dead.
L.recordAgentOutcome(dir, "tool_review", true);
check("a single success clears the dead flag", L.deadCapabilities(dir).length === 0 && L.livenessFinishIssues(dir).length === 0);
check("aggregate counts survive the round trip", (() => { const m = L.readAgentLiveness(dir).get("tool_review"); return m?.attempts === 4 && m?.successes === 1; })());

// A non-mandatory agent that dies is reported but must NOT block the report.
for (let i = 0; i < 4; i++) L.recordAgentOutcome(dir, "illustrator", false, "404 model not found");
check("a dead NON-mandatory agent is visible in context", /illustrator/.test(L.livenessContextBlock(dir)));
check("a dead NON-mandatory agent does not block finish()", L.livenessFinishIssues(dir).length === 0, JSON.stringify(L.livenessFinishIssues(dir)));

// Review finding 3b: experiment_reviewer must stay fail-OPEN. pi-agent.ts
// already decided a reviewer-wide credit outage may not deadlock the pipeline.
for (let i = 0; i < 5; i++) L.recordAgentOutcome(dir, "experiment_reviewer", false, "credit balance too low");
check("a dead experiment_reviewer is visible", /experiment_reviewer/.test(L.livenessContextBlock(dir)));
check("a dead experiment_reviewer does NOT block finish (fail-open preserved)", L.livenessFinishIssues(dir).length === 0, JSON.stringify(L.livenessFinishIssues(dir)));

// Review finding 3a: the window is per-RUN. A resume that never spawns the
// verifier must not inherit yesterday's outage and become unfinishable.
const r2 = mkdtempSync(join(tmpdir(), "liveness-run2-"));
mkdirSync(join(r2, ".agent"), { recursive: true });
for (let i = 0; i < 3; i++) L.recordAgentOutcome(r2, "tool_review", false, "429");
check("run 1: dead verifier blocks finish", L.livenessFinishIssues(r2).length === 1);
L.markRunStart(r2);
check("run 2 (resume): the previous run's outage no longer blocks", L.livenessFinishIssues(r2).length === 0 && L.deadCapabilities(r2).length === 0);
L.recordAgentOutcome(r2, "tool_review", false, "429");
check("run 2 counts its own attempts from zero", L.readAgentLiveness(r2).get("tool_review")?.attempts === 1);
rmSync(r2, { recursive: true, force: true });

// Malformed ledger lines must never throw into a spawn or a gate.
const bad = mkdtempSync(join(tmpdir(), "liveness-bad-"));
mkdirSync(join(bad, ".agent"), { recursive: true });
const { writeFileSync } = await import("node:fs");
writeFileSync(join(bad, ".agent", "agent-liveness.jsonl"), "not json\n{}\n{\"agent\":\"x\",\"ok\":false}\n");
check("malformed ledger lines are skipped, not fatal", L.readAgentLiveness(bad).get("x")?.attempts === 1);

rmSync(dir, { recursive: true, force: true });
rmSync(bad, { recursive: true, force: true });
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
