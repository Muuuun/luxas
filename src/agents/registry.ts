/**
 * Agent Registry — loads agent definitions from .md files, caches them,
 * and resolves template variables at spawn time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFINITIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "definitions");

// ── Types ────────────────────────────────────────────

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;                    // "sonnet" | "opus" | "haiku" | "inherit"
  thinkingLevel: string;            // "off" | "low" | "medium" | "high"
  toolSets: string[];               // resolved via tool-sets registry
  contextBuilder?: string;          // function name in context-builders registry
  safetyWrapper?: string;           // function name in safety-wrappers registry
  templates: string[];              // declared template variable names
  canSpawn: boolean;                // can this agent spawn sub-agents?
  allowedSpawn?: string[];          // if set, restricts which sub-agent names can be spawned
  systemPromptTemplate: string;     // markdown body with {{VAR}} placeholders
}

// ── Cache ────────────────────────────────────────────

let cache: Map<string, AgentDefinition> | null = null;

// ── Public API ───────────────────────────────────────

export function loadAgentDefinitions(): Map<string, AgentDefinition> {
  if (cache) return cache;

  cache = new Map();
  const files = readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(join(DEFINITIONS_DIR, file), "utf-8");
    const def = parseAgentDefinition(raw, file);
    if (def) cache.set(def.name, def);
  }

  return cache;
}

export function getDefinition(name: string): AgentDefinition {
  const defs = loadAgentDefinitions();
  const def = defs.get(name);
  if (!def) throw new Error(`Agent definition not found: "${name}". Available: ${[...defs.keys()].join(", ")}`);
  return def;
}

export function resolvePrompt(def: AgentDefinition, vars: Record<string, string>): string {
  let prompt = def.systemPromptTemplate;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
}

export function listAgentDescriptions(): Array<{ name: string; description: string; canSpawn: boolean }> {
  const defs = loadAgentDefinitions();
  return [...defs.values()].map(d => ({
    name: d.name,
    description: d.description,
    canSpawn: d.canSpawn,
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

  const [, frontmatter, body] = match;
  const fields = parseSimpleYaml(frontmatter);

  const name = fields.name;
  if (!name) {
    console.error(`Agent file ${filename}: missing required field 'name'`);
    return null;
  }

  return {
    name,
    description: fields.description ?? "",
    model: fields.model ?? "inherit",
    thinkingLevel: fields.thinkingLevel ?? "medium",
    toolSets: parseYamlArray(fields.toolSets),
    contextBuilder: fields.contextBuilder === "null" ? undefined : fields.contextBuilder,
    safetyWrapper: fields.safetyWrapper === "null" ? undefined : fields.safetyWrapper,
    templates: parseYamlArray(fields.templates),
    canSpawn: fields.canSpawn === "true" || fields.canSpawn === true,
    allowedSpawn: fields.allowedSpawn ? parseYamlArray(fields.allowedSpawn) : undefined,
    systemPromptTemplate: body.trim(),
  };
}

/**
 * Minimal YAML parser — handles simple key: value and key: [array] patterns.
 * Not a full YAML parser; sufficient for frontmatter.
 */
function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.match(/^\S/) && line.includes(":")) {
        // New key starts — save accumulated multiline value
        result[currentKey] = currentValue.trim();
        inMultiline = false;
        // Fall through to process this line as a new key
      } else {
        currentValue += "\n" + line;
        continue;
      }
    }

    const keyMatch = line.match(/^(\w+):\s*(.*)/);
    if (!keyMatch) continue;

    const [, key, value] = keyMatch;

    if (value === ">") {
      // YAML folded scalar
      currentKey = key;
      currentValue = "";
      inMultiline = true;
    } else if (value === "|") {
      // YAML literal scalar
      currentKey = key;
      currentValue = "";
      inMultiline = true;
    } else {
      result[key] = value.trim();
    }
  }

  if (inMultiline) {
    result[currentKey] = currentValue.trim();
  }

  return result;
}

function parseYamlArray(value: any): string[] {
  if (!value || value === "null" || value === "[]") return [];
  if (typeof value === "string") {
    // Handle [a, b, c] format
    const match = value.match(/^\[(.+)\]$/);
    if (match) {
      return match[1].split(",").map(s => s.trim());
    }
    return [value];
  }
  if (Array.isArray(value)) return value;
  return [];
}
