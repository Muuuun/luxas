/**
 * claims_dispatch — did surfacing disputes change what the brain dispatched?
 *
 * Reader for the design §3.7 build-order condition: "surface DISCREPANT rows in
 * L3 and check on one live run whether dispatch changes; the full table ships
 * only if it does." Reconstructs, from disk, when the first dispute signal
 * landed (a DISCREPANT cross_validation or a `disputed` claim-table row) and
 * classifies every spawn_agent the brain made after that moment:
 *
 *   settling  — replicator, experiment (a third route / discriminator)
 *   cosmetic  — illustrator, illustrator_write, typesetter, report_writer,
 *               contradiction_auditor, prior_art_auditor (design §3.7: not to be
 *               dispatched while a headline is disputed)
 *   other     — search, reader, worker, math, fixer, ledger_writer, reviewer…
 *
 * Usage: npx tsx scripts/claims_dispatch.mts <project-dir> [--json]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildClaimTable } from "../src/claims-table.ts";
import { listExperimentDirs, xvalVerdict } from "../src/tools/report-integrity.ts";

const SETTLING = new Set(["replicator", "experiment"]);
const COSMETIC = new Set(["illustrator", "illustrator_write", "typesetter", "report_writer", "contradiction_auditor", "prior_art_auditor"]);

export interface Spawn { t: string; agent: string; experimentId?: string; role?: string; task: string; cls: "settling" | "cosmetic" | "other" }
export interface Signal { t: string; kind: "xval_discrepant" | "quantities_declared"; experiment: string; detail: string }
export interface DispatchReport {
  projectDir: string;
  spawns: Spawn[];
  signals: Signal[];
  firstSignal: Signal | null;
  after: { settling: number; cosmetic: number; other: number; firstAgent: string | null; sequence: string[] };
  disputedNow: string[];
  needsOperator: boolean;
  verdict: "changed" | "unchanged" | "no-signal" | "no-spawns-after";
}

function classify(agent: string): Spawn["cls"] { return SETTLING.has(agent) ? "settling" : COSMETIC.has(agent) ? "cosmetic" : "other"; }

function readSpawns(projectDir: string): Spawn[] {
  const p = join(projectDir, ".agent", "log.jsonl");
  if (!existsSync(p)) return [];
  // Two entries per spawn: a `phase:"started"` marker (accurate start time,
  // agent_id, no templateVars) written by spawn.ts / background spawns, and the
  // hooks.ts completion entry (full args, but timestamped when the child
  // FINISHED — an hour later for an experiment). Time comes from the marker,
  // templateVars/task from the completion, paired in order per agent name.
  const started: { t: string; agent: string }[] = [];
  const completed: { t: string; agent: string; tv: Record<string, string>; task: string; n: number }[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let e: any; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "tool_call" || e.tool !== "spawn_agent") continue;
    const a = e.args ?? {};
    if (e.phase === "started") { started.push({ t: e.timestamp, agent: String(a.agent ?? "?") }); continue; }
    if (e.success === false) continue;
    if (a.action && a.action !== "spawn") continue;
    const tasks = Array.isArray(a.tasks) ? a.tasks : null;
    const task = String(a.task ?? (tasks ? `[${tasks.length} tasks] ${tasks[0] ?? ""}` : "")).slice(0, 120);
    completed.push({ t: e.timestamp, agent: String(a.agent ?? "?"), tv: a.templateVars ?? {}, task, n: tasks ? tasks.length : 1 });
  }
  const out: Spawn[] = [];
  if (started.length === 0) {
    for (const c of completed) out.push({ t: c.t, agent: c.agent, experimentId: c.tv.EXPERIMENT_ID, role: c.tv.ROLE, task: c.task, cls: classify(c.agent) });
    return out;
  }
  const queue = new Map<string, typeof completed>();
  for (const c of completed) { const q = queue.get(c.agent) ?? []; for (let i = 0; i < c.n; i++) q.push(c); queue.set(c.agent, q); }
  for (const s of started) {
    const c = queue.get(s.agent)?.shift();
    out.push({ t: s.t, agent: s.agent, experimentId: c?.tv.EXPERIMENT_ID, role: c?.tv.ROLE, task: c?.task ?? "(still running)", cls: classify(s.agent) });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

function readSignals(projectDir: string): Signal[] {
  const out: Signal[] = [];
  for (const e of listExperimentDirs(projectDir)) {
    if (!e.latestResults) continue;
    let j: any; try { j = JSON.parse(readFileSync(e.latestResults, "utf-8")); } catch { continue; }
    const t = statSync(e.latestResults).mtime.toISOString();
    const xv = j?.computed?.cross_validation;
    if (Array.isArray(xv)) for (const x of xv) if (xvalVerdict(x) === "discrepant")
      out.push({ t, kind: "xval_discrepant", experiment: e.id, detail: `${x.claim_key}: ${x.value_a} vs ${x.value_b}` });
    const qs = j?.computed?.quantities;
    if (Array.isArray(qs) && qs.length) out.push({ t, kind: "quantities_declared", experiment: e.id, detail: qs.map((q: any) => q?.id).filter(Boolean).join(", ") });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

export function measureDispatch(projectDir: string): DispatchReport {
  const spawns = readSpawns(projectDir);
  const signals = readSignals(projectDir);
  // The dispute signal is what the brain sees in <open_discrepancies>; quantities
  // alone are recorded for the timeline but do not count as "the signal".
  const firstSignal = signals.find((s) => s.kind === "xval_discrepant") ?? null;
  let disputedNow: string[] = [];
  try { disputedNow = buildClaimTable(projectDir).rows.filter((r) => r.status === "disputed").map((r) => r.id); } catch { /* legacy */ }
  const afterSpawns = firstSignal ? spawns.filter((s) => s.t > firstSignal.t) : [];
  const after = {
    settling: afterSpawns.filter((s) => s.cls === "settling").length,
    cosmetic: afterSpawns.filter((s) => s.cls === "cosmetic").length,
    other: afterSpawns.filter((s) => s.cls === "other").length,
    firstAgent: afterSpawns[0]?.agent ?? null,
    sequence: afterSpawns.map((s) => s.agent + (s.experimentId ? `(${s.experimentId})` : "")),
  };
  const needsOperator = existsSync(join(projectDir, "notes", "escalations", "needs-operator.md"));
  let verdict: DispatchReport["verdict"];
  if (!firstSignal) verdict = "no-signal";
  else if (afterSpawns.length === 0) verdict = "no-spawns-after";
  else verdict = afterSpawns.find((s) => s.cls !== "other")?.cls === "settling" ? "changed" : "unchanged";
  return { projectDir, spawns, signals, firstSignal, after, disputedNow, needsOperator, verdict };
}

