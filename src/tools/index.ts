/**
 * Tool index — assembles all research tools for the brain agent.
 */

import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { md5OrNull, extractFrontmatterBlock, parseAuditFrontmatter, parseFollowUps, readFileSafe } from "../utils.js";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createReportTools, parseCompileVerdict, gateBlockingIssues } from "./report.js";
import { reportIntegrityIssues, formatIntegrityIssues, evidenceSourcesDigest, cheapPendingTrailer } from "./report-integrity.js";
import { createInitReportTool } from "./init-report.js";
import { pdfPagesDigest } from "./figure-gen.js";
import { createAuthorityEscalationTools } from "./authority-escalation.js";
import { createCodingToolsForProject } from "./coding.js";
import { createSpawnAgentTool, getActiveBackgroundAgents } from "./spawn-agent.js";
import { buildSafetyWrapper } from "../agents/safety-wrappers.js";
import { getDefinition } from "../agents/registry.js";
import { FinishEscalation, writeNeedsOperator } from "../claims-review.js";
import { buildClaimTable } from "../claims-table.js";
import { loadRegistry, removeAgent, isAlive, markFailed, formatExitHint } from "../active-agents.js";

/**
 * Parse `## L2.X` / `## E_N` experiment sections from notes/experiments.md
 * and extract each one's `**Status:**` line. Only `Pending` and `Complete`
 * are recognized statuses — any other value (`Deferred`, unrecognized text,
 * or missing line entirely) parses as `missing` and the finish gate blocks.
 *
 * History: "Deferred" was removed Apr-25 because brain abused it as escape
 * hatch with weak reasons. Then brain learned to delete the L2 section
 * entirely (audit-ledger erasure) and fabricate a "PI STOP verdict" to
 * justify finish. The finish gate now derives required experiments from
 * notes/plan.md (which the plan-PI gate already protects) instead of
 * trusting the brain-writable experiments.md ledger alone — see
 * parsePlanSections + the cross-check inside finish.
 */
interface ExperimentSection {
  header: string;
  status: "pending" | "complete" | "missing";
}

/**
 * Parse `### E_N` headers from notes/plan.md. These are the load-bearing
 * commitment statements: every E_N here implies the project promised to
 * answer that sub-question, and the finish gate requires a corresponding
 * `## L2.N` (Status: Complete) in notes/experiments.md.
 *
 * plan.md changes are PI-gated (see brain.md `<pi_review>`), so the set
 * of E_N is a trustworthy authority for "what experiments must complete".
 * The experiments.md ledger by contrast is brain-writable and was observed
 * being wiped to bypass finish — it can't be the sole source of truth.
 */
export function parsePlanSections(text: string): Array<{ id: string; index: number }> {
  const lines = text.split("\n");
  // Match `### E_N` (the documented heading form — see experiment.md) as well
  // as `### EN`. The previous /^###\s+(E\d+)\b/ matched only `EN` and silently
  // parsed ZERO sections on every underscore plan, making the finish-gate
  // commitment check a no-op on exactly those projects (including the two
  // highest-cost runs). The integer is the cross-reference key to `## L2.N`.
  const headerRE = /^###\s+E_?(\d+)\b/;
  const sections: Array<{ id: string; index: number }> = [];
  for (const line of lines) {
    const m = line.match(headerRE);
    if (m) {
      const index = parseInt(m[1], 10);
      sections.push({ id: `E${index}`, index });
    }
  }
  return sections;
}

/**
 * Synthesis-owner check (2026-08-25, 297nm postmortem). Decomposition has an
 * owner (brain), verification has owners (gates/auditors/PI) — synthesis had
 * none, and the acceptance run shipped exactly that hole: E2 computed C6(θ),
 * E3 computed fidelity at ONE θ, and no experiment owned F(θ) — the joint
 * object the user's composite question asked for. E3's own Pagano
 * reproduction (Ω=40 MHz → 99.976%) contained the recoil escape and the
 * report never drew F(Ω); PI approved, because every checker verified
 * soundness and nobody owned sufficiency.
 *
 * Rule: a plan with ≥2 experiments must contain a SYNTHESIS section — heading
 * matching /synth/i — whose job is the joint deliverable over ≥2 upstream
 * results. Escape (mirrors FRONTIER-DECLINE): a `SYNTH-DECLINE: <reason>`
 * line in notes/memory.md for genuinely non-composite questions.
 * Returns the blocking message, or null when satisfied.
 */
