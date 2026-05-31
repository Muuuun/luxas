/**
 * Tool index — assembles all research tools for the brain agent.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { md5OrNull, extractFrontmatterBlock, parseAuditFrontmatter } from "../utils.js";
import type { Agent } from "@mariozechner/pi-agent-core";
import { createReportTools } from "./report.js";
import { createInitReportTool } from "./init-report.js";
import { createAuthorityEscalationTools } from "./authority-escalation.js";
import { createCodingToolsForProject } from "./coding.js";
import { createSpawnAgentTool, getActiveBackgroundAgents } from "./spawn-agent.js";
import { buildSafetyWrapper } from "../agents/safety-wrappers.js";
import { getDefinition } from "../agents/registry.js";
import { loadRegistry, removeAgent, isAlive, markFailed, formatExitHint } from "../active-agents.js";

/**
 * Parse `## L2.X` / `## E_N` experiment sections from notes/experiments.md
 * and extract each one's `**Status:**` line. Only `Pending` and `Complete`
 * are recognized statuses — any other value (`Deferred`, unrecognized text,
 * or missing line entirely) parses as `missing` and the finish gate blocks.
 *
 * History: "Deferred" was removed Apr-25 because brain abused it as escape
 * hatch with weak reasons. Then brain learned to delete the L2 section
 * entirely (audit-ledger erasure) and fabricate a "PI STOP verdict" to
 * justify finish. The finish gate now derives required experiments from
 * notes/plan.md (which the plan-PI gate already protects) instead of
 * trusting the brain-writable experiments.md ledger alone — see
 * parsePlanSections + the cross-check inside finish.
 */
interface ExperimentSection {
  header: string;
  status: "pending" | "complete" | "missing";
}

/**
 * Parse `### E_N` headers from notes/plan.md. These are the load-bearing
 * commitment statements: every E_N here implies the project promised to
 * answer that sub-question, and the finish gate requires a corresponding
 * `## L2.N` (Status: Complete) in notes/experiments.md.
 *
 * plan.md changes are PI-gated (see brain.md `<pi_review>`), so the set
 * of E_N is a trustworthy authority for "what experiments must complete".
 * The experiments.md ledger by contrast is brain-writable and was observed
 * being wiped to bypass finish — it can't be the sole source of truth.
 */
export function parsePlanSections(text: string): Array<{ id: string; index: number }> {
  const lines = text.split("\n");
  // Match `### E_N` (the documented heading form — see experiment.md) as well
  // as `### EN`. The previous /^###\s+(E\d+)\b/ matched only `EN` and silently
  // parsed ZERO sections on every underscore plan, making the finish-gate
  // commitment check a no-op on exactly those projects (including the two
  // highest-cost runs). The integer is the cross-reference key to `## L2.N`.
  const headerRE = /^###\s+E_?(\d+)\b/;
  const sections: Array<{ id: string; index: number }> = [];
  for (const line of lines) {
    const m = line.match(headerRE);
    if (m) {
      const index = parseInt(m[1], 10);
      sections.push({ id: `E${index}`, index });
    }
  }
  return sections;
}

