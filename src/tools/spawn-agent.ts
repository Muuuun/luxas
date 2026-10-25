/**
 * spawn_agent tool — the single generic tool for spawning sub-agents.
 *
 * Modes:
 *   - Foreground (default): brain blocks until agent finishes, gets result as tool output
 *   - Background (background=true): agent runs async, brain continues working,
 *     result injected via steer() when done
 *   - Parallel (tasks=[]): multiple agents run concurrently, brain blocks until all finish
 */

import { Type } from "@earendil-works/pi-ai/compat";
import type { Agent as AgentType } from "@earendil-works/pi-agent-core";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { spawnAgent, resolveModel, type SpawnAgentOptions, type SpawnAgentResult } from "../agents/spawn.js";
import { listAgentDescriptions, getDefinition } from "../agents/registry.js";
import { replicatorEstimateDefinition } from "../agents/registry.js";
import { nextReviewRound, priorBlindLines, quantityDeclarationProblems, reusableBlindLine } from "../claims-review.js";
import { addAgent, removeAgent, loadRegistry, isAlive, markFailed, tryExtractResult, formatExitHint, parseConvJsonl } from "../active-agents.js";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join, dirname, sep as pathSep } from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive } from "../utils.js";
import { runSweepSpawn, sweepMode } from "../contradiction-sweep.js";
import { softCapReached, SOFT_CAP_FRACTION } from "../usage-log.js";
import { buildClaimTable, parseFrameHeadline, parseResultsJson } from "../claims-table.js";
import { asksArtifactLine, clearReviewCopies, readBackLines, reviewArtifactsBlock, reviewImagesBlock } from "../review-images.js";
import { blindEstimateTask, extractBlindEstimate, extractReviewerLines, headlineDeclsFor, headlineDeclsOutOfScope, persistReview, reviewCompleteness, reviewerObligationBlock, selectBlindEstimateDecls, stampBlindInputs, cosmeticSpawnNotice } from "../claims-review.js";
import { checkModel, runVerifierSeat, seatEngine, seatLinesSummary, seatMode } from "../verifier-seat.js";

// Primary defense against path-escape via LLM-supplied id; the realpath check
// in handleContinue is defense-in-depth in case this regex is ever widened.
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;

const BG_N_RE = /-bg-(\d+)(?=\.|$)/g;

/**
 * Next background id, one past the highest bg-N on disk. A process counter
 * restarted at bg-1 in every resumed brain, so the new runner appended to the
 * previous process's transcript and a resume read one agent's result as
 * another's. Sources: transcripts, runner logs (opened at every launch, and
 * kept when the brain's restore empties the registry) and registry ids.
 * Synchronous, so no other launch in this process can take the same N before
 * the caller's addAgent records it.
 */
export function nextBackgroundId(agentDir: string): string {
  let max = 0;
  const scan = (name: string) => {
    for (const m of name.matchAll(BG_N_RE)) max = Math.max(max, Number(m[1]));
  };
  for (const sub of ["conversations", "runner-logs"]) {
    try { for (const f of readdirSync(join(agentDir, sub))) scan(f); } catch { /* not created yet */ }
  }
  for (const a of loadRegistry(agentDir)) if (typeof a.id === "string") scan(a.id);
  return `bg-${max + 1}`;
}

interface ContinueContext {
  projectDir: string;
  agentDir: string;
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
  parentAgentId?: string;
  depth?: number;
  makeSpawnTool: (parentId: string, childDepth: number, childAllowedTypes?: string[]) => any;
}

/**
 * Every run's results.json of one experiment as one digest ("" when there is
 * none). handleContinue reviews a continued experiment again only when it moved.
 */
export function experimentResultsFingerprint(projectDir: string, experimentId: string): string {
  const runsDir = join(projectDir, "data", "experiments", experimentId, "runs");
  let runs: string[];
  try { runs = readdirSync(runsDir).sort(); } catch { return ""; }
  const h = createHash("sha256");
  let any = false;
  for (const r of runs) {
    let body: Buffer;
    try { body = readFileSync(join(runsDir, r, "results.json")); } catch { continue; }
    h.update(r).update("\0").update(body).update("\0");
    any = true;
  }
  return any ? h.digest("hex") : "";
}

function errResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { success: false } };
}

function continueErr(body: string) {
  return errResult(`spawn_agent(action="continue"): ${body}`);
}

// O_EXCL lock with PID-staleness reclaim. Returns null on success (caller
// unlinks on release); returns a reason string on failure (suitable for
// surfacing to the LLM).
//
// Divergence from active-agents.ts:withRegistryLock: that one wraps a sync
// mutator on a single registry file with mtime-staleness + Atomics.wait
// retry. This one is per-agent path, held for the full async spawn duration,
// PID-staleness. Different enough that a shared helper would be cosmetic.
function acquireLock(lockPath: string): string | null {
  const writeOurPid = () => {
    const fd = openSync(lockPath, "wx");
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
  };
  try {
    writeOurPid();
    return null;
  } catch (err: any) {
    if (err.code !== "EEXIST") return err.message;
  }
  // EEXIST: probe holder PID. Dead → reclaim. Alive → bail.
  let holderPid: number | null = null;
  try {
    const n = Number(readFileSync(lockPath, "utf-8").trim());
    if (Number.isFinite(n) && n > 0) holderPid = n;
  } catch { /* lock vanished — treat as stale */ }
  if (holderPid !== null && pidAlive(holderPid)) {
    return `lock held by live pid=${holderPid} (delete ${lockPath} manually if you're sure)`;
  }
  try { unlinkSync(lockPath); } catch { /* race with another reclaimer */ }
  try {
    writeOurPid();
    return null;
  } catch (err: any) {
    return `acquisition failed after stale-reclaim: ${err.message}`;
  }
}

