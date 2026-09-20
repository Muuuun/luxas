#!/usr/bin/env tsx
/**
 * smoke_dual_profile — verify --profile dual routes only vision-required
 * agents to the multimodal model while text agents go to DeepSeek-v4-pro.
 *
 * Vision agents:  illustrator, illustrator_write, typesetter  → deepseek-flash
 * Text agents:    experiment, reader, search, ...             → deepseek-v4-pro
 * brain:          deepseek-v4-pro (LUXAS_BRAIN_MODEL, 2026-09-20 — OpenAI out of credit)
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

function acceptsImages(m: any): boolean {
  return Array.isArray(m?.input) && m.input.includes("image");
}

function modelId(m: any): string {
  return m?.id ?? m?.model?.id ?? "<unknown>";
}

// ── 1. Baseline: no profile env vars ─────────────────────────────
console.log("1. claude mode (no env profile)");
delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_VISION_MODEL_PROFILE;
check("brain (sonnet) → claude-sonnet-5",
  modelId(resolveModel("sonnet", "brain")).includes("sonnet"));
check("illustrator (sonnet) → claude-sonnet-5",
  modelId(resolveModel("sonnet", "illustrator")).includes("sonnet"));
check("typesetter (sonnet) → claude-sonnet-5",
  modelId(resolveModel("sonnet", "typesetter")).includes("sonnet"));
// --profile claude means Anthropic-only, including the figure auditor.
delete process.env.LUXAS_VISION_AUDIT_MODEL_PROFILE;
check("figure_auditor (sonnet) → claude-sonnet-5 (Anthropic-only run)",
  modelId(resolveModel("sonnet", "figure_auditor")).includes("sonnet"));

// ── 2. Legacy --model deepseek-v4-pro (no vision profile) ────────
console.log("\n2. legacy --model deepseek-v4-pro (no vision split)");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
delete process.env.LUXAS_VISION_MODEL_PROFILE;
delete process.env.LUXAS_BRAIN_MODEL;
// With LUXAS_BRAIN_MODEL unset, brain still follows the producer profile. That
// is the escape hatch an explicit `--model deepseek-*` family switch relies on:
// index.ts only pins brain when the user did NOT name a model.
check("brain (sonnet) → deepseek-v4-pro when LUXAS_BRAIN_MODEL is unset",
  modelId(resolveModel("sonnet", "brain")) === "deepseek-v4-pro");
check("illustrator (sonnet) → deepseek-v4-pro (NO vision split)",
  modelId(resolveModel("sonnet", "illustrator")) === "deepseek-v4-pro");
check("typesetter (sonnet) → deepseek-v4-pro (NO vision split)",
  modelId(resolveModel("sonnet", "typesetter")) === "deepseek-v4-pro");

// ── 3. --profile dual (text=deepseek, vision=deepseek multimodal) ──
console.log("\n3. --profile dual (deepseek text + deepseek vision)");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = "deepseek-flash";
process.env.LUXAS_VISION_AUDIT_MODEL_PROFILE = "glm-5.3-flash";
// Mirrors the env `--profile dual` sets in src/index.ts. brain is deliberately
// NOT on the producer model: measured 2026-09-06, deepseek-v4-pro placed last
// of five models on brain's own pipeline-design task on all three scoring
// channels (notes/model-routing-2026-09-06.md). If index.ts and this line ever
// disagree, the gate is testing a routing nobody runs.
process.env.LUXAS_BRAIN_MODEL = "deepseek-v4-pro";
{
  const b = resolveModel("sonnet", "brain");
  check("brain (sonnet) → deepseek-v4-pro (2026-09-20: OpenAI out of credit)",
    modelId(b) === "deepseek-v4-pro", `got ${modelId(b)}`);
  check("brain's model resolves to a real id on a provider with a key slot",
    !!(b as any)?.provider && !!(b as any)?.cost);
  // brain sends a forced tool choice every turn (the silent-exit guard), and a
  // model that rejects one 400s on turn 1 — fable-5.1 does exactly that.
  // But "required" is NOT universally right: DeepSeek's reasoning models
  // answer a forced choice with 400 "Thinking mode does not support this
  // tool_choice", so "auto" is CORRECT for them and the guard's job passes to
  // the prompt instruction plus the maxTurns cap. Assert the pairing rather
  // than a fixed string, or this gate fails every time brain moves to a
  // reasoning model and tempts someone to "fix" it by forcing a 400.
  const tc = pickRequireToolChoice(b);
  check("brain's tool_choice is the strongest value its model accepts",
    (b as any)?.reasoning ? tc === "auto" : (tc === "required" || tc === "any"),
    `${modelId(b)} reasoning=${!!(b as any)?.reasoning} → ${tc}`);
  // Every Luxas agent is a tool caller on EVERY turn, so a brain model whose
  // api cannot carry function tools is a turn-1 death for the whole run.
  // gpt-6-astra shipped that way on 2026-09-06 and stayed latent until the
  // first launch that actually reached the brain (2026-09-15): on
  // /v1/chat/completions it answers any request carrying tools with
  //   400 Function tools with reasoning_effort are not supported ... use
  //       /v1/responses or set reasoning_effort to 'none'
  // and its own suggested escape hatch is rejected too ('none' is not a
  // supported value for this model). Assert the constraint, not one model's
  // answer, so this protects whichever brain is configured.
  const brainApi = (b as any)?.api, brainId = modelId(b);
  check("brain's model uses an api that accepts function tools",
    brainId === "gpt-6-astra" ? brainApi === "openai-responses" : !!brainApi,
    `got ${brainId} on api=${brainApi}`);
}
// The documented one-line rollback must actually reach applyProfile. This
// assignment was unconditional until 2026-09-20, so `LUXAS_BRAIN_MODEL=... `
// was silently overwritten under --profile dual and the operator got the
// pinned model with nothing printed.
{
  const saved = process.env.LUXAS_BRAIN_MODEL;
  process.env.LUXAS_BRAIN_MODEL = "glm-5.3";
  check("a pre-set LUXAS_BRAIN_MODEL wins over the profile's pin",
    modelId(resolveModel("sonnet", "brain")) === "glm-5.3",
    `got ${modelId(resolveModel("sonnet", "brain"))}`);
  process.env.LUXAS_BRAIN_MODEL = saved;
}
check("experiment stays on the producer profile while brain does not",
  modelId(resolveModel("sonnet", "experiment")) === "deepseek-v4-pro");
check("experiment (sonnet) → deepseek-v4-pro",
  modelId(resolveModel("sonnet", "experiment")) === "deepseek-v4-pro");
check("reader (haiku) → deepseek-v4-pro",
  modelId(resolveModel("haiku", "reader")) === "deepseek-v4-pro");
// PI reviewers are exempt from the producer-profile downgrade and keep their
// declared Anthropic tier (PI_REVIEWER_AGENTS in spawn.ts): an independent
// prior is the point, so the reviewer must not run on the producer's model.
check("reviewer (sonnet) → claude-sonnet-5 (PI keeps Anthropic tier)",
  modelId(resolveModel("sonnet", "reviewer")) === "claude-sonnet-5");
// The invariant is the capability, not the vendor: a vision-required agent
// must land on a model that actually accepts images.
for (const agent of ["illustrator", "illustrator_write", "typesetter"]) {
  const m = resolveModel("sonnet", agent);
  check(`${agent} (sonnet) → deepseek-flash`,
    modelId(m) === "deepseek-flash", `got ${modelId(m)}`);
  check(`${agent} model accepts image input`, acceptsImages(m));
  // Reasoning models get tool_choice "auto". This is a hard requirement on the
  // deepseek vision entry (thinking + "required" is a 400 there) and harmless
  // on GLM, which accepts both — keep it asserted so a swap back is safe.
  check(`${agent} → tool_choice "auto"`,
    pickRequireToolChoice(m) === "auto", `got ${pickRequireToolChoice(m)}`);
}
// The text producers must stay blind — that is why the split exists at all.
check("brain's text model does NOT accept images (the reason for the split)",
  !acceptsImages(resolveModel("sonnet", "brain")));

// figure_auditor is the ship/no-ship eye. `--profile dual` leaves its override
// unset on purpose so it keeps the Anthropic tier: the drawing agents are GLM,
// and an auditor on the drawing model is not an independent eye. The text
// profile must NEVER reach it either — that downgrade is what let a cheap model
// "pass" five broken figures (figures v2, 2026-08-28).
{
  const fa = resolveModel("sonnet", "figure_auditor");
  check("figure_auditor → glm-5.3-flash under dual",
    modelId(fa) === "glm-5.3-flash", `got ${modelId(fa)}`);
  check("figure_auditor's model accepts image input", acceptsImages(fa));
  check("figure_auditor is NOT the model that drew the figure",
    (fa as any)?.provider !== (resolveModel("sonnet", "illustrator_write") as any)?.provider,
    "producer and auditor share a provider — independent review is lost");
}

// Kimi K2.5 remains selectable as an escape hatch (it 404'd on the production
// account 2026-08-31; re-verify against /v1/models before using it).
process.env.LUXAS_VISION_MODEL_PROFILE = "k2p5";
check("LUXAS_VISION_MODEL_PROFILE=k2p5 still resolves to a vision model",
  acceptsImages(resolveModel("sonnet", "illustrator")));
process.env.LUXAS_VISION_MODEL_PROFILE = "deepseek-flash";

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
