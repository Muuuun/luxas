#!/usr/bin/env tsx
/**
 * Real-provider cross-check for Phase 3b carry-forward attachments +
 * Phase 3a FileContextCache wired end-to-end with a real summarizer.
 *
 *   ./node_modules/.bin/tsx scripts/spike_real_compaction.mts
 *
 * Burns ~$0.02 on haiku-4-5 via the `.sisyphus.config.json` VPN endpoint.
 *
 * What this verifies that the unit smoke cannot
 * ----------------------------------------------
 *   unit smoke_carry_forward_attachments.mts already proves the code paths
 *   (providers, engine integration, insertion order). It uses a mock adapter
 *   and a fake summarizer, so it never confirms:
 *
 *     (i)  a real Anthropic-shaped provider accepts the rebuilt message array
 *          after compact (carryforward + preamble + attachments + retained tail)
 *          without schema errors.
 *     (ii) the real model actually reads the <recent_files> / <authoritative>
 *          blocks and can reference their content in the next turn — i.e. the
 *          attachments aren't just bytes that silently get dropped by the
 *          provider/model.
 *
 *   This spike covers both by:
 *     1. Running ContextPacker.runCycle with a real summarizer call (haiku
 *        via VPN), real providers, and usageTokens high enough to trigger
 *        condense on a minimal window.
 *     2. Sending the rebuilt conversation back to haiku with a fresh user
 *        turn asking "what's in notes/plan.md and which files were recently
 *        touched?" and checking the response echoes the marker strings we
 *        embedded in the fake files.
 *
 * Output
 * ------
 * Writes notes/phase-3b-real-provider-verification.md with observations
 * and a verdict: PHASE-3B-LIVE-VERIFIED | PHASE-3B-MODEL-IGNORED-ATTACHMENTS
 * | INCONCLUSIVE.
 */

import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { streamSimple } from "@mariozechner/pi-ai";

import { getConfiguredModel, resolveAnthropicKey } from "../src/auth.js";
import { createBlockConversationAdapter } from "../src/compaction/adapter.js";
import { ContextPacker } from "../src/compaction/engine.js";
import {
  createRecentFilesProvider,
  createAuthoritativeArtifactsProvider,
  listAuthoritativeArtifactPaths,
} from "../src/compaction/attachments.js";
import { createFileContextCache } from "../src/agents/file-context-cache.js";

// ── API key + model via VPN config ────────────────────────────────────────

const apiKey = await resolveAnthropicKey();
if (!apiKey) {
  console.log(
    "skipped: no Anthropic API key (checked .sisyphus.config.json + ANTHROPIC_API_KEY)",
  );
  process.exit(0);
}

const model = getConfiguredModel("anthropic", "claude-haiku-4-5-20251001");
console.log(
  `Using model: ${model.id ?? "claude-haiku-4-5-20251001"}` +
    (model.baseUrl ? ` via ${model.baseUrl}` : " (direct Anthropic)"),
);

// ── Fixture: a temp projectDir with notes/plan.md + notes/memory.md ────────

const projectDir = mkdtempSync(join(tmpdir(), "spike-compact-"));
mkdirSync(join(projectDir, "notes"), { recursive: true });

const PLAN_MARKER = "ZEPHYR_PLAN_MARKER_7Q3";
const MEMORY_MARKER = "QUASAR_MEMORY_MARKER_KX9";
const RECENT_FILE_MARKER = "NEBULA_RECENT_FILE_MARKER_J5";

writeFileSync(
  join(projectDir, "notes", "plan.md"),
  `# Plan\n\nToken: ${PLAN_MARKER}\n\n- Step 1: build the thing\n- Step 2: test the thing\n- Step 3: ship the thing\n`,
);
writeFileSync(
  join(projectDir, "notes", "memory.md"),
  `# Memory\n\nToken: ${MEMORY_MARKER}\n\nKey decision: we're using BP-OSD as the decoder.\nOpen question: atom-ion fidelity threshold.\n`,
);

// ── Fixture: FileContextCache populated with 3 "recent" files ──────────────

