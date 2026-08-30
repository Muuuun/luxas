#!/usr/bin/env node
/**
 * Monitor runner — one conversational turn of the sidecar `monitor` agent.
 *
 * Spawned per user message by the studio (luxas-studio lib/monitor.ts) or by
 * `luxas monitor <project> --message "…"`. Restores the monitor's own session
 * from .agent/monitor/session.jsonl, runs ONE agent turn (the model may make
 * many tool calls), appends the new messages, streams events to stdout as
 * JSONL when --json is set, and exits. Nothing here touches the brain's
 * process, checkpoint, notes, or report — the monitor's only write is
 * notes/directives/ via post_directive (see src/tools/monitor-tools.ts).
 *
 * Why a fresh process per message rather than a resident daemon: the
 * lifecycle is trivial (no zombie, no heartbeat, nothing to reconcile after a
 * studio restart) and tsx startup is ~1–2 s, which is fine for a chat turn.
 *
 * Why the Agent is built here rather than through buildAgentFromDefinition:
 * that path forces tool_choice="any"/"required" on every call (sub-agents
 * must never end a turn silently). A chat agent needs the opposite — a
 * text-only assistant message IS the reply and ends the turn. We reuse the
 * definition (prompt, safety wrapper, tool-sets, maxTurns) and the shared
 * model/retry/usage plumbing, and construct the Agent with default tool
 * choice.
 *
 * Usage:
 *   npx tsx src/monitor-runner.ts --project <dir> (--message <text> | --stdin)
 *        [--json] [--model sonnet|opus|haiku|deepseek-v4-pro|…] [--by <email>]
 *        [--session <path>] [--reset]
 *
 * stdout (with --json), one JSON object per line:
 *   {type:"start", agentId, model}
 *   {type:"text", delta}
 *   {type:"thinking", delta}
 *   {type:"tool_start", id, name, args}
 *   {type:"tool_end", id, name, ok, result}
 *   {type:"directive", action:"post"|"retract", name, body?}
 *   {type:"done", text, turns, costUsd}
 *   {type:"error", message}
 */
import { Agent } from "@earendil-works/pi-agent-core";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getDefinition, resolvePrompt } from "./agents/registry.js";
import { buildSafetyWrapper } from "./agents/safety-wrappers.js";
import { resolveToolSets } from "./agents/tool-sets.js";
import { resolveModel, streamWithRetry } from "./agents/spawn.js";
import { Session, buildSessionContext } from "./session.js";
import { cleanMessagesForModel } from "./transform.js";
import { getApiKey } from "./auth.js";
import { installUsageTracking, readUsageTotals } from "./usage-log.js";
import { extractTextContent } from "./utils.js";
import { createMonitorTools } from "./tools/monitor-tools.js";

process.env.PI_CACHE_RETENTION ||= "short";

// Same posture as subagent-runner: keys come from ~/.sisyphus/auth.json via
// src/auth.ts, never from the environment the studio happened to have.
for (const k of [
  "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY",
  "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN", "GITHUB_PAT",
]) {
  delete process.env[k];
}

/** Keep the restored history bounded: the monitor's context is a chat, not a research log. */
const MAX_RESTORED_MESSAGES = 60;
/** Lifetime spend cap for one project's monitor — a chat helper must never become a budget line. */
const MONITOR_COST_CAP_USD = 25;

export interface MonitorArgs {
  project: string;
  message?: string;
  stdin?: boolean;
  json?: boolean;
  model?: string;
  by?: string;
  session?: string;
  reset?: boolean;
}

