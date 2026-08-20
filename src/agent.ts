/**
 * Research Agent — assembles the five layers on top of agent-core.
 *
 * Layer 1: System Prompt (from agents/definitions/brain.md)
 * Layer 2: Tools (tools/index.ts) + PI review tool
 * Layer 3: transformContext (context.ts)
 * Layer 4: Hooks (hooks.ts)
 * Layer 5: PI Monitor — adversarial quality reviewer (pi-agent.ts)
 *
 * Cross-cutting:
 * #1 LLM compaction, #2 API retry, #3 precise tokens, #4 parallel tools,
 * #5 session DAG, #6 cross-model transform, #7 custom messages, #8 extensions
 */

import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple, type TextContent } from "@earendil-works/pi-ai/compat";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefinition, resolvePrompt } from "./agents/registry.js";
import { resolveModel, spawnAgent, pickRequireToolChoice, streamWithRetry } from "./agents/spawn.js";
import { ensureMethodologyFile, ensureLiteratureFile } from "./methodology.js";
import { buildResearchTools, parseLatestPIVerdict } from "./tools/index.js";
import { buildContextTransformer, buildSemiStaticSystemLayer } from "./context.js";
import { buildResearchHooks } from "./hooks.js";
import { ReminderRegistry, builtinProviders } from "./reminders.js";
import { createPIReviewTool, setupPIFallbackMonitor } from "./pi-agent.js";
import { getApiKey } from "./auth.js";
import { convertToLlm } from "./messages.js";                    // #7: custom message types
import { cleanMessagesForModel } from "./transform.js";           // #6: cross-model compatibility
import { ExtensionBus } from "./extensions.js";                   // #8: extension system
import { Session, buildSessionContext, deriveState } from "./session.js"; // #5: session DAG
import { loadRegistry, removeAgent, tryExtractResult, formatExitHint } from "./active-agents.js";
import { installUsageTracking, readUsageTotals } from "./usage-log.js";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PIVerdict } from "./pi-agent.js";

// Default Anthropic prompt-cache TTL to 5m. Empirically on Luxas runs the
// cacheWrite/cacheRead ratio sits near 1:1 (mutable L3 + shifting context
// snapshots force frequent re-writes), so the 1h premium rarely amortizes —
// large writes with few reads overpay for the extended TTL. Gaps between
// brain turns are almost always < 5m because foreground spawns resume
// quickly. Override with PI_CACHE_RETENTION=long for workloads with proven
// long idle gaps (e.g. many >15min brain-side gaps).
process.env.PI_CACHE_RETENTION ||= "short";

// Parallel reader batches (the search-agent sweep pattern) fan out to 40+
// concurrent child_process.spawn calls, each adding SIGTERM/SIGINT cleanup
// listeners to the parent process. Node's default max is 10, which triggers
// a MaxListenersExceededWarning. The warning is benign but noisy and masks
// real listener leaks. Raise the cap once, at the brain entry point.
process.setMaxListeners(200);

export interface ResearchAgentOptions {
  projectDir: string;
  model?: string;              // "sonnet" | "opus" | "haiku" (default: opus)
  thinkingLevel?: ThinkingLevel;
  maxCostUsd?: number;
  /**
   * Turn-count budget. Process exits with code 1 on exceed (not block). See
   * the turn_end subscriber below for the kill path. Default 500 — typical
   * runs use 50-200; a stuck brain loop burns 500 turns in ~10 min capping
   * damage at ~$4 opus / $0.40 haiku.
   */
  maxTurns?: number;
  piFallbackInterval?: number; // auto PI review after N steps without check-in (default 50, 0 to disable)
  onPIVerdict?: (verdict: PIVerdict, toolCallCount: number) => void;
  /**
   * Optional `--directive` text. When present and containing a research-
   * implication keyword (simulate/verify/compare/analyze/模拟/验证/对比/实验
   * /分析), the finish gate requires at least one experiment directory under
   * data/experiments/ to have been modified since `sessionStartedAtMs`. See
   * Fix δ in tools/index.ts.
   */
  directive?: string;
  /**
   * True when this run resumed from an existing (unfinished) checkpoint. Scopes
   * the δ directive-gate: the "experiment modified since session start" mtime
   * check fires only on a fresh start, never on resume (prior-session
   * experiment mtimes are legitimately older than this process). The H7
   * scheme-symmetry content check still applies on resume.
   */
  resumedFromCheckpoint?: boolean;
}

