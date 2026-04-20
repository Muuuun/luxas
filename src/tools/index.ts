/**
 * Tool index — assembles all research tools for the brain agent.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent } from "@mariozechner/pi-agent-core";
import { createReportTools } from "./report.js";
import { createInitReportTool } from "./init-report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createSpawnAgentTool, getActiveBackgroundAgents } from "./spawn-agent.js";
import { wrapBrainTools } from "../agents/safety-wrappers.js";
import { loadRegistry, removeAgent, isAlive, markFailed } from "../active-agents.js";

/**
 * Parse `## L2.X` / `## E_N` experiment sections from notes/experiments.md
 * and extract each one's `**Status:**` line. Unknown status values (or
 * missing status) surface so the finish gate can tell brain which section
 * needs attention.
 */
interface ExperimentSection {
  header: string;
  status: "pending" | "complete" | "deferred" | "missing";
  deferredReason?: string;
}

export function parseExperimentSections(text: string): ExperimentSection[] {
  const lines = text.split("\n");
  // Treat h2 headers starting with L2.N or E_N as experiment sections; other
  // h2s (like "Overview") are narrative and exempt from the status contract.
  const headerRE = /^##\s+((?:L2\.\d+|E\d+)\b.*)$/;
  const statusRE = /^\*\*Status:\*\*\s*(Pending|Complete|Deferred)(?:\s*:\s*(.*))?/im;

  const sections: ExperimentSection[] = [];
  let curHeader: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    if (curHeader === null) return;
    const body = curBody.join("\n");
    const m = body.match(statusRE);
    if (!m) {
      sections.push({ header: curHeader, status: "missing" });
    } else {
      const kind = m[1].toLowerCase() as "pending" | "complete" | "deferred";
      const reason = kind === "deferred" ? (m[2] ?? "").trim() : undefined;
      sections.push({ header: curHeader, status: kind, deferredReason: reason });
    }
  };
  for (const line of lines) {
    const m = line.match(headerRE);
    if (m) {
      flush();
      curHeader = m[1].trim();
      curBody = [];
    } else if (curHeader !== null) {
      curBody.push(line);
    }
  }
  flush();
  return sections;
}

export interface ToolCallbacks {
  onFinish?: () => void;
}

