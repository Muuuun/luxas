#!/usr/bin/env tsx
/**
 * validate_observation — for a freshly-written observation in
 * observations.jsonl, run a 3-phase validation:
 *
 *   Phase 1 (git check). Does any commit in the last 14 days mention
 *     the pattern keyword(s)? If yes, the bug is likely already fixed —
 *     mark the observation `addressed_by_commit: <hash>` and skip
 *     phases 2-3.
 *
 *   Phase 2 (debate). Spawn reflect_validate twice in parallel, one with
 *     STANCE=pro ("real systemic problem") and one with STANCE=con
 *     ("false alarm / one-off / already addressed"). Collect both verdicts.
 *
 *   Phase 3 (converge). If both agree → record. If they disagree, loop
 *     up to MAX_ROUNDS more rounds, each time passing the OTHER side's
 *     prior round JSON as PRIOR_ROUND. If still disagreeing at max
 *     rounds → mark `validated: "unresolved"` with both rationales.
 *
 * Final state appended back to observations.jsonl as a separate
 * `_validation_<ts>.jsonl` line (NOT mutating the original observation
 * line — append-only ledger discipline). Format:
 *
 *   {
 *     "type": "validation",
 *     "ts": "<iso>",
 *     "validates_session_id": "<the observation's session_id>",
 *     "validates_pattern": "<the observation's pattern>",
 *     "verdict": "real | false | already_addressed | unresolved",
 *     "addressed_by_commit": "<hash or null>",
 *     "rounds": [
 *       { "round": 1, "pro": {...}, "con": {...} },
 *       ...
 *     ]
 *   }
 *
 * If the verdict is `real`, the orchestrator (caller) may invoke
 * reflect (deep) on this observation. This script does not propose
 * fixes — that remains the deep-review agent's job.
 *
 * Usage:
 *   tsx scripts/validate_observation.mts <sisyphus-root> [--max-rounds N]
 *
 * The observation to validate is the latest one in
 * `<META_STATE_DIR>/observations.jsonl` that lacks a corresponding
 * `_validation_*` entry referencing its session_id+pattern.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureMetaDirs } from "../src/meta-agents/state.js";

const sisyphusRoot = process.argv[2];
if (!sisyphusRoot || !existsSync(join(sisyphusRoot, "src/meta-agents"))) {
  console.error("usage: validate_observation.mts <sisyphus-root> [--max-rounds N]");
  process.exit(2);
}
const maxRoundsIdx = process.argv.indexOf("--max-rounds");
const MAX_ROUNDS = maxRoundsIdx > 0 ? parseInt(process.argv[maxRoundsIdx + 1], 10) : 3;
if (Number.isNaN(MAX_ROUNDS) || MAX_ROUNDS < 1) {
  console.error("--max-rounds must be a positive integer");
  process.exit(2);
}

const paths = ensureMetaDirs();
const obsPath = paths.observations;
if (!existsSync(obsPath)) {
  console.error("[validate] no observations.jsonl yet — nothing to validate");
  process.exit(0);
}

// Find the latest observation that hasn't been validated.
const lines = readFileSync(obsPath, "utf-8").trim().split("\n").filter(Boolean);
const validatedKeys = new Set<string>();
for (const line of lines) {
  try {
    const e = JSON.parse(line);
    if (e.type === "validation") {
      validatedKeys.add(`${e.validates_session_id}::${e.validates_pattern}`);
    }
  } catch { /* skip malformed */ }
}

let target: any = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const e = JSON.parse(lines[i]);
    if (e.type === "validation") continue;
    if (!e.session_id || !e.pattern) continue;
    if (validatedKeys.has(`${e.session_id}::${e.pattern}`)) continue;
    target = e;
    break;
  } catch { /* skip */ }
}
if (!target) {
  console.error("[validate] no unvalidated observation found");
  process.exit(0);
}
console.error(`[validate] target: pattern="${target.pattern}" session=${target.session_id}`);

// ── Phase 1: git check ──────────────────────────────────────────────────
function keywordsFromPattern(p: string): string[] {
  // pattern names use snake_case — split into 2-3 char-significant tokens.
  const tokens = p.split(/[_\s-]+/).filter((t) => t.length >= 4);
  return tokens.slice(0, 4); // cap at 4 grep terms to avoid noise
}

const keywords = keywordsFromPattern(target.pattern);
let addressedByCommit: string | null = null;
for (const kw of keywords) {
  const r = spawnSync(
    "git",
    ["-C", sisyphusRoot, "log", "--since=14 days ago", "--oneline", `--grep=${kw}`, "-i", "--max-count=3"],
    { encoding: "utf-8" },
  );
  const out = r.stdout?.trim() ?? "";
  if (out.length > 0) {
    const firstHash = out.split("\n")[0].split(/\s+/)[0];
    addressedByCommit = firstHash;
    console.error(`[validate] phase 1: keyword "${kw}" matched commit ${firstHash}`);
    break;
  }
}
if (addressedByCommit) {
  console.error(`[validate] phase 1: candidate commit found, BUT keyword grep can false-positive (e.g. commit message documents the pattern without fixing it). Passing to debate for verification.`);
} else {
  console.error(`[validate] phase 1: no candidate commit; advancing to debate`);
}

