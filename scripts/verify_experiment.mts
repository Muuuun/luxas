#!/usr/bin/env tsx
/**
 * verify_experiment — the verifier seat by hand: one replicator in check mode
 * on a clone of the project, for one experiment, without a reviewer round.
 *
 * It calls the same function the review loop calls (src/verifier-seat.ts
 * runVerifierSeat), so what it prints is what the reviewer would be handed:
 * RECOMPUTED / RERUN / CONTROL lines, and the replication/<id>/ files carried
 * back into the project for the claim table. It writes no review round. It
 * replaces scripts/audit_experiment.mts (verifier bench A2/A3's RAR arm) for
 * the hand route: same clone, same subscription login, same measured model and
 * effort, plus the files the table reads.
 *
 * Usage:
 *   npx tsx scripts/verify_experiment.mts <projectDir> <EXPERIMENT_ID>
 *        [--engine claude-code|pi]   default claude-code (subscription login; pi = in-process agent on the API key)
 *        [--model M]                 default claude-opus-5-5 (LUXAS_CHECK_MODEL)
 *        [--max-usd N]               claude-code: the CLI's budget, list price (default 6)
 *        [--round N]                 numbers the transcript; default one past the persisted review rounds
 *        [--discriminators <file>]   DISCRIMINATOR lines (one per line, an earlier review file will do) to execute
 *        [--no-harvest]              print what the seat wrote, carry nothing back
 *        [--keep-clone]              leave the clone on disk (its path is printed)
 * Exit: 0 no break, 3 a RERUN differs or a CONTROL refutes, 1 the seat did not complete, 2 refused.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildClaimTable } from "../src/claims-table.js";
import { headlineDeclsFor, headlineDeclsOutOfScope, nextReviewRound } from "../src/claims-review.js";
import { checkModel, runVerifierSeat, seatBreaks, seatLinesSummary } from "../src/verifier-seat.js";

function refuse(msg: string): never {
  console.log(`verify_experiment refused: ${msg}`);
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const VALUE = ["--engine", "--model", "--max-usd", "--round", "--discriminators"];
  const BARE = ["--no-harvest", "--keep-clone"];
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE.includes(a)) { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) refuse(`${a} needs a value`); i++; }
    else if (a.startsWith("-")) { if (!BARE.includes(a)) refuse(`unknown flag "${a}"`); }
    else pos.push(a);
  }
  const flag = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const [projectArg, eid] = pos;
  if (!projectArg || !eid) refuse("usage: verify_experiment.mts <projectDir> <EXPERIMENT_ID> [--engine claude-code|pi] [--model M] [--max-usd N] [--round N] [--discriminators <file>] [--no-harvest] [--keep-clone]");
  // The id is printed into the prompt and joined into a path: a plain token only.
  if (!/^E\d+[A-Za-z0-9_]*$/.test(eid)) refuse(`${JSON.stringify(eid)} is not an experiment id (E<N>_<slug>)`);
  const project = resolve(projectArg);
  if (!existsSync(join(project, "notes", "experiments.md"))) refuse(`${project} has no notes/experiments.md`);
  if (!existsSync(join(project, "data", "experiments", eid))) refuse(`${project} has no data/experiments/${eid}/`);
  const engineArg = flag("--engine") ?? "claude-code";
  if (!["claude-code", "pi"].includes(engineArg)) refuse(`--engine must be claude-code or pi, got "${engineArg}"`);
  const engine = engineArg as "claude-code" | "pi";
  const maxUsd = Number(flag("--max-usd") ?? 6);
  if (!(maxUsd > 0)) refuse("--max-usd needs a positive number");
  const model = flag("--model") ?? checkModel();
  const round = flag("--round") !== undefined ? Number(flag("--round")) : nextReviewRound(project, eid);
  if (!Number.isInteger(round) || round < 1) refuse(`--round must be a positive integer, got "${flag("--round")}"`);
  let discriminators: string[] = [];
  if (flag("--discriminators")) {
    let text = "";
    try { text = readFileSync(flag("--discriminators")!, "utf-8"); } catch (err) { refuse(`--discriminators ${flag("--discriminators")}: ${(err as Error).message}`); }
    discriminators = text.split("\n").map((l) => l.trim()).filter((l) => /^DISCRIMINATOR:/.test(l));
    if (!discriminators.length) refuse(`--discriminators ${flag("--discriminators")} holds no DISCRIMINATOR: line`);
  }

  let decls: ReturnType<typeof headlineDeclsFor> = [], outOfScope: ReturnType<typeof headlineDeclsOutOfScope> = [];
  try { const table = buildClaimTable(project); decls = headlineDeclsFor(table, eid); outOfScope = headlineDeclsOutOfScope(table, eid); }
  catch (err) { console.log(`claim table could not be built (${(err as Error).message.slice(0, 160)}); the seat gets no headline ids and will re-run what the ledger calls headline`); }
  if (!decls.length && !outOfScope.length) console.log(`note: ${eid} declares no headline quantity the table can see (computed.quantities[] with headline: true); the seat is handed the ledger's headline findings only`);

  const { getApiKey } = await import("../src/auth.js");
  // The pi engine pays on the API key through pi-ai: its rows go to the project's ledger like any sub-agent's
  // (the claude-code engine appends its own row). Without this the hand route's seat was invisible to the cost cap.
  if (engine === "pi") {
    const { installUsageTracking } = await import("../src/usage-log.js");
    installUsageTracking(join(project, ".agent", "usage.log"));
  }
  console.log(`◈ verify ${eid} — engine=${engine} model=${model}${engine === "claude-code" ? ` cap=$${maxUsd} (list; subscription login)` : " (API key)"} round=${round} ids=${[...decls.map((d) => d.id), ...outOfScope.map((o) => o.id)].join(",") || "(none)"}${discriminators.length ? ` discriminators=${discriminators.length}` : ""}`);
  let r;
  try {
    r = await runVerifierSeat({
      projectDir: project, experimentId: eid, round, decls, outOfScope, priorDiscriminators: discriminators,
      engine, model, maxUsd, getApiKey: (p) => getApiKey(p as any), parentAgentId: `verify_experiment.${eid}`,
      harvest: !argv.includes("--no-harvest"), keepClone: argv.includes("--keep-clone"),
    });
  } catch (err) {
    console.log(`◈ the seat did not complete: ${(err as Error).message}`);
    process.exit(1);
  }
  for (const l of r.lines) console.log(l.text);
  if (!r.lines.length) console.log("(no RECOMPUTED / RERUN / CONTROL line in the seat's reply)\n" + r.output.slice(0, 2000));
  const breaks = seatBreaks(r.lines);
  console.log(`◈ ${seatLinesSummary(r.lines)} — ${breaks.length} break(s)`);
  if (r.harvested.length) console.log(`◈ carried back: ${r.harvested.map((h) => `${h.rel} (${h.quantity})`).join(", ")}`);
  for (const n of r.notes) console.log(`◈ note: ${n}`);
  console.log(`◈ ${(r.durationMs / 60_000).toFixed(1)} min${r.listCostUsd !== undefined ? `, $${r.listCostUsd.toFixed(2)} list${r.login === "none" ? " (subscription login, no cash)" : ` (apiKeySource=${r.login})`}` : ""}${r.transcriptPath ? `; transcript ${r.transcriptPath}` : ""}${argv.includes("--keep-clone") ? `; clone kept at ${r.clone}` : ""}`);
  process.exit(r.lines.length ? (breaks.length ? 3 : 0) : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
