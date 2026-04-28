/**
 * Coding tools — read, write, edit from pi-coding-agent + Sisyphus's hardened
 * bash + job-control tools. We swap the bash entry from createCodingTools'
 * result with our own (default 600s timeout, SIGTERM grace, .agent/jobs/<id>/
 * state.json + log, ALS owner identity) and append job_status / job_output /
 * job_wait / job_kill so every agent that has bash can also observe and
 * control its background jobs.
 */

import { createCodingTools } from "@mariozechner/pi-coding-agent";
import { createHardenedBashTool } from "./bash-hardened.js";
import { createJobControlTools } from "./job-control.js";

export function createCodingToolsForProject(projectDir: string): any[] {
  const tools = createCodingTools(projectDir);
  const hardened = createHardenedBashTool(projectDir);
  const swapped = tools.map(t => (t?.name === "bash" ? hardened : t));
  return [...swapped, ...createJobControlTools(projectDir)];
}