export function renderDispatch(r: DispatchReport): string {
  const out: string[] = [`claims dispatch — ${r.projectDir}`, `spawns ${r.spawns.length}; signals ${r.signals.length}; disputed now: [${r.disputedNow.join(", ") || "—"}]; needs-operator: ${r.needsOperator}`, ""];
  const events = [
    ...r.spawns.map((s) => ({ t: s.t, line: `spawn  ${s.cls.padEnd(8)} ${s.agent}${s.experimentId ? ` ${s.experimentId}` : ""}${s.role ? ` role="${s.role}"` : ""}  ${s.task.replace(/\s+/g, " ").slice(0, 70)}` })),
    ...r.signals.map((s) => ({ t: s.t, line: `SIGNAL ${s.kind.padEnd(19)} ${s.experiment}: ${s.detail.slice(0, 80)}` })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  for (const e of events) out.push(`${e.t.slice(11, 19)}  ${e.line}`);
  out.push("", `first dispute signal: ${r.firstSignal ? `${r.firstSignal.t.slice(11, 19)} ${r.firstSignal.experiment} ${r.firstSignal.detail.slice(0, 60)}` : "none"}`);
  out.push(`after it: settling ${r.after.settling}, cosmetic ${r.after.cosmetic}, other ${r.after.other}; first non-other spawn: ${r.after.firstAgent ?? "—"}`);
  out.push(`verdict (§3.7 build-order condition): ${r.verdict.toUpperCase()}`);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) { console.error("usage: claims_dispatch.mts <project-dir> [--json]"); process.exit(2); }
  const r = measureDispatch(dir);
  console.log(args.includes("--json") ? JSON.stringify(r, null, 2) : renderDispatch(r));
}
