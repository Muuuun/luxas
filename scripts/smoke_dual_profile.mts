#!/usr/bin/env tsx
/**
 * smoke_dual_profile — verify --profile dual routes only vision-required
 * agents to the multimodal model while text agents go to DeepSeek-v4-pro.
 *
 * Vision agents:  illustrator, illustrator_write, typesetter  → deepseek-v4-flash-vision-exp
 * Text agents:    brain, experiment, reader, search, ...      → deepseek-v4-pro
 * PI reviewers:   reviewer, experiment_reviewer               → declared Anthropic tier
 *
 * Also guards the two live-probed API constraints of the vision model
 * (2026-09-02): it must accept images, and it must declare `reasoning: true`
 * so pickRequireToolChoice sends tool_choice="auto" — the same request with
 * "required" is rejected with 400 "Thinking mode does not support this
 * tool_choice", which would 400 every single agent turn.
 *
 *   npx tsx scripts/smoke_dual_profile.mts
 */
import { resolveModel, pickRequireToolChoice } from "../src/agents/spawn.js";

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

// ── 3. --profile dual (text=deepseek, vision=deepseek multimodal) ──
console.log("\n3. --profile dual (deepseek text + deepseek vision)");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = "deepseek-v4-flash-vision-exp";
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
// The invariant is the capability, not the vendor: a vision-required agent
// must land on a model that actually accepts images.
function acceptsImages(m: any): boolean {
  return Array.isArray(m?.input) && m.input.includes("image");
}
for (const agent of ["illustrator", "illustrator_write", "typesetter"]) {
  const m = resolveModel("sonnet", agent);
  check(`${agent} (sonnet) → deepseek-v4-flash-vision-exp`,
    modelId(m) === "deepseek-v4-flash-vision-exp", `got ${modelId(m)}`);
  check(`${agent} model accepts image input`, acceptsImages(m));
  // Live-probed 2026-09-02: thinking mode + tool_choice="required" is a hard
  // 400 on this model. `reasoning: true` is what makes the silent-exit guard
  // send "auto" instead, so it is a wire-level requirement, not a style flag.
  check(`${agent} → tool_choice "auto" (thinking mode rejects "required")`,
    pickRequireToolChoice(m) === "auto", `got ${pickRequireToolChoice(m)}`);
}
// The text producers must stay blind — that is why the split exists at all.
check("brain's text model does NOT accept images (the reason for the split)",
  !acceptsImages(resolveModel("sonnet", "brain")));

// Kimi K2.5 remains selectable as an escape hatch (it 404'd on the production
// account 2026-08-31; re-verify against /v1/models before using it).
process.env.LUXAS_VISION_MODEL_PROFILE = "k2p5";
check("LUXAS_VISION_MODEL_PROFILE=k2p5 still resolves to a vision model",
  acceptsImages(resolveModel("sonnet", "illustrator")));
process.env.LUXAS_VISION_MODEL_PROFILE = "deepseek-v4-flash-vision-exp";

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
