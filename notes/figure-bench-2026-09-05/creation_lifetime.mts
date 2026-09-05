const which = process.argv[2];               // "ds" | "sonnet"
const dir = process.argv[3];
process.env.LUXAS_ROOT = "/Users/muqiao/Documents/Sisyphus";
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = which === "ds" ? "deepseek-v4-flash-vision-exp" : which === "glm" ? "glm-5.3-flash" : "sonnet";
const { spawnAgent, resolveModel } = await import("/Users/muqiao/Documents/Sisyphus/src/agents/spawn.js");
const { getApiKey } = await import("/Users/muqiao/Documents/Sisyphus/src/auth.js");
console.log("illustrator_write →", (resolveModel("sonnet","illustrator_write") as any)?.id);
const BRIEF = `Create the Rydberg-lifetime figure for this paper.

**Figure name**: ba_lifetime_vs_n  (→ report/figures/ba_lifetime_vs_n.pdf + .png)

**Claim it settles**: "The barium 6sng 1G4 Rydberg lifetime grows as a power law in n and, at 300 K, exceeds the Rb nS and Sr 3S1 reference lifetimes at every n from 40 to 100, while staying far below the 7.1 ms quoted by Shi2025."

**Data** (all under data/experiments/E6_frontier/runs/run_1/data/):
- ba_frontier_fine.csv — one row per (n, T); columns include n, T (4 or 300), Ba_qd_tau_eff_us (the barium effective lifetime in microseconds; use the T = 300 rows).
- reference_lifetimes_full.csv — columns species, n, l, j, tau_rad_us, tau_eff_300K_us, tau_eff_4K_us; mixed species (Rb, Cs, Sr, Yb) and mixed l in one table.
- Shi2025 quotes a 7.1 ms (7100 us) lifetime for the same state; it is a literature number, not in any file.

**Plot semantics**: one panel, single column. x = n (40 to 100), y = lifetime in microseconds, log y.
crux: barium above the Rb and Sr references at 300 K, and both far below the Shi2025 line — those three relations must be readable at print size.
form: single panel, single width.
points: 61 barium points at 300 K; the reference tables are sparse (a few n per species).
sigma: none available — say so in the spec.

Keep it to the series the claim needs. Return when the PNG is rendered and you have looked at it.`;
const t = Date.now();
const r: any = await spawnAgent({
  name: "illustrator_write",
  templateVars: { PROJECT_DIR: dir, EXPERIMENT_ID: "E6_frontier" },
  prompt: BRIEF, projectDir: dir, getApiKey,
});
console.log(JSON.stringify({which, stop:r?.exit?.stopReason, tools:r?.exit?.toolCallCount,
  wallSec: Math.round((Date.now()-t)/1000), err:r?.exit?.errorMessage ?? null}));
