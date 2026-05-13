/**
 * Agent Registry — loads agent definitions from .md files, caches them,
 * and resolves template variables at spawn time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { expandTemplate } from "../utils.js";
import { SAFETY_PRESETS } from "./safety-presets.js";

const DEFINITIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "definitions");

// ── Types ────────────────────────────────────────────

export interface SpawnConfig {
  enabled: boolean;
  /** Undefined = any registered agent type is allowed. */
  allowedTypes?: string[];
}

export interface SafetyConfig {
  /** Names from SAFETY_PRESETS — resolved at wrapper-build time. */
  presets?: string[];
  /** Additional project-relative paths beyond those from presets. */
  protectedFiles?: string[];
  /** Restrict read scope; supports `{{VAR}}` templating. Undefined = no restriction. */
  allowedReadRoots?: string[];
  /**
   * Positive whitelist for writes/edits. Paths outside every listed root
   * are rejected. Supports `{{VAR}}` templating (resolved at wrap time).
   * Undefined = no positive whitelist (still subject to protectedFiles blocklist).
   */
  allowedWriteRoots?: string[];
  /**
   * bash commands that appear to write (redirect, heredoc via `>`, `tee`,
   * `cp`/`mv`, `touch`, `sed -i`, inline `open(..., "w")`, `writeFileSync`)
   * to any path under these prefixes are blocked. Guards against agents
   * bypassing allowedWriteRoots via bash. Supports `{{VAR}}`.
   */
  blockedBashWriteRoots?: string[];
  /** "block" = reject write on existing (force edit); "allow_as_read" = permit. */
  writeOnExistingPolicy?: "block" | "allow_as_read";
}

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;                    // "sonnet" | "opus" | "haiku" | "inherit"
  thinkingLevel: string;            // "off" | "low" | "medium" | "high"
  toolSets: string[];               // resolved via tool-sets registry
  contextBuilder?: string;          // function name in context-builders registry
  templates: string[];              // declared template variable names
  spawn: SpawnConfig;
  safety?: SafetyConfig;            // undefined = no wrapping (raw tools)
  systemPromptTemplate: string;     // markdown body with {{VAR}} placeholders
  /**
   * Hard ceiling on assistant turns for this sub-agent. When exceeded,
   * spawn.ts aborts the agent and records stopReason="killed". Brain has
   * its own 500-turn cap in src/agent.ts; this field covers everything
   * spawned via spawn.ts. Undefined = no cap (use sparingly — every
   * sub-agent should have one to bound runaway token cost from
   * tool-loop tar pits, especially under tool_choice=required providers
   * like Kimi/openai-completions where the natural text-only exit
   * doesn't work).
   */
  maxTurns?: number;
}

// ── Cache ────────────────────────────────────────────

let cache: Map<string, AgentDefinition> | null = null;

// ── Public API ───────────────────────────────────────

export function loadAgentDefinitions(): Map<string, AgentDefinition> {
  if (cache) return cache;

  const defs = new Map<string, AgentDefinition>();
  const files = readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(join(DEFINITIONS_DIR, file), "utf-8");
    const def = parseAgentDefinition(raw, file);
    if (def) defs.set(def.name, def);
  }

  validateSpawnGraph(defs);
  cache = defs;
  return cache;
}

export function getDefinition(name: string): AgentDefinition {
  const defs = loadAgentDefinitions();
  const def = defs.get(name);
  if (!def) throw new Error(`Agent definition not found: "${name}". Available: ${[...defs.keys()].join(", ")}`);
  return def;
}

export function resolvePrompt(def: AgentDefinition, vars: Record<string, string>): string {
  return expandTemplate(def.systemPromptTemplate, vars);
}

export function listAgentDescriptions(): Array<{ name: string; description: string; canSpawn: boolean }> {
  const defs = loadAgentDefinitions();
  return [...defs.values()].map(d => ({
    name: d.name,
    description: d.description,
    canSpawn: d.spawn.enabled,
  }));
}

export function clearCache(): void {
  cache = null;
}

// ── Parser ───────────────────────────────────────────

