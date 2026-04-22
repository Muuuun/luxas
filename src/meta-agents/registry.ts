/**
 * Meta-agent Registry — parallel to src/agents/registry.ts, loads
 * agent definitions from src/meta-agents/definitions/*.md.
 *
 * Why a separate registry (not a layer in the main one):
 *   - Production brain/experiment/reviewer cannot spawn meta-agents
 *     (their spawn.allowedTypes lists are drawn only from this module's
 *     siblings — the main getDefinition never sees "reflect").
 *   - Meta-agents cannot spawn production agents (reflect's allowedTypes
 *     is drawn only from meta-agents/definitions/, enforced at load time).
 *   - validateSpawnGraph runs independently in each registry, so a cycle
 *     through brain → reflect → brain is architecturally impossible:
 *     neither name resolves in the other registry.
 *   - Deletion is cheap: `rm -rf src/meta-agents/` leaves production
 *     untouched.
 *
 * This file duplicates ~60 lines of parser logic from src/agents/registry.ts
 * on purpose. If a third registry ever appears, extract the parser to a
 * shared module then — premature abstraction today would couple the two
 * registries for a benefit we don't yet need.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { expandTemplate } from "../utils.js";
import { SAFETY_PRESETS } from "../agents/safety-presets.js";
import type {
  AgentDefinition,
  SpawnConfig,
  SafetyConfig,
} from "../agents/registry.js";

const META_DEFINITIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "definitions",
);

// Meta-agents currently use inline `protectedFiles:` in their frontmatter
// rather than named presets. The production preset universe is still
// validated here so shared presets (research_brief, etc.) stay available
// if a future meta-agent wants them. META_SAFETY_PRESETS is reference-only
// until buildSafetyWrapper learns about multiple preset maps.

// ── Cache ────────────────────────────────────────────────────────────────

let cache: Map<string, AgentDefinition> | null = null;

// ── Public API ───────────────────────────────────────────────────────────

export function loadMetaAgentDefinitions(): Map<string, AgentDefinition> {
  if (cache) return cache;

  const defs = new Map<string, AgentDefinition>();
  const files = readdirSync(META_DEFINITIONS_DIR).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(join(META_DEFINITIONS_DIR, file), "utf-8");
    const def = parseAgentDefinition(raw, file);
    if (def) defs.set(def.name, def);
  }

  validateMetaSpawnGraph(defs);
  cache = defs;
  return cache;
}

export function getMetaDefinition(name: string): AgentDefinition {
  const defs = loadMetaAgentDefinitions();
  const def = defs.get(name);
  if (!def) {
    throw new Error(
      `Meta-agent definition not found: "${name}". Available: ${[...defs.keys()].join(", ")}`,
    );
  }
  return def;
}

export function resolveMetaPrompt(
  def: AgentDefinition,
  vars: Record<string, string>,
): string {
  return expandTemplate(def.systemPromptTemplate, vars);
}

export function clearMetaCache(): void {
  cache = null;
}

// ── Parser (duplicated from src/agents/registry.ts with preset-map swap) ──

function parseAgentDefinition(
  raw: string,
  filename: string,
): AgentDefinition | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.error(`Meta-agent file ${filename}: missing YAML frontmatter (---)`);
    return null;
  }

  const [, frontmatterText, body] = match;

  let fields: Record<string, any>;
  try {
    const parsed = yaml.load(frontmatterText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`Meta-agent file ${filename}: frontmatter did not parse as a YAML mapping`);
      return null;
    }
    fields = parsed as Record<string, any>;
  } catch (err: any) {
    console.error(`Meta-agent file ${filename}: YAML parse error — ${err?.message ?? err}`);
    return null;
  }

  const name = fields.name;
  if (!name || typeof name !== "string") {
    console.error(`Meta-agent file ${filename}: missing required field 'name'`);
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
  };
}

function buildSafetyConfig(
  fields: Record<string, any>,
  filename: string,
): SafetyConfig | undefined {
  const block = fields.safety;
  if (block == null) return undefined;
  if (typeof block !== "object" || Array.isArray(block)) {
    console.error(`Meta-agent file ${filename}: 'safety' must be a mapping`);
    return undefined;
  }
  const maybeList = (v: unknown) => (v == null ? undefined : asStringArray(v));
  const policy = block.writeOnExistingPolicy;
  if (policy !== undefined && policy !== "block" && policy !== "allow_as_read") {
    console.error(
      `Meta-agent file ${filename}: 'safety.writeOnExistingPolicy' must be "block" or "allow_as_read" — got ${JSON.stringify(policy)}`,
    );
  }
  const presets = maybeList(block.presets);
  if (presets) {
    const known = Object.keys(SAFETY_PRESETS);
    for (const pName of presets) {
      if (!(pName in SAFETY_PRESETS)) {
        console.error(
          `Meta-agent file ${filename}: unknown safety preset "${pName}". Available: ${known.join(", ")}`,
        );
      }
    }
  }
  return {
    presets,
    protectedFiles: maybeList(block.protectedFiles),
    allowedReadRoots: maybeList(block.allowedReadRoots),
    allowedWriteRoots: maybeList(block.allowedWriteRoots),
    writeOnExistingPolicy:
      policy === "block" || policy === "allow_as_read" ? policy : undefined,
  };
}

function buildSpawnConfig(
  fields: Record<string, any>,
  filename: string,
): SpawnConfig {
  const block = fields.spawn;
  if (block == null) return { enabled: false };
  if (typeof block !== "object" || Array.isArray(block)) {
    console.error(`Meta-agent file ${filename}: 'spawn' must be a mapping`);
    return { enabled: false };
  }
  if (block.enabled !== undefined && typeof block.enabled !== "boolean") {
    console.error(`Meta-agent file ${filename}: 'spawn.enabled' must be a boolean`);
  }
  return {
    enabled: block.enabled === true,
    allowedTypes: block.allowedTypes == null ? undefined : asStringArray(block.allowedTypes),
  };
}

/**
 * DFS over meta-agent definitions only. Production-agent names in
 * allowedTypes are ignored (would be silently dropped as unresolved),
 * which is the intended isolation: reflect cannot declare "brain" as
 * an allowedType and get brain resolved through this registry.
 *
 * For MVP no meta-agent spawns any other meta-agent, so this is a no-op
 * in practice. Kept symmetric with the production validateSpawnGraph so
 * adding sub-meta-agents later (e.g. a session_analyzer fanout) does
 * not silently permit cycles.
 */
function validateMetaSpawnGraph(defs: Map<string, AgentDefinition>): void {
  const state = new Map<string, "visiting" | "done">();

  function dfs(name: string, path: string[]): void {
    if (state.get(name) === "visiting") {
      const cycle = [...path.slice(path.indexOf(name)), name].join(" → ");
      throw new Error(
        `Meta-agent spawn cycle detected: ${cycle}. Remove the offending entry from one agent's allowedTypes.`,
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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") return [value];
  return [];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
