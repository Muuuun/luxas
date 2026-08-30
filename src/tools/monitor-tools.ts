/**
 * Monitor tools — the evidence + directive surface for the sidecar
 * `monitor` agent (src/agents/definitions/monitor.md, src/monitor-runner.ts).
 *
 * Everything here is read-only against the research run EXCEPT
 * `post_directive` / `retract_directive`, which touch one directory:
 * notes/directives/. That directory is the pre-existing operator channel —
 * src/index.ts persistDirectiveIfNew writes it on `luxas run --directive`,
 * and src/context.ts collectActiveDirectives re-reads it before EVERY brain
 * LLM call. Writing a file there is therefore a turn-boundary steer that
 * never touches the running process. The consumer already exists; this file
 * adds a second producer. Gate: scripts/smoke_monitor.mts.
 *
 * The helpers (`postDirective`, `retractDirective`, `listDirectives`,
 * `summarizeRunStatus`, …) are exported separately from the tool factory so
 * the gate can drive them without a model.
 */

import { Type } from "@earendil-works/pi-ai/compat";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { loadRegistry, isAlive as heartbeatFresh, parseConvJsonl } from "../active-agents.js";
import { readUsageTotals } from "../usage-log.js";
import { extractTextContent, pidAlive } from "../utils.js";

// ── Directives ───────────────────────────────────────────────────────

export const MONITOR_DIRECTIVE_SOURCE = "studio-monitor";
/** Matches src/context.ts MAX_DIRECTIVE_BYTES (3000): anything longer is silently cut by the reader. */
export const MAX_DIRECTIVE_CHARS = 2800;

export interface DirectiveFile {
  name: string;
  issuedAt?: string;
  source?: string;
  by?: string;
  body: string;
  /** true when the file lives under notes/directives/archived/ */
  archived: boolean;
}

function directivesDir(projectDir: string): string {
  return join(projectDir, "notes", "directives");
}

function parseDirectiveFile(path: string, archived: boolean): DirectiveFile | null {
  let raw: string;
  try { raw = readFileSync(path, "utf-8"); } catch { return null; }
  const fm = raw.match(/^---\n([\s\S]*?)\n---\s*/);
  const meta: Record<string, string> = {};
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
  }
  const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
  return {
    name: basename(path).replace(/\.md$/, ""),
    issuedAt: meta.issued_at,
    source: meta.source,
    by: meta.by,
    body,
    archived,
  };
}

/** Active directives newest first (same order the brain sees), then archived ones. */
export function listDirectives(projectDir: string): DirectiveFile[] {
  const dir = directivesDir(projectDir);
  const out: DirectiveFile[] = [];
  if (!existsSync(dir)) return out;
  const names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort().reverse();
  for (const n of names) {
    const d = parseDirectiveFile(join(dir, n), false);
    if (d && d.body) out.push(d);
  }
  const arch = join(dir, "archived");
  if (existsSync(arch)) {
    for (const n of readdirSync(arch).filter((x) => x.endsWith(".md")).sort().reverse()) {
      const d = parseDirectiveFile(join(arch, n), true);
      if (d && d.body) out.push(d);
    }
  }
  return out;
}

export interface PostDirectiveResult {
  ok: boolean;
  name?: string;
  path?: string;
  error?: string;
  /** set when an identical active directive already existed */
  duplicateOf?: string;
}

/**
 * Write one directive file. Mirrors src/index.ts persistDirectiveIfNew
 * (same frontmatter shape + content dedup) with two extra frontmatter keys
 * so the file is attributable and retractable: `source: studio-monitor`,
 * `by: <email>`.
 */
export function postDirective(projectDir: string, text: string, by?: string): PostDirectiveResult {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, error: "directive is empty" };
  if (trimmed.length > MAX_DIRECTIVE_CHARS) {
    return { ok: false, error: `directive too long (${trimmed.length} > ${MAX_DIRECTIVE_CHARS} chars) — the brain truncates at 3000 bytes; shorten it` };
  }
  const dir = directivesDir(projectDir);
  mkdirSync(dir, { recursive: true });
  for (const d of listDirectives(projectDir)) {
    if (!d.archived && d.body === trimmed) return { ok: false, duplicateOf: d.name, error: `an identical active directive already exists (${d.name})` };
  }
  const now = new Date();
  // Same filename scheme as persistDirectiveIfNew so chronological sort holds
  // across both producers; suffix keeps two posts in one second distinct.
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const name = `${ts}-monitor`;
  const path = join(dir, `${name}.md`);
  const lines = [
    "---",
    `issued_at: ${now.toISOString()}`,
    `source: ${MONITOR_DIRECTIVE_SOURCE}`,
  ];
  if (by) lines.push(`by: ${by.replace(/[\r\n]/g, " ")}`);
  lines.push("---", "", trimmed, "");
  writeFileSync(path, lines.join("\n"), "utf-8");
  return { ok: true, name, path };
}