// ── Phase 2-3: debate ───────────────────────────────────────────────────
function runValidate(stance: "pro" | "con", priorRound: string): any {
  const vars: Record<string, string> = {
    SISYPHUS_ROOT: sisyphusRoot,
    SESSION_JSONL_PATH: target.session_id?.includes("/") ? target.session_id : "",
    META_STATE_DIR: paths.stateDir,
    OBSERVATION_JSON: JSON.stringify(target),
    STANCE: stance,
    PRIOR_ROUND: priorRound,
    CANDIDATE_COMMIT: addressedByCommit ?? "",
  };
  const r = spawnSync(
    "npx",
    [
      "tsx",
      join(sisyphusRoot, "scripts/invoke_meta_agent.mts"),
      "reflect_validate",
      sisyphusRoot,
      JSON.stringify(vars),
      `Validate the observation per your STANCE=${stance}. Read AT MOST: (1) the OBSERVATION_JSON shown above, (2) the CANDIDATE_COMMIT diff if provided via git show, (3) one quick git log scan, (4) the relevant section of the session jsonl IF the observation cites specific lines. Then STOP and emit your verdict as a JSON code block. Do NOT explore further; do NOT recursively read the codebase. The orchestrator parses the LAST {...} JSON block in your output, so end your output with the verdict.`,
    ],
    // 10min cap per call (was 5min, agents were timing out mid-bash). With
    // the stricter "AT MOST 4 reads" prompt above, normal verdicts return
    // in 1-3 minutes; the extra headroom absorbs the occasional retry.
    { encoding: "utf-8", cwd: sisyphusRoot, timeout: 10 * 60_000 },
  );
  // Agent's output is lines of stdout from invoke_meta_agent. The trailer
  // (`--- invoke_meta_agent trailer ---\nagent: ...\nsuccess: ...`) is on
  // stderr; the JSON verdict is somewhere in stdout.
  const out = r.stdout ?? "";
  // Try fenced ```json blocks first (most reliable), then fall back to
  // any {...} block. Agent may emit several false positives before
  // settling — take the LAST verdict-shaped object.
  const fencedBlocks = [...out.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const looseBlocks = [...out.matchAll(/\{[\s\S]*?\}/g)].map((m) => m[0]);
  const candidates = [...fencedBlocks, ...looseBlocks].reverse();
  for (const blob of candidates) {
    try {
      const obj = JSON.parse(blob.trim());
      if (obj && typeof obj.verdict === "string" &&
          (obj.verdict === "real" || obj.verdict === "false" || obj.verdict === "unresolved")) {
        return { stance, ...obj };
      }
    } catch { /* keep looking */ }
  }
  return { stance, verdict: "unresolved", rationale: "agent did not emit parseable verdict JSON", evidence_cited: [], raw_output_tail: out.slice(-500) };
}

const rounds: Array<{ round: number; pro: any; con: any }> = [];
let priorRoundJson = "";
let final: { verdict: string; pro: any; con: any } | null = null;

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.error(`[validate] phase 2/3: round ${round}/${MAX_ROUNDS} — spawning pro and con`);
  const proPriorJson = priorRoundJson ? JSON.stringify({ con_last_round: JSON.parse(priorRoundJson).con }) : "";
  const conPriorJson = priorRoundJson ? JSON.stringify({ pro_last_round: JSON.parse(priorRoundJson).pro }) : "";
  // Sequential, not parallel: keeps stderr readable + bounds memory.
  const proVerdict = runValidate("pro", proPriorJson);
  const conVerdict = runValidate("con", conPriorJson);
  rounds.push({ round, pro: proVerdict, con: conVerdict });
  console.error(`[validate]   pro=${proVerdict.verdict}, con=${conVerdict.verdict}`);

  // Convergence check.
  if (proVerdict.verdict === "real" && conVerdict.verdict === "real") {
    final = { verdict: "real", pro: proVerdict, con: conVerdict };
    break;
  }
  if (proVerdict.verdict === "false" && conVerdict.verdict === "false") {
    final = { verdict: "false", pro: proVerdict, con: conVerdict };
    break;
  }
  // One side conceded the other's stance (e.g. pro returned "false") —
  // also counts as convergence on the conceded answer.
  if (proVerdict.verdict === conVerdict.verdict && proVerdict.verdict !== "unresolved") {
    final = { verdict: proVerdict.verdict, pro: proVerdict, con: conVerdict };
    break;
  }
  priorRoundJson = JSON.stringify({ pro: proVerdict, con: conVerdict });
}

if (!final) {
  final = { verdict: "unresolved", pro: rounds[rounds.length - 1].pro, con: rounds[rounds.length - 1].con };
  console.error(`[validate] no convergence after ${MAX_ROUNDS} rounds — verdict: unresolved`);
} else {
  console.error(`[validate] converged at round ${rounds.length}: verdict=${final.verdict}`);
}

const entry = {
  type: "validation",
  ts: new Date().toISOString(),
  validates_session_id: target.session_id,
  validates_pattern: target.pattern,
  verdict: final.verdict,
  addressed_by_commit: null,
  rounds,
};
mkdirSync(paths.stateDir, { recursive: true });
appendFileSync(obsPath, JSON.stringify(entry) + "\n");
console.error(`[validate] appended validation entry to ${obsPath}`);
