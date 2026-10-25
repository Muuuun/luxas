#!/usr/bin/env tsx
/**
 * The studio's entry to the experiment board (src/board.ts). Prints one JSON
 * object on stdout and exits; makes no model call and needs no credential, so
 * the studio runs it with an environment that has none.
 *
 *   tsx src/board-cli.ts --project <dir>                                   → Board
 *   tsx src/board-cli.ts --project <dir> --act accept|rework|stop --experiment <EID> [--comment-stdin] [--by <email>]
 *                                                                          → { ok, message, effect }
 *
 * The comment comes on stdin (--comment-stdin), so free text never lands in an
 * argv that `ps` shows to every user of the machine.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { applyBoardAction, buildBoard } from "./board.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = (j: unknown, code = 0) => { process.stdout.write(JSON.stringify(j) + "\n"); process.exit(code); };

const projectArg = arg("--project");
if (!projectArg) out({ ok: false, message: "--project <dir> is required" }, 2);
const projectDir = resolve(projectArg!);
// A Luxas project: what `luxas run` accepts. Anything else is refused before any read or write.
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory() || !existsSync(resolve(projectDir, "RESEARCH.md"))) {
  out({ ok: false, message: "not a Luxas project (no RESEARCH.md)" }, 2);
}

const act = arg("--act");
if (!act) out(buildBoard(projectDir));
const comment = process.argv.includes("--comment-stdin") ? readFileSync(0, "utf-8") : undefined;
const r = applyBoardAction(projectDir, { experiment: arg("--experiment") ?? "", action: act!, comment, by: arg("--by") });
out(r, r.ok ? 0 : 1);