/** Move a monitor-posted directive to notes/directives/archived/. Refuses non-monitor files. */
export function retractDirective(projectDir: string, name: string): { ok: boolean; error?: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return { ok: false, error: "invalid directive name" };
  const dir = directivesDir(projectDir);
  const src = join(dir, `${name}.md`);
  if (!existsSync(src)) return { ok: false, error: `no active directive named ${name}` };
  const d = parseDirectiveFile(src, false);
  if (!d || d.source !== MONITOR_DIRECTIVE_SOURCE) {
    return { ok: false, error: `${name} was not posted by the monitor (source=${d?.source ?? "none"}); only monitor-posted directives can be retracted here` };
  }
  const arch = join(dir, "archived");
  mkdirSync(arch, { recursive: true });
  renameSync(src, join(arch, `${name}.md`));
  return { ok: true };
}

// ── Run status ───────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

function readJson(path: string): any | null {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

export function summarizeRunStatus(projectDir: string): string {
  const agentDir = join(projectDir, ".agent");
  const lines: string[] = [];

  // Process state: run.pid is written by the studio (lib/runner.ts) and by
  // nothing else; a missing file with a live checkpoint means a CLI-launched
  // run we cannot see the pid of.
  const pidInfo = readJson(join(agentDir, "run.pid"));
  const cfg = readJson(join(agentDir, "run_config.json"));
  if (pidInfo && typeof pidInfo.pid === "number") {
    const alive = pidAlive(pidInfo.pid);
    lines.push(`process: ${alive ? "RUNNING" : "NOT RUNNING (stale pid file)"} pid=${pidInfo.pid}` +
      (pidInfo.startedAt ? `, started ${new Date(pidInfo.startedAt).toISOString()} (${fmtDuration(Date.now() - pidInfo.startedAt)} ago)` : ""));
  } else {
    lines.push("process: no run.pid — not started from the studio, or the run has exited");
  }
  if (cfg) {
    lines.push(`launch config: model=${cfg.model ?? "?"} profile=${cfg.profile ?? "none"} maxCost=${cfg.maxCost ?? "default"} savedAt=${cfg.savedAt ?? "?"}`);
  }

  // Cost
  const usage = readUsageTotals(join(agentDir, "usage.log"));
  lines.push(`spend: $${usage.cost.toFixed(2)} over ${usage.calls} LLM calls (in ${usage.inputTokens.toLocaleString()} / out ${usage.outputTokens.toLocaleString()} / cache-read ${usage.cacheReadTokens.toLocaleString()} tokens)`);
  if (cfg && typeof cfg.maxCost === "number") {
    const frac = usage.cost / cfg.maxCost;
    lines.push(`budget: ${(frac * 100).toFixed(0)}% of $${cfg.maxCost} cap${frac > 0.85 ? " — CLOSE TO CAP" : ""}`);
  }

  // Brain last activity
  const logPath = join(agentDir, "log.jsonl");
  const last = lastLogEntries(logPath, 1)[0];
  if (last) {
    const age = last.timestamp ? Date.now() - Date.parse(last.timestamp) : NaN;
    lines.push(`last brain tool call: ${last.tool ?? last.type} at ${last.timestamp ?? "?"}${Number.isFinite(age) ? ` (${fmtDuration(age)} ago)` : ""}`);
  } else {
    lines.push("last brain tool call: none logged yet");
  }

  // Sub-agents
  let agents: ReturnType<typeof loadRegistry> = [];
  try { agents = loadRegistry(agentDir); } catch { /* no registry */ }
  if (agents.length === 0) {
    lines.push("sub-agents: none registered (brain is working alone, or between spawns)");
  } else {
    lines.push(`sub-agents (${agents.length}):`);
    for (const a of agents) {
      const hb = heartbeatFresh(agentDir, a.id);
      const procAlive = typeof a.pid === "number" ? pidAlive(a.pid) : undefined;
      const state = a.status ?? "running";
      const liveness = state === "running"
        ? (hb ? "heartbeat fresh" : procAlive ? "heartbeat stale but process alive" : "NO heartbeat, process gone — likely dead")
        : state;
      lines.push(`  - ${a.id} [${a.mode}] ${liveness}; running ${fmtDuration(Date.now() - a.startedAt)}; task: ${a.task.slice(0, 160).replace(/\s+/g, " ")}` +
        (a.expected_artifact ? `; expects → ${a.expected_artifact}` : ""));
    }
  }

  // Escalations
  const esc = join(projectDir, "notes", "escalations", "needs-operator.md");
  if (existsSync(esc)) lines.push(`ESCALATION: notes/escalations/needs-operator.md exists — the brain asked for the operator. Read it.`);

  // Report
  const pdf = join(projectDir, "report", "report.pdf");
  if (existsSync(pdf)) {
    const st = statSync(pdf);
    lines.push(`report.pdf: present, ${(st.size / 1024).toFixed(0)} KB, updated ${st.mtime.toISOString()}`);
  } else {
    lines.push("report.pdf: not generated yet");
  }

  const active = listDirectives(projectDir).filter((d) => !d.archived);
  lines.push(`active directives: ${active.length}${active.length ? " (" + active.map((d) => d.name).join(", ") + ")" : ""}`);
  return lines.join("\n");
}

// ── Activity ledger ──────────────────────────────────────────────────

function lastLogEntries(logPath: string, n: number): any[] {
  if (!existsSync(logPath)) return [];
  let raw: string;
  try {
    const size = statSync(logPath).size;
    // Read only the tail — log.jsonl grows for hours.
    const want = Math.min(size, Math.max(64 * 1024, n * 600));
    const fd = readFileSync(logPath);
    raw = fd.subarray(size - want).toString("utf-8");
  } catch { return []; }
  const lines = raw.split("\n").filter(Boolean);
  const out: any[] = [];
  for (const l of lines.slice(-n - 1)) {
    try { out.push(JSON.parse(l)); } catch { /* partial first line */ }
  }
  return out.slice(-n);
}

function renderLogEntry(e: any): string {
  const ts = typeof e.timestamp === "string" ? e.timestamp.slice(11, 19) : "??:??:??";
  if (e.type === "session_start") return `${ts} SESSION START${e.directive ? ` directive="${String(e.directive).slice(0, 80)}"` : ""}`;
  const args = e.args && typeof e.args === "object"
    ? Object.entries(e.args).map(([k, v]) => `${k}=${String(v).slice(0, 70).replace(/\s+/g, " ")}`).join(" ")
    : "";
  const fail = e.success === false ? ` ✗${e.errorCategory ? ` ${e.errorCategory}` : ""}${e.errorMessage ? `: ${String(e.errorMessage).slice(0, 100)}` : ""}` : "";
  return `${ts} ${e.tool ?? e.type}${e.phase ? `(${e.phase})` : ""} ${args}${fail}`;
}

export function summarizeRecentActivity(projectDir: string, n = 40): string {
  const entries = lastLogEntries(join(projectDir, ".agent", "log.jsonl"), Math.max(1, Math.min(n, 200)));
  if (entries.length === 0) return "(no entries in .agent/log.jsonl yet)";
  const first = entries[0]?.timestamp, last = entries[entries.length - 1]?.timestamp;
  return `${entries.length} most recent brain tool calls (${first ?? "?"} → ${last ?? "?"}), oldest first:\n` +
    entries.map(renderLogEntry).join("\n");
}

// ── Transcripts ──────────────────────────────────────────────────────

const AGENT_ID_RE = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/i;

function conversationPath(projectDir: string, agentId: string): string | null {
  if (agentId === "brain") {
    const cp = join(projectDir, ".agent", "checkpoint.jsonl");
    return existsSync(cp) ? cp : null;
  }
  if (!AGENT_ID_RE.test(agentId)) return null;
  // Registry entry (absolute path) wins; fall back to the conventional location.
  try {
    const hit = loadRegistry(join(projectDir, ".agent")).find((a) => a.id === agentId);
    if (hit?.conversationFile && existsSync(hit.conversationFile)) return hit.conversationFile;
  } catch { /* no registry */ }
  const conv = join(projectDir, ".agent", "conversations", `${agentId}.jsonl`);
  return existsSync(conv) ? conv : null;
}

export function listConversationIds(projectDir: string): string[] {
  const dir = join(projectDir, ".agent", "conversations");
  const ids = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => n.replace(/\.jsonl$/, "")) : [];
  if (existsSync(join(projectDir, ".agent", "checkpoint.jsonl"))) ids.unshift("brain");
  return ids;
}

