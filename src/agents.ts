/**
 * Agent Store — manages project-specific custom agent definitions.
 *
 * Agents are stored in data/agents.json per project.
 * The Brain can define new agents and reference them in tasks.
 * When a task has an agent_id, the agent's system_prompt is
 * prepended to the executor_prompt before execution.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "./types.js";

const AGENTS_FILE = "data/agents.json";

export class AgentStore {
  private projectDir: string;

  constructor(projectDir = ".") {
    this.projectDir = projectDir;
  }

  private get path(): string {
    return join(this.projectDir, AGENTS_FILE);
  }

  /** Get all defined agents */
  getAll(): AgentDefinition[] {
    if (!existsSync(this.path)) return [];
    try {
      return JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return [];
    }
  }

  /** Get a single agent by ID */
  get(id: string): AgentDefinition | null {
    return this.getAll().find((a) => a.id === id) ?? null;
  }

  /** Define or update an agent */
  save(agent: AgentDefinition): void {
    const agents = this.getAll();
    const idx = agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      agents[idx] = agent;
    } else {
      agents.push(agent);
    }
    mkdirSync(join(this.projectDir, "data"), { recursive: true });
    writeFileSync(this.path, JSON.stringify(agents, null, 2));
  }

  /** Delete an agent by ID */
  delete(id: string): boolean {
    const agents = this.getAll();
    const filtered = agents.filter((a) => a.id !== id);
    if (filtered.length === agents.length) return false;
    writeFileSync(this.path, JSON.stringify(filtered, null, 2));
    return true;
  }

  /**
   * Build the full executor prompt for a task.
   * If agent_id is set, prepend the agent's system_prompt.
   */
  buildPrompt(executorPrompt: string, agentId?: string): string {
    if (!agentId) return executorPrompt;

    const agent = this.get(agentId);
    if (!agent) {
      console.warn(`[agents] Agent "${agentId}" not found, using raw prompt`);
      return executorPrompt;
    }

    return `${agent.system_prompt}\n\n---\n\nTASK:\n${executorPrompt}`;
  }

  /** Generate summary for Brain context */
  summarizeForBrain(): string {
    const agents = this.getAll();
    if (agents.length === 0) return "No custom agents defined yet. Use define_agent to create one.";

    const lines = [`${agents.length} custom agent(s) defined (use same id to update):`];
    for (const a of agents) {
      lines.push(`  --- Agent: "${a.id}" ---`);
      lines.push(`  Name: ${a.name}`);
      lines.push(`  Model: ${a.default_model}`);
      lines.push(`  Description: ${a.description}`);
      lines.push(`  System Prompt:`);
      // Show full prompt so Brain can review and adjust
      for (const line of a.system_prompt.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    return lines.join("\n");
  }
}
