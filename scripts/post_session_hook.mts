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
  { stdio: "inherit", cwd: sisyphusRoot },
);
if (lightResult.status !== 0) {
  console.error(`reflect_light failed with status ${lightResult.status}`);
  process.exit(1);
}

// ── 2. Bump run counter. If threshold reached, trigger deep review ────────

const n = bumpRunCounter();
console.error(`[post-session-hook] run_counter = ${n} / ${DEEP_REVIEW_EVERY_N_SESSIONS}`);

if (n < DEEP_REVIEW_EVERY_N_SESSIONS) process.exit(0);

// Deep review gated: never fire if user is mid-vote on existing pending.
if (inboxLocked()) {
  console.error(`[post-session-hook] inbox locked (user voting) — deferring deep review`);
  process.exit(0);
}

console.error(`[post-session-hook] threshold reached — invoking reflect_harness (deep)`);
const deepResult = spawnSync(
  "npx",
  ["tsx", join(sisyphusRoot, "scripts/reflect_harness.mts"), sisyphusRoot],
  { stdio: "inherit", cwd: sisyphusRoot },
);

if (deepResult.status === 0) {
  // Harness handles its own log rotation + counter reset on success; still
  // reset here as a safety net in case the harness exited early before it
  // got to the reset step.
  resetRunCounter();
}

process.exit(deepResult.status ?? 1);