const cache = createFileContextCache();
const now = Date.now();
cache.set(join(projectDir, "src", "solver.py"), {
  content: `def solve(x):\n    # ${RECENT_FILE_MARKER}\n    return x * 2\n`,
  mtimeMs: now - 3_000,
  touchedAt: now - 3_000,
  via: "read",
});
cache.set(join(projectDir, "src", "circuit.py"), {
  content: "def build_circuit():\n    return 'stim circuit here'\n",
  mtimeMs: now - 2_000,
  touchedAt: now - 2_000,
  via: "write",
});
cache.set(join(projectDir, "src", "decoder.py"), {
  content: "def decode(syndrome):\n    return [0] * len(syndrome)\n",
  mtimeMs: now - 1_000,
  touchedAt: now - 1_000,
  via: "edit",
});

// ── Build a plausible fake agent conversation ──────────────────────────────

// We want this conversation long enough that compaction has substance to
// summarize (so the summarizer actually does work) but small enough to stay
// cheap. ~12 turns of mid-length plain text suffices.

function turn(role: "user" | "assistant", body: string) {
  // Assistant messages in a real conversation always come from the model as
  // block arrays; pi-ai's adapter calls .flatMap() on content expecting an
  // array. User messages can be plain strings.
  if (role === "assistant") {
    return { role, content: [{ type: "text", text: body }] };
  }
  return { role, content: body };
}

const messages: any[] = [
  turn(
    "user",
    "I'm working on the hybrid atom-ion qLDPC simulation. Let's build the BB code constructor first.",
  ),
  turn(
    "assistant",
    "Got it. I'll start with Hx/Hz for [[72,12,6]] using the polynomial exponents from Bravyi2024. Let me draft it.",
  ),
  turn(
    "user",
    "Sounds good. Make sure to verify the CSS condition Hx @ Hz.T = 0 mod 2.",
  ),
  turn(
    "assistant",
    "Verified — the constructor returns Hx, Hz, logical_z plus the 6 permutation arrays. Tests pass on both [[72,12,6]] and [[144,12,12]].",
  ),
  turn("user", "Nice. Now wire in the Stim syndrome-extraction circuit."),
  turn(
    "assistant",
    "Drafted the depth-7 schedule. Each data qubit participates in 6 CNOTs per round. Interface gates parameterized separately.",
  ),
  turn(
    "user",
    "And the heterogeneous noise model — atom, ion, and hybrid channels.",
  ),
  turn(
    "assistant",
    "Three channels implemented: atom (p_2q=5e-3, p_m=5e-3), ion (p_2q=1e-4, idle=1e-6 per step, sequential gates), hybrid (p_interface=0.02, data-qubit idle=1e-7).",
  ),
  turn("user", "Run the MC sampler and report logical error rate per round."),
  turn(
    "assistant",
    "BP-OSD decoder set up. Sampling 1e5 shots per point. Results: BB[[144,12,12]] atom LER≈5e-4/round, ion LER≈1e-6/round, hybrid LER≈2e-2/round at p_interface=0.02.",
  ),
  turn(
    "user",
    "Sweep p_interface from 0.005 to 0.05 to find the break-even point vs pure atom.",
  ),
  turn(
    "assistant",
    "Break-even at p_interface ≈ 0.008 (99.2% fidelity) vs pure atom baseline. Below that, hybrid wins; above that, pure atom wins. Plotting now.",
  ),
];

// ── Build ContextPacker with real summarizer + real providers ──────────────

const adapter = createBlockConversationAdapter();
const authoritativePaths = new Set(
  listAuthoritativeArtifactPaths(projectDir).map((p) => p),
);

const packer = new ContextPacker({
  adapter: adapter as any,
  // Tiny window so low usageTokens triggers condense. effectiveWindow = 500-100 = 400, condense = 0.6*400 = 240.
  thresholds: { windowLimit: 500, reservedReplyTokens: 100 },
  // 6 retained ~= last 3 turns kept intact.
  keepTailMessages: 6,
  summarizer: { model: model as any, apiKey },
  attachmentProviders: [
    createRecentFilesProvider(cache, {
      projectDir,
      excludePaths: authoritativePaths,
      maxFiles: 5,
    }),
    createAuthoritativeArtifactsProvider({ projectDir }),
  ],
});

// ── Run the compaction cycle ───────────────────────────────────────────────

console.log("\n── ContextPacker.runCycle (real summarizer) ──");
const result = await packer.runCycle({
  messages,
  usageTokens: 300, // > condenseThreshold (240) → forces condense
});

