/**
 * The contradiction sweep as one model request (2026-10-21).
 *
 * The agentic contradiction_auditor gathered its read set (report.tex, the
 * ledger, every results.json) through tool calls. On the 2026-10-20
 * blender-02 run that set was 54 KB, yet three of its eight spawns ran 32–39
 * bash calls, hit maxTurns and wrote nothing ($1.31 of the auditor's $1.58),
 * and the brain then told the next ones to "write status: clean first". Here
 * the harness reads the files, sends them in one request and writes the
 * frontmatter itself: status from the answer's own counts, sources_md5 from
 * evidenceSourcesDigest. The rules stay in contradiction_auditor.md (its
 * opening and <scope>); the agent still runs when the sources are too large
 * for one request, or with LUXAS_SWEEP_MODE=agent.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { getDefinition } from "./agents/registry.js";
import { resolveModel } from "./agents/spawn.js";
import { addAgent, removeAgent } from "./active-agents.js";
import { recordAgentOutcome } from "./agent-liveness.js";
import { parseResultsJson } from "./claims-table.js";
import { jobOwnerAls } from "./jobs/als.js";
import { evidenceSourcesDigest } from "./tools/report-integrity.js";
import { extractFrontmatterBlock, extractTextContent, parseAuditFrontmatter } from "./utils.js";

/** ≈ 130k tokens. Every local project's report + ledger + latest runs fits (largest 2026-10-21: ~250k). */
export const SWEEP_MAX_CHARS = 450_000;

export function sweepMode(): "single-request" | "agent" {
  return process.env.LUXAS_SWEEP_MODE === "agent" ? "agent" : "single-request";
}

export interface SweepRequest {
  system: string;
  user: string;
  /** evidenceSourcesDigest, taken before the files were read: an edit during the request leaves the sweep stale, not falsely current. */
  digest: string;
  shown: string[];
  /** Earlier runs that neither the ledger nor the report names by path. */
  superseded: string[];
  chars: number;
}

/**
 * Per experiment: the latest run, plus any run the ledger or report names by
 * path. A superseded run's own values are not current, so showing it only
 * invites false contradictions; a report value copied from one still
 * disagrees with the latest run, which is shown.
 */
