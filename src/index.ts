#!/usr/bin/env node
/**
 * Luxas CLI — autonomous research agent.
 *
 * Usage:
 *   luxas run [project-dir]              Run research on a project
 *   luxas run [project-dir] --model opus Use a specific model
 *   luxas status [project-dir]           Show project status
 *   luxas init [project-dir]             Initialize a new project
 *   luxas init [project-dir] --prompt "..." Generate RESEARCH.md from a topic
 *   luxas init [project-dir] --prompt-file <path> Read prompt from a file (use this for multi-line input)
 *   luxas list                           List all projects
 *   luxas stop [project-dir]             Stop a running project (run.pid + every process naming the dir)
 *   luxas figures [project-dir]          Re-audit and re-render figures
 *          [--figure NAME]               Target one figure only (e.g. --figure 1)
 *          [--audit-only]                Audit existing figures, no regeneration
 *          [--style-domain DOMAIN]       Override domain auto-detection
 *                                        (physics|biology|chemistry|earth|ml|policy|_default)
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai/compat";
import { createResearchAgent } from "./agent.js";
import { ensureLiteratureFile } from "./methodology.js";
import { jobOwnerAls } from "./jobs/als.js";
import { reconcileOnStartup, sweepJobs } from "./jobs/registry.js";

const SWEEP_INTERVAL_MS = 15_000;

// Ensure pdflatex is in PATH (needed for usetex figstyles + compile_latex)
try { execSync("which pdflatex", { stdio: "pipe" }); } catch {
  const texDirs = ["/Library/TeX/texbin", "/usr/local/texlive/2026/bin/universal-darwin",
    "/usr/local/texlive/2025/bin/universal-darwin"];
  for (const d of texDirs) {
    if (existsSync(join(d, "pdflatex"))) { process.env.PATH = `${d}:${process.env.PATH}`; break; }
  }
}
// Ensure browser-use is in PATH (browser automation for search skill)
const browserUseDir = join(process.env.HOME ?? "", ".browser-use-env", "bin");
if (existsSync(join(browserUseDir, "browser-use")) && !process.env.PATH?.includes(browserUseDir)) {
  process.env.PATH = `${browserUseDir}:${process.env.PATH}`;
}
import { registerProject, updateProjectAfterRun, loadProjects, selectPastProjects } from "./memory.js";
import { harvestCareer } from "./career.js";
import { readUsageTotals } from "./usage-log.js";
import { TRANSIENT_RE } from "./agents/spawn.js";
import { ORIGINAL_REQUEST_HEADER, deriveProjectTitle } from "./utils.js";

// F2 — process-level crash handlers. Without these, Node's default behavior on
// `unhandledRejection` is to terminate the process (Node ≥15) AND on
// `uncaughtException` to terminate too — both with NO entry written anywhere.
// That's the documented Sisyphus failure mode: brain process disappears mid-LLM-
// call (or mid-anything-async), no `Done in Xs` line, no error in log.jsonl,
// the user just sees "frozen" and has to manually `luxas run` again. These
// handlers convert every silent death into a logged `process_crash` event that
// studio renders + the resume path sees. They do NOT prevent the death itself
// (that's F5's job for network errors); they make every death visible.
//
// Best-effort: handler swallows its own throws, uses sync I/O, never awaits.
// Tries to write to .agent/log.jsonl of the project being run (resolved from
// process.argv if available; otherwise stderr-only).
function _crashLog(kind: "unhandledRejection" | "uncaughtException", err: unknown): void {
  try {
    const msg = (err as any)?.message ?? String(err);
    const stack = (err as any)?.stack;
    const entry = {
      type: "process_crash",
      kind,
      timestamp: new Date().toISOString(),
      message: msg.slice(0, 500),
      stack: typeof stack === "string" ? stack.slice(0, 4000) : undefined,
    };
    try { process.stderr.write(`\n[${kind}] ${entry.message}\n${entry.stack ?? ""}\n`); } catch { /* */ }
    // Try to resolve the project dir from argv so we can write to log.jsonl
    const argv = process.argv.slice(2);
    let pd: string | undefined;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] && !argv[i].startsWith("--")) { pd = argv[i]; break; }
    }
    if (pd) {
      try {
        const logPath = join(resolve(pd), ".agent", "log.jsonl");
        appendFileSync(logPath, JSON.stringify(entry) + "\n");
      } catch { /* path may not exist yet at startup-time crash */ }
    }
  } catch { /* handler must never throw */ }
}
process.on("unhandledRejection", (reason) => _crashLog("unhandledRejection", reason));
process.on("uncaughtException", (err) => {
  _crashLog("uncaughtException", err);
  // Node's default after uncaughtException is to exit with code 1 anyway. Let
  // the runtime do it so finalizers (other handlers, exit hooks) still fire.
});

const args = process.argv.slice(2);
const command = args[0] ?? "run";

// `luxas monitor <project> --message "…" [--json] [--model X] [--by email]`
// — one turn of the sidecar monitor agent (src/monitor-runner.ts). Handled
// before the generic flag loop below because its --message value is free
// text that the loop would mistake for a project path.
if (command === "monitor") {
  const { runMonitorTurn, parseMonitorArgs } = await import("./monitor-runner.js");
  process.exit(await runMonitorTurn(parseMonitorArgs(args.slice(1))));
}

// Parse flags
let projectDir = ".";
let model = "opus";
let profile: string | undefined;
let directive: string | undefined;
let initPrompt: string | undefined;
let figureTarget: string | undefined;
let auditOnly = false;
let styleDomain: string | undefined;
let maxCost: number | undefined;

