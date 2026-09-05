const which = process.argv[2];               // "ds" | "sonnet"
const dir = process.argv[3];
process.env.LUXAS_ROOT = "/Users/muqiao/Documents/Sisyphus";
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
process.env.LUXAS_VISION_MODEL_PROFILE = which === "ds" ? "deepseek-v4-flash-vision-exp" : which === "glm" ? "glm-5.3-flash" : "sonnet";
const { spawnAgent, resolveModel } = await import("/Users/muqiao/Documents/Sisyphus/src/agents/spawn.js");
const { getApiKey } = await import("/Users/muqiao/Documents/Sisyphus/src/auth.js");
console.log("illustrator_write →", (resolveModel("sonnet","illustrator_write") as any)?.id);
const BRIEF = `Create the hero publication figure for this paper.

**Figure name**: gate_infidelity_frontier  (→ report/figures/gate_infidelity_frontier.pdf + .png)

**Claim it settles**: "At 2 W two-photon drive barium's decay-limited two-qubit gate infidelity sits below the Rb/Cs/Sr/Yb references across 40 <= n <= 100; at equal 20 mW power the barium decay ceiling rises and the advantage inverts."

**Data** (all under data/experiments/E6_frontier/runs/run_1/data/):
- frontier_4K.csv  — columns: n, Ba_qd_eps_decay, Ba_qd_eps_total_shi, Rb_eps_total, Cs_eps_total, Sr_eps_total, Yb_eps_total
- ba_decay_20mw_4K.csv — columns: n, eps_decay_20mw
- frontier_300K.csv, ba_decay_20mw_300K.csv — same column names at 300 K

**Plot semantics**: two panels, (a) 4 K and (b) 300 K. x = n, linear, 40 to 100. y = infidelity, log.
crux: the barium curve crossing the reference curves is the whole figure — that crossing must be unmistakable at print size.
form: two panels, column layout, double width.
points: 13 per sweep.
sigma: none available for these columns — say so in the spec.

Keep it to the series the claim needs. Return when the PNG is rendered and you have looked at it.`;
const t = Date.now();
const r: any = await spawnAgent({
  name: "illustrator_write",
  templateVars: { PROJECT_DIR: dir, EXPERIMENT_ID: "E6_frontier" },
  prompt: BRIEF, projectDir: dir, getApiKey,
});
console.log(JSON.stringify({which, stop:r?.exit?.stopReason, tools:r?.exit?.toolCallCount,
  wallSec: Math.round((Date.now()-t)/1000), err:r?.exit?.errorMessage ?? null}));