export function buildResearchTools(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  callbacks?: ToolCallbacks,
): { tools: any[]; setParentAgent: (agent: Agent) => void } {
  // Brain coding tools are wrapped with read-tracking + edit safety guards.
  // This enforces read-before-edit, mtime-based stale detection, partial-read
  // coverage, and fresh-excerpt recovery on edit failure. See safety-wrappers.ts.
  const codingTools = wrapBrainTools(createCodingToolsForProject(projectDir), projectDir);
  const reportTools = createReportTools(projectDir);

  // Deferred parent agent ref — set after Agent is constructed (needed for background steer)
  let parentAgentRef: Agent | undefined;

  // Use a proxy object so spawn tool picks up the agent ref when it's set later
  const spawnTool = createSpawnAgentTool(
    projectDir, templateVars, getApiKey,
    /* parentAgentId */ undefined,
    /* depth */ undefined,
    /* parentAgent — resolved lazily via proxy */ undefined,
  );

  // Wrap execute to inject parentAgentRef at call time (agent is set after construction)
  const origExecute = spawnTool.execute;
  spawnTool.execute = function (toolCallId: string, params: any) {
    // Patch background support: if parentAgentRef is set and params.background, use steer
    if (params.background && parentAgentRef) {
      // Re-create tool with agent ref for this call
      const toolWithAgent = createSpawnAgentTool(
        projectDir, templateVars, getApiKey,
        "brain", 0, parentAgentRef,
      );
      return toolWithAgent.execute(toolCallId, params);
    }
    return origExecute(toolCallId, params);
  };

  // finish tool — agent calls this when research is complete
  const finishTool = {
    name: "finish",
    description: "Call when research is complete: PI review passed and final PDF compiled. This cleanly ends the research session.",
    parameters: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string" as const,
          description: "One-line summary of what was accomplished.",
        },
      },
      required: ["summary"],
    },
    execute: async (args: { summary: string }) => {
      // Hard lock: cannot finish while background agents are still running
      const active = getActiveBackgroundAgents(projectDir);
      if (active.length > 0) {
        const list = active.map(a => `  - ${a.name}: ${a.task} (running ${Math.floor((Date.now() - a.startedAt) / 1000)}s)`).join("\n");
        return { content: [{ type: "text" as const, text: `Cannot finish: ${active.length} background agent(s) still running. Wait for them to complete before finishing.\n\nActive agents:\n${list}` }] };
      }

      // Plan-commitment gate: every L2.X / E_N section in notes/experiments.md
      // must have **Status:** Complete or Deferred: <reason>. Pending blocks —
      // brain silently skipped experiments before this gate existed. Deferred
      // requires a reason so the final report surfaces it for human review.
      const expNotesPath = join(projectDir, "notes", "experiments.md");
      if (existsSync(expNotesPath)) {
        const sections = parseExperimentSections(readFileSync(expNotesPath, "utf-8"));
        const pending = sections.filter(s => s.status === "pending");
        const missing = sections.filter(s => s.status === "missing");
        const deferredNoReason = sections.filter(
          s => s.status === "deferred" && (s.deferredReason ?? "").length === 0,
        );
        if (pending.length + missing.length + deferredNoReason.length > 0) {
          const lines: string[] = [`Cannot finish: notes/experiments.md has sections that block completion.`];
          if (pending.length > 0) {
            lines.push(``, `Pending (${pending.length}):`);
            for (const s of pending) lines.push(`  - ${s.header}`);
            lines.push(`→ Spawn the experiment to completion, or change status to "Deferred: <justification>".`);
          }
          if (missing.length > 0) {
            lines.push(``, `Missing **Status:** line (${missing.length}):`);
            for (const s of missing) lines.push(`  - ${s.header}`);
            lines.push(`→ Add \`**Status:** Complete\`, \`**Status:** Pending\`, or \`**Status:** Deferred: <reason>\` to each.`);
          }
          if (deferredNoReason.length > 0) {
            lines.push(``, `Deferred without reason (${deferredNoReason.length}):`);
            for (const s of deferredNoReason) lines.push(`  - ${s.header}`);
            lines.push(`→ Write \`**Status:** Deferred: <one-sentence justification>\`. The reason surfaces in the report's Open Questions section for human review.`);
          }
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }
      }

      const pdfPath = join(projectDir, "report/report.pdf");
      if (!existsSync(pdfPath)) {
        return { content: [{ type: "text" as const, text: `Cannot finish: report/report.pdf does not exist. Compile the report first with compile_latex, then call finish again.` }] };
      }

      // Figure gate: require ≥1 self-generated figure (under report/figures/,
      // not imported from ../data/papers/). Without this, brain tends to ship
      // text-with-paper-imports and skip visualising its own quantitative
      // results. Deferred: <reason> in notes/experiments.md escape hatch is
      // available if every experiment was genuinely non-plottable.
      const reportTexPath = join(projectDir, "report/report.tex");
      if (existsSync(reportTexPath)) {
        const tex = readFileSync(reportTexPath, "utf-8");
        const includes = [...tex.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map(m => m[1]);
        const selfGen = includes.filter(p => !p.includes("/data/papers/") && !p.includes("data/papers/"));
        if (selfGen.length === 0 && includes.length > 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex has ${includes.length} figure(s), all imported from data/papers/. Reports with experiments must include ≥1 self-generated figure visualising your own quantitative results. See brain.md <generated_figures>: sourcing raw data from data/experiments/*/runs/*/data/, spawn illustrator or run a plot script to produce report/figures/<name>.pdf, then include it in report.tex.` }] };
        }
        if (selfGen.length === 0 && includes.length === 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex contains zero figures. Every research report needs ≥1 self-generated figure under report/figures/ visualising experiment results. See brain.md <generated_figures>.` }] };
        }
      }

      callbacks?.onFinish?.();
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }] };
    },
  };

  const initReport = createInitReportTool(projectDir);

  // idle tool — brain calls this after dispatching background agents when it
  // has no foreground work. Blocks on the harness side (poll active-agents.json
  // at 2s cadence) — zero LLM turns while waiting. Returns all bg results as
  // a single tool output when every running bg has transitioned to done/failed,
  // so brain processes them in one follow-up turn instead of per-nudge.
  //
  // Stale heartbeats (subagent-runner crashed without markFailed) are flipped
  // to "failed" here so they harvest instead of blocking forever.
  const idleTool = {
    name: "idle",
    description:
      "Suspend your turn-taking until ALL running background agents complete, " +
      "with zero LLM cost during the wait. Harness polls the registry every 2s " +
      "and returns all completions as this tool's output in one blob. Call this " +
      "after `spawn_agent(background=true)` when you have no foreground work " +
      "to do. Returns immediately if no background agents are running.",
    parameters: {
      type: "object" as const,
      properties: {
        timeout_ms: {
          type: "number" as const,
          description: "Max wait duration before giving up. Default 600000 (10 minutes). On timeout, any still-running agents are listed; they remain in the registry for next-turn harvest.",
        },
      },
    },
    execute: async (args: { timeout_ms?: number }) => {
      const agentDir = join(projectDir, ".agent");
      const timeout = args.timeout_ms ?? 600_000;
      const start = Date.now();
      const pollMs = 2000;

      // Grace period: brain commonly calls idle() in the same assistant turn
      // as spawn_agent(background=true), and pi-agent-core runs tools in
      // parallel. The spawn's synchronous addAgent() may not complete before
      // idle's first loadRegistry() reads the file — observed live as a race
      // where idle returned "no bg running" within 8s of brain's dispatch.
      // 500ms settles the race; indistinguishable from no-op on real idles.
      await new Promise(r => setTimeout(r, 500));

      // Zombie detection: mark an agent failed only when it's been running
      // long enough to have produced a heartbeat. subagent-runner touches
      // heartbeat at startup + every 30s; startup itself can take 5-10s
      // (node loads tsx + pi-agent-core + agent def). Without the
      // startedAt grace, a freshly-spawned agent has no heartbeat file yet
      // and would be falsely labelled zombie on the first poll.
      const ZOMBIE_GRACE_MS = 90_000;
      while (Date.now() - start < timeout) {
        const active = loadRegistry(agentDir);
        for (const a of active) {
          if (
            a.status === "running"
            && Date.now() - a.startedAt > ZOMBIE_GRACE_MS
            && !isAlive(agentDir, a.id, 60_000)
          ) {
            markFailed(agentDir, a.id, "heartbeat stale — process died without updating status");
          }
        }
        const stillRunning = loadRegistry(agentDir).filter(a => a.status === "running");
        if (stillRunning.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }

      const active = loadRegistry(agentDir);
      const harvested: string[] = [];
      for (const a of active) {
        if (a.status === "done" && a.result) {
          harvested.push(`[Background Agent Complete: ${a.name} ✓]\nTask: ${a.task}\n\n${a.result}`);
          removeAgent(agentDir, a.id);
        } else if (a.status === "failed") {
          harvested.push(`[Background Agent Failed: ${a.name} ✗]\nTask: ${a.task}\n\n${a.result ?? "Unknown error"}`);
          removeAgent(agentDir, a.id);
        }
      }

      const remaining = loadRegistry(agentDir).filter(a => a.status === "running");
      let body: string;
      if (harvested.length === 0 && remaining.length === 0) {
        body = "No background agents were running.";
      } else if (remaining.length > 0) {
        body = `Timeout (${timeout}ms) reached with ${remaining.length} agent(s) still running: ${remaining.map(a => a.id).join(", ")}.`;
        if (harvested.length > 0) body += `\n\nHarvested ${harvested.length}:\n\n` + harvested.join("\n\n---\n\n");
      } else {
        body = `${harvested.length} background agent(s) completed:\n\n` + harvested.join("\n\n---\n\n");
      }
      return { content: [{ type: "text" as const, text: body }] };
    },
  };

  const tools = [
    ...reportTools,
    initReport,
    ...codingTools,
    spawnTool,
    idleTool,
    finishTool,
  ];

  return {
    tools,
    setParentAgent: (agent: Agent) => { parentAgentRef = agent; },
  };
}
