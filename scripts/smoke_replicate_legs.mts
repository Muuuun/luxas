/**
 * smoke_replicate_legs — v3 D2: a computing replication on an assigned route
 * that differs from the producer's is an independent leg (converging without
 * an INDEPENDENT line); two replications on one route are one leg (wiring);
 * same model + same route is wiring; a replication with no route/script is
 * not a leg; replications count as "later" for supersession. §C12: a
 * replication/results.json written by an estimate-mode replicator is not a leg.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaimTable, relation } from "../src/claims-table.ts";
import { Session } from "../src/session.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
delete process.env.LUXAS_REPLICATE_LEGS;
function project(reps: Array<{ exp: string; value: number; sigma: number; route?: string; script?: string; model?: string; own?: number }>): string {
  const dir = mkdtempSync(join(tmpdir(), "rep-legs-"));
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes", "frame.md"), "# F\n\n## Headline quantities\n- `zero_angle`\n");
  for (const r of reps) {
    const base = join(dir, "data", "experiments", r.exp);
    mkdirSync(join(base, "runs", "run_1"), { recursive: true });
    if (r.own !== undefined) writeFileSync(join(base, "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [{ id: "zero_angle", key: "computed.zero_angle", headline: true, observable: "angle at which the total C6 crosses zero, degrees, Rb 60P3/2 stretched pair", uncertainty: r.sigma, inputs: {} }], zero_angle: r.own } }));
    else writeFileSync(join(base, "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [], dummy: 1 } }));
    if (r.route !== undefined || r.script !== undefined) {
      mkdirSync(join(base, "replication"), { recursive: true });
      writeFileSync(join(base, "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: r.value, sigma: r.sigma, route: r.route, script: r.script, model: r.model, inputs: {} }));
    }
  }
  return dir;
}
const row = (dir: string) => buildClaimTable(dir).rows.find((r) => r.id === "zero_angle")!;

// producer alone
let r = row(project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35 }]));
check("producer alone → indicative", r.status === "indicative");
// + one computing replication on a different route → converging (no INDEPENDENT line needed)
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root fit", script: "replication/fit.py" }]));
check("computing replication, route unset on producer → still a leg (routes differ by default)", r.status === "converging", r.status + " :: " + r.reasons.join(" | "));
// producer with a route equal to the replication's → wiring, not a leg
r = row(project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35, route: "full diagonalization", script: "replication/diag.py" }]));
const dirSame = project([{ exp: "E3_a", own: 24.65, value: 0, sigma: 0.35 }]);
writeFileSync(join(dirSame, "data", "experiments", "E3_a", "runs", "run_1", "results.json"), JSON.stringify({ computed: { quantities: [{ id: "zero_angle", key: "computed.zero_angle", headline: true, observable: "angle at which the total C6 crosses zero, degrees", uncertainty: 0.35, inputs: {} }], zero_angle: 24.65, cross_validation: [{ claim_key: "computed.zero_angle", method_a: "full pair-Hamiltonian diagonalization", method_b: "second-order channel sum", value_a: 24.65, value_b: 24.0, tolerance_rel: 0.1 }] } }));
mkdirSync(join(dirSame, "data", "experiments", "E3_a", "replication"), { recursive: true });
writeFileSync(join(dirSame, "data", "experiments", "E3_a", "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: 24.6, sigma: 0.3, route: "full diagonalization of the pair Hamiltonian", script: "replication/diag.py", inputs: {} }));
const rs = row(dirSame);
check("replication on the PRODUCER's route → wiring, not a second leg", rs.reasons.some((x) => /wiring: .*replication|wiring: E3_a:replication|wiring:.*E3_a:computed.*E3_a:replication/.test(x)) || !rs.reasons.some((x) => /agree: E3_a:computed[^|]*E3_a:replication/.test(x)), rs.reasons.join(" | "));
// no script → not a computing leg
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "napkin two-channel model" }]));
check("replication without a script is not a leg (unattested)", r.status === "indicative" && r.reasons.some((x) => /unattested/.test(x)), r.status + " :: " + r.reasons.join(" | "));
// relation(): same model + same route = wiring
const a = { quantity: "q", value: 24.5, sigma: 0.2, kind: "replication", source: "E4:replication", experiment: "E4", route: "three-channel fit", model: "m1", job: "replication/a.py" } as any;
const b = { ...a, value: 24.6, source: "E5:replication", experiment: "E5", job: "replication/b.py" };
check("two replications on the same route are wiring", relation(a, b).rel === "wiring");
check("different routes, different values → comparable", relation(a, { ...b, route: "full diagonalization" }).rel === "comparable");
// supersession with a replication as a later leg: E3 stale 22.909±0.01; E4 own 24.65±0.35; E4 replication (different route) 24.5±0.2
const dirSup = project([{ exp: "E3_a", own: 22.909, value: 0, sigma: 0.01 }, { exp: "E4_b", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root", script: "replication/fit.py" }]);
writeFileSync(join(dirSup, "data", "experiments", "E4_b", "replication", "results.json"), JSON.stringify({ quantity: "zero_angle", value: 24.5, sigma: 0.2, route: "three-channel quadratic root", script: "replication/fit.py", inputs: {} }));
const rsup = row(dirSup);
check("E3's stale value superseded by E4 own + E4's replication (different route)", rsup.reasons.some((x) => /superseded: E3/.test(x)) && rsup.status !== "disputed", rsup.status + " :: " + rsup.reasons.join(" | "));
process.env.LUXAS_REPLICATE_LEGS = "0";
r = row(project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root fit", script: "replication/fit.py" }]));
check("LUXAS_REPLICATE_LEGS=0 → replications attest nothing", r.status === "indicative");
delete process.env.LUXAS_REPLICATE_LEGS;

// §C12: an estimate-mode replicator wrote replication/results.json (Dy E2–E4:
// the write scope allowed it) — that file is the blind estimate, not a second
// leg. Transcript heads are written here because .agent/ is gitignored.
console.log("\n§C12 estimate-mode replicator output is never a replication leg");
const fg = (eid: string | undefined, q: string | undefined, mode: string | undefined) =>
  JSON.stringify({ type: "spawn_init", agent: "replicator", task: "Blind order-of-magnitude estimate of ONE quantity.\n\nQUANTITY_ID: zero_angle", parentAgentId: "brain", templateVars: { PROJECT_DIR: "/p", ...(eid ? { EXPERIMENT_ID: eid } : {}), ...(q ? { QUANTITY_ID: q } : {}), ...(mode ? { MODE: mode } : {}) }, timestamp: 1 }) + "\n"
  + JSON.stringify({ role: "user", content: [{ type: "text", text: "Blind order-of-magnitude estimate" }] }) + "\n";
const bg = (eid: string, q: string, mode: string) =>
  JSON.stringify({ type: "session", version: 1, id: "x" }) + "\n"
  + JSON.stringify({ type: "message", message: { role: "system", content: `You estimate ONE quantity blind.\n<environment>\n<experiment_id>${eid}</experiment_id>\n<quantity_id>${q}</quantity_id>\n<mode>${mode}</mode>\n</environment>` } }) + "\n";
function c12(transcripts: Record<string, string> | null, headerOnly: string[] = []) {
  const dir = project([{ exp: "E3_a", own: 24.65, value: 24.5, sigma: 0.35, route: "three-channel quadratic root fit", script: "replication/fit.py" }]);
  if (transcripts) {
    const conv = join(dir, ".agent", "conversations");
    mkdirSync(conv, { recursive: true });
    for (const [name, body] of Object.entries(transcripts)) writeFileSync(join(conv, name), body);
    // What subagent-runner leaves on disk from its start until the first turn_end.
    for (const name of headerOnly) Session.open(join(conv, name), dir);
  }
  const x = row(dir);
  return { ...x, legs: x.estimates.filter((e) => e.kind === "replication").length, say: `${x.status} (${x.estimates.filter((e) => e.kind === "replication").length} repl) :: ${x.reasons.join(" | ")}` };
}
const EST = { "review_experiment.E3_a.blind-estimate-zero_angle.replicator-abc123.jsonl": fg("E3_a", "zero_angle", "estimate") };
let c = c12(EST);
check("C12: estimate-only transcript → the replication file is not a leg", c.legs === 0 && c.status === "indicative", c.say);
check("C12: the row says the blind estimator wrote it", c.reasons.some((x) => /^E3: replication\/results\.json written by the blind estimator — not a second leg$/.test(x)), c.say);
c = c12({ "brain.experiment-x.blind-estimate-zero_angle.replicator-q9.jsonl": fg("E3_a", "zero_angle", undefined) });
check("C12: '.blind-estimate-' in the filename marks estimate mode without MODE", c.legs === 0 && c.status === "indicative", c.say);
c = c12({ "brain.replicator-bg-4.jsonl": bg("E3_a", "zero_angle", "estimate") });
check("C12: background transcript with <mode>estimate</mode> → not a leg", c.legs === 0 && c.status === "indicative", c.say);
c = c12({ ...EST, "brain.replicator-q1w2e3.jsonl": fg("E3_a", "zero_angle", "replicate") });
check("C12: + foreground spawn_init MODE=replicate transcript → converging", c.status === "converging" && c.legs === 1, c.say);
c = c12({ ...EST, "brain.replicator-bg-2.jsonl": bg("E3_a", "zero_angle", "replicate") });
check("C12: + background <mode>replicate</mode> transcript → converging", c.status === "converging" && c.legs === 1, c.say);
c = c12({ ...EST, "brain.replicator-bg-3.jsonl": bg("{{EXPERIMENT_ID}}", "{{QUANTITY_ID}}", "{{MODE}}") });
check("C12: unrendered / missing MODE, EID, Q → replicate mode, wildcard → converging", c.status === "converging" && c.legs === 1, c.say);
c = c12({ ...EST, "brain.replicator-r7.jsonl": fg(undefined, "zero_angle", "replicate") });
check("C12: replicate transcript with no EXPERIMENT_ID matches every dir → converging", c.status === "converging" && c.legs === 1, c.say);
c = c12({ ...EST, "brain.replicator-r8.jsonl": fg("E3_a", "other_q", "replicate") });
check("C12: a replicate transcript for another quantity does not rescue this one", c.legs === 0 && c.status === "indicative", c.say);
c = c12({ "review_experiment.E4_b.blind-estimate-zero_angle.replicator-x1.jsonl": fg("E4_b", "zero_angle", "estimate") });
check("C12: an estimate transcript in a different experiment dir → converging", c.status === "converging" && c.legs === 1, c.say);
c = c12({ "brain.replicator-bg-1.reader-z.jsonl": fg("E3_a", "zero_angle", "estimate"), "brain.experiment-y.jsonl": fg("E3_a", "zero_angle", "estimate") });
check("C12: only replicator transcripts are read", c.status === "converging" && c.legs === 1, c.say);
c = c12({});
check("C12: empty conversations dir → unchanged (converging)", c.status === "converging" && c.legs === 1, c.say);
// F1: a background replicator's transcript is the Session header alone until
// its first turn_end (Dy bg-2: 99 s), and for good if the runner is killed in
// that turn. It names no mode and no ids, so it must not rescue the
// estimator's leg (Dy init_error: indicative → false converging).
const blindReason = (x: { reasons: string[] }) => x.reasons.some((s) => /^E3: replication\/results\.json written by the blind estimator — not a second leg$/.test(s));
c = c12(EST, ["brain.replicator-bg-9.jsonl"]);
check("F1: + header-only background transcript → still not a leg", c.legs === 0 && c.status === "indicative" && blindReason(c), c.say);
c = c12({ ...EST, "brain.replicator-bg-5.jsonl": "" });
check("F1: + empty replicator transcript → still not a leg", c.legs === 0 && c.status === "indicative" && blindReason(c), c.say);
c = c12({}, ["brain.replicator-bg-9.jsonl"]);
check("F1: a header-only transcript alone marks nothing as estimated (converging)", c.status === "converging" && c.legs === 1, c.say);
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — computing replications on assigned routes settle rows; same route is one leg.");
