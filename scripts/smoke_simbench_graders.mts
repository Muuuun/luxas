#!/usr/bin/env tsx
/**
 * smoke_simbench_graders — a grader is only an instrument once it has been seen to fail.
 *
 * simbench/ scores an arm by re-opening the file it saved. If a grader passes a
 * wrong part, every number in the ledger built on it is noise, and nothing
 * downstream can tell. So each task ships `reference.py`, which builds the
 * known-good artifact and a set of planted faults — every one of them a file
 * that opens and satisfies the request "in letter". This gate builds them all
 * and holds the grader to an exact answer: the reference passes every check,
 * and each fault fails precisely the checks listed for it, no more, no fewer.
 * "No more" matters as much as "no fewer": a 1 mm bolt-circle error must NOT
 * trip the volume check, or the claim that volume cannot see it is untested.
 *
 * Runs through scoreBench, so the ORACLE.md → bench_score → grader path is the
 * one exercised. Needs Blender (run-gates skips it, visibly, where there is
 * none); what does not need Blender is in smoke_sim_wiring.mts.
 *
 *   npx tsx scripts/smoke_simbench_graders.mts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBench } from "./bench_score.mts";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const SIM = join(fileURLToPath(new URL("..", import.meta.url)), "simbench");
const BLENDER = process.env.LUXAS_BLENDER_BIN || "blender";
const tmp = mkdtempSync(join(tmpdir(), "luxas-simbench-"));

/** fault → a distinguishing fragment of each sub-check label that must fail. Anything else must pass. */
const CASES: Record<string, Record<string, string[]>> = {
  "blender-01-flange": {
    bolt_circle_58: ["four 8 mm bolt holes"],
    holes_rotated_45: ["four 8 mm bolt holes"],
    no_bolt_holes: ["volume within 1%", "four 8 mm bolt holes"],
    bore_blind: ["volume within 1%", "bore is 20 mm wide"],
    open_mesh: ["watertight"],
  },
  "blender-02-lit-scene": {
    material_unused_slot: ["ball renders red"],
    viewport_color_only: ["box renders blue"],
    camera_misses_box: ["active camera frames both"],
    occluded: ["unobstructed from the camera"],
    no_light: ["scene's own lighting", "render.png exists and is not blank"],
  },
  "blender-03-edit-scene": {
    shared_mesh_material: ["six other parts are unchanged"],
    yellow_in_unused_slot: ["plate_03 faces use"],
    moved_wrong_bolt: ["bolt_02 origin", "six other parts are unchanged"],
    collateral_delete: ["six other parts are unchanged"],
    modifiers_dropped: ["plate_03 faces use", "six other parts are unchanged"],
  },
  "blender-04-dominoes": {
    weak_trigger: ["all ten dominoes are toppled"],
    no_trigger: ["all ten dominoes are toppled"],
    no_ground_body: ["passive rigid body", "frame 12", "all ten dominoes are toppled", "nothing fell through"],
    passive_dominoes: ["passive rigid body", "all ten dominoes are toppled"],
    spacing_too_wide: ["stand upright on the ground", "all ten dominoes are toppled"],
    keyframed_fake: ["passive rigid body"],
  },
  "blender-05-gear-pair": {
    tooth_on_tooth: ["saved pose", "driven at 18:30"],
    center_49: ["axes at (0, 0) and (48, 0)", "full-depth teeth of module 2", "driven at 18:30", "backlash at the pitch circle"],
    straight_flanks: ["saved pose", "driven at 18:30"],
    gear_29_teeth: ["full-depth teeth of module 2", "driven at 18:30", "backlash at the pitch circle"],
    wide_backlash: ["backlash at the pitch circle"],
    no_bores: ["axes at (0, 0) and (48, 0)"],
    open_mesh: ["both are watertight", "saved pose", "driven at 18:30", "backlash at the pitch circle"],
  },
  "blender-06-drawing-to-part": {
    pocket_through: ["pocket 20 x 10"],
    no_counterbore: ["counterbored 30 mm"],
    step_at_left: ["overlap (IoU)", "stepped down to 35", "counterbored 30 mm"],
    rib_rectangular: ["rib: triangular"],
    boss_missing: ["through a 20 mm boss"],
    mirrored_x: ["overlap (IoU)", "notch in the front edge", "through a 20 mm boss", "pocket 20 x 10", "stepped down to 35", "counterbored 30 mm"],
    open_mesh: ["watertight"],
  },
  "blender-07-achromat": {
    efl_103: ["effective focal length"],
    colour_uncorrected: ["axial colour"],
    plano_back: ["spherical aberration"],
    crown_8mm: ["centre thicknesses 6 and 2.5 mm"],
    rippled_surface: ["vertices within 2 um of a sphere"],
    air_gap: ["cemented", "spherical aberration"],
    open_mesh: ["both are watertight"],
  },
};