export function runsToShow(projectDir: string, mentions: string): { shown: string[]; superseded: string[] } {
  const shown: string[] = [];
  const superseded: string[] = [];
  const root = join(projectDir, "data", "experiments");
  if (!existsSync(root)) return { shown, superseded };
  for (const exp of readdirSync(root).sort()) {
    const runsDir = join(root, exp, "runs");
    if (!existsSync(runsDir)) continue;
    const runs = readdirSync(runsDir)
      .filter((r) => /^run_\d+$/.test(r) && existsSync(join(runsDir, r, "results.json")))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    runs.forEach((run, i) => {
      const rel = `data/experiments/${exp}/runs/${run}/results.json`;
      const esc = `${exp}/runs/${run}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const named = new RegExp(`${esc}(?!\\d)`).test(mentions);
      (i === runs.length - 1 || named ? shown : superseded).push(rel);
    });
  }
  return { shown, superseded };
}

/** Long numeric arrays and strings shortened, marked "…"; named scalar leaves (what the sweep compares) kept whole. */
export function compactResults(value: unknown, level: 0 | 1): unknown {
  const nums = level === 0 ? 12 : 6;
  const items = level === 0 ? 40 : 12;
  const str = level === 0 ? 1500 : 400;
  const walk = (x: any): any => {
    if (Array.isArray(x)) {
      if (x.length > nums && x.every((e) => typeof e === "number" || e === null)) {
        return [...x.slice(0, 3), `… ${x.length - 4} more numbers …`, x[x.length - 1]];
      }
      if (x.length > items) return [...x.slice(0, items).map(walk), `… ${x.length - items} more items`];
      return x.map(walk);
    }
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, e] of Object.entries(x)) o[k] = walk(e);
      return o;
    }
    if (typeof x === "string" && x.length > str) return `${x.slice(0, str)}… (${x.length} chars)`;
    return x;
  };
  return walk(value);
}

/** The definition's opening and <scope>: the rules both paths judge by. Its <workflow> is the agent's tool procedure. */
function sweepRules(): string {
  const body = getDefinition("contradiction_auditor").systemPromptTemplate;
  return body.split("<workflow>")[0].replace(/<environment>[\s\S]*?<\/environment>\s*/, "").trim();
}

const SINGLE_REQUEST_NOTE = `This sweep is one request. The files are in the user message, complete except where a long array or string is shortened (marked "…"). You have no tools and need none: read every file, then answer. Quote each value you cite from the text you were given, with its file and the section, table or JSON path where it sits.`;

const ANSWER_FORMAT = `<answer_format>
Answer with the body of reviews/contradiction_sweep.md and nothing else. Do not write frontmatter: the harness writes it from your COUNTS line.

## Summary
<one paragraph>

## Contradictions
### <quantity name>
- <value> @ <file + section/table/JSON path> (conditions: <...>)
- <value> @ <file + section/table/JSON path> (conditions: <...>)
Why incompatible: <one sentence>
Resolution required: reconcile to ONE value with a cited source (results.json leaf or literature entry), or state the differing conditions at BOTH sites.

One ### entry per contradiction, flagged upper-bound / non-existence claims included. Write "None." under the heading when there are none. Do not soften: a 2×+ unexplained gap on the same quantity is a contradiction even when you suspect a benign explanation; write the suspected explanation in the entry.

## Definition concerns
<only when there are any: both observable sentences quoted>

## Checked and consistent
<compact list — quantity: value, N sites>

The last line, exactly:
COUNTS quantities_checked=<N> contradictions_found=<M> definition_concerns=<K>
</answer_format>`;

/** null when the sources do not fit one request even shortened: the agentic auditor runs instead. */
export function buildSweepRequest(projectDir: string): SweepRequest | null {
  const digest = evidenceSourcesDigest(projectDir);
  const read = (rel: string) => { try { return readFileSync(join(projectDir, rel), "utf-8"); } catch { return null; } };
  const report = read("report/report.tex");
  const ledger = read("notes/experiments.md");
  const { shown, superseded } = runsToShow(projectDir, `${ledger ?? ""}\n${report ?? ""}`);
  const raw = shown.map((rel) => ({ rel, text: read(rel) ?? "" }));

  for (const level of [0, 1] as const) {
    const files: string[] = [];
    files.push(report === null
      ? `<file path="report/report.tex">\n(missing: there is no report/report.tex)\n</file>`
      : `<file path="report/report.tex">\n${report}\n</file>`);
    files.push(`<file path="notes/experiments.md">\n${ledger ?? "(missing)"}\n</file>`);
    for (const { rel, text } of raw) {
      let body: string;
      try { body = JSON.stringify(compactResults(parseResultsJson(text), level), null, 1); }
      catch { body = text.length > 20_000 ? `${text.slice(0, 20_000)}… (not valid JSON; ${text.length} chars)` : text; }
      files.push(`<file path="${rel}">\n${body}\n</file>`);
    }
    const supersededNote = superseded.length
      ? `\n\nEarlier runs not shown, because neither the ledger nor the report names them: ${superseded.join(", ")}. Their values are superseded; a report or ledger value that matches only one of them disagrees with the run shown.`
      : "";
    const user = `The project's sources, complete except where marked "…".\n\n${files.join("\n\n")}${supersededNote}\n\n${ANSWER_FORMAT}`;
    const system = `${sweepRules()}\n\n${SINGLE_REQUEST_NOTE}`;
    const chars = system.length + user.length;
    if (chars <= SWEEP_MAX_CHARS) return { system, user, digest, shown, superseded, chars };
  }
  return null;
}

export interface SweepAnswer {
  body: string;
  quantitiesChecked: number;
  contradictions: number;
  definitionConcerns: number;
}

function section(text: string, name: string): string | null {
  const m = new RegExp(`^##\\s+${name}\\b.*$`, "mi").exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * The answer's counts, read conservatively: a ### entry under
 * "## Contradictions" counts even when the COUNTS line says fewer. null when
 * the answer has neither the COUNTS line nor that section: nothing is written.
 */
export function parseSweepAnswer(text: string): SweepAnswer | null {
  const t = text.trim().replace(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i, "$1").trim();
  // Bench S1: the model wrapped the line in ** on a Dy item.
  const countsRe = /^[ \t]*[`*_]*COUNTS\s+quantities_checked\s*=\s*(\d+)\s+contradictions_found\s*=\s*(\d+)\s+definition_concerns\s*=\s*(\d+)[`*_]*[ \t]*$/m;
  const counts = countsRe.exec(t);
  const contra = section(t, "Contradictions");
  if (!counts && contra === null) return null;
  const entries = contra ? contra.split("\n").filter((l) => /^###\s+\S/.test(l) && !/^###\s+none\.?\s*$/i.test(l)).length : 0;
  return {
    body: t.replace(countsRe, "").trim(),
    quantitiesChecked: counts ? Number(counts[1]) : 0,
    contradictions: Math.max(counts ? Number(counts[2]) : 0, entries),
    definitionConcerns: counts ? Number(counts[3]) : 0,
  };
}

export function writeSweepFile(projectDir: string, req: Pick<SweepRequest, "digest" | "shown" | "superseded">, a: SweepAnswer, model: string): "clean" | "contradictions" {
  const status = a.contradictions === 0 ? "clean" : "contradictions";
  const front = [
    "---",
    `status: ${status}`,
    `sources_md5: ${req.digest}`,
    `quantities_checked: ${a.quantitiesChecked}`,
    `contradictions_found: ${a.contradictions}`,
    `definition_concerns: ${a.definitionConcerns}`,
    "mode: single-request",
    `model: ${model}`,
    "---",
    "",
  ].join("\n");
  const read = `\n\n_One request over report/report.tex, notes/experiments.md and ${req.shown.length} results.json` +
    (req.superseded.length ? `; earlier runs not read: ${req.superseded.join(", ")}._` : "._");
  const dir = join(projectDir, "reviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "contradiction_sweep.md"), `${front}${a.body}${read}\n`);
  return status;
}

export type SweepCompleter = (system: string, user: string) => Promise<{ text: string; error?: string }>;

let completerForGate: SweepCompleter | null = null;
/** smoke_contradiction_sweep only: replaces the provider call. */
export function setSweepCompleterForGate(fn: SweepCompleter | null): void { completerForGate = fn; }

function providerCompleter(model: any, apiKey: string | undefined, reasoning: string): SweepCompleter {
  return async (system, user) => {
    const call = async () => {
      const res: any = await completeSimple(model, {
        systemPrompt: system,
        messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
        tools: [],
      } as any, { apiKey, maxTokens: Math.min(model.maxTokens ?? 32_000, 32_000), reasoning, cacheRetention: "none" } as any);
      if (res.stopReason === "error") return { text: "", error: String(res.errorMessage ?? "provider error").slice(0, 300) };
      if (res.stopReason === "length") return { text: "", error: "the answer was cut off at maxTokens" };
      return { text: extractTextContent(res.content) };
    };
    let r = await call().catch((e: Error) => ({ text: "", error: String(e?.message ?? e).slice(0, 300) }));
    // One retry: a single request has no agent loop to retry a 5xx/overload for it.
    if (r.error && !/cut off/.test(r.error)) {
      await new Promise((ok) => setTimeout(ok, 15_000));
      r = await call().catch((e: Error) => ({ text: "", error: String(e?.message ?? e).slice(0, 300) }));
    }
    return r;
  };
}

/**
 * finish(): re-run a missing, unreadable or stale sweep before its gate reads
 * the file, so an edit to report.tex costs one request and no brain round trip
 * (blender-02: 8 sweep spawns, 5 of them after one-line or layout edits). A
 * current sweep, clean or not, is left alone. null when nothing ran: current,
 * agent mode, too large, or no key for the provider — a keyless process (the
 * offline gates) never calls out, and the gate's own refusal stands.
 */
export async function refreshSweepForFinish(
  projectDir: string,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
): Promise<string | null> {
  if (sweepMode() !== "single-request") return null;
  let src: string | null = null;
  try { src = readFileSync(join(projectDir, "reviews", "contradiction_sweep.md"), "utf-8"); } catch { /* missing */ }
  const block = src ? extractFrontmatterBlock(src) : null;
  const fm = block ? parseAuditFrontmatter(block) : null;
  if (fm?.status && fm.sources_md5 === evidenceSourcesDigest(projectDir)) return null;
  if (!completerForGate) {
    try {
      const def = getDefinition("contradiction_auditor");
      const model: any = resolveModel(def.model === "inherit" ? "sonnet" : def.model, "contradiction_auditor");
      if (!(await getApiKey(model.provider))) return null;
    } catch { return null; }
  }
  const r = await runSweepSpawn({ projectDir, parentAgentId: "brain", getApiKey });
  return "text" in r ? r.text : null;
}

/**
 * A spawn of contradiction_auditor, as one request. `fallback` → nothing was
 * written and the caller runs the agent: the sources do not fit, the request
 * failed twice, or the answer could not be read. A failure that repeats on
 * every call must not become a spawn-again loop. The brain's task text is not
 * sent: the verdict comes from the files (on blender-02 the task said which
 * status to write).
 */
export async function runSweepSpawn(ctx: {
  projectDir: string;
  parentAgentId?: string;
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined;
}): Promise<{ text: string; agentId: string } | { fallback: string }> {
  const { projectDir } = ctx;
  const req = buildSweepRequest(projectDir);
  if (!req) return { fallback: `the sources exceed ${SWEEP_MAX_CHARS} characters even shortened` };

  const def = getDefinition("contradiction_auditor");
  const agentId = `${ctx.parentAgentId ?? "brain"}.contradiction_auditor-${Math.random().toString(36).slice(2, 8)}`;
  const agentDir = join(projectDir, ".agent");
  const convPath = join(agentDir, "conversations", `${agentId}.jsonl`);
  const log = (path: string, obj: unknown) => { try { appendFileSync(path, JSON.stringify(obj) + "\n"); } catch { /* observability only */ } };
  try { mkdirSync(join(agentDir, "conversations"), { recursive: true }); } catch { /* observability only */ }
  log(convPath, { type: "spawn_init", agent: "contradiction_auditor", mode: "single-request", task: "(one request over the sweep's sources; the caller's task is not sent)", parentAgentId: ctx.parentAgentId, timestamp: Date.now() });
  log(join(agentDir, "log.jsonl"), { type: "tool_call", tool: "spawn_agent", phase: "started", args: { agent: "contradiction_auditor", agent_id: agentId, parent_agent_id: ctx.parentAgentId }, success: true, timestamp: new Date().toISOString() });
  let registered = false;
  try {
    addAgent(agentDir, { id: agentId, name: "contradiction_auditor", task: "contradiction sweep (one request)", mode: "foreground", startedAt: Date.now(), conversationFile: convPath, hostPid: process.pid, hostPpid: process.ppid, status: "running" });
    registered = true;
  } catch { /* observability only */ }

  const started = Date.now();
  let model: any = { id: "unknown" };
  try {
    let r: { text: string; error?: string };
    try {
      model = resolveModel(def.model === "inherit" ? "sonnet" : def.model, "contradiction_auditor");
      const complete = completerForGate ?? providerCompleter(model, await ctx.getApiKey(model.provider), def.thinkingLevel || "medium");
      r = await jobOwnerAls.run({ agentId, agentType: "contradiction_auditor", projectDir }, () => complete(req.system, req.user));
    } catch (err) {
      r = { text: "", error: String((err as Error)?.message ?? err).slice(0, 300) };
    }
    log(convPath, { role: "system", content: req.system });
    log(convPath, { role: "user", content: [{ type: "text", text: req.user }], timestamp: started });
    log(convPath, { role: "assistant", content: [{ type: "text", text: r.text }], error: r.error, timestamp: Date.now() });
    const secs = Math.round((Date.now() - started) / 1000);
    if (r.error) {
      recordAgentOutcome(projectDir, "contradiction_auditor", false, r.error);
      return { fallback: `the request failed: ${r.error}` };
    }
    const a = parseSweepAnswer(r.text);
    if (!a) {
      recordAgentOutcome(projectDir, "contradiction_auditor", false, "answer had no COUNTS line and no ## Contradictions section");
      return { fallback: `the answer had no COUNTS line and no "## Contradictions" section` };
    }
    const status = writeSweepFile(projectDir, req, a, String(model.id ?? "unknown"));
    recordAgentOutcome(projectDir, "contradiction_auditor", true);
    const head = `[agent: ${agentId}]\nstatus: ${status}, ${a.quantitiesChecked} quantities checked, ${a.contradictions} contradictions` +
      `${a.definitionConcerns ? `, ${a.definitionConcerns} definition concerns` : ""} (one request over ${req.shown.length + 2} files, ${secs}s). ` +
      `reviews/contradiction_sweep.md is written with the current sources_md5.`;
    const listed = status === "contradictions" ? `\n\n${(section(a.body, "Contradictions") ?? "").trim().slice(0, 6000)}` : "";
    return { agentId, text: head + listed };
  } finally {
    if (registered) try { removeAgent(agentDir, agentId); } catch { /* observability only */ }
  }
}