console.log(`  mode: ${result.mode}`);
console.log(`  removedCount: ${result.removedCount}`);
console.log(`  rebuilt.length: ${result.messages.length}`);
console.log(
  `  carryforwardNote (first 150 chars): ${result.note?.slice(0, 150)}${(result.note?.length ?? 0) > 150 ? "…" : ""}`,
);

const rebuilt = result.messages as any[];

// ── Static assertions on rebuilt shape ─────────────────────────────────────

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n── assertions on rebuilt conversation ──");

check("mode === 'condensed'", result.mode === "condensed", `got ${result.mode}`);
check("rebuilt has more than just the tail", rebuilt.length > 6);

function contentOf(m: any): string {
  return typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content)
      ? m.content
          .map((b: any) => (typeof b === "string" ? b : b.text ?? b.content ?? ""))
          .join("\n")
      : "";
}

const carryforwardIdx = rebuilt.findIndex((m) =>
  contentOf(m).includes("carryforward") ||
  contentOf(m).includes("compact") ||
  m.kind === "carryforward",
);
check("carryforward message present near start", carryforwardIdx <= 2, `idx=${carryforwardIdx}`);

const recentIdx = rebuilt.findIndex((m) =>
  contentOf(m).includes("<recent_files"),
);
const authIdx = rebuilt.findIndex((m) =>
  contentOf(m).includes('<authoritative path="notes/plan.md"'),
);
const memoryIdx = rebuilt.findIndex((m) =>
  contentOf(m).includes('<authoritative path="notes/memory.md"'),
);

check("<recent_files> attachment present", recentIdx >= 0, `idx=${recentIdx}`);
check("<authoritative> plan.md attachment present", authIdx >= 0, `idx=${authIdx}`);
check("<authoritative> memory.md attachment present", memoryIdx >= 0, `idx=${memoryIdx}`);
check(
  "attachments appear after carryforward",
  recentIdx > carryforwardIdx && authIdx > carryforwardIdx,
  `carry=${carryforwardIdx} recent=${recentIdx} auth=${authIdx}`,
);

const planAttachmentMsg = rebuilt[authIdx];
check(
  `plan.md attachment contains ${PLAN_MARKER}`,
  contentOf(planAttachmentMsg).includes(PLAN_MARKER),
);
check(
  `memory.md attachment contains ${MEMORY_MARKER}`,
  contentOf(rebuilt[memoryIdx]).includes(MEMORY_MARKER),
);
check(
  `recent_files attachment contains ${RECENT_FILE_MARKER} (solver.py content)`,
  contentOf(rebuilt[recentIdx]).includes(RECENT_FILE_MARKER),
);

const note = result.note ?? "";
check("carryforward note is non-empty", note.length > 20, `len=${note.length}`);
check(
  "carryforward note looks like real summary (contains 'BB' or 'code' or 'qubit')",
  /BB|code|qubit|decoder|hybrid/i.test(note),
  `note=${note.slice(0, 120)}`,
);

// ── Live verification: model actually uses the attachments ────────────────

console.log(
  "\n── live verification: model replies based on attached content ──",
);

// We take the rebuilt conversation and append a new user turn asking
// specifically about the tokens embedded in the attached files. If the
// model can answer, the attachments are not just delivered but also read.

// Strip framework-internal fields (kind/isMeta/sourcePath/timestamp) that
// Anthropic doesn't know about. In production these are stripped by the
// pi-agent-core adapter; since we bypass the agent loop and call streamSimple
// directly, we sanitize ourselves. Keep content shape intact — assistant
// messages MUST be block arrays (pi-ai requires .flatMap on content).
const sanitizedRebuilt = rebuilt.map((m: any) => ({
  role: m.role,
  content: m.content,
}));

const verifyMessages = [
  ...sanitizedRebuilt,
  {
    role: "user",
    content:
      "Quick sanity check. Three short answers, one line each:\n" +
      "1. What is the exact token string on the 'Token:' line of notes/plan.md?\n" +
      "2. What is the exact token string on the 'Token:' line of notes/memory.md?\n" +
      "3. In the recent files you were given, which contains a commented marker starting with 'NEBULA'? Give the file's basename and the full marker string.",
  },
];