export function parseExperimentSections(text: string): ExperimentSection[] {
  const lines = text.split("\n");
  // Treat h2 headers starting with L2.N or E_N as experiment sections; other
  // h2s (like "Overview") are narrative and exempt from the status contract.
  const headerRE = /^##\s+((?:L2\.\d+|E\d+)\b.*)$/;
  const statusRE = /^\*\*Status:\*\*\s*(Pending|Complete)\b/im;

  const sections: ExperimentSection[] = [];
  let curHeader: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    if (curHeader === null) return;
    const body = curBody.join("\n");
    const m = body.match(statusRE);
    if (!m) {
      sections.push({ header: curHeader, status: "missing" });
    } else {
      const kind = m[1].toLowerCase() as "pending" | "complete";
      sections.push({ header: curHeader, status: kind });
    }
  };
  for (const line of lines) {
    const m = line.match(headerRE);
    if (m) {
      flush();
      curHeader = m[1].trim();
      curBody = [];
    } else if (curHeader !== null) {
      curBody.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Parse the most recent PI verdict from `reviews/pi_feedback.md`. PI rewrites
 * the file each review with a top-level `## Verdict: <continue|steer|stop>`
 * line; older verdicts may be present in the file body if the model appended
 * rather than overwrote. We take the LAST match so stale earlier verdicts
 * never outvote the most recent.
 *
 * Returns null if the file is missing, unreadable, or has no parseable verdict.
 */
export function parseLatestPIVerdict(projectDir: string):
  | { verdict: "continue" | "steer" | "stop"; reviewPath: string; reviewMtimeMs: number }
  | null
{
  const p = join(projectDir, "reviews", "pi_feedback.md");
  let content: string;
  let mtimeMs: number;
  try {
    content = readFileSync(p, "utf-8");
    mtimeMs = statSync(p).mtimeMs;
  } catch {
    return null;
  }
  const matches = [...content.matchAll(/##\s*Verdict:\s*(continue|steer|stop)\b/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1][1].toLowerCase() as "continue" | "steer" | "stop";
  return { verdict: last, reviewPath: p, reviewMtimeMs: mtimeMs };
}

export interface ToolCallbacks {
  onFinish?: () => void;
}

/**
 * Fix δ — Directive-implication finish gate.
 *
 * When a session is launched with `--directive` containing research-implication
 * keywords (simulate / verify / compare / analyze / 模拟 / 验证 / 对比 / 实验 /
 * 分析), the directive is asking for NEW work — not for a re-write of an
 * existing report. The finish gate must therefore verify that at least one
 * experiment directory under data/experiments/ has been created or modified
 * since the session started. If none, brain is trying to ship without doing
 * the work the directive demanded.
 *
 * Observed failure that motivated this: on the Rb-单光子双比特门 project the
 * user appended a directive demanding Doppler-elimination scheme comparison +
 * 对向 297 simulation, brain edited report.tex and called finish() without
 * spawning a single new experiment. The existing PI / typesetter / language
 * gates passed because the report itself was internally consistent — they
 * had no window on "did new work happen since the directive arrived?".
 *
 * Limitations (acknowledged):
 *  - Cannot verify content relevance: a brain that creates an empty E_fake/
 *    directory with `mkdir` or a real experiment unrelated to the directive
 *    will pass the gate. We require at least one regular file under the dir
 *    (defeats `mkdir`) but cannot enforce semantic alignment with the
 *    directive — that remains a PI / typesetter judgment call.
 */
const DIRECTIVE_KEYWORD_RE =
  /模拟|simulate|simulation|验证|verify|verification|对比|对照|比较|compare|comparison|实验|experiment|分析|analy[sz]e|analysis/i;

export function directiveImpliesNewWork(directive: string | undefined): string | null {
  if (!directive) return null;
  const m = directive.match(DIRECTIVE_KEYWORD_RE);
  return m ? m[0] : null;
}

/**
 * Find experiment directories under data/experiments/ that contain at least
 * one regular file whose mtime is strictly greater than `sinceMs`. Empty dirs
 * (created by a defensive `mkdir` to fool the gate) do not count. We walk
 * one level (scripts/, tests/, runs/) deep — enough to catch real work,
 * cheap enough to avoid recursive directory traversal on large run trees.
 */
export function findExperimentsModifiedSince(
  projectDir: string,
  sinceMs: number,
): string[] {
  const expRoot = join(projectDir, "data", "experiments");
  if (!existsSync(expRoot)) return [];
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(expRoot); } catch { return []; }
  for (const name of entries) {
    const dir = join(expRoot, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (hasFileNewerThan(dir, sinceMs, 2)) out.push(name);
  }
  return out;
}

function hasFileNewerThan(dir: string, sinceMs: number, depth: number): boolean {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isFile() && st.mtimeMs > sinceMs) return true;
    if (st.isDirectory() && depth > 0) {
      if (hasFileNewerThan(full, sinceMs, depth - 1)) return true;
    }
  }
  return false;
}

/**
 * H7: when report.tex enumerates N "schemes" / "方案" via explicit count
 * ("compared 7 schemes") or via (a)(b)(c)... enumeration, every named
 * scheme must have a corresponding experiment dir with a substantive
 * results.json — non-trivial size + simulation-evidence keywords, NOT a
 * `{"status":"excluded"}` stub.
 *
 * Heuristic, not perfect. Misses report sections that don't use the
 * enumeration pattern. But catches the documented Rb failure: brain wrote
 * "六种方案中四种经数值模拟验证 ... (c) 解析排除 (d) 解析排除 (b) 开放问题"
 * — 7 schemes declared, 4 with real results.json, 3 trivial.
 *
 * Caller-bypassable via reviews/directive_pushback.md (mtime-newer than the
 * report) — preserves brain's documented-dissent path.
 */
function checkSchemeSymmetry(
  projectDir: string,
  sessionStartedAtMs: number,
): { ok: boolean; message?: string } {
  const reportPath = join(projectDir, "report", "report.tex");
  if (!existsSync(reportPath)) return { ok: true };

  let tex: string;
  try { tex = readFileSync(reportPath, "utf-8"); }
  catch { return { ok: true }; }

  // Detect explicit declaration: "N 个方案" / "N schemes" / "compared N X"
  let declared = 0;
  const explicitRe = /(?:对比|比较|compared?|enumerated?|all|every|the\s+)\s*(\d+)\s*(?:个|种)?\s*(?:方案|schemes?|approaches?|protocols?|methods?)/gi;
  for (const m of tex.matchAll(explicitRe)) {
    declared = Math.max(declared, parseInt(m[1], 10));
  }
  // Detect (a)..(z) markers tied to "scheme"/"方案" in same paragraph
  const enumLetters = new Set<string>();
  const enumRe = /(?:方案|scheme)\s*\(([a-z])\)/gi;
  for (const m of tex.matchAll(enumRe)) enumLetters.add(m[1].toLowerCase());
  declared = Math.max(declared, enumLetters.size);

  if (declared < 3) return { ok: true }; // not enumerating schemes; skip check

  // Count fresh experiment dirs with substantive results.json
  const expRoot = join(projectDir, "data", "experiments");
  if (!existsSync(expRoot)) {
    return { ok: false, message: `Report declares ${declared} schemes but data/experiments/ does not exist.` };
  }
  let substantiveCount = 0;
  const trivialStatusRe = /^\s*\{\s*"status"\s*:\s*"(?:excluded|open|infeasible|skip)"\s*\}?\s*$/i;
  const evidenceRe = /"(?:fidelity|infidelity|trajector|simulation|sweep|scan|ensemble|samples?|results?)"\s*:/i;
  try {
    for (const name of readdirSync(expRoot)) {
      const subDir = join(expRoot, name);
      let st; try { st = statSync(subDir); } catch { continue; }
      if (!st.isDirectory()) continue;
      const runsDir = join(subDir, "runs");
      if (!existsSync(runsDir)) continue;
      let found = false;
      for (const run of readdirSync(runsDir)) {
        const resultsPath = join(runsDir, run, "results.json");
        if (!existsSync(resultsPath)) continue;
        let rst; try { rst = statSync(resultsPath); } catch { continue; }
        if (rst.mtimeMs < sessionStartedAtMs) continue;
        if (rst.size < 1024) continue;
        let body: string;
        try { body = readFileSync(resultsPath, "utf-8"); } catch { continue; }
        if (trivialStatusRe.test(body.trim())) continue;
        if (!evidenceRe.test(body)) continue;
        found = true; break;
      }
      if (found) substantiveCount++;
    }
  } catch { /* tolerate listing failures */ }

  // Allow pushback override: reviews/directive_pushback.md newer than report
  const pushbackPath = join(projectDir, "reviews", "directive_pushback.md");
  if (existsSync(pushbackPath)) {
    try {
      const pst = statSync(pushbackPath);
      const rst = statSync(reportPath);
      if (pst.mtimeMs >= rst.mtimeMs) return { ok: true };
    } catch { /* fall through */ }
  }

  if (substantiveCount < declared) {
    return {
      ok: false,
      message:
        `Scheme symmetry mismatch: report.tex declares/enumerates ${declared} ` +
        `schemes (via explicit count or (a)..(z) markers tied to "方案"/"scheme") ` +
        `but only ${substantiveCount} experiment director(ies) under ` +
        `data/experiments/ have a substantive results.json (≥1 KB, contains ` +
        `fidelity/trajectories/simulation evidence, NOT a {"status":"excluded"} ` +
        `stub). ${declared - substantiveCount} scheme(s) appear in the report ` +
        `without underlying simulation artifacts. This is the documented Rb-单光子 ` +
        `failure pattern: directive demanded "verify N via simulation", brain ` +
        `delivered M<N with the rest narrated as "analytically excluded".`,
    };
  }
  return { ok: true };
}

export interface DirectiveGateConfig {
  directive: string;
  sessionStartedAtMs: number;
}

export function buildResearchTools(
  projectDir: string,
  templateVars: Record<string, string>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  callbacks?: ToolCallbacks,
  directiveGate?: DirectiveGateConfig,
): { tools: any[]; setParentAgent: (agent: Agent) => void } {
  // Brain coding tools are wrapped with read-tracking + edit safety guards
  // declared in brain.md. The wrapper is load-bearing (RESEARCH.md protection,
  // read-before-edit) — missing safety config is a misconfiguration, not a
  // fallback case, so we fail fast rather than returning raw tools.
  const brainWrapper = buildSafetyWrapper(getDefinition("brain").safety);
  if (!brainWrapper) {
    throw new Error("brain.md must declare a `safety:` block — top-level brain tools cannot run unwrapped.");
  }
  const codingTools = brainWrapper(createCodingToolsForProject(projectDir), projectDir, templateVars);
  const reportTools = createReportTools(projectDir);
  const authorityTools = createAuthorityEscalationTools(projectDir);

  // Deferred parent agent ref — set after Agent is constructed (needed for background steer)
  let parentAgentRef: Agent | undefined;

  // Use a proxy object so spawn tool picks up the agent ref when it's set later
  const spawnTool = createSpawnAgentTool(
    projectDir, templateVars, getApiKey,
    /* parentAgentId */ undefined,
    /* depth */ undefined,
    /* parentAgent — resolved lazily via proxy */ undefined,
  );

  // Wrap execute to inject parentAgentRef at call time (agent is set after construction)
  const origExecute = spawnTool.execute;
  spawnTool.execute = function (toolCallId: string, params: any) {
    // Patch background support: if parentAgentRef is set and params.background, use steer
    if (params.background && parentAgentRef) {
      // Re-create tool with agent ref for this call
      const toolWithAgent = createSpawnAgentTool(
        projectDir, templateVars, getApiKey,
        "brain", 0, parentAgentRef,
      );
      return toolWithAgent.execute(toolCallId, params);
    }
    return origExecute(toolCallId, params);
  };

  // finish tool — agent calls this when research is complete
  const finishTool = {
    name: "finish",
    description: "Call when research is complete: PI review passed and final PDF compiled. This cleanly ends the research session.",
    parameters: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string" as const,
          description: "One-line summary of what was accomplished.",
        },
      },
      required: ["summary"],
    },
    execute: async (args: { summary: string }) => {
      // Hard lock: cannot finish while background agents are still running
      const active = getActiveBackgroundAgents(projectDir);
      if (active.length > 0) {
        const list = active.map(a => `  - ${a.name}: ${a.task} (running ${Math.floor((Date.now() - a.startedAt) / 1000)}s)`).join("\n");
        return { content: [{ type: "text" as const, text: `Cannot finish: ${active.length} background agent(s) still running. Wait for them to complete before finishing.\n\nActive agents:\n${list}` }] };
      }

      // Fix δ — Directive-implication gate. See directiveImpliesNewWork above
      // for the rationale and known limitations. Only fires when this session
      // was launched with --directive AND the directive contains a research-
      // implication keyword. Cost: one stat() per experiment dir.
      if (directiveGate) {
        const kw = directiveImpliesNewWork(directiveGate.directive);
        if (kw) {
          const fresh = findExperimentsModifiedSince(projectDir, directiveGate.sessionStartedAtMs);
          if (fresh.length === 0) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: --directive contains research-implication keyword ` +
              `"${kw}" but no experiment directory under data/experiments/ has ` +
              `been modified since the session started ` +
              `(${new Date(directiveGate.sessionStartedAtMs).toISOString()}). ` +
              `The directive demands new analysis; the project state shows none. ` +
              `Spawn experiment with the directive's analysis task before calling ` +
              `finish(). If the directive is genuinely satisfiable by editing the ` +
              `report alone (no new computation needed), say so explicitly in a ` +
              `note to the user and ask for an updated directive.`
            }] };
          }

          // Fix H7 — subsection-vs-results symmetry. δ above only requires
          // ≥1 fresh experiment dir; that's trivially satisfied even when the
          // directive demanded N schemes simulated and brain only did 4/N.
          // This check: detect explicit enumeration in report.tex ("compared
          // N schemes" / scheme (a)..(g) markers) and require a matching
          // count of experiment dirs with substantive results.json
          // (non-trivial size + simulation-evidence keywords, NOT
          // {"status":"excluded"} stubs).
          const symmetry = checkSchemeSymmetry(projectDir, directiveGate.sessionStartedAtMs);
          if (!symmetry.ok) {
            return { content: [{ type: "text" as const, text:
              `Cannot finish: ${symmetry.message}\n\n` +
              `Either (a) simulate the missing schemes, or ` +
              `(b) document a pushback in reviews/directive_pushback.md ` +
              `naming each unsimulated scheme and the reason it cannot be ` +
              `verified within scope. If (b), the gate accepts the discrepancy ` +
              `once pushback.md is mtime-newer than the report.`
            }] };
          }
        }
      }

      // Plan-commitment gate: derive required experiments from notes/plan.md
      // and verify each one is Complete in notes/experiments.md.
      //
      // The authority chain:
      //   1. notes/plan.md  — what experiments the project committed to.
      //      Changes are PI-gated; brain edits but PI-review blocks dispatch
      //      after material edits. This is the trusted source of truth.
      //   2. notes/experiments.md — the per-experiment status ledger.
      //      Brain was observed wiping sections to bypass the gate
      //      (Apr-25 incident). Cannot be sole source of truth.
      //
      // Cross-check: every `### E_N` in plan.md must have a corresponding
      // `## L2.N` (or `## E_N`) section with Status: Complete in
      // experiments.md. Missing section = ledger erased = block.
      // Defensive check: any L2/E section actually present in experiments.md
      // must also be Complete (catches stray Pending sections not in plan).
      const planPath = join(projectDir, "notes", "plan.md");
      const expNotesPath = join(projectDir, "notes", "experiments.md");

      const planExperiments = existsSync(planPath)
        ? parsePlanSections(readFileSync(planPath, "utf-8"))
        : [];
      const ledgerSections = existsSync(expNotesPath)
        ? parseExperimentSections(readFileSync(expNotesPath, "utf-8"))
        : [];

      // Index ledger sections by their L2.N / E_N identifier prefix.
      const ledgerByKey = new Map<string, "pending" | "complete" | "missing">();
      for (const s of ledgerSections) {
        const m = s.header.match(/^(L2\.(\d+)|E(\d+))/);
        if (!m) continue;
        const idx = m[2] ?? m[3];
        ledgerByKey.set(`L2.${idx}`, s.status);
        ledgerByKey.set(`E${idx}`, s.status);
      }

      // Cross-check: every plan.md E_N must have a Complete ledger entry.
      const planMissingFromLedger: string[] = [];
      const planIncompleteInLedger: Array<{ id: string; status: string }> = [];
      for (const p of planExperiments) {
        const key1 = `L2.${p.index}`;
        const key2 = p.id;
        const status = ledgerByKey.get(key1) ?? ledgerByKey.get(key2);
        if (status === undefined) {
          planMissingFromLedger.push(p.id);
        } else if (status !== "complete") {
          planIncompleteInLedger.push({ id: p.id, status });
        }
      }

      // Defensive: any extra section in experiments.md must also be Complete.
      const ledgerExtraIncomplete = ledgerSections.filter(s => {
        if (s.status === "complete") return false;
        const m = s.header.match(/^(L2\.(\d+)|E(\d+))/);
        const idx = m?.[2] ?? m?.[3];
        // Skip if already flagged via plan cross-check (avoid double-report)
        if (idx !== undefined && planIncompleteInLedger.some(pi => pi.id === `E${idx}`)) {
          return false;
        }
        return true;
      });

      if (
        planMissingFromLedger.length > 0 ||
        planIncompleteInLedger.length > 0 ||
        ledgerExtraIncomplete.length > 0
      ) {
        const lines: string[] = [`Cannot finish: plan-experiments commitment check failed.`];

        if (planMissingFromLedger.length > 0) {
          lines.push(
            ``,
            `notes/plan.md commits to ${planMissingFromLedger.length} experiment(s) with no entry in notes/experiments.md:`,
          );
          for (const id of planMissingFromLedger) lines.push(`  - ${id}`);
          lines.push(
            `→ Spawn experiment for each missing E_N. The experiment agent appends its own L2 section with Status: Complete on Phase 3 integrate. If a sub-question is genuinely out of scope, edit notes/plan.md to drop its §E_N section, then re-run plan-PI gate (request_pi_review) before retrying finish.`,
          );
        }

        if (planIncompleteInLedger.length > 0) {
          lines.push(
            ``,
            `Plan-referenced experiments not Complete (${planIncompleteInLedger.length}):`,
          );
          for (const s of planIncompleteInLedger) lines.push(`  - ${s.id} → status: ${s.status}`);
          lines.push(`→ Spawn experiment to drive each section to Complete.`);
        }

        if (ledgerExtraIncomplete.length > 0) {
          lines.push(
            ``,
            `Extra non-Complete sections in experiments.md not tied to plan.md (${ledgerExtraIncomplete.length}):`,
          );
          for (const s of ledgerExtraIncomplete) lines.push(`  - ${s.header} → status: ${s.status}`);
          lines.push(`→ Either spawn experiment to drive these to Complete, or remove if written in error (note: brain cannot edit experiments.md by design — this entry came from an experiment agent and only that agent class can clean it up).`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      const pdfPath = join(projectDir, "report/report.pdf");
      if (!existsSync(pdfPath)) {
        return { content: [{ type: "text" as const, text: `Cannot finish: report/report.pdf does not exist. Compile the report first with compile_latex, then call finish again.` }] };
      }

      // Figure gate: require ≥1 self-generated figure (under report/figures/,
      // not imported from ../data/papers/). Without this, brain tends to ship
      // text-with-paper-imports and skip visualising its own quantitative
      // results.
      const reportTexPath = join(projectDir, "report/report.tex");
      if (existsSync(reportTexPath)) {
        const tex = readFileSync(reportTexPath, "utf-8");
        const includes = [...tex.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map(m => m[1]);
        const selfGen = includes.filter(p => !p.includes("/data/papers/") && !p.includes("data/papers/"));
        if (selfGen.length === 0 && includes.length > 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex has ${includes.length} figure(s), all imported from data/papers/. Reports with experiments must include ≥1 self-generated figure visualising your own quantitative results. See brain.md <generated_figures>: sourcing raw data from data/experiments/*/runs/*/data/, spawn illustrator or run a plot script to produce report/figures/<name>.pdf, then include it in report.tex.` }] };
        }
        if (selfGen.length === 0 && includes.length === 0) {
          return { content: [{ type: "text" as const, text: `Cannot finish: report.tex contains zero figures. Every research report needs ≥1 self-generated figure under report/figures/ visualising experiment results. See brain.md <generated_figures>.` }] };
        }

        // Language gate: cross-check plan.md `# Language`'s `Chosen:` against
        // report.tex actual content. Catches the silent-flip failure mode
        // observed in 超导BOM (brain planned Chinese, wrote English 11h later
        // with no plan-side update). Detection: look for any Han character /
        // Hangul / Kana in report.tex body. Match: chosen=zh implies CJK
        // present; chosen=en implies CJK absent (or only present in cite keys).
        if (existsSync(planPath)) {
          const planText = readFileSync(planPath, "utf-8");
          const langStart = planText.match(/^#\s*Language\b[^\n]*$/m);
          let langBlock = "";
          if (langStart && langStart.index !== undefined) {
            const after = planText.slice(langStart.index + langStart[0].length);
            const nextHeading = after.match(/\n#\s/);
            langBlock = nextHeading ? after.slice(0, nextHeading.index) : after;
          }
          const chosenMatch = langBlock.match(/\*\*Chosen\*\*\s*[:：]\s*([a-z][a-z-]*)/i);
          const chosen = chosenMatch?.[1].toLowerCase();
          if (chosen) {
            // Strip cite/ref blocks before CJK detection so a Chinese-named
            // bibtex key in an English report doesn't false-positive.
            const stripped = tex
              .replace(/\\cite\{[^}]*\}/g, "")
              .replace(/\\bibliography\{[^}]*\}/g, "")
              .replace(/%[^\n]*/g, "");
            const hasCJK = /[一-鿿가-힯぀-ヿ]/.test(stripped);
            const expectsCJK = chosen === "zh" || chosen === "zh-cn" || chosen === "zh-tw" ||
              chosen === "ja" || chosen === "ko";
            if (expectsCJK && !hasCJK) {
              return { content: [{ type: "text" as const, text: `Cannot finish: notes/plan.md's # Language block declares Chosen: ${chosen}, but report.tex contains no CJK characters in its body. The report drifted from the planned language. Either translate the report to ${chosen} (use bilingual inline for technical terms — peer project 中性原子量子计算机的BOM is the worked example) OR update notes/plan.md's # Language block with a new Chosen + rationale and re-run plan-PI gate.` }] };
            }
            if (!expectsCJK && hasCJK) {
              return { content: [{ type: "text" as const, text: `Cannot finish: notes/plan.md's # Language block declares Chosen: ${chosen}, but report.tex contains CJK characters. Either translate to ${chosen} OR update plan.md's # Language block.` }] };
            }
          }
        }
      }

      // PI verdict gate. PI's role in the loop is explicit adversarial review;
      // if PI's latest verdict is STEER, the agent has unresolved instructions
      // and is not allowed to self-declare the work done. This gate was absent
      // from 2026-03-21 (original finish tool, 14ef477) through 2026-04-20
      // (commit a37273f figure gate) — brain could address any subset of a
      // STEER's instructions and call finish() uncontested. Observed on
      // inbox_B6Bk_xVQ2503: PI returned STEER with 4 priorities, brain
      // partially addressed P1+P2, skipped P3+P4, called finish() and shipped.
      //
      // Dead-loop avoidance — three mechanisms, layered:
      //
      //  1. Pushback escape. Brain may disagree with PI defensibly: write
      //     reviews/pi_pushback.md with a reasoned argument AFTER reading
      //     the latest review; if that file's mtime exceeds pi_feedback.md's,
      //     the gate allows finish() through. This is the "documented
      //     dissent" exit — PI keeps the authority to flag issues, brain
      //     keeps the authority to override with written justification.
      //
      //  2. Clear error message. The block text names the EXACT two paths
      //     forward (address + re-review, or write pushback). Brain seeing
      //     the same message on repeated calls has the instruction set
      //     unchanged; it will not wander into the "retry same tool"
      //     trap the old block-retry loops did.
      //
      //  3. maxTurns cap (default 500, src/agent.ts). Any true runaway
      //     kills the process via process.exit(1). Bounded damage.
      //
      // continue/stop verdicts pass through; stop explicitly means "wrap up
      // and ship" so finish is the right call.
      // Document-level layout gate, orthogonal to illustrator (figure
      // internals) and reviewer (content). No pushback escape — layout
      // failures are mechanical, not judgment calls; if the audit is
      // wrong, re-run typesetter, don't override.
      const typesetterPath = join(projectDir, "reviews", "typesetter_notes.md");
      const typesetterSrc = existsSync(typesetterPath)
        ? readFileSync(typesetterPath, "utf-8")
        : null;
      if (typesetterSrc === null) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md is missing. Document-` +
          `level layout has not been audited. Spawn typesetter:\n\n` +
          `  spawn_agent(agent="typesetter", task="Audit report/report.pdf ` +
          `page-by-page for layout issues per your prompt. Write reviews/` +
          `typesetter_notes.md.", background=false)\n\n` +
          `Once it returns status: all-clear (and the PDF hasn't been ` +
          `recompiled since), finish() is allowed.`
        }] };
      }
      const fmBlock = extractFrontmatterBlock(typesetterSrc);
      if (!fmBlock) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md has no YAML frontmatter. ` +
          `Re-spawn typesetter to regenerate with proper frontmatter ` +
          `(status, report_pdf_md5, page_count, pages_audited).`
        }] };
      }
      const fm = parseAuditFrontmatter(fmBlock);
      if (!fm.status || !fm.report_pdf_md5) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md frontmatter is ` +
          `missing required keys (status, report_pdf_md5). Re-spawn typesetter.`
        }] };
      }
      if (fm.status !== "all-clear") {
        const summaryMatch = typesetterSrc.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n---|\s*$)/);
        const summary = summaryMatch ? summaryMatch[1].trim() : "(no Summary section)";
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md status is "${fm.status}" ` +
          `(not all-clear). Address the layout issues then re-spawn ` +
          `typesetter to regenerate the audit.\n\n` +
          `Summary from typesetter_notes.md:\n${summary}`
        }] };
      }
      const currentPdfMd5 = md5OrNull(pdfPath);
      if (currentPdfMd5 && currentPdfMd5 !== fm.report_pdf_md5) {
        return { content: [{ type: "text" as const, text:
          `Cannot finish: reviews/typesetter_notes.md audited a different ` +
          `report.pdf (recorded md5 ${fm.report_pdf_md5.slice(0, 12)}…, ` +
          `current ${currentPdfMd5.slice(0, 12)}…). Re-spawn typesetter ` +
          `to audit the current PDF.`
        }] };
      }

      const piVerdict = parseLatestPIVerdict(projectDir);
      if (piVerdict && piVerdict.verdict === "steer") {
        const pushbackPath = join(projectDir, "reviews", "pi_pushback.md");
        let pushbackFresh = false;
        try {
          const pushbackMtimeMs = statSync(pushbackPath).mtimeMs;
          pushbackFresh = pushbackMtimeMs > piVerdict.reviewMtimeMs;
        } catch { /* pushback file missing — not fresh */ }
        if (!pushbackFresh) {
          return { content: [{ type: "text" as const, text:
            `Cannot finish: latest PI verdict in reviews/pi_feedback.md is STEER ` +
            `(unresolved instructions). Two paths forward, pick one:\n\n` +
            `  (a) Address PI's instructions, then call request_pi_review again. ` +
            `PI must return verdict=continue or verdict=stop before finish() is ` +
            `allowed.\n\n` +
            `  (b) If any instruction is genuinely non-actionable or you have ` +
            `defensible disagreement, write reviews/pi_pushback.md with a ` +
            `reasoned argument (cite specific feedback items, give your counter-` +
            `reasoning, note what you will NOT do and why). Once that file's ` +
            `mtime is newer than reviews/pi_feedback.md, finish() is allowed ` +
            `through — PI's authority is advisory, not a veto.\n\n` +
            `Do NOT retry finish() without taking one of these paths; the ` +
            `block will repeat identically.`
          }] };
        }
      }

      callbacks?.onFinish?.();
      return { content: [{ type: "text" as const, text: `Research complete: ${args.summary}` }] };
    },
  };

  const initReport = createInitReportTool(projectDir);

  // idle tool — brain calls this after dispatching background agents when it
  // has no foreground work. Blocks on the harness side (poll active-agents.json
  // at 2s cadence) — zero LLM turns while waiting. Returns all bg results as
  // a single tool output when every running bg has transitioned to done/failed,
  // so brain processes them in one follow-up turn instead of per-nudge.
  //
  // Stale heartbeats (subagent-runner crashed without markFailed) are flipped
  // to "failed" here so they harvest instead of blocking forever.
  const idleTool = {
    name: "idle",
    description:
      "Suspend your turn-taking until ALL running background agents complete, " +
      "with zero LLM cost during the wait. Harness polls the registry every 2s " +
      "and returns all completions as this tool's output in one blob. Call this " +
      "after `spawn_agent(background=true)` when you have no foreground work " +
      "to do. Returns immediately if no background agents are running.",
    parameters: {
      type: "object" as const,
      properties: {
        timeout_ms: {
          type: "number" as const,
          description: "Max wait duration before giving up. Default 600000 (10 minutes). On timeout, any still-running agents are listed; they remain in the registry for next-turn harvest.",
        },
      },
    },
    execute: async (args: { timeout_ms?: number }) => {
      const agentDir = join(projectDir, ".agent");
      const timeout = args.timeout_ms ?? 600_000;
      const start = Date.now();
      const pollMs = 2000;

      // Grace period: brain commonly calls idle() in the same assistant turn
      // as spawn_agent(background=true), and pi-agent-core runs tools in
      // parallel. The spawn's synchronous addAgent() may not complete before
      // idle's first loadRegistry() reads the file — observed live as a race
      // where idle returned "no bg running" within 8s of brain's dispatch.
      // 500ms settles the race; indistinguishable from no-op on real idles.
      await new Promise(r => setTimeout(r, 500));

      // Zombie detection: mark an agent failed only when it's been running
      // long enough to have produced a heartbeat. subagent-runner touches
      // heartbeat at startup + every 30s; startup itself can take 5-10s
      // (node loads tsx + pi-agent-core + agent def). Without the
      // startedAt grace, a freshly-spawned agent has no heartbeat file yet
      // and would be falsely labelled zombie on the first poll.
      const ZOMBIE_GRACE_MS = 90_000;
      while (Date.now() - start < timeout) {
        const active = loadRegistry(agentDir);
        for (const a of active) {
          if (
            a.status === "running"
            && Date.now() - a.startedAt > ZOMBIE_GRACE_MS
            && !isAlive(agentDir, a.id, 60_000)
          ) {
            // Synthesize an exit record for the crashed agent so parent harvest
            // still gets stopReason=killed rather than an undefined exit. The
            // markFailed path that subagent-runner takes on catch() fires exit
            // from its collector; a SIGKILL'd runner never reaches that catch,
            // so this harness-side path is the only source of exit metadata.
            markFailed(agentDir, a.id, "heartbeat stale — process died without updating status", {
              stopReason: "killed",
              filesTouched: [],
              elapsedMs: Date.now() - a.startedAt,
              toolCallCount: 0,
              endedAt: new Date().toISOString(),
            });
          }
        }
        const stillRunning = loadRegistry(agentDir).filter(a => a.status === "running");
        if (stillRunning.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }

      const active = loadRegistry(agentDir);
      const harvested: string[] = [];
      for (const a of active) {
        // Gate on status alone — empty a.result (thinking-only last message)
        // must still be harvested, otherwise the entry leaks forever.
        if (a.status === "done") {
          const body = a.result || "(no output)";
          harvested.push(`[Background Agent Complete: ${a.name} ✓]\nTask: ${a.task}\n\n${body}${formatExitHint(a.exit, projectDir)}`);
          removeAgent(agentDir, a.id);
        } else if (a.status === "failed") {
          harvested.push(`[Background Agent Failed: ${a.name} ✗]\nTask: ${a.task}\n\n${a.result || "Unknown error"}${formatExitHint(a.exit, projectDir)}`);
          removeAgent(agentDir, a.id);
        }
      }

      const remaining = loadRegistry(agentDir).filter(a => a.status === "running");
      let body: string;
      if (harvested.length === 0 && remaining.length === 0) {
        body = "No background agents were running.";
      } else if (remaining.length > 0) {
        body = `Timeout (${timeout}ms) reached with ${remaining.length} agent(s) still running: ${remaining.map(a => a.id).join(", ")}.`;
        if (harvested.length > 0) body += `\n\nHarvested ${harvested.length}:\n\n` + harvested.join("\n\n---\n\n");
      } else {
        body = `${harvested.length} background agent(s) completed:\n\n` + harvested.join("\n\n---\n\n");
      }
      return { content: [{ type: "text" as const, text: body }] };
    },
  };

  const tools = [
    ...reportTools,
    initReport,
    ...authorityTools,
    ...codingTools,
    spawnTool,
    idleTool,
    finishTool,
  ];

  return {
    tools,
    setParentAgent: (agent: Agent) => { parentAgentRef = agent; },
  };
}
