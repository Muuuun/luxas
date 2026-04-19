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
      callbacks?.onFinish?.();
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }] };
    },
  };

  const initReport = createInitReportTool(projectDir);

  const tools = [
    ...reportTools,
    initReport,
    ...codingTools,
    spawnTool,
    finishTool,
  ];

  return {
    tools,
    setParentAgent: (agent: Agent) => { parentAgentRef = agent; },
  };
}