export function summarizeTranscript(projectDir: string, agentId: string, lastTurns = 6): string {
  const path = conversationPath(projectDir, agentId);
  if (!path) {
    const known = listConversationIds(projectDir);
    return `no transcript for "${agentId}". Known ids: ${known.slice(0, 40).join(", ") || "(none)"}`;
  }
  let messages: any[];
  let task: string | undefined;
  if (agentId === "brain") {
    messages = [];
    try {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
        if (!line) continue;
        try { const e = JSON.parse(line); if (e?.type === "message" && e.message?.role) messages.push(e.message); } catch { /* skip */ }
      }
    } catch { /* unreadable */ }
  } else {
    const parsed = parseConvJsonl(path);
    messages = parsed.messages;
    task = (parsed.spawnInit as any)?.task ?? (parsed.spawnInit as any)?.prompt;
  }
  const n = Math.max(1, Math.min(lastTurns, 30));
  // A "turn" = one assistant message plus the tool results that follow it.
  const assistantIdx = messages.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0);
  const start = assistantIdx.length > n ? assistantIdx[assistantIdx.length - n] : 0;
  const out: string[] = [];
  out.push(`transcript of ${agentId}: ${assistantIdx.length} assistant turns total, showing the last ${Math.min(n, assistantIdx.length)}${task ? `\ntask: ${String(task).slice(0, 400).replace(/\s+/g, " ")}` : ""}`);
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    const ts = typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString().slice(11, 19) : "";
    if (m.role === "assistant") {
      const text = Array.isArray(m.content) ? extractTextContent(m.content) : String(m.content ?? "");
      const calls = Array.isArray(m.content) ? m.content.filter((c: any) => c?.type === "toolCall" || c?.type === "tool_use") : [];
      if (text.trim()) out.push(`[${ts} assistant] ${text.trim().slice(0, 1200)}`);
      for (const c of calls) {
        const args = c.arguments ?? c.input ?? {};
        out.push(`[${ts} tool→${c.name}] ${JSON.stringify(args).slice(0, 300)}`);
      }
    } else if (m.role === "toolResult") {
      const text = Array.isArray(m.content) ? extractTextContent(m.content) : String(m.content ?? "");
      out.push(`[${ts} result${m.isError ? " ✗" : ""}] ${text.trim().slice(0, 400).replace(/\s+/g, " ")}`);
    } else if (m.role === "user" && i >= start) {
      const text = Array.isArray(m.content) ? extractTextContent(m.content) : String(m.content ?? "");
      const t = text.trim();
      if (t && !t.startsWith("<research_snapshot>")) out.push(`[${ts} user/harness] ${t.slice(0, 400).replace(/\s+/g, " ")}`);
    }
  }
  const joined = out.join("\n");
  return joined.length > 24_000 ? joined.slice(0, 24_000) + "\n…(truncated; ask for fewer turns)" : joined;
}

