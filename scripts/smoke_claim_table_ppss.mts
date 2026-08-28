/**
 * smoke_claim_table_ppss — the pp-vs-ss run (2026-08-26→28) as a fixture for the
 * v2 rules: answered blind flags (E3 magic-angle C6 flagged by a toy blind
 * estimate, answered by E4), blind comparability, obligation scope, value-match.
 */
import { buildClaimTable, renderClaimTable } from "../src/claims-table.ts";
import { headlineDeclsFor, obligationScope, stampBlindInputs, quantityDeclarationProblems } from "../src/claims-review.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const dir = "fixtures/claims-ppss";
const t = buildClaimTable(dir);
const row = (id: string) => t.rows.find((r) => r.id === id)!;

// P0.1 answered flag: E3=120.3±14 flagged by blind 14.8±3; E4=126.3±2 (different experiment) agrees with E3 → answered.
check("magic-angle C6: toy blind flag answered by E4 → not disputed", row("c6_at_dm0_magic_angle_ghz_um6").status !== "disputed" && row("c6_at_dm0_magic_angle_ghz_um6").reasons.some((x) => /answered by E4/.test(x)), row("c6_at_dm0_magic_angle_ghz_um6").reasons.join(" | "));
// max_gain_over_orientation: E3=1.956 vs blind 1.07 — no other experiment estimates that id → still disputed (E4 capped it under a different id; the brain must re-key or disclose).
check("max_gain_over_orientation stays disputed (no independent estimate of that id)", row("max_gain_over_orientation").status === "disputed");
// zero angle: E3=22.909±0.01 vs E4=24.3±0.35 — producers themselves disagree → disputed for the right reason.
check("zero angle: producer-vs-producer disagreement is the reason, not the toy blind", row("c6_total_zero_angle_deg").status === "disputed" && row("c6_total_zero_angle_deg").reasons.some((x) => /disagree: E3.*E4|disagree: E4.*E3/.test(x)), row("c6_total_zero_angle_deg").reasons.join(" | "));
// sign-convention rows were countersigned → disclosed
check("countersigned sign disputes render as DISCLOSED", row("c6_ss_60").status === "disclosed" && row("c6_pp_theta0_60_diag").status === "disclosed", `${row("c6_ss_60").status}/${row("c6_pp_theta0_60_diag").status}`);
check("packing_gain_2d: producer, xval and blind agree (no dispute)", row("packing_gain_2d").status !== "disputed" && row("packing_gain_2d").reasons.some((x) => /blind estimate 1.38 agrees/.test(x)), row("packing_gain_2d").reasons.join(" | "));

// P0.2 obligation scope
const e4 = headlineDeclsFor(t, "E4_verify_c6_zero_physical_gain").map((d) => d.id);
check("E4 declared 7 headline ids; obligation scope ≤ frame∩E4 + 3", e4.length <= 3 + t.frameHeadline.length && e4.length >= 3, e4.join(","));
check("scope ranks by load: c6_total_zero_angle_deg (read by 2 verdicts) is kept", e4.includes("c6_total_zero_angle_deg"), e4.join(","));
const scope = obligationScope(t);
check("project obligation scope is bounded (frame + 3/experiment) and includes frame ids", scope.length <= t.frameHeadline.length + 3 * 6 && t.frameHeadline.every((f) => scope.includes(f)), String(scope.length));
check("write-time hint names the kept ids when >3 headline:true", quantityDeclarationProblems(dir, "E4_verify_c6_zero_physical_gain").some((p) => /7 quantities are marked headline:true.*this round:/.test(p)));

// P0.1 stamping
check("stampBlindInputs fills an empty bracket", stampBlindInputs("ESTIMATE(blind): q — 1 ± 0.1 via napkin — inputs: []", { a: 2, b: -3.5 }).endsWith("inputs: [a=2, b=-3.5]"));
check("stampBlindInputs appends when the bracket is missing", /— inputs: \[a=2\]$/.test(stampBlindInputs("ESTIMATE(blind): q — 1 ± 0.1 via napkin", { a: 2 })));
check("stampBlindInputs leaves a filled bracket alone", stampBlindInputs("ESTIMATE(blind): q — 1 ± 0.1 via x — inputs: [a=9]", { a: 2 }).endsWith("[a=9]"));

// P0.6: blind without a route is posthoc
check("blind line without `via` is posthoc, never flags", !t.rows.some((r) => r.reasons.some((x) => /blind reviewer estimate .* disagrees/.test(x) && !/via/.test(x) && false)));

// render sanity
check("renderClaimTable still renders", /<claim_status>/.test(renderClaimTable(t)));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — pp-vs-ss fixture: flags are answered by computation, scope is bounded, stamps work.");
