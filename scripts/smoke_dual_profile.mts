#!/usr/bin/env tsx
/**
 * smoke_dual_profile — verify --profile dual routes only vision-required
 * agents to Kimi (k2p5) while text agents go to DeepSeek-v4-pro.
 *
 * Vision agents:  illustrator, illustrator_write, typesetter  → k2p5
 * Text agents:    brain, experiment, reader, search, ...            → deepseek-v4-pro
 * PI reviewers:   reviewer, experiment_reviewer                     → declared Anthropic tier
 *
 *   npx tsx scripts/smoke_dual_profile.mts
 */
import { resolveModel } from "../src/agents/spawn.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

function modelId(m: any): string {
  return m?.id ?? m?.model?.id ?? "<unknown>";
}

// ── 1. Baseline: no profile env vars ─────────────────────────────
console.log("1. claude mode (no env profile)");
delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_VISION_MODEL_PROFILE;
check("brain (sonnet) → claude-sonnet-4-6",
  modelId(resolveModel("sonnet", "brain")).includes("sonnet"));
check("illustrator (sonnet) → claude-sonnet-4-6",
  modelId(resolveModel("sonnet", "illustrator")).includes("sonnet"));
check("typesetter (sonnet) → claude-sonnet-4-6",
  modelId(resolveModel("sonnet", "typesetter")).includes("sonnet"));

// ── 2. Legacy --model deepseek-v4-pro (no vision profile) ────────
console.log("\n2. legacy --model deepseek-v4-pro (no vision split)");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
delete process.env.LUXAS_VISION_MODEL_PROFILE;
check("brain (sonnet) → deepseek-v4-pro",
  modelId(resolveModel("sonnet", "brain")) === "deepseek-v4-pro");
check("illustrator (sonnet) → deepseek-v4-pro (NO vision split)",
  modelId(resolveModel("sonnet", "illustrator")) === "deepseek-v4-pro");
check("typesetter (sonnet) → deepseek-v4-pro (NO vision split)",
  modelId(resolveModel("sonnet", "typesetter")) === "deepseek-v4-pro");

// ── 3. --profile dual (text=deepseek, vision=k2p5) ──────────────
console.log("\n3. --profile dual (deepseek text + kimi vision)");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = "k2p5";
check("brain (sonnet) → deepseek-v4-pro",
  modelId(resolveModel("sonnet", "brain")) === "deepseek-v4-pro");
check("experiment (sonnet) → deepseek-v4-pro",
  modelId(resolveModel("sonnet", "experiment")) === "deepseek-v4-pro");
check("reader (haiku) → deepseek-v4-pro",
  modelId(resolveModel("haiku", "reader")) === "deepseek-v4-pro");
// PI reviewers are exempt from the producer-profile downgrade and keep their
// declared Anthropic tier (PI_REVIEWER_AGENTS in spawn.ts): an independent
// prior is the point, so the reviewer must not run on the producer's model.
check("reviewer (sonnet) → claude-sonnet-4-6 (PI keeps Anthropic tier)",
  modelId(resolveModel("sonnet", "reviewer")) === "claude-sonnet-4-6");
// k2p5 is defined inline as kimi-k2.5 via the kimi-coding provider.
// Check that vision agents resolve to a model with vision input + the kimi provider.
function isKimiVision(m: any): boolean {
  return m?.provider === "kimi-coding" && Array.isArray(m?.input) && m.input.includes("image");
}
check("illustrator (sonnet) → kimi-vision",
  isKimiVision(resolveModel("sonnet", "illustrator")));
check("illustrator_write (sonnet) → kimi-vision",
  isKimiVision(resolveModel("sonnet", "illustrator_write")));
check("typesetter (sonnet) → kimi-vision",
  isKimiVision(resolveModel("sonnet", "typesetter")));

// ── 4. OpenAI/Codex tiers (gpt-5.6-terra, o3) bypass profile ───────────
console.log("\n4. OpenAI tiers bypass profile");
const m = resolveModel("gpt-5.6-terra", "math");
check("math (gpt-5.6-terra) → gpt-5.6-terra (NOT redirected to deepseek)",
  modelId(m) === "gpt-5.6-terra", `got ${modelId(m)}`);

// ── 5. Vision-required agents bypass when no vision profile set ─
console.log("\n5. Vision agents fall back when no vision profile");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
delete process.env.LUXAS_VISION_MODEL_PROFILE;
check("illustrator → deepseek (no vision profile = legacy behaviour)",
  modelId(resolveModel("sonnet", "illustrator")) === "deepseek-v4-pro");

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
