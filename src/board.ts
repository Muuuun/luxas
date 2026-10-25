/**
 * The experiment board the studio shows: one card per experiment, derived from
 * the files the run already writes, plus the operator's decisions
 * (src/board-actions.ts). Nothing here is new state about the research: the
 * board is a view, so it cannot drift from what the harness reads.
 *
 * Producer: buildBoard. Readers: src/board-cli.ts --json → luxas-studio
 * lib/board.ts → the board tab. applyBoardAction is the one writer of
 * decisions; its effects are read by spawnAgent / the background runner /
 * the Claude Code executor (stops) and by the brain (directives).
 *
 * What a card may carry is listed in BoardCard and nothing else: ids, short
 * texts cut to a fixed length, numbers, and paths relative to the project. No
 * environment, no absolute paths, no file contents beyond a heading, a status
 * line and the reviewer's first issue.
 */
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { loadRegistry } from "./active-agents.js";
import { buildClaimTable } from "./claims-table.js";
import {
  BOARD_ACTIONS, EXPERIMENT_ID_RE, appendBoardAction, archiveBoardDirectives, cleanBy, cleanComment,
  latestActionFor, postBoardDirective, readBoardActions, readRunningMarker, type BoardAction,
} from "./board-actions.js";

export type CardState = "running" | "reviewing" | "to_review" | "accepted" | "rework" | "stopped" | "not_delivered";

export interface BoardQuantity { id: string; value?: number; sigma?: number; status?: string; cause?: string }
export interface BoardCard {
  id: string;
  title: string;
  state: CardState;
  executor: "claude-code" | "pi";
  ledgerStatus?: string;
  latestRun?: string;
  deliveredAt?: string;
  headline: BoardQuantity[];
  review?: { round: number; verdict: "satisfied" | "revise" | "none"; firstIssue?: string };
  claims?: { converging: number; disputed: number; other: number };
  decision?: { action: BoardAction; at: string; by?: string; comment?: string };
  running?: { since: string; agent: string };
  files: string[];
}
export interface BoardBacklogItem { title: string; from?: string; detail?: string }
export interface Board { project: string; updatedAt: string; runActive: boolean; cards: BoardCard[]; backlog: BoardBacklogItem[] }

const cut = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const alive = (pid: unknown) => { if (!Number.isInteger(pid) || (pid as number) <= 1) return false; try { process.kill(pid as number, 0); return true; } catch { return false; } };
const readText = (p: string) => { try { return readFileSync(p, "utf-8"); } catch { return ""; } };
const expNumber = (eid: string) => eid.match(/^E_?(\d+)/)?.[1];

function runActive(projectDir: string): boolean {
  try { return alive(JSON.parse(readFileSync(join(projectDir, ".agent", "run.pid"), "utf-8"))?.pid); } catch { return false; }
}

/** The ledger: `## L2.N — topic` sections, the ones that name an experiment, their Status line and FollowUp blocks. */
function ledgerSections(projectDir: string): { heading: string; body: string }[] {
  const text = readText(join(projectDir, "notes", "experiments.md"));
  return text.split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf("\n");
    return { heading: (nl < 0 ? chunk : chunk.slice(0, nl)).trim(), body: nl < 0 ? "" : chunk.slice(nl + 1) };
  }).filter((s) => /^L2\.\d+/.test(s.heading));
}

const namesExperiment = (s: { heading: string; body: string }, eid: string) =>
  new RegExp(`(^|[^A-Za-z0-9_])${eid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`).test(`${s.heading}\n${s.body}`);

function followUps(section: { heading: string; body: string }, from?: string): BoardBacklogItem[] {
  const out: BoardBacklogItem[] = [];
  const re = /^###\s*FollowUp:?\s*(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section.body))) {
    const rest = section.body.slice(m.index + m[0].length);
    const end = rest.search(/^#{2,3}\s/m);
    out.push({ title: cut(m[1] || "follow-up", 160), from, detail: cut(end < 0 ? rest : rest.slice(0, end), 400) || undefined });
  }
  return out;
}

