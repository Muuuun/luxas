#!/usr/bin/env tsx
/**
 * audit_experiment — a recomputing audit of one experiment: a bare Claude Code
 * session on the claude.ai subscription, run on a clone of the project.
 *
 * Verifier bench A2 (2026-10-20, ~/.sisyphus/verifier-bench-keys/A2/RESULT.md):
 * every file of the planted item agreed with every other; only recomputation
 * showed the error. Adding one sentence to the bare audit ("recompute each
 * headline yourself from the physics, re-run the shipped code") caught both
 * faults, with no false finding on two clean experiments:
 *  - the planted extra 2*pi in E1's T2*. The audit without the sentence ran the
 *    code and believed it.
 *  - a real one in the shipped Dy E1: a white-noise floor its own code no longer
 *    produces. review_experiment's reviewer derived the formula but never
 *    compared the code's output with results.json.
 * n = 2 faults, one run per arm.
 *
 * It sits beside review_experiment, which owns the round files the claims table
 * and the finish gate read; this writes nothing into the project. The clone is
 * what makes "re-run the shipped code" safe: a project's build scripts
 * overwrite its results.json.
 *
 * Usage:
 *   npx tsx scripts/audit_experiment.mts <projectDir> <EXPERIMENT_ID>
 *        [--max-budget-usd N]   default 6 (list price; the subscription is not billed per call)
 *        [--model M]            default claude-opus-5-5, as measured
 *        [--effort E]           default high, as measured
 * Exit: 0 NO BREAKS, 3 BREAKS found, 1 the audit did not complete, 2 refused.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { groupSpawnSync, reapArm } from "./bench_run.mts";

export const AUDIT_MODEL = "claude-opus-5-5";
export const AUDIT_EFFORT = "high";

/** The A2 prompt, verbatim: the A1 two-sentence audit plus the recompute sentence. */
export function auditPrompt(eid: string): string {
  return `Audit experiment ${eid} in this research project: its ledger section is in notes/experiments.md and its code, data and results.json are under data/experiments/${eid}/.` +
    ` Do not trust the experiment's own outputs: for each headline number, recompute it independently from the stated inputs and the physics (derive the formula yourself), and re-run the shipped code to check that it actually produces the reported value.` +
    ` Check whether every headline claim follows from what the experiment actually computed, and report each defect as one line \`BREAKS <file>:<key or quoted text> — <what is wrong, with the value you found vs the value reported>\`, or \`NO BREAKS\` if there is none.`;
}

/**
 * The audit's answer and what it cost. A background-task notification that
 * lands after the answer adds a one-turn follow-up result to the stream; the
 * audit is the longest result, and the cost is the largest (it is cumulative).
 */
export function readAudit(transcript: string): { text: string; turns: number; costUsd: number; durationMs: number; login: string } | null {
  const rows: any[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  const results = rows.filter((r) => r?.type === "result");
  if (!results.length) return null;
  // Ties go to the LAST row: a session with background jobs emits "I'll continue once the simulation finishes" at N
  // turns and the answer at N turns again (bench C1 a3-01); the one-turn follow-up still loses.
  const main = results.reduce((a, b) => ((b.num_turns ?? 0) >= (a.num_turns ?? 0) ? b : a));
  const init = rows.find((r) => r?.type === "system" && r?.subtype === "init");
  return {
    text: String(main.result ?? ""), turns: main.num_turns ?? 0, durationMs: main.duration_ms ?? 0,
    costUsd: Math.max(...results.map((r) => Number(r.total_cost_usd ?? 0))), login: String(init?.apiKeySource ?? "unknown"),
  };
}

function refuse(msg: string): never {
  console.log(`audit_experiment refused: ${msg}`);
  process.exit(2);
}

function main(argv: string[]): void {
  const pos = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const flag = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const [projectArg, eid] = pos;
  if (!projectArg || !eid) refuse("usage: audit_experiment.mts <projectDir> <EXPERIMENT_ID> [--max-budget-usd N] [--model M] [--effort E]");
  // The id is printed into the prompt and joined into a path: a plain token only.
  if (!/^E\d+[A-Za-z0-9_]*$/.test(eid)) refuse(`${JSON.stringify(eid)} is not an experiment id (E<N>_<slug>)`);
  const project = resolve(projectArg);
  if (!existsSync(join(project, "notes", "experiments.md"))) refuse(`${project} has no notes/experiments.md`);
  if (!existsSync(join(project, "data", "experiments", eid))) refuse(`${project} has no data/experiments/${eid}/`);
  const maxUsd = Number(flag("--max-budget-usd") ?? 6);
  if (!(maxUsd > 0)) refuse("--max-budget-usd needs a positive number");
  const model = flag("--model") ?? AUDIT_MODEL, effort = flag("--effort") ?? AUDIT_EFFORT;

  const clone = join(realpathSync(mkdtempSync(join(tmpdir(), `luxas-audit-${eid}-`))), "project");
  try { execFileSync("cp", process.platform === "darwin" ? ["-Rc", project, clone] : ["-R", "--reflink=auto", project, clone]); }
  catch (err) { console.log(`audit_experiment: could not clone ${project}: ${(err as Error).message.slice(0, 200)}`); process.exit(1); }

  // The subscription login, not the API key: the CLI prefers ANTHROPIC_API_KEY when it is set.
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  console.log(`◈ audit ${eid} — model=${model} effort=${effort} cap=$${maxUsd} (list) clone=${clone}`);
  const args = ["-p", auditPrompt(eid), "--model", model, "--effort", effort, "--output-format", "stream-json", "--verbose",
    "--max-budget-usd", String(maxUsd), "--allowedTools", "Bash", "Read", "Glob", "Grep", "--strict-mcp-config", "--no-session-persistence"];
  const r = groupSpawnSync("claude", args, { cwd: clone, env, encoding: "utf-8", timeout: 90 * 60_000, maxBuffer: 512 * 1024 * 1024 });
  reapArm(clone, r.pid);
  writeFileSync(join(clone, "audit_transcript.jsonl"), String(r.stdout ?? ""));
  const a = readAudit(String(r.stdout ?? ""));
  if (!a) {
    console.log(`◈ audit did not complete: ${r.error?.message ?? `exit ${r.status}`} ${String(r.stderr ?? "").slice(-300)}`);
    process.exit(1);
  }
  if (a.login !== "none") console.log(`◈ warning: apiKeySource=${a.login} — this audit was billed to an API key, not the subscription`);
  // The model writes "BREAK" as often as "BREAKS" (bench A3: four singular lines read as none).
  const breaks = a.text.split("\n").filter((l) => /^\s*[-*]?\s*`?BREAKS?\b/.test(l));
  const clean = !breaks.length && /NO BREAKS/.test(a.text);
  const where = `${a.turns} turns, ${(a.durationMs / 60_000).toFixed(1)} min, $${a.costUsd.toFixed(2)} list price; transcript ${join(clone, "audit_transcript.jsonl")}`;
  if (breaks.length || clean) {
    console.log(breaks.length ? breaks.join("\n") : "NO BREAKS");
    console.log(`◈ ${breaks.length} BREAKS line(s) — ${where}`);
  } else {
    console.log(a.text.slice(0, 2000));
    console.log(`◈ the audit finished with no BREAKS or NO BREAKS line — read its answer above or the transcript — ${where}`);
  }
  process.exit(breaks.length ? 3 : clean ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
