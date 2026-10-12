/**
 * Images and saved simulator models an experiment's newest run wrote, handed to
 * the experiment_reviewer as fixed steps. Consumer: the review loop in
 * tools/spawn-agent.ts. Images first; the models are at the end of this file.
 *
 * Why this exists (2026-10-06): under `--profile dual` the agents that write a
 * simulator script and run it (experiment, tool_impl) are on a text-only model
 * — agents/spawn.ts routes only the drawing agents to a model that sees. The
 * first Blender probe exited 0 twice and self-reported the right material
 * colour while the render showed a grey part; the only thing that caught it was
 * looking. The experiment_reviewer keeps its Anthropic tier, so it can look,
 * and `read` attaches an image for a model that accepts one.
 *
 * A fixed list in the task, not an instruction to "go and check the renders":
 * an open-ended verification instruction is what sent a reader agent into 66–72
 * call loops (CLAUDE.md, 反模式). Newest run only and capped, so the cost per
 * review round is bounded at a few images.
 *
 * LUXAS_REVIEW_IMAGES=0 turns the block off.
 */
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { namesKeyword, reachable, reviewerLine, softwareSheets, whereIs, type SoftwareSheet } from "./software.js";

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
export const REVIEW_IMAGE_CAP = 4;
const MAX_DEPTH = 3;

// The run directory is live while it is reviewed: a job the experiment left
// running can rename or delete an entry between readdir and stat, and an agent
// can leave a dangling symlink. One unreadable entry costs that entry — never
// the other images, and never the review (this is built inside the reviewer's
// prompt, after the round-1 blind estimates are paid for).
function statOrNull(p: string): Stats | null {
  try { return statSync(p); } catch { return null; }
}
function listOrEmpty(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}
function isSymlink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** The run_<n> directories, highest number first (run_10 before run_9). */
function runDirs(runsDir: string): string[] {
  const out: { n: number; dir: string }[] = [];
  for (const d of listOrEmpty(runsDir)) {
    const m = d.match(/^run_(\d+)$/);
    if (m && statOrNull(join(runsDir, d))?.isDirectory()) out.push({ n: Number(m[1]), dir: join(runsDir, d) });
  }
  return out.sort((a, b) => b.n - a.n).map((r) => r.dir);
}
const newestRunDir = (runsDir: string): string | null => runDirs(runsDir)[0] ?? null;

function walk(dir: string, depth: number, out: string[]): void {
  for (const name of listOrEmpty(dir).sort()) {
    const p = join(dir, name);
    const st = statOrNull(p);
    if (!st) continue;
    // Not through a symlink: "self -> ." listed one image four times and filled the cap.
    if (st.isDirectory()) { if (depth < MAX_DEPTH && !isSymlink(p)) walk(p, depth + 1, out); }
    else if (IMAGE_RE.test(name) && st.size > 0) out.push(p);
  }
}

/** Project-relative paths of the images in data/experiments/<id>/runs/run_<max>/, name order, at most `cap`. */
export function collectRunImages(projectDir: string, experimentId: string, cap = REVIEW_IMAGE_CAP): { shown: string[]; total: number } {
  const runsDir = join(projectDir, "data", "experiments", experimentId, "runs");
  if (!existsSync(runsDir)) return { shown: [], total: 0 };
  const newest = newestRunDir(runsDir);
  if (!newest) return { shown: [], total: 0 };
  const found: string[] = [];
  walk(newest, 0, found);
  return { shown: found.slice(0, cap).map((p) => relative(projectDir, p)), total: found.length };
}

/** Task text for the reviewer, or "" when the newest run wrote no image (or the block is switched off). */
export function reviewImagesBlock(projectDir: string, experimentId: string): string {
  if (process.env.LUXAS_REVIEW_IMAGES === "0") return "";
  const { shown, total } = collectRunImages(projectDir, experimentId);
  if (shown.length === 0) return "";
  return `

<run_images>
The newest run of this experiment wrote the image${total === 1 ? "" : "s"} below. The agents that produced ${total === 1 ? "it" : "them"} may be on a text-only model, so assume nobody has looked. Open each one with \`read\` before you vote, and give one line per image in FEEDBACK: what it shows, and whether that is what the L2 section says the run produced. An image that contradicts the section — the wrong object, a blank or black frame, a colour or a shape the section does not describe — is a REVISE, with the image path in the feedback.
${shown.map((p) => `- ${p}`).join("\n")}${total > shown.length ? `\n(${total - shown.length} more in the same run directory, not listed.)` : ""}
</run_images>`;
}

