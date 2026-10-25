#!/usr/bin/env tsx
/**
 * Verifier seat (replicator check mode), offline.
 *
 * The seat is the one thing the verifier bench measured that the review loop
 * did not have: for each headline conclusion, run a computation that could
 * refute it (A2 2026-10-20: the bare "recompute it yourself, re-run the shipped
 * code" audit caught both consistent-but-wrong faults; blind estimates and
 * three readers caught neither). Here it is a third replicator mode, run on a
 * clone of the project before each experiment_reviewer round in place of the
 * estimate-mode replicators, writing replication/<id>/results.json files the
 * claim table already reads and RECOMPUTED / RERUN / CONTROL lines the
 * reviewer and the review file carry.
 *
 * Sections: A mode switch · B line parser · C task text · D obligation block ·
 * E persisted review · F registry (prompt render + safety) · G clone ·
 * H harvest · I the loop under LUXAS_VERIFY_SEAT=check (stub spawn, pi engine)
 * · J claim table counts a seat leg · K claude-code engine with a fake `claude`
 * · L review_experiment / verify_experiment argument handling.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
const restoreEnv = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

// Nothing below may spend: no estimate, no images, no artifacts block.
setEnv("LUXAS_REVIEW_IMAGES", "0"); setEnv("LUXAS_REVIEW_ARTIFACTS", "0"); setEnv("LUXAS_SWEEP_MODE", undefined);
setEnv("LUXAS_VERIFY_SEAT", undefined); setEnv("LUXAS_BLIND_ESTIMATE", undefined); setEnv("LUXAS_SEAT_ENGINE", undefined); setEnv("LUXAS_CHECK_MODEL", undefined);

const VS = await import("../src/verifier-seat.ts");
const R = await import("../src/claims-review.ts");
const REG = await import("../src/agents/registry.ts");
const { expandTemplate } = await import("../src/utils.ts");
const { buildClaimTable } = await import("../src/claims-table.ts");
const { runExperimentReviewLoop } = await import("../src/tools/spawn-agent.ts");

const EID = "E1_probe";
const tmp = mkdtempSync(join(tmpdir(), "luxas-seat-gate-"));

/** A small project: one experiment, two headline ids (a number and an object), a script, an L2 section with a causal sentence. */
function project(name: string): string {
  const p = join(tmp, name);
  mkdirSync(join(p, "notes"), { recursive: true });
  mkdirSync(join(p, ".agent", "conversations"), { recursive: true });
  const exp = join(p, "data", "experiments", EID);
  mkdirSync(join(exp, "runs", "run_1"), { recursive: true });
  mkdirSync(join(exp, "scripts"), { recursive: true });
  writeFileSync(join(p, "RESEARCH.md"), "# probe\n");
  writeFileSync(join(p, ".agent", "log.jsonl"), "{\"type\":\"live\"}\n");
  writeFileSync(join(p, "notes", "experiments.md"), `## L2.1 — probe (E_1)\n\n**Acceptance criterion (frozen at Phase 1) + Verdict**: kappa < 1e-6 → confirmed\n\n### Headline findings\n- kappa = 3.2e-7 Hz/(W/cm²); the residual is set by the tensor term.\n- The T2* floor comes from the 1 kHz noise channel.\n`);
  writeFileSync(join(exp, "scripts", "build.py"), "print(3.2e-7)\n");
  writeFileSync(join(exp, "runs", "run_1", "results.json"), JSON.stringify({
    computed: {
      kappa: 3.2e-7, T2star: { clock: 139.8, field: 274.7 },
      quantities: [
        { id: "kappa", key: "computed.kappa", headline: true, observable: "differential light shift coefficient, Hz/(W/cm^2)", uncertainty: 2e-8, uncertainty_source: "spread", inputs: { alpha_s_au: 184.4 } },
        { id: "T2star_clock", key: "computed.T2star", headline: true, observable: "clock T2*, s", uncertainty: 0 },
      ],
    },
  }, null, 2));
  return p;
}

// ── A. the mode switch ───────────────────────────────────────────────────────
console.log("\nA. seat mode: unset = estimate (today's behaviour); check opts in; LUXAS_BLIND_ESTIMATE=0 is the one master off switch");
{
  const m = (env: Record<string, string | undefined>) => VS.seatMode({ ...env } as any);
  check("A unset → estimate", m({}) === "estimate");
  check("A LUXAS_VERIFY_SEAT=check → check", m({ LUXAS_VERIFY_SEAT: "check" }) === "check");
  check("A LUXAS_VERIFY_SEAT=estimate → estimate", m({ LUXAS_VERIFY_SEAT: "estimate" }) === "estimate");
  check("A LUXAS_VERIFY_SEAT=0 / none / off → off", ["0", "none", "off"].every((v) => m({ LUXAS_VERIFY_SEAT: v }) === "off"));
  check("A LUXAS_BLIND_ESTIMATE=0 switches the check seat off too (review_experiment --no-blind means nothing paid)", m({ LUXAS_VERIFY_SEAT: "check", LUXAS_BLIND_ESTIMATE: "0" }) === "off");
  check("A engine defaults to pi; claude-code opts in; anything else is pi", VS.seatEngine({} as any) === "pi" && VS.seatEngine({ LUXAS_SEAT_ENGINE: "claude-code" } as any) === "claude-code" && VS.seatEngine({ LUXAS_SEAT_ENGINE: "x" } as any) === "pi");
  check("A the check model is the measured one unless LUXAS_CHECK_MODEL says otherwise", VS.checkModel({} as any) === "claude-opus-5-5" && VS.checkModel({ LUXAS_CHECK_MODEL: "claude-opus-4-6" } as any) === "claude-opus-4-6");
}