let explicitModel = false;
let explicitProfile = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    model = args[++i];
    explicitModel = true;
  } else if (args[i] === "--profile" && args[i + 1]) {
    profile = args[++i];
    explicitProfile = true;
  } else if (args[i] === "--directive" && args[i + 1]) {
    directive = args[++i];
  } else if (args[i] === "--prompt" && args[i + 1]) {
    initPrompt = args[++i];
  } else if (args[i] === "--prompt-file" && args[i + 1]) {
    initPrompt = readFileSync(args[++i], "utf-8");
  } else if (args[i] === "--figure" && args[i + 1]) {
    figureTarget = args[++i];
  } else if (args[i] === "--audit-only") {
    auditOnly = true;
  } else if (args[i] === "--style-domain" && args[i + 1]) {
    styleDomain = args[++i];
  } else if (args[i] === "--max-cost" && args[i + 1]) {
    maxCost = parseFloat(args[++i]);
  } else if (!args[i].startsWith("--")) {
    projectDir = args[i];
  }
}

projectDir = resolve(projectDir);

// Declared anchor for downstream CLI tools invoked via bash (e.g.
// skills/search/scripts/search) — lets them resolve relative --output /
// --papers-dir flags against project root instead of cwd, so `cd data/papers
// && search source X` can't produce a nested data/papers/data/papers path.
process.env.LUXAS_PROJECT_DIR = projectDir;

// Launch-config persistence — a resume MUST inherit the original launch's
// model/profile unless explicitly overridden. 2026-07-05 incident: a project
// launched under `--profile dual` (deepseek producers) was resumed twice with
// a bare `luxas run`; every experiment/tool_impl silently fell back to its
// declared opus tier and one 40-minute session burned $144 (~4x the dual-
// profile cost) before exhausting the API balance. The ambient default is a
// footgun precisely because resume is the common manual operation.
if (command === "run") {
  const runCfgPath = join(projectDir, ".agent", "run_config.json");
  try {
    const saved = JSON.parse(readFileSync(runCfgPath, "utf-8"));
    if (!explicitModel && saved.model) model = saved.model;
    if (!explicitProfile && saved.profile !== undefined) {
      profile = saved.profile ?? undefined;
      if (saved.profile) console.error(`↺ Inherited --profile ${saved.profile} from the original launch (.agent/run_config.json); pass --profile explicitly to override.`);
    }
    // --max-cost is inherited like --profile: a resume without the flag must
    // not silently widen the cap to the $250 backstop (2026-08-28: a $60 run
    // resumed bare, run_config was rewritten with maxCost:null, and it ran
    // to $61.42 before being stopped by hand).
    if (maxCost === undefined && typeof saved.maxCost === "number" && Number.isFinite(saved.maxCost)) {
      maxCost = saved.maxCost;
      console.error(`↺ Inherited --max-cost ${saved.maxCost} from the original launch (.agent/run_config.json); pass --max-cost explicitly to override.`);
    }
    if (explicitProfile && (saved.profile ?? undefined) !== profile) {
      console.error(`⚠ Profile override: original launch used --profile ${saved.profile ?? "(none)"}, this resume uses --profile ${profile ?? "(none)"}. Cost characteristics will differ.`);
    }
  } catch { /* first run — nothing to inherit */ }
  // Default profile is DUAL (2026-08-25, user policy: "always use dual, never
  // only claude"). Claude-only runs put every producer on opus/sonnet tiers —
  // ~4x the cost — and die entirely when the Anthropic balance runs out (the
  // 297nm run, 2026-08-24: $6 in, 400 credit-balance-too-low, checkpoint
  // stranded). Dual keeps producers on deepseek text + vision on deepseek's
  // multimodal model (one provider since 2026-09-02); the PI
  // reviewers keep their declared Anthropic tier by design (interpretation-
  // fidelity study). Opt out explicitly with --profile claude. A bare
  // `--model deepseek-*` launch keeps its legacy no-vision-split semantics.
  if (!profile && !model.startsWith("deepseek-")) {
    profile = "dual";
    console.error(`◈ No profile specified — defaulting to --profile dual (deepseek text + deepseek vision). Pass --profile claude to force Anthropic-only.`);
  }
  try {
    mkdirSync(join(projectDir, ".agent"), { recursive: true });
    writeFileSync(runCfgPath, JSON.stringify({ model, profile: profile ?? null, maxCost: maxCost ?? null, savedAt: new Date().toISOString() }, null, 2) + "\n");
  } catch { /* persistence is best-effort */ }
}

// Family-level model switch. When --model is a deepseek model, every
// anthropic-tier slot (haiku/sonnet/opus declared in agent frontmatter)
// redirects to that deepseek model via spawn.ts's applyProfile. OpenAI
// tiers (gpt-5.6-terra / o3) are deliberate provider-specific picks and pass
// through unchanged (math agent stays gpt-5.6-terra).
if (model.startsWith("deepseek-")) {
  process.env.LUXAS_MODEL_PROFILE = model;
}

// Profile presets. `dual` = deepseek-v4-pro for text agents +
// deepseek-v4-flash-vision-exp for vision-required agents
// (illustrator/illustrator_write/typesetter). Routes around the TEXT models'
// blindness, which otherwise produces visually unverified figures and PDF
// layouts. Both halves are the same provider and key since 2026-09-02, so a
// dual run no longer dies when a second provider drops the model (Kimi K2.5
// 404'd mid-run on 2026-08-31 and took every figure fixer with it).
if (profile === "dual") {
  process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
  // The drawing agents run on GLM-5.3-Flash (2026-09-03). On the figure-creation
  // task it needed 14 turns and $0.043 against deepseek's 36/$0.21 and sonnet's
  // 48/$2.18, and produced the best figure of the three: the only one to annotate
  // both claims on the page, and the only one to handle the corrupted eps_total
  // columns honestly, by drawing a "gate fails" line at eps = 1 instead of
  // plotting an impossible infidelity of 1e4 (sonnet) or silently dropping the
  // columns (deepseek). See notes/figure-pipeline-review-2026-09-02.md §4.7b.
  process.env.LUXAS_VISION_MODEL_PROFILE = "glm-5.3-flash";
  // figure_auditor is deliberately NOT set here, so it falls back to the
  // Anthropic tier in its frontmatter. GLM audits better and cheaper than
  // sonnet in isolation, but the auditor must not be the same model as the
  // agent that drew the figure — the same independence rule PI_REVIEWER_AGENTS
  // encodes. The blind spot is demonstrably shared: GLM omitted the 4 K / 300 K
  // panel labels when drawing, and did not flag missing temperature labels when
  // auditing. Override with LUXAS_VISION_AUDIT_MODEL_PROFILE only onto a family
  // that is NOT the one drawing the figures.
} else if (profile === "claude") {
  // No env override — every agent uses its declared frontmatter model.
} else if (profile) {
  console.error(`Unknown --profile "${profile}". Valid: claude, dual.`);
  process.exit(1);
}