/** Latest review round of an experiment: VERDICT and the first numbered issue of its FEEDBACK. */
function latestReview(projectDir: string, eid: string): { round: number; verdict: "satisfied" | "revise" | "none"; firstIssue?: string; file: string } | undefined {
  let names: string[] = [];
  try { names = readdirSync(join(projectDir, "reviews")); } catch { return undefined; }
  const prefix = `experiment_review_${eid}_r`;
  let best: { n: number; name: string } | undefined;
  for (const n of names) {
    if (!n.startsWith(prefix) || !n.endsWith(".md")) continue;
    const r = Number(n.slice(prefix.length, -3));
    if (Number.isInteger(r) && (!best || r > best.n)) best = { n: r, name: n };
  }
  if (!best) return undefined;
  const text = readText(join(projectDir, "reviews", best.name));
  const v = text.match(/^\s*VERDICT:\s*(satisfied|revise)/im)?.[1]?.toLowerCase() as "satisfied" | "revise" | undefined;
  const fb = text.match(/FEEDBACK:\s*([\s\S]*)$/i)?.[1] ?? "";
  const first = fb.split("\n").map((l) => l.trim()).find((l) => /^(\d+[.)]|[-*•])\s+\S/.test(l));
  return { round: best.n, verdict: v ?? "none", firstIssue: first ? cut(first.replace(/^(\d+[.)]|[-*•])\s+/, ""), 240) : undefined, file: `reviews/${best.name}` };
}

/**
 * The EXPERIMENT_ID in a conversation file's spawn_init line. Only a regular
 * file under .agent/conversations/ and only its first 64 KB: the registry is
 * in the project, where an agent can point an entry at /dev/zero or a FIFO.
 */
