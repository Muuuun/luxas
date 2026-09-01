/**
 * Per-run agent liveness — did the agent types this run depends on actually
 * run, or did they only get *attempted*?
 *
 * Origin (ba-neutral-atom-qc, 2026-08-29..31). `tool_review` routes
 * unconditionally to glm-5.2 (agents/spawn.ts GLM_REVIEWER_AGENTS) because a
 * third model family is what makes the impl/review split real — same-family
 * impl+test passed the same wrong constants. That provider was out of credit
 * for the entire run: 15/15 spawns returned HTTP 429, every one costing
 * $0.00. So for all nine experiments the tools were written by deepseek and
 * blind-tested by nobody — the exact self-circular failure the architecture
 * exists to prevent — and nothing anywhere said so. The producer proposed
 * `method_blocked → accept-with-disclosure`, an independent reviewer
 * concurred, thirteen separate times: a GLOBAL failure adjudicated as
 * thirteen LOCAL inconveniences, because no one held the vantage point where
 * "the same waiver, 13 times" reads as "a layer of the architecture is
 * offline". Cost monitoring could not see it either: a 429 is free.
 *
 * So: count outcomes per agent type, and let the finish gate and the brain's
 * own context read the count. A verifier attempted MIN_ATTEMPTS times with
 * zero successes is a dead capability, not a run-local inconvenience.
 *
 * Producer: tools/spawn-agent.ts (every foreground/parallel spawn result).
 * Consumers: tools/index.ts (finish gate, blocking), context.ts (brain sees
 * it at the next turn boundary, which is where the 2-day blind spot was).
 * If the finish block cannot be cleared, the existing FinishEscalation
 * (3 identical blocks → notes/escalations/needs-operator.md) hands it to a
 * person rather than deadlocking — this gate is layered on top of that.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REL = join(".agent", "agent-liveness.jsonl");

/**
 * Agents whose absence invalidates the run's central claim rather than
 * degrading it. `tool_review` authors the blind tests (its arbiter is pytest,
 * not its own judgment) and is pinned OFF the producer profile on purpose,
 * which is exactly why a provider outage takes it out silently.
 *
 * `experiment_reviewer` is deliberately NOT here. pi-agent.ts:370-379 already
 * decided that an Anthropic-balance outage failing every reviewer spawn must
 * fail OPEN rather than deadlock the pipeline; putting it in this set would
 * quietly reverse that decision and turn the same outage into a hard finish
 * block. `tool_review` is different: it is pinned to a third model family
 * precisely so it cannot share the producer's prior, and nothing else in the
 * pipeline reproduces what it does.
 */
export const MANDATORY_VERIFIER_AGENTS = new Set(["tool_review"]);

/** Attempts before zero-successes counts as dead rather than unlucky. */
export const MIN_ATTEMPTS = 3;

/**
 * Start a new liveness window. The ledger file is append-only for forensics,
 * but the QUESTION it answers is per-run ("is my verifier offline right now"),
 * so aggregation starts after the newest marker.
 *
 * Without this the gate eats its own use case: a run whose tool_review 429s
 * three times and dies at the cost cap could never be finished by a resume —
 * the resumed run does no experiments, so it spawns no tool_review, so
 * successes stays 0 forever, and under the PI-STOP freeze tool_review is not
 * even in FINALIZATION_HELPER_AGENTS, leaving no way to clear it.
 */
export function markRunStart(projectDir: string): void {
  if (!projectDir) return;
  try {
    const dir = join(projectDir, ".agent");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(projectDir, REL), JSON.stringify({ t: Date.now(), run_start: true }) + "\n");
  } catch { /* never break run startup */ }
}

export interface AgentLiveness { attempts: number; successes: number; lastError?: string }

/** Append one spawn outcome. Best-effort: never throws into the spawn path. */
export function recordAgentOutcome(projectDir: string, agentName: string, ok: boolean, errorMessage?: string): void {
  if (!projectDir || !agentName) return;
  try {
    const dir = join(projectDir, ".agent");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(projectDir, REL), JSON.stringify({
      t: Date.now(), agent: agentName, ok: !!ok,
      ...(errorMessage ? { err: String(errorMessage).slice(0, 300) } : {}),
    }) + "\n");
  } catch { /* liveness accounting must never break a spawn */ }
}

