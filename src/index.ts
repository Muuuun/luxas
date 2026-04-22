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
 *   luxas figures [project-dir]          Re-audit and re-render figures
 *          [--figure NAME]               Target one figure only (e.g. --figure 1)
 *          [--audit-only]                Audit existing figures, no regeneration
 *          [--style-domain DOMAIN]       Override domain auto-detection
 *                                        (physics|biology|chemistry|earth|ml|policy|_default)
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
// AgentSmelt autoPatch temporarily disabled: its `extractProjectDir` assumes
// systemPrompt is a string, but commit 6ce68ab switched brain.systemPrompt to
// TextContent[] for per-block cache-control. That mismatch crashes every
// fresh `luxas run` at 0 tokens with `prompt.match is not a function`.
// Existing smelt patches still apply via readPatches/applyPatches in agent.ts
// and createSmeltReminderProvider — only the learning-loop side (tool-call
// tracing, post-session eval, assessment drain) is paused until agentsmelt
// learns to accept array systemPrompt. Namespace reference kept for context:
// lessons continue to live under ~/.agentsmelt/.../sisyphus/.
// import { autoPatch } from "agentsmelt";
// const agentSmeltHandle = autoPatch(Agent, "sisyphus");
import { createResearchAgent } from "./agent.js";
import { ensureLiteratureFile } from "./methodology.js";

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
import { registerProject, updateProjectAfterRun, loadProjects } from "./memory.js";
import { ORIGINAL_REQUEST_HEADER, deriveProjectTitle } from "./utils.js";


const args = process.argv.slice(2);
const command = args[0] ?? "run";

// Parse flags
let projectDir = ".";
let model = "opus";
let directive: string | undefined;
let initPrompt: string | undefined;
let figureTarget: string | undefined;
let auditOnly = false;
let styleDomain: string | undefined;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    model = args[++i];
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

if (command === "run") {
  await run(projectDir, model, directive);
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
console.error("Usage: luxas <run|status|init|list|figures> [project-dir] [options]");
process.exit(1);

// ─── Commands ────────────────────────────────────────────

async function run(dir: string, modelName: string, userDirective?: string) {
  // Validate project
  const researchFile = join(dir, "RESEARCH.md");
  if (!existsSync(researchFile)) {
    console.error(`No RESEARCH.md found in ${dir}`);
    console.error("Create one with your research goal, or run: luxas init <dir>");
    process.exit(1);
  }

  const researchGoal = readFileSync(researchFile, "utf-8").trim();

  // If previous session finished, archive checkpoint + PI feedback so we start fresh
  archiveIfFinished(dir);

  // Register in global project registry
  registerProject(dir);

  const pastProjects = loadProjects().filter(p => p.path !== dir && p.summary);
  console.log(`\n📚 Luxas — Autonomous Research Agent`);
  console.log(`   Project: ${dir}`);
  console.log(`   Model: ${modelName}`);
  console.log(`   Goal: ${researchGoal.split("\n")[0].slice(0, 80)}`);
  if (pastProjects.length > 0) {
    console.log(`   Memory: ${pastProjects.length} past project(s) in context`);
  }
  console.log();

  // Create agent
  const { agent, hooks, restore, usageLogPath } = createResearchAgent({
    projectDir: dir,
    model: modelName,
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
  } catch (err: any) {
    console.error(`\n✗ Agent error: ${err.message}`);
  }

  const { readUsageTotals } = await import("./usage-log.js");
  const elapsed = Math.floor((Date.now() - t0) / 1000);
  const totals = readUsageTotals(usageLogPath);
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const cost = totals.cost.toFixed(4);
  console.log(`\n✓ Done in ${elapsed}s | $${cost} | ${totalTokens} tokens`);

  // Save project summary to global registry
  updateProjectAfterRun(dir, totals.cost, totalTokens);

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
    ? `Figure-only pass: run ONLY the global audit step (one illustrator reads all canonical figures, writes reviews/illustrator_notes.md). Do NOT regenerate anything. Do NOT run multiple rounds.`
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

function archiveIfFinished(dir: string) {
  const logJsonl = join(dir, ".agent", "log.jsonl");
  const checkpointFile = join(dir, ".agent", "checkpoint.jsonl");

  // Check both log and checkpoint for finish signal
  let finished = false;

  // Check log.jsonl last line
  if (existsSync(logJsonl)) {
    try {
      const lastLine = readFileSync(logJsonl, "utf-8").trim().split("\n").pop() ?? "";
      const lastEntry = JSON.parse(lastLine);
      if (lastEntry.tool === "finish" && lastEntry.success) finished = true;
    } catch { /* ignore */ }
  }

  // Check checkpoint for finish tool call (covers case where log was already archived)
  if (!finished && existsSync(checkpointFile)) {
    try {
      const lines = readFileSync(checkpointFile, "utf-8").trim().split("\n");
      // Check last few lines for a finish tool result
      for (const line of lines.slice(-5)) {
        try {
          const entry = JSON.parse(line);
          // Check for tool_use with finish name, or tool_result referencing finish
          if (entry.role === "assistant" && Array.isArray(entry.content)) {
            for (const block of entry.content) {
              if (block.type === "toolCall" && block.name === "finish") finished = true;
              if (block.type === "tool_use" && block.name === "finish") finished = true;
            }
          }
        } catch { /* skip unparseable lines */ }
      }
    } catch { /* ignore */ }
  }

  if (!finished) return;

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