export function synthesisOwnerIssue(planSrc: string, memorySrc: string, ledgerSrc = "", experimentDirs: string[] = []): string | null {
  const sections = parsePlanSections(planSrc);
  if (sections.length < 2) return null;
  // Accepted evidence of a synthesis owner (2026-08-28: the pp-vs-ss brain ran
  // E6 as the synthesis, wrote `# Memory | SYNTH-DECLINE: …` on the title line,
  // and was blocked twice by a line-start regex over a stale plan.md):
  //   - a `### E_N … synth…` section in plan.md
  //   - a `## L2.N …` / `## E_N …` ledger section naming synthesis
  //   - an experiment directory whose slug names synthesis
  //   - SYNTH-DECLINE: anywhere on a line of memory.md
  if (/^###\s+E_?\d*[^\n]*synth/im.test(planSrc)) return null;
  if (/^##\s+(?:L2\.\d+|E_?\d+)[^\n]*synth/im.test(ledgerSrc)) return null;
  if (experimentDirs.some((d) => /synth/i.test(d))) return null;
  if (/SYNTH-DECLINE:/m.test(memorySrc)) return null;
  const ledgerN = (ledgerSrc.match(/^##\s+(?:L2\.\d+|E_?\d+)\b/gm) ?? []).length;
  const stale = ledgerN > sections.length ? ` (notes/plan.md lists ${sections.length} experiments but the ledger has ${ledgerN} — the plan is stale; add the sections you actually ran, and name the synthesis one \`### E_N (synthesis)\`.)` : "";
  return (
    `Cannot finish: the plan has ${sections.length} experiments and NO synthesis owner.${stale} ` +
    `Decomposed sub-answers are not the answer to a composite question — the 297nm run computed ` +
    `C6(θ) in one experiment and fidelity at a single θ in another, and nobody computed F(θ) or ` +
    `the F(P) frontier the question asked for. Add a final \`### E_N (synthesis)\` section to ` +
    `notes/plan.md whose Question quotes RESEARCH.md verbatim, whose Approach consumes at least two ` +
    `upstream results.json to produce the question's DELIVERABLE OBJECT (a tradeoff curve, a design ` +
    `surface, a coupled table — the shape the question implies, not a scalar), and which answers the ` +
    `mitigation-transfer question: for the dominant limitation found, what does the best comparable ` +
    `system in your corpus (including your own reproductions) do about it — transfer it or refute the ` +
    `transfer. Then dispatch it like any experiment. If the question is genuinely NOT composite, record ` +
    `\`SYNTH-DECLINE: <one-line reason>\` on its own line in notes/memory.md and retry finish.`
  );
}

export function parseExperimentSections(text: string): ExperimentSection[] {
  const lines = text.split("\n");
  // Treat h2 headers starting with L2.N or E_N as experiment sections; other
  // h2s (like "Overview") are narrative and exempt from the status contract.
  const headerRE = /^##\s+((?:L2\.\d+|E\d+)\b.*)$/;
  const statusRE = /^\*\*Status:\*\*\s*(Pending|Complete)\b/im;

  const sections: ExperimentSection[] = [];
  let curHeader: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    if (curHeader === null) return;
    const body = curBody.join("\n");
    const m = body.match(statusRE);
    if (!m) {
      sections.push({ header: curHeader, status: "missing" });
    } else {
      const kind = m[1].toLowerCase() as "pending" | "complete";
      sections.push({ header: curHeader, status: kind });
    }
  };
  for (const line of lines) {
    const m = line.match(headerRE);
    if (m) {
      flush();
      curHeader = m[1].trim();
      curBody = [];
    } else if (curHeader !== null) {
      curBody.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Parse the most recent PI verdict from `reviews/pi_feedback.md`. PI rewrites
 * the file each review with a top-level `## Verdict: <continue|steer|stop>`
 * line; older verdicts may be present in the file body if the model appended
 * rather than overwrote. We take the LAST match so stale earlier verdicts
 * never outvote the most recent.
 *
 * Returns null if the file is missing, unreadable, or has no parseable verdict.
 */
export function parseLatestPIVerdict(projectDir: string):
  | { verdict: "continue" | "steer" | "stop"; reviewPath: string; reviewMtimeMs: number }
  | null
{
  const p = join(projectDir, "reviews", "pi_feedback.md");
  let content: string;
  let mtimeMs: number;
  try {
    content = readFileSync(p, "utf-8");
    mtimeMs = statSync(p).mtimeMs;
  } catch {
    return null;
  }
  const matches = [...content.matchAll(/##\s*Verdict:\s*(continue|steer|stop)\b/gi)];
  // A synthesized no-response verdict ("PI review did NOT complete") is not a
  // verdict: it neither lifts nor imposes the STOP freeze (2026-08-28).
  const genuine = matches.filter((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    return !/did NOT complete/i.test(content.slice(m.index!, end));
  });
  if (genuine.length === 0) return null;
  const last = genuine[genuine.length - 1][1].toLowerCase() as "continue" | "steer" | "stop";
  return { verdict: last, reviewPath: p, reviewMtimeMs: mtimeMs };
}

export interface ToolCallbacks {
  onFinish?: () => void;
}

/**
 * Fix δ — Directive-implication finish gate.
 *
 * When a session is launched with `--directive` containing research-implication
 * keywords (simulate / verify / compare / analyze / 模拟 / 验证 / 对比 / 实验 /
 * 分析), the directive is asking for NEW work — not for a re-write of an
 * existing report. The finish gate must therefore verify that at least one
 * experiment directory under data/experiments/ has been created or modified
 * since the session started. If none, brain is trying to ship without doing
 * the work the directive demanded.
 *
 * Observed failure that motivated this: on the Rb-单光子双比特门 project the
 * user appended a directive demanding Doppler-elimination scheme comparison +
 * 对向 297 simulation, brain edited report.tex and called finish() without
 * spawning a single new experiment. The existing PI / typesetter / language
 * gates passed because the report itself was internally consistent — they
 * had no window on "did new work happen since the directive arrived?".
 *
 * Limitations (acknowledged):
 *  - Cannot verify content relevance: a brain that creates an empty E_fake/
 *    directory with `mkdir` or a real experiment unrelated to the directive
 *    will pass the gate. We require at least one regular file under the dir
 *    (defeats `mkdir`) but cannot enforce semantic alignment with the
 *    directive — that remains a PI / typesetter judgment call.
 */
const DIRECTIVE_KEYWORD_RE =
  /模拟|simulate|simulation|验证|verify|verification|对比|对照|比较|compare|comparison|实验|experiment|分析|analy[sz]e|analysis/i;

export function directiveImpliesNewWork(directive: string | undefined): string | null {
  if (!directive) return null;
  const m = directive.match(DIRECTIVE_KEYWORD_RE);
  return m ? m[0] : null;
}

/**
 * Find experiment directories under data/experiments/ that contain at least
 * one regular file whose mtime is strictly greater than `sinceMs`. Empty dirs
 * (created by a defensive `mkdir` to fool the gate) do not count. We walk
 * one level (scripts/, tests/, runs/) deep — enough to catch real work,
 * cheap enough to avoid recursive directory traversal on large run trees.
 */
export function findExperimentsModifiedSince(
  projectDir: string,
  sinceMs: number,
): string[] {
  const expRoot = join(projectDir, "data", "experiments");
  if (!existsSync(expRoot)) return [];
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(expRoot); } catch { return []; }
  for (const name of entries) {
    const dir = join(expRoot, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (hasFileNewerThan(dir, sinceMs, 2)) out.push(name);
  }
  return out;
}

function hasFileNewerThan(dir: string, sinceMs: number, depth: number): boolean {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isFile() && st.mtimeMs > sinceMs) return true;
    if (st.isDirectory() && depth > 0) {
      if (hasFileNewerThan(full, sinceMs, depth - 1)) return true;
    }
  }
  return false;
}

/**
 * H7: when report.tex enumerates N "schemes" / "方案" via explicit count
 * ("compared 7 schemes") or via (a)(b)(c)... enumeration, every named
 * scheme must have a corresponding experiment dir with a substantive
 * results.json — non-trivial size + simulation-evidence keywords, NOT a
 * `{"status":"excluded"}` stub.
 *
 * Heuristic, not perfect. Misses report sections that don't use the
 * enumeration pattern. But catches the documented Rb failure: brain wrote
 * "六种方案中四种经数值模拟验证 ... (c) 解析排除 (d) 解析排除 (b) 开放问题"
 * — 7 schemes declared, 4 with real results.json, 3 trivial.
 *
 * Caller-bypassable via reviews/directive_pushback.md (mtime-newer than the
 * report) — preserves brain's documented-dissent path.
 */
function checkSchemeSymmetry(
  projectDir: string,
  sessionStartedAtMs: number,
): { ok: boolean; message?: string } {
  const reportPath = join(projectDir, "report", "report.tex");
  if (!existsSync(reportPath)) return { ok: true };

  let tex: string;
  try { tex = readFileSync(reportPath, "utf-8"); }
  catch { return { ok: true }; }

  // Detect explicit declaration: "N 个方案" / "N schemes" / "compared N X"
  let declared = 0;
  const explicitRe = /(?:对比|比较|compared?|enumerated?|all|every|the\s+)\s*(\d+)\s*(?:个|种)?\s*(?:方案|schemes?|approaches?|protocols?|methods?)/gi;
  for (const m of tex.matchAll(explicitRe)) {
    declared = Math.max(declared, parseInt(m[1], 10));
  }
  // Detect (a)..(z) markers tied to "scheme"/"方案" in same paragraph
  const enumLetters = new Set<string>();
  const enumRe = /(?:方案|scheme)\s*\(([a-z])\)/gi;
  for (const m of tex.matchAll(enumRe)) enumLetters.add(m[1].toLowerCase());
  declared = Math.max(declared, enumLetters.size);

  if (declared < 3) return { ok: true }; // not enumerating schemes; skip check

  // Count fresh experiment dirs with substantive results.json
  const expRoot = join(projectDir, "data", "experiments");
  if (!existsSync(expRoot)) {
    return { ok: false, message: `Report declares ${declared} schemes but data/experiments/ does not exist.` };
  }
  let substantiveCount = 0;
  const trivialStatusRe = /^\s*\{\s*"status"\s*:\s*"(?:excluded|open|infeasible|skip)"\s*\}?\s*$/i;
  const evidenceRe = /"(?:fidelity|infidelity|trajector|simulation|sweep|scan|ensemble|samples?|results?)"\s*:/i;
  try {
    for (const name of readdirSync(expRoot)) {
      const subDir = join(expRoot, name);
      let st; try { st = statSync(subDir); } catch { continue; }
      if (!st.isDirectory()) continue;
      const runsDir = join(subDir, "runs");
      if (!existsSync(runsDir)) continue;
      let found = false;
      for (const run of readdirSync(runsDir)) {
        const resultsPath = join(runsDir, run, "results.json");
        if (!existsSync(resultsPath)) continue;
        let rst; try { rst = statSync(resultsPath); } catch { continue; }
        if (rst.mtimeMs < sessionStartedAtMs) continue;
        if (rst.size < 1024) continue;
        let body: string;
        try { body = readFileSync(resultsPath, "utf-8"); } catch { continue; }
        if (trivialStatusRe.test(body.trim())) continue;
        if (!evidenceRe.test(body)) continue;
        found = true; break;
      }
      if (found) substantiveCount++;
    }
  } catch { /* tolerate listing failures */ }

  // Allow pushback override: reviews/directive_pushback.md newer than report
  const pushbackPath = join(projectDir, "reviews", "directive_pushback.md");
  if (existsSync(pushbackPath)) {
    try {
      const pst = statSync(pushbackPath);
      const rst = statSync(reportPath);
      if (pst.mtimeMs >= rst.mtimeMs) return { ok: true };
    } catch { /* fall through */ }
  }

  if (substantiveCount < declared) {
    return {
      ok: false,
      message:
        `Scheme symmetry mismatch: report.tex declares/enumerates ${declared} ` +
        `schemes (via explicit count or (a)..(z) markers tied to "方案"/"scheme") ` +
        `but only ${substantiveCount} experiment director(ies) under ` +
        `data/experiments/ have a substantive results.json (≥1 KB, contains ` +
        `fidelity/trajectories/simulation evidence, NOT a {"status":"excluded"} ` +
        `stub). ${declared - substantiveCount} scheme(s) appear in the report ` +
        `without underlying simulation artifacts. This is the documented Rb-单光子 ` +
        `failure pattern: directive demanded "verify N via simulation", brain ` +
        `delivered M<N with the rest narrated as "analytically excluded".`,
    };
  }
  return { ok: true };
}

export interface DirectiveGateConfig {
  directive: string;
  sessionStartedAtMs: number;
  /** True on a resumed (unfinished-checkpoint) run. Scopes the δ mtime check
   * to fresh starts only, so a resume cannot false-block finish() — prior-session
   * experiment mtimes are legitimately older than this process. The H7
   * scheme-symmetry content check still applies on resume. */
  isResume?: boolean;
}

export function buildResearchTools(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  callbacks?: ToolCallbacks,
  directiveGate?: DirectiveGateConfig,
): { tools: any[]; setParentAgent: (agent: Agent) => void } {
  // Brain coding tools are wrapped with read-tracking + edit safety guards
  // declared in brain.md. The wrapper is load-bearing (RESEARCH.md protection,
  // read-before-edit) — missing safety config is a misconfiguration, not a
  // fallback case, so we fail fast rather than returning raw tools.
  const brainWrapper = buildSafetyWrapper(getDefinition("brain").safety);
  if (!brainWrapper) {
    throw new Error("brain.md must declare a `safety:` block — top-level brain tools cannot run unwrapped.");
  }
  const codingTools = brainWrapper(createCodingToolsForProject(projectDir), projectDir, templateVars);
  const reportTools = createReportTools(projectDir);
  const authorityTools = createAuthorityEscalationTools(projectDir);

  // Deferred parent agent ref — set after Agent is constructed (needed for background steer)
  let parentAgentRef: Agent | undefined;

  // F2 escape hatch (debate-adjudicated 2026-06-21): a gate-blocked finish() returns
  // without details.success, so onFinish never fires and the loop has NO terminating
  // edge — a brain that wants to stop but won't dispose its frontier leads spins
  // finish() to the turn cap (observed: 441 calls, ~$22 burned). Count consecutive
  // frontier-gate blocks; on the Kth force a clean exit, shipping current artifacts
  // with the open leads honestly marked UNDISPOSED (not forged as "declined").
  let blockedFinishStreak = 0;
  // Fix 3 (2026-06-22): total finish() attempts past the background lock. A global
  // runaway backstop for finish-loop variants that evade the frontier-only F2 streak
  // (e.g. the finish→edit→compile→typesetter cycle looping on freshness/typesetter gates).
  let finishCallCount = 0;
  // Claims-first §3.8 (2026-08-26): the same blocking gate on three consecutive
  // finish() calls is the livelock signature (297nm: 4 finish calls, 15
  // consecutive plan.md reads, 3 operator interventions). Escalate to the
  // operator instead of iterating. Layered UNDER the 12-call global backstop
  // above — never in place of it.
  const escalation = new FinishEscalation(3);

/**
 * Gate-cost telemetry: a force-exited run (12-call backstop) was previously
 * indistinguishable from a clean finish in the registry. finish_stats.json
 * records how the run exited and how many finish() attempts it took; the
 * per-gate block texts are already in .agent/log.jsonl for offline
 * attribution. Best-effort — never let telemetry block a finish.
 */
function writeFinishStats(projectDir: string, finishCalls: number, forceExited: boolean): void {
  try {
    const dir = join(projectDir, ".agent");
    mkdirSync(dir, { recursive: true });
    let disclosed: number | null = null;
    try { disclosed = buildClaimTable(projectDir).disclosedHeadlineCount; } catch { disclosed = null; }
    writeFileSync(join(dir, "finish_stats.json"), JSON.stringify({
      finish_calls: finishCalls,
      force_exited: forceExited,
      disclosed_headline_count: disclosed,
      at: new Date().toISOString(),
    }, null, 2) + "\n");
  } catch { /* telemetry must never block finish */ }
}

  // Use a proxy object so spawn tool picks up the agent ref when it's set later
  const spawnTool = createSpawnAgentTool(
    projectDir, templateVars, getApiKey,
    /* parentAgentId */ undefined,
    /* depth */ undefined,
    /* parentAgent — resolved lazily via proxy */ undefined,
  );

  // Wrap execute to inject parentAgentRef at call time (agent is set after construction)
  const origExecute = spawnTool.execute;
  spawnTool.execute = function (toolCallId: string, params: any) {
    // Patch background support: if parentAgentRef is set and params.background, use steer
    if (params.background && parentAgentRef) {
      // Re-create tool with agent ref for this call
      const toolWithAgent = createSpawnAgentTool(
        projectDir, templateVars, getApiKey,
        "brain", 0, parentAgentRef,
      );
      return toolWithAgent.execute(toolCallId, params);
    }
    return origExecute(toolCallId, params);
  };

  // finish tool — agent calls this when research is complete
  const finishTool = {
    name: "finish",
    description: "Call when research is complete: PI review passed and final PDF compiled. This cleanly ends the research session.",
    parameters: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string" as const,
          description: "One-line summary of what was accomplished.",
        },
        decline: {
          type: "array" as const,
          description: "Optional: dispose open frontier leads in THIS call instead of hand-editing notes/memory.md. Each {leadId, reason} writes a FRONTIER-DECLINE line. Decline a lead ONLY if running it could neither flip nor undermine the soundness of a claim you ship; if it could, run it instead.",
          items: {
            type: "object" as const,
            properties: {
              leadId: { type: "string" as const },
              reason: { type: "string" as const },
            },
            required: ["leadId", "reason"],
          },
        },
      },
      required: ["summary"],
    },
    execute: async (args: { summary: string; decline?: Array<{ leadId: string; reason: string }> }) => {
      // F3 (debate-adjudicated 2026-06-21): dispose frontier leads passed in-call,
      // collapsing dispose+finish into the one call the brain was already making.
      // Writes the FRONTIER-DECLINE lines the frontier gate's presence check (below)
      // reads from notes/memory.md, so a willing brain clears the gate before the F2 cap arms.
      if (args.decline?.length) {
        const lines = args.decline.map(d => `FRONTIER-DECLINE: ${d.leadId} — ${d.reason}`).join("\n");
        appendFileSync(join(projectDir, "notes", "memory.md"), `\n${lines}\n`);
      }

      // Hard lock: cannot finish while background agents are still running.
      // 2026-07-10 (debate-adjudicated): this branch used to reject with advisory
      // prose and count blocks toward a 30-call force-exit backstop. The backstop
      // guillotined a healthy run — the zombie sweep in getActiveBackgroundAgents
      // means anything reaching this lock is alive by construction, so the counter
      // could only ever hit legitimate waits (observed: live experiment force-exited
      // at minute 16 with 0 effective finishes, all audits skipped). Now the lock
      // IS the wait: same harness-side poll/sweep/harvest as idle, zero LLM cost,
      // then the harvest returns to the brain so results round-trip through the
      // ledger before the gates run. Dead agents get stale-swept inside the wait
      // (zombie deadlock structurally impossible); an alive-but-hung agent costs
      // one cheap turn per 10-min timeout, bounded by the wall-clock cap in hooks.
      const active = getActiveBackgroundAgents(projectDir);
      if (active.length > 0) {
        const blob = await waitAndHarvestBackground(projectDir, 600_000);
        return { content: [{ type: "text" as const, text:
          `finish() deferred: background agent(s) were still running. Waited and harvested:\n\n` +
          `${blob}\n\n` +
          `Integrate these results (notes/experiments.md ledger, report) as needed, then call finish() again.` }] };
      }

      // Fix 3 (2026-06-22): global runaway-finish backstop. F2 (blockedFinishStreak)
      // only counts CONSECUTIVE blocks at the frontier gate; a finish→edit→compile→
      // typesetter cycle loops on the freshness/typesetter gates and never trips it
      // (a run reached 68 finish calls / ~$53 before being killed). Count EVERY finish()
      // attempt past the background lock and force-exit a runaway. A legitimate finish
      // passes on attempt 1; only a cross-gate livelock reaches the cap.
      if (++finishCallCount >= 12) {
        callbacks?.onFinish?.();
        writeFinishStats(projectDir, finishCallCount, true);
        return { content: [{ type: "text" as const, text:
          `Force-exit (runaway-finish backstop): finish() has been called ${finishCallCount} ` +
          `times and kept being blocked by a finish gate — almost always the report freshness/` +
          `typesetter cycle (every recompile makes report.pdf newer than the last PI review, ` +
          `re-blocking finish). Shipping current artifacts as-is so a gate livelock cannot burn ` +
          `the budget.` }],
          details: { success: true } };
      }

      // Fix δ — Directive-implication gate. See directiveImpliesNewWork above
      // for the rationale and known limitations. Only fires when this session
      // was launched with --directive AND the directive contains a research-
      // implication keyword. Cost: one stat() per experiment dir.
      if (directiveGate) {
        const kw = directiveImpliesNewWork(directiveGate.directive);
        if (kw) {
          // δ mtime check: fresh-start only. On a resume, prior-session
          // experiment mtimes are legitimately older than this process, so this
          // would false-block a legitimate finish(); the H7 scheme-symmetry
          // (content) check below carries the substance requirement on resume.
          if (!directiveGate.isResume) {
            const fresh = findExperimentsModifiedSince(projectDir, directiveGate.sessionStartedAtMs);
            if (fresh.length === 0) {
              return { content: [{ type: "text" as const, text:
                `Cannot finish: --directive contains research-implication keyword ` +
                `"${kw}" but no experiment directory under data/experiments/ has ` +
                `been modified since the session started ` +
                `(${new Date(directiveGate.sessionStartedAtMs).toISOString()}). ` +
                `The directive demands new analysis; the project state shows none. ` +
                `Spawn experiment with the directive's analysis task before calling ` +
                `finish(). If the directive is genuinely satisfiable by editing the ` +
                `report alone (no new computation needed), say so explicitly in a ` +
                `note to the user and ask for an updated directive.`
              }] };
            }
          }

          // Fix H7 — subsection-vs-results symmetry. δ above only requires
          // ≥1 fresh experiment dir; that's trivially satisfied even when the
          // directive demanded N schemes simulated and brain only did 4/N.
          // This check: detect explicit enumeration in report.tex ("compared
          // N schemes" / scheme (a)..(g) markers) and require a matching
          // count of experiment dirs with substantive results.json
          // (non-trivial size + simulation-evidence keywords, NOT
          // {"status":"excluded"} stubs).
          const symmetry = checkSchemeSymmetry(projectDir, directiveGate.sessionStartedAtMs);
          if (!symmetry.ok) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: ${symmetry.message}\n\n` +
              `Either (a) simulate the missing schemes, or ` +
              `(b) document a pushback in reviews/directive_pushback.md ` +
              `naming each unsimulated scheme and the reason it cannot be ` +
              `verified within scope. If (b), the gate accepts the discrepancy ` +
              `once pushback.md is mtime-newer than the report.`
            }] };
          }
        }
      }

      // Plan-commitment gate: derive required experiments from notes/plan.md
      // and verify each one is Complete in notes/experiments.md.
      //
      // The authority chain:
      //   1. notes/plan.md  — what experiments the project committed to.
      //      Changes are PI-gated; brain edits but PI-review blocks dispatch
      //      after material edits. This is the trusted source of truth.
      //   2. notes/experiments.md — the per-experiment status ledger.
      //      Brain was observed wiping sections to bypass the gate
      //      (Apr-25 incident). Cannot be sole source of truth.
      //
      // Cross-check: every `### E_N` in plan.md must have a corresponding
      // `## L2.N` (or `## E_N`) section with Status: Complete in
      // experiments.md. Missing section = ledger erased = block.
      // Defensive check: any L2/E section actually present in experiments.md
      // must also be Complete (catches stray Pending sections not in plan).
      const planPath = join(projectDir, "notes", "plan.md");
      const expNotesPath = join(projectDir, "notes", "experiments.md");

      // Synthesis owner: composite questions need a joint-deliverable
      // experiment, not a stack of silo results (see synthesisOwnerIssue).
      {
        const planSrcS = existsSync(planPath) ? readFileSync(planPath, "utf-8") : "";
        const memSrcS = (() => { try { return readFileSync(join(projectDir, "notes", "memory.md"), "utf-8"); } catch { return ""; } })();
        const ledgerSrcS = (() => { try { return readFileSync(join(projectDir, "notes", "experiments.md"), "utf-8"); } catch { return ""; } })();
        const expDirsS = (() => { try { return readdirSync(join(projectDir, "data", "experiments")); } catch { return [] as string[]; } })();
        const synthIssue = synthesisOwnerIssue(planSrcS, memSrcS, ledgerSrcS, expDirsS);
        if (synthIssue) return { content: [{ type: "text" as const, text: synthIssue + cheapPendingTrailer(projectDir) }] };
      }

      const planExperiments = existsSync(planPath)
        ? parsePlanSections(readFileSync(planPath, "utf-8"))
        : [];
      const ledgerSections = existsSync(expNotesPath)
        ? parseExperimentSections(readFileSync(expNotesPath, "utf-8"))
        : [];

      // Index ledger sections by their L2.N / E_N identifier prefix.
      const ledgerByKey = new Map<string, "pending" | "complete" | "missing">();
      for (const s of ledgerSections) {
        const m = s.header.match(/^(L2\.(\d+)|E(\d+))/);
        if (!m) continue;
        const idx = m[2] ?? m[3];
        ledgerByKey.set(`L2.${idx}`, s.status);
        ledgerByKey.set(`E${idx}`, s.status);
      }

      // Cross-check: every plan.md E_N must have a Complete ledger entry.
      const planMissingFromLedger: string[] = [];
      const planIncompleteInLedger: Array<{ id: string; status: string }> = [];
      for (const p of planExperiments) {
        const key1 = `L2.${p.index}`;
        const key2 = p.id;
        const status = ledgerByKey.get(key1) ?? ledgerByKey.get(key2);
        if (status === undefined) {
          planMissingFromLedger.push(p.id);
        } else if (status !== "complete") {
          planIncompleteInLedger.push({ id: p.id, status });
        }
      }

      // Defensive: any extra section in experiments.md must also be Complete.
      const ledgerExtraIncomplete = ledgerSections.filter(s => {
        if (s.status === "complete") return false;
        const m = s.header.match(/^(L2\.(\d+)|E(\d+))/);
        const idx = m?.[2] ?? m?.[3];
        // Skip if already flagged via plan cross-check (avoid double-report)
        if (idx !== undefined && planIncompleteInLedger.some(pi => pi.id === `E${idx}`)) {
          return false;
        }
        return true;
      });

      if (
        planMissingFromLedger.length > 0 ||
        planIncompleteInLedger.length > 0 ||
        ledgerExtraIncomplete.length > 0
      ) {
        const lines: string[] = [`Cannot finish: plan-experiments commitment check failed.`];

        if (planMissingFromLedger.length > 0) {
          lines.push(
            ``,
            `notes/plan.md commits to ${planMissingFromLedger.length} experiment(s) with no entry in notes/experiments.md:`,
          );
          for (const id of planMissingFromLedger) lines.push(`  - ${id}`);
          lines.push(
            `→ Spawn experiment for each missing E_N. The experiment agent appends its own L2 section with Status: Complete on Phase 3 integrate. If a sub-question is genuinely out of scope, edit notes/plan.md to drop its §E_N section, then re-run plan-PI gate (request_pi_review) before retrying finish.`,
          );
        }

        if (planIncompleteInLedger.length > 0) {
          lines.push(
            ``,
            `Plan-referenced experiments not Complete (${planIncompleteInLedger.length}):`,
          );
          for (const s of planIncompleteInLedger) lines.push(`  - ${s.id} → status: ${s.status}`);
          lines.push(`→ Spawn experiment to drive each section to Complete.`);
        }

        if (ledgerExtraIncomplete.length > 0) {
          lines.push(
            ``,
            `Extra non-Complete sections in experiments.md not tied to plan.md (${ledgerExtraIncomplete.length}):`,
          );
          for (const s of ledgerExtraIncomplete) lines.push(`  - ${s.header} → status: ${s.status}`);
          lines.push(`→ Either spawn experiment to drive these to Complete, or remove if written in error (note: brain cannot edit experiments.md by design — this entry came from an experiment agent and only that agent class can clean it up).`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") + cheapPendingTrailer(projectDir) }] };
      }

      // Frontier-disposition gate (Step 3): every OPEN generative lead an
      // experiment authored (`### FollowUp: E_{N}_slug`, not yet run) must be
      // DISPOSED before finish — either run (its `## L2.N` section now exists)
      // or explicitly declined via a `FRONTIER-DECLINE: <leadId>` line in
      // notes/memory.md. PRESENCE check only: the decline's content is never
      // judged (a prior-sharing judge would rubber-stamp it). This stops a
      // generative fork the agent's OWN experiment surfaced from being shipped
      // as report prose — the magic-state E_4 failure mode.
      if (existsSync(expNotesPath)) {
        const followUps = parseFollowUps(readFileSync(expNotesPath, "utf-8"));
        const ranNums = new Set<number>();
        for (const s of ledgerSections) {
          const m = s.header.match(/(?:L2\.|E_?)(\d+)/);
          if (m) ranNums.add(parseInt(m[1], 10));
        }
        const memText = readFileSafe(join(projectDir, "notes", "memory.md"));
        // Match a decline by lead NUMBER, not the full slug — the slug drifts
        // across the FollowUp formats experiments actually author (`E_4_slug`,
        // `E4_slug`, bare `E5 — Title`), so keying the disposition on `E_N`
        // alone is the only robust join. (A decline line is `FRONTIER-DECLINE:
        // E5 — <reason>` or `… E_4_slug — <reason>`.)
        const declinedNums = new Set(
          [...memText.matchAll(/FRONTIER-DECLINE:\s*E_?\{?(\d+)\}?/gi)]
            .map(m => parseInt(m[1], 10))
        );
        const undisposed = followUps.filter(l => !l.isNone && !ranNums.has(l.num) && !declinedNums.has(l.num));
        // Decline hardening (2026-07-14, quality-strategy debate, B-class):
        // a decline is content-unjudged EXCEPT when the FollowUp's source L2
        // is cited in report.tex — then the dependent claim ships, and the
        // demotion must be WIRED: some claims.json entry must list the lead
        // in open_dependencies (which caps its grade at conditional and
        // forces a hedge, via report-integrity 1c). Structural join only:
        // E_N id in report body (already the citation-gate vocabulary) ×
        // lead number × claims.json. Referee evidence: 5/5 audited studies'
        // top objection was an agent-scoped, undisposed follow-up whose
        // dependent claim shipped unhedged.
        const badDeclines: string[] = [];
        {
          const declinedLeads = followUps.filter(l => !l.isNone && !ranNums.has(l.num) && declinedNums.has(l.num));
          if (declinedLeads.length > 0) {
            let reportBody = "";
            try { reportBody = readFileSync(join(projectDir, "report", "report.tex"), "utf-8"); } catch { /* no report yet */ }
            let claimDeps = new Set<string>();
            try {
              const cj = JSON.parse(readFileSync(join(projectDir, "report", "claims.json"), "utf-8"));
              if (Array.isArray(cj)) for (const c of cj) {
                for (const d of (Array.isArray(c?.open_dependencies) ? c.open_dependencies : [])) {
                  const m2 = String(d).match(/E_?(\d+)/i);
                  if (m2) claimDeps.add(m2[1]);
                }
              }
            } catch { /* no manifest */ }
            for (const l of declinedLeads) {
              const srcNum = (l.sourceSection.match(/(?:L2\.|E_?)(\d+)/) ?? [])[1];
              const citedRE = new RegExp(`\\bE_?${srcNum}\\b`);
              if (srcNum && citedRE.test(reportBody) && !claimDeps.has(String(l.num))) {
                badDeclines.push(`  - ${l.leadId}: its source section E${srcNum} is cited in report.tex, so a claim ` +
                  `depends on it — the decline must be wired: add the lead to that claim's open_dependencies in ` +
                  `report/claims.json (grade caps at conditional, hedge required) or run the lead.`);
              }
            }
          }
        }
        if (badDeclines.length > 0) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: ${badDeclines.length} declined lead(s) have report-cited source sections but no wired demotion:\n` +
            badDeclines.join("\n") }] };
        }
        if (undisposed.length > 0) {
          // F2 escape hatch: a gate-blocked finish() has no terminating edge; cap
          // consecutive blocks so a non-disposing brain can't spin to the turn cap.
          if (++blockedFinishStreak >= 3) {
            callbacks?.onFinish?.();
            // Force-exit quarantine: the artifact ships, but the ledger — the
            // most-read artifact and next-run digest source — records that it
            // shipped over open blockers, in harness voice (agents cannot
            // remove it retroactively without the diff showing).
            try {
              appendFileSync(expNotesPath,
                `\n## FORCE-EXITED (harness, ${new Date().toISOString().slice(0, 10)})\n` +
                `Shipped via runaway-cost backstop with UNDISPOSED leads: ` +
                `${undisposed.map(l => l.leadId).join(", ")}. Headline claims depending on these are UNVERIFIED.\n`);
            } catch { /* ledger append is best-effort */ }
            return { content: [{ type: "text" as const, text:
              `Force-exit (runaway-cost backstop): 3 consecutive blocked finish() calls with open frontier leads. ` +
              `Shipping current artifacts. Leads left UNDISPOSED (not declined): ${undisposed.map(l => l.leadId).join(", ")}. ` +
              `Dispose properly next time via finish(decline:[{leadId,reason}]) or by running the leads.`
            }], details: { success: true } };
          }
          const list = undisposed.map(l =>
            `  - ${l.leadId} (from ${l.sourceSection})` +
            (l.decisionRule ? `\n      Decision rule: ${l.decisionRule.slice(0, 220)}` : "")
          ).join("\n");
          return { content: [{ type: "text" as const, text:
            `Cannot finish: ${undisposed.length} open generative lead(s) your own experiment(s) proposed are undisposed — a continue-vs-report fork left as report prose:\n${list}\n\n` +
            `For EACH, either dispatch the experiment (its \`## L2.N\` Complete section then satisfies this gate), OR add to notes/memory.md a line:\n` +
            `  FRONTIER-DECLINE: <leadId> — <why it would not change a headline finding you ship, citing its Decision rule>\n\n` +
            `This is a PRESENCE check — the decline's content is not judged. Decline a lead ONLY if resolving it could neither flip nor undermine the soundness of a claim you ship; if it could, run it.`
          }] };
        }
        blockedFinishStreak = 0; // frontier satisfied this call — re-arm the F2 cap
      }

      const pdfPath = join(projectDir, "report/report.pdf");
      if (!existsSync(pdfPath)) {
        return { content: [{ type: "text" as const, text: `Cannot finish: report/report.pdf does not exist. Compile the report first with compile_latex, then call finish again.` }] };
      }

      // PDF-correctness gate: the SHIPPED report.pdf must not contain undefined
      // citations, undefined control sequences, or a stale bibliography. These
      // are filesystem ground-truth (latex .log + .bbl/.bib mtimes), so the gate
      // cannot be performatively satisfied — and it catches the broken render
      // regardless of HOW it was compiled (a ctex doc hand-compiled with xelatex
      // bypasses every in-tool guard). Without this, a "successful" compile ships
      // "?" citations and stray title-page text (the \affiliation spill).
      {
        // Same parser + same blocking predicate as the compile_latex message
        // and the snapshot line (report.ts parseCompileVerdict) — three
        // consumers, one verdict. The gate's blocking classes live in
        // gateBlockingIssues so a consequence claim elsewhere can't drift
        // from what actually blocks here.
        const reportDir = join(projectDir, "report");
        const renderIssues = gateBlockingIssues(parseCompileVerdict(reportDir));
        if (renderIssues.length > 0) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: the compiled report.pdf has unresolved LaTeX problems (these render as "?" / "??" / stray text in the shipped PDF):\n` +
            renderIssues.map((i) => `  - ${i}`).join("\n") +
            `\n\nRecompile cleanly with compile_latex (it re-runs the full engine→bibtex→engine→engine sequence and auto-selects xelatex for ctex/CJK docs), then call finish again. If a \\cite key is genuinely missing from references.bib, add the reference (spawn a reader) or drop the cite.`
          }] };
        }
      }

      // Figure gate: require ≥1 self-generated figure (under report/figures/,
      // not imported from ../data/papers/). Without this, brain tends to ship
      // text-with-paper-imports and skip visualising its own quantitative
      // results.
      const reportTexPath = join(projectDir, "report/report.tex");
      if (existsSync(reportTexPath)) {
        const tex = readFileSync(reportTexPath, "utf-8");
        const includes = [...tex.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map(m => m[1]);
        const selfGen = includes.filter(p => !p.includes("/data/papers/") && !p.includes("data/papers/"));
        if (selfGen.length === 0 && includes.length > 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex has ${includes.length} figure(s), all imported from data/papers/. Reports with experiments must include ≥1 self-generated figure visualising your own quantitative results. See brain.md <generated_figures>: sourcing raw data from data/experiments/*/runs/*/data/, spawn illustrator or run a plot script to produce report/figures/<name>.pdf, then include it in report.tex.` }] };
        }
        if (selfGen.length === 0 && includes.length === 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex contains zero figures. Every research report needs ≥1 self-generated figure under report/figures/ visualising experiment results. See brain.md <generated_figures>.` }] };
        }

        // Orphan-figure gate: a figure \label the body text never \ref's is a
        // figure the prose never anchors — LaTeX floats it to the end of the
        // document (FTQC_codes shipped its only figure unreferenced on p9/13).
        // The ≥1-figure count above can't see this; key the gate on linkage.
        const figLabels = [...tex.matchAll(/\\begin\{figure\*?\}[\s\S]*?\\label\{([^}]+)\}[\s\S]*?\\end\{figure\*?\}/g)].map(m => m[1]);
        const refd = new Set([...tex.matchAll(/\\(?:ref|autoref|cref|Cref)\{([^}]+)\}/g)].flatMap(m => m[1].split(",").map(s => s.trim())));
        const orphans = figLabels.filter(l => !refd.has(l));
        if (orphans.length > 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: figure label(s) never \\ref'd in the body text: ${orphans.join(", ")}. An unreferenced figure has no text anchor and floats to the end of the PDF. For each: either add a \\ref{...} where the prose discusses that result, or drop the figure if no prose motivates it.` }] };
        }

        // Requester-voice gate: report.tex must never reference the research
        // requester or the act of being asked. RESEARCH.md is internal routing
        // ground-truth, not a quotable source — but the verbatim-request /
        // noun-preservation discipline (brain.md top-of-file) bleeds the
        // requester into the report's motivation slot. Observed across 7 reports
        // (magic-state "用户明确指出…", 量子化学 "用户的核心问题", Rb-单光子
        // "\subsection{用户的交替对射方案}", …). Conservative backstop: match
        // requester-FRAMING phrases only, never the bare word 用户 (a legitimate
        // domain term in end-user subjects: 用户隐私/用户行为).
        const requesterVoice = tex
          .replace(/%[^\n]*/g, "")
          .match(/用户(?:提出|明确指出|希望|想要|猜测|假设|问及|关于)|回答用户|用户的[^，。\n]{0,10}问题|\\(?:sub)*section\*?\{[^}]*用户|the user (?:asked|wants|requested|explicitly)|as requested by|the requester/g);
        if (requesterVoice) {
          const uniq = [...new Set(requesterVoice)].slice(0, 6);
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex references the research requester — found ${requesterVoice.length} requester-voice phrase(s): ${uniq.join(", ")}. A report is a third-person academic document for a reader who never saw RESEARCH.md; the user and the act of being asked must not appear. Rewrite each into literature-grounded motivation or scientific scope — "本文研究…" / "本文聚焦于…", not "用户提出…" / "回答用户…的问题". See brain.md report-voice rule. Bare domain uses of 用户 (用户隐私/用户行为) are fine — only requester framing is blocked.` }] };
        }

        // Language gate: cross-check plan.md `# Language`'s `Chosen:` against
        // report.tex actual content. Catches the silent-flip failure mode
        // observed in 超导BOM (brain planned Chinese, wrote English 11h later
        // with no plan-side update). Detection: look for any Han character /
        // Hangul / Kana in report.tex body. Match: chosen=zh implies CJK
        // present; chosen=en implies CJK absent (or only present in cite keys).
        if (existsSync(planPath)) {
          const planText = readFileSync(planPath, "utf-8");
          const langStart = planText.match(/^#\s*Language\b[^\n]*$/m);
          let langBlock = "";
          if (langStart && langStart.index !== undefined) {
            const after = planText.slice(langStart.index + langStart[0].length);
            const nextHeading = after.match(/\n#\s/);
            langBlock = nextHeading ? after.slice(0, nextHeading.index) : after;
          }
          const chosenMatch = langBlock.match(/\*\*Chosen\*\*\s*[:：]\s*([a-z][a-z-]*)/i);
          const chosen = chosenMatch?.[1].toLowerCase();
          if (chosen) {
            // Strip cite/ref blocks before CJK detection so a Chinese-named
            // bibtex key in an English report doesn't false-positive.
            const stripped = tex
              .replace(/\\cite\{[^}]*\}/g, "")
              .replace(/\\bibliography\{[^}]*\}/g, "")
              .replace(/%[^\n]*/g, "");
            const hasCJK = /[一-鿿가-힯぀-ヿ]/.test(stripped);
            const expectsCJK = chosen === "zh" || chosen === "zh-cn" || chosen === "zh-tw" ||
              chosen === "ja" || chosen === "ko";
            if (expectsCJK && !hasCJK) {
              return { content: [{ type: "text" as const, text: `Cannot finish: notes/plan.md's # Language block declares Chosen: ${chosen}, but report.tex contains no CJK characters in its body. The report drifted from the planned language. Either translate the report to ${chosen} (use bilingual inline for technical terms — peer project 中性原子量子计算机的BOM is the worked example) OR update notes/plan.md's # Language block with a new Chosen + rationale and re-run plan-PI gate.` }] };
            }
            if (!expectsCJK && hasCJK) {
              return { content: [{ type: "text" as const, text: `Cannot finish: notes/plan.md's # Language block declares Chosen: ${chosen}, but report.tex contains CJK characters. Either translate to ${chosen} OR update plan.md's # Language block.` }] };
            }
          }
        }
      }

      // PI verdict gate. PI's role in the loop is explicit adversarial review;
      // if PI's latest verdict is STEER, the agent has unresolved instructions
      // and is not allowed to self-declare the work done. This gate was absent
      // from 2026-03-21 (original finish tool, 14ef477) through 2026-04-20
      // (commit a37273f figure gate) — brain could address any subset of a
      // STEER's instructions and call finish() uncontested. Observed on
      // inbox_B6Bk_xVQ2503: PI returned STEER with 4 priorities, brain
      // partially addressed P1+P2, skipped P3+P4, called finish() and shipped.
      //
      // Dead-loop avoidance — three mechanisms, layered:
      //
      //  1. Pushback escape. Brain may disagree with PI defensibly: write
      //     reviews/pi_pushback.md with a reasoned argument AFTER reading
      //     the latest review; if that file's mtime exceeds pi_feedback.md's,
      //     the gate allows finish() through. This is the "documented
      //     dissent" exit — PI keeps the authority to flag issues, brain
      //     keeps the authority to override with written justification.
      //
      //  2. Clear error message. The block text names the EXACT two paths
      //     forward (address + re-review, or write pushback). Brain seeing
      //     the same message on repeated calls has the instruction set
      //     unchanged; it will not wander into the "retry same tool"
      //     trap the old block-retry loops did.
      //
      //  3. maxTurns cap (default 500, src/agent.ts). Any true runaway
      //     kills the process via process.exit(1). Bounded damage.
      //
      // continue/stop verdicts pass through; stop explicitly means "wrap up
      // and ship" so finish is the right call.
      // Report-integrity gate (2026-07-04, debate-adjudicated "write-only
      // evidence store" fix): the report must READ BACK the evidence store —
      // abstract numbers resolve to results.json/notes, no citing incomplete
      // E_N, ledger disclosures survive to the report. Ordered BEFORE the
      // typesetter/auditor/PI gates deliberately: this check is O(ms) and its
      // remedy (edit report.tex → recompile) invalidates those expensive
      // audits, so failing fast here saves a full tail iteration (gate-cost
      // debate F1). Escape for false positives (e.g. E_2 as a physics
      // symbol): reviews/integrity_pushback.md with mtime newer than
      // report.tex — same contract as pi_pushback.
      {
        const blocking = reportIntegrityIssues(projectDir).filter((i) => i.blocking);
        if (blocking.length > 0) {
          // Gate-fire telemetry (2026-07-14): without this, a dead or noisy
          // gate is indistinguishable from a clean corpus. Reader: postmortem
          // sessions scan .agent/gate_fires.jsonl to measure per-check block
          // rates (the overfull-verdict Phase-2 pattern needs exactly this).
          try {
            appendFileSync(join(projectDir, ".agent", "gate_fires.jsonl"),
              JSON.stringify({ at: new Date().toISOString(), gate: "report-integrity",
                kinds: blocking.map((i) => i.kind) }) + "\n");
          } catch { /* telemetry never blocks */ }
          const pushbackPath = join(projectDir, "reviews", "integrity_pushback.md");
          let pushbackFresh = false;
          try {
            const texMtimeMs = statSync(join(projectDir, "report", "report.tex")).mtimeMs;
            pushbackFresh = statSync(pushbackPath).mtimeMs > texMtimeMs;
          } catch { /* no pushback file — not fresh */ }
          // pushbackExempt issues (cannot_comply / method_blocked) survive the
          // mtime hatch: deliberately-written structured entries are not parser
          // false positives — their only exits are the *_resolved disposition
          // fields (2026-07-13; the hatch was otherwise a one-line
          // self-approval bypass for exactly the decisions that must not be
          // self-approved).
          const exempt = blocking.filter((i) => i.pushbackExempt);
          if (pushbackFresh && exempt.length > 0) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: ${exempt.length} structured blocker(s) cannot be waived via ` +
              `integrity_pushback.md (that hatch is for parser false positives only). ` +
              `Disposition them via their *_resolved fields:\n\n` +
              formatIntegrityIssues(exempt)
            }] };
          }
          if (!pushbackFresh) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: the report diverges from the evidence store ` +
              `(notes/ + results.json are source-of-truth):\n\n` +
              formatIntegrityIssues(blocking) +
              `\n\nFix the report or the evidence store so they agree, recompile, ` +
              `then finish. If a flag is genuinely false (explain which and why), ` +
              `write reviews/integrity_pushback.md; once its mtime is newer than ` +
              `report/report.tex, finish() is allowed through. Structured blockers ` +
              `(cannot_comply / method_blocked) are pushback-exempt — resolve those ` +
              `via their *_resolved fields instead.`
            }] };
          }
        }
      }

      // Contradiction-sweep gate (2026-07-04, debate-adjudicated): same
      // quantity, incompatible values across report/ledger/results.json must
      // be reconciled before shipping. Both headline physics errors in the
      // reviewed shuttling runs co-occurred with internal contradictions
      // (9-OoM adjacent tables; four incompatible Raman magnitudes), so an
      // unreconciled diff is a cheap detector for the expensive error class.
      // The escape is fixing the documents and re-running the auditor, not
      // prose. Ordered BEFORE the typesetter gate (2026-07-05 tail debate):
      // sweep findings force content edits that invalidate the expensive
      // vision audit, so content must settle first — the surgery run burned
      // two full ~30min typesetter passes to the old order.
      const sweepPath = join(projectDir, "reviews", "contradiction_sweep.md");
      const sweepSrc = existsSync(sweepPath) ? readFileSync(sweepPath, "utf-8") : null;
      if (sweepSrc === null) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/contradiction_sweep.md is missing. The ` +
          `report has not been swept for internal contradictions. Spawn the auditor:\n\n` +
          `  spawn_agent(agent="contradiction_auditor", task="Sweep report/report.tex, ` +
          `notes/experiments.md and results.json for same-quantity contradictions per ` +
          `your prompt. Write reviews/contradiction_sweep.md.", background=false)\n\n` +
          `Run the sweep (and any content fixes it forces) BEFORE the typesetter ` +
          `audit — every content edit invalidates a typesetter pass, and typesetter ` +
          `is the most expensive auditor. Once the sweep returns status: clean, ` +
          `finish() proceeds to the layout gate.`
        }] };
      }
      {
        const fmB = extractFrontmatterBlock(sweepSrc);
        const sfm = fmB ? parseAuditFrontmatter(fmB) : {} as Record<string, string | undefined>;
        if (!fmB || !sfm.status || !sfm.sources_md5) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: reviews/contradiction_sweep.md is missing YAML frontmatter ` +
            `keys (status, sources_md5). Re-spawn contradiction_auditor.`
          }] };
        }
        if (sfm.status !== "clean") {
          const summaryMatch = sweepSrc.match(/##\s*Contradictions\s*\n+([\s\S]*?)(?=\n##\s*Checked|\s*$)/);
          return { content: [{ type: "text" as const, text:
            `Cannot finish: reviews/contradiction_sweep.md status is "${sfm.status}". ` +
            `Reconcile each contradiction (one value with a cited source, or state the ` +
            `differing conditions at both sites), recompile, then re-spawn ` +
            `contradiction_auditor.\n\n` +
            (summaryMatch ? `Contradictions:\n${summaryMatch[1].trim().slice(0, 1500)}` : "")
          }] };
        }
        // Keyed on the SOURCE files the auditor reads (report.tex + ledger +
        // results.json), not the PDF — pdflatex embeds timestamps, so a no-op
        // recompile changes the PDF md5 and would re-fire the audit for
        // nothing. Prose/value edits change this digest; layout-only
        // recompiles don't.
        const digestNow = evidenceSourcesDigest(projectDir);
        if (digestNow !== sfm.sources_md5) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: reviews/contradiction_sweep.md swept different source files ` +
            `(recorded sources_md5 ${sfm.sources_md5.slice(0, 12)}…, current ` +
            `${digestNow.slice(0, 12)}…) — report.tex, notes/experiments.md or a ` +
            `results.json changed since the sweep. Re-spawn contradiction_auditor.`
          }] };
        }
      }

      // Document-level layout gate, orthogonal to illustrator (figure
      // internals) and reviewer (content). No pushback escape — layout
      // failures are mechanical, not judgment calls; if the audit is
      // wrong, re-run typesetter, don't override.
      const typesetterPath = join(projectDir, "reviews", "typesetter_notes.md");
      const typesetterSrc = existsSync(typesetterPath)
        ? readFileSync(typesetterPath, "utf-8")
        : null;
      if (typesetterSrc === null) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md is missing. Document-` +
          `level layout has not been audited. Spawn typesetter:\n\n` +
          `  spawn_agent(agent="typesetter", task="Audit report/report.pdf ` +
          `page-by-page for layout issues per your prompt. Write reviews/` +
          `typesetter_notes.md.", background=false)\n\n` +
          `Once it returns status: all-clear (and the PDF hasn't been ` +
          `recompiled since), finish() is allowed.`
        }] };
      }
      const fmBlock = extractFrontmatterBlock(typesetterSrc);
      if (!fmBlock) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md has no YAML frontmatter. ` +
          `Re-spawn typesetter to regenerate with proper frontmatter ` +
          `(status, report_pdf_md5, page_count, pages_audited).`
        }] };
      }
      const fm = parseAuditFrontmatter(fmBlock);
      if (!fm.status || !fm.report_pdf_md5) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md frontmatter is ` +
          `missing required keys (status, report_pdf_md5). Re-spawn typesetter.`
        }] };
      }
      if (fm.status !== "all-clear") {
        const summaryMatch = typesetterSrc.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
        const summary = summaryMatch ? summaryMatch[1].trim() : "(no Summary section)";
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md status is "${fm.status}" ` +
          `(not all-clear). Address the layout issues then re-spawn ` +
          `typesetter to regenerate the audit.\n\n` +
          `Summary from typesetter_notes.md:\n${summary}`
        }] };
      }
      const currentPdfMd5 = md5OrNull(pdfPath);
      if (currentPdfMd5 && currentPdfMd5 !== fm.report_pdf_md5) {
        // Byte md5 moved — but the PDF embeds timestamps, so this fires on
        // every recompile even when nothing visible changed. Before demanding
        // a ~30min vision re-audit, recompute the page-raster digest HERE
        // (gate-side, unforgeable): if the rendered pages are byte-identical
        // to what the typesetter audited, the audit still describes this PDF.
        const digestNow = pdfPagesDigest(pdfPath);
        const rasterMatch = digestNow !== null && fm.pages_digest !== undefined &&
          digestNow === fm.pages_digest;
        if (!rasterMatch) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: reviews/typesetter_notes.md audited a different ` +
            `report.pdf (recorded md5 ${fm.report_pdf_md5.slice(0, 12)}…, ` +
            `current ${currentPdfMd5.slice(0, 12)}…` +
            (fm.pages_digest ? `; page rasters also differ` : ``) +
            `). Re-spawn typesetter to audit the current PDF — it will use ` +
            `diff_pdf_pages to re-read only the pages that visually changed.`
          }] };
        }
      }

      // Freshness gate: the SHIPPED artifact must have been reviewed. Mid-run
      // reviews don't cover a PDF compiled after the last one — observed on
      // collisional-gate-with-tweezer: 15 PI rounds, then finish() fired
      // 12.6s after the final compile and shipped a caption whose numbers
      // contradicted its own curve by 10x. Mechanical like the typesetter md5
      // gate above — no pushback escape; one request_pi_review after the
      // final compile satisfies it.
      const piVerdict = parseLatestPIVerdict(projectDir);
      if (currentPdfMd5) {
        let pdfMtimeMs = 0;
        try { pdfMtimeMs = statSync(pdfPath).mtimeMs; } catch { /* vanished — md5 gate above covers it */ }
        // Stale-PDF dodge: now that a fresh PDF requires a fresh PI review,
        // "edit report.tex and finish WITHOUT recompiling" becomes the free
        // path around all three artifact gates. One stat closes it.
        let texMtimeMs = 0;
        try { texMtimeMs = statSync(join(projectDir, "report", "report.tex")).mtimeMs; } catch {}
        if (texMtimeMs > pdfMtimeMs) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: report/report.tex was edited after the last ` +
            `compile — the PDF you are shipping does not contain your latest ` +
            `edits. Run compile_latex, re-run typesetter, then ` +
            `request_pi_review(milestone="final report").`
          }] };
        }
        if (pdfMtimeMs > 0 && (!piVerdict || piVerdict.reviewMtimeMs < pdfMtimeMs)) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: report/report.pdf was compiled AFTER the last PI ` +
            `review${piVerdict ? "" : " (no PI review on record at all)"} — ` +
            `the document you are about to ship has never been reviewed. ` +
            `Call request_pi_review(milestone="final report") now; once PI ` +
            `returns continue or stop on the current PDF, finish() is allowed.`
          }] };
        }
      }

      if (piVerdict && piVerdict.verdict === "steer") {
        const pushbackPath = join(projectDir, "reviews", "pi_pushback.md");
        let pushbackFresh = false;
        try {
          const pushbackMtimeMs = statSync(pushbackPath).mtimeMs;
          pushbackFresh = pushbackMtimeMs > piVerdict.reviewMtimeMs;
        } catch { /* pushback file missing — not fresh */ }
        if (!pushbackFresh) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: latest PI verdict in reviews/pi_feedback.md is STEER ` +
            `(unresolved instructions). Two paths forward, pick one:\n\n` +
            `  (a) Address PI's instructions, then call request_pi_review again. ` +
            `PI must return verdict=continue or verdict=stop before finish() is ` +
            `allowed.\n\n` +
            `  (b) If any instruction is genuinely non-actionable or you have ` +
            `defensible disagreement, write reviews/pi_pushback.md with a ` +
            `reasoned argument (cite specific feedback items, give your counter-` +
            `reasoning, note what you will NOT do and why). Once that file's ` +
            `mtime is newer than reviews/pi_feedback.md, finish() is allowed ` +
            `through — PI's authority is advisory, not a veto.\n\n` +
            `Do NOT retry finish() without taking one of these paths; the ` +
            `block will repeat identically.`
          }] };
        }
      }

      // Fix 2 (2026-06-22, debate-adjudicated): ledger-vs-report consistency backstop.
      // A false claim ("the published STCP construction fails / contradicts Theorem 4")
      // shipped because the PI itself authored it (shared priors with the brain) and every
      // gate above is content-blind. This catches the high-harm class: the report asserting
      // a definitive validity verdict the project's OWN ledger records as merely sufficient
      // or unresolved. Heuristic + overridable (pi_pushback); the reviewer.md
      // methodology_claim_verification block is the primary, in-PI defense. "Ground truth
      // from inputs, not outputs" — the principle tool_review enforces, applied to this seam.
      {
        const reportTex = readFileSafe(join(projectDir, "report", "report.tex"));
        const ledgerTxt = readFileSafe(join(projectDir, "notes", "experiments.md"));
        const harm = reportTex.match(/the correct necessary condition|contradict\w*[^.\n]{0,40}\btheorem\b|\bfails?\b[^.\n]{0,40}\bnecessary condition\b/i);
        const hedge = ledgerTxt.match(/sufficient[^.\n]{0,25}\bnot\b[^.\n]{0,10}necessary|\bnot\s+necessary\b|\bunresolved\b|\binconclusive\b|did not compare/i);
        if (harm && hedge) {
          const pushbackPath = join(projectDir, "reviews", "pi_pushback.md");
          let pushbackFresh = false;
          try {
            const ledgerMtimeMs = statSync(join(projectDir, "notes", "experiments.md")).mtimeMs;
            pushbackFresh = statSync(pushbackPath).mtimeMs > ledgerMtimeMs;
          } catch { /* no pushback file — not fresh */ }
          if (!pushbackFresh) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: the report asserts a definitive validity verdict that may contradict your own ledger (the ledger is source-of-truth).\n` +
              `  report/report.tex asserts: "...${harm[0].trim()}..."\n` +
              `  notes/experiments.md records: "...${hedge[0].trim()}..."\n\n` +
              `A SUFFICIENT check failing does not prove the validity condition fails; and a published/cited result is not "invalid" on the strength of your own reconstruction. Pick one:\n` +
              `  (a) reconcile the report to the ledger's actual verdict (e.g. "our reconstruction disagrees with our check — likely a discrepancy, unresolved"), then recompile + re-review; or\n` +
              `  (b) if the ledger line is stale and the report is right, update/retract that ledger line; or\n` +
              `  (c) if this is a false flag (the two lines are about different claims), write reviews/pi_pushback.md explaining why the report is consistent with the ledger. Once its mtime is newer than notes/experiments.md, finish() is allowed.`
            }] };
          }
        }
      }

      // Title-named delivery copies: every project ships report.{tex,pdf}, so
      // collected artifacts from different projects collide on the same
      // basename. Keep report/report.* as the internal contract (gates, studio,
      // registry all key on it) and add <title>.{tex,pdf} copies for humans.
      // Best-effort — naming must never block a genuine finish.
      try {
        const texP = join(projectDir, "report/report.tex");
        const pdfP = join(projectDir, "report/report.pdf");
        const m = readFileSync(texP, "utf-8").match(/\\title\{((?:[^{}]|\{[^{}]*\})*)\}/);
        if (m) {
          const name = m[1]
            .replace(/\\\\/g, " ")            // \\ line breaks in long titles
            .replace(/\\[a-zA-Z]+\s*/g, "")   // strip LaTeX macros
            .replace(/[{}~$^_%&#]/g, "")
            .replace(/[\/\\:*?"<>|\n]/g, " ")
            .replace(/\s+/g, " ").trim().slice(0, 120);
          if (name && name !== "report") {
            copyFileSync(texP, join(projectDir, `report/${name}.tex`));
            if (existsSync(pdfP)) copyFileSync(pdfP, join(projectDir, `report/${name}.pdf`));
          }
        }
      } catch { /* delivery naming is cosmetic */ }

      callbacks?.onFinish?.();
      writeFinishStats(projectDir, finishCallCount, false);
      // details.success marks a GENUINE finish — every "Cannot finish" branch
      // above returns no details. The vendored Patch B (finish-tool-exit)
      // keys the agent-loop exit off this flag, so a gate-blocked finish()
      // leaves the loop running instead of shipping a corpse. Same shape as
      // sub-agent-exit.ts so both finish tools converge on one contract.
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }], details: { success: true } };
    },
  };

  {
    const finishExecute = finishTool.execute;
    (finishTool as any).execute = async (...callArgs: any[]) => {
      const r = await (finishExecute as any)(...callArgs);
      const text = Array.isArray(r?.content) && r.content[0]?.type === "text" ? String(r.content[0].text ?? "") : "";
      if (r?.details?.success) { escalation.reset(); return r; }
      if (/^Cannot finish/.test(text) && escalation.record(text)) {
        const path = writeNeedsOperator(projectDir, text, finishCallCount);
        callbacks?.onFinish?.();
        writeFinishStats(projectDir, finishCallCount, true);
        return { content: [{ type: "text" as const, text:
          `Escalated to the operator: the same finish gate blocked ${escalation.count} consecutive finish() calls, ` +
          `so iterating is not reducing the issue. Wrote ${path.replace(projectDir + "/", "")} with the gate text; ` +
          `the run exits cleanly with its artifacts as they stand. A person decides the next move.` }],
          details: { success: true, escalated: true } };
      }
      return r;
    };
  }

  const initReport = createInitReportTool(projectDir);

  // idle tool — brain calls this after dispatching background agents when it
  // has no foreground work. Blocks on the harness side (poll active-agents.json
  // at 2s cadence) — zero LLM turns while waiting. Returns all bg results as
  // a single tool output when every running bg has transitioned to done/failed,
  // so brain processes them in one follow-up turn instead of per-nudge.
  //
  // Stale heartbeats (subagent-runner crashed without markFailed) are flipped
  // to "failed" here so they harvest instead of blocking forever.
  const idleTool = {
    name: "idle",
    description:
      "Suspend your turn-taking until ALL running background agents complete, " +
      "with zero LLM cost during the wait. Harness polls the registry every 2s " +
      "and returns all completions as this tool's output in one blob. Call this " +
      "after `spawn_agent(background=true)` when you have no foreground work " +
      "to do. Returns immediately if no background agents are running.",
    parameters: {
      type: "object" as const,
      properties: {
        timeout_ms: {
          type: "number" as const,
          description: "Max wait duration before giving up. Default 600000 (10 minutes). On timeout, any still-running agents are listed; they remain in the registry for next-turn harvest.",
        },
      },
    },
    execute: async (args: { timeout_ms?: number }) => {
      const body = await waitAndHarvestBackground(projectDir, args.timeout_ms ?? 600_000);
      return { content: [{ type: "text" as const, text: body }] };
    },
  };

  const tools = [
    ...reportTools,
    initReport,
    ...authorityTools,
    ...codingTools,
    spawnTool,
    idleTool,
    finishTool,
  ];

  return {
    tools,
    setParentAgent: (agent: Agent) => { parentAgentRef = agent; },
  };
}

