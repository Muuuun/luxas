/**
 * Tool index — assembles all research tools.
 */

import type { Model } from "@mariozechner/pi-ai";
import { createSearchTools } from "./search.js";
import { createPaperTools } from "./papers.js";
import { createWebTools } from "./web.js";
import { createReportTools } from "./report.js";
import { createCodingToolsForProject } from "./coding.js";
import { createDispatchWorkersTool } from "./workers.js";
import { createExperimentTool } from "./experiment.js";

export function buildResearchTools(
  projectDir: string,
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
): any[] {
  const codingTools = createCodingToolsForProject(projectDir);
  const searchTools = createSearchTools();
  const paperTools = createPaperTools(projectDir);
  const webTools = createWebTools();
  const reportTools = createReportTools(projectDir);

  // Workers get a subset of tools (coding + search + web + paper)
  const workerTools = [...codingTools, ...searchTools, ...paperTools, ...webTools];
  const dispatchWorkers = createDispatchWorkersTool(workerTools, model, getApiKey);

  const experimentTool = createExperimentTool(projectDir);

  return [
    ...searchTools,
    ...paperTools,
    ...webTools,
    ...reportTools,
    ...codingTools,
    dispatchWorkers,
    experimentTool,
  ];
}