function experimentOfConversation(projectDir: string, file: unknown): string {
  if (typeof file !== "string") return "";
  const root = resolve(projectDir, ".agent", "conversations") + sep;
  const p = resolve(file);
  if (!p.startsWith(root)) return "";
  let fd: number | undefined;
  try {
    if (!lstatSync(p).isFile()) return "";
    fd = openSync(p, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const first = buf.subarray(0, n).toString("utf-8").split("\n")[0];
    const j = JSON.parse(first);
    return j?.type === "spawn_init" ? String(j.templateVars?.EXPERIMENT_ID ?? "") : "";
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Experiments being worked on now: live registry entries, by EXPERIMENT_ID, split into the executor and its reviewers. */
function liveWork(projectDir: string): { executing: Map<string, { since: string; agent: string }>; reviewing: Set<string> } {
  const executing = new Map<string, { since: string; agent: string }>();
  const reviewing = new Set<string>();
  let reg: any[] = [];
  try { reg = loadRegistry(join(projectDir, ".agent")); } catch { /* none */ }
  for (const a of reg) {
    if (a?.status !== "running" || !(alive(a.pid) || alive(a.hostPid))) continue;
    const eid = experimentOfConversation(projectDir, a.conversationFile);
    if (!eid) continue;
    if (a.name === "experiment") executing.set(eid, { since: new Date(a.startedAt ?? Date.now()).toISOString(), agent: String(a.id) });
    else if (a.name === "experiment_reviewer" || a.name === "replicator") reviewing.add(eid);
  }
  return { executing, reviewing };
}

export function buildBoard(projectDir: string): Board {
  const actions = readBoardActions(projectDir);
  const sections = ledgerSections(projectDir);
  const { executing, reviewing } = liveWork(projectDir);
  let table: ReturnType<typeof buildClaimTable> | undefined;
  try { table = buildClaimTable(projectDir); } catch { /* a malformed results.json must not take the board down */ }

  const ids = new Set<string>();
  try { for (const n of readdirSync(join(projectDir, "data", "experiments"))) if (EXPERIMENT_ID_RE.test(n)) ids.add(n); } catch { /* none yet */ }
  for (const eid of executing.keys()) if (EXPERIMENT_ID_RE.test(eid)) ids.add(eid);

  const cards: BoardCard[] = [];
  const backlog: BoardBacklogItem[] = [];
  const claimed = new Set<{ heading: string; body: string }>();
  for (const eid of [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const dir = join(projectDir, "data", "experiments", eid);
    let latestRun: string | undefined, deliveredAt: string | undefined, deliveredMs = 0;
    try {
      for (const r of readdirSync(join(dir, "runs"))) {
        const p = join(dir, "runs", r, "results.json");
        if (!/^run_\d+$/.test(r) || !existsSync(p)) continue;
        const n = Number(r.slice(4));
        if (!latestRun || n > Number(latestRun.slice(4))) { latestRun = r; deliveredMs = statSync(p).mtimeMs; }
      }
    } catch { /* no runs */ }
    if (latestRun) deliveredAt = new Date(deliveredMs).toISOString();

    const section = sections.find((s) => namesExperiment(s, eid));
    if (section) claimed.add(section);
    const ledgerStatus = section?.body.match(/\*\*Status:\*\*\s*([^\n]+)/)?.[1];
    const review = latestReview(projectDir, eid);
    const marker = readRunningMarker(projectDir, eid);
    // Running means the executor's own process group is alive, not only its host: after a stop the host
    // lives on (it reports the stop and may review) while the run is over.
    const ccRunning = marker && alive(marker.hostPid) && alive(marker.pgid) ? { since: marker.startedAt, agent: marker.agentId } : undefined;
    const running = ccRunning ?? executing.get(eid);

    const n = expNumber(eid);
    const rows = (table?.rows ?? []).filter((row) => row.estimates.some((e) => e.kind === "own" && expNumber(String(e.experiment ?? "")) === n));
    const headline: BoardQuantity[] = rows.slice(0, 6).map((row) => {
      const own = row.estimates.find((e) => e.kind === "own" && expNumber(String(e.experiment ?? "")) === n);
      return { id: cut(row.id, 80), value: num(own?.value), sigma: num(own?.sigma), status: row.status, cause: row.cause ? cut(row.cause, 200) : undefined };
    });
    const claims = rows.length ? {
      converging: rows.filter((r) => r.status === "converging").length,
      disputed: rows.filter((r) => r.status === "disputed").length,
      other: rows.filter((r) => r.status !== "converging" && r.status !== "disputed").length,
    } : undefined;

    const last = latestActionFor(actions, eid);
    const decision = last ? { action: last.action, at: last.at, by: cleanBy(last.by), comment: last.comment ? cut(cleanComment(last.comment), 400) : undefined } : undefined;
    // When the experiment last started (its newest spawn), so a rework already acted on stops showing as pending.
    const lastStartMs = running ? Date.parse(running.since) : 0;
    let state: CardState;
    if (last?.action === "stop") state = running ? "running" : "stopped";
    else if (running) state = "running";
    else if (reviewing.has(eid)) state = "reviewing";
    else if (last?.action === "rework" && Date.parse(last.at) > Math.max(deliveredMs, lastStartMs)) state = "rework";
    else if (last?.action === "accept" && latestRun && Date.parse(last.at) >= deliveredMs) state = "accepted";
    else state = latestRun ? "to_review" : "not_delivered";

    const files = [latestRun ? `data/experiments/${eid}/runs/${latestRun}/results.json` : "", review?.file ?? "", section ? "notes/experiments.md" : ""].filter(Boolean);
    cards.push({
      id: eid,
      title: cut(section?.heading ?? eid, 160),
      state,
      executor: existsSync(join(projectDir, ".agent", "claude-code", `session-${eid.replace(/[^\w.-]/g, "_")}.json`)) || marker ? "claude-code" : "pi",
      ledgerStatus: ledgerStatus ? cut(ledgerStatus, 200) : undefined,
      latestRun, deliveredAt, headline, claims,
      review: review ? { round: review.round, verdict: review.verdict, firstIssue: review.firstIssue } : undefined,
      decision, running, files,
    });
    if (section) backlog.push(...followUps(section, eid));
  }
  for (const s of sections) if (!claimed.has(s)) backlog.push(...followUps(s));

  return { project: basename(projectDir), updatedAt: new Date().toISOString(), runActive: runActive(projectDir), cards, backlog: backlog.slice(0, 50) };
}

// ── The operator's actions ───────────────────────────────────────────────────

export interface BoardActionInput { experiment: string; action: string; comment?: string; by?: string }
/** `code` names the effect so the studio can say it in the viewer's language; `effect` is the same in English. */
export type BoardEffectCode = "stop_killed" | "stop_pending" | "stop_turn_end" | "stop_held" | "rework_next_turn" | "rework_on_resume" | "accept_recorded";
export interface BoardActionResult { ok: boolean; message: string; effect?: string; code?: BoardEffectCode }

/**
 * Wait until this experiment's Claude Code run is over: its marker gone or its
 * group dead. The board never signals a process itself. The host that started
 * the run holds the process group in memory and polls the decision log every
 * two seconds; a marker file, which the executor can rewrite, never decides
 * what gets killed.
 */
function waitForStop(projectDir: string, eid: string, ms: number): boolean {
  const end = Date.now() + ms;
  const over = () => { const m = readRunningMarker(projectDir, eid); return !m || !alive(m.pgid) || !alive(m.hostPid); };
  while (Date.now() < end && !over()) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  return over();
}

export function applyBoardAction(projectDir: string, input: BoardActionInput): BoardActionResult {
  const eid = String(input.experiment ?? "");
  const action = String(input.action ?? "") as BoardAction;
  if (!EXPERIMENT_ID_RE.test(eid)) return { ok: false, message: "invalid experiment id" };
  if (!BOARD_ACTIONS.includes(action)) return { ok: false, message: "invalid action" };
  const card = buildBoard(projectDir).cards.find((c) => c.id === eid);
  if (!card) return { ok: false, message: `no experiment ${eid} in this project` };
  const comment = cleanComment(input.comment);
  const by = cleanBy(input.by);
  const runOn = runActive(projectDir);
  const when = runOn ? "at its next turn" : "when the run resumes";

  // The record first: the host of a running executor acts on it.
  const at = new Date().toISOString();
  let effect = "";
  let code: BoardEffectCode;
  if (action === "stop") {
    appendBoardAction(projectDir, { at, experiment: eid, action, comment: comment || undefined, by });
    const marker = readRunningMarker(projectDir, eid);
    if (marker && alive(marker.pgid) && alive(marker.hostPid)) {
      if (waitForStop(projectDir, eid, 8000)) { effect = "the running Claude Code executor was stopped"; code = "stop_killed"; }
      else { effect = "the running Claude Code executor stops within seconds"; code = "stop_pending"; }
    }
    else if (card.state === "running") { effect = "the running experiment stops at the end of its current turn"; code = "stop_turn_end"; }
    else { effect = "it will not be started again until you ask for a rework"; code = "stop_held"; }
    postBoardDirective(projectDir, eid, action,
      `The operator stopped ${eid} from the board${comment ? `: ${comment}` : "."} Do not dispatch ${eid} again unless the operator asks for a rework; report it as stopped by the operator.`, by);
  } else if (action === "rework") {
    appendBoardAction(projectDir, { at, experiment: eid, action, comment: comment || undefined, by });
    // A rework starts over (a new Claude Code session), not a patch on the old approach.
    try { unlinkSync(join(projectDir, ".agent", "claude-code", `session-${eid.replace(/[^\w.-]/g, "_")}.json`)); } catch { /* none */ }
    postBoardDirective(projectDir, eid, action,
      `The operator asked for ${eid} to be redone${comment ? `: ${comment}` : "."} Dispatch it again (spawn_agent experiment with EXPERIMENT_ID=${eid}) as a fresh attempt that addresses this; do not patch the previous run in place. Its earlier results stay on disk for reference.`, by);
    effect = `the brain re-dispatches it ${when}`;
    code = runOn ? "rework_next_turn" : "rework_on_resume";
  } else {
    appendBoardAction(projectDir, { at, experiment: eid, action, comment: comment || undefined, by });
    archiveBoardDirectives(projectDir, eid);
    effect = "recorded; the run does not wait for it";
    code = "accept_recorded";
  }
  return { ok: true, message: `${action} ${eid}`, effect, code };
}