/** Aggregate THIS run's outcomes by agent type. Unreadable/absent → empty map. */
export function readAgentLiveness(projectDir: string): Map<string, AgentLiveness> {
  const out = new Map<string, AgentLiveness>();
  let raw = "";
  try { raw = readFileSync(join(projectDir, REL), "utf-8"); } catch { return out; }
  const all = raw.split("\n");
  // Only entries after the newest run_start marker belong to this run.
  let from = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].includes("\"run_start\"")) { from = i + 1; break; }
  }
  for (const line of all.slice(from)) {
    if (!line.trim()) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    const name = typeof r?.agent === "string" ? r.agent : null;
    if (!name) continue;
    const cur = out.get(name) ?? { attempts: 0, successes: 0 };
    cur.attempts++;
    if (r.ok) cur.successes++;
    else if (typeof r.err === "string" && r.err) cur.lastError = r.err;
    out.set(name, cur);
  }
  return out;
}

/** Agent types attempted ≥ MIN_ATTEMPTS with zero successes. */
export function deadCapabilities(projectDir: string): Array<{ agent: string; attempts: number; lastError?: string }> {
  const out: Array<{ agent: string; attempts: number; lastError?: string }> = [];
  for (const [agent, v] of readAgentLiveness(projectDir)) {
    if (v.successes === 0 && v.attempts >= MIN_ATTEMPTS) out.push({ agent, attempts: v.attempts, lastError: v.lastError });
  }
  return out.sort((a, b) => a.agent.localeCompare(b.agent));
}

/**
 * Blocking issues for the finish gate: a MANDATORY verifier that never once
 * ran. Non-mandatory dead agents are reported by livenessContextBlock but do
 * not block — an illustrator outage costs a figure, not the argument.
 */
export function livenessFinishIssues(projectDir: string): string[] {
  return deadCapabilities(projectDir)
    .filter((d) => MANDATORY_VERIFIER_AGENTS.has(d.agent))
    .map((d) =>
      `Cannot finish: the \`${d.agent}\` agent was spawned ${d.attempts} time(s) this run and NEVER succeeded` +
      `${d.lastError ? ` (last error: ${d.lastError.slice(0, 160)})` : ""}. ` +
      `That agent is the run's independent check — with it offline, tools were written and their results accepted with no verifier of a different model family, which is the self-circular failure the impl/review split exists to prevent. ` +
      `A per-experiment "method_blocked / accept-with-disclosure" note does NOT clear this: the waiver was granted for one tool at a time, while the condition is global to the run. ` +
      `Fix the provider (credit/model id) and re-run the affected verification, or — if the science must ship as-is — say so to the operator: this gate blocking three times in a row escalates to notes/escalations/needs-operator.md and exits cleanly.`,
    );
}

/** Brain-facing warning block, injected every turn while a capability is dead. */
export function livenessContextBlock(projectDir: string): string {
  const dead = deadCapabilities(projectDir);
  if (dead.length === 0) return "";
  const lines = dead.map((d) => {
    const mand = MANDATORY_VERIFIER_AGENTS.has(d.agent);
    return `- \`${d.agent}\`: ${d.attempts} attempts, 0 successes${d.lastError ? ` — ${d.lastError.slice(0, 120)}` : ""}${mand ? "  [MANDATORY VERIFIER — finish() is blocked while this holds]" : ""}`;
  });
  return [
    `<dead_capabilities>`,
    `These agent types have been spawned repeatedly this run and have never once succeeded — treat them as OFFLINE, not as flaky:`,
    ...lines,
    `A per-experiment "method_blocked / accept-with-disclosure" disposition is the wrong instrument here: that waiver answers "this one tool could not be checked", while the condition above is "the checking layer is not running at all". Do not grant it again per-experiment. Either get the capability back (usually provider credit or a model id), or stop and hand the run to the operator with the state as it stands.`,
    `</dead_capabilities>`,
  ].join("\n");
}