/**
 * Shared wait/sweep/harvest body for `idle` and the finish() background lock
 * (2026-07-10, debate-adjudicated): one owner for the waiting semantics so the
 * two callers can never drift. Polls the registry at 2s cadence, zombie-sweeps
 * stale heartbeats (with stderr forensics), and returns all completions as one
 * text blob. Never throws.
 */
export async function waitAndHarvestBackground(projectDir: string, timeout: number): Promise<string> {
      const agentDir = join(projectDir, ".agent");
      const start = Date.now();
      const pollMs = 2000;

      // Grace period: brain commonly calls idle() in the same assistant turn
      // as spawn_agent(background=true), and pi-agent-core runs tools in
      // parallel. The spawn's synchronous addAgent() may not complete before
      // idle's first loadRegistry() reads the file — observed live as a race
      // where idle returned "no bg running" within 8s of brain's dispatch.
      // 500ms settles the race; indistinguishable from no-op on real idles.
      await new Promise(r => setTimeout(r, 500));

      // Zombie detection: mark an agent failed only when it's been running
      // long enough to have produced a heartbeat. subagent-runner touches
      // heartbeat at startup + every 30s; startup itself can take 5-10s
      // (node loads tsx + pi-agent-core + agent def). Without the
      // startedAt grace, a freshly-spawned agent has no heartbeat file yet
      // and would be falsely labelled zombie on the first poll.
      const ZOMBIE_GRACE_MS = 90_000;
      while (Date.now() - start < timeout) {
        const active = loadRegistry(agentDir);
        for (const a of active) {
          if (
            a.status === "running"
            && Date.now() - a.startedAt > ZOMBIE_GRACE_MS
            && !isAlive(agentDir, a.id, 60_000)
          ) {
            // Synthesize an exit record for the crashed agent so parent harvest
            // still gets stopReason=killed rather than an undefined exit. The
            // markFailed path that subagent-runner takes on catch() fires exit
            // from its collector; a SIGKILL'd runner never reaches that catch,
            // so this harness-side path is the only source of exit metadata.
            // Crash forensics consumer edge (2026-07-10): the runner's stderr
            // now lands in .agent/runner-logs/<id>.err — attach its tail so
            // the parent sees WHY (V8 OOM abort vs unhandled rejection vs
            // provider error), not just "stale". Without this read, the log
            // files would be one more write-only artifact.
            let stderrTail = "";
            try {
              const errPath = join(agentDir, "runner-logs", `${a.id.replace(/[/\\]/g, "_")}.err`);
              const raw = readFileSync(errPath, "utf-8").trim();
              if (raw) stderrTail = `\nRunner stderr (tail):\n${raw.slice(-2000)}`;
            } catch { /* no stderr captured (pre-forensics spawn or clean silence) */ }
            markFailed(agentDir, a.id, "heartbeat stale — process died without updating status" + stderrTail, {
              stopReason: "killed",
              filesTouched: [],
              elapsedMs: Date.now() - a.startedAt,
              toolCallCount: 0,
              endedAt: new Date().toISOString(),
            });
          }
        }
        const stillRunning = loadRegistry(agentDir).filter(a => a.status === "running");
        if (stillRunning.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }

      const active = loadRegistry(agentDir);
      const harvested: string[] = [];
      for (const a of active) {
        // Gate on status alone — empty a.result (thinking-only last message)
        // must still be harvested, otherwise the entry leaks forever.
        if (a.status === "done") {
          const body = a.result || "(no output)";
          harvested.push(`[Background Agent Complete: ${a.name} ✓]\nTask: ${a.task}\n\n${body}${formatExitHint(a.exit, projectDir)}`);
          removeAgent(agentDir, a.id);
        } else if (a.status === "failed") {
          harvested.push(`[Background Agent Failed: ${a.name} ✗]\nTask: ${a.task}\n\n${a.result || "Unknown error"}${formatExitHint(a.exit, projectDir)}`);
          removeAgent(agentDir, a.id);
        }
      }

      const remaining = loadRegistry(agentDir).filter(a => a.status === "running");
      let body: string;
      if (harvested.length === 0 && remaining.length === 0) {
        body = "No background agents were running.";
      } else if (remaining.length > 0) {
        body = `Timeout (${timeout}ms) reached with ${remaining.length} agent(s) still running: ${remaining.map(a => a.id).join(", ")}.`;
        if (harvested.length > 0) body += `\n\nHarvested ${harvested.length}:\n\n` + harvested.join("\n\n---\n\n");
      } else {
        body = `${harvested.length} background agent(s) completed:\n\n` + harvested.join("\n\n---\n\n");
      }
      return body;
}