/**
 * bench → planted artifacts that open and show no work. A fault is wrong work and
 * fails the checks named for it; a control is no work and must score 0 — on
 * 2026-10-09 an untouched copy of blender-03's input scored 3/6.
 */
const CONTROLS: Record<string, string[]> = {
  "blender-03-edit-scene": ["unchanged_copy"],
};

function build(bench: string, fault: string): { dir: string; ok: boolean; err: string } {
  const dir = join(tmp, `${bench}-${fault || "reference"}`);
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(BLENDER, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", join(SIM, bench, "reference.py"), "--", dir, ...(fault ? [fault] : [])],
    { encoding: "utf-8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
  return { dir, ok: r.status === 0, err: r.error ? String(r.error) : (r.stderr ?? "").trim().split("\n").slice(-3).join(" | ") };
}

for (const [bench, faults] of Object.entries(CASES)) {
  console.log(bench);
  const ref = build(bench, "");
  check("reference builds", ref.ok, ref.err);
  const rs = scoreBench(ref.dir, join(SIM, bench));
  const refFailed = (rs.oracle?.checks ?? []).filter((c) => !c.pass);
  check(`reference passes all ${rs.oracle?.total} checks`, !!rs.oracle && rs.oracle.total >= 5 && refFailed.length === 0, refFailed.map((c) => `${c.label} [${c.detail}]`).join("; "));
  const lying = (rs.oracle?.checks ?? []).filter((c) => c.pass && /missing or unreadable|no artifact|still present/.test(c.detail));
  check("reference: no passing check carries a failure message", lying.length === 0, lying.map((c) => `${c.label} [${c.detail}]`).join("; "));

  for (const [fault, mustFail] of Object.entries(faults)) {
    const b = build(bench, fault);
    if (!b.ok) { check(`${fault}: builds`, false, b.err); continue; }
    const s = scoreBench(b.dir, join(SIM, bench));
    const checks = s.oracle?.checks ?? [];
    check(`${fault}: the file opens (built, and wrong)`, checks[0]?.pass === true, checks[0]?.detail);
    const failed = checks.filter((c) => !c.pass).map((c) => c.label);
    const want = mustFail.map((frag) => checks.find((c) => c.label.includes(frag))?.label ?? `<no check matching "${frag}">`);
    const missed = want.filter((l) => !failed.includes(l));
    const extra = failed.filter((l) => !want.includes(l));
    check(`${fault}: fails exactly ${mustFail.length} check${mustFail.length === 1 ? "" : "s"} (${mustFail.join("; ")})`, missed.length === 0 && extra.length === 0,
      [missed.length ? `passed but should fail: ${missed.join(" | ")}` : "", extra.length ? `failed but should pass: ${extra.join(" | ")}` : ""].filter(Boolean).join(" — "));
  }

  for (const control of CONTROLS[bench] ?? []) {
    const b = build(bench, control);
    if (!b.ok) { check(`${control}: builds`, false, b.err); continue; }
    const s = scoreBench(b.dir, join(SIM, bench));
    const got = (s.oracle?.checks ?? []).filter((c) => c.pass).map((c) => c.label);
    check(`${control}: scores 0/${s.oracle?.total} (no work is not partial credit)`, !!s.oracle && s.oracle.total >= 5 && got.length === 0, `passed: ${got.join(" | ")}`);
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nsmoke_simbench_graders: all checks passed" : `\nsmoke_simbench_graders: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