// ── Saved simulator models ───────────────────────────────────────────────
//
// An image costs the reviewer one `read`. A model file (.blend, .mph, .zmx) has
// to be re-opened in the program that owns it, and that is the only way to learn
// what was built: the first Blender probe exited 0 twice and reported a colour
// the render did not have. In the default pipeline tool_review's blind tests
// re-open what a tool saves; on the solo executor and on the hand route (the
// primary one) there is no tool_review, and this reviewer is the only seat that
// did not write the file.
//
// Which extensions count comes from the method sheets (`artifacts:`), so a new
// program needs a sheet and no code. The reviewer is asked to re-measure only by
// a sheet somebody has run (`verified:`) for a program that can be started from
// here; otherwise the file is listed with the reason nobody will open it. The
// instruction is fixed and bounded for the same reason the image list is.
//
// What the reviewer found goes into one line, `artifact <path>: …`, written
// before its VERDICT line. Reader: runExperimentReviewLoop, which copies those
// lines into reviews/experiment_review_<EID>_r<N>.md and into the result the
// brain reads. Until that reader existed "measured and agrees" and "could not
// open it" both came back as SATISFIED with nothing else.
//
// LUXAS_REVIEW_ARTIFACTS=0 turns the block off. Whether it earns its place is a
// declared measurement (planted faults, block on against block off): CLAUDE.md,
// 仿真软件通道.

export const REVIEW_ARTIFACT_CAP = 2;
const COPY_LIMIT_BYTES = 100 * 1024 * 1024;
const MODEL_SKIP_DIRS = /^(\..*|node_modules|site-packages|__pycache__)$/;
const UNPRINTABLE_PATH = /[\x00-\x1f\x7f\u0085\u2028\u2029]|<\/?[A-Za-z_][\w-]*>/;

/**
 * A test for "this text holds `needle` as a whole name", not as part of a longer one: with results.json
 * naming final_model.blend, model.blend counted as named. A full stop after the name ends a sentence
 * ("saved as flange.blend."); followed by a letter or a digit it is more of the name (flange.blend.bak).
 * One pattern per needle: a sweep leaves the same file name once per point.
 */
