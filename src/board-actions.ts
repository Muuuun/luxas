/**
 * The operator's decisions on experiments, made from the studio board
 * (src/board.ts builds the board; src/board-cli.ts is what the studio runs).
 *
 * One append-only file, .agent/board-actions.jsonl, is the record. Its readers:
 *   - src/board.ts — each card shows the latest decision;
 *   - spawnAgent and the background runner (stoppedByOperator) — a stopped
 *     experiment is not started again until the operator asks for a rework,
 *     and a running pi experiment aborts at its next turn end;
 *   - src/executors/claude-code.ts — a Claude Code run that was stopped is
 *     reported as stopped, not as undelivered (the review loop would re-send it).
 * A stop also kills a running Claude Code executor at once, through the
 * marker that executor writes (.agent/claude-code/running-<EID>.json), after
 * checking that the process group is still that executor.
 *
 * Accepting has no effect on the run: the operator confirms after the fact and
 * the run never waits for it (the operator's decision, 2026-10-25).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type BoardAction = "accept" | "rework" | "stop";
export const BOARD_ACTIONS: readonly BoardAction[] = ["accept", "rework", "stop"];
export interface BoardActionRecord { at: string; experiment: string; action: BoardAction; comment?: string; by?: string; effect?: string }

export const EXPERIMENT_ID_RE = /^E\d+[A-Za-z0-9_.-]{0,80}$/;
export const MAX_COMMENT_CHARS = 2000;
/** Process-group leader name of a Claude Code executor run (its $0), so its group is recognisable in `ps`. */
export const WATCHDOG_NAME = "luxas-claude-code";
export const BOARD_DIRECTIVE_SOURCE = "studio-board";

const actionsPath = (projectDir: string) => join(projectDir, ".agent", "board-actions.jsonl");
const safeName = (eid: string) => eid.replace(/[^\w.-]/g, "_");

/**
 * How a harness message names an operator stop. The comment is quoted as the
 * operator's note, cut short and cleaned again on the way out: the decision
 * log is in the project, where an executor can append a line of its own, so a
 * comment is data to show, never an instruction to follow.
 */
export function operatorStopNote(eid: string, rec: { comment?: string }): string {
  const note = rec.comment ? cleanComment(rec.comment).replace(/\s+/g, " ").slice(0, 300) : "";
  return `${eid} was stopped by the operator from the board${note ? ` (operator note, quoted: "${note.replace(/"/g, "'")}")` : ""}`;
}

/** Control characters out (newlines kept), length capped: the text reaches the brain's prompt and a web page. */
export function cleanComment(s: unknown): string {
  return String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ").trim().slice(0, MAX_COMMENT_CHARS);
}
export function cleanBy(s: unknown): string | undefined {
  const v = String(s ?? "").replace(/[^\w.@+-]/g, "").slice(0, 200);
  return v || undefined;
}

export function readBoardActions(projectDir: string): BoardActionRecord[] {
  let raw = "";
  try { raw = readFileSync(actionsPath(projectDir), "utf-8"); } catch { return []; }
  const out: BoardActionRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j && typeof j.experiment === "string" && BOARD_ACTIONS.includes(j.action) && typeof j.at === "string") out.push(j);
    } catch { /* a torn line */ }
  }
  return out;
}

export function appendBoardAction(projectDir: string, rec: BoardActionRecord): void {
  mkdirSync(join(projectDir, ".agent"), { recursive: true });
  appendFileSync(actionsPath(projectDir), JSON.stringify(rec) + "\n");
}

export function latestActionFor(actions: BoardActionRecord[], eid: string): BoardActionRecord | undefined {
  for (let i = actions.length - 1; i >= 0; i--) if (actions[i].experiment === eid) return actions[i];
  return undefined;
}

/** The stop in force for this experiment, if its latest decision is a stop (a later rework or accept lifts it). */
export function stoppedByOperator(projectDir: string, eid: string): BoardActionRecord | undefined {
  if (!eid) return undefined;
  const last = latestActionFor(readBoardActions(projectDir), eid);
  return last?.action === "stop" ? last : undefined;
}

/** A stop issued at or after `sinceMs` (a run's start): the run in flight was the one stopped. */
export function stopIssuedSince(projectDir: string, eid: string, sinceMs: number): BoardActionRecord | undefined {
  const s = stoppedByOperator(projectDir, eid);
  return s && Date.parse(s.at) >= sinceMs - 1000 ? s : undefined;
}

// ── The Claude Code executor's running marker ────────────────────────────────

