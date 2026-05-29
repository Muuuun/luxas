#!/usr/bin/env tsx
/**
 * F3-style validation for the A + B reviewer.md prompt additions.
 *
 *  A = <platform_fact_verification> — catches "platform X uses Y" basic-fact
 *      hallucinations on cited papers (UWR F1: Rydberg/AOD class).
 *  B = <plan_review_checklist> item 0b — catches methodology/technique-noun
 *      compression at plan stage (UWR F2: "pulse train" preserved but regime
 *      semantically shifted from fs→μs).
 *
 * Pattern mirrors the brain.md <negative_finding_protocol> validation:
 *   10 constructed scenarios × 2 model families = 20 invocations per check.
 *   Result: pass-through (bad — silent miss) vs flag (good — caught).
 *
 * Usage:
 *   tsx scripts/validate_ab_prompts.mts [--only A|B] [--limit N]
 *
 * Output: prints aggregate stats + per-scenario verdict; writes JSONL log to
 * /tmp/validate_ab_<timestamp>.jsonl for post-hoc inspection.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { streamSimple } from "@mariozechner/pi-ai";
import { resolveModel } from "../src/agents/spawn.js";
import { getApiKey } from "../src/auth.js";

const SIS = "/Users/muqiao/Documents/Sisyphus";

// ───────── extract the relevant reviewer.md blocks once ─────────
const reviewerMd = readFileSync(`${SIS}/src/agents/definitions/reviewer.md`, "utf-8");
function extractBlock(name: string): string {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "m");
  const m = reviewerMd.match(re);
  if (!m) throw new Error(`block ${name} not found in reviewer.md`);
  return m[1].trim();
}
const PLATFORM_FACT_BLOCK = extractBlock("platform_fact_verification");
const PLAN_REVIEW_BLOCK = extractBlock("plan_review_checklist");

// ───────── A scenarios: platform-fact verification ─────────
// Each scenario = (report excerpt with WRONG platform claim) + (verbatim
// quote from the cited paper showing what it actually says). The reviewer
// should detect the mismatch and recommend "steer".
type ScenarioA = {
  id: string;
  topic: string;
  reportExcerpt: string;
  citedPaperExcerpt: string;
  wrongClaim: string;
};
const A_SCENARIOS: ScenarioA[] = [
  {
    id: "A1-UWR-AOD",
    topic: "swept-interference vs Rydberg",
    reportExcerpt:
      `Compared to serial AOD-scanned Rydberg gates~\\cite{bluvstein2023}, swept ` +
      `interference offers an $N$-fold power-utilization advantage by addressing all ` +
      `$N$ qubits in parallel rather than sequentially.`,
    citedPaperExcerpt:
      `Bluvstein et al. (2023) Nature 626: "Rydberg gates are implemented by uniformly ` +
      `illuminating an entire entanglement zone with a global 420 nm Rydberg laser; ` +
      `the AOD is used for atom transport between zones, not for gate execution."`,
    wrongClaim: "AOD does Rydberg gate scanning (it does atom transport, gate is global)",
  },
  {
    id: "A2-IonQ-isotope",
    topic: "trapped-ion species",
    reportExcerpt:
      `IonQ's commercial systems trap $^{25}$Mg$^+$ ions in a linear surface trap~\\cite{wright2019benchmarking}.`,
    citedPaperExcerpt:
      `Wright et al. (2019) "Benchmarking an 11-qubit quantum computer": "Our trap ` +
      `confines a chain of $^{171}$Yb$^+$ ions cooled to the ground state."`,
    wrongClaim: "Mg+ vs actually Yb+",
  },
  {
    id: "A3-QuEra-Rydberg",
    topic: "neutral-atom Rydberg excitation",
    reportExcerpt:
      `QuEra's Aquila uses an SLM-shaped 420 nm beam to excite individual atoms ` +
      `to the Rydberg state at high spatial resolution~\\cite{wurtz2023aquila}.`,
    citedPaperExcerpt:
      `Wurtz et al. (2023) "Aquila: QuEra's 256-qubit neutral atom quantum computer": ` +
      `"Atoms are excited to the 70S Rydberg state by a uniform 420 nm + 1013 nm two-photon ` +
      `transition delivered via a global beam; SLM is used only to arrange the trap geometry."`,
    wrongClaim: "SLM for Rydberg excitation (SLM is for trap layout, Rydberg is global)",
  },
  {
    id: "A4-Google-fixedfreq",
    topic: "superconducting qubit tunability",
    reportExcerpt:
      `Google's Sycamore architecture relies on fixed-frequency transmon qubits ` +
      `with cross-resonance gates~\\cite{arute2019supremacy}.`,
    citedPaperExcerpt:
      `Arute et al. (2019) Nature 574: "Sycamore qubits are flux-tunable transmons; ` +
      `frequencies are dynamically swept during two-qubit iSWAP gates using flux pulses."`,
    wrongClaim: "fixed-frequency (Sycamore is tunable)",
  },
  {
    id: "A5-MS-Majorana",
    topic: "topological qubit",
    reportExcerpt:
      `Microsoft Station Q has demonstrated Majorana-based qubit operation ` +
      `in InSb nanowires~\\cite{mourik2012signatures}.`,
    citedPaperExcerpt:
      `Mourik et al. (2012) Science 336: "We report observation of a zero-bias peak ` +
      `consistent with Majorana fermions in InSb nanowires." (Note: signature observation only, ` +
      `no qubit operation demonstrated.)`,
    wrongClaim: "qubit operation (Mourik 2012 only showed signature, not operation)",
  },
  {
    id: "A6-Xanadu-wavelength",
    topic: "photonic squeezed light",
    reportExcerpt:
      `Xanadu's Borealis generates squeezed light at 800 nm using time-multiplexed ` +
      `optical loops~\\cite{madsen2022borealis}.`,
    citedPaperExcerpt:
      `Madsen et al. (2022) Nature 606: "Borealis operates at telecom wavelength 1550 nm ` +
      `using lithium niobate waveguides; time-multiplexing is via fiber loops of length ~50 m."`,
    wrongClaim: "800 nm (actually 1550 nm)",
  },
  {
    id: "A7-uncited",
    topic: "uncited mechanism claim",
    reportExcerpt:
      `It is well established that silicon-photonic 16-mode interferometers exhibit ` +
      `programmable thermo-optic tuning at sub-MHz bandwidth.`,
    citedPaperExcerpt: `(no citation in report — uncited claim)`,
    wrongClaim: "uncited platform mechanism claim",
  },
  {
    id: "A8-Bluvstein2024-shuttle",
    topic: "atom-array logical entanglement",
    reportExcerpt:
      `Bluvstein et al. (2024) showed two-qubit Rydberg gates implemented by ` +
      `sequentially shuttling atoms through a focused gate beam using AODs~\\cite{bluvstein2024logical}.`,
    citedPaperExcerpt:
      `Bluvstein et al. (2024) Nature 626: "Atom transport between storage, entanglement, and ` +
      `readout zones is performed by AODs; once atoms reach the entanglement zone, gates are ` +
      `executed by global Rydberg illumination on all atoms in that zone simultaneously."`,
    wrongClaim: "AOD does gate execution (AOD does transport, gate is global)",
  },
  {
    id: "A9-NV-roomtemp-sensitivity",
    topic: "NV-center magnetometry",
    reportExcerpt:
      `Single NV centers in diamond have demonstrated 100~fT/$\\sqrt{\\text{Hz}}$ magnetic ` +
      `sensitivity at room temperature using DC magnetometry~\\cite{wolf2015subpicotesla}.`,
    citedPaperExcerpt:
      `Wolf et al. (2015) PRX 5: "Our ensemble NV magnetometer achieves 0.9 pT/$\\sqrt{\\text{Hz}}$ ` +
      `at 100 Hz, operating at room temperature." (Single-NV sensitivity is ~10 nT/$\\sqrt{\\text{Hz}}$, ` +
      `not 100 fT — the reported number is for an ensemble.)`,
    wrongClaim: "single NV at 100 fT (Wolf 2015 reports 0.9 pT for ENSEMBLE)",
  },
  {
    id: "A10-PsiQuantum-fusion",
    topic: "photonic fusion-based computing",
    reportExcerpt:
      `PsiQuantum's fusion-based architecture uses deterministic single-photon sources ` +
      `coupled to ring resonators on silicon nitride~\\cite{bartolucci2023fusion}.`,
    citedPaperExcerpt:
      `Bartolucci et al. (2023) Nat Commun: "Fusion-based architecture assumes ` +
      `probabilistic single-photon sources (typically heralded SPDC) and uses photon ` +
      `routing through silicon-photonic chips with thermo-optic switches, not ring resonators."`,
    wrongClaim: "deterministic sources + ring resonators (FBQC uses probabilistic + switches)",
  },
];

// ───────── B scenarios: methodology noun-preservation ─────────
// Each scenario = (RESEARCH.md user request) + (plan.md sub-question) where
// the plan preserved the technique noun in title but compressed the regime/
// substituted the mechanism. Reviewer should flag METHODOLOGY-SUBSTITUTION.
type ScenarioB = {
  id: string;
  topic: string;
  researchExcerpt: string;
  planExcerpt: string;
  substitution: string;
};
const B_SCENARIOS: ScenarioB[] = [
  {
    id: "B1-UWR-fs-to-us",
    topic: "ultrafast wavefront rotation",
    researchExcerpt:
      `Survey use cases for ultrafast wavefront rotation (UWR) in neutral-atom quantum computing.`,
    planExcerpt:
      `### §E_0 (b): Pulse train operation for UWR-based Rydberg gates\n` +
      `Question: Can UWR be delivered as a $\\mu$s-rate pulse train compatible with Rydberg gate ` +
      `timescales? Search EO-modulated CW, Q-switched, and AWG-driven laser systems. Do not search ` +
      `fs/ps mode-locked-oscillator systems.`,
    substitution: "UWR is fs-native (Quéré 2014, Vincenti 2012 all 80 MHz Ti:Sapph); plan excludes fs regime",
  },
  {
    id: "B2-EIT-to-Faraday",
    topic: "EIT-based dispersive readout",
    researchExcerpt:
      `Analyze EIT-based dispersive readout for single-atom quantum non-demolition measurement.`,
    planExcerpt:
      `### §E_0 (a): EIT readout architecture\n` +
      `Question: We will analyze Faraday rotation as the functional analog of EIT readout in ` +
      `a regime where the probe is far-detuned from any atomic resonance.`,
    substitution: "Faraday is paramagnetic dispersion, not EIT susceptibility; different physics",
  },
  {
    id: "B3-Hahn-to-CPMG",
    topic: "Hahn-echo Rydberg gate",
    researchExcerpt:
      `Design a Hahn-echo Rydberg two-qubit gate to suppress dephasing in alkali tweezer arrays.`,
    planExcerpt:
      `### §E_0 (a): Echo-based Rydberg gate sequence\n` +
      `Question: We will use a CPMG sequence (N=4 refocusing pulses) since CPMG provides better ` +
      `dephasing suppression than a single Hahn echo.`,
    substitution: "Hahn = 1 π pulse, CPMG = N pulses; not 'better Hahn', different sequence class",
  },
  {
    id: "B4-broadband-squeezed",
    topic: "broadband squeezed vacuum",
    researchExcerpt:
      `Evaluate broadband squeezed vacuum for sub-shot-noise gravitational-wave detection above 10 kHz.`,
    planExcerpt:
      `### §E_0 (a): Squeezed vacuum source\n` +
      `Question: Narrowband squeezing (linewidth $\\sim$10 kHz) is sufficient for current LIGO ` +
      `applications — we will analyze narrowband OPO sources only.`,
    substitution: "User wanted broadband (>10 kHz), plan restricts to narrowband",
  },
  {
    id: "B5-STIRAP-to-RAP",
    topic: "STIRAP transfer",
    researchExcerpt:
      `Implement STIRAP-based coherent state transfer for $^{87}$Rb Rydberg state preparation.`,
    planExcerpt:
      `### §E_0 (a): Population transfer protocol\n` +
      `Question: We will implement Rapid Adiabatic Passage (RAP) as the functional equivalent ` +
      `of STIRAP, since both achieve adiabatic population transfer.`,
    substitution: "STIRAP = 2-laser counterintuitive, RAP = 1-laser chirped; different physics",
  },
  {
    id: "B6-Thouless-pumping",
    topic: "Thouless topological pumping",
    researchExcerpt:
      `Investigate Thouless pumping for protected charge transport in 1D superlattices.`,
    planExcerpt:
      `### §E_0 (a): Geometric phase pumping\n` +
      `Question: We will analyze general adiabatic geometric phase pumping rather than ` +
      `Thouless-specific topological pumping, since the latter is too restrictive.`,
    substitution: "Thouless = quantized C number 1st Chern; geometric phase ≠ topological",
  },
  {
    id: "B7-Raman-sideband-to-EIT-cool",
    topic: "Raman sideband cooling",
    researchExcerpt:
      `Compare Raman sideband cooling of $^{40}$Ca$^+$ ions to alternative methods.`,
    planExcerpt:
      `### §E_0 (a): Single-mode ground-state cooling\n` +
      `Question: EIT cooling achieves comparable ground-state populations as Raman sideband ` +
      `cooling but with simpler optics, so we will analyze EIT cooling instead.`,
    substitution: "User asked Raman sideband; plan substitutes EIT cooling (different mechanism)",
  },
  {
    id: "B8-Floquet-to-RWA",
    topic: "Floquet engineering",
    researchExcerpt:
      `Use Floquet driving to engineer effective Hamiltonians in optical lattices.`,
    planExcerpt:
      `### §E_0 (a): Floquet driving analysis\n` +
      `Question: We will treat the high-frequency limit using rotating-wave approximation ` +
      `(RWA) averaging, equivalent to Floquet engineering in the appropriate regime.`,
    substitution: "Floquet ≠ RWA; Floquet preserves higher harmonics, RWA discards them",
  },
  {
    id: "B9-AOM-to-EOM",
    topic: "AOM-based intensity modulation",
    researchExcerpt:
      `Design AOM-based intensity modulation for shaped Rydberg pulses at 100 ns timescale.`,
    planExcerpt:
      `### §E_0 (a): Intensity modulation hardware\n` +
      `Question: EOM-based amplitude modulation is faster than AOMs and easier to align — ` +
      `we will use EOMs throughout the design.`,
    substitution: "AOM = diffractive (slower, but well-suited 100 ns); EOM = electrooptic (different mechanism)",
  },
  {
    id: "B10-linear-ramp-to-STA",
    topic: "linear ramp",
    researchExcerpt:
      `Evaluate a linear ramp adiabatic protocol for ground-state cooling.`,
    planExcerpt:
      `### §E_0 (a): Adiabatic protocol\n` +
      `Question: Shortcut-to-Adiabaticity (STA) achieves the same end-state as a linear ramp but ` +
      `faster, so we will use STA as the analytical object.`,
    substitution: "STA ≠ linear ramp; STA adds counterdiabatic drive, different control profile",
  },
];

// ───────── model setup ─────────
// Two-family validation matches F3 precedent. Empty env LUXAS_VALIDATE_MODELS
// defaults to deepseek-only (Claude OAuth not available from script context).
const MODELS = (process.env.LUXAS_VALIDATE_MODELS ?? "deepseek-v4-pro").split(",")
  .map(k => k.trim())
  .filter(Boolean)
  .map(k => ({ key: k, name: k }));

const VERDICT_INSTRUCTIONS = `
Respond with ONLY a single JSON object on the last line of your output. Format:

{"verdict": "steer" | "continue" | "stop", "flagged_issues": ["<issue 1>", "<issue 2>", ...], "reasoning": "<≤200 char summary of why>"}

Use "steer" if you would recommend the brain revise (e.g. fix the platform-fact claim or fix the methodology compression). Use "continue" if no issue. Use "stop" if the work cannot proceed at all.
`;

async function callModel(
  modelKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ raw: string; parsed: { verdict: string; flagged_issues: string[]; reasoning: string } | null }> {
  const model: any = resolveModel(modelKey);
  const apiKey = await getApiKey(model.provider);
  if (!apiKey) throw new Error(`No API key for provider ${model.provider}`);
  const ctx = {
    systemPrompt,
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: userPrompt }] }],
    tools: [],
  };
  const opts = { apiKey, maxTokens: 2000 };
  const stream: any = await streamSimple(model, ctx as any, opts as any);
  const final: any = await stream.finalResultPromise;
  if (final.stopReason === "error") {
    throw new Error(`stream returned stopReason=error: ${final.errorMessage?.slice(0, 200) ?? "(none)"}`);
  }
  const blocks = Array.isArray(final.content) ? final.content : [];
  const txt = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  // Extract a JSON object containing "verdict" from anywhere in the response
  // (model may put reasoning before/after). Greedy match handles nested-ish content.
  const jsonMatches = [...txt.matchAll(/\{[\s\S]*?"verdict"[\s\S]*?\}/g)];
  let parsed: any = null;
  for (const m of jsonMatches.reverse()) {
    try { parsed = JSON.parse(m[0]); break; } catch {}
  }
  return { raw: txt, parsed };
}

// ───────── A scenario: build prompt + classify ─────────
function buildAPrompt(s: ScenarioA): { sys: string; user: string } {
  const sys =
    `You are reviewer agent applying the <platform_fact_verification> protocol below.\n\n` +
    `<platform_fact_verification>\n${PLATFORM_FACT_BLOCK}\n</platform_fact_verification>\n\n` +
    VERDICT_INSTRUCTIONS;
  const user =
    `## Report excerpt under review\n\n${s.reportExcerpt}\n\n` +
    `## Cited paper local excerpt (data/papers/<key>.txt)\n\n${s.citedPaperExcerpt}\n\n` +
    `Apply the <platform_fact_verification> protocol. Identify any mechanism-claim mismatch ` +
    `between the report and the cited paper. Then output the JSON verdict on the last line.`;
  return { sys, user };
}

function classifyA(parsed: any, scenario: ScenarioA): "caught" | "missed" | "unparseable" {
  if (!parsed) return "unparseable";
  if (parsed.verdict !== "steer") return "missed";
  // Did flagged_issues mention the actual wrong claim (any keyword from wrongClaim)?
  const issues = (parsed.flagged_issues ?? []).join(" ").toLowerCase();
  const reasoning = (parsed.reasoning ?? "").toLowerCase();
  const combined = issues + " " + reasoning;
  // We accept "platform fact" / "mechanism" / "contradict" / specific platform name as catch signals.
  const topicHints = [
    scenario.topic.toLowerCase(),
    "platform",
    "mechanism",
    "contradict",
    "wrong",
    "incorrect",
    "mismatch",
    "actually",
  ];
  const hit = topicHints.some(h => combined.includes(h));
  return hit ? "caught" : "missed";
}

// ───────── B scenario: build prompt + classify ─────────
function buildBPrompt(s: ScenarioB): { sys: string; user: string } {
  const sys =
    `You are reviewer agent applying <plan_review_checklist>. Run all checks; focus item 0b.\n\n` +
    `<plan_review_checklist>\n${PLAN_REVIEW_BLOCK}\n</plan_review_checklist>\n\n` +
    VERDICT_INSTRUCTIONS;
  const user =
    `## RESEARCH.md (verbatim user request)\n\n${s.researchExcerpt}\n\n` +
    `## plan.md sub-question excerpt\n\n${s.planExcerpt}\n\n` +
    `Apply <plan_review_checklist> items 0a and 0b. Especially: is the technique noun preserved ` +
    `as the analytical object (0b), or has the plan substituted a different mechanism / regime ` +
    `while keeping the noun in the title? Output the JSON verdict on the last line.`;
  return { sys, user };
}

function classifyB(parsed: any, _scenario: ScenarioB): "caught" | "missed" | "unparseable" {
  if (!parsed) return "unparseable";
  if (parsed.verdict !== "steer") return "missed";
  const text = ((parsed.flagged_issues ?? []).join(" ") + " " + (parsed.reasoning ?? "")).toLowerCase();
  const hints = [
    "methodology",
    "technique",
    "noun",
    "substitut",
    "compress",
    "0b",
    "regime",
    "analog",
    "different",
  ];
  return hints.some(h => text.includes(h)) ? "caught" : "missed";
}

// ───────── main ─────────
async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "AB";
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 10;

  const logPath = `/tmp/validate_ab_${Date.now()}.jsonl`;
  console.log(`Log: ${logPath}`);

  type Result = {
    check: "A" | "B";
    scenarioId: string;
    model: string;
    outcome: "caught" | "missed" | "unparseable" | "error";
    rawSnippet: string;
    parsed: any;
    elapsed: number;
  };
  const results: Result[] = [];

  const aScenarios = only.includes("A") ? A_SCENARIOS.slice(0, limit) : [];
  const bScenarios = only.includes("B") ? B_SCENARIOS.slice(0, limit) : [];

  for (const s of aScenarios) {
    const { sys, user } = buildAPrompt(s);
    for (const model of MODELS) {
      const t0 = Date.now();
      let outcome: Result["outcome"] = "error";
      let rawSnippet = "";
      let parsed: any = null;
      try {
        const out = await callModel(model.key, sys, user);
        rawSnippet = out.raw.slice(-300);
        parsed = out.parsed;
        outcome = classifyA(parsed, s);
      } catch (e: any) {
        rawSnippet = `ERROR: ${e?.message?.slice(0, 200) ?? String(e)}`;
      }
      const elapsed = Date.now() - t0;
      const r: Result = { check: "A", scenarioId: s.id, model: model.name, outcome, rawSnippet, parsed, elapsed };
      results.push(r);
      appendFileSync(logPath, JSON.stringify(r) + "\n");
      const icon = outcome === "caught" ? "✓" : outcome === "missed" ? "✗" : "?";
      console.log(`  [A ${s.id} / ${model.name}] ${icon} ${outcome} (${elapsed}ms) verdict=${parsed?.verdict ?? "?"}`);
    }
  }

  for (const s of bScenarios) {
    const { sys, user } = buildBPrompt(s);
    for (const model of MODELS) {
      const t0 = Date.now();
      let outcome: Result["outcome"] = "error";
      let rawSnippet = "";
      let parsed: any = null;
      try {
        const out = await callModel(model.key, sys, user);
        rawSnippet = out.raw.slice(-300);
        parsed = out.parsed;
        outcome = classifyB(parsed, s);
      } catch (e: any) {
        rawSnippet = `ERROR: ${e?.message?.slice(0, 200) ?? String(e)}`;
      }
      const elapsed = Date.now() - t0;
      const r: Result = { check: "B", scenarioId: s.id, model: model.name, outcome, rawSnippet, parsed, elapsed };
      results.push(r);
      appendFileSync(logPath, JSON.stringify(r) + "\n");
      const icon = outcome === "caught" ? "✓" : outcome === "missed" ? "✗" : "?";
      console.log(`  [B ${s.id} / ${model.name}] ${icon} ${outcome} (${elapsed}ms) verdict=${parsed?.verdict ?? "?"}`);
    }
  }

  // Aggregate
  console.log("\n=== Aggregate ===");
  for (const check of ["A", "B"] as const) {
    for (const model of MODELS) {
      const subset = results.filter(r => r.check === check && r.model === model.name);
      if (subset.length === 0) continue;
      const caught = subset.filter(r => r.outcome === "caught").length;
      const missed = subset.filter(r => r.outcome === "missed").length;
      const unparseable = subset.filter(r => r.outcome === "unparseable").length;
      const errored = subset.filter(r => r.outcome === "error").length;
      console.log(`  [${check} / ${model.name}] caught=${caught}/${subset.length}  missed=${missed}  unparseable=${unparseable}  error=${errored}`);
    }
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