/**
 * Compare every model this run will actually route to against its provider's
 * live catalog. Returns findings; the caller decides how loud to be.
 * Providers that cannot be reached are reported, never fatal — a flaky network
 * at launch must not block a run.
 */
async function checkRoutedModels() {
  const { listRoutedModels } = await import("./agents/spawn.js");
  const { getApiKey } = await import("./auth.js");
  const { listModels, compareCatalog } = await import("./model-check.js");
  const routed = listRoutedModels();
  const byProvider = new Map<string, { id: string; usedBy: string[] }[]>();
  for (const r of routed) {
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
    byProvider.get(r.provider)!.push({ id: r.id, usedBy: r.usedBy });
  }
  const findings: import("./model-check.js").Finding[] = [];
  await Promise.all([...byProvider.entries()].map(async ([provider, pinned]) => {
    const key = await getApiKey(provider);
    if (!key) { findings.push({ kind: "unreachable", provider: provider as any, detail: "no API key" }); return; }
    const listed = await listModels(provider as any, key);
    if (listed === null) { findings.push({ kind: "unreachable", provider: provider as any, detail: "catalog request failed" }); return; }
    findings.push(...compareCatalog(provider as any, pinned, listed));
  }));
  return findings;
}

if (command === "models") {
  // Report what an actual run would route to: `luxas run` defaults to dual,
  // so a bare `luxas models` must too, or it audits a routing nobody uses.
  if (!profile) profile = "dual";
  if (profile === "dual") {
    process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
    process.env.LUXAS_VISION_MODEL_PROFILE = "glm-5.3-flash";
    delete process.env.LUXAS_VISION_AUDIT_MODEL_PROFILE;
  }
  const { formatFindings } = await import("./model-check.js");
  console.error(`◈ profile: ${profile}`);
  const { listRoutedModels } = await import("./agents/spawn.js");
  console.log("Models this profile routes to:\n");
  for (const r of listRoutedModels()) {
    console.log(`  ${r.provider.padEnd(13)} ${r.id.padEnd(32)} ${r.usedBy.join(", ")}`);
  }
  console.log("\nChecking each provider's catalog...\n");
  const findings = await checkRoutedModels();
  const providers = [...new Set(listRoutedModels().map((r) => r.provider))];
  for (const p of providers) {
    const mine = findings.filter((f) => f.provider === p);
    const bad = mine.filter((f) => f.kind !== "unreachable");
    const unreachable = mine.find((f) => f.kind === "unreachable");
    if (unreachable) console.log(`  ? ${p.padEnd(13)} not checked (${(unreachable as any).detail})`);
    else if (!bad.length) console.log(`  ✓ ${p.padEnd(13)} all pinned models listed, nothing newer`);
    else console.log(`  ! ${p.padEnd(13)} ${bad.length} finding(s)`);
  }
  const actionable = findings.filter((f) => f.kind !== "unreachable");
  if (actionable.length) console.log("\n" + formatFindings(actionable));
  process.exit(findings.some((f) => f.kind === "dead") ? 1 : 0);
}

if (command === "status") {
  showStatus(projectDir);
  process.exit(0);
}

if (command === "init") {
  await initProject(projectDir, initPrompt);
  process.exit(0);
}

if (command === "list") {
  listProjects();
  process.exit(0);
}

if (command === "stop") {
  const { stopRun } = await import("./stop-run.js");
  const r = stopRun(projectDir);
  process.exit(r.survivors.length === 0 ? 0 : 1);
}

if (command === "run") {
  await run(projectDir, model, directive, maxCost);
  process.exit(0);
}

