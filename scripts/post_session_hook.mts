#!/usr/bin/env tsx
/**
 * Post-session hook. Invoked by Sisyphus (or a wrapper running it) after
 * each session completes. Runs reflect_light against the just-finished
 * session jsonl, bumps the run counter, and triggers reflect_harness.mts
 * (deep review) once the counter reaches DEEP_REVIEW_EVERY_N_SESSIONS.
 *
 * Usage:
 *   tsx scripts/post_session_hook.mts <session-jsonl-path> <sisyphus-root>
 *
 *   <session-jsonl-path>  absolute path to the just-finished session's jsonl
 *                         (typically ~/.claude/projects/.../abc.jsonl or the
 *                         project's .agent/checkpoint.done-<ts>.jsonl)
 *   <sisyphus-root>        absolute path to the Sisyphus repo checkout
 *
 * Exit codes: 0 = hook ran (regardless of whether deep review fired);
 * non-zero = reflect_light or harness failed. Errors do not block the
 * calling Sisyphus session — caller should treat this hook as best-effort.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  bumpRunCounter,
  resetRunCounter,
  ensureMetaDirs,
  DEEP_REVIEW_EVERY_N_SESSIONS,
  getMetaPaths,
  inboxLocked,
} from "../src/meta-agents/state.js";

const [, , sessionJsonl, sisyphusRoot] = process.argv;
if (!sessionJsonl || !sisyphusRoot) {
  console.error("usage: post_session_hook.mts <session-jsonl> <sisyphus-root>");
  process.exit(2);
}
if (!existsSync(sessionJsonl)) {
  console.error(`session jsonl not found: ${sessionJsonl}`);
  process.exit(2);
}
if (!existsSync(join(sisyphusRoot, "src/meta-agents"))) {
  console.error(`sisyphus root missing src/meta-agents: ${sisyphusRoot}`);
  process.exit(2);
}

const paths = ensureMetaDirs();

// Check the lock BEFORE reflect_light runs: if reflect_harness is already
// executing, reflect_light's append to observations.jsonl would race against
// reflect's read, and the just-appended line would be rotated into archive
// without ever being consumed. Skipping this session's observation is a
// cheaper loss than silently-dropped evidence.
if (inboxLocked()) {
  console.error(`[post-session-hook] inbox locked — skipping reflect_light + deep review this session`);
  process.exit(0);
}

// ── 1. Run reflect_light against the just-finished session ────────────────

const lightVars = {
  SISYPHUS_ROOT: sisyphusRoot,
  SESSION_JSONL_PATH: sessionJsonl,
  META_STATE_DIR: paths.stateDir,
  INBOX_DIR: paths.inboxDir,
};

const lightResult = spawnSync(
  "npx",
  [
    "tsx",
    join(sisyphusRoot, "scripts/invoke_meta_agent.mts"),
    "reflect_light",
    sisyphusRoot,
    JSON.stringify(lightVars),
    `Classify session at ${sessionJsonl}. Append to observations or support jsonl per your workflow.`,
  ],
  // Haiku + low thinking: ≤20 turns budget. 5min hard cap prevents an API
  // stall from hanging this fire-and-forget hook indefinitely.
  { stdio: "inherit", cwd: sisyphusRoot, timeout: 5 * 60_000 },
);
if (lightResult.status !== 0) {
  console.error(`reflect_light failed with status ${lightResult.status}`);
  process.exit(1);
}

// ── 1.5. Validate the latest observation (git check + 2-agent debate) ─────
//
// reflect_light may have written a fresh observation. Before letting it sit
// in the queue (where it would eventually inflate run_counter and trigger
// the expensive deep harness), run validate_observation: phase 1 greps git
// log to detect "already addressed by recent commit"; phases 2-3 spawn a
// pro/con debate (reflect_validate ×2) and converge ≤ MAX_ROUNDS rounds.
// Output is appended to observations.jsonl as a separate `type: validation`
// entry referencing the observation by session_id+pattern. The deep
// harness later filters on these to skip already-addressed and false
// observations.
const validateResult = spawnSync(
  "npx",
  ["tsx", join(sisyphusRoot, "scripts/validate_observation.mts"), sisyphusRoot],
  // Each round spawns 2 reflect_validate calls (5min cap each), MAX_ROUNDS=3
  // → upper bound ~30min. Set wider to absorb retry overhead.
  { stdio: "inherit", cwd: sisyphusRoot, timeout: 45 * 60_000 },
);
if (validateResult.status !== 0) {
  console.error(`validate_observation failed (status ${validateResult.status}); continuing`);
}

// ── 2. Bump run counter. If threshold reached, trigger deep review ────────

const n = bumpRunCounter();
console.error(`[post-session-hook] run_counter = ${n} / ${DEEP_REVIEW_EVERY_N_SESSIONS}`);

if (n < DEEP_REVIEW_EVERY_N_SESSIONS) process.exit(0);

console.error(`[post-session-hook] threshold reached — invoking reflect_harness (deep)`);
const deepResult = spawnSync(
  "npx",
  ["tsx", join(sisyphusRoot, "scripts/reflect_harness.mts"), sisyphusRoot],
  // Opus-high-thinking reflect + up to 30 A/B Sisyphus runs. 2h bound is
  // generous but finite — beyond this assume stall and let the next session
  // retry via its own hook. The harness itself releases the inbox lock on
  // stdlib-cleanup so even a kill won't permanently wedge (stale-PID reaper).
  { stdio: "inherit", cwd: sisyphusRoot, timeout: 2 * 60 * 60_000 },
);

if (deepResult.status === 0) {
  // Harness handles its own log rotation + counter reset on success; still
  // reset here as a safety net in case the harness exited early before it
  // got to the reset step.
  resetRunCounter();
}

process.exit(deepResult.status ?? 1);
