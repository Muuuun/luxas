/**
 * Safety wrappers — named functions that wrap tool arrays with
 * runtime safety constraints (e.g., read-before-edit, protected files).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type SafetyWrapper = (tools: any[], projectDir: string) => any[];

const SAFETY_WRAPPERS: Record<string, SafetyWrapper> = {
  experiment: wrapExperimentTools,
};

export function resolveSafetyWrapper(name: string | undefined): SafetyWrapper | undefined {
  if (!name) return undefined;
  return SAFETY_WRAPPERS[name];
}

export function registerSafetyWrapper(name: string, wrapper: SafetyWrapper): void {
  SAFETY_WRAPPERS[name] = wrapper;
}

// ── Experiment safety wrapper (extracted from experiment.ts) ──

const PROTECTED_FILES = [
  "report.tex", "references.bib",
  "notes/literature.md", "notes/experiments.md", "notes/memory.md",
  "RESEARCH.md",
];

function wrapExperimentTools(tools: any[], projectDir: string): any[] {
  const readFiles = new Set<string>();

  return tools.map((tool: any) => {
    if (tool.name === "read") {
      const origExecute = tool.execute;
      return {
        ...tool,
        execute: async (id: string, params: any, signal?: any) => {
          const p = params.path || params.file_path || "";
          readFiles.add(join(projectDir, p));
          readFiles.add(p);
          return origExecute(id, params, signal);
        },
      };
    }

    if (tool.name === "edit") {
      const origExecute = tool.execute;
      return {
        ...tool,
        execute: async (id: string, params: any, signal?: any) => {
          const p = params.path || params.file_path || "";
          const abs = join(projectDir, p);
          if (PROTECTED_FILES.some(f => p.endsWith(f) || abs.endsWith(f))) {
            return { content: [{ type: "text", text: `BLOCKED: ${p} is managed by the supervising agent. Do not modify it.` }] };
          }
          if (!readFiles.has(abs) && !readFiles.has(p)) {
            return { content: [{ type: "text", text: `BLOCKED: You must read ${p} before editing it. Use the read tool first.` }] };
          }
          return origExecute(id, params, signal);
        },
      };
    }

    if (tool.name === "write") {
      const origExecute = tool.execute;
      return {
        ...tool,
        execute: async (id: string, params: any, signal?: any) => {
          const p = params.path || params.file_path || "";
          const abs = join(projectDir, p);
          if (PROTECTED_FILES.some(f => p.endsWith(f) || abs.endsWith(f))) {
            return { content: [{ type: "text", text: `BLOCKED: ${p} is managed by the supervising agent. Do not modify it.` }] };
          }
          if (existsSync(abs)) {
            return { content: [{ type: "text", text: `BLOCKED: ${p} already exists. Use the edit tool to modify existing files, not write. This prevents regression.` }] };
          }
          return origExecute(id, params, signal);
        },
      };
    }

    return tool;
  });
}