// Deep dump of message [0] since its content was shown as [blocks: text]
console.log("\n  message[0] full:", JSON.stringify(verifyMessages[0]).slice(0, 400));

// Dump the conversation shape we're about to send.
console.log("\n  verifyMessages shape:");
for (let i = 0; i < verifyMessages.length; i++) {
  const m: any = verifyMessages[i];
  const contentPreview =
    typeof m.content === "string"
      ? m.content.slice(0, 80).replace(/\n/g, " ⏎ ")
      : Array.isArray(m.content)
        ? `[blocks: ${m.content.map((b: any) => b.type).join(",")}]`
        : "(unknown)";
  const extraKeys = Object.keys(m).filter(
    (k) => !["role", "content"].includes(k),
  );
  console.log(
    `    [${i}] role=${m.role} extra=[${extraKeys.join(",")}] content=${contentPreview}`,
  );
}

let replyText = "";
let verifyError: string | undefined;
let replyDebug = "";
try {
  const reply = await streamSimple(
    model as any,
    { systemPrompt: "You are a concise assistant. Answer only from provided context.", messages: verifyMessages } as any,
    { maxTokens: 400, apiKey } as any,
  ).result();
  const blocks = reply.content as any[];
  replyDebug = `stopReason=${reply.stopReason} blocks=[${blocks.map((b) => `${b.type}(${(b.text ?? JSON.stringify(b.input ?? {})).toString().length}ch)`).join(", ")}]`;
  replyText =
    blocks
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n") ?? "";
  console.log(`  ${replyDebug}`);
  console.log(
    `  reply text (first 500 chars):\n${replyText.slice(0, 500)}${replyText.length > 500 ? "…" : ""}`,
  );
  // If no text blocks but there are other blocks, surface them for diagnosis.
  if (!replyText) {
    for (const b of blocks) {
      if (b.type !== "text") {
        const repr = JSON.stringify(b).slice(0, 300);
        console.log(`    non-text block: ${repr}`);
      }
    }
  }
} catch (err: any) {
  verifyError = (err?.message ?? String(err)).slice(0, 600);
  console.log(`  ! verification request FAILED: ${verifyError}`);
}

const mentionsPlan = replyText.includes(PLAN_MARKER);
const mentionsMemory = replyText.includes(MEMORY_MARKER);
const mentionsRecent = replyText.includes(RECENT_FILE_MARKER);
check(
  `reply mentions plan.md marker (${PLAN_MARKER})`,
  mentionsPlan,
  mentionsPlan ? "" : `reply=${replyText.slice(0, 200)}`,
);
check(
  `reply mentions memory.md marker (${MEMORY_MARKER})`,
  mentionsMemory,
  mentionsMemory ? "" : `reply=${replyText.slice(0, 200)}`,
);
check(
  `reply mentions recent-file marker (${RECENT_FILE_MARKER})`,
  mentionsRecent,
  mentionsRecent ? "" : `reply=${replyText.slice(0, 200)}`,
);

// ── Verdict ────────────────────────────────────────────────────────────────

const staticAssertionsOk = failures <= 3; // 3 are the live-verify ones
const liveOk = mentionsPlan && mentionsMemory && mentionsRecent;

let verdict: "PHASE-3B-LIVE-VERIFIED" | "PHASE-3B-MODEL-IGNORED-ATTACHMENTS" | "PHASE-3B-SCHEMA-REJECTED" | "INCONCLUSIVE";
let rationale: string;

if (verifyError) {
  verdict = "PHASE-3B-SCHEMA-REJECTED";
  rationale = `The provider rejected the rebuilt conversation with: ${verifyError}. The attachment rebuild shape needs adjustment.`;
} else if (liveOk && staticAssertionsOk) {
  verdict = "PHASE-3B-LIVE-VERIFIED";
  rationale =
    "Compaction with real summarizer produced the correct rebuilt shape; the provider accepted it; the model's reply quoted the plan/memory/recent-file markers we embedded in the attachments, proving the attachments were delivered AND read.";
} else if (!liveOk && staticAssertionsOk) {
  verdict = "PHASE-3B-MODEL-IGNORED-ATTACHMENTS";
  rationale =
    "Rebuilt shape and provider acceptance are correct, but the model did not echo the embedded markers. The attachments are reaching the API but the model isn't prioritizing them (possibly an attention/role-tag issue — consider re-checking isMeta handling or the attachment wrapper syntax).";
} else {
  verdict = "INCONCLUSIVE";
  rationale = `Static assertion failures: ${failures}. Debug the rebuild before retrying the live check.`;
}

