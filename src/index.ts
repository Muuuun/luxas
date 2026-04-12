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
 *   luxas list                           List all projects
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { autoPatch } from "agentsmelt";
// Note: AgentSmelt namespace stays "sisyphus" — existing lessons live under
// ~/.agentsmelt/.../sisyphus/. The project rebranded to Luxas but the data path
// is preserved to avoid orphaning accumulated knowledge.
const agentSmeltHandle = autoPatch(Agent, "sisyphus");
import { createResearchAgent } from "./agent.js";

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
import { ORIGINAL_REQUEST_HEADER } from "./utils.js";


const args = process.argv.slice(2);
const command = args[0] ?? "run";

// Parse flags
let projectDir = ".";
let model = "opus";
let directive: string | undefined;
let initPrompt: string | undefined;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--model" && args[i + 1]) {
    model = args[++i];
  } else if (args[i] === "--directive" && args[i + 1]) {
    directive = args[++i];
  } else if (args[i] === "--prompt" && args[i + 1]) {
    initPrompt = args[++i];
  } else if (!args[i].startsWith("--")) {
    projectDir = args[i];
  }
}

projectDir = resolve(projectDir);

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

console.error(`Unknown command: ${command}`);
console.error("Usage: luxas <run|status|init|list> [project-dir] [--model sonnet|opus|haiku]");
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

  // Flush AgentSmelt traces
  await agentSmeltHandle.done();
}

function buildPrompt(researchGoal: string, userDirective?: string): string {
  return userDirective
    ? `Research goal (from RESEARCH.md):\n${researchGoal}\n\nAdditional directive: ${userDirective}`
    : `Research goal (from RESEARCH.md):\n${researchGoal}\n\nStart by reading RESEARCH.md for the full goal, then check notes/literature.md and notes/experiments.md for any existing progress. Proceed with the research.`;
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
  if (existsSync(checkpointFile)) {
    renameSync(checkpointFile, checkpointFile.replace(".jsonl", `.done-${ts}.jsonl`));
  }
  const feedbackPath = join(dir, "reviews", "pi_feedback.md");
  if (existsSync(feedbackPath)) {
    renameSync(feedbackPath, feedbackPath.replace(".md", `.done-${ts}.md`));
  }
  if (existsSync(logJsonl)) {
    renameSync(logJsonl, logJsonl.replace(".jsonl", `.done-${ts}.jsonl`));
  }
  console.log(`  ⟳ Previous session finished — starting fresh (archived)`);
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
    // Preserve the user's prompt verbatim so downstream agents (brain, PI)
    // always see the ground-truth ask — not just the PI-synthesized plan
    // which may amplify scope.
    console.log("Generating RESEARCH.md from prompt...");
    const plan = await generateResearchGoal(prompt);
    if (!plan.trim() || !/^#\s*Research Goal\b/m.test(plan)) {
      console.error("PI returned an invalid plan (empty or missing '# Research Goal' header). Aborting init.");
      process.exit(1);
    }
    writeFileSync(researchFile, renderResearchDoc(prompt, plan));
    console.log(`Created ${researchFile} (PI-generated from prompt)`);
  } else if (!existsSync(researchFile)) {
    writeFileSync(researchFile, "# Research Goal\n\nDescribe your research goal here.\n");
    console.log(`Created ${researchFile}`);
  }

  for (const [file, title] of [
    ["notes/literature.md", "Literature Notes"],
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
 * Assemble the final RESEARCH.md: user's prompt verbatim at the top (fenced in
 * a blockquote so any markdown it contains — headings, horizontal rules, code
 * fences — can't corrupt the surrounding document structure), followed by the
 * PI-synthesized plan. Downstream agents treat the Original User Request
 * section as the authoritative deliverable spec; the plan may have amplified
 * scope and should be cross-checked against the verbatim request.
 */
function renderResearchDoc(userPrompt: string, piPlan: string): string {
  const quoted = userPrompt.trim().split("\n").map(l => l.length ? `> ${l}` : ">").join("\n");
  return [
    ORIGINAL_REQUEST_HEADER,
    "",
    "_The following block is the user's verbatim input. It is the ground truth for what the user asked for. The PI-synthesized plan below may drift — if it does, the request wins._",
    "",
    quoted,
    "",
    "---",
    "",
    piPlan.trim(),
    "",
  ].join("\n");
}

async function generateResearchGoal(prompt: string): Promise<string> {
  const { getModel, completeSimple } = await import("@mariozechner/pi-ai");
  const { getApiKey } = await import("./auth.js");

  const model = getModel("anthropic" as any, "claude-opus-4-6" as any);
  const apiKey = await getApiKey("anthropic");
  if (!apiKey) {
    console.error("No API key available. Set ANTHROPIC_API_KEY environment variable.");
    process.exit(1);
  }

  const systemPrompt = `You are a Principal Investigator (PI) — a senior professor defining a research agenda for an autonomous research agent.

Given a topic or idea from the user, write a research plan that will guide the agent's research. The agent will:
- Search and read academic papers
- Run computational experiments
- Write a LaTeX report

Your plan must be specific enough to guide autonomous execution, but broad enough to allow the agent to discover unexpected directions. **Do not amplify scope** beyond what the user asked: if the user asked a narrow question, plan a narrow investigation. The user's verbatim request will be preserved separately in the RESEARCH.md; you do not need to restate it.

**CRITICAL — Language rule**: The research agent determines the report language from the RESEARCH.md language.
- Default: write the plan in the same language as the user's input. Chinese input → Chinese plan → Chinese report.
- Exception: if the user explicitly requests a specific output language (e.g., "用英文写" or "write in English"), follow that instruction.
- Never silently translate the user's input into English when they didn't ask for it.

Output format — write ONLY the plan body, no explanations, no preamble, starting directly at "# Research Goal":

# Research Goal

[1-2 sentence high-level objective]

## Scope

[What's in scope and what's explicitly out of scope]

## Key Questions

[Numbered list of specific questions to answer]

## Methodology

[What approach should the agent take? Literature survey only? Experiments needed? What kind?]

## Expected Deliverables

[What should the final report contain?]

## Target Venue

[Suggest an appropriate journal/conference for the report format, e.g. "Nature Reviews Physics" for a review, "NeurIPS" for ML, etc.]`;

  const response = await completeSimple(model, {
    systemPrompt,
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }],
      timestamp: Date.now(),
    }],
    tools: [],
  }, {
    maxTokens: 2048,
    apiKey,
  } as any);

  const { extractTextContent } = await import("./utils.js");
  return extractTextContent(response.content);
}