// ── Files ────────────────────────────────────────────────────────────

export function listFilesUnder(projectDir: string, rel = ".", maxEntries = 200): string {
  const target = resolve(projectDir, rel);
  if (target !== projectDir && !target.startsWith(projectDir + "/")) return "list_files is restricted to the project directory.";
  if (!existsSync(target)) return `${rel}: does not exist`;
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= maxEntries) return;
    let names: string[] = [];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      if (n === ".git" || n === "node_modules" || n === "__pycache__" || n === ".venv") continue;
      const p = join(dir, n);
      let st; try { st = statSync(p); } catch { continue; }
      const relp = p.slice(projectDir.length + 1);
      if (st.isDirectory()) {
        out.push(`${relp}/`);
        if (depth < 2) walk(p, depth + 1);
      } else {
        out.push(`${relp}  ${st.size >= 1024 * 1024 ? (st.size / 1048576).toFixed(1) + "MB" : st.size >= 1024 ? (st.size / 1024).toFixed(0) + "KB" : st.size + "B"}  ${st.mtime.toISOString().slice(0, 16)}`);
      }
      if (out.length >= maxEntries) { out.push(`…(capped at ${maxEntries} entries; narrow the path)`); return; }
    }
  };
  walk(target, 0);
  return out.join("\n") || "(empty)";
}

// ── Tool factory ─────────────────────────────────────────────────────

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export interface MonitorToolOptions {
  /** Recorded in the directive frontmatter (`by:`) for attribution. */
  postedBy?: string;
  /** Called after a successful post/retract so the runner can surface it as an event. */
  onDirectiveChange?: (change: { action: "post" | "retract"; name: string; body?: string }) => void;
}

