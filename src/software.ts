/**
 * Where a simulation program is, for the prompts of the seats that drive it.
 *
 * Until 2026-10-09 a method sheet said nothing about the machine it was injected
 * on: blender.md reached agents on the droplet, which has no Blender, under
 * "environment-verified … do not abandon the tool", and the only warning was a
 * sentence frozen into the sheet on the day it was written. A sheet now names
 * its program in frontmatter and the harness computes the answer at spawn time.
 *
 * Two files, neither written here:
 *   ~/.sisyphus/software.json       the operator's list of hosts and the software on each. Hand-edited.
 *                                   Validated strictly by skills/compute-methods/scripts/simrun, the one
 *                                   program that acts on it.
 *   ~/.sisyphus/simrun/doctor.json  written by `simrun doctor <host>`: whether the runner's own
 *                                   first-contact test has passed on that host, and under which
 *                                   protocol number. simrun refuses jobs on an ssh host until it has,
 *                                   so the line below does not offer one.
 * Readers of this module: buildMethodsRegistry (agents/context-builders.ts) prints one
 * line under a software sheet; review-images.ts decides whether the reviewer is asked
 * to re-open a saved model.
 *
 * The reader is tolerant on purpose and extracts only what a prompt line needs (host
 * label, transport, software ids, launcher names). A file with a problem simrun would
 * refuse whole still yields a line here; the refusal, with its reason, then comes from
 * simrun at the first call. For a file simrun accepts the two agree: the line says
 * RUNS ON exactly when simrun would take the job (`simrun hosts --json`, "runs";
 * smoke_sim_wiring holds them together case by case). Nothing is probed: a context
 * builder runs synchronously inside every spawn, and a continued agent's prompt must
 * be byte-identical to its first one.
 *
 * Paths are resolved at call time. scripts/run-gates.mts points both at nonexistent
 * paths, so a developer's real file cannot change what `npm test` asserts.
 */
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** How an agent calls the runner from bash. $LUXAS_ROOT is set for every agent bash (tools/bash-hardened.ts). */
export const SIMRUN_CALL = "python3 $LUXAS_ROOT/skills/compute-methods/scripts/simrun";

/**
 * simrun's PROTOCOL number. A doctor record made under another number is no pass for
 * simrun (`doctor_state`), so it is none here: reading `ok` alone, every prompt would
 * say "passed simrun doctor" after a bump while every call was refused.
 * smoke_sim_wiring holds this against the number in the runner's source.
 */
export const SIMRUN_PROTOCOL = 1;

/**
 * simrun's `host_print`: what a doctor pass was made against (spec-simrun.md, section 1).
 * The first 16 hex of the sha256 of transport, ssh, os, python and workdir joined by
 * newlines, with simrun's defaults filled in (os posix; python `py -3` on Windows and
 * `python3` elsewhere, its tokens joined by one space). A label pointed at another
 * machine since the pass is a host doctor never touched.
 */
function hostPrint(h: any): string {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const os = h.os === undefined ? "posix" : text(h.os);
  const python = h.python === undefined ? (os === "windows" ? "py -3" : "python3") : text(h.python);
  return createHash("sha256").update([text(h.transport), text(h.ssh), os, python.split(/\s+/).filter(Boolean).join(" "), text(h.workdir)].join("\n")).digest("hex").slice(0, 16);
}

const softwareFile = (): string => process.env.LUXAS_SOFTWARE_FILE || join(homedir(), ".sisyphus", "software.json");
const stateDir = (): string => process.env.SIMRUN_STATE_DIR || join(homedir(), ".sisyphus", "simrun");

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

interface HostEntry {
  label: string; local: boolean; proven: boolean; launchers: string[];
  /** The entry says `"desktop": true`. simrun accepts the file and refuses every job: this build has no desktop worker. */
  desktop: boolean;
}
/** Would simrun start a job of this software on this host now? */
const startable = (h: { proven: boolean; desktop: boolean }): boolean => h.proven && !h.desktop;

// The same shapes simrun enforces. This reader is tolerant about everything else, but a
// label or a launcher name is printed into a prompt inside a command an agent will type:
// one that does not match is dropped, never quoted. (A reviewer's reproduction of exactly
// this, a label holding `rm -rf`, deleted the runner on 2026-10-09 when its printed line
// was executed.)
const LABEL_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const LAUNCHER_RE = /^[A-Za-z0-9_.-]{1,48}$/;
const BIN_RE = /^[A-Za-z0-9_.+-]{1,64}$/;