function parseAgentDefinition(raw: string, filename: string): AgentDefinition | null {
  // Split frontmatter from body
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.error(`Agent file ${filename}: missing YAML frontmatter (---)`);
    return null;
  }

  const [, frontmatterText, body] = match;

  let fields: Record<string, any>;
  try {
    const parsed = yaml.load(frontmatterText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`Agent file ${filename}: frontmatter did not parse as a YAML mapping`);
      return null;
    }
    fields = parsed as Record<string, any>;
  } catch (err: any) {
    console.error(`Agent file ${filename}: YAML parse error — ${err?.message ?? err}`);
    return null;
  }

  const name = fields.name;
  if (!name || typeof name !== "string") {
    console.error(`Agent file ${filename}: missing required field 'name'`);
    return null;
  }

  return {
    name,
    description: typeof fields.description === "string" ? fields.description : "",
    model: typeof fields.model === "string" ? fields.model : "inherit",
    thinkingLevel: typeof fields.thinkingLevel === "string" ? fields.thinkingLevel : "medium",
    toolSets: asStringArray(fields.toolSets),
    contextBuilder: asOptionalString(fields.contextBuilder),
    templates: asStringArray(fields.templates),
    spawn: buildSpawnConfig(fields, filename),
    safety: buildSafetyConfig(fields, filename),
    systemPromptTemplate: body.trim(),
    maxTurns: typeof fields.maxTurns === "number" && fields.maxTurns > 0 ? fields.maxTurns : undefined,
  };
}

function buildSafetyConfig(fields: Record<string, any>, filename: string): SafetyConfig | undefined {
  const block = fields.safety;
  if (block == null) return undefined;
  if (typeof block !== "object" || Array.isArray(block)) {
    console.error(`Agent file ${filename}: 'safety' must be a mapping — got ${Array.isArray(block) ? "array" : typeof block}`);
    return undefined;
  }
  const maybeList = (v: unknown) => (v == null ? undefined : asStringArray(v));
  const policy = block.writeOnExistingPolicy;
  if (policy !== undefined && policy !== "block" && policy !== "allow_as_read") {
    console.error(`Agent file ${filename}: 'safety.writeOnExistingPolicy' must be "block" or "allow_as_read" — got ${JSON.stringify(policy)}`);
  }
  const presets = maybeList(block.presets);
  if (presets) {
    const known = Object.keys(SAFETY_PRESETS);
    for (const name of presets) {
      if (!(name in SAFETY_PRESETS)) {
        console.error(`Agent file ${filename}: unknown safety preset "${name}". Available: ${known.join(", ")}`);
      }
    }
  }
  return {
    presets,
    protectedFiles: maybeList(block.protectedFiles),
    allowedReadRoots: maybeList(block.allowedReadRoots),
    allowedWriteRoots: maybeList(block.allowedWriteRoots),
    blockedBashWriteRoots: maybeList(block.blockedBashWriteRoots),
    writeOnExistingPolicy: policy === "block" || policy === "allow_as_read" ? policy : undefined,
  };
}

function buildSpawnConfig(fields: Record<string, any>, filename: string): SpawnConfig {
  const block = fields.spawn;
  if (block == null) return { enabled: false };
  if (typeof block !== "object" || Array.isArray(block)) {
    console.error(`Agent file ${filename}: 'spawn' must be a mapping — got ${Array.isArray(block) ? "array" : typeof block}`);
    return { enabled: false };
  }
  if (block.enabled !== undefined && typeof block.enabled !== "boolean") {
    console.error(`Agent file ${filename}: 'spawn.enabled' must be a boolean — got ${typeof block.enabled}`);
  }
  return {
    enabled: block.enabled === true,
    allowedTypes: block.allowedTypes == null ? undefined : asStringArray(block.allowedTypes),
  };
}

/**
 * DFS the spawn graph and throw on the first cycle found. Undeclared
 * `allowedTypes` (i.e. "allow any registered type") contributes no static
 * edges — cycles through such nodes are caught at runtime by the ancestor
 * chain check, not here.
 */
export function validateSpawnGraph(defs: Map<string, AgentDefinition>): void {
  const state = new Map<string, "visiting" | "done">();

  function dfs(name: string, path: string[]): void {
    if (state.get(name) === "visiting") {
      const cycle = [...path.slice(path.indexOf(name)), name].join(" → ");
      throw new Error(
        `Spawn cycle detected: ${cycle}. Remove the offending entry from one agent's allowedTypes.`,
      );
    }
    if (state.get(name) === "done") return;
    state.set(name, "visiting");
    const children = defs.get(name)?.spawn.allowedTypes ?? [];
    for (const child of children) {
      if (defs.has(child)) dfs(child, [...path, name]);
    }
    state.set(name, "done");
  }

  for (const name of defs.keys()) dfs(name, []);
}

/** Coerce a YAML value to a string array; non-arrays become []. */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
}

/** Return the value if it's a string, otherwise undefined. */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
