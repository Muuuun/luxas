/**
 * Routing env for `--profile dual`, in ONE place. `luxas run`, `luxas models`
 * and the live canary (scripts/smoke_live_canary.mts) all apply it, so the
 * canary exercises exactly the routes a run would take. The reasons for each
 * choice live beside the run-path call in src/index.ts.
 *
 * `brain` is only filled in when the caller has not already chosen one
 * (explicit --model family switch, or a pre-set LUXAS_BRAIN_MODEL rollback).
 */
export const DUAL_PROFILE_ENV = {
  LUXAS_MODEL_PROFILE: "deepseek-v4-pro",
  LUXAS_VISION_MODEL_PROFILE: "deepseek-flash",
  LUXAS_VISION_AUDIT_MODEL_PROFILE: "glm-5.3-flash",
} as const;
export const DUAL_BRAIN_MODEL = "deepseek-v4-pro";
/**
 * The reader's model under dual. Its definition asks for the cheapest tier
 * (`haiku`), but the profile maps all three Anthropic tier names onto the one
 * producer model, so it ran on the flagship. Measured 2026-10-06
 * (scripts/reader_compare.mts, 4 papers of the Dy project, notes checked
 * against the paper text and by a blind non-DeepSeek judge, two of the
 * judge's findings confirmed on the page image): deepseek-flash made 1
 * wrong-number error in 131 stated numbers; deepseek-v4-pro made 3 in 101 on
 * a fresh run (it swapped the two isotopes' nuclear moments) and 1 in 99 on
 * the production run's own notes. Two runs of the same model differ by more
 * than the two models do, at $0.050 vs $0.162 per paper and 0.9 vs 2.3 min.
 * Like the brain, only filled in when the operator has not set it:
 * LUXAS_READER_MODEL=deepseek-v4-pro is the rollback.
 */
export const DUAL_READER_MODEL = "deepseek-flash";

export function applyDualProfileEnv(opts: { setBrain: boolean }): void {
  for (const [k, v] of Object.entries(DUAL_PROFILE_ENV)) process.env[k] = v;
  if (opts.setBrain && !process.env.LUXAS_BRAIN_MODEL) process.env.LUXAS_BRAIN_MODEL = DUAL_BRAIN_MODEL;
  if (!process.env.LUXAS_READER_MODEL) process.env.LUXAS_READER_MODEL = DUAL_READER_MODEL;
}