/** Hosts that list `softwareId`: those that can run a job first, then by label. */
function hostsFor(softwareId: string): HostEntry[] {
  const hosts = readJson(softwareFile())?.hosts;
  if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) return [];
  const doctor = readJson(join(stateDir(), "doctor.json"));
  const out: HostEntry[] = [];
  for (const label of Object.keys(hosts).sort()) {
    if (!LABEL_RE.test(label)) continue;
    const h = hosts[label];
    const sw = h?.software?.[softwareId];
    if (!sw || typeof sw !== "object" || Array.isArray(sw)) continue;
    const local = h.transport === "local";
    const launchers = sw.launchers && typeof sw.launchers === "object" && !Array.isArray(sw.launchers) ? Object.keys(sw.launchers).filter((n) => LAUNCHER_RE.test(n)) : [];
    // A local host needs no first-contact test: the local transport is what the gates run on this machine.
    // For an ssh host this is simrun's own rule (`require_doctor`), term by term: a pass, under this protocol,
    // made against this entry, and, when the software declares a check, one that ran that check. Reading
    // less (it was `ok` and `protocol`) the line said RUNS ON after a label was pointed at another machine,
    // and for software added to a host after its pass, while simrun refused every call.
    const rec = doctor?.[label];
    const declaresCheck = Array.isArray(sw.check) && sw.check.length > 0;
    const passed = rec?.ok === true && rec.protocol === SIMRUN_PROTOCOL && rec.host === hostPrint(h)
      && (!declaresCheck || (Array.isArray(rec.checked) && rec.checked.includes(softwareId)));
    out.push({ label, local, proven: local || passed, launchers, desktop: sw.desktop === true });
  }
  return out.sort((a, b) => Number(startable(b)) - Number(startable(a)));
}

function onPath(bin: string): boolean {
  if (!bin || bin.includes("/")) return false;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    // A relative entry is resolved against the working directory of whoever looks: this process is in the
    // Luxas checkout and an agent's bash is in the project. And X_OK alone is true of any directory.
    if (!dir || !isAbsolute(dir)) continue;
    try {
      const p = join(dir, bin);
      if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return true; }
    } catch { /* not in this directory */ }
  }
  return false;
}

/** What a sheet's frontmatter says about the program it is for. All three keys are optional. */
export interface SoftwareMeta { software: string | null; bins: string[]; artifacts: string[] }

