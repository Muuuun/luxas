/**
 * Tool index — assembles all research tools for the brain agent.
 */

import { createReportTools } from "./report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createSpawnAgentTool } from "./spawn-agent.js";

export interface ToolCallbacks {
  onFinish?: () => void;
}

export function buildResearchTools(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
  callbacks?: ToolCallbacks,
): any[] {
  const codingTools = createCodingToolsForProject(projectDir);
  const reportTools = createReportTools(projectDir);

  // Single spawn_agent tool replaces search-agent, workers, experiment tools
  const spawnAgent = createSpawnAgentTool(projectDir, templateVars, getApiKey, trackUsage);

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
      // Guard: report.pdf must exist before finishing
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

  return [
    ...reportTools,
    ...codingTools,
    spawnAgent,
    finishTool,
  ];
}