async function handleContinue(
  params: { id?: string; task?: string; templateVars?: Record<string, string> },
  ctx: ContinueContext,
): Promise<{ content: { type: "text"; text: string }[]; details: any }> {
  if (!params.id) return continueErr("`id` is required.");
  if (!params.task) return continueErr("`task` is required.");
  if (!AGENT_ID_RE.test(params.id)) {
    return continueErr(`invalid id "${params.id}". Allowed characters: [A-Za-z0-9._-].`);
  }
  if (params.templateVars && Object.keys(params.templateVars).length > 0) {
    return continueErr("templateVars are recovered from the original spawn_init marker — do not pass them again.");
  }

  const convDir = join(ctx.projectDir, ".agent", "conversations");
  const convPath = join(convDir, `${params.id}.jsonl`);

  // realpath throws ENOENT for missing files — doubles as our "no conv file" check.
  let resolvedDir: string;
  let resolvedPath: string;
  try {
    resolvedDir = realpathSync(convDir);
    resolvedPath = realpathSync(convPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return continueErr(`no conversation file for "${params.id}". Use action="spawn" to start fresh.`);
    }
    return continueErr(`path resolution failed for "${params.id}": ${err.message}`);
  }
  if (!resolvedPath.startsWith(resolvedDir + pathSep)) {
    return continueErr(`id "${params.id}" resolves outside the conversations dir.`);
  }

  // Lock BEFORE parse so two parallel continues can't both compute the same
  // revisionNumber off the same prior continueInits.length snapshot. With the
  // lock first, the second caller fails fast at acquireLock and never reads
  // a stale transcript.
  const lockPath = `${convPath}.lock`;
  const lockErr = acquireLock(lockPath);
  if (lockErr) return continueErr(`"${params.id}" lock acquisition failed: ${lockErr}.`);

  try {
    const { spawnInit, messages, continueInits } = parseConvJsonl(convPath);
    if (!spawnInit) {
      // Distinguish "background agent" (Session-wrapper schema) from "no marker
      // at all": the former is a known-unsupported case worth naming explicitly.
      let hint = "Use action=\"spawn\" instead.";
      try {
        const head = readFileSync(convPath, "utf-8").slice(0, 4096);
        if (/"type":\s*"session"/.test(head) || /"type":\s*"message"/.test(head)) {
          hint = "This looks like a background-agent transcript (Session wrapper format). action=\"continue\" only supports foreground/parallel-spawned agents.";
        }
      } catch { /* best-effort hint only */ }
      return continueErr(`"${params.id}" has no spawn_init marker. ${hint}`);
    }
    if (messages.length === 0) {
      return continueErr(`"${params.id}" has spawn_init but zero messages — original spawn likely failed before any turn. Re-spawn fresh.`);
    }

    // Cross-parent reach-in would let one agent steer another's children.
    const callerParent = ctx.parentAgentId ?? "brain";
    if (spawnInit.parentAgentId !== callerParent) {
      return continueErr(
        `"${params.id}" was spawned by "${spawnInit.parentAgentId ?? "(unknown)"}", not by you ("${callerParent}"). ` +
        `Only the original parent can continue an agent.`,
      );
    }

    let def;
    try {
      def = getDefinition(spawnInit.agent);
    } catch (err: any) {
      return continueErr(`agent type "${spawnInit.agent}" referenced by "${params.id}" is no longer registered. ${err.message}`);
    }

    // Required templateVars must be recoverable. A marker written before they
    // were persisted has none, and rebuilding the safety wrapper's path scopes
    // (e.g. EXPERIMENT_ID embedded in allowedWriteRoots) without them would
    // silently widen — refuse rather than gamble with blast radius. A marker
    // that has them holds exactly what the original spawn had: a template the
    // spawn left unset (experiment's optional ROLE) was unset then too, so the
    // rebuilt prompt and scopes match the fresh ones. Requiring it refused every
    // continue of an experiment spawned without a role.
    const recoveredTemplateVars = spawnInit.templateVars ?? {};
    const missing = spawnInit.templateVars ? [] : (def.templates ?? []).filter(t => t !== "PROJECT_DIR");
    if (missing.length > 0) {
      return continueErr(
        `cannot recover required template variables [${missing.join(", ")}] for "${params.id}" — ` +
        `the original spawn_init predates templateVars persistence. Spawn fresh with action="spawn", passing them explicitly.`,
      );
    }

    const mergedTemplateVars: Record<string, string> = {
      ...recoveredTemplateVars,
      PROJECT_DIR: ctx.projectDir,
    };
    // A continued experiment whose results moved gets the review a fresh spawn
    // gets. Before, a revision sent with action="continue" went straight back to
    // brain: y-magic's headline flipped that way after its last review and
    // reached the report unreviewed. A revision that leaves every results.json
    // as it was costs nothing extra.
    const experimentId = spawnInit.agent === "experiment" ? mergedTemplateVars.EXPERIMENT_ID : undefined;
    const resultsBefore = experimentId ? experimentResultsFingerprint(ctx.projectDir, String(experimentId)) : "";
    const revisionNumber = continueInits.length + 1;
    let result: SpawnAgentResult = await spawnAgent({
      name: spawnInit.agent,
      templateVars: mergedTemplateVars,
      prompt: params.task,
      // The rebuilt prompt picks its methods sheet from the task, so it must
      // see the spawn's whole task, not the revision's, to match the fresh prompt.
      contextExtra: { task: spawnInit.contextTask ?? spawnInit.task },
      projectDir: ctx.projectDir,
      getApiKey: ctx.getApiKey,
      parentAgentId: callerParent,
      createSpawnTool: ctx.makeSpawnTool,
      resume: { agentId: params.id, messages, revisionNumber },
    });
    if (experimentId && result.success && experimentResultsFingerprint(ctx.projectDir, String(experimentId)) !== resultsBefore) {
      result = await runExperimentReviewLoop(result, {
        projectDir: ctx.projectDir,
        mergedTemplateVars,
        baseOpts: {
          name: spawnInit.agent, templateVars: mergedTemplateVars, projectDir: ctx.projectDir,
          getApiKey: ctx.getApiKey, parentAgentId: callerParent, depth: ctx.depth ?? 0, createSpawnTool: ctx.makeSpawnTool,
        },
        initialTask: spawnInit.contextTask ?? spawnInit.task,
        getApiKey: ctx.getApiKey,
        parentAgentId: callerParent,
        depth: ctx.depth,
        makeSpawnTool: ctx.makeSpawnTool,
      });
    }

    const elapsedSec = Math.floor(result.elapsed / 1000);
    const header = `[agent continue: id=${params.id}, revision=${revisionNumber}, elapsed=${elapsedSec}s, success=${result.success}]`;
    const text = `${header}\n\n${result.output}${formatExitHint(result.exit, ctx.projectDir)}`;
    return {
      content: [{ type: "text" as const, text }],
      details: {
        elapsed: result.elapsed,
        success: result.success,
        exit: slimExit(result.exit),
        agentId: result.agentId,
        revisionNumber,
      },
    };
  } finally {
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}

// Project SubAgentExit to a slim shape for tool result `details` payloads.
// `partialAssistantText` can be MB-scale on length-truncated runs and there's
// no consumer for it inside the tool result envelope (callers that want it
// can fish it out of the in-memory result via the spawnAgent API).
function slimExit(exit: any) {
  return {
    stopReason: exit?.stopReason,
    elapsedMs: exit?.elapsedMs,
    toolCallCount: exit?.toolCallCount,
    lastContextTokens: exit?.lastContextTokens,
    recoveryAttemptsUsed: exit?.recoveryAttemptsUsed,
    revisionNumber: exit?.revisionNumber,
    endedAt: exit?.endedAt,
    filesTouched: exit?.filesTouched,
    errorMessage: exit?.errorMessage,
  };
}

// Zombie sweep threshold: subagent-runner touches the heartbeat every 30s
// (subagent-runner.ts:93). 5 minutes of silence = 10 missed beats = the
// runner is dead, whatever the registry entry claims.
const ZOMBIE_HEARTBEAT_MS = 5 * 60_000;

export function getActiveBackgroundAgents(projectDir?: string) {
  if (!projectDir) return [];
  const agentDir = join(projectDir, ".agent");
  const out: ReturnType<typeof loadRegistry> = [];
  for (const a of loadRegistry(agentDir)) {
    // done/failed entries await collection — they must not block finish().
    if (a.status && a.status !== "running") continue;
    // Liveness check (2026-07-09): a "running" entry whose markDone/markFailed
    // never fired is otherwise immortal — observed: 3 entries with heartbeats
    // 4h stale blocked finish() 357× until the 500-turn cap killed the run.
    // The isAlive machinery existed all along; this gate just never used it.
    if (!isAlive(agentDir, a.id, ZOMBIE_HEARTBEAT_MS)) {
      let stderrTail = "";
      try {
        const raw = readFileSync(join(agentDir, "runner-logs", `${a.id.replace(/[/\\]/g, "_")}.err`), "utf-8").trim();
        if (raw) stderrTail = `\nRunner stderr (tail):\n${raw.slice(-2000)}`;
      } catch { /* no forensics file — pre-capture spawn */ }
      markFailed(agentDir, a.id,
        "zombie-swept: heartbeat stale >5min — runner died without a completion callback" + stderrTail);
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Helper for callers (pi-agent.ts, runFigures) that need to pass a
 * `createSpawnTool` factory into `spawnAgent` without background capability.
 */

export interface ExperimentReviewContext {
  projectDir: string;
  /** The experiment's merged templateVars (EXPERIMENT_ID lives here). */
  mergedTemplateVars: Record<string, string>;
  /** Options that re-run the same experiment for a REVISE round. */
  baseOpts: Omit<SpawnAgentOptions, "prompt" | "instanceIndex">;
  initialTask: string;
  getApiKey: SpawnAgentOptions["getApiKey"];
  parentAgentId?: string;
  depth?: number;
  makeSpawnTool: (parentId: string, childDepth: number, childAllowedTypes?: string[]) => any;
  /** Injectable for the gate (scripts/smoke_background_review.mts); defaults to spawnAgent. */
  spawn?: (opts: SpawnAgentOptions) => Promise<SpawnAgentResult>;
  /**
   * Number of the first review round. Default: one past the highest round
   * already persisted for this EXPERIMENT_ID, so a re-dispatch continues the
   * numbering instead of overwriting r1.. (claims-table.ts and
   * openReviewFindings read every round). The brain's callers rely on it.
   */
  startRound?: number;
  /**
   * ESTIMATE(blind) lines from earlier rounds. Default: every such line in
   * this experiment's persisted rounds. A line whose stamped inputs still
   * match the declaration is reused and its id is not estimated again; an id
   * whose inputs moved is re-estimated. scripts/review_experiment.mts passes
   * [] for --blind (estimate every id again).
   */
  priorBlindLines?: string[];
  /**
   * The experiment ran outside this process (scripts/review_experiment.mts):
   * declaration problems are not sent back to it — that script reports them
   * itself — and nothing here spawns an experiment.
   */
  executorOutside?: boolean;
}

/**
 * Why a reviewer's reply is no review at all, as one line; null when it is a
 * review. spawnAgent returns "(no output)" for a refusal, a provider error past
 * its retries or an empty turn, and the failure text for a throw — read as
 * REVISE, that became the next revision's feedback. A VERDICT line or a
 * FEEDBACK block is a review whatever ended the agent; so is a terse critique
 * from a clean stop.
 */
export function reviewerGaveNoReview(r: { output?: string; success?: boolean; exit?: { stopReason?: string; errorMessage?: string } }): string | null {
  const text = r.output ?? "";
  if (/^\s*#{0,6}\s*VERDICT:\s*\w+/im.test(text)) return null;
  if ((text.match(/FEEDBACK:\s*([\s\S]*?)$/i)?.[1] ?? "").trim()) return null;
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!r.success) return oneLine(`spawn failed: ${text}`);
  const stop = r.exit?.stopReason;
  if (stop === "error" || stop === "killed") return oneLine(`stopReason ${stop}${r.exit?.errorMessage ? `: ${r.exit.errorMessage}` : ""}`);
  if (!text.trim() || text.trim() === "(no output)") return "empty output";
  return null;
}

/**
 * The reviewer's reply with its VERDICT and FEEDBACK labels in plain form.
 * DeepSeek reviewers bolded them ("**VERDICT: revise**" / "**FEEDBACK:**",
 * 67 of 345 final replies, April–June): the loop read that as REVISE but
 * persisted "VERDICT: (none)", so the finish gate never bound its issues, and
 * a bold satisfied paid for a re-run. Normalised once here, the persisted
 * round is canonical and the readers of reviews/ stay strict. Only the label
 * changes: "satisfied only after …" stays qualified.
 */
function canonicalReviewerReply(text: string): string {
  return text
    .replace(/^[\s#*_>]*VERDICT[*_\s]*:[*_\s]*(satisfied|revise)\b(\.?)[*_]*/im, (_m, v: string, dot: string) => `VERDICT: ${v.toLowerCase()}${dot}`)
    .replace(/^[\s#*_>]*FEEDBACK[*_\s]*:[*_]*/im, "FEEDBACK:");
}

/**
 * Harness-owned review of a completed experiment: blind estimates, then up to
 * LUXAS_MAX_REVIEW_ITERATIONS rounds of experiment_reviewer, re-running the
 * experiment on REVISE. Returns the (possibly revised) result with the
 * reviewer's verdict appended to its output.
 *
 * Called from EVERY path an experiment can finish on — foreground here, and
 * the detached background runner (subagent-runner.ts). Until 2026-09-24 it
 * lived inline in the foreground branch only, and background spawns returned
 * before reaching it: 5 of the last 7 runs spawned experiments in background,
 * and yttrium-tweezer's E1–E4 were never reviewed — which is where every
 * physics defect that reached its abstract lived
 * (notes/backtest-2026-09-24/bt-ytweezer.md).
 */
/**
 * Has this experiment delivered? One parseable results.json under runs/.
 * An experiment can return "success" without it: the solo executor comparison
 * (2026-10-06) had a run compute the right numbers and exit while waiting on
 * its own background job, and ba-qc's E9 reached its reviewer with no
 * results.json at all — a blind estimate and a review round spent on nothing.
 */
export function experimentDelivered(projectDir: string, experimentId: string): boolean {
  return experimentDeliveryProblem(projectDir, experimentId) === null;
}

/**
 * Why the experiment has not delivered, or null when it has. No file and a
 * file that does not parse need different answers from the agent, and the
 * re-send used to call both "does not exist", contradicting the file the agent
 * could see. Names the newest unusable file and its parse error.
 */
export function experimentDeliveryProblem(projectDir: string, experimentId: string): string | null {
  const rel = `data/experiments/${experimentId}/runs`;
  let runs: string[] = [];
  try { runs = readdirSync(join(projectDir, rel)); } catch { /* no runs/ */ }
  let problem: string | null = null;
  for (const r of runs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const p = join(projectDir, rel, r, "results.json");
    if (!existsSync(p)) continue;
    let j: unknown;
    try { j = parseResultsJson(readFileSync(p, "utf-8")); }
    catch (err) { problem = `${rel}/${r}/results.json is not valid JSON: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 160)}`; continue; }
    if (j && typeof j === "object" && !Array.isArray(j)) return null;
    problem = `${rel}/${r}/results.json is not a JSON object`;
  }
  return problem ?? `no results.json under ${rel}/run_N/`;
}

export async function runExperimentReviewLoop<R extends { output: string; success: boolean }>(
  initialResult: R,
  ctx: ExperimentReviewContext,
): Promise<R | SpawnAgentResult> {
  const { projectDir, mergedTemplateVars, baseOpts, initialTask, getApiKey, parentAgentId, depth, makeSpawnTool } = ctx;
  const spawn = ctx.spawn ?? spawnAgent;
  let result: R | SpawnAgentResult = initialResult;
  if (!result.success) return result;
    const experimentId = mergedTemplateVars.EXPERIMENT_ID;
    if (experimentId) {
      // A re-send or a revision is a fresh experiment run the harness starts
      // itself, where the brain's hook never sees it. Past the soft cap the
      // hook refuses exactly that (C4): what is left cannot pay for one, and
      // in the foreground the hard cap would kill the brain mid-run.
      const pastFreeze = () => softCapReached(join(projectDir, ".agent", "usage.log"), SOFT_CAP_FRACTION);
      const freezePct = Math.round(SOFT_CAP_FRACTION * 100);
      // Deliverable check, before any review money is spent: no usable
      // results.json means not delivered — send the experiment back once (the
      // same way a revision is), and if it still has none, return that fact
      // to brain instead of reviewing an empty directory.
      const problem = experimentDeliveryProblem(projectDir, String(experimentId));
      if (problem) {
        if (pastFreeze()) {
          return { ...result, output: result.output + `\n\n---\n[harness: experiment ${experimentId} returned without a usable results.json (${problem}) — NOT DELIVERED — not re-sent: past the ${freezePct}% cost freeze; not reviewed. Disclose it as undelivered.]` };
        }
        const missingTask =
          `# Not delivered — ${problem}.\n\n` +
          (problem.startsWith("no results.json")
            ? `You returned without writing it. `
            : `The file is there but cannot be read as one JSON object (a truncated write, a trailing comma, a Python repr in place of json.dump): repair it, or write it again from the outputs you already have. `) +
          `Do not start over: reuse what is already under ` +
          `data/experiments/${experimentId}/ (scripts, outputs, logs). If a computation you launched ` +
          `is still running or has finished since, read its output. Then write results.json per the ` +
          `contract and fill in your ledger section.\n\n## Original task (for reference)\n\n${initialTask}`;
        result = await spawn({ ...baseOpts, prompt: missingTask, contextExtra: { task: missingTask } });
        if (!result.success) return result;
        const still = experimentDeliveryProblem(projectDir, String(experimentId));
        if (still) {
          return { ...result, output: result.output + `\n\n---\n[harness: experiment ${experimentId} returned twice without a usable results.json (${still}) — NOT DELIVERED, not reviewed. Decide whether to re-dispatch it with a narrower task.]` };
        }
      }

      const claimNotes: string[] = [];
      // Declaration bookkeeping, before blind estimates and the review are
      // keyed on the ids: the producer that wrote results.json fixes its own
      // declarations in place, once. Otherwise the brain sees MALFORMED rows
      // and pays a whole re-run to fix bookkeeping (blender-02 2026-10-21:
      // run_2, $4.5 of $25, re-measured nothing; results.json was written by
      // a python script, so the write-time hook never ran). What is still
      // wrong after the one send-back goes to the brain as a note.
      let declNote = "";
      if (!ctx.executorOutside) {
        const declProblems = (): string[] => { try { return quantityDeclarationProblems(projectDir, String(experimentId), { fixableInPlace: true }); } catch { return []; } };
        const before = declProblems();
        if (before.length > 0 && !pastFreeze()) {
          const fixTask =
            `# Declarations to fix in place — bookkeeping only\n\n` +
            `You delivered results.json for ${experimentId}; its quantity declarations have these problems:\n\n` +
            before.map((p) => `- ${p}`).join("\n") +
            `\n\nEdit computed.quantities[] (and, where needed, the leaves its keys point at) in the latest run's results.json so each problem is gone: ` +
            `point a key at an existing numeric leaf or add a "value", rename an id, state an uncertainty with its uncertainty_source (0 for an exact or deterministic value). ` +
            `Do NOT recompute, re-run, or change any other file. If a fix would need a new computation, leave it and say which in one line.\n\n` +
            `## Original task (for reference)\n\n${initialTask}`;
          const fix = await spawn({ ...baseOpts, prompt: fixTask, contextExtra: { task: fixTask } });
          const after = declProblems();
          const note = !fix.success
            ? `declaration send-back failed (${String(fix.output ?? "").replace(/\s+/g, " ").slice(0, 120)}); ${before.length} problem(s) stand`
            : after.length === 0
              ? `${before.length} declaration problem(s) fixed in place by the producer before review`
              : `${before.length - after.length} of ${before.length} declaration problem(s) fixed in place; still open: ${after.map((p) => p.slice(0, 160)).join(" | ")}`;
          declNote = `[harness: ${note}]`;
        } else if (before.length > 0) {
          declNote = `[harness: ${before.length} declaration problem(s) not sent back — past the ${freezePct}% cost freeze: ${before.map((p) => p.slice(0, 160)).join(" | ")}]`;
        }
        if (declNote) claimNotes.push(declNote);
      }

      // Env-configurable. Default 3 preserves prior behavior.
      // Set LUXAS_MAX_REVIEW_ITERATIONS=1 for compute-heavy runs (Monte
      // Carlo sims) where 3 rounds × hours/round burns wallclock budget
      // and increases deepseek emit-tool-use bug risk. Set to 0 to skip
      // the auto-review loop entirely.
      const envCap = parseInt(process.env.LUXAS_MAX_REVIEW_ITERATIONS ?? "", 10);
      const MAX_REVIEW_ITERATIONS = Number.isFinite(envCap) && envCap >= 0 ? envCap : 3;
      const blindCapEnv = Number(process.env.LUXAS_BLIND_ESTIMATE_CAP);
      const BLIND_ESTIMATE_CAP = Number.isFinite(blindCapEnv) && blindCapEnv >= 0 ? blindCapEnv : 3;

      // Claims-first §3.5: the blind estimate is produced by the HARNESS
      // before the reviewer runs — "preregistered" cannot be enforced
      // inside one agent turn. A `replicator` in estimate mode sees the
      // observable sentence and input values only; its ESTIMATE(blind)
      // line is handed to the reviewer and persisted with the review so
      // claims-table.ts can read it. LUXAS_BLIND_ESTIMATE=0 disables.
      const scopeFor = () => {
        try { return headlineDeclsFor(buildClaimTable(projectDir), experimentId); }
        catch (err) { claimNotes.push(`[claim-table MALFORMED: ${(err as Error).message.slice(0, 120)} — no blind estimate or reviewer obligation could be computed]`); return []; }
      };
      // Declared headline ids the obligation leaves out are named to the reviewer.
      const outOfScopeFor = () => {
        try { return headlineDeclsOutOfScope(buildClaimTable(projectDir), experimentId); } catch { return []; }
      };
      let headlineDecls = scopeFor();
      let headlineIds = [...new Set(headlineDecls.map((d) => d.id))];
      // An earlier round's estimate stands while the inputs it was made
      // against have not moved; only the other ids are estimated below.
      const prior = ctx.priorBlindLines ?? priorBlindLines(projectDir, experimentId);
      const reused = new Set(headlineDecls.filter((d) => reusableBlindLine(prior, d)).map((d) => d.id));
      if (reused.size) claimNotes.push(`[blind estimates reused from earlier rounds: ${[...reused].join(", ")}]`);
      const fresh = new Map<string, string>();
      // Which seat sits before the reviewer (verifier-seat.ts seatMode): estimate (default, the
      // replicators below), check (the verifier seat, further down), or off.
      const seat = seatMode();
      if (MAX_REVIEW_ITERATIONS > 0 && seat === "estimate") {
        let settled = new Set<string>();
        // `corroborated` dropped from this union 2026-09-04 with the status
        // itself. It was always OR'd with `converging`, and every row that
        // could reach corroborated already satisfied converging's condition
        // (agreeing pair + σ), so the settled set is unchanged.
        try { settled = new Set(buildClaimTable(projectDir).rows.filter((r) => r.status === "converging").map((r) => r.id)); } catch { /* table malformed → estimate everything */ }
        // A reused id takes no slot under the cap.
        const { chosen, skipped } = selectBlindEstimateDecls(headlineDecls.filter((d) => !reused.has(d.id)), parseFrameHeadline(projectDir), BLIND_ESTIMATE_CAP, settled);
        if (skipped.length) claimNotes.push(`[blind estimates capped at ${BLIND_ESTIMATE_CAP}/round (frame ids first); not estimated this round: ${skipped.join(", ")}]`);
        // Each estimator writes only blind/<slug>/ and may not name
        // replication/ or another estimator's scratch, this round's or an
        // earlier one's (replicatorEstimateDefinition). The slug keeps an id
        // like "../replication" from becoming a path.
        const slugOf = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_") || "_";
        let earlierScratch: string[] = [];
        try {
          earlierScratch = readdirSync(join(projectDir, "data", "experiments", String(experimentId), "blind"), { withFileTypes: true })
            .filter((d) => d.isDirectory()).map((d) => d.name);
        } catch { /* no estimate has run here yet */ }
        const scratchSlugs = [...new Set([...chosen.map((d) => slugOf(d.id)), ...earlierScratch])];
        // Isolated roots make the estimators independent, so they run at once:
        // a round waits for its slowest estimate, not the sum (15–37 min each
        // on Dy). Concurrency is the cap, so raising LUXAS_BLIND_ESTIMATE_CAP
        // raises it too. The callback is async so that a synchronous throw
        // (task text, scope set-up, a non-async spawner) rejects that estimate
        // alone, not the review loop.
        const estimates = await Promise.allSettled(chosen.map(async (decl) => {
          const slug = slugOf(decl.id);
          const siblings = scratchSlugs.filter((s) => s !== slug);
          // The root replicatorEstimateDefinition enforces, from the same slug,
          // so the task never names a dir the wrapper would refuse.
          const scratchDir = `data/experiments/${experimentId}/blind/${slug}/`;
          const est = await spawn({
            name: "replicator",
            projectDir,
            templateVars: { ...mergedTemplateVars, QUANTITY_ID: decl.id, MODE: "estimate" },
            prompt: blindEstimateTask(decl, scratchDir),
            getApiKey,
            parentAgentId: `${parentAgentId ?? "brain"}.blind-estimate-${decl.id}`,
            depth: (depth ?? 0) + 1,
            createSpawnTool: makeSpawnTool,
            resolveDefinition: (n) => n === "replicator" ? replicatorEstimateDefinition(getDefinition("replicator"), slug, siblings) : getDefinition(n),
          });
          const raw = extractBlindEstimate(est.output ?? "", decl.id);
          return raw ? stampBlindInputs(raw, decl.inputs) : null;
        }));
        // Read back in declaration order, whatever order they finished in.
        estimates.forEach((s, i) => {
          const id = chosen[i].id;
          if (s.status === "rejected") {
            const why = s.reason instanceof Error ? s.reason.message : String(s.reason);
            claimNotes.push(`[blind estimator for ${id} failed: ${why.slice(0, 100)}]`);
          } else if (s.value) fresh.set(id, s.value);
          else claimNotes.push(`[blind estimator for ${id} returned no ESTIMATE(blind) line]`);
        });
      }
      // An earlier line made against inputs that have since moved is dropped
      // once its id has a current line (reused or fresh); with none (failed,
      // capped, settled, off) it stays, and the table calls it incomparable.
      const declOf = new Map(headlineDecls.map((d) => [d.id, d] as const));
      const blindLines: string[] = [
        ...prior.filter((l) => {
          const d = declOf.get(l.match(/^ESTIMATE\(blind\):\s*(\S+)/)?.[1] ?? "");
          return !d || !(reused.has(d.id) || fresh.has(d.id)) || reusableBlindLine([l], d) !== null;
        }),
        ...fresh.values(),
      ];
      // MAX=0 short-circuits the loop body and falls through to return.
      const firstRound = Math.max(1, Math.floor(ctx.startRound ?? nextReviewRound(projectDir, experimentId)));
      // Verifier seat (LUXAS_VERIFY_SEAT=check, src/verifier-seat.ts): in place of the estimators, one
      // replicator in check mode per round, on a clone of the project — recompute each headline id by its
      // own route before opening the producer's code, re-run the shipped code against results.json, toggle
      // the cause in each causal sentence of the ledger. Its replication/<id>/ files come back for the claim
      // table; its RECOMPUTED / RERUN / CONTROL lines go to the reviewer and into the review file. A seat
      // that fails leaves the review to run without it — never a REVISE, never a re-run of the experiment.
      let seatLines: string[] = [];
      const runSeat = async (round: number, discriminators: string[]) => {
        seatLines = [];
        const outOfScope = outOfScopeFor();
        if (!headlineDecls.length && !outOfScope.length) { claimNotes.push(`[verifier seat round ${round}: nothing to check — no declared headline quantity]`); return; }
        try {
          const r = await runVerifierSeat({
            projectDir, experimentId: String(experimentId), round, decls: headlineDecls, outOfScope, priorDiscriminators: discriminators,
            engine: seatEngine(), model: checkModel(), getApiKey, spawn, makeSpawnTool, parentAgentId, depth: (depth ?? 0) + 1, mergedTemplateVars,
          });
          seatLines = r.lines.map((l) => l.text);
          claimNotes.push(`[verifier seat round ${round} (${r.engine}, ${r.model}): ${seatLinesSummary(r.lines)}${r.harvested.length ? `; carried back ${r.harvested.map((h) => h.rel).join(", ")}` : ""}${r.listCostUsd !== undefined ? `; $${r.listCostUsd.toFixed(2)} list` : ""}; ${Math.round(r.durationMs / 60_000)} min]`);
          claimNotes.push(...r.notes.map((n) => `[verifier seat round ${round}: ${n}]`));
        } catch (err) {
          claimNotes.push(`[verifier seat round ${round} failed: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 200)} — the reviewer ran without it]`);
        }
      };
      if (MAX_REVIEW_ITERATIONS > 0 && seat === "check") await runSeat(firstRound, []);
      let obligation = reviewerObligationBlock(headlineIds, blindLines, outOfScopeFor(), seatLines);
      const lastRound = firstRound + MAX_REVIEW_ITERATIONS - 1;
      // With no review round the round outputs never carry the notes; the declaration one must still reach brain.
      if (MAX_REVIEW_ITERATIONS === 0 && declNote) result = { ...result, output: result.output + `\n\n---\n${declNote}` };
      // A reviewer that gave no review is spawned once more (spawnAgent gives
      // it a fresh id); a second silence is NOT REVIEWED below. Every reader
      // below (no-review test, satisfied test, FEEDBACK, persisted verdict)
      // sees the canonical labels.
      const spawnReviewer = async (opts: SpawnAgentOptions) => {
        const once = async () => { const r = await spawn(opts); return { ...r, output: canonicalReviewerReply(r.output ?? "") }; };
        const first = await once();
        return reviewerGaveNoReview(first) ? once() : first;
      };
      // The reviewer opens copies of saved models in the OS temp directory (review-images.ts); they go
      // when the loop ends, however it ends: by return or throw (the finally), and by process.exit, which is
      // how the hard cost cap and the unfunded-provider stop end a run from inside a model call such as the
      // reviewer's own (usage-log.ts). The loop body is not re-indented under this try.
      const dropCopies = () => clearReviewCopies(projectDir, String(experimentId));
      process.once("exit", dropCopies);
      try {
      for (let round = firstRound; round <= lastRound; round++) {
        // Built once per round: the prompt carries it, and the reply is read against what it asked for.
        const savedModels = reviewArtifactsBlock(projectDir, experimentId);
        const reviewResult = await spawnReviewer({
          name: "experiment_reviewer",
          projectDir,
          templateVars: { ...mergedTemplateVars },
          prompt:
            `Audit the completed experiment with EXPERIMENT_ID=${experimentId}. ` +
            `Read the matching L2 section in notes/experiments.md, its ` +
            `data/experiments/${experimentId}/runs/run_N/results.json, the referenced ` +
            `raw_data files, and the cited literature fragments under notes/literature.d/. ` +
            `Return a VERDICT: satisfied or VERDICT: revise with actionable FEEDBACK per ` +
            // Re-read every round: a revision writes a new run_N, and it is that run's images that need eyes.
            `your system prompt.` + obligation + reviewImagesBlock(projectDir, experimentId) + savedModels,
          getApiKey,
          parentAgentId: `${parentAgentId ?? "brain"}.experiment-review-${round}`,
          depth: (depth ?? 0) + 1,
          createSpawnTool: makeSpawnTool,
        });

        const verdictText = reviewResult.output ?? "";
        // Persist the reviewer's obligation lines (it has no write tool).
        // An incomplete review keeps its VERDICT/FEEDBACK (a substantive
        // critique is never discarded for a missing ritual line) but its
        // attestations are withheld and the quantities are NO REVIEW.
        const noReview = reviewerGaveNoReview(reviewResult);
        const reviewLines = extractReviewerLines(verdictText);
        // No review covers no quantity, whatever lines a dying reply left.
        const missing = noReview ? headlineIds : reviewCompleteness(reviewLines, headlineIds);
        const verdictLineMatch = verdictText.match(/^\s*#{0,6}\s*VERDICT:\s*\w+.*$/im);
        const feedbackForFile = (verdictText.match(/FEEDBACK:\s*([\s\S]*?)$/i) ?? [])[1];
        const verdictForFile = noReview ? `VERDICT: (none — reviewer gave no review: ${noReview})` : verdictLineMatch ? verdictLineMatch[0].trim() : "VERDICT: (none)";
        // The saved-model block asks for `artifact <path>: …` before the VERDICT line, and nothing kept
        // it: a model the reviewer measured and one it could not open both came back as SATISFIED
        // alone. Read only when the block was sent and asked for it, so a round without a saved model
        // persists and returns what it always did. Each kept line starts with "artifact" and holds no
        // line break, so no reader of the review file can take it for a verdict or an obligation line.
        const modelLines = !noReview && asksArtifactLine(savedModels) ? readBackLines(verdictText) : null;
        const modelRecord = !modelLines ? [] : modelLines.length ? modelLines : ["(none: a saved model was listed for the reviewer, and no `artifact …:` line was found in its reply)"];
        try { persistReview(projectDir, experimentId, round, blindLines, reviewLines, verdictForFile, missing, feedbackForFile, modelRecord, seatLines); }
        catch (err) { claimNotes.push(`[review persistence failed round ${round}: ${(err as Error).message.slice(0, 100)}]`); }
        if (missing.length > 0) claimNotes.push(`[experiment_reviewer round ${round}: NO REVIEW for ${missing.join(", ")} — DISCRIMINATOR/SCALING lines missing; attestations withheld]`);
        if (modelLines?.length) claimNotes.push(...modelLines.map((l) => `[experiment_reviewer round ${round}, saved-model read-back] ${l}`));
        else if (modelLines) claimNotes.push(`[experiment_reviewer round ${round}: a saved model was listed for the reviewer, and no \`artifact …:\` line was found in its reply (whether it re-opened the file is not known)]`);
        // Nothing to revise against: re-running the experiment on "(no output)"
        // would be paid for nothing, and the delivered result stands unreviewed.
        if (noReview) {
          result = {
            ...result,
            output:
              result.output +
              `\n\n---\n[experiment_reviewer round ${round}: NOT REVIEWED — the reviewer gave no review twice (${noReview}); the experiment was not re-run]` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
          };
          break;
        }
        // Anchor to a standalone verdict line — reviewer.md emits
        // "VERDICT: satisfied" as the LAST line. The old substring match
        // false-passed on prose like "I cannot return VERDICT: satisfied"
        // or "VERDICT: satisfied only after fixing X".
        const satisfied = /^\s*#{0,6}\s*VERDICT:\s*satisfied\b[.\s]*$/im.test(verdictText);
        if (satisfied) {
          result = {
            ...result,
            output:
              result.output +
              `\n\n---\n[experiment_reviewer round ${round}: SATISFIED]` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
          };
          break;
        }

        // Extract FEEDBACK block (machine contract with reviewer).
        const feedbackMatch = verdictText.match(/FEEDBACK:\s*([\s\S]*?)$/i);
        const feedback = feedbackMatch ? feedbackMatch[1].trim() : verdictText.trim();

        if (round === lastRound) {
          result = {
            ...result,
            output:
              result.output +
              `\n\n---\n[experiment_reviewer round ${round}: REVISE but iteration cap reached — accepting current state with open issues]\n\nOutstanding reviewer feedback:\n${feedback}` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
          };
          break;
        }
        // The review above is persisted with its FEEDBACK, so the open issues
        // reach the finish gate, and ledger_writer stays open in the freeze.
        if (pastFreeze()) {
          result = {
            ...result,
            output:
              result.output +
              `\n\n---\n[experiment_reviewer round ${round}: REVISE — not re-run: past the ${freezePct}% cost freeze; disclose or answer the open issues via ledger_writer]\n\nOutstanding reviewer feedback:\n${feedback}` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
          };
          break;
        }

        // Re-run the experiment with feedback as a follow-up task.
        // Tell the experiment agent explicitly to iterate on existing
        // artifacts rather than start fresh.
        const revisionTask =
          `# Revision round ${round} — experiment_reviewer voted REVISE.\n\n` +
          `Your previous run's L2 section + results.json have been audited. ` +
          `Address these issues, iterating on existing data/experiments/${experimentId}/ ` +
          `artifacts (scripts, tests, runs/). Do NOT start from scratch; reuse or extend.\n\n` +
          `## Reviewer feedback\n\n${feedback}\n\n` +
          `## Original task (for reference)\n\n${initialTask}`;
        const delivered = result;
        result = await spawn({ ...baseOpts, prompt: revisionTask, contextExtra: { task: revisionTask } });
        // A provider error ends the agent gracefully (success:true,
        // stopReason=error). Either way there is no new delivery to pay a
        // reviewer round for, and its own text is only the failure: report it
        // as failed with the last delivered output and the unanswered feedback.
        if (!result.success || result.exit?.stopReason === "error") {
          const why = (result.exit?.errorMessage || result.output.split("\n")[0]).slice(0, 200);
          result = {
            ...result,
            success: false,
            output:
              delivered.output +
              `\n\n---\n[experiment_reviewer round ${round}: REVISE — the revision run failed (stopReason=${result.exit?.stopReason}: ${why}); the output above is the last delivered run; artifacts on disk may be partly revised]\n\nOutstanding reviewer feedback:\n${feedback}` + (claimNotes.length ? `\n${claimNotes.join("\n")}` : ""),
          };
          break;
        }
        // The revision may have re-declared quantities: recompute the
        // obligation scope for the next round (blind lines are reused).
        headlineDecls = scopeFor();
        headlineIds = [...new Set(headlineDecls.map((d) => d.id))];
        // The revision changed files: a fresh clone, and the reviewer's DISCRIMINATOR lines to execute.
        if (seat === "check") await runSeat(round + 1, reviewLines.filter((l) => l.kind === "DISCRIMINATOR").map((l) => l.text));
        obligation = reviewerObligationBlock(headlineIds, blindLines, outOfScopeFor(), seatLines);
      }
      } finally { process.removeListener("exit", dropCopies); dropCopies(); }
    }
  return result;
}

export function createSpawnToolFactory(
  projectDir: string,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
) {
  return (parentId: string, childDepth: number, childAllowedTypes?: string[]) =>
    createSpawnAgentTool(projectDir, {}, getApiKey, parentId, childDepth, undefined, childAllowedTypes);
}

export function createSpawnAgentTool(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  parentAgentId?: string,
  depth?: number,
  /** Reference to the parent Agent instance — needed for steer() on background completion */
  parentAgent?: AgentType,
  /** If set, restricts which sub-agent names this parent may spawn. */
  allowedTypes?: string[],
) {
  const agentDir = join(projectDir, ".agent");
  const luxasRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const allAgents = listAgentDescriptions();
  const agents = allowedTypes
    ? allAgents.filter(a => allowedTypes.includes(a.name))
    : allAgents;
  const agentCatalog = agents
    .map(a => `- **${a.name}**: ${a.description}${a.canSpawn ? " (can spawn sub-agents)" : ""}`)
    .join("\n");

  const SpawnParams = Type.Object({
    agent: Type.Optional(Type.String({
      description: `Agent type to spawn. Available: ${agents.map(a => a.name).join(", ")}. Required for action="spawn" (default); ignored for action="status" / action="continue" (the agent type is recovered from the spawn_init marker of the referenced id).`,
    })),
    task: Type.Optional(Type.String({
      description: 'For action="spawn": the initial task. For action="continue": the new user message (e.g. pytest output + fix request) to deliver to the previously-spawned agent. Use this OR `tasks` (array form). Required for single/background spawns and for continue.',
    })),
    tasks: Type.Optional(Type.Array(Type.String(), {
      description: "For parallel execution: array of tasks. Spawns one agent instance per task, runs them concurrently. Mutually exclusive with a singular `task`. Only valid for action=\"spawn\".",
    })),
    background: Type.Optional(Type.Boolean({
      description: "Run in background — you continue working while this agent runs. Results are delivered back as a message when done. Use for long-running tasks (sub-brain, complex experiments) that you don't need to wait for.",
    })),
    thinkingLevel: Type.Optional(Type.String({
      description: 'Override thinking level: "off", "low", "medium", "high". Defaults to the agent definition\'s level.',
    })),
    action: Type.Optional(Type.String({
      description:
        '"spawn" (default), "status", or "continue".\n' +
        '  - spawn: create a new agent (provide `agent` + `task`/`tasks`).\n' +
        '  - status: query a background agent (provide `id`).\n' +
        '  - continue: deliver a follow-up `task` to a previously-spawned FOREGROUND or PARALLEL agent identified by `id`. Reloads the agent\'s prior conversation transcript so it retains its working memory of what it wrote and considered. Use this for tool_impl revision loops — calling spawn again with a new task creates a cold-start agent with no memory of prior attempts and tends to produce a Frankenstein file across uncoordinated rewrites. The result\'s exit.revisionNumber tracks how many continues this agent has had (1-indexed); enforce your per-tool revision cap from that. NOT supported for background agents (their transcripts use a different schema).',
    })),
    id: Type.Optional(Type.String({
      description: 'Agent ID. Required when action="status" or action="continue". Foreground/parallel/background spawns return their agentId in the result text — copy it from there.',
    })),
    templateVars: Type.Optional(Type.Record(Type.String(), Type.String(), {
      description: 'Per-call template variables substituted into the sub-agent\'s system prompt (e.g. {PAPER_ID: "2301.07041"} for the reader agent). PROJECT_DIR is always injected automatically; do not set it here. Forwarded through to both foreground and background spawns. For action="continue" templateVars are recovered from the original spawn_init marker — do NOT pass them again.',
    })),
  });

  /**
   * Factory for creating a spawn_agent tool scoped to a specific parent.
   * Used by spawn.ts when the parent's `spawn.enabled` is true to give
   * sub-agents their own spawn tool.
   */
  function makeSpawnTool(parentId: string, childDepth: number, childAllowedTypes?: string[]): any {
    // Sub-agents don't get background capability (no parentAgent ref to steer)
    return createSpawnAgentTool(projectDir, templateVars, getApiKey, parentId, childDepth, undefined, childAllowedTypes);
  }

  return {
    name: "spawn_agent",
    label: "Spawn Agent",
    description:
      "Spawn a sub-agent to handle a task. Choose the agent type based on the task.\n\n" +
      "Available agents:\n" + agentCatalog + "\n\n" +
      "For parallel work spawning the SAME agent with multiple task strings (shared template vars), use `tasks`:\n" +
      'spawn_agent(agent="worker", tasks=["read paper A", "read paper B"])\n\n' +
      "To spawn multiple instances with DIFFERENT template vars (e.g. one reader per PAPER_ID), emit multiple spawn_agent calls in the same turn — the harness runs tool calls in parallel:\n" +
      'spawn_agent(agent="reader", task="Read paper 2301.07041", templateVars={PAPER_ID: "2301.07041"})\n' +
      'spawn_agent(agent="reader", task="Read paper 2405.12345", templateVars={PAPER_ID: "2405.12345"})\n\n' +
      "For long-running tasks, use `background: true` — you continue working while the agent runs.\n" +
      "Results are delivered back as a message when done. Good for sub-brain research tasks.\n" +
      'spawn_agent(agent="brain", task="investigate sub-topic X in depth", background=true)\n\n' +
      "Common mistakes to avoid:\n" +
      '  ✗ spawn_agent(agent="worker", tasks=[{"task": "..."}])    — `tasks` must be string[], not object[]\n' +
      '  ✗ spawn_agent(action={"type": "spawn", agent: "..."})    — no `action` wrapper; pass fields at top level\n' +
      '  ✗ spawn_agent(agent="worker", task=["a", "b"])            — `task` is a single string; use `tasks` for arrays\n' +
      "If you need to pass multiple sub-instructions to one agent, concatenate them into a single string using " +
      "newlines or bullet points inside `task`.",
    parameters: SpawnParams,

    async execute(
      _toolCallId: string,
      params: { agent?: string; task?: string; tasks?: string[]; background?: boolean; thinkingLevel?: string; action?: string; id?: string; templateVars?: Record<string, string> },
    ) {
      const action = params.action ?? "spawn";
      if (action !== "spawn" && action !== "status" && action !== "continue") {
        return errResult(`spawn_agent: unknown action "${action}". Allowed: "spawn", "status", "continue".`);
      }

      if (action === "continue") {
        return await handleContinue(
          params,
          { projectDir, agentDir, getApiKey, parentAgentId, depth, makeSpawnTool },
        );
      }

      // ── Status query ──
      if (action === "status") {
        if (!params.id) return errResult('spawn_agent(action="status"): `id` is required.');
        const reg = loadRegistry(agentDir);
        const entry = reg.find(a => a.id === params.id);
        if (!entry) {
          return errResult(`No active agent with id "${params.id}".`);
        }
        const alive = isAlive(agentDir, params.id);
        const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000);
        const status = entry.status === "done" ? "done" : entry.status === "failed" ? "failed" : alive ? "running" : "dead";

        // For completed agents the frozen `entry.result` + structured `entry.exit`
        // are authoritative — they came from markDone/markFailed and reflect the
        // terminal state. Fall back to the live conversation preview only for
        // still-running agents (or entries with no result yet).
        const terminalBody = (entry.status === "done" || entry.status === "failed")
          ? (entry.result || (entry.status === "failed" ? "Unknown error" : "(no output)"))
          : null;
        const recent = terminalBody ?? tryExtractResult(entry.conversationFile);
        const bodyLabel = terminalBody !== null ? "Final result" : "Last completed turn";

        const lines = [
          `Agent: ${entry.id}`,
          `Status: ${status} (${elapsed}s)`,
          `Task: ${entry.task}`,
          recent ? `\n${bodyLabel}:\n${recent.slice(0, 5000)}` : "\nNo output yet.",
        ];
        const body = lines.join("\n") + formatExitHint(entry.exit, projectDir);
        return { content: [{ type: "text" as const, text: body }], details: { success: true, exit: slimExit(entry.exit) } };
      }

      // Spawn-only from here: require agent name explicitly.
      if (!params.agent) {
        return errResult('spawn_agent: `agent` is required for action="spawn".');
      }

      try {
        getDefinition(params.agent);
      } catch (err: any) {
        return errResult(err.message);
      }

      // Normalize `task` / `tasks` into a single list. Downstream code only
      // reads taskList; the string-vs-array distinction is surface syntax.
      const taskList: string[] = params.tasks && params.tasks.length > 0
        ? params.tasks
        : params.task !== undefined
          ? [params.task]
          : [];
      if (taskList.length === 0) {
        return errResult('spawn_agent: must provide either `task` (string) or `tasks` (non-empty array of strings).');
      }
      if (params.background && taskList.length > 1) {
        return errResult('spawn_agent: `background` mode expects a single task. Spawn each background task with its own call.');
      }

      if (allowedTypes && !allowedTypes.includes(params.agent)) {
        return errResult(`spawn_agent: agent "${params.agent}" is not whitelisted for this parent. Allowed: ${allowedTypes.join(", ")}.`);
      }

      // The sweep is one request (contradiction-sweep.ts), background or not.
      // When it cannot be (too large, failed twice, unreadable), the agent below runs.
      if (params.agent === "contradiction_auditor" && sweepMode() === "single-request") {
        const cosmetic = cosmeticSpawnNotice(projectDir, params.agent);
        if (cosmetic.refuse) return errResult(cosmetic.notice);
        const sweep = await runSweepSpawn({ projectDir, parentAgentId, getApiKey });
        if ("text" in sweep) {
          const note = `${cosmetic.notice ? cosmetic.notice + "\n\n" : ""}${params.background ? "(Ran in the foreground as one request: there is nothing to poll.)\n" : ""}`;
          return { content: [{ type: "text" as const, text: note + sweep.text }], details: { success: true, agentId: sweep.agentId } };
        }
        console.error(`[sweep] one request did not produce a sweep (${sweep.fallback}); running the contradiction_auditor agent`);
      }

      // Merge per-call templateVars over the factory defaults (PROJECT_DIR etc).
      // The factory defaults win for PROJECT_DIR to avoid letting a caller
      // redirect the sub-agent at a different project.
      const mergedTemplateVars = {
        ...(params.templateVars ?? {}),
        ...templateVars,
      };
      const baseOpts: Omit<SpawnAgentOptions, "prompt" | "instanceIndex"> = {
        name: params.agent,
        templateVars: mergedTemplateVars,
        projectDir,
        getApiKey,
        parentAgentId: parentAgentId ?? "brain",
        depth: depth ?? 0,
        createSpawnTool: makeSpawnTool,
      };

      if (params.thinkingLevel) {
        const def = getDefinition(params.agent);
        if (params.thinkingLevel !== def.thinkingLevel) {
          if (params.thinkingLevel === "high") {
            baseOpts.modelOverride = "opus";
          }
        }
      }

      // ── Background mode — independent process ──
      if (params.background) {
        const task = taskList[0];
        const bgId = nextBackgroundId(agentDir);
        const taskPreview = task.slice(0, 80);
        const agentId = `${parentAgentId ?? "brain"}.${params.agent}-${bgId}`;
        const convFile = join(agentDir, "conversations", `${agentId}.jsonl`);

        // Forward the merged templateVars to the subprocess so background
        // spawns see the same vars as foreground. PROJECT_DIR is re-injected
        // by the subagent-runner and stripped here to keep callers from
        // redirecting the sub-agent at a different project.
        const bgTemplateVars: Record<string, string> = { ...mergedTemplateVars };
        delete bgTemplateVars.PROJECT_DIR;

        const args = [
          "--import=tsx",
          join(luxasRoot, "src", "subagent-runner.ts"),
          "--agent", params.agent,
          "--task", task,
          "--project", projectDir,
          "--id", agentId,
          "--session", convFile,
        ];
        if (Object.keys(bgTemplateVars).length > 0) {
          args.push("--template-vars", JSON.stringify(bgTemplateVars));
        }

        // Crash forensics (2026-07-10): stdio:"ignore" discarded every crash's
        // stack trace — including V8 OOM aborts, which no in-process handler
        // can catch. The runner's own last-resort console.error existed all
        // along and wrote to /dev/null. Reader of these files: the failure
        // report in getActiveBackgroundAgents' zombie sweep path and whoever
        // triages the next death.
        let stdio: ("ignore" | number)[] = ["ignore", "ignore", "ignore"];
        let errFd: number | null = null;
        try {
          const logDir = join(agentDir, "runner-logs");
          mkdirSync(logDir, { recursive: true });
          errFd = openSync(join(logDir, `${agentId.replace(/[/\\]/g, "_")}.err`), "a");
          stdio = ["ignore", errFd, errFd];
        } catch { /* forensics must not block the spawn */ }
        const child = spawn("node", args, {
          detached: true,
          stdio,
        });
        if (errFd !== null) { try { closeSync(errFd); } catch { /* child holds its own copy */ } }
        child.unref();

        // Mirror to log.jsonl so studio's SSE tail surfaces background spawns
        // immediately. Background spawns bypass spawn.ts (they exec a detached
        // node subagent-runner.ts), so the spawn.ts mirror doesn't fire here.
        // Shape matches hooks.ts plus phase:"started"; snake_case agent_id /
        // parent_agent_id matches studio's pickSpawnTarget.
        try {
          appendFileSync(
            join(agentDir, "log.jsonl"),
            JSON.stringify({
              type: "tool_call",
              tool: "spawn_agent",
              phase: "started",
              args: { agent: params.agent, agent_id: agentId, parent_agent_id: parentAgentId, background: true },
              success: true,
              timestamp: new Date().toISOString(),
            }) + "\n",
          );
        } catch { /* observability must not crash the spawn */ }

        addAgent(agentDir, {
          id: agentId,
          name: params.agent,
          task: taskPreview,
          mode: "background",
          startedAt: Date.now(),
          conversationFile: convFile,
          pid: child.pid,
          status: "running",
        });

        return {
          content: [{ type: "text" as const, text: `Background agent "${params.agent}" launched as independent process (${agentId}, pid=${child.pid}). It will survive if this session crashes.\nTask: ${taskPreview}\nUse spawn_agent(action="status", id="${agentId}") to check progress.` }],
          details: { backgroundId: bgId, agentId, pid: child.pid, success: true },
        };
      }

      // ── Parallel mode ──
      // Parallel tasks share one templateVars, hence one EXPERIMENT_ID: N
      // experiments would write one directory and get one review. Refused
      // rather than silently unreviewed (runExperimentReviewLoop).
      if (taskList.length > 1 && params.agent === "experiment") {
        return errResult('spawn_agent: parallel `tasks` are not supported for agent="experiment" — each experiment needs its own EXPERIMENT_ID and its own review. Spawn each one separately (background=true runs them concurrently).');
      }
      if (taskList.length > 1) {
        const results = await Promise.all(
          taskList.map((task, i) =>
            spawnAgent({ ...baseOpts, prompt: task, contextExtra: { task }, instanceIndex: i })
          ),
        );

        const summary = results.map((r, i) => {
          const icon = r.success ? "✓" : "✗";
          const secs = Math.floor(r.elapsed / 1000);
          return `## Task ${i + 1} ${icon} (${secs}s) [agent: ${r.agentId}]\n\n${r.output}${formatExitHint(r.exit, projectDir)}`;
        }).join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: summary }],
          details: {
            results: results.map(r => ({
              elapsed: r.elapsed,
              success: r.success,
              exit: slimExit(r.exit),
              agentId: r.agentId,
            })),
          },
        };
      }

      // ── Foreground mode (default) ──
      const initialTask = taskList[0];
      const cosmetic = cosmeticSpawnNotice(projectDir, params.agent);
      if (cosmetic.refuse) return errResult(cosmetic.notice);
      let result = await spawnAgent({ ...baseOpts, prompt: initialTask, contextExtra: { task: initialTask } });

      // Auto-review loop (runExperimentReviewLoop — the background runner
      // calls the same function): after an experiment completes, spawn
      // the experiment_reviewer to audit its L2 section + results + cited
      // literature. If the reviewer votes revise, re-run the experiment
      // with the feedback injected as a follow-up task. Bounded at 3
      // iterations to cap cost. Replaces the old self-written "### Red
      // team" section — the independent-auditor pattern (same as the
      // tool_impl / tool_review split) prevents template-filling
      // self-deflection.
      if (params.agent === "experiment") {
        result = await runExperimentReviewLoop(result, {
          projectDir, mergedTemplateVars, baseOpts, initialTask,
          getApiKey, parentAgentId, depth, makeSpawnTool,
        });
      }

      // v3 D2: stamp the model that produced a replication so same-model-same-route is wiring.
      if (params.agent === "replicator" && mergedTemplateVars.EXPERIMENT_ID) {
        // Each replicator writes replication/<QID>[-N]/results.json (the legacy
        // shared file is still read); stamp whichever of them is unstamped.
        const repDir = join(projectDir, "data", "experiments", String(mergedTemplateVars.EXPERIMENT_ID), "replication");
        const qid = String(mergedTemplateVars.QUANTITY_ID ?? "");
        let names: string[] = [];
        try { names = readdirSync(repDir).filter((n) => !!qid && (n === qid || (n.startsWith(`${qid}-`) && /^\d+$/.test(n.slice(qid.length + 1))))); } catch { /* none */ }
        for (const rel of ["results.json", ...names.map((n) => join(n, "results.json"))]) {
          try {
            const rp = join(repDir, rel);
            if (!existsSync(rp)) continue;
            const j = JSON.parse(readFileSync(rp, "utf-8"));
            if (j && typeof j === "object" && !j.model) { j.model = String(resolveModel("opus", "replicator")?.id ?? "unknown"); writeFileSync(rp, JSON.stringify(j, null, 2) + "\n"); }
          } catch { /* stamping is best-effort */ }
        }
      }
      return {
        content: [{ type: "text" as const, text: `${cosmetic.notice ? cosmetic.notice + "\n\n" : ""}[agent: ${result.agentId}]\n${result.output}${formatExitHint(result.exit, projectDir)}` }],
        details: { elapsed: result.elapsed, success: result.success, exit: slimExit(result.exit), agentId: result.agentId },
      };
    },

    _makeSpawnTool: makeSpawnTool,
  };
}