if (command === "figures") {
  if (auditOnly && figureTarget) {
    console.error("--audit-only and --figure are mutually exclusive");
    process.exit(1);
  }
  const VALID_DOMAINS = ["physics", "biology", "chemistry", "earth", "ml", "policy", "_default"];
  if (styleDomain && !VALID_DOMAINS.includes(styleDomain)) {
    console.error(`--style-domain must be one of: ${VALID_DOMAINS.join(", ")}`);
    process.exit(1);
  }
  await runFigures(projectDir, { figure: figureTarget, auditOnly, styleDomain });
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
console.error("Usage: luxas <run|status|init|list|stop|figures|monitor|models> [project-dir] [options]");
console.error("  --model <id>      explicit model (legacy; e.g. deepseek-v4-pro)");
console.error("  --profile <name>  preset: dual (DEFAULT — deepseek text + glm vision) | claude");
console.error("  models            list the models this profile routes to, and check each provider for dead or newer ones");
process.exit(1);

// ─── Commands ────────────────────────────────────────────

async function run(dir: string, modelName: string, userDirective?: string, maxCostUsd?: number) {
  // Validate project
  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    console.error(`No RESEARCH.md found in ${dir}`);
    console.error("Create one with your research goal, or run: luxas init <dir>");
    process.exit(1);
  }

  const researchGoal = readFileSync(researchFile, "utf-8").trim();

  // Fail-fast on missing API credentials. If the brain agent's first LLM
  // call returns 401, pi-agent-core's loop exits gracefully with an error
  // message that gets buried in checkpoint state, the run records 0 tokens,
  // and the user sees "Done in 0s" — indistinguishable from a successful
  // no-op completion. Check up front so the user gets a clear error.
  // The studio's launchd-supervised next-server is the canonical example:
  // its plist sets only HOME/PATH/NODE_ENV, so DEEPSEEK_API_KEY etc. don't
  // propagate from the user's shell. Resolve via the same chain the agent
  // would use (env → ~/.sisyphus/auth.json → undefined) before spawning.
  {
    const { resolveModel } = await import("./agents/spawn.js");
    const { getApiKey } = await import("./auth.js");
    const resolvedModel = resolveModel(modelName, "brain");
    const provider = resolvedModel.provider;
    const key = await getApiKey(provider);
    if (!key) {
      console.error(`✗ Missing API key for provider "${provider}" (model: ${resolvedModel.id ?? modelName}).`);
      console.error(`  Set the corresponding env var (e.g. ${provider.toUpperCase()}_API_KEY) or`);
      console.error(`  add a key to ~/.sisyphus/auth.json:`);
      console.error(`    { "${provider === "kimi-coding" ? "kimi" : provider}": "sk-..." }`);
      process.exit(1);
    }
  }

  // Model liveness + freshness, before any spend. The key check above proves a
  // credential EXISTS; it does not prove the model still does. Kimi K2.5 passed
  // that check every time while 404ing on every call, and the Ba run burned
  // hours of reviewer and PI turns on figure fixes nobody could apply
  // (notes/figure-pipeline-review-2026-09-02.md §3.6).
  //
  // A dead model is fatal: the run WILL fail on it, so failing now beats
  // failing eight hours in. A newer sibling is advisory. A provider we cannot
  // reach is neither — a flaky network at launch must not block research.
  // Skip with LUXAS_SKIP_MODEL_CHECK=1.
  if (process.env.LUXAS_SKIP_MODEL_CHECK !== "1") {
    try {
      const findings = await checkRoutedModels();
      const dead = findings.filter((f) => f.kind === "dead") as any[];
      const newer = findings.filter((f) => f.kind === "newer") as any[];
      for (const n of newer) {
        console.error(`◈ newer model available: ${n.pinned} → ${n.candidate} (${n.provider}), used by ${n.usedBy.join(", ")}. Run \`luxas models\` for the full report.`);
      }
      if (dead.length) {
        console.error(`✗ ${dead.length} pinned model(s) no longer exist at their provider — this run would die on them:`);
        for (const d of dead) {
          console.error(`    ${d.pinned} (${d.provider}) — used by ${d.usedBy.join(", ")}`);
        }
        console.error(`  Fix the pin in src/agents/spawn.ts, or re-point the profile. Override with LUXAS_SKIP_MODEL_CHECK=1.`);
        process.exit(1);
      }
    } catch (e: any) {
      console.error(`◈ model check skipped: ${e?.message ?? e}`);
    }
  }

  // Register this run with the studio dashboard / `luxas status`: readRunStatus
  // keys off <project>/.agent/run.pid. Write it ourselves so EVERY launch path
  // (CLI, SSH, inbox) registers — not just studio's startRun. Claim it only if
  // absent or stale (a prior pid that's dead); never clobber a live sibling's
  // record (studio writes its own, carrying owner/quota metadata). A dead pid
  // left by a crash is self-healed by readRunStatus on its next poll.
  try {
    mkdirSync(join(dir, ".agent"), { recursive: true });
    const runPidFile = join(dir, ".agent", "run.pid");
    let claim = true;
    if (existsSync(runPidFile)) {
      try {
        const prev = JSON.parse(readFileSync(runPidFile, "utf-8"));
        if (typeof prev.pid === "number" && prev.pid > 0) {
          try { process.kill(prev.pid, 0); claim = false; } catch { /* dead → reclaim */ }
        }
      } catch { /* unparseable → reclaim */ }
    }
    if (claim) {
      writeFileSync(runPidFile, JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        model: modelName,
        cwd: process.cwd(),
        cmd: process.argv.join(" "),
        cmdMarker: "src/index.ts",
      }, null, 2));
    }
  } catch { /* dashboard registration is best-effort — never block the run */ }

  // Scrub API-key env vars from process.env so any bash command this agent
  // runs (or the sub-agents it spawns, which inherit env) cannot echo them
  // into checkpoints/logs via `printenv` / `env | grep KEY` / `echo $KEY`.
  // pi-agent-core's getApiKey re-resolves per LLM call via the auth.json
  // file fallback added in c3437b1, so functionality is preserved.
  for (const k of [
    "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY",
    "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "GITHUB_TOKEN", "GITHUB_PAT",
  ]) {
    delete process.env[k];
  }

  // If previous session finished, archive checkpoint + PI feedback so we start fresh
  const archivedFrom = archiveIfFinished(dir);

  // Fix H9: persist --directive into notes/directives/<ts>.md so it survives
  // session restart / resume. Without this, when a user runs `luxas run` again
  // (especially in resume mode) without re-passing --directive, the original
  // requirement evaporates — β has nothing to inject into the trailer, γ has
  // nothing to surface to PI, and brain operates on stale assumptions or just
  // the new PI STEER scope. The Rb-单光子 5/28 incident proved this: the
  // original "simulate all 7 schemes" directive was nowhere in the resume
  // context. context.ts and pi-agent.ts now read the union of all directives
  // archived under notes/directives/ so every active directive stays visible
  // across resumes until the user explicitly retires one.
  persistDirectiveIfNew(dir, userDirective);

  // Write a session_start marker to log.jsonl IMMEDIATELY so studio's SSE
  // tail surfaces the new session in the UI within the first poll — without
  // this, fresh-start sessions show "暂无事件，等待 log.jsonl…" until brain
  // fires its first tool call (which can take minutes during context build /
  // memory dump / cold-start LLM call). Marker shape mirrors the tool_call
  // contract that hooks.ts uses, with type:"session_start" so studio renders
  // it as a synthetic event distinct from real tool calls.
  writeSessionStartMarker(dir, userDirective, archivedFrom);

  // Reconcile any bash jobs left running from a prior crashed/aborted session.
  // Verified-ours orphans are killed; ambiguous ones (pid reuse, missing ps)
  // are marked orphaned without killing — see src/jobs/registry.ts.
  const reconciled = await reconcileOnStartup(dir);
  if (reconciled.scanned > 0 && (reconciled.markedDone + reconciled.killedOrphans + reconciled.unverifiable) > 0) {
    console.log(`  ⟳ Reconciled ${reconciled.scanned} prior bash job(s): ` +
      `${reconciled.markedDone} done, ${reconciled.killedOrphans} killed, ${reconciled.unverifiable} orphaned`);
  }

  // Backstop: sweep every 15s for deadline-passed and pid-gone running jobs
  // that the in-process bash handler might have missed. .unref() so the
  // interval doesn't keep the process alive after the agent loop returns.
  const sweepInterval = setInterval(() => {
    sweepJobs(dir).catch(err => {
      console.error(`[sweep] ${err?.message ?? err}`);
    });
  }, SWEEP_INTERVAL_MS);
  sweepInterval.unref();

  // Register in global project registry
  const projectEntry = registerProject(dir);

  // Recover an orphaned registry stub: a prior session that did real work but
  // was hard-killed (SIGKILL/OOM/shutdown) before the end-of-run finalize below
  // leaves this entry as the registerProject stub — empty summary, zero cost,
  // no lastRunFinished — even though notes/ and report/ are populated. A
  // try/finally can't catch a SIGKILL, so reconcile here at startup, same
  // pattern as reconcileOnStartup (jobs) and archiveIfFinished (checkpoints).
  // finished := a compiled report.pdf exists (the shippable deliverable),
  // matching generateProjectSummary's own "Report: completed" signal.
  if (projectEntry.summary === "" && projectEntry.tokens === 0 && projectEntry.lastRunFinished === undefined) {
    const orphan = readUsageTotals(join(dir, ".agent", "usage.log"));
    if (orphan.calls > 0) {
      const reportDone = existsSync(join(dir, "report", "report.pdf"));
      updateProjectAfterRun(dir, orphan.cost, orphan.inputTokens + orphan.outputTokens, { finished: reportDone });
      console.log(`  ⟳ Recovered orphaned registry entry from a prior killed session ($${orphan.cost.toFixed(2)}, finished=${reportDone})`);
    }
  }

  const pastProjects = selectPastProjects(dir);
  console.log(`\n📚 Luxas — Autonomous Research Agent`);
  console.log(`   Project: ${dir}`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Goal: ${researchGoal.split("\n")[0].slice(0, 80)}`);
  if (pastProjects.length > 0) {
    console.log(`   Memory: ${pastProjects.length} past project(s) in <past_research> digest`);
  }
  console.log();

  // Create agent
  // δ directive-gate scoping: enforce "an experiment was modified since this
  // process started" only on a FRESH start. A checkpoint still present here
  // (archiveIfFinished above already removed finished ones) means the prior
  // session did not finish — i.e. a resume, where prior-session experiment
  // mtimes are legitimately older than this process. The H7 content check still
  // applies on resume.
  const resumedFromCheckpoint = existsSync(join(dir, ".agent", "checkpoint.jsonl"));
  const { agent, hooks, restore, usageLogPath, didFinishSucceed } = createResearchAgent({
    projectDir: dir,
    model: modelName,
    directive: userDirective,
    resumedFromCheckpoint,
    maxCostUsd,
  });

  // Console progress
  agent.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      const argsPreview = event.args ? JSON.stringify(event.args).slice(0, 60) : "";
      process.stderr.write(`  ✻ ${event.toolName} ${argsPreview}\n`);
    }
    if (event.type === "tool_execution_end") {
      const icon = event.isError ? "✗" : "→";
      process.stderr.write(`  ${icon} ${event.toolName}\n`);
    }
    if (event.type === "message_end" && event.message?.stopReason === "error") {
      const errContent = event.message?.content?.find((c: any) => c.type === "text");
      process.stderr.write(`  ❌ ERROR: ${JSON.stringify(errContent?.text ?? event.message).slice(0, 500)}\n`);
    }
  });

  // Check for checkpoint to resume from
  const t0 = Date.now();
  try {
    // Wrap the entire brain run in jobOwnerAls so every bash invocation made
    // by the brain (including ones nested in followUp/continue) tags its
    // job record with ownerAgentId="brain". Sub-agents that brain spawns
    // get their own als.run inside spawnAgent / subagent-runner.
    await jobOwnerAls.run({ agentId: "brain", agentType: "brain", projectDir: dir }, async () => {
      if (restore) {
        const msgCount = restore();
        if (msgCount > 0) {
          console.log(`  ⟳ Resuming from checkpoint (${msgCount} messages)`);
          const resumePrompt = userDirective
            ? `Continue your research. Additional directive: ${userDirective}\n\nIMPORTANT: This is a follow-up directive on an existing project. After completing the analysis, you MUST update both notes/experiments.md AND report/report.tex (add new sections, update existing comparisons, recompile with compile_latex). The report should always reflect the latest state of the research.`
            : `Continue your research from where you left off. Check notes/literature.md and notes/experiments.md for your current progress.`;
          await agent.followUp({
            role: "user",
            content: resumePrompt,
            timestamp: Date.now(),
          });
          await agent.continue();
        } else {
          // Checkpoint exists but empty/corrupted — fresh start
          const prompt = buildPrompt(researchGoal, userDirective);
          await agent.prompt(prompt);
        }
      } else {
        // No checkpoint — fresh start
        const prompt = buildPrompt(researchGoal, userDirective);
        await agent.prompt(prompt);
      }
    });
  } catch (err: any) {
    console.error(`\n✗ Agent error: ${err.message}`);
  }

  const elapsed = Math.floor((Date.now() - t0) / 1000);
  const totals = readUsageTotals(usageLogPath);
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const cost = totals.cost.toFixed(4);
  // A live process exit is NOT the same as a finished study: the loop also
  // ends on a gate-blocked finish, a maxTurns/budget cap, or a graceful
  // stopReason=error. Only didFinishSucceed() means the brain's gated finish
  // passed. Say which one happened so the registry and any inbox dispatcher
  // reading stdout don't treat a blocked run as complete.
  const finished = didFinishSucceed();
  // Exit signal for the external supervisor (sisyphus-inbox): distinguish a
  // clean finish from a death the run can recover from. lastErrTransient=true
  // means the brain loop exhausted the in-loop transient-retry (6/~61s) on a
  // network blip, NOT a gate-block or budget cap — the supervisor should
  // relaunch-with-backoff; otherwise it must NOT (a deterministic stop would
  // thrash, as the 2026-06-24 relaunch loop did).
  const lastMsg = agent.state.messages[agent.state.messages.length - 1];
  const lastErrTransient = (lastMsg as any)?.stopReason === "error"
    && TRANSIENT_RE.test(String((lastMsg as any)?.errorMessage ?? ""));
  try {
    writeFileSync(
      join(dir, ".agent", "last_exit.json"),
      JSON.stringify({ finished, lastErrTransient, ts: Date.now() }),
    );
  } catch { /* non-fatal */ }
  if (finished) {
    console.log(`\n✓ Done in ${elapsed}s | $${cost} | ${totalTokens} tokens`);
  } else {
    console.log(`\n⚠ Exited WITHOUT a successful finish() in ${elapsed}s | $${cost} | ${totalTokens} tokens`);
    console.log(`  The checkpoint is live — resume with: luxas run ${dir}`);
  }

  // Save project summary to global registry (records the blocked state so the
  // summary doesn't claim completion the run never reached).
  updateProjectAfterRun(dir, totals.cost, totalTokens, { finished });
  // Career harvest: a finished project's structured artifacts (claims.json
  // grades, premise corrections, open FollowUp leads) join the user's
  // career ledgers, so the NEXT project starts from who this user has been
  // instead of from zero. Idempotent; failure must never mar a finish.
  if (finished) {
    try {
      const h = harvestCareer(dir, true);
      if (h) console.error(`  ⛬ Career: +${h.findings} findings, +${h.corrections} corrections, +${h.leads} open leads → ~/.sisyphus/career/`);
    } catch { /* best-effort */ }
  }

  // Clean up browser-use daemon if it was started during this session
  try { execSync("browser-use close --all", { stdio: "pipe", timeout: 5000 }); } catch { /* not running */ }

  // AgentSmelt traces flush disabled alongside autoPatch (see top of file).
  // await agentSmeltHandle.done();
}

function buildPrompt(researchGoal: string, userDirective?: string): string {
  return userDirective
    ? `Research goal (from RESEARCH.md):\n${researchGoal}\n\nAdditional directive: ${userDirective}`
    : `Research goal (from RESEARCH.md):\n${researchGoal}\n\nStart by reading RESEARCH.md for the full goal, then check notes/literature.md and notes/experiments.md for any existing progress. Proceed with the research.`;
}

async function runFigures(dir: string, opts: { figure?: string; auditOnly?: boolean; styleDomain?: string }) {
  const reportTex = join(dir, "report", "report.tex");
  if (!existsSync(reportTex)) {
    console.error(`No report/report.tex found in ${dir}`);
    console.error("The figures command operates on an existing project. Run `luxas run` first.");
    process.exit(1);
  }

  const { spawnAgent } = await import("./agents/spawn.js");
  const { createSpawnToolFactory } = await import("./tools/spawn-agent.js");
  const { getApiKey } = await import("./auth.js");

  const mode = opts.auditOnly
    ? "audit only"
    : opts.figure
      ? `regenerate figure ${opts.figure}`
      : "audit + regenerate all figures";

  console.log(`\n🎨 Luxas Figures — ${mode}`);
  console.log(`   Project: ${dir}`);
  if (!process.env.GEMINI_API_KEY && !opts.auditOnly) {
    console.error(`   ⚠ GEMINI_API_KEY not set — hybrid raster generation will fail.`);
  }
  console.log();

  const task = opts.auditOnly
    ? `Figure-only pass: run ONLY the global audit step (one illustrator reads all canonical figures, writes reviews/illustrator_notes.{{SPAWN_ID}}.md). Do NOT regenerate anything. Do NOT run multiple rounds.`
    : opts.figure
      ? `Figure-only pass: regenerate ONLY the canonical figure "${opts.figure}". Skip all other figures. Run the standard finalize loop restricted to that one figure.`
      : `Figure-only pass: run the full finalize loop on all canonical figures (parallel per-figure regeneration + global audit, up to 3 rounds).`;

  const makeSpawnTool = createSpawnToolFactory(dir, getApiKey);

  // figure-only mirror of normal mode's submit_verdict: pi-agent-core's natural
  // end_turn detection isn't reliable here, so PI must signal completion via tool.
  type FigureSummary = { rounds: number; remaining_issues: number; summary: string };
  // Object wrapper so TS doesn't narrow the closure-captured value to `null`
  // after the await boundary.
  const slot: { value: FigureSummary | null } = { value: null };
  const figureDoneTool = {
    name: "figure_done",
    label: "Mark figure-only pass complete",
    description:
      "Call exactly once when the figure-finalize loop has exited (either Summary all-clear " +
      "or 3-round cap reached). Figure-only equivalent of submit_verdict — without this call " +
      "the process will not exit.",
    parameters: Type.Object({
      rounds: Type.Number({ description: "How many regeneration rounds were run." }),
      remaining_issues: Type.Number({ description: "Issues unresolved at exit (0 if all-clear)." }),
      summary: Type.String({ description: "One-line summary of the run." }),
    }),
    async execute(_id: string, params: FigureSummary) {
      if (slot.value) {
        return { content: [{ type: "text" as const, text: "Already recorded; ignoring duplicate call." }], details: {} };
      }
      slot.value = params;
      return { content: [{ type: "text" as const, text: "Figure-only pass recorded." }], details: {} };
    },
  };

  const result = await spawnAgent({
    name: "reviewer",
    templateVars: {},
    prompt: task,
    projectDir: dir,
    getApiKey,
    toolOverrides: [figureDoneTool],
    contextExtra: { isFigureOnly: true, ...(opts.styleDomain ? { styleDomain: opts.styleDomain } : {}) },
    parentAgentId: "figures-cli",
    createSpawnTool: makeSpawnTool,
  });

  if (!result.success) {
    console.error(`\n✗ ${result.output}`);
    process.exit(1);
  }
  console.log(`\n✓ Done in ${Math.floor(result.elapsed / 1000)}s`);
  if (slot.value) {
    console.log(`Rounds: ${slot.value.rounds}  |  Remaining issues: ${slot.value.remaining_issues}`);
    console.log(slot.value.summary);
  } else if (result.output) {
    console.log(result.output);
  }
}

function showStatus(dir: string) {
  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    console.log("No RESEARCH.md found. Not a Luxas project.");
    return;
  }

  const research = readFileSync(researchFile, "utf-8").trim();
  console.log(`\n📚 Research Goal:\n${research.split("\n").slice(0, 5).join("\n")}\n`);

  const files: [string, string][] = [
    ["notes/literature.md", "Literature notes"],
    ["notes/experiments.md", "Experiment notes"],
    ["report/report.tex", "Report source"],
    ["report/report.pdf", "Compiled report"],
  ];

  for (const [file, label] of files) {
    const path = join(dir, file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const lines = content.split("\n").length;
      console.log(`  ✓ ${label}: ${lines} lines`);
    } else {
      console.log(`  · ${label}: not yet`);
    }
  }

  // Count papers
  const papersDir = join(dir, "data", "papers");
  try {
    const count = readdirSync(papersDir).length;
    console.log(`  📄 Downloaded papers: ${count}`);
  } catch {
    console.log(`  📄 Downloaded papers: 0`);
  }

  console.log();
}

function listProjects() {
  const projects = loadProjects();
  if (projects.length === 0) {
    console.log("No projects registered. Run: luxas init <dir>");
    return;
  }

  console.log(`\n📚 Luxas — ${projects.length} Research Project(s)\n`);
  for (const p of projects) {
    const date = p.lastRun.slice(0, 10);
    const cost = p.costUsd > 0 ? ` | $${p.costUsd.toFixed(2)}` : "";
    const tokens = p.tokens > 0 ? ` | ${(p.tokens / 1000).toFixed(0)}K tok` : "";
    console.log(`  ${p.name}`);
    console.log(`    ${p.path} [${date}${cost}${tokens}]`);
    if (p.summary) {
      for (const line of p.summary.split("\n").slice(0, 3)) {
        console.log(`    ${line}`);
      }
    }
    console.log();
  }
}

function archiveIfFinished(dir: string): string | undefined {
  const logJsonl = join(dir, ".agent", "log.jsonl");
  const checkpointFile = join(dir, ".agent", "checkpoint.jsonl");

  // A session counts as FINISHED only when a finish TOOL RESULT recorded
  // details.success === true — i.e. finish() actually passed every gate. A
  // finish CALL, or a gate-BLOCKED finish (which returns normal content WITHOUT
  // details.success, yet the afterToolCall log still marks success=true because
  // the tool did not throw), must NOT count. The old checks counted both:
  // `lastEntry.success` is true for a blocked finish, and `block.name ===
  // "finish"` fires on the mere CALL. That over-trigger archived a LIVE,
  // unfinished checkpoint and forced a from-scratch restart — which then
  // cold-start-wiped the notes ledger (experiments.md → 0 bytes) and broke every
  // subsequent resume. The authoritative "finish succeeded" signal is the
  // checkpoint toolResult's details.success.
  let finished = false;
  if (existsSync(checkpointFile)) {
    try {
      const lines = readFileSync(checkpointFile, "utf-8").trim().split("\n");
      for (const line of lines.slice(-12)) {
        try {
          const entry = JSON.parse(line);
          const m: any = (entry as any)?.message ?? entry;
          if (m?.role === "toolResult" && m?.toolName === "finish" && m?.details?.success === true) {
            finished = true;
          }
        } catch { /* skip unparseable lines */ }
      }
    } catch { /* ignore */ }
  }

  if (!finished) return undefined;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let donePath: string | undefined;
  if (existsSync(checkpointFile)) {
    donePath = checkpointFile.replace(".jsonl", `.done-${ts}.jsonl`);
    renameSync(checkpointFile, donePath);
  }
  const feedbackPath = join(dir, "reviews", "pi_feedback.md");
  if (existsSync(feedbackPath)) {
    renameSync(feedbackPath, feedbackPath.replace(".md", `.done-${ts}.md`));
  }
  if (existsSync(logJsonl)) {
    renameSync(logJsonl, logJsonl.replace(".jsonl", `.done-${ts}.jsonl`));
  }
  console.log(`  ⟳ Previous session finished — starting fresh (archived)`);

  // Fire-and-forget the meta-agent post-session hook. Runs reflect_light
  // against the just-frozen jsonl, bumps the deep-review counter, and
  // possibly schedules a deep review — all in the background. Detached so
  // the new session doesn't wait; ignore failures entirely (hook is
  // best-effort and must never block the research run).
  if (donePath) {
    try {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const sisyphusRoot = resolve(moduleDir, "..");
      const hookScript = join(sisyphusRoot, "scripts/post_session_hook.mts");
      if (existsSync(hookScript)) {
        const child = spawn("npx", ["tsx", hookScript, donePath, sisyphusRoot], {
          detached: true,
          stdio: "ignore",
          cwd: sisyphusRoot,
        });
        child.unref();
      }
    } catch { /* hook failure must not break the main flow */ }
  }

  return donePath;
}

