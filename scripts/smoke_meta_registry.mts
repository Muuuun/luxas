import { loadMetaAgentDefinitions } from "../src/meta-agents/registry.js";
import { META_SAFETY_PRESETS } from "../src/meta-agents/safety-presets.js";

const defs = loadMetaAgentDefinitions();

const expectedPreset: Record<string, readonly string[]> = {
  reflect: META_SAFETY_PRESETS.meta_scope,
  reflect_light: META_SAFETY_PRESETS.meta_scope,
  reflect_validate: META_SAFETY_PRESETS.meta_scope,
  reflect_evolve: META_SAFETY_PRESETS.evolve_scope,
};

console.log(`Loaded ${defs.size} meta-agent definitions:`);
const expected = new Set(Object.keys(expectedPreset));
const loaded = new Set(defs.keys());
for (const name of expected) {
  if (!loaded.has(name)) { console.error(`MISSING: ${name}`); process.exit(1); }
}
for (const name of loaded) {
  if (!expected.has(name)) { console.error(`UNEXPECTED: ${name}`); process.exit(1); }
}
console.log(`  ✓ expected set matches: {${[...expected].join(", ")}}`);

// Drift check: each .md's inline protectedFiles must equal its scope's TS constant.
// If this fails, someone edited one side without the other — converge them.
for (const [name, def] of defs) {
  const declared = new Set(def.safety?.protectedFiles ?? []);
  const expected = new Set(expectedPreset[name]);
  const missing = [...expected].filter((p) => !declared.has(p));
  const extra = [...declared].filter((p) => !expected.has(p));
  if (missing.length || extra.length) {
    console.error(`DRIFT in ${name}.md protectedFiles vs META_SAFETY_PRESETS:`);
    for (const p of missing) console.error(`  - missing (in TS preset, not frontmatter): ${p}`);
    for (const p of extra) console.error(`  + extra (in frontmatter, not TS preset): ${p}`);
    process.exit(1);
  }
}
console.log(`  ✓ protectedFiles in all .md match META_SAFETY_PRESETS`);

for (const [name, def] of defs) {
  console.log(`\n  ${name}:`);
  console.log(`    model: ${def.model}`);
  console.log(`    thinkingLevel: ${def.thinkingLevel}`);
  console.log(`    toolSets: [${def.toolSets.join(", ")}]`);
  console.log(`    spawn.enabled: ${def.spawn.enabled}`);
  console.log(`    safety.writeOnExisting: ${def.safety?.writeOnExistingPolicy}`);
  console.log(`    templates: [${def.templates.join(", ")}]`);
  console.log(`    protectedFiles: ${def.safety?.protectedFiles?.length ?? 0}`);
}
