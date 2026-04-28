/**
 * Coding tools — read, write, edit from pi-coding-agent + Sisyphus's hardened
 * bash. We swap the bash entry from createCodingTools' result with our own
 * (default 600s timeout, SIGTERM grace, .agent/jobs/<id>/ state.json + log,
 * ALS owner identity) — see src/tools/bash-hardened.ts.
 */

import { createCodingTools } from "@mariozechner/pi-coding-agent";
import { createHardenedBashTool } from "./bash-hardened.js";

export function createCodingToolsForProject(projectDir: string): any[] {
  const tools = createCodingTools(projectDir);
  const hardened = createHardenedBashTool(projectDir);
  return tools.map(t => (t?.name === "bash" ? hardened : t));
}
