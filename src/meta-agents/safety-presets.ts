/**
 * Safety presets for meta-agents — reference constants that mirror the
 * per-agent `protectedFiles` lists declared inline in each .md frontmatter.
 *
 * Why inline-in-frontmatter and not actually-resolved-presets:
 *   The production `buildSafetyWrapper` in src/agents/safety-wrappers.ts
 *   only knows about `SAFETY_PRESETS` from src/agents/safety-presets.ts.
 *   Teaching it about META_SAFETY_PRESETS requires a small refactor (move
 *   preset resolution to registry-parse time) that is not blocking any
 *   current work. Until that lands, each meta-agent declares its
 *   `protectedFiles` list literally in its frontmatter — using these
 *   constants as the source-of-truth reference.
 *
 * The three scopes differ in which layer each agent may write to:
 *   - reflect      writes Sisyphus production defs    → protects meta + TS
 *   - reflect_light appends log files only            → protects meta + TS
 *   - reflect_evolve writes reflect/reflect_light     → protects self + TS,
 *                                                       explicitly allows
 *                                                       reflect.md and
 *                                                       reflect_light.md
 */

const TS_INFRASTRUCTURE = [
  "src/agents/registry.ts",
  "src/agents/safety-presets.ts",
  "src/agents/safety-wrappers.ts",
  "src/agents/spawn.ts",
  "src/agents/tool-sets.ts",
  "src/agents/context-builders.ts",
  "src/agent.ts",
  "src/index.ts",
  "src/subagent-runner.ts",
  "src/hooks.ts",
  "src/session.ts",
  "src/meta-agents/registry.ts",
  "src/meta-agents/safety-presets.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
] as const;

const META_DEFINITIONS = [
  "src/meta-agents/definitions/reflect.md",
  "src/meta-agents/definitions/reflect_light.md",
  "src/meta-agents/definitions/reflect_evolve.md",
] as const;

export const META_SAFETY_PRESETS = {
  /**
   * For reflect + reflect_light. They edit production agent .md files and
   * observation logs; they never modify the meta layer (own, sibling, or
   * meta²) nor TS source.
   */
  meta_scope: [
    ...META_DEFINITIONS,
    ...TS_INFRASTRUCTURE,
  ],

  /**
   * For reflect_evolve only. It IS the agent authorized to edit reflect.md
   * and reflect_light.md — so those two are NOT in its protected list.
   * It still cannot edit itself (reflect_evolve.md) or the TS infrastructure.
   */
  evolve_scope: [
    "src/meta-agents/definitions/reflect_evolve.md",
    ...TS_INFRASTRUCTURE,
  ],
} as const;