/** `budget` is what the run may still spend (api runs); the next executor reserves it from the cap. */
export interface RunningMarker { eid?: string; pgid: number; hostPid: number; agentId: string; startedAt: string; budget?: number }
const markerPath = (projectDir: string, eid: string) => join(projectDir, ".agent", "claude-code", `running-${safeName(eid)}.json`);

export function writeRunningMarker(projectDir: string, eid: string, m: RunningMarker): void {
  mkdirSync(join(projectDir, ".agent", "claude-code"), { recursive: true });
  const p = markerPath(projectDir, eid);
  writeFileSync(`${p}.tmp`, JSON.stringify(m) + "\n");
  renameSync(`${p}.tmp`, p);
}

export function readRunningMarker(projectDir: string, eid: string): RunningMarker | undefined {
  try {
    const j = JSON.parse(readFileSync(markerPath(projectDir, eid), "utf-8"));
    return Number.isInteger(j?.pgid) && j.pgid > 1 ? j : undefined;
  } catch { return undefined; }
}

/** Every marker in the project (live or stale: the caller checks the pids). */
export function readRunningMarkers(projectDir: string): RunningMarker[] {
  const dir = join(projectDir, ".agent", "claude-code");
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => n.startsWith("running-") && n.endsWith(".json")); } catch { return []; }
  const out: RunningMarker[] = [];
  for (const n of names) {
    try {
      const j = JSON.parse(readFileSync(join(dir, n), "utf-8"));
      if (Number.isInteger(j?.pgid) && j.pgid > 1) out.push({ ...j, budget: typeof j.budget === "number" && j.budget >= 0 ? j.budget : 0 });
    } catch { /* torn */ }
  }
  return out;
}

/** Removes the marker only if it is still this run's (a newer run of the experiment may have replaced it). */
export function clearRunningMarker(projectDir: string, eid: string, pgid: number): void {
  if (readRunningMarker(projectDir, eid)?.pgid === pgid) try { unlinkSync(markerPath(projectDir, eid)); } catch { /* gone */ }
}

// ── Directives the board posts for the brain ─────────────────────────────────

const directivesDir = (projectDir: string) => join(projectDir, "notes", "directives");

/** Board directives about this experiment (optionally of one action), active ones only. */
function boardDirectiveFiles(projectDir: string, eid: string, action?: BoardAction): string[] {
  let names: string[] = [];
  try { names = readdirSync(directivesDir(projectDir)).filter((n) => n.endsWith(".md")); } catch { return []; }
  return names.filter((n) => {
    if (!n.includes(`-board-${safeName(eid)}`)) return false;
    let head = "";
    try { head = readFileSync(join(directivesDir(projectDir), n), "utf-8").slice(0, 600); } catch { return false; }
    if (!head.includes(`source: ${BOARD_DIRECTIVE_SOURCE}`) || !head.includes(`experiment: ${eid}\n`)) return false;
    return !action || head.includes(`action: ${action}\n`);
  });
}

/** Move board directives about this experiment to notes/directives/archived/, so the brain stops seeing them. */
export function archiveBoardDirectives(projectDir: string, eid: string, action?: BoardAction): string[] {
  const moved: string[] = [];
  const files = boardDirectiveFiles(projectDir, eid, action);
  if (!files.length) return moved;
  const arch = join(directivesDir(projectDir), "archived");
  mkdirSync(arch, { recursive: true });
  for (const n of files) {
    try { renameSync(join(directivesDir(projectDir), n), join(arch, n)); moved.push(n); } catch { /* raced */ }
  }
  return moved;
}

/**
 * Post one directive about one experiment, replacing the board's earlier ones
 * about it. Same file scheme as the monitor's (src/tools/monitor-tools.ts
 * postDirective), read by context.ts collectActiveDirectives before every brain call.
 */
export function postBoardDirective(projectDir: string, eid: string, action: BoardAction, text: string, by?: string): string {
  archiveBoardDirectives(projectDir, eid);
  const dir = directivesDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const name = `${now.toISOString().replace(/[:.]/g, "-")}-board-${safeName(eid)}`;
  const lines = ["---", `issued_at: ${now.toISOString()}`, `source: ${BOARD_DIRECTIVE_SOURCE}`, `experiment: ${eid}`, `action: ${action}`];
  if (by) lines.push(`by: ${by}`);
  lines.push("---", "", text.trim(), "");
  writeFileSync(join(dir, `${name}.md`), lines.join("\n"), "utf-8");
  return name;
}

export function directiveExists(projectDir: string, name: string): boolean {
  return existsSync(join(directivesDir(projectDir), `${name}.md`));
}