// [ \t]*, not \s*: \s ran across the newline, and a key with nothing after it took the next line as its value.
const list = (fm: string, key: string): string[] =>
  (fm.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function softwareMeta(frontmatter: string): SoftwareMeta {
  const software = frontmatter.match(/^software:[ \t]*([a-z0-9][a-z0-9_-]*)[ \t]*$/m)?.[1] ?? null;
  return { software, bins: list(frontmatter, "bin").filter((b) => BIN_RE.test(b)), artifacts: list(frontmatter, "artifacts").map((e) => e.toLowerCase()).filter((e) => /^\.[a-z0-9]+$/.test(e)) };
}

/**
 * Does `text` name `keyword` as a word of its own? Both lower-cased. This is the rule for the keywords of a
 * program's sheet (readers: loadMethodSheets in agents/context-builders.ts, and the reviewer's saved-model
 * block in review-images.ts). By plain substring `blender` hit in "deblender" and in "BlenderBot", and one
 * hit puts the sheet into three seats and "The brief names blender" into every review of the project.
 *
 * An end of the keyword that is an ASCII letter or digit must not touch another one, with one exception:
 * digits may follow a keyword that ends in a letter. A version written straight after the name (Blender4.2,
 * COMSOL6.2, 用SolidWorks2022建模) names the program; with digits refused there, such a brief lost its
 * sheet in every seat and its review lost the saved-model block. A CJK character on either side is no
 * letter here: 用Blender建模 names it. A keyword that starts with a dot is a file extension: what stands
 * before it is a file's stem, and a letter, a digit, `_` or `(` after it make it another name
 * (`Image.blend(` is a function, `scene.blend1` a backup). Method sheets keep the substring rule they had
 * before a sheet could name a program; changing theirs changes what every existing project is given.
 */
export function namesKeyword(text: string, keyword: string): boolean {
  if (!keyword) return false;
  const left = /^[a-z0-9]/.test(keyword) ? "(?<![a-z0-9])" : "";
  const right = keyword.startsWith(".") ? "(?![a-z0-9_(])" : /[a-z]$/.test(keyword) ? "(?![a-z])" : /[0-9]$/.test(keyword) ? "(?![a-z0-9])" : "";
  try { return new RegExp(left + keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + right).test(text); } catch { return text.includes(keyword); }
}

export type Where =
  | ({ kind: "host" } & HostEntry)
  | { kind: "path"; bin: string }
  | { kind: "none"; bins: string[] };

/**
 * A host that can run jobs wins over PATH: the runner holds the seat there. A host that
 * cannot (not yet through doctor, or desktop-only) is named only when the program is not
 * on this machine either: writing a host down must not take away a program that starts
 * here, which is the state between editing software.json and the first doctor pass.
 */
export function whereIs(meta: SoftwareMeta): Where {
  const hosts = meta.software ? hostsFor(meta.software) : [];
  if (hosts[0] && startable(hosts[0])) return { kind: "host", ...hosts[0] };
  const bin = meta.bins.find(onPath);
  if (bin) return { kind: "path", bin };
  return hosts[0] ? { kind: "host", ...hosts[0] } : { kind: "none", bins: meta.bins };
}

/** Can a seat on this machine start the program now? A host simrun would refuse is declared, not reachable. */
export const reachable = (w: Where): boolean => w.kind === "path" || (w.kind === "host" && startable(w));

/** The line printed under a software sheet. One sentence an agent can act on; no date, no address, no path that moves. */
export function availabilityLine(meta: SoftwareMeta, w: Where): string {
  const id = meta.software ?? "it";
  // The SolidWorks case the key exists for: the host passes doctor and every job is refused.
  if (w.kind === "host" && w.desktop) return `[DECLARED on host "${w.label}": it needs the logged-on desktop session, which this build of the runner cannot start; do not call it; say so in your return]`;
  if (w.kind === "host" && w.proven) {
    const launchers = w.launchers.length ? `<${w.launchers.join(" | ")}>` : "<launcher>";
    const how = w.local ? "this machine, through the runner" : "passed simrun doctor";
    // The host is always named: with the software on two hosts simrun refuses a call that leaves the choice to it.
    return `[RUNS ON host "${w.label}" (${how}): ${SIMRUN_CALL} run <job dir> --software ${id} --host ${w.label} -- ${launchers} ...]`;
  }
  if (w.kind === "host") return `[DECLARED on host "${w.label}", not yet proven by simrun doctor: do not call it; say so in your return]`;
  if (w.kind === "path") return `[FOUND on this machine: "${w.bin}" is on PATH. Luxas has not started it: run the sheet's smoke test first]`;
  const looked = w.bins.length ? ` and ${w.bins.map((b) => `"${b}"`).join(" / ")} is not on PATH` : "";
  return `[NOT AVAILABLE here: no registered host provides it${looked}. If this task needs it, say so in your return; do not substitute another tool silently]`;
}

/**
 * The same fact for the reviewer of a saved model, which is handed the sheet's Verification section and
 * nothing else. The seat's FOUND line ends "run the sheet's smoke test first", and that section holds no
 * smoke test: the reviewer was sent looking for text it had not been given, inside a budget of six calls.
 * And a job directory is all a job is given, so for a host the copy has to be in it.
 */
export function reviewerLine(meta: SoftwareMeta, w: Where, copyDir: string): string {
  if (w.kind === "path") return `[FOUND on this machine: "${w.bin}" is on PATH; call it directly]`;
  if (w.kind === "host" && startable(w)) return `${availabilityLine(meta, w)}\nUse ${copyDir} (where the copy is) as <job dir> and write your script into it: the job directory is all a job is given.`;
  return availabilityLine(meta, w);
}

/** A sheet that names a program, read whole: for the reviewer's artifact block, which is not keyed on the brief. */
export interface SoftwareSheet extends SoftwareMeta {
  file: string;
  software: string;
  keywords: string[];
  /** Has a `verified:` date. The reviewer is asked to re-open a model only by a sheet somebody ran. */
  verified: boolean;
  /** The sheet's `## Verification…` section, without its heading; "" when the sheet has none. */
  verification: string;
}

const SHEETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "compute-methods");

export function softwareSheets(): SoftwareSheet[] {
  let files: string[] = [];
  try { files = readdirSync(SHEETS_DIR).filter((f) => f.endsWith(".md") && f !== "SKILL.md").sort(); } catch { return []; }
  const out: SoftwareSheet[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(SHEETS_DIR, file), "utf-8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const meta = softwareMeta(fm[1]);
      if (!meta.software) continue;
      const section = raw.match(/^## Verification[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1]?.trim() ?? "";
      out.push({ ...meta, software: meta.software, file, keywords: list(fm[1], "match").map((k) => k.toLowerCase()), verified: /^verified:\s*\d{4}-\d{2}-\d{2}/m.test(fm[1]), verification: section });
    } catch { /* a malformed sheet is skipped, as in loadMethodSheets */ }
  }
  return out;
}
