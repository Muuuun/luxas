import { Type, type Static } from "@earendil-works/pi-ai/compat";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { currentJobOwner } from "../jobs/als.js";

const REGISTRY_REL = ".agent/escalations.jsonl";

const AuthorityEscalationParams = Type.Object({
  claim: Type.String({
    description:
      "One concise claim or question that cannot be resolved inside the current RESEARCH.md authority.",
    minLength: 1,
  }),
  why_unresolvable: Type.String({
    description:
      "Why the issue requires modifying RESEARCH.md itself, rather than choosing a method, narrowing interpretation, or documenting a limitation.",
    minLength: 1,
  }),
  evidence_path: Type.String({
    description:
      "Project-relative path to the concrete evidence supporting this escalation, optionally with a line/section suffix.",
    minLength: 1,
  }),
});

type AuthorityEscalationParamsT = Static<typeof AuthorityEscalationParams>;

export interface AuthorityEscalationRecord {
  type: "authority_bound_escalation";
  timestamp: string;
  agent_id: string | null;
  claim: string;
  why_unresolvable: string;
  evidence_path: string;
}

function registryPath(projectDir: string): string {
  return join(projectDir, REGISTRY_REL);
}

function errResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { success: false } };
}

function normalizeEvidencePath(projectDir: string, evidencePath: string): string | { error: string } {
  const trimmed = evidencePath.trim();
  const [pathPart, ...suffixParts] = trimmed.split("#");
  if (!pathPart) return { error: "evidence_path must name a project-relative file path." };
  if (pathPart.startsWith("/") || pathPart.includes("..")) {
    return { error: "evidence_path must be project-relative and must not contain '..'." };
  }

  let filePart = pathPart;
  let lineSuffix = "";
  if (!existsSync(resolve(projectDir, filePart))) {
    const lineMatch = pathPart.match(/^(.+):(\d+)$/);
    if (lineMatch && existsSync(resolve(projectDir, lineMatch[1]))) {
      filePart = lineMatch[1];
      lineSuffix = `:${lineMatch[2]}`;
    }
  }

  const abs = resolve(projectDir, filePart);
  const projectAbs = resolve(projectDir);
  if (abs !== projectAbs && !abs.startsWith(projectAbs + "/")) {
    return { error: "evidence_path resolves outside the project directory." };
  }
  if (!existsSync(abs)) {
    return { error: `evidence_path does not exist: ${filePart}` };
  }

  const normalized = `${filePart}${lineSuffix}`;
  return suffixParts.length > 0 ? `${normalized}#${suffixParts.join("#")}` : normalized;
}

export function readAuthorityEscalations(projectDir: string): AuthorityEscalationRecord[] {
  const path = registryPath(projectDir);
  if (!existsSync(path)) return [];

  const records: AuthorityEscalationRecord[] = [];
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed?.type === "authority_bound_escalation" &&
        typeof parsed.claim === "string" &&
        typeof parsed.why_unresolvable === "string" &&
        typeof parsed.evidence_path === "string"
      ) {
        records.push(parsed as AuthorityEscalationRecord);
      }
    } catch {
      // Ignore malformed historical lines; the registry is append-only and
      // compile should not fail because of one damaged entry.
    }
  }
  return records;
}

export function createAuthorityEscalationTools(projectDir: string) {
  return [{
    name: "escalate_authority_bound",
    label: "Escalate Authority Bound",
    description:
      "Append an authority-bound escalation to .agent/escalations.jsonl. " +
      "Use this only when resolving the issue would require modifying RESEARCH.md itself: " +
      "for example mutually inconsistent hard constraints, a structurally unanswerable question, " +
      "or a required scope expansion beyond the stated research goal. " +
      "Do not use it for ordinary limitations, weaker evidence, method choices, missing citations, " +
      "implementation failures, or concerns that can be resolved by brain/PI inside the current RESEARCH.md authority.",
    parameters: AuthorityEscalationParams,
    async execute(
      _toolCallId: string,
      params: AuthorityEscalationParamsT,
    ) {
      const claim = params.claim.trim();
      const why = params.why_unresolvable.trim();
      const normalizedEvidence = normalizeEvidencePath(projectDir, params.evidence_path);
      if (typeof normalizedEvidence !== "string") return errResult(normalizedEvidence.error);
      if (!claim || !why) return errResult("claim and why_unresolvable must be non-empty.");

      const owner = currentJobOwner();
      const record: AuthorityEscalationRecord = {
        type: "authority_bound_escalation",
        timestamp: new Date().toISOString(),
        agent_id: owner?.agentId ?? null,
        claim,
        why_unresolvable: why,
        evidence_path: normalizedEvidence,
      };

      const path = registryPath(projectDir);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(record) + "\n");

      return {
        content: [{
          type: "text" as const,
          text:
            `Recorded authority-bound escalation in ${REGISTRY_REL}.\n` +
            `This will be rendered into the final report during compile_latex.`,
        }],
        details: { success: true, path: REGISTRY_REL },
      };
    },
  }];
}

const SECTION_START = "% BEGIN authority-bound escalations";
const SECTION_END = "% END authority-bound escalations";

function latexEscape(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function renderAuthorityEscalationSection(records: AuthorityEscalationRecord[]): string {
  const items = records.map((r) => (
    "\\item " +
    `\\textbf{Claim:} ${latexEscape(r.claim)}\\\\\n` +
    `\\textbf{Why unresolved:} ${latexEscape(r.why_unresolvable)}\\\\\n` +
    `\\textbf{Evidence:} \\texttt{${latexEscape(r.evidence_path)}}`
  )).join("\n\n");

  return [
    SECTION_START,
    "\\section*{Open questions for human decision}",
    "\\begin{itemize}",
    items,
    "\\end{itemize}",
    SECTION_END,
  ].join("\n") + "\n";
}

export function applyAuthorityEscalationSection(
  reportDir: string,
  texfile: string,
  projectDir: string,
): { changed: boolean; count: number } {
  const texPath = join(reportDir, texfile);
  if (!existsSync(texPath)) return { changed: false, count: 0 };

  const records = readAuthorityEscalations(projectDir);
  const tex = readFileSync(texPath, "utf-8");
  const markerRe = new RegExp(
    `${SECTION_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${SECTION_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "m",
  );

  let next: string;
  if (records.length === 0) {
    next = tex.replace(markerRe, "");
  } else {
    const section = renderAuthorityEscalationSection(records);
    if (markerRe.test(tex)) {
      next = tex.replace(markerRe, section);
    } else {
      const insertAt =
        tex.search(/\\bibliographystyle\b/) >= 0 ? tex.search(/\\bibliographystyle\b/)
        : tex.search(/\\bibliography\b/) >= 0 ? tex.search(/\\bibliography\b/)
        : tex.search(/\\end\{document\}/);
      if (insertAt >= 0) {
        next = tex.slice(0, insertAt).replace(/\s*$/, "\n\n") + section + "\n" + tex.slice(insertAt);
      } else {
        next = tex.replace(/\s*$/, "\n\n") + section;
      }
    }
  }

  if (next !== tex) {
    writeFileSync(texPath, next);
    return { changed: true, count: records.length };
  }
  return { changed: false, count: records.length };
}
