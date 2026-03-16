/**
 * Coding tools — read, write, edit, bash from pi-coding-agent.
 */

import { createCodingTools } from "@mariozechner/pi-coding-agent";

export function createCodingToolsForProject(projectDir: string): any[] {
  return createCodingTools(projectDir);
}