export function createMonitorTools(projectDir: string, opts: MonitorToolOptions = {}): any[] {
  return [
    {
      name: "run_status",
      label: "Run status",
      description:
        "Snapshot of the research run: whether the process is alive, how long it has run, spend vs cap, " +
        "the last brain tool call, every registered sub-agent with liveness and task, escalations, report.pdf state, " +
        "and how many directives are in force. Call this first for any progress question.",
      parameters: Type.Object({}),
      async execute() { return text(summarizeRunStatus(projectDir)); },
    },
    {
      name: "recent_activity",
      label: "Recent activity",
      description:
        "The brain's most recent tool calls from .agent/log.jsonl (oldest first, newest last): tool name, key args, " +
        "failures. Use to see what the brain has been doing in the last while and to spot loops or failures.",
      parameters: Type.Object({
        n: Type.Optional(Type.Number({ description: "How many entries (default 40, max 200)." })),
      }),
      async execute(_id: string, p: { n?: number }) { return text(summarizeRecentActivity(projectDir, p.n ?? 40)); },
    },
    {
      name: "agent_transcript",
      label: "Agent transcript",
      description:
        "Last turns of one agent's conversation — its text, tool calls and results. agent_id is \"brain\" or a " +
        "sub-agent id from run_status (e.g. brain.experiment-1br0ta). Use to answer 'what is X doing / what did X conclude'.",
      parameters: Type.Object({
        agent_id: Type.String({ description: "\"brain\" or a sub-agent id from run_status." }),
        last_turns: Type.Optional(Type.Number({ description: "Assistant turns to show (default 6, max 30)." })),
      }),
      async execute(_id: string, p: { agent_id: string; last_turns?: number }) {
        return text(summarizeTranscript(projectDir, p.agent_id, p.last_turns ?? 6));
      },
    },
    {
      name: "list_files",
      label: "List files",
      description: "List files under a project-relative directory (2 levels deep, sizes and mtimes). Default: project root.",
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "Project-relative directory. Default \".\"." })),
      }),
      async execute(_id: string, p: { path?: string }) { return text(listFilesUnder(projectDir, p.path ?? ".")); },
    },
    {
      name: "list_directives",
      label: "List directives",
      description:
        "Every directive currently in force for the brain (newest first — the order the brain sees them), then archived ones. " +
        "Shows who issued each (launch --directive vs studio-monitor) and its text.",
      parameters: Type.Object({}),
      async execute() {
        const ds = listDirectives(projectDir);
        if (ds.length === 0) return text("(no directives)");
        return text(ds.map((d) =>
          `${d.archived ? "[archived] " : "[active] "}${d.name}${d.source ? ` source=${d.source}` : ""}${d.by ? ` by=${d.by}` : ""}${d.issuedAt ? ` issued=${d.issuedAt}` : ""}\n${d.body}`,
        ).join("\n\n"));
      },
    },
    {
      name: "post_directive",
      label: "Post directive",
      description:
        "Write ONE directive for the brain into notes/directives/. The brain reads it before its next LLM call with " +
        "priority=highest. ONLY call after the researcher has explicitly confirmed the exact text you showed them in a " +
        "previous message. Text must be imperative, specific, self-contained, under ~1200 chars.",
      parameters: Type.Object({
        text: Type.String({ description: "The directive, addressed to the brain." }),
      }),
      async execute(_id: string, p: { text: string }) {
        const r = postDirective(projectDir, p.text, opts.postedBy);
        if (!r.ok) return { ...text(`NOT posted: ${r.error}`), isError: true };
        opts.onDirectiveChange?.({ action: "post", name: r.name!, body: p.text.trim() });
        return text(`Posted ${r.name} → notes/directives/${r.name}.md. The brain picks it up at its next LLM call (or on resume if the run is stopped).`);
      },
    },
    {
      name: "retract_directive",
      label: "Retract directive",
      description:
        "Move a directive YOU posted earlier (source=studio-monitor) to notes/directives/archived/ so the brain stops seeing it. " +
        "Use when a new directive supersedes it or the researcher changes their mind. Launch directives cannot be retracted here.",
      parameters: Type.Object({
        name: Type.String({ description: "Directive name as shown by list_directives (without .md)." }),
      }),
      async execute(_id: string, p: { name: string }) {
        const r = retractDirective(projectDir, p.name);
        if (!r.ok) return { ...text(`NOT retracted: ${r.error}`), isError: true };
        opts.onDirectiveChange?.({ action: "retract", name: p.name });
        return text(`Retracted ${p.name} → notes/directives/archived/.`);
      },
    },
  ];
}
