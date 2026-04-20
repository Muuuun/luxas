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

import { Agent } from "@mariozechner/pi-agent-core";
import {
  nameAgent, createSmeltReminderProvider,
  readPatches, applyPatches, DEFAULT_BASE_DIR,
} from "agentsmelt";
import { getModel, type TextContent } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, isAbsolute, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefinition, resolvePrompt } from "./agents/registry.js";
import { spawnAgent } from "./agents/spawn.js";
import { ensureMethodologyFile, ensureLiteratureFile } from "./methodology.js";
import { buildResearchTools } from "./tools/index.js";
import { buildContextTransformer, buildSemiStaticSystemLayer } from "./context.js";
import { buildResearchHooks } from "./hooks.js";
import { ReminderRegistry, builtinProviders } from "./reminders.js";
import { createPIReviewTool, setupPIFallbackMonitor } from "./pi-agent.js";
import { getApiKey } from "./auth.js";
import { convertToLlm } from "./messages.js";                    // #7: custom message types
import { cleanMessagesForModel } from "./transform.js";           // #6: cross-model compatibility
import { ExtensionBus } from "./extensions.js";                   // #8: extension system
import { Session, buildSessionContext, deriveState } from "./session.js"; // #5: session DAG
import { loadRegistry, removeAgent, tryExtractResult } from "./active-agents.js";
import { installUsageTracking, readUsageTotals } from "./usage-log.js";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
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
  maxDurationMs?: number;
  piFallbackInterval?: number; // auto PI review after N steps without check-in (default 50, 0 to disable)
  onPIVerdict?: (verdict: PIVerdict, toolCallCount: number) => void;
}

const MODEL_MAP: Record<string, [string, string]> = {
  haiku: ["anthropic", "claude-haiku-4-5-20251001"],
  sonnet: ["anthropic", "claude-sonnet-4-6"],
  opus: ["anthropic", "claude-opus-4-6"],
};

// Resolve paths for template variables
const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH_SCRIPT_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "search");
const EXTRACT_FIGURES_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "extract-figures");
const MERGE_NOTES_PATH = join(LUXAS_ROOT, "skills", "search", "scripts", "merge-notes");
const VENUE_SPECIFIC_DIR = join(LUXAS_ROOT, "skills", "venue-specific") + "/";

export function createResearchAgent(opts: ResearchAgentOptions) {
  // Enforce absolute projectDir — all tools depend on this
  const projectDir = isAbsolute(opts.projectDir) ? opts.projectDir : resolve(opts.projectDir);

  if (process.platform === "darwin") {
    try {
      execSync(`xattr -cr "${projectDir}"`, { stdio: "pipe" });
    } catch {}
  }

  // Model for the brain agent
  const modelKey = opts.model ?? "opus";
  const [provider, modelId] = MODEL_MAP[modelKey] ?? MODEL_MAP.opus;
  const model = getModel(provider as any, modelId as any);
  const thinkingLevel = opts.thinkingLevel ?? "medium";

  // Template variables shared by brain and sub-agents
  const templateVars: Record<string, string> = {
    PROJECT_DIR: projectDir,
    SEARCH_SCRIPT: SEARCH_SCRIPT_PATH,
    EXTRACT_FIGURES: EXTRACT_FIGURES_PATH,
    MERGE_NOTES: MERGE_NOTES_PATH,
    VENUE_SPECIFIC_DIR: VENUE_SPECIFIC_DIR,
  };

  // System prompt: brain.md + smelt patches + semi-static per-project context
  // (RESEARCH.md + skills + lessons.md), merged into a single cache-pinned block.
  //
  // Cache-budget arithmetic: Anthropic allows at most 4 cache_control breakpoints
  // per request. The conversation trailer (research_snapshot) gets one auto-pin
  // from pi-ai; we add one in injectSnapshot to cache conversation history; that
  // leaves one for the system prompt. Splitting L1/L2 into two pins would buy
  // nothing worth the slot — both change rarely, and history-end caching pays
  // more in a long session than an L1-only partial hit when L2 invalidates.
  //
  // L3-style execution-state content (active_agents, completed_artifacts,
  // plan_status) lives in the trailer snapshot now — see context.ts.
  const brainDef = getDefinition("brain");
  let systemText = resolvePrompt(brainDef, templateVars);

  const smeltPatches = readPatches(DEFAULT_BASE_DIR, "brain");
  if (smeltPatches.length > 0) {
    systemText = applyPatches(systemText, smeltPatches, "brain");
  }

  const semiStatic = buildSemiStaticSystemLayer(projectDir);
  if (semiStatic) {
    systemText = systemText + "\n\n" + semiStatic;
  }

  const systemPrompt: TextContent[] = [
    { type: "text", text: systemText, cacheControl: { type: "ephemeral" } },
  ];

  // Reminder system — event-driven, per-turn quality nudges
  const reminders = new ReminderRegistry();
  for (const p of builtinProviders) reminders.register(p);

  // AgentSmelt: dynamic knowledge injection via reminders (replaces static prompt append)
  reminders.register(createSmeltReminderProvider({ agentRole: "brain" }));

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
    maxDurationMs: opts.maxDurationMs,
    reminders,
    bus,
    usageLogPath,
    onPaperDownloaded,
    initialState: savedState ?? undefined,
  });

  // Check if PI already said STOP in a previous session (persisted in pi_feedback.md)
  const prevFeedback = existsSync(join(projectDir, "reviews", "pi_feedback.md"))
    ? readFileSync(join(projectDir, "reviews", "pi_feedback.md"), "utf-8")
    : "";
  if (prevFeedback.includes("## Verdict: STOP")) {
    hooks.setPIStopped();
  }

  // Layer 2: Tools (research tools + PI review tool)
  let finishCallback: (() => void) | undefined;
  const { tools, setParentAgent } = buildResearchTools(projectDir, templateVars, getApiKey, {
    onFinish: () => finishCallback?.(),
  });

  const piMonitorOpts = {
    projectDir: projectDir,
    fallbackInterval: opts.piFallbackInterval ?? 50,
    initialState: savedState ? {
      totalToolCalls: savedState.piToolCalls,
      lastReviewAt: savedState.piLastReviewAt,
      reviewCount: savedState.piReviewCount,
    } : undefined,
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
  });
  nameAgent(agent, "brain", "brain");

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
        const newMessages = messages.slice(lastCheckpointedMsgCount)
          .filter((m: any) => {
            if (m.role === "assistant" && m.stopReason === "error") return false;
            if (m.role === "assistant" && Array.isArray(m.content) && m.content.length === 0) return false;
            return true;
          });
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
      try {
        const active = loadRegistry(agentDir);
        for (const a of active) {
          if (a.status === "done" && a.result) {
            agent.steer({
              role: "user",
              content: `[Background Agent Complete: ${a.name} ✓]\nTask: ${a.task}\n\n${a.result.slice(0, 30_000)}`,
              timestamp: Date.now(),
            });
            removeAgent(agentDir, a.id);
          } else if (a.status === "failed") {
            agent.steer({
              role: "user",
              content: `[Background Agent Failed: ${a.name} ✗]\nTask: ${a.task}\n\n${a.result ?? "Unknown error"}`,
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
        agent.replaceMessages(cleaned);
        lastCheckpointedMsgCount = cleaned.length;
        return cleaned.length;
      }
    } catch {}
    return 0;
  } : null;

  return { agent, hooks, bus, session, piFallback, restore, checkpointPath, usageLogPath };
}