/**
 * Append a `session_start` marker to .agent/log.jsonl so studio's SSE tail
 * surfaces a visible event for the new session within its first poll. Without
 * this, a fresh-start session leaves log.jsonl absent (archived) and the UI
 * displays "暂无事件，等待 log.jsonl…" until brain fires its first tool call
 * — which can take minutes during context build / memory dump / cold LLM call.
 *
 * Marker shape:
 *   { type: "session_start", directive?, archived_from?, timestamp }
 *
 * Idempotent: appending a duplicate marker on resume is harmless. Best-effort:
 * any I/O error is swallowed so startup never fails on observability writes.
 */
function writeSessionStartMarker(
  dir: string,
  directive: string | undefined,
  archivedFrom: string | undefined,
): void {
  try {
    const agentDir = join(dir, ".agent");
    mkdirSync(agentDir, { recursive: true });
    const logPath = join(agentDir, "log.jsonl");
    const entry: Record<string, unknown> = {
      type: "session_start",
      timestamp: new Date().toISOString(),
    };
    if (directive) entry.directive = directive.slice(0, 500);
    if (archivedFrom) entry.archived_from = archivedFrom.split("/").pop();
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch { /* observability write must not block startup */ }
}

/**
 * Persist --directive into notes/directives/<ts>.md so it survives session
 * restart / resume. context.ts and pi-agent.ts read the UNION of all files
 * here as the active directive set, so directives accumulate (not overwrite)
 * — user can run with new --directive on a resumed project without losing the
 * original requirement. Dedup by content hash: re-running with the same
 * directive string is a noop, but a different directive creates a new file.
 *
 * Filename: `<ISO-timestamp>.md` so chronological listing matches order of
 * issuance. User can manually retire stale ones by moving them to
 * `notes/directives/archived/` (read function skips that subdirectory).
 */
function persistDirectiveIfNew(dir: string, directive: string | undefined): void {
  if (!directive || !directive.trim()) return;
  try {
    const dirDir = join(dir, "notes", "directives");
    mkdirSync(dirDir, { recursive: true });
    // Dedup: skip if any existing file has identical content
    const trimmed = directive.trim();
    for (const name of readdirSync(dirDir)) {
      if (!name.endsWith(".md")) continue;
      try {
        const existing = readFileSync(join(dirDir, name), "utf-8").trim();
        // Strip the frontmatter (we'll add it on write) for comparison
        const body = existing.replace(/^---[\s\S]*?---\s*/, "").trim();
        if (body === trimmed) return; // identical directive already persisted
      } catch { /* skip unreadable files */ }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}.md`;
    const content = `---\nissued_at: ${new Date().toISOString()}\n---\n\n${trimmed}\n`;
    writeFileSync(join(dirDir, filename), content, "utf-8");
  } catch { /* persistence is best-effort; never block startup */ }
}

async function initProject(dir: string, prompt?: string) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, "report"), { recursive: true });
  mkdirSync(join(dir, "data", "papers"), { recursive: true });
  mkdirSync(join(dir, "data", "scripts"), { recursive: true });
  mkdirSync(join(dir, "data", "runs"), { recursive: true });
  mkdirSync(join(dir, "reviews"), { recursive: true });
  mkdirSync(join(dir, ".agent"), { recursive: true });

  const researchFile = join(dir, "RESEARCH.md");

  if (prompt) {
    // Verbatim — scope derivation is the brain's job (literature-grounded),
    // not init-time opus's (training-data-grounded).
    writeFileSync(researchFile, renderResearchDoc(prompt));
    console.log(`Created ${researchFile} (verbatim user prompt)`);
  } else if (!existsSync(researchFile)) {
    writeFileSync(researchFile, "# Research Goal\n\nDescribe your research goal here.\n");
    console.log(`Created ${researchFile}`);
  }

  ensureLiteratureFile(dir);

  for (const [file, title] of [
    ["notes/experiments.md", "Experiment Notes"],
    ["notes/memory.md", "Memory"],
  ] as const) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      writeFileSync(path, `# ${title}\n`);
    }
  }

  // Register in global project registry
  registerProject(dir);

  console.log(`Initialized Luxas project at ${dir}`);
}

/**
 * The prompt goes in a blockquote so any markdown inside it (headings, code
 * fences, horizontal rules) can't corrupt the document structure. A title
 * line on top gives memory.ts a name for the cross-project registry.
 */
function renderResearchDoc(userPrompt: string): string {
  const title = deriveProjectTitle(userPrompt, 80);
  const quoted = userPrompt.trim().split("\n").map(l => l.length ? `> ${l}` : ">").join("\n");
  return [
    `# ${title}`,
    "",
    ORIGINAL_REQUEST_HEADER,
    "",
    "_The block below is the user's verbatim input. It is the ground truth for what the user asked for. Brain derives scope from this + literature._",
    "",
    quoted,
    "",
  ].join("\n");
}
