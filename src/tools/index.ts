/**
 * Tool index — assembles all research tools for the brain agent.
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import { createReportTools } from "./report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createSpawnAgentTool, getActiveBackgroundAgents } from "./spawn-agent.js";

export interface ToolCallbacks {
  onFinish?: () => void;
}

export function buildResearchTools(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
  callbacks?: ToolCallbacks,
): { tools: any[]; setParentAgent: (agent: Agent) => void } {
  const codingTools = createCodingToolsForProject(projectDir);
  const reportTools = createReportTools(projectDir);

  // Deferred parent agent ref — set after Agent is constructed (needed for background steer)
  let parentAgentRef: Agent | undefined;

  // Use a proxy object so spawn tool picks up the agent ref when it's set later
  const spawnTool = createSpawnAgentTool(
    projectDir, templateVars, getApiKey, trackUsage,
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
        projectDir, templateVars, getApiKey, trackUsage,
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
      const active = getActiveBackgroundAgents();
      if (active.length > 0) {
        const list = active.map(a => `  - ${a.name}: ${a.task} (running ${Math.floor((Date.now() - a.startedAt) / 1000)}s)`).join("\n");
        return { content: [{ type: "text" as const, text: `Cannot finish: ${active.length} background agent(s) still running. Wait for them to complete before finishing.\n\nActive agents:\n${list}` }] };
      }
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const pdfPath = join(projectDir, "report/report.pdf");
      if (!existsSync(pdfPath)) {
        return { content: [{ type: "text" as const, text: `Cannot finish: report/report.pdf does not exist. Compile the report first with compile_latex, then call finish again.` }] };
      }
      callbacks?.onFinish?.();
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }] };
    },
  };

  const tools = [
    ...reportTools,
    ...codingTools,
    spawnTool,
    finishTool,
  ];

  return {
    tools,
    setParentAgent: (agent: Agent) => { parentAgentRef = agent; },
  };
}
