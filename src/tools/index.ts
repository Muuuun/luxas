/**
 * Tool index — assembles all research tools.
 */

import type { Model } from "@mariozechner/pi-ai";
import { createReportTools } from "./report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createDispatchWorkersTool } from "./workers.js";
import { createExperimentTool } from "./experiment.js";

export interface ToolCallbacks {
  onFinish?: () => void;
}

export function buildResearchTools(
  projectDir: string,
  model: Model<any>,
  workerModel: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
  callbacks?: ToolCallbacks,
): any[] {
  const codingTools = createCodingToolsForProject(projectDir);
  const reportTools = createReportTools(projectDir);

  // Workers use workerModel (sonnet) for cost efficiency
  const workerTools = [...codingTools];
  const dispatchWorkers = createDispatchWorkersTool(workerTools, workerModel, getApiKey, projectDir, trackUsage);

  // Experiment uses workerModel by default; main agent can request opus via thinkingLevel
  const experimentTool = createExperimentTool(projectDir, workerModel, getApiKey, trackUsage);

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
      callbacks?.onFinish?.();
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }] };
    },
  };

  return [
    ...reportTools,
    ...codingTools,
    dispatchWorkers,
    experimentTool,
    finishTool,
  ];
}