// Brain model resolution is delegated to spawn.ts's resolveModel so the
// brain participates in the same MODEL_MAP + LUXAS_MODEL_PROFILE machinery
// as every sub-agent. Single source of truth: spawn.ts.

// Resolve paths for template variables
const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_SCRIPT_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "search");
const EXTRACT_FIGURES_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "extract-figures");
const MERGE_NOTES_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "merge-notes");
const VENUE_SPECIFIC_DIR = join(LUXAS_ROOT, "skills", "venue-specific") + "/";

export function createResearchAgent(opts: ResearchAgentOptions) {
  // Enforce absolute projectDir — all tools depend on this
  const projectDir = isAbsolute(opts.projectDir) ? opts.projectDir : resolve(opts.projectDir);

  const maxTurns = opts.maxTurns ?? 500;

  if (process.platform === "darwin") {
    try {
      execSync(`xattr -cr "${projectDir}"`, { stdio: "pipe" });
    } catch {}
  }

  // Model for the brain agent. resolveModel applies LUXAS_MODEL_PROFILE,
  // so when the user passes --model deepseek-v4-flash the whole stack
  // (brain + every anthropic-tier sub-agent) routes through deepseek; when
  // they pass --model opus, today's behavior is preserved.
  const modelKey = opts.model ?? "opus";
  const model = resolveModel(modelKey);
  const provider: string = (model as any).provider;
  const modelId: string = (model as any).id;
  const thinkingLevel = opts.thinkingLevel ?? "medium";

  // Template variables shared by brain and sub-agents
  const templateVars: Record<string, string> = {
    PROJECT_DIR: projectDir,
    SEARCH_SCRIPT: SEARCH_SCRIPT_PATH,
    EXTRACT_FIGURES: EXTRACT_FIGURES_PATH,
    MERGE_NOTES: MERGE_NOTES_PATH,
    VENUE_SPECIFIC_DIR: VENUE_SPECIFIC_DIR,
    // Cross-project memory writes (brain.md allowedWriteRoots) resolve
    // against this — write/edit to ~/.sisyphus/memory.md and archive/ are
    // whitelisted; auth.json stays credential-blocked unconditionally.
    SISYPHUS_DIR: join(homedir(), ".sisyphus"),
  };

  // System prompt: brain.md + smelt patches + semi-static per-project context
  // (RESEARCH.md + skills + lessons.md), merged into a single cache-pinned block.
  //
  // Cache breakpoints are placed by pi-ai, not here: TextContent lost its
  // `cacheControl` field in 0.84, and the Anthropic API layer now marks the
  // system prompt, the last tool definition, and the last user content block
  // itself (Claude Code's own 4-breakpoint layout). Under OAuth that yields two
  // pinned system blocks — the Claude Code identity line plus this prompt — so
  // L1+L2+L3 still ride in one cached block. Keeping this a single string is
  // what makes that block stable; smoke_prompt_assembly.mts pins the
  // determinism the cache depends on.
  //
  // L3-style execution-state content (active_agents, completed_artifacts,
  // plan_status) lives in the trailer snapshot now — see context.ts.
  const brainDef = getDefinition("brain");
  const systemTextBase = resolvePrompt(brainDef, templateVars);
  let systemText = systemTextBase;

  const semiStatic = buildSemiStaticSystemLayer(projectDir);
  if (semiStatic) {
    systemText = systemText + "\n\n" + semiStatic;
  }

  const systemPrompt = systemText;

  // Reminder system — event-driven, per-turn quality nudges
  const reminders = new ReminderRegistry();
  for (const p of builtinProviders) reminders.register(p);

  // #8: Extension bus (created early — hooks and context both need it)
  const bus = new ExtensionBus();

  // #5: Session DAG — open early so deriveState() can seed hooks/context/PI
  const agentDir = join(projectDir, ".agent");
  mkdirSync(agentDir, { recursive: true });
  const checkpointPath = join(agentDir, "checkpoint.jsonl");

  // Migrate legacy checkpoint format
  if (existsSync(checkpointPath)) {
    try {
      const firstLine = readFileSync(checkpointPath, "utf-8").split("\n")[0];
      const parsed = JSON.parse(firstLine);
      if (parsed.type !== "session") {
        renameSync(checkpointPath, checkpointPath + ".legacy");
      }
    } catch { /* corrupted — Session.open will overwrite */ }
  }

  const session = Session.open(checkpointPath, projectDir);
  const savedState = deriveState(session);

  // Usage tracking: wrap all API providers to append to usage.log (single source of truth)
  const usageLogPath = join(agentDir, "usage.log");
  installUsageTracking(usageLogPath);

  // Hooks must be created before tools
  // Reader dispatcher: serialized per-project via a promise chain so concurrent
  // downloads in one turn don't race on the shared notes files. Per-paper
  // dedup via an in-flight Set that drains on completion.
  const inFlightPapers = new Set<string>();
  let workerQueueTail: Promise<void> = Promise.resolve();
  const onPaperDownloaded = (paperId: string): void => {
    if (inFlightPapers.has(paperId)) return;
    inFlightPapers.add(paperId);
    // Scaffold both target files before spawning so a reader crash mid-run
    // can't leave a partially-written file that a sibling would clobber.
    ensureMethodologyFile(projectDir);
    ensureLiteratureFile(projectDir);
    workerQueueTail = workerQueueTail.catch(() => {}).then(async () => {
      const t0 = Date.now();
      try {
        const result = await spawnAgent({
          name: "reader",
          projectDir,
          templateVars: { PROJECT_DIR: projectDir, PAPER_ID: paperId },
          prompt: `Read paper ${paperId} and extract methodology coverage + literature entry per your system prompt. Targets: notes/methodology.md and notes/literature.md.`,
          getApiKey,
        });
        bus.emit({
          type: "reader_done",
          paperId, success: result.success,
          elapsedMs: Date.now() - t0,
          summary: result.output.slice(0, 300),
        });
      } catch (err: any) {
        bus.emit({ type: "reader_failed", paperId, error: String(err?.message ?? err) });
      } finally {
        inFlightPapers.delete(paperId);
      }
    });
    workerQueueTail.catch(() => {});  // terminal — absorb any rejection from bus.emit etc.
  };

  const hooks = buildResearchHooks({
    projectDir,
    maxCostUsd: opts.maxCostUsd,
    reminders,
    bus,
    usageLogPath,
    onPaperDownloaded,
    initialState: savedState ?? undefined,
  });

  // Check if PI already said STOP in a previous session (persisted in
  // pi_feedback.md). The file is append-only now, so substring matching
  // would false-positive on an old STOP superseded by a later verdict —
  // use the latest-verdict parser instead.
  if (parseLatestPIVerdict(projectDir)?.verdict === "stop") {
    hooks.setPIStopped();
  }

  // Layer 2: Tools (research tools + PI review tool)
  let finishCallback: (() => void) | undefined;
  // Set only when the brain finish tool's gated success path fires onFinish
  // (every "Cannot finish" branch returns before calling it). Read by
  // index.ts to distinguish a genuine completion from a process that exited
  // while blocked at a gate — so "✓ Done" and the registry don't lie.
  let finishSucceeded = false;
  const sessionStartedAtMs = Date.now();
  const directiveGate = opts.directive
    ? { directive: opts.directive, sessionStartedAtMs, isResume: !!opts.resumedFromCheckpoint }
    : undefined;
  const { tools, setParentAgent } = buildResearchTools(
    projectDir, templateVars, getApiKey,
    { onFinish: () => { finishSucceeded = true; finishCallback?.(); } },
    directiveGate,
  );

  const piMonitorOpts = {
    projectDir: projectDir,
    fallbackInterval: opts.piFallbackInterval ?? 50,
    initialState: savedState ? {
      totalToolCalls: savedState.piToolCalls,
      lastReviewAt: savedState.piLastReviewAt,
      reviewCount: savedState.piReviewCount,
    } : undefined,
    // Fix γ: pass the runtime --directive into PI's state so PI can verify
    // brain's claimed milestones against the directive's actual asks.
    userDirective: opts.directive,
    onVerdict: (verdict: PIVerdict, toolCallCount: number) => {
      if (verdict.verdict === "stop") {
        hooks.setPIStopped();
      }
      opts.onPIVerdict?.(verdict, toolCallCount);
    },
  };

  const piReview = opts.piFallbackInterval !== 0
    ? createPIReviewTool(piMonitorOpts)
    : null;

  if (piReview) {
    tools.push(piReview.tool);
  }

  // Layer 3: transformContext — universal compaction (ContextPacker) + brain research snapshot
  const { transformContext, tokenTap } = buildContextTransformer({
    projectDir: projectDir,
    model,
    getApiKey,
    bus,
    reminders,
    initialPreviousSummary: session.getCompactionSummary() ?? undefined,
    // Fix β: surface --directive in the Layer 3 trailer every turn.
    userDirective: opts.directive,
  });

  // Optional payload capture for cache-behavior diagnosis.
  // Enable via LUXAS_CAPTURE_PAYLOADS=1; writes each outbound request body to
  // .agent/payloads/<seq>.json so successive turns can be byte-diffed.
  const payloadCapture = process.env.LUXAS_CAPTURE_PAYLOADS === "1"
    ? (() => {
        const dir = join(projectDir, ".agent", "payloads");
        mkdirSync(dir, { recursive: true });
        let seq = 0;
        return (payload: unknown, _model: unknown) => {
          try {
            const n = String(++seq).padStart(4, "0");
            writeFileSync(join(dir, `${n}_${Date.now()}.json`), JSON.stringify(payload, null, 2));
          } catch {}
          return undefined;
        };
      })()
    : undefined;

  // Assemble Agent
  //
  // streamFn wrapper: force "must call a tool" on every API call. Closes a
  // silent-exit failure mode in pi-agent-core where the brain sometimes returns
  // a response with thinking blocks only (no text, no tool_use) with stopReason
  // "stop" (model voluntarily stops) or "length" (max_tokens truncated). The
  // loop in agent-loop.js:112-113 exits as soon as `toolCalls.length === 0`,
  // so these malformed responses silently terminate the session. Forcing the
  // require-a-tool tool_choice at the provider level guarantees every response
  // contains a tool_use block. Sisyphus's workflow is entirely tool-driven
  // (read/edit/bash/spawn_agent/finish/request_pi_review) — there is no
  // legitimate agent turn that returns text-only, so this constraint does
  // not break any expected behavior.
  //
  // Provider mapping: Anthropic uses "any"; OpenAI/DeepSeek's chat-completions
  // API expects "required"; reasoning-only models (deepseek-reasoner) reject
  // both and require "auto". pickRequireToolChoice resolves per-call from
  // (provider, reasoning) so the brain works under any of anthropic / openai
  // / openai-codex / deepseek (-chat or -reasoner).
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
    },
    transformContext,
    convertToLlm,                         // #7: custom message types → LLM format
    toolExecution: "parallel",            // #4: parallel tool execution
    maxRetryDelayMs: 120_000,             // #2: API retry — cap at 2 min
    beforeToolCall: hooks.before,
    afterToolCall: hooks.after,
    getApiKey,
    onPayload: payloadCapture,
    // F5-lite: use streamWithRetry so transient DeepSeek/OpenAI connection errors
    // (mid-stream "Connection error", ECONNRESET, "fetch failed", "terminated")
    // get exp-backoff retry instead of killing the brain session.
    streamFn: (m, ctx, opts) => streamWithRetry(m, ctx, { ...opts, toolChoice: pickRequireToolChoice(m) } as any),
  });

  // Wire deferred refs now that agent exists
  setParentAgent(agent);     // enables background spawn_agent with steer()
  finishCallback = () => agent.abort();

  // Install token tracking for ContextPacker (feeds precise token counts after first turn)
  tokenTap.install(agent);

  let lastCheckpointedMsgCount = 0;
  let turnCount = 0;

  // Track context size + emit events + persist messages + state to Session after each turn
  agent.subscribe((event: any) => {
    if (event.type === "message_update") {
      const msg = event.assistantMessageEvent;
      if (msg?.usage) {
        hooks.updateContextTokens(msg.usage);
      }
    }
    if (event.type === "message_end") {
      const msg = event.message;
      if (msg?.usage) {
        hooks.updateContextTokens(msg.usage);
        const totals = readUsageTotals(usageLogPath);
        bus.emit({
          type: "usage_update",
          cost: totals.cost,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
        });
      }
    }
    if (event.type === "turn_start") {
      bus.emit({ type: "turn_start" });
    }
    if (event.type === "turn_end") {
      const toolCalls = (event.message?.content ?? [])
        .filter((b: any) => b.type === "toolCall" || b.type === "tool_use").length;
      bus.emit({ type: "turn_end", message: event.message, toolCalls });
    }
    // Persist new messages + harness state to Session DAG after each completed turn
    if (event.type === "turn_end") {
      try {
        const messages = agent.state.messages;
        const sliced = messages.slice(lastCheckpointedMsgCount);
        // F7-mini: previously, assistant messages with stopReason="error" were
        // SILENTLY DROPPED here — meaning a mid-stream network failure left the
        // checkpoint with zero record of the failed attempt. Resume then saw
        // no evidence anything had happened. That's the "two state events 1.4s
        // apart, nothing between" pattern observed in today's silent death.
        // Now we keep dropping them from the conversation replay path (passing
        // them downstream would corrupt the next turn's context) but ALSO emit
        // a synthetic `error_attempt` event recording WHAT errored. studio's UI
        // and resume's diagnostics can surface this; replay still skips it.
        const newMessages = sliced.filter((m: any) => {
          if (m.role === "assistant" && m.stopReason === "error") return false;
          if (m.role === "assistant" && Array.isArray(m.content) && m.content.length === 0) return false;
          return true;
        });
        for (const m of sliced) {
          if (m.role === "assistant" && m.stopReason === "error") {
            try {
              const errMsg = (m as any).errorMessage ?? "(no errorMessage)";
              const contentPreview = Array.isArray(m.content)
                ? m.content.map((b: any) => b.type).join(",")
                : "(unknown)";
              session.append({
                type: "error_attempt" as const,
                stopReason: "error",
                errorMessage: String(errMsg).slice(0, 1000),
                contentPreview,
                timestamp: new Date().toISOString(),
              } as any);
            } catch { /* observability write must not break the turn */ }
          }
        }
        for (const m of newMessages) {
          session.appendMessage(m);
        }
        lastCheckpointedMsgCount = messages.length;

        // Persist harness state snapshot (stateless harness: JSONL is source of truth)
        const piState = piReview?.snapshotState() ?? { piToolCalls: 0, piLastReviewAt: 0, piReviewCount: 0 };
        session.append({
          type: "state" as const,
          ...hooks.snapshotState(),
          ...piState,
        });
      } catch (err: any) {
        if (err?.message?.startsWith("FATAL:")) {
          console.error("\n" + err.message + "\n");
          agent.abort();
          throw err;
        }
        // Swallow other errors (e.g. empty-message filter edge cases)
      }

      // Per-turn harvest: deliver done/failed background results while brain
      // is actively working. When brain has NO foreground work, it should
      // call the `idle` tool instead of end_turning — idle blocks with zero
      // LLM cost until backgrounds complete, then returns results as tool
      // output (see src/tools/index.ts idleTool). If brain forgets idle and
      // end_turns while bg is still running, the orphan is recovered on
      // next `luxas run` via the restore path below.
      turnCount++;

      // Turn-count kill-switch. Kill the process (not block tools) because
      // a `{block: true}` return from hooks.before just tells brain "tool
      // rejected", and brain emits another tool call = another full LLM
      // turn billed. Budget-exhaustion has no recovery; `process.exit(1)`
      // is the only way to stop runaway cost. Observed 2026-04-20: a
      // wall-clock-based block-retry loop burned ~$70 before detection.
      if (turnCount > maxTurns) {
        console.error(
          `\n[FATAL] Turn budget exceeded: ${turnCount} > ${maxTurns}. ` +
          `Killing process to stop runaway cost. ` +
          `Re-run with a larger maxTurns if this was intentional.\n`,
        );
        process.exit(1);
      }

      try {
        const active = loadRegistry(agentDir);
        for (const a of active) {
          // Gate on status alone. An empty `a.result` (possible when a sub-agent's
          // last assistant message was thinking-only) must not trap the entry in
          // the registry — render a sentinel instead.
          if (a.status === "done") {
            const body = (a.result || "(no output)").slice(0, 30_000);
            agent.steer({
              role: "user",
              content: `[Background Agent Complete: ${a.name} ✓]\nTask: ${a.task}\n\n${body}${formatExitHint(a.exit, projectDir)}`,
              timestamp: Date.now(),
            });
            removeAgent(agentDir, a.id);
          } else if (a.status === "failed") {
            agent.steer({
              role: "user",
              content: `[Background Agent Failed: ${a.name} ✗]\nTask: ${a.task}\n\n${a.result || "Unknown error"}${formatExitHint(a.exit, projectDir)}`,
              timestamp: Date.now(),
            });
            removeAgent(agentDir, a.id);
          }
        }
      } catch {}
    }
  });

  // Layer 5: PI fallback monitor
  let piFallback: ReturnType<typeof setupPIFallbackMonitor> | null = null;
  if (piReview) {
    piFallback = setupPIFallbackMonitor(agent, piReview, piMonitorOpts);
  }

  // #6: Restore from Session DAG with cross-model message cleaning
  const currentModel = { provider, id: modelId };
  const hasCheckpoint = session.getEntries().length > 0;
  const restore = hasCheckpoint ? () => {
    try {
      const messages = buildSessionContext(session);
      if (messages.length > 0) {
        const cleaned = cleanMessagesForModel(messages, currentModel);

        // Recover orphaned sub-agent results from active-agents registry
        const orphans = loadRegistry(agentDir);
        const recoveryLines: string[] = [];
        for (const orphan of orphans) {
          const result = tryExtractResult(orphan.conversationFile);
          if (result) {
            recoveryLines.push(`[Recovered: ${orphan.name}] Task: "${orphan.task}"\n${result.slice(0, 5000)}`);
          } else {
            recoveryLines.push(`[Lost: ${orphan.name}] Task "${orphan.task}" was interrupted. Decide whether to retry.`);
          }
          removeAgent(agentDir, orphan.id);
        }

        const resumeParts = [
          `[SESSION RESUMED] You have been restored from a checkpoint with ${cleaned.length} messages.`,
          `Your current state is in the research snapshot above (notes, report, memory).`,
          `Do NOT re-verify or re-read files you already know about.`,
          `Do NOT rewrite notes/memory.md unless you have new information.`,
          `Continue working from where you left off — check the research snapshot and your last actions to determine what to do next.`,
          `If PI feedback says STOP, finalize and stop immediately.`,
        ];
        if (recoveryLines.length > 0) {
          resumeParts.push(`\n--- Sub-agent recovery (${recoveryLines.length} orphan(s)) ---`);
          resumeParts.push(...recoveryLines);
        }

        cleaned.push({
          role: "user",
          content: resumeParts.join("\n"),
          timestamp: Date.now(),
        });
        agent.state.messages = cleaned;
        lastCheckpointedMsgCount = cleaned.length;
        return cleaned.length;
      }
    } catch {}
    return 0;
  } : null;

  return { agent, hooks, bus, session, piFallback, restore, checkpointPath, usageLogPath,
    didFinishSucceed: () => finishSucceeded };
}
