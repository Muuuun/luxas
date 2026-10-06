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
  /** Bash commands that MENTION these project-relative path prefixes are refused (read-side blindness, claims-first §3.6). */
  blockedBashPathMentions?: string[];
  /** Deny-list for the read tool, inside allowedReadRoots (see safety-wrappers.ts). */
  blockedReadRoots?: string[];
  /** Figures v3: this agent may not write a plotting script — a `.py` whose content calls `savefig`/imports pyplot is refused (data figures are `.figspec.json`). */
  figureSpecOnly?: boolean;
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
  if (name === "experiment" && soloExperimentEnabled()) return soloExperimentDefinition(def);
  return def;
}

// ── Solo executor (LUXAS_EXPERIMENT_MODE=solo) ────────────────────────────────
//
// One strong agent does the whole experiment: writes the code, runs it, writes
// results.json and its ledger section. No tool_impl / tool_review sub-agents.
// Everything downstream is untouched because the agent keeps the name
// "experiment" and the same output contract — the blind replicator, the
// experiment_reviewer loop, the claims table and the finish gates read the same
// files as before.
//
// Why (measured 2026-10-06, four past experiments, verbatim task text, one run
// each): a single Opus 5.5 agent was right and complete on 3 of 4 against 1 of
// 4 for the orchestrated pipeline's first pass, in 175 turns / 24 M input /
// 0.39 M output tokens against 1,132 calls / 116 M / 2.6 M. Across six real
// runs the pipeline averaged ~300 calls and ~$10 per experiment, and on the Dy
// run its 147 blind tests passed while four errors sat in the integration step
// the orchestrator does alone. What caught those was the replicator and the
// reviewer, which stay. The same single-agent shape on deepseek-v4-pro
// delivered nothing in 200 steps: this mode is for a strong executor model
// (spawn.ts routes it to claude-opus-5-5; LUXAS_EXECUTOR_MODEL overrides).
//
// It is derived from experiment.md rather than written as a second file so the
// Evidence Contract and the results.json contract cannot drift apart between
// the two modes; only the role block and the write/spawn permissions change.

export function soloExperimentEnabled(): boolean {
  return process.env.LUXAS_EXPERIMENT_MODE === "solo";
}

const ROLE_SEPARATION_RE = /<role_separation strict="true">[\s\S]*?<\/role_separation>/;

export const SOLO_ROLE_BLOCK = `<solo_mode strict="true">
This run uses the SOLO executor. There are no \`tool_impl\` and no \`tool_review\` agents: you write the code under \`data/experiments/{{EXPERIMENT_ID}}/scripts/\` yourself, run it, and check it yourself. Wherever the text below says to spawn \`tool_impl\` / \`tool_review\`, to describe a tool for them, to wait for their tests, or that a choice "belongs to tool_impl" — that work and that choice are yours. Do not try to spawn them; the spawn will be refused.

Everything else below is unchanged and binding: the Evidence Contract, the acceptance criterion frozen before you compute anything, the results.json contract (quantities, method ladder, cross-validation plan, premise corrections), and your \`## L2.N\` ledger section.

What replaces the independent test author: after you return, your result is checked by a blind replicator (another model that sees your quantity definitions and inputs, never your code or values) and by an independent reviewer. So tests you write are engineering hygiene, not evidence — keep them in \`tests/\` if they help you, and never cite "tests pass" as validation of a headline number. The validation that counts is the cross-validation plan you froze in Phase 1.

Do not end your work while a computation you started is still running: wait for it, read its output, then write. You are done only when \`data/experiments/{{EXPERIMENT_ID}}/runs/run_1/results.json\` exists, every headline value in it is the number your final computation produced, and your ledger section is filled in. An experiment that returns without results.json is sent straight back.
</solo_mode>`;

export function soloExperimentDefinition(base: AgentDefinition): AgentDefinition {
  // An anchor that no longer matches must fail loudly: a silent no-op would
  // run the orchestrator prompt with the sub-agents it needs taken away.
  if (!ROLE_SEPARATION_RE.test(base.systemPromptTemplate)) {
    throw new Error("solo executor: experiment.md no longer has a <role_separation strict=\"true\"> block to replace — update soloExperimentDefinition");
  }
  const safety: any = { ...(base.safety ?? {}) };
  const roots = ["data/experiments/{{EXPERIMENT_ID}}/scripts/", "data/experiments/{{EXPERIMENT_ID}}/tests/"];
  safety.allowedWriteRoots = [...new Set([...(safety.allowedWriteRoots ?? []), ...roots])];
  safety.blockedBashWriteRoots = (safety.blockedBashWriteRoots ?? []).filter((r: string) => !roots.includes(r));
  const spawn: any = { ...(base.spawn ?? {}) };
  spawn.allowedTypes = (spawn.allowedTypes ?? []).filter((t: string) => t !== "tool_impl" && t !== "tool_review");
  return {
    ...base,
    description: "Research experiment, solo executor: one agent writes the code, runs it and writes results.json + its ledger section.",
    systemPromptTemplate: base.systemPromptTemplate.replace(ROLE_SEPARATION_RE, SOLO_ROLE_BLOCK),
    safety,
    spawn,
  };
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
    figureSpecOnly: block.figureSpecOnly === true ? true : undefined,
    blockedBashWriteRoots: maybeList(block.blockedBashWriteRoots),
    blockedBashPathMentions: maybeList(block.blockedBashPathMentions),
    blockedReadRoots: maybeList(block.blockedReadRoots),
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
