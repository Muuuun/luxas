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

export function applyDualProfileEnv(opts: { setBrain: boolean }): void {
  for (const [k, v] of Object.entries(DUAL_PROFILE_ENV)) process.env[k] = v;
  if (opts.setBrain && !process.env.LUXAS_BRAIN_MODEL) process.env.LUXAS_BRAIN_MODEL = DUAL_BRAIN_MODEL;
}
