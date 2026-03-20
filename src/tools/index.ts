/**
 * Tool index — assembles all research tools.
 */

import type { Model } from "@mariozechner/pi-ai";
import { createReportTools } from "./report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createDispatchWorkersTool } from "./workers.js";
import { createExperimentTool } from "./experiment.js";

export function buildResearchTools(
  projectDir: string,
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  trackUsage?: (usage: any) => void,
): any[] {
  const codingTools = createCodingToolsForProject(projectDir);
  const reportTools = createReportTools(projectDir);

  // Search, download, citations, web are now a skill — agent uses bash to call scripts/search
  const workerTools = [...codingTools];
  const dispatchWorkers = createDispatchWorkersTool(workerTools, model, getApiKey, projectDir, trackUsage);

  const experimentTool = createExperimentTool(projectDir, model, getApiKey, trackUsage);

  return [
    ...reportTools,
    ...codingTools,
    dispatchWorkers,
    experimentTool,
  ];
}