// ── B. the line parser ───────────────────────────────────────────────────────
console.log("\nB. RECOMPUTED / RERUN / CONTROL lines are read with list markers, bold and backticks stripped; ESTIMATE lines are not seat lines");
{
  const text = [
    "Some prose first.",
    "ESTIMATE(blind): kappa — 3e-7 ± 1e-7 via napkin — inputs: [alpha_s_au=184.4]",
    "- RECOMPUTED: kappa — 3.19e-7 ± 0.1e-7 via second-order perturbation, own code — inputs: [alpha_s_au=184.4]",
    "**RERUN: kappa — code gives 3.2e-7; results.json says 3.2e-7; agree — scripts/build.py**",
    "`RERUN: T2star_clock — code gives 281.9; results.json says 139.8; differ — scripts/coherence.py`",
    "CONTROL: noise-floor — claim: \"the T2* floor comes from the 1 kHz noise channel\" — toggled noise=0: T2* unchanged at 139.8 s; refutes",
    "RECOMPUTED: kappa — 3.19e-7 ± 0.1e-7 via second-order perturbation, own code — inputs: [alpha_s_au=184.4]",
    "RERUN kappa — no colon, not a line",
  ].join("\n");
  const lines = VS.extractSeatLines(text);
  check("B five seat lines, the duplicate once", lines.length === 4, JSON.stringify(lines.map((l: any) => l.kind)));
  check("B kinds and ids", lines.map((l: any) => `${l.kind}:${l.quantity}`).join(",") === "RECOMPUTED:kappa,RERUN:kappa,RERUN:T2star_clock,CONTROL:noise-floor", lines.map((l: any) => `${l.kind}:${l.quantity}`).join(","));
  check("B markers stripped, text starts at the prefix", lines.every((l: any) => /^(RECOMPUTED|RERUN|CONTROL): /.test(l.text)) && !lines.some((l: any) => /\*\*|`/.test(l.text)), lines.map((l: any) => l.text).join(" | "));
  check("B the ESTIMATE line is not a seat line", !lines.some((l: any) => /ESTIMATE/.test(l.text)));
  const s = VS.seatLinesSummary(lines);
  check("B the summary counts recomputed / rerun agree+differ / control supports+refutes", /1 recomputed/.test(s) && /2 rerun \(1 agree, 1 differ\)/.test(s) && /1 control \(0 support, 1 refute\)/.test(s), s);
  check("B verdict helper: a differ or a refute is a break", VS.seatBreaks(lines).length === 2 && VS.seatBreaks(lines.filter((l: any) => l.quantity === "kappa")).length === 0);
}

// ── C. the task text ─────────────────────────────────────────────────────────
console.log("\nC. the task names ids, observables and input VALUES, never the producer's value; phases in order; out-of-scope ids get a RERUN; later rounds carry the reviewer's discriminators");
{
  const p = project("c");
  const table = buildClaimTable(p);
  const decls = R.headlineDeclsFor(table, EID);
  const out = R.headlineDeclsOutOfScope(table, EID);
  check("C fixture: kappa in scope, T2star_clock out of scope (an object)", decls.map((d: any) => d.id).join() === "kappa" && out.map((o: any) => o.id).join() === "T2star_clock", `${decls.map((d: any) => d.id)} / ${out.map((o: any) => o.id)}`);
  const t1 = VS.checkSeatTask({ experimentId: EID, decls, outOfScope: out, round: 1 });
  check("C names the id, observable and inputs", /kappa/.test(t1) && /differential light shift coefficient/.test(t1) && /alpha_s_au=184.4/.test(t1));
  check("C never carries the producer's number", !/3\.2e-7/.test(t1) && !/139\.8/.test(t1));
  check("C blind recompute comes before opening scripts/, runs/, tests/ or the L2 section", t1.indexOf("BEFORE") > 0 && t1.indexOf("BEFORE") < t1.indexOf("re-run the shipped code"), t1.slice(0, 300));
  check("C the out-of-scope headline id is listed for a RERUN with its key and why", /T2star_clock — key computed\.T2star \(no single numeric value\)/.test(t1));
  check("C …and a RECOMPUTED is OWED for each ledger-quoted scalar inside it, derived before the code is opened (C1-fix: a2-01's 2π sat inside an object-valued id and the seat took the shipped code's number)", /RECOMPUTED line is OWED for each \(tag it <id>\/<scalar>\)/.test(t1) && /a re-run of the shipped code is not a recomputation/.test(t1));
  check("C names the write location the definition allows", t1.includes(`data/experiments/${EID}/replication/<id>/results.json`));
  check("C states the three line formats", /^RECOMPUTED: <id>/m.test(t1) && /^RERUN: <id>/m.test(t1) && /^CONTROL: <tag>/m.test(t1));
  check("C round 1 has no discriminator section", !/DISCRIMINATOR lines from round/.test(t1) && /\(4\) none this round/.test(t1));
  const t2 = VS.checkSeatTask({ experimentId: EID, decls, outOfScope: out, round: 2, priorDiscriminators: ["DISCRIMINATOR: kappa — if right: scales as alpha^1; if wrong: flat; computation: sweep alpha"] });
  check("C round 2 carries the round-1 DISCRIMINATOR lines, tagged D1, to execute as CONTROL lines", /DISCRIMINATOR lines from round 1/.test(t2) && /^D1: DISCRIMINATOR: kappa/m.test(t2) && /CONTROL: D<n>/.test(t2), t2.slice(-600));
  check("C the budget and the background rule are stated", /20 minutes/.test(t1) && /3 minutes/.test(t1));
  check("C ledger-quoted numbers no declared id covers are owed a RERUN too (C1-fix: item-03's planted T1 lived only in results.json and the ledger)", /every OTHER number the L2 section's Headline findings quote that no listed id covers/.test(t1) && /no script produces it/.test(t1));
}

// ── D. the reviewer's obligation block ───────────────────────────────────────
console.log("\nD. the obligation block carries seat lines; without them it is byte-identical to before");
{
  const ids = ["kappa"], blind = ["ESTIMATE(blind): kappa — 3e-7 ± 1e-7 via napkin — inputs: [alpha_s_au=184.4]"];
  const before = R.reviewerObligationBlock(ids, blind, []);
  check("D no seat lines → the block is what it was (3-arg call equals the 4-arg call with [])", R.reviewerObligationBlock(ids, blind, [], []) === before && R.reviewerObligationBlock(ids, blind) === before);
  const seat = ["RERUN: kappa — code gives 3.2e-7; results.json says 3.2e-7; agree — scripts/build.py", "CONTROL: noise-floor — claim: \"x\" — toggled y: z; refutes"];
  const blk = R.reviewerObligationBlock(ids, blind, [], seat);
  check("D with seat lines → a section that says they were EXECUTED, lists them, and explains differ / refutes as Issues", /EXECUTED/.test(blk) && seat.every((l) => blk.includes(l)) && /differ/.test(blk) && /refutes/.test(blk) && blk.trim().endsWith("</claim_obligation>"), blk.slice(-700));
  check("D the blind lines are still there too", blk.includes(blind[0]));
  const only = R.reviewerObligationBlock([], [], [], seat);
  check("D nothing in scope but seat lines present → the block still carries them", only !== "" && seat.every((l) => only.includes(l)) && !/For EACH/.test(only), only);
  check("D nothing at all → empty string, as before", R.reviewerObligationBlock([], [], [], []) === "");
}

// ── E. the persisted review ──────────────────────────────────────────────────
console.log("\nE. the review file carries a seat section above the marker; without seat lines it is byte-identical; nothing downstream misreads the lines");
{
  const p = project("e");
  const rl = R.extractReviewerLines("DISCRIMINATOR: kappa — if right: a; if wrong: b; computation: c\nSCALING: kappa — expected 1 in alpha; observed not swept\nVERDICT: revise\nFEEDBACK:\n- Issue 1: kappa is not what the shipped script produces (3.2e-7 reported, 3.9e-7 computed) — fix results.json.");
  const fb = "- Issue 1: kappa is not what the shipped script produces (3.2e-7 reported, 3.9e-7 computed) — fix results.json.";
  const seat = ["RECOMPUTED: kappa — 3.19e-7 ± 0.1e-7 via own route — inputs: [alpha_s_au=184.4]", "RERUN: kappa — code gives 3.9e-7; results.json says 3.2e-7; differ — scripts/build.py"];
  const a = R.persistReview(p, EID, 1, [], rl, "VERDICT: revise", [], fb, []);
  const noSeat = readFileSync(a, "utf-8");
  const b = R.persistReview(p, EID, 1, [], rl, "VERDICT: revise", [], fb, [], []);
  check("E an empty seat list writes the same file", readFileSync(b, "utf-8") === noSeat);
  const c = R.persistReview(p, EID, 1, [], rl, "VERDICT: revise", [], fb, [], seat);
  const withSeat = readFileSync(c, "utf-8");
  check("E the seat section is present, above REVIEW-COMPLETE and above FEEDBACK:", /Verifier seat \(check mode/.test(withSeat) && withSeat.indexOf("RERUN: kappa") < withSeat.indexOf("REVIEW-COMPLETE") && withSeat.indexOf("REVIEW-COMPLETE") < withSeat.indexOf("FEEDBACK:"), withSeat);
  check("E the seat lines are in the file", seat.every((l) => withSeat.includes(l)));
  check("E priorBlindLines still reads none from it (a RECOMPUTED line is not an ESTIMATE(blind) line)", R.priorBlindLines(p, EID).length === 0);
  const findings = R.openReviewFindings(p);
  const f = [...findings.values()][0];
  check("E openReviewFindings still binds Issue 1 to the FEEDBACK block, not to a seat line", !!f && /not what the shipped script produces/.test(f.sentence), f?.sentence);
  const table = buildClaimTable(p);
  const row = table.rows.find((r: any) => r.id === "kappa");
  check("E the claim table reads no estimate from the seat section (the file under replication/ is the table's input, the lines are the reviewer's)", !!row && !row.estimates.some((e: any) => /review/.test(e.source) && e.kind !== "own"), JSON.stringify(row?.estimates.map((e: any) => `${e.kind}:${e.source}`)));
}

// ── F. registry: prompt render and safety ────────────────────────────────────
console.log("\nF. check mode renders the environment block and <check_mode> only; estimate and replicate renders lose the check block and nothing else; the check definition can read the producer's code and write only replication/");
{
  const rep = REG.getDefinition("replicator");
  const base = { PROJECT_DIR: "/clone", EXPERIMENT_ID: EID, QUANTITY_ID: "kappa, T2star_clock" };
  const chk = REG.resolvePrompt(rep, { ...base, MODE: "check" });
  check("F check render starts with <environment> and holds <check_mode>", chk.startsWith("<environment>") && chk.includes("<check_mode>") && chk.trimEnd().endsWith("</check_mode>"), chk.slice(0, 200));
  check("F check render has no estimate, replicate or hard_rules block and no blind intro", !/<estimate_mode>|<replicate_mode>|<hard_rules>|You estimate ONE quantity blind/.test(chk));
  check("F check render has no '{{' and shows mode check and the clone as working directory", !chk.includes("{{") && chk.includes("<mode>check</mode>") && chk.includes("<working_directory>/clone</working_directory>"));
  check("F check render orders the phases: blind recompute, re-run as shipped, controls, discriminators; names the three line prefixes", chk.indexOf("BEFORE") < chk.indexOf("Re-run the shipped code") && /RECOMPUTED: <id>/.test(chk) && /RERUN: <id>/.test(chk) && /CONTROL: <tag>/.test(chk));
  const est = REG.resolvePrompt(rep, { ...base, MODE: "estimate" });
  check("F estimate render has no <check_mode> and keeps its blocks and layout", !est.includes("<check_mode>") && est.includes("<estimate_mode>") && est.includes("</estimate_mode>\n\n<hard_rules>") && !est.includes("<replicate_mode>"));
  const CHECK_RE = /\n*<check_mode>[\s\S]*?<\/check_mode>/;
  for (const [label, vars] of [["replicate", { ...base, MODE: "replicate", ROUTE: "x" }], ["MODE unset", base]] as const) {
    const r = REG.resolvePrompt(rep, vars);
    check(`F ${label} render = plain expansion minus the check block`, r === expandTemplate(rep.systemPromptTemplate.replace(CHECK_RE, ""), vars) && !r.includes("<check_mode>"));
  }
  let threw = "";
  try { REG.resolvePrompt({ ...rep, systemPromptTemplate: rep.systemPromptTemplate.replace(/<check_mode>[\s\S]*?<\/check_mode>/, "") }, { ...base, MODE: "check" }); } catch (e: any) { threw = e.message; }
  check("F check render throws when the <check_mode> anchor is gone", /check_mode/.test(threw), threw);
  threw = "";
  try { REG.resolvePrompt({ ...rep, systemPromptTemplate: rep.systemPromptTemplate.replace(/<check_mode>[\s\S]*?<\/check_mode>/, "") }, { ...base, MODE: "estimate" }); } catch (e: any) { threw = e.message; }
  check("F estimate render throws too (a renamed block would silently put the check text into every estimate)", /check_mode/.test(threw), threw);

  const def = REG.replicatorCheckDefinition(rep);
  const s: any = def.safety;
  const reads = (s.allowedReadRoots ?? []).join(" ");
  check("F check definition reads the whole experiment directory and notes/", /data\/experiments\/\{\{EXPERIMENT_ID\}\}(\s|$)/.test(reads) && /(^|\s)notes(\s|$)/.test(reads), reads);
  check("F …writes only under replication/", JSON.stringify(s.allowedWriteRoots) === JSON.stringify(["data/experiments/{{EXPERIMENT_ID}}/replication/"]), JSON.stringify(s.allowedWriteRoots));
  check("F …bash may not write the producer's scripts/ or tests/, may write runs/ (re-running the shipped code on the clone writes there)", (s.blockedBashWriteRoots ?? []).some((r: string) => /scripts\/$/.test(r)) && (s.blockedBashWriteRoots ?? []).some((r: string) => /tests\/$/.test(r)) && !(s.blockedBashWriteRoots ?? []).some((r: string) => /runs\/$/.test(r)), JSON.stringify(s.blockedBashWriteRoots));
  check("F …no blocked path mention on scripts, runs, tests or the ledger (the seat must open them)", !(s.blockedBashPathMentions ?? []).some((m: string) => /scripts|runs|tests|experiments\.md/.test(m)), JSON.stringify(s.blockedBashPathMentions));
  check("F …thinking high (the measured effort) and a turn cap", def.thinkingLevel === "high" && typeof def.maxTurns === "number" && def.maxTurns > 0, `${def.thinkingLevel} ${def.maxTurns}`);
  check("F …the base definition is not mutated", rep.safety?.allowedWriteRoots?.[0] === "data/experiments/{{EXPERIMENT_ID}}/replication/" && (rep.safety?.blockedBashPathMentions ?? []).length === 4 && rep.thinkingLevel === "medium");
}

// ── G. the clone ─────────────────────────────────────────────────────────────
console.log("\nG. the seat works on a clone: same files, no .agent/, writes there never reach the project; the clone is removed");
{
  const p = project("g");
  const clone = VS.cloneProjectForSeat(p, EID);
  check("G the clone is elsewhere and holds the experiment", clone !== p && !clone.startsWith(p) && existsSync(join(clone, "data", "experiments", EID, "runs", "run_1", "results.json")) && existsSync(join(clone, "notes", "experiments.md")), clone);
  check("G the clone has no .agent/ (the live run's log, registry and transcripts stay out of the seat's reach)", !existsSync(join(clone, ".agent")) && existsSync(join(p, ".agent", "log.jsonl")));
  writeFileSync(join(clone, "data", "experiments", EID, "runs", "run_1", "results.json"), "{\"overwritten\": true}");
  check("G overwriting results.json in the clone leaves the project's file intact", readFileSync(join(p, "data", "experiments", EID, "runs", "run_1", "results.json"), "utf-8").includes("\"kappa\": 3.2e-7"));
  VS.removeSeatClone(clone);
  check("G removeSeatClone removes the clone and its temp directory", !existsSync(clone) && !existsSync(dirname(clone)));
  let threw = "";
  try { VS.cloneProjectForSeat(join(tmp, "does-not-exist"), EID); } catch (e: any) { threw = e.message; }
  check("G a project that does not exist is refused with a message, not a half clone", /clone/.test(threw) && !readdirSync(tmpdir()).some((n) => n.startsWith(`luxas-seat-${EID}-`) && existsSync(join(tmpdir(), n, "project"))), threw);
}

// ── H. harvest ───────────────────────────────────────────────────────────────
console.log("\nH. only replication/ comes back: new dirs copied and stamped, untouched dirs skipped, an edited existing dir lands beside it as -2, the shared file only when the project has none");
{
  const p = project("h");
  const repP = join(p, "data", "experiments", EID, "replication");
  mkdirSync(join(repP, "kappa"), { recursive: true });
  writeFileSync(join(repP, "kappa", "results.json"), "{\"quantity\":\"kappa\",\"value\":3.1e-7,\"route\":\"brain-dispatched\",\"script\":\"replication/kappa/a.py\"}\n");
  mkdirSync(join(repP, "untouched"), { recursive: true });
  writeFileSync(join(repP, "untouched", "results.json"), "{\"quantity\":\"other\",\"value\":1}\n");
  const clone = VS.cloneProjectForSeat(p, EID);
  const repC = join(clone, "data", "experiments", EID, "replication");
  // the seat: edits the existing kappa file (forbidden by its prompt, so it must not overwrite), writes a new dir with a script, a malformed dir, and the shared file
  writeFileSync(join(repC, "kappa", "results.json"), "{\"quantity\":\"kappa\",\"value\":3.19e-7,\"sigma\":1e-8,\"route\":\"second-order perturbation, own code\",\"script\":\"replication/kappa/recompute.py\",\"inputs\":{\"alpha_s_au\":184.4}}\n");
  mkdirSync(join(repC, "T2star_clock"));
  writeFileSync(join(repC, "T2star_clock", "results.json"), "{\"quantity\":\"T2star_clock\",\"value\":281.9,\"sigma\":5,\"route\":\"static phase pi f'' dB^2 t\",\"script\":\"replication/T2star_clock/t2.py\",\"inputs\":{}}\n");
  writeFileSync(join(repC, "T2star_clock", "t2.py"), "print(281.9)\n");
  mkdirSync(join(repC, "broken"));
  writeFileSync(join(repC, "broken", "results.json"), "{ torn");
  writeFileSync(join(repC, "results.json"), "{\"quantity\":\"kappa\",\"value\":3.2e-7,\"route\":\"shared file\",\"script\":\"replication/x.py\"}\n");
  // and it re-ran the producer's code, overwriting the clone's run
  writeFileSync(join(clone, "data", "experiments", EID, "runs", "run_1", "results.json"), "{\"overwritten\": true}");
  const h = VS.harvestSeatReplications(clone, p, EID, "claude-opus-5-5");
  const rels = h.harvested.map((x: any) => x.rel).sort();
  check("H new dir, edited-existing as -2, and the shared file are carried back; the untouched dir is not", JSON.stringify(rels) === JSON.stringify(["replication/T2star_clock", "replication/kappa-2", "replication/results.json"]), JSON.stringify(rels));
  const t2 = JSON.parse(readFileSync(join(repP, "T2star_clock", "results.json"), "utf-8"));
  check("H harvested files are stamped with the model and seat:check; the script travels with them", t2.model === "claude-opus-5-5" && t2.seat === "check" && existsSync(join(repP, "T2star_clock", "t2.py")));
  check("H the project's own kappa file is untouched and the seat's version sits beside it", readFileSync(join(repP, "kappa", "results.json"), "utf-8").includes("3.1e-7") && JSON.parse(readFileSync(join(repP, "kappa-2", "results.json"), "utf-8")).value === 3.19e-7);
  check("H the malformed dir is noted, not copied", !existsSync(join(repP, "broken")) && h.notes.some((n: string) => /broken/.test(n)), h.notes.join(" | "));
  check("H the producer's run is never copied back", readFileSync(join(p, "data", "experiments", EID, "runs", "run_1", "results.json"), "utf-8").includes("\"kappa\": 3.2e-7"));
  const again = VS.harvestSeatReplications(clone, p, EID, "claude-opus-5-5");
  check("H harvesting twice copies nothing more (what is already in the project is skipped)", again.harvested.length === 0, JSON.stringify(again.harvested));
  VS.removeSeatClone(clone);
  check("H a clone without a replication/ dir harvests nothing", VS.harvestSeatReplications(join(tmp, "nowhere"), p, EID, "m").harvested.length === 0);
}

// ── I. the loop under check mode (pi engine, stub spawn) ─────────────────────
console.log("\nI. in the review loop: one replicator in check mode per round, on a clone, before the reviewer; its files come back, its lines reach the reviewer and the file; round 2 carries round-1 discriminators; unset → the estimate path");
{
  type Call = { name: string; mode?: string; workDir?: string; projectDir: string; exact?: string; prompt: string; templateVars: any };
  async function run(p: string, opts: { seat: "check" | undefined; verdicts: string[]; iterations?: string }) {
    setEnv("LUXAS_VERIFY_SEAT", opts.seat); setEnv("LUXAS_MAX_REVIEW_ITERATIONS", opts.iterations ?? "2");
    const calls: Call[] = [];
    let reviewerRound = 0;
    const out: any = await runExperimentReviewLoop({ output: "FIRST RUN", success: true }, {
      projectDir: p, mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: p },
      baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir: p, getApiKey: () => undefined } as any,
      // executorOutside: the object-keyed headline is a fixable declaration problem the in-process loop would send
      // back first (smoke_solo_executor §5b covers that send-back); here, as on the hand route, nothing is sent back.
      initialTask: "ORIGINAL TASK", getApiKey: () => undefined, makeSpawnTool: () => null, executorOutside: true,
      spawn: (async (o: any) => {
        calls.push({ name: o.name, mode: o.templateVars?.MODE, workDir: o.workDir, projectDir: o.projectDir, exact: o.exactModel, prompt: o.prompt, templateVars: o.templateVars });
        if (o.name === "replicator" && o.templateVars?.MODE === "check") {
          const c = o.workDir;
          if (!c || !existsSync(join(c, "data", "experiments", EID, "runs", "run_1", "results.json"))) return { output: "no clone", success: false };
          // re-runs the producer's code (overwrites the clone's run), writes its own leg
          writeFileSync(join(c, "data", "experiments", EID, "runs", "run_1", "results.json"), "{\"overwritten\": true}");
          mkdirSync(join(c, "data", "experiments", EID, "replication", "kappa"), { recursive: true });
          writeFileSync(join(c, "data", "experiments", EID, "replication", "kappa", "results.json"), "{\"quantity\":\"kappa\",\"value\":3.19e-7,\"sigma\":1e-8,\"route\":\"second-order perturbation, own code\",\"script\":\"replication/kappa/recompute.py\",\"inputs\":{\"alpha_s_au\":184.4}}\n");
          writeFileSync(join(c, "data", "experiments", EID, "replication", "kappa", "recompute.py"), "print(3.19e-7)\n");
          const n = calls.filter((x) => x.name === "replicator").length;
          return { output: `did the work\nRECOMPUTED: kappa — 3.19e-7 ± 1e-8 via second-order perturbation, own code — inputs: [alpha_s_au=184.4]\nRERUN: kappa — code gives 3.2e-7; results.json says 3.2e-7; agree — scripts/build.py\nRERUN: T2star_clock — code gives 281.9; results.json says 139.8; differ — scripts/coherence.py\nCONTROL: noise-floor — claim: "the T2* floor comes from the 1 kHz noise channel" — toggled noise=0: unchanged; refutes${n > 1 ? "\nCONTROL: D1 — claim: \"sweep alpha\" — computed slope 1.02; supports" : ""}`, success: true };
        }
        if (o.name === "replicator") return { output: "ESTIMATE(blind): kappa — 3e-7 ± 1e-7 via napkin — inputs: [alpha_s_au=184.4]", success: true };
        if (o.name === "experiment_reviewer") return { output: opts.verdicts[Math.min(reviewerRound++, opts.verdicts.length - 1)], success: true };
        if (o.name === "experiment") { mkdirSync(join(p, "data", "experiments", EID, "runs", "run_2"), { recursive: true }); writeFileSync(join(p, "data", "experiments", EID, "runs", "run_2", "results.json"), readFileSync(join(p, "data", "experiments", EID, "runs", "run_1", "results.json"))); return { output: "revised", success: true }; }
        return { output: "?", success: true };
      }) as any,
    });
    return { calls, out };
  }
  const REVISE = "DISCRIMINATOR: kappa — if right: slope 1 in alpha; if wrong: flat; computation: sweep alpha\nSCALING: kappa — expected 1 in alpha; observed not swept\nVERDICT: revise\nFEEDBACK:\n- Issue 1: the T2star_clock value 139.8 s is not what the shipped script produces (281.9 s) — regenerate results.json from the code.";
  const OK = "DISCRIMINATOR: kappa — if right: a; if wrong: b; computation: c\nSCALING: kappa — expected 1 in alpha; observed not swept\nVERDICT: satisfied";

  const p1 = project("i1");
  const a = await run(p1, { seat: "check", verdicts: [REVISE, OK] });
  const seats = a.calls.filter((c) => c.name === "replicator");
  check("I two rounds → two check-mode replicators, no estimate-mode one", seats.length === 2 && seats.every((s) => s.mode === "check"), a.calls.map((c) => `${c.name}:${c.mode ?? ""}`).join(","));
  check("I the seat runs before the reviewer each round", a.calls.map((c) => c.name).join(",") === "replicator,experiment_reviewer,experiment,replicator,experiment_reviewer", a.calls.map((c) => c.name).join(","));
  check("I the seat's workDir is a clone, not the project; projectDir stays the project (transcript, registry, usage)", seats.every((s) => s.workDir && s.workDir !== p1 && s.projectDir === p1), JSON.stringify(seats.map((s) => [s.workDir, s.projectDir])));
  check("I PROJECT_DIR in its templateVars is the clone; QUANTITY_ID names the ids; ROUTE empty", seats.every((s) => s.templateVars.PROJECT_DIR === s.workDir && /kappa/.test(s.templateVars.QUANTITY_ID) && s.templateVars.ROUTE === ""), JSON.stringify(seats[0]?.templateVars));
  check("I pinned to the measured model via exactModel", seats.every((s) => s.exact === "claude-opus-5-5"), seats.map((s) => s.exact).join());
  check("I the clones are gone after the loop", seats.every((s) => !existsSync(s.workDir!)));
  check("I the project's run_1 results.json is untouched by the seat's re-run", readFileSync(join(p1, "data", "experiments", EID, "runs", "run_1", "results.json"), "utf-8").includes("\"kappa\": 3.2e-7"));
  const leg = join(p1, "data", "experiments", EID, "replication", "kappa", "results.json");
  check("I the seat's replication leg is carried back and stamped", existsSync(leg) && JSON.parse(readFileSync(leg, "utf-8")).model === "claude-opus-5-5" && JSON.parse(readFileSync(leg, "utf-8")).seat === "check" && existsSync(join(p1, "data", "experiments", EID, "replication", "kappa", "recompute.py")));
  const rev1 = a.calls.find((c) => c.name === "experiment_reviewer")!;
  check("I the round-1 reviewer's task carries the seat lines", /RERUN: T2star_clock — code gives 281\.9; results\.json says 139\.8; differ/.test(rev1.prompt) && /CONTROL: noise-floor/.test(rev1.prompt) && /EXECUTED/.test(rev1.prompt), rev1.prompt.slice(-900));
  check("I …and no ESTIMATE(blind) line (none was made)", !/ESTIMATE\(blind\)/.test(rev1.prompt));
  const r1 = readFileSync(join(p1, "reviews", `experiment_review_${EID}_r1.md`), "utf-8");
  check("I the round-1 review file persists the seat section with the lines", /Verifier seat \(check mode/.test(r1) && /RERUN: T2star_clock/.test(r1) && /RECOMPUTED: kappa/.test(r1), r1);
  check("I the round-2 seat is handed the round-1 DISCRIMINATOR line to execute", /D1: DISCRIMINATOR: kappa — if right: slope 1 in alpha/.test(seats[1].prompt), seats[1].prompt.slice(-500));
  const rev2 = a.calls.filter((c) => c.name === "experiment_reviewer")[1];
  check("I the round-2 reviewer sees the round-2 seat lines (the D1 control among them)", /CONTROL: D1/.test(rev2.prompt));
  check("I the brain's result names the seat's summary and the break", /verifier seat round 1/.test(a.out.output) && /1 differ/.test(a.out.output) && /SATISFIED/.test(a.out.output), a.out.output.slice(-800));
  const table = buildClaimTable(p1);
  const row = table.rows.find((r: any) => r.id === "kappa");
  check("I the claim table reads the harvested leg as a replication on its own route", !!row && row.estimates.some((e: any) => e.kind === "replication" && /second-order/.test(e.route ?? "") && e.job), JSON.stringify(row?.estimates.map((e: any) => `${e.kind}:${e.source}:${e.route}`)));

  const p2 = project("i2");
  const b = await run(p2, { seat: undefined, verdicts: [OK] });
  const est = b.calls.filter((c) => c.name === "replicator");
  check("I LUXAS_VERIFY_SEAT unset → the estimate-mode replicator as before, no workDir, no exactModel", est.length === 1 && est[0].mode === "estimate" && !est[0].workDir && !est[0].exact, JSON.stringify(est.map((c) => [c.mode, c.workDir, c.exact])));
  const rev = b.calls.find((c) => c.name === "experiment_reviewer")!;
  check("I …and the reviewer's task has the blind line and no seat section", /ESTIMATE\(blind\): kappa/.test(rev.prompt) && !/Verifier seat/.test(rev.prompt) && !/EXECUTED/.test(rev.prompt));
  const r1b = readFileSync(join(p2, "reviews", `experiment_review_${EID}_r1.md`), "utf-8");
  check("I …and its review file has no seat section", !/Verifier seat/.test(r1b));

  // a seat that fails leaves the review to run without it
  const p3 = project("i3");
  setEnv("LUXAS_VERIFY_SEAT", "check"); setEnv("LUXAS_MAX_REVIEW_ITERATIONS", "1");
  const seen: string[] = [];
  const c: any = await runExperimentReviewLoop({ output: "FIRST RUN", success: true }, {
    projectDir: p3, mergedTemplateVars: { EXPERIMENT_ID: EID, PROJECT_DIR: p3 },
    baseOpts: { name: "experiment", templateVars: { EXPERIMENT_ID: EID }, projectDir: p3, getApiKey: () => undefined } as any,
    initialTask: "t", getApiKey: () => undefined, makeSpawnTool: () => null, executorOutside: true,
    spawn: (async (o: any) => { seen.push(o.name); if (o.name === "replicator") throw new Error("provider down"); return { output: OK, success: true }; }) as any,
  });
  check("I a seat that throws: the reviewer still runs, the result says the seat failed and why", seen.join() === "replicator,experiment_reviewer" && /verifier seat round 1 failed: provider down/.test(c.out?.output ?? c.output), (c.output ?? "").slice(-300));
  check("I …and no clone is left behind", !readdirSync(tmpdir()).some((n) => n.startsWith(`luxas-seat-${EID}-`)));
  setEnv("LUXAS_VERIFY_SEAT", undefined); setEnv("LUXAS_MAX_REVIEW_ITERATIONS", undefined);
}

// ── J. the claim table counts a seat leg even where an estimator once ran ────
console.log("\nJ. a seat-stamped replication is a leg even when an estimate-mode replicator ran for that id (the estimator-only rule reads the stamp)");
{
  const p = project("j");
  // an estimate-mode replicator's transcript for (E1_probe, kappa)
  writeFileSync(join(p, ".agent", "conversations", "brain.blind-estimate-kappa.replicator-ab12cd.jsonl"), JSON.stringify({ type: "spawn_init", templateVars: { EXPERIMENT_ID: EID, QUANTITY_ID: "kappa", MODE: "estimate" } }) + "\n");
  const rep = join(p, "data", "experiments", EID, "replication", "kappa");
  mkdirSync(rep, { recursive: true });
  const leg = { quantity: "kappa", value: 3.19e-7, sigma: 1e-8, route: "second-order perturbation, own code", script: "replication/kappa/recompute.py", inputs: { alpha_s_au: 184.4 } };
  writeFileSync(join(rep, "results.json"), JSON.stringify(leg));
  const without = buildClaimTable(p).rows.find((r: any) => r.id === "kappa");
  check("J without the stamp the file is dropped as the estimator's (today's rule)", !!without && !without.estimates.some((e: any) => e.kind === "replication"), JSON.stringify(without?.estimates.map((e: any) => e.kind)));
  writeFileSync(join(rep, "results.json"), JSON.stringify({ ...leg, model: "claude-opus-5-5", seat: "check" }));
  const withStamp = buildClaimTable(p).rows.find((r: any) => r.id === "kappa");
  check("J with seat:check it is a replication leg", !!withStamp && withStamp.estimates.some((e: any) => e.kind === "replication"), JSON.stringify(withStamp?.estimates.map((e: any) => e.kind)));
}

// ── K. the claude-code engine ────────────────────────────────────────────────
console.log("\nK. claude-code engine: `claude -p` in the clone with the task, the check render as system prompt, the measured model/effort, write tools, no API key; the answer is parsed; the transcript is kept; usage is recorded as cash only when a key paid");
{
  const bin = join(tmp, "bin"); mkdirSync(bin, { recursive: true });
  const fake = join(bin, "claude");
  writeFileSync(fake, `#!/bin/sh
printf '%s\\036' "$@" > "$PWD/argv.txt"
printf '%s\\n' "\${ANTHROPIC_API_KEY-unset}" > "$PWD/key.txt"
pwd > "$PWD/cwd.txt"
printf '%s\\n' '{"overwritten": true}' > data/experiments/${EID}/runs/run_1/results.json
mkdir -p data/experiments/${EID}/replication/kappa
printf '%s\\n' '{"quantity":"kappa","value":3.19e-7,"sigma":1e-8,"route":"own route","script":"replication/kappa/r.py","inputs":{"alpha_s_au":184.4}}' > data/experiments/${EID}/replication/kappa/results.json
printf '%s\\n' '{"type":"system","subtype":"init","apiKeySource":"'"\${FAKE_LOGIN:-none}"'","model":"claude-opus-5-5"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":9,"duration_ms":30000,"total_cost_usd":0.9,"result":"I will continue once the simulation finishes.","terminal_reason":"completed"}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"duration_ms":900,"total_cost_usd":0.95,"result":"Still waiting."}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":9,"duration_ms":61000,"total_cost_usd":1.75,"usage":{"input_tokens":30,"output_tokens":4000,"cache_read_input_tokens":200000,"cache_creation_input_tokens":12000},"result":"done\\nRECOMPUTED: kappa — 3.19e-7 ± 1e-8 via own route — inputs: [alpha_s_au=184.4]\\nRERUN: kappa — code gives 3.2e-7; results.json says 3.2e-7; agree — scripts/build.py","terminal_reason":"completed"}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"duration_ms":900,"total_cost_usd":1.80,"result":"(background task notice)"}'
`);
  chmodSync(fake, 0o755);
  const p = project("k");
  setEnv("ANTHROPIC_API_KEY", "sk-ant-should-not-leak");
  const r = await VS.runVerifierSeat({
    projectDir: p, experimentId: EID, round: 1, engine: "claude-code", model: "claude-opus-5-5",
    decls: R.headlineDeclsFor(buildClaimTable(p), EID), outOfScope: R.headlineDeclsOutOfScope(buildClaimTable(p), EID),
    getApiKey: () => undefined, claudeBin: fake, parentAgentId: "gate", keepClone: true,
  });
  const argv = readFileSync(join(r.clone, "argv.txt"), "utf-8").split("\u001e");
  check("K it ran in the clone (cwd), which was then kept for us to read only because the gate asked", readFileSync(join(r.clone, "cwd.txt"), "utf-8").trim().replace(/^\/private/, "") === r.clone.replace(/^\/private/, "") || readFileSync(join(r.clone, "cwd.txt"), "utf-8").trim() === r.clone, `${readFileSync(join(r.clone, "cwd.txt"), "utf-8").trim()} vs ${r.clone}`);
  check("K -p carries the task; --append-system-prompt carries the check render", argv[argv.indexOf("-p") + 1].includes("Verifier seat, check mode") && argv[argv.indexOf("--append-system-prompt") + 1].includes("<check_mode>"));
  check("K model and effort are the measured ones; write tools allowed; budget, stream-json, no MCP, no session persistence", argv[argv.indexOf("--model") + 1] === "claude-opus-5-5" && argv[argv.indexOf("--effort") + 1] === "high" && argv.includes("Write") && argv.includes("Edit") && argv.includes("--max-budget-usd") && argv.includes("stream-json") && argv.includes("--strict-mcp-config") && argv.includes("--no-session-persistence"), argv.join(" "));
  check("K ANTHROPIC_API_KEY is not passed on (subscription login)", readFileSync(join(r.clone, "key.txt"), "utf-8").trim() === "unset");
  check("K the answer's lines are read from the row that carries them — not the equal-turns wait row before it, not the one-turn rows (C1 a3-01: the first 23-turn row won a tie and a catch read as no lines)", r.lines.length === 2 && r.lines.map((l: any) => l.kind).join() === "RECOMPUTED,RERUN", JSON.stringify(r.lines));
  check("K list cost is the largest cumulative total (the follow-up row counts), login reported", r.listCostUsd === 1.8 && r.login === "none", `${r.listCostUsd} ${r.login}`);
  check("K the project's results.json is untouched; the seat's leg is harvested and stamped", readFileSync(join(p, "data", "experiments", EID, "runs", "run_1", "results.json"), "utf-8").includes("\"kappa\": 3.2e-7") && JSON.parse(readFileSync(join(p, "data", "experiments", EID, "replication", "kappa", "results.json"), "utf-8")).seat === "check");
  check("K the transcript is kept under the project's .agent/verifier-seat/", !!r.transcriptPath && r.transcriptPath.startsWith(join(p, ".agent", "verifier-seat")) && existsSync(r.transcriptPath), r.transcriptPath);
  const usage = readFileSync(join(p, ".agent", "usage.log"), "utf-8").trim().split("\n");
  const cols = usage[usage.length - 1].split("\t");
  check("K a usage row is appended with the tokens and cost 0 (the subscription paid), attributed to the seat", usage.length === 1 && cols[1] === "claude-opus-5-5" && cols[3] === "30" && cols[4] === "4000" && Number(cols[7]) === 0 && /verifier-seat/.test(cols[8]) && cols[9] === "replicator", usage[usage.length - 1]);
  VS.removeSeatClone(r.clone);
  // billed to a key → the cost is cash and goes in the ledger
  const p2 = project("k2");
  const r2 = await VS.runVerifierSeat({
    projectDir: p2, experimentId: EID, round: 1, engine: "claude-code", model: "claude-opus-5-5",
    decls: R.headlineDeclsFor(buildClaimTable(p2), EID), outOfScope: [], getApiKey: () => undefined, claudeBin: fake, env: { FAKE_LOGIN: "ANTHROPIC_API_KEY" },
  });
  const cols2 = readFileSync(join(p2, ".agent", "usage.log"), "utf-8").trim().split("\n").pop()!.split("\t");
  check("K when the CLI reports an API key paid, the list cost is the cash cost in the ledger, and the result says so", Number(cols2[7]) === 1.8 && r2.login === "ANTHROPIC_API_KEY" && r2.notes.some((n: string) => /billed to an API key/.test(n)), `${cols2[7]} ${r2.notes.join(" | ")}`);
  check("K the clone is removed when not kept", !existsSync(r2.clone));
  setEnv("ANTHROPIC_API_KEY", undefined);
  // a CLI that fails to produce a result
  writeFileSync(fake, "#!/bin/sh\necho 'boom' >&2\nexit 1\n"); chmodSync(fake, 0o755);
  const p3 = project("k3");
  let threw = "";
  try { await VS.runVerifierSeat({ projectDir: p3, experimentId: EID, round: 1, engine: "claude-code", model: "claude-opus-5-5", decls: R.headlineDeclsFor(buildClaimTable(p3), EID), outOfScope: [], getApiKey: () => undefined, claudeBin: fake }); } catch (e: any) { threw = e.message; }
  check("K a CLI with no result row is a failure the loop reports (not a silent empty review)", /did not complete|no result/.test(threw) && !/undefined/.test(threw), threw);
  check("K …and leaves no clone", !readdirSync(tmpdir()).some((n) => n.startsWith(`luxas-seat-${EID}-`)));
}

// ── L. review_experiment / verify_experiment arguments ───────────────────────
console.log("\nL. review_experiment takes --seat and --seat-engine; --no-blind with --seat check is refused; verify_experiment refuses bad arguments before anything runs");
{
  const cli: any = await import("./review_experiment.mts");
  check("L --seat check / --seat-engine claude-code pass argvProblem", cli.argvProblem(["/p", "E1_x", "--seat", "check", "--seat-engine", "claude-code"]) === null);
  check("L --seat without a value is refused", /--seat needs a value/.test(cli.argvProblem(["/p", "E1_x", "--seat"]) ?? ""));
  const plan = cli.seatPlan;
  check("L seatPlan: default estimate/pi; check; none → off; engine honoured", JSON.stringify(plan([])) === JSON.stringify({ mode: "estimate", engine: "pi" }) && plan(["--seat", "check"]).mode === "check" && plan(["--seat", "none"]).mode === "off" && plan(["--seat", "check", "--seat-engine", "claude-code"]).engine === "claude-code", JSON.stringify([plan([]), plan(["--seat", "check"])]));
  check("L --no-blind alone → off (as today)", plan(["--no-blind"]).mode === "off");
  check("L --no-blind with --seat check is refused (it would switch the seat off while looking like it ran)", /--no-blind/.test(plan(["--seat", "check", "--no-blind"]).refuse ?? ""), JSON.stringify(plan(["--seat", "check", "--no-blind"])));
  check("L an unknown seat or engine is refused", /--seat must be/.test(plan(["--seat", "yes"]).refuse ?? "") && /--seat-engine must be/.test(plan(["--seat-engine", "gpt"]).refuse ?? ""));
  const TSX = join(ROOT, "node_modules", ".bin", "tsx");
  const run = (args: string[]) => spawnSync(TSX, [join(ROOT, "scripts", "verify_experiment.mts"), ...args], { encoding: "utf-8", timeout: 60_000, env: { ...process.env, LUXAS_VERIFY_SEAT: undefined } as any });
  const bad = run([join(tmp, "nope"), "E1_x"]);
  check("L verify_experiment: a non-project is refused with exit 2", bad.status === 2 && /no notes\/experiments\.md|not a Luxas project/.test(bad.stdout + bad.stderr), `${bad.status} ${(bad.stdout + bad.stderr).slice(0, 200)}`);
  const badId = run([project("l"), "../etc"]);
  check("L verify_experiment: a bad experiment id is refused with exit 2", badId.status === 2 && /not an experiment id/.test(badId.stdout + badId.stderr), `${badId.status} ${(badId.stdout + badId.stderr).slice(0, 200)}`);
  const badEngine = run([project("l2"), EID, "--engine", "gpt"]);
  check("L verify_experiment: an unknown engine is refused with exit 2", badEngine.status === 2 && /--engine/.test(badEngine.stdout + badEngine.stderr), `${badEngine.status} ${(badEngine.stdout + badEngine.stderr).slice(0, 200)}`);
}

restoreEnv();
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASS — the verifier seat recomputes on a clone, its files and lines come back, and the estimate path is untouched." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