export function parseMonitorArgs(argv: string[]): MonitorArgs {
  const out: MonitorArgs = { project: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--project") out.project = next();
    else if (a === "--message") out.message = next();
    else if (a === "--stdin") out.stdin = true;
    else if (a === "--json") out.json = true;
    else if (a === "--model") out.model = next();
    else if (a === "--by") out.by = next();
    else if (a === "--session") out.session = next();
    else if (a === "--reset") out.reset = true;
    else if (!a.startsWith("--") && !out.project) out.project = a;
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Apply the project's launch profile so the monitor rides the same provider
 * the research run is paying for (dual → deepseek text). `--model` still
 * wins. Mirrors the profile block in src/index.ts without importing it
 * (index.ts has top-level side effects).
 */
export function applyProjectProfile(projectDir: string): string | undefined {
  try {
    const cfg = JSON.parse(readFileSync(join(projectDir, ".agent", "run_config.json"), "utf-8"));
    if (cfg?.profile === "dual") {
      process.env.LUXAS_MODEL_PROFILE ||= "deepseek-v4-pro";
      return "dual";
    }
    if (typeof cfg?.model === "string" && cfg.model.startsWith("deepseek-")) {
      process.env.LUXAS_MODEL_PROFILE ||= cfg.model;
      return cfg.model;
    }
    return cfg?.profile ?? undefined;
  } catch { return undefined; }
}

/** Drop the oldest messages but never start the window on a tool result. */
export function trimHistory(messages: any[], max = MAX_RESTORED_MESSAGES): any[] {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== "user") start++;
  return messages.slice(start);
}

export async function runMonitorTurn(args: MonitorArgs): Promise<number> {
  const projectDir = isAbsolute(args.project) ? args.project : resolve(args.project);
  if (!args.project || !existsSync(projectDir)) {
    console.error(`monitor: project directory not found: ${args.project || "(none)"}`);
    return 2;
  }
  process.env.LUXAS_PROJECT_DIR = projectDir;

  const emit = (ev: Record<string, unknown>) => {
    if (args.json) process.stdout.write(JSON.stringify(ev) + "\n");
  };

  const message = (args.stdin ? await readStdin() : args.message ?? "").trim();
  if (!message) {
    console.error("monitor: empty message (pass --message <text> or --stdin)");
    return 2;
  }

  const monitorDir = join(projectDir, ".agent", "monitor");
  mkdirSync(monitorDir, { recursive: true });
  const sessionFile = args.session
    ? (isAbsolute(args.session) ? args.session : join(projectDir, args.session))
    : join(monitorDir, "session.jsonl");
  if (args.reset && existsSync(sessionFile)) { try { unlinkSync(sessionFile); } catch { /* ignore */ } }
  mkdirSync(dirname(sessionFile), { recursive: true });

  // Separate ledger: studio's projectUsage() reads .agent/usage.log as the
  // research spend; the monitor must not inflate it.
  installUsageTracking(join(monitorDir, "usage.log"), { maxCostUsd: MONITOR_COST_CAP_USD });
  const costBefore = readUsageTotals(join(monitorDir, "usage.log")).cost;

  applyProjectProfile(projectDir);

  const def = getDefinition("monitor");
  const modelKey = args.model ?? def.model;
  const model = resolveModel(modelKey, "monitor");
  const templateVars = { PROJECT_DIR: projectDir, SPAWN_ID: "monitor" };
  const systemPrompt = resolvePrompt(def, templateVars);

  let tools = resolveToolSets(def.toolSets, projectDir);
  const wrapper = buildSafetyWrapper(def.safety);
  if (wrapper) tools = wrapper(tools, projectDir, templateVars, undefined);
  tools = [
    ...tools,
    ...createMonitorTools(projectDir, {
      postedBy: args.by,
      onDirectiveChange: (c) => emit({ type: "directive", ...c }),
    }),
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: (def.thinkingLevel || "low") as any,
      tools,
    },
    getApiKey,
    // No forced toolChoice — a text-only reply ends the turn (see header).
    streamFn: (m: any, ctx: any, opts: any) => streamWithRetry(m, ctx, opts),
  });

  // Restore prior chat.
  const session = Session.open(sessionFile, projectDir);
  let lastSaved = 0;
  if (session.getEntries().length > 0) {
    const prior = buildSessionContext(session);
    if (prior.length > 0) {
      const cleaned = trimHistory(cleanMessagesForModel(prior, { provider: model.provider, id: model.id }));
      agent.state.messages = cleaned;
      lastSaved = cleaned.length;
    }
  }

  // Persist per turn + stream events.
  let turns = 0;
  const cap = def.maxTurns ?? 30;
  agent.subscribe((event: any) => {
    switch (event.type) {
      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e?.type === "text_delta" && e.delta) emit({ type: "text", delta: e.delta });
        else if (e?.type === "thinking_delta" && e.delta) emit({ type: "thinking", delta: e.delta });
        break;
      }
      case "tool_execution_start":
        emit({ type: "tool_start", id: event.toolCallId, name: event.toolName, args: event.args });
        break;
      case "tool_execution_end": {
        const r = event.result;
        const text = Array.isArray(r?.content) ? extractTextContent(r.content) : typeof r === "string" ? r : "";
        emit({ type: "tool_end", id: event.toolCallId, name: event.toolName, ok: !event.isError, result: text.slice(0, 4000) });
        break;
      }
      case "turn_end": {
        turns++;
        try {
          const msgs = agent.state.messages;
          for (let i = lastSaved; i < msgs.length; i++) session.appendMessage(msgs[i]);
          lastSaved = msgs.length;
        } catch (err) { console.error(`monitor: session append failed: ${(err as Error).message}`); }
        if (turns > cap) {
          emit({ type: "error", message: `turn cap ${cap} exceeded; aborting this reply` });
          agent.abort();
        }
        break;
      }
    }
  });

  emit({ type: "start", agentId: "monitor", model: model.id, session: sessionFile });

  try {
    await agent.prompt(message);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    emit({ type: "error", message: msg });
    console.error(`monitor: ${msg}`);
    return 1;
  }

  const last = [...agent.state.messages].reverse().find((m: any) => m.role === "assistant") as any;
  const text = last?.content ? extractTextContent(last.content) : "";
  const costUsd = readUsageTotals(join(monitorDir, "usage.log")).cost - costBefore;
  emit({ type: "done", text, turns, costUsd });
  if (!args.json) process.stdout.write((text || "(no reply)") + "\n");
  return 0;
}

// Entry point only when executed directly (index.ts imports this module).
const invokedDirectly = process.argv[1] && /monitor-runner\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  runMonitorTurn(parseMonitorArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err) => { console.error("monitor-runner fatal:", err); process.exit(1); });
}