console.log(`\n══ VERDICT: ${verdict} ══`);
console.log(rationale);

// ── Write notes ────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const notesDir = join(here, "..", "notes");
mkdirSync(notesDir, { recursive: true });
const outPath = join(notesDir, "phase-3b-real-provider-verification.md");

const lines: string[] = [];
lines.push("# Phase 3b real-provider verification");
lines.push("");
lines.push(`Date: ${new Date().toISOString()}`);
lines.push(
  `Provider: anthropic via ${model.baseUrl ?? "direct Anthropic"}, model \`claude-haiku-4-5-20251001\``,
);
lines.push("Script: `scripts/spike_real_compaction.mts`");
lines.push("");
lines.push(`## Verdict: **${verdict}**`);
lines.push("");
lines.push(rationale);
lines.push("");
lines.push("## Compaction outcome");
lines.push("");
lines.push(`- mode: \`${result.mode}\``);
lines.push(`- removedCount: ${result.removedCount}`);
lines.push(`- rebuilt.length: ${rebuilt.length}`);
lines.push(`- carryforward note (first 300 chars): \`${(note ?? "").slice(0, 300).replace(/\n/g, " ⏎ ")}\``);
lines.push("");
lines.push("## Attachments in rebuilt conversation");
lines.push("");
lines.push(`- <recent_files> at index ${recentIdx}: ${recentIdx >= 0 ? "present" : "**MISSING**"}`);
lines.push(`- <authoritative path="notes/plan.md"> at index ${authIdx}: ${authIdx >= 0 ? "present" : "**MISSING**"}`);
lines.push(`- <authoritative path="notes/memory.md"> at index ${memoryIdx}: ${memoryIdx >= 0 ? "present" : "**MISSING**"}`);
lines.push("");
lines.push("## Live verification reply (verbatim)");
lines.push("");
lines.push("```");
lines.push(replyText || "(no reply — see error)");
lines.push("```");
lines.push("");
lines.push(`- plan.md marker (\`${PLAN_MARKER}\`) in reply: ${mentionsPlan ? "yes" : "**no**"}`);
lines.push(`- memory.md marker (\`${MEMORY_MARKER}\`) in reply: ${mentionsMemory ? "yes" : "**no**"}`);
lines.push(`- recent-file marker (\`${RECENT_FILE_MARKER}\`) in reply: ${mentionsRecent ? "yes" : "**no**"}`);
lines.push("");
if (verifyError) {
  lines.push("## Provider error (schema rejection)");
  lines.push("");
  lines.push("```");
  lines.push(verifyError);
  lines.push("```");
  lines.push("");
}
lines.push("## Implications");
lines.push("");
if (verdict === "PHASE-3B-LIVE-VERIFIED") {
  lines.push("No code change needed. Phase 3b's carry-forward is functioning end-to-end: real summarizer, real providers, model accepts rebuilt shape and actually consumes the attachments.");
} else if (verdict === "PHASE-3B-SCHEMA-REJECTED") {
  lines.push("The rebuilt shape isn't API-conformant. Most likely cause: attachment messages have unexpected role/kind fields that the provider doesn't accept, or ordering conflicts (assistant→assistant, toolResult→user without prior toolCall). Investigate repairMessageIntegrity output and consider stripping the `kind` field at the adapter boundary.");
} else if (verdict === "PHASE-3B-MODEL-IGNORED-ATTACHMENTS") {
  lines.push("The attachments reach the model but it doesn't prioritize them. Possible mitigations: (1) move attachments adjacent to the final user turn instead of between preamble and retained tail, (2) reword the attachment wrapper to be more imperative (\"You MUST reference these files when relevant\"), (3) replace the XML-tag wrapper with a role=tool synthetic message if the provider honors that.");
} else {
  lines.push("See static-assertion failures above for the first thing to fix.");
}
lines.push("");

writeFileSync(outPath, lines.join("\n"));
console.log(`\nWrote ${outPath}`);

// Clean up temp dir
try { rmSync(projectDir, { recursive: true, force: true }); } catch {}

process.exit(failures === 0 ? 0 : 1);