function wholeNameIn(text: string): (needle: string) => boolean {
  const seen = new Map<string, boolean>();
  return (needle) => {
    let hit = seen.get(needle);
    if (hit === undefined) {
      try { hit = new RegExp(`(?<![\\p{L}\\p{N}_.-])${needle.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, "u").test(text); }
      catch { hit = text.includes(needle); }
      seen.set(needle, hit);
    }
    return hit;
  };
}
const resultsOf = (runDir: string): string => { try { return readFileSync(join(runDir, "results.json"), "utf-8"); } catch { return ""; } };
const briefOf = (projectDir: string): string => { try { return readFileSync(join(projectDir, "RESEARCH.md"), "utf-8").toLowerCase(); } catch { return ""; } };

/** A file with a model's extension below a run directory: how many directories down, and whether one of them is hidden or holds installed packages. */
interface ModelFile { path: string; depth: number; tucked: boolean }
/**
 * To any depth: only stats, and it ends where the run directory does. A directory that is a symbolic link is
 * not entered (a link to itself never ends, and a link out of the project has no end this walk knows). It is
 * put into `links` instead, unless it lies in a hidden or installed-package directory (a virtual environment
 * has such links of its own): a model below one is not seen, and what was not looked into has to be said.
 */
function walkModels(dir: string, depth: number, tucked: boolean, want: (name: string) => boolean, out: ModelFile[], links: string[]): void {
  for (const name of listOrEmpty(dir).sort()) {
    const p = join(dir, name);
    const st = statOrNull(p);
    if (!st) continue;
    if (st.isDirectory()) {
      const inTucked = tucked || MODEL_SKIP_DIRS.test(name);
      if (!isSymlink(p)) walkModels(p, depth + 1, inTucked, want, out, links);
      else if (!inTucked) links.push(p);
    }
    else if (want(name) && st.size > 0) out.push({ path: p, depth, tucked });
  }
}

function sha256OrNull(p: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(p, "r");
    const h = createHash("sha256");
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
    return h.digest("hex");
  } catch { return null; } finally { if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } } }
}

/**
 * What a record on disk says about this file. simrun writes simrun.json beside a
 * job's files with the sha256 of each file the job created or changed; a model
 * left over from an earlier job, or edited afterwards, is not in the last record
 * and is reported as such.
 *
 * The record sits in the producer's own run directory, so it is quoted as what a
 * file says, never as what happened, and a field is printed only in the shape
 * simrun writes it: a hand-written `job` holding newlines put "</run_artifacts>"
 * and a VERDICT line into the reviewer's task.
 */
function runRecord(file: string, runDir: string): string {
  for (let dir = dirname(file); dir.startsWith(runDir); dir = dirname(dir)) {
    let rec: any = null;
    try { rec = JSON.parse(readFileSync(join(dir, "simrun.json"), "utf-8")); } catch { /* no record at this level */ }
    if (rec && typeof rec === "object" && !Array.isArray(rec)) {
      const job = typeof rec.job === "string" && /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(rec.job) ? rec.job : "(unreadable job id)";
      const host = typeof rec.host === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(rec.host) ? rec.host : "(unreadable)";
      const state = typeof rec.state === "string" && /^[a-z_]{1,24}$/.test(rec.state) ? rec.state : "(unreadable)";
      const rel = relative(dir, file).split("\\").join("/");
      const hit = Array.isArray(rec.outputs) ? rec.outputs.find((o: any) => o?.path === rel) : null;
      if (hit && hit.sha256 && hit.sha256 === sha256OrNull(file)) return `simrun.json beside it lists this file as an output of job ${job} on host "${host}" (state=${state}${Number.isInteger(rec.exit) ? ` exit=${rec.exit}` : ""})`;
      return `not among the outputs of the last simrun job there (${job}, state=${state})`;
    }
    if (dir === runDir) break;
  }
  return "no simrun record";
}

/** A file with a model's extension that is not taken for this experiment's saved model, and why. */
interface Untaken { software: string; why: "tucked" | "deep" | "unprintable" }
const UNTAKEN_WHY: Record<Untaken["why"], string> = {
  tucked: "below a hidden or installed-package directory without being named in results.json",
  deep: `more than ${MAX_DEPTH} directories below the run directory, with neither results.json naming the file nor the brief naming its program`,
  unprintable: "under a name that cannot be printed",
};

interface RunArtifact {
  path: string; rel: string; sheet: SoftwareSheet; bytes: number; mtimeMs: number;
  /** Its real path is not inside the project (a symlink out of it, or a data/ directory that is one): listed, never copied. */
  outside: boolean;
}

/**
 * Model files whose extension a sheet declares, in the newest run directory that
 * holds one (`from`), name order. Not always the newest run: a revision round
 * that wrote run_2 with results.json only had left its model in run_1, and the
 * reviewer was told there was no saved model to re-open.
 *
 * `unlisted` holds the files with such an extension that are not taken, each
 * with the program and the reason, and `linked` counts the directories that are
 * symbolic links and were not looked into: both of the run directories newer
 * than `from` (of every run directory when `from` is null). The texts that say
 * "no model file" read them, so that what is there, or was not looked at, is
 * never called absent. Of the newest run alone they said "the latest run that
 * did" of run_1 while run_2, between the two, held its model in a hidden directory.
 */
export function collectRunArtifacts(projectDir: string, experimentId: string, sheets: SoftwareSheet[] = softwareSheets()): { newest: string | null; from: string | null; found: RunArtifact[]; unlisted: Untaken[]; linked: number } {
  const byExt = new Map<string, SoftwareSheet>();
  for (const s of sheets) for (const e of s.artifacts) if (!byExt.has(e)) byExt.set(e, s);
  const runsDir = join(projectDir, "data", "experiments", experimentId, "runs");
  const dirs = existsSync(runsDir) ? runDirs(runsDir) : [];
  const newest = dirs[0] ?? null;
  if (!newest || byExt.size === 0) return { newest, from: null, found: [], unlisted: [], linked: 0 };
  // A link to ../run_1/model.blend is what a revision that kept its model should leave, and is followed.
  // A link out of the project is not: its target, anywhere on disk, was copied and handed to the reviewer.
  let root = "";
  try { root = realpathSync(projectDir) + sep; } catch { /* then nothing counts as inside, and nothing is copied */ }
  const inside = (p: string): boolean => { try { return root !== "" && realpathSync(p).startsWith(root); } catch { return false; } };
  const brief = briefOf(projectDir);
  const inBrief = new Map<SoftwareSheet, boolean>();
  const briefNames = (s: SoftwareSheet): boolean => {
    if (!inBrief.has(s)) inBrief.set(s, s.keywords.some((k) => namesKeyword(brief, k)));
    return inBrief.get(s)!;
  };
  const newestResults = resultsOf(newest);
  const unlisted: Untaken[] = [];
  let linked = 0;
  for (const dir of dirs) {
    const all: ModelFile[] = [], links: string[] = [];
    walkModels(dir, 0, false, (name) => byExt.has(extname(name).toLowerCase()), all, links);
    const named = wholeNameIn(dir === newest ? newestResults : `${newestResults}\n${resultsOf(dir)}`);
    const found: RunArtifact[] = [];
    const passedOver: Untaken[] = [];
    for (const f of all) {
      const sheet = byExt.get(extname(f.path).toLowerCase())!;
      const rel = relative(projectDir, f.path);
      // Which files with a model's extension are this experiment's saved models:
      // - Within three directories of run_N/ (the depth of the image walk): every one.
      // - Deeper: when the brief names the program, or results.json names the file. The experiment is told
      //   "under runs/run_N/", and with three levels only a model at run_1/jobs/sweep_03/out/final/ was
      //   reported as not saved and the experiment was sent back to save it where it already was. Without
      //   that condition a data set's own lego.blend, or the hash.mph of an index, five directories down put
      //   this block into the review of a project that names no simulator.
      // - Below a hidden or installed-package directory: only when results.json names the file. Packages ship
      //   files in a simulator's own format; a model the experiment points at is its model wherever it is.
      // - Never under a path that cannot be printed: it goes into the reviewer's task, where a line break
      //   could write lines of its own (the reply sanitiser's set: U+2028 and U+2029 break a line for a
      //   JavaScript /^…/m as well) and a tag could close the block.
      const why: Untaken["why"] | null = UNPRINTABLE_PATH.test(rel) ? "unprintable"
        : f.tucked ? (named(basename(f.path)) ? null : "tucked")
        : f.depth <= MAX_DEPTH || briefNames(sheet) || named(basename(f.path)) ? null : "deep";
      if (why) { passedOver.push({ software: sheet.software, why }); continue; }
      const st = statOrNull(f.path);
      found.push({ path: f.path, rel, sheet, bytes: st?.size ?? 0, mtimeMs: st?.mtimeMs ?? 0, outside: !inside(f.path) });
    }
    if (found.length > 0) return { newest, from: dir, found, unlisted, linked };
    unlisted.push(...passedOver);
    linked += links.length;
  }
  return { newest, from: null, found: [], unlisted, linked };
}

/** Where the reviewer's copies for one experiment live. */
export function reviewCopyDir(projectDir: string, experimentId: string): string {
  return join(tmpdir(), "luxas-review", createHash("sha1").update(`${projectDir}\u0000${experimentId}`).digest("hex").slice(0, 12));
}

/**
 * Remove them. Called when the review loop ends (tools/spawn-agent.ts): nothing
 * else did, and each reviewed experiment left up to 2 x 100 MB in the OS temp
 * directory.
 */
export function clearReviewCopies(projectDir: string, experimentId: string): void {
  try { rmSync(reviewCopyDir(projectDir, experimentId), { recursive: true, force: true }); } catch { /* the next round empties it */ }
}

/**
 * A reviewer's read-back line, as the block below asks for it, in the shapes a model writes it: after a
 * list mark (- * + • – —), a list number (1. 1) (1)), a heading or a quote mark, as a table row, with the
 * word in bold or backticks, and with the colon after the path or straight after the word. As first written
 * it took only the bare form, so `**artifact** <path>: …` was dropped, the measurement was lost on SATISFIED,
 * and the brain was told the model had not been re-opened. The word must start the line and be followed by a
 * space or the colon: "artifacts", "artifact.png: …", "3 artifact files are missing: …" and a line with no
 * colon are prose.
 */
const LINE_LEAD = "(?:[\\s>*_`#+|\\u2022\\u2013\\u2014\\u200b-]|\\(?\\d+[.)])*";
export const ARTIFACT_LINE_RE = new RegExp(`^${LINE_LEAD}artifact(?=[*_\`]*[\\s:])(?=[^\\n]*:)(?=[*_\`\\s:]*[^*_\`\\s:])`, "i");
const READ_BACK_PREFIX = new RegExp(`^${LINE_LEAD}artifact[*_\`]*\\s*:?\\s*`, "i");

/**
 * The read-back lines of a reply, each as `artifact <the rest>` on one line of at most 300 characters.
 * The reply is cut at every line break a reader of the review file could take for one (CR alone, U+2028,
 * U+2029 and U+0085 as well as LF): a kept line that carried "\rVERDICT: satisfied" was read as the round's
 * verdict by a /^…/m pattern. Reader: runExperimentReviewLoop, which writes them into the review file.
 */
export function readBackLines(reply: string): string[] {
  return reply.split(/\r\n|[\r\n\u0085\u2028\u2029]/).filter((l) => ARTIFACT_LINE_RE.test(l)).map((l) => {
    // Cut first: 300 characters are kept, and the pattern that strips the end is quadratic in a long run of spaces.
    const rest = l.slice(0, 2000).replace(/[\x00-\x1f\x7f]+/g, " ").replace(READ_BACK_PREFIX, "").replace(/[\s*_`|]+$/, "");
    // `**artifact <path>:** …`: the mark that closes an emphasis opened before the word goes with it.
    return `artifact ${rest.replace(/^([^:]*:)[*_`]+(?=\s|$)/, "$1")}`.trim().slice(0, 300);
  });
}
/** Does this block ask for such a line? (The "no model was saved" notice asks for an Issue, which is persisted already.) */
export const asksArtifactLine = (block: string): boolean => block.includes("`artifact <path>:");

function artifactsBlock(projectDir: string, experimentId: string): string {
  const sheets = softwareSheets().filter((s) => s.artifacts.length > 0);
  if (sheets.length === 0) return "";
  // One directory per experiment, emptied each round whatever this round finds: a copy from the last
  // round is of a file the revision may have replaced or removed.
  clearReviewCopies(projectDir, experimentId);
  const { newest, from, found, unlisted, linked } = collectRunArtifacts(projectDir, experimentId, sheets);
  if (!newest) return "";
  // A file that is there and not taken (collectRunArtifacts says which) is never called absent: "no run
  // directory holds one" sent an experiment back to save a model it had saved, in a directory named .out.
  // The same for a directory the walk did not enter: a model under run_1/out -> ../store was "not saved".
  const untaken = (list: Untaken[]): string =>
    `${list.length} such file${list.length === 1 ? " is" : "s are"} there in a place this block does not take one from: ${(["tucked", "deep", "unprintable"] as const).filter((w) => list.some((u) => u.why === w)).map((w) => UNTAKEN_WHY[w]).join(", or ")}`;
  const notLooked = linked === 0 ? "" : `${linked} director${linked === 1 ? "y there is a symbolic link and was" : "ies there are symbolic links and were"} not looked into`;

  if (!from) {
    // Not saving the model must not be the way to skip the re-open: say that the file is absent, and
    // what that does to the verdict (the checklist calls every item revise-worthy; this is one the
    // experiment can fix).
    const brief = briefOf(projectDir);
    const named = sheets.filter((s) => s.keywords.some((k) => namesKeyword(brief, k)));
    if (named.length === 0) return "";
    const names = named.map((s) => s.software).join(" / ");
    const exts = [...new Set(named.flatMap((s) => s.artifacts))].join(" / ");
    // Of the programs the brief names only: a file of another program's format is not "such a file".
    const theirs = unlisted.filter((u) => named.some((s) => s.software === u.software));
    const aside = [theirs.length > 0 ? untaken(theirs) : "", notLooked].filter(Boolean);
    const holds = aside.length > 0
      ? `no run directory of this experiment holds a ${exts} file this block can hand you (newest: ${relative(projectDir, newest)}; ${aside.join("; ")})`
      : `no run directory of this experiment holds a ${exts} file (newest: ${relative(projectDir, newest)})`;
    const where = `under runs/run_N/${theirs.length > 0 ? ", outside hidden directories, under a plain name" : ""}${linked > 0 ? ", in a directory that is not a symbolic link" : ""}`;
    return `

<run_artifacts>
The brief names ${names}, and ${holds}. If the L2 section reports a result obtained with ${names}, there is no saved model to re-open and that number is an unverified witness (audit checklist item 8): that is a REVISE, Issue = save the model file the result rests on ${where}. If the section reports no such result, this changes nothing.
</run_artifacts>`;
  }

  // Which files the reviewer gets is decided by what the result rests on, not by file name: an experiment
  // that saved 01_blank, 02_bored and flange_final had its two intermediates copied and was asked to
  // re-open "the one the headline result rests on". Named in results.json first, then the newest.
  const holds = wholeNameIn(from === newest ? resultsOf(newest) : `${resultsOf(newest)}\n${resultsOf(from)}`);
  // By the whole file name. Where several files share that name, by the path as well: a sweep leaves
  // jobs/sweep_NN/out/final/flange.blend once per point, by the name every one of them counted as the file
  // results.json names, and the two newest were handed over in place of the one it names. A file whose path
  // below the run directory results.json holds is named (0); a file of the same name whose path it does
  // not hold is named in name only (1), ahead of the files not named at all (2). The path is used for
  // nothing else: files that share no name rank as they did.
  const below = (a: RunArtifact): string => relative(from, a.path).split(sep).join("/");
  const byName = found.filter((a) => holds(basename(a.path)));
  const byPath = new Set(byName.filter((a) => holds(below(a))));
  const pathDecides = new Set([...byPath].map((a) => basename(a.path)));
  const namedAs = new Map(found.map((a) => [a, 2] as [RunArtifact, number]));
  for (const a of byName) namedAs.set(a, pathDecides.has(basename(a.path)) && !byPath.has(a) ? 1 : 0);
  const named = (a: RunArtifact): number => namedAs.get(a)!;
  // Then the files somebody can open: two newer models of a program nobody can start hid the one that could be measured.
  const startable = new Map<string, boolean>();
  for (const a of found) if (!startable.has(a.sheet.software)) startable.set(a.sheet.software, reachable(whereIs(a.sheet)));
  const openable = (a: RunArtifact): number => (!a.outside && a.sheet.verified && startable.get(a.sheet.software) && a.bytes <= COPY_LIMIT_BYTES ? 0 : 1);
  // Ranked once per file, not once per comparison: the walk has no depth limit and a run can hold many models.
  const rank = new Map(found.map((a) => [a, [named(a), openable(a)]] as const));
  const shown = [...found].sort((a, b) => rank.get(a)![0] - rank.get(b)![0] || rank.get(a)![1] - rank.get(b)![1] || b.mtimeMs - a.mtimeMs || a.rel.localeCompare(b.rel)).slice(0, REVIEW_ARTIFACT_CAP);
  // The reviewer opens a copy: one that saves by mistake writes there, not into runs/.
  const copyDir = reviewCopyDir(projectDir, experimentId);
  const measurable = new Map<string, SoftwareSheet>();
  const lines = shown.map((a, i) => {
    if (a.outside) return `- ${a.rel} — ${a.sheet.software}\n  not re-opened: its real path is outside the project directory`;
    const where = whereIs(a.sheet);
    const head = `- ${a.rel} — ${a.sheet.software}; ${runRecord(a.path, from)}`;
    if (!a.sheet.verified) return `${head}\n  not re-opened: no row of the ${a.sheet.software} sheet has been run against the program`;
    if (!reachable(where)) return `${head}\n  not re-opened: ${a.sheet.software} cannot be started from this machine`;
    if (a.bytes > COPY_LIMIT_BYTES) return `${head}\n  not re-opened: ${Math.round(a.bytes / 1e6)} MB is over the copy limit`;
    try {
      mkdirSync(copyDir, { recursive: true });
      const copy = join(copyDir, `${i + 1}-${basename(a.path)}`);
      copyFileSync(a.path, copy);
      measurable.set(a.sheet.software, a.sheet);
      return `${head}\n  copy to open: ${copy}`;
    } catch (e) {
      return `${head}\n  not re-opened: the copy failed (${(e as Error).message.slice(0, 80)})`;
    }
  });
  const more = found.length > shown.length ? `\n(${found.length - shown.length} more model file${found.length - shown.length === 1 ? "" : "s"} in the same run directory, not listed.)` : "";
  // "The latest run that did" only when nothing with a model's extension, and no directory left unread, lies in a later run.
  const aside = [unlisted.length > 0 ? untaken(unlisted) : "", notLooked].filter(Boolean);
  const which = from === newest
    ? `The newest run of this experiment saved the model file${shown.length === 1 ? "" : "s"} below.`
    : aside.length > 0
      ? `No run of this experiment after ${relative(projectDir, from)} holds a model file this block can hand you (newest: ${relative(projectDir, newest)}; ${aside.join("; ")}). The file${shown.length === 1 ? "" : "s"} below ${shown.length === 1 ? "is" : "are"} from ${relative(projectDir, from)}, an earlier run.`
      : `The newest run of this experiment (${relative(projectDir, newest)}) saved no model file. The file${shown.length === 1 ? "" : "s"} below ${shown.length === 1 ? "is" : "are"} from ${relative(projectDir, from)}, the latest run that did.`;
  const intro = `${which} A script's report of what it built is not the file.`;

  if (measurable.size === 0) {
    return `

<run_artifacts>
${intro}
${lines.join("\n")}${more}
Nobody has re-opened ${shown.length === 1 ? "this file" : "these files"}, and you cannot from here. Do not try. A headline number that rests on ${shown.length === 1 ? "it" : "them"} is an unverified witness (audit checklist item 8): say so in one line before your VERDICT line, \`artifact <path>: not re-opened — <the reason above>\`. The harness records that line. This alone is not a reason to vote REVISE: the experiment cannot change it.
</run_artifacts>`;
  }

  const howTo = [...measurable.values()].map((s) => `--- ${s.file}: how to measure a saved file ---\n${reviewerLine(s, whereIs(s), copyDir)}\n${s.verification || "(this sheet has no verification section)"}`).join("\n\n");
  return `

<run_artifacts>
${intro}
${lines.join("\n")}${more}

Re-open ONE of the copies, the one the headline result rests on, in a fresh process. Never open or save the file under runs/. Measure the property the frozen acceptance criterion says the model must have, by the row below that fits it. Do not read back a value the producer's script set or stored (a material's base colour, a declared radius): that agrees with the report even when the file is wrong. If the criterion is functional (the parts fit, mesh, focus, stand), test the function at one configuration. Use a few lines of your own, inline or in a temp directory; run nothing under data/experiments/${experimentId}/scripts/. At most 6 bash calls for this; if it has not worked by then, stop.
Then write one line before your VERDICT line: \`artifact <path>: <property> measured <value>, reported <value>\`, or \`artifact <path>: not measured — <the program's last line>\`. The harness records that line. Not being able to measure the file is not by itself a reason to vote REVISE; a file the program reports as damaged or empty is. A measured value that contradicts the reported one beyond the section's stated tolerance is audit checklist item 8: VERDICT: revise, with both numbers in an Issue. This is a read-back of the producer's own file, not a second estimate: write no ESTIMATE: or INDEPENDENT: line from it.

${howTo}
</run_artifacts>`;
}

/**
 * Task text for the reviewer about the newest run's saved models, or "". Never
 * throws: it is evaluated inside the reviewer's prompt, after the round's blind
 * estimates are paid for.
 */
export function reviewArtifactsBlock(projectDir: string, experimentId: string): string {
  if (process.env.LUXAS_REVIEW_ARTIFACTS === "0") return "";
  try { return artifactsBlock(projectDir, experimentId); } catch { return ""; }
}
