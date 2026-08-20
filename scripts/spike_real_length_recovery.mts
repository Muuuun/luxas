#!/usr/bin/env tsx
/**
 * Real-provider cross-check for Phase 2 length recovery.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/spike_real_length_recovery.mts
 *
 * Burns a tiny amount of API credit (~$0.001 per experiment) on haiku-4-5.
 * Skips cleanly if the env var is missing.
 *
 * What it verifies
 * ----------------
 * The Phase 2 B-level recovery pattern calls:
 *
 *     agent.replaceMessages([...state.messages, isMetaUser(CONTINUE_PROMPT)]);
 *     await agent.continue();
 *
 * where `state.messages` already includes the length-truncated assistant
 * message verbatim (pi-agent-core pushes it via agent-loop.js:105 before any
 * stopReason inspection). pi-agent-core's transformMessages does NOT filter
 * stopReason="length" assistants — whatever content blocks came back get
 * shipped verbatim on the next request.
 *
 * The big risk: with thinking enabled, the partial assistant may contain
 * a `thinking` block whose `thinkingSignature` is only valid for the full
 * (un-truncated) thinking. Anthropic's API may reject a request that
 * includes a malformed/unsigned thinking block — and if it does, Phase 2
 * needs to strip or rewrite thinking blocks before the continuation.
 *
 * Experiments
 * -----------
 *   A. reasoning=undefined, maxTokens=small  — plain text truncation
 *      → expect OK. Baseline that the recovery loop works for no-thinking agents.
 *
 *   B. reasoning="low",     maxTokens=small  — likely mid-thinking truncation
 *      → the interesting case. Observe whether:
 *         (i) Anthropic returns a thinking block at all under tight budget
 *         (ii) The continuation request with that partial assistant succeeds
 *         (iii) If it fails, what the error shape looks like (schema? rate limit?)
 *
 * Output
 * ------
 * Writes notes/phase-2-real-provider-verification.md with the observations
 * plus a verdict: B-LEVEL-SAFE | B-LEVEL-NEEDS-MITIGATION | INCONCLUSIVE.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { streamSimple, getModel } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";

import { LENGTH_RECOVERY_CONTINUE_PROMPT } from "../src/agents/spawn.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("skipped: ANTHROPIC_API_KEY not set");
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = getModel("anthropic", "claude-haiku-4-5-20251001");

interface ExperimentResult {
  label: string;
  reasoning: "off" | "low";
  triggeredLength: boolean;
  partialBlockTypes: string[];
  hasSignedThinking: boolean;
  continuationSucceeded: boolean | null;
  continuationError?: string;
  continuationStopReason?: string;
  continuationFirstText?: string;
}

const results: ExperimentResult[] = [];

async function runExperiment(
  label: string,
  reasoning: "off" | "low",
  maxTokens: number,
): Promise<ExperimentResult> {
  console.log(`\n=== ${label} (reasoning=${reasoning}, maxTokens=${maxTokens}) ===`);

  const systemPrompt = "You are a thorough, verbose assistant. When asked to write, go deep.";
  const userPrompt = "Write a detailed 2000-word essay explaining why the Fibonacci sequence appears in nature. Cover phyllotaxis, mollusk shells, pinecones, flower petals, and galactic arms. Be exhaustive.";

  const ctx1: any = {
    systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  const opts1: any = { maxTokens, apiKey };
  if (reasoning !== "off") opts1.reasoning = reasoning;

  const msg1 = await streamSimple(model, ctx1, opts1).result();

  const blockTypes: string[] = [];
  let hasSignedThinking = false;
  for (const block of (msg1.content as any[])) {
    blockTypes.push(block.type);
    if (block.type === "thinking" && block.thinkingSignature) hasSignedThinking = true;
  }

  console.log(`  request 1: stopReason=${msg1.stopReason}, blocks=[${blockTypes.join(", ")}]${hasSignedThinking ? " (thinking signed)" : ""}`);

  const out: ExperimentResult = {
    label,
    reasoning,
    triggeredLength: msg1.stopReason === "length",
    partialBlockTypes: blockTypes,
    hasSignedThinking,
    continuationSucceeded: null,
  };

  if (msg1.stopReason !== "length") {
    console.log(`  ! did not trigger length — maxTokens may be too generous`);
    return out;
  }

  // Replay: include the partial assistant + isMeta user marker, request continuation.
  const ctx2: any = {
    systemPrompt,
    messages: [
      ctx1.messages[0],
      msg1 as AssistantMessage,
      { role: "user", content: LENGTH_RECOVERY_CONTINUE_PROMPT },
    ],
  };
  const opts2: any = { maxTokens: 500, apiKey };
  if (reasoning !== "off") opts2.reasoning = reasoning;

  try {
    const msg2 = await streamSimple(model, ctx2, opts2).result();
    out.continuationSucceeded = true;
    out.continuationStopReason = msg2.stopReason;
    const firstText = (msg2.content as any[]).find((b) => b.type === "text")?.text ?? "";
    out.continuationFirstText = firstText.slice(0, 200);
    console.log(`  request 2 OK: stopReason=${msg2.stopReason}, first text: "${firstText.slice(0, 80)}…"`);
  } catch (err: any) {
    out.continuationSucceeded = false;
    out.continuationError = (err?.message ?? String(err)).slice(0, 500);
    console.log(`  ! request 2 FAILED: ${out.continuationError}`);
  }

  return out;
}

// Experiment A: no thinking. Low maxTokens forces length truncation in mid-text.
results.push(await runExperiment("A (text-only, no thinking)", "off", 120));

// Experiment B: reasoning=low. Thinking is expensive; tight maxTokens makes it
// likely that the response either:
//   - returns thinking only with no text (truncated in thinking)
//   - returns complete thinking + partial text (truncated in text)
// Both cases replay the full assistant on the next request.
results.push(await runExperiment("B (with low thinking)", "low", 400));

// ── Verdict ─────────────────────────────────────────────────────────────

const lengthTriggered = results.filter((r) => r.triggeredLength);
const continuationResults = lengthTriggered.filter((r) => r.continuationSucceeded !== null);
const allSucceeded = continuationResults.length > 0 && continuationResults.every((r) => r.continuationSucceeded === true);
const anyFailed = continuationResults.some((r) => r.continuationSucceeded === false);

let verdict: "B-LEVEL-SAFE" | "B-LEVEL-NEEDS-MITIGATION" | "INCONCLUSIVE";
let verdictRationale: string;

if (lengthTriggered.length === 0) {
  verdict = "INCONCLUSIVE";
  verdictRationale = "None of the experiments triggered stopReason=length. Lower maxTokens and re-run.";
} else if (allSucceeded) {
  verdict = "B-LEVEL-SAFE";
  verdictRationale =
    "All length-truncated experiments successfully continued via replaceMessages + continue(). " +
    "Anthropic accepted the partial assistant (including thinking blocks when present) verbatim in " +
    "the next request. No schema mitigation needed for Phase 2's current design.";
} else if (anyFailed) {
  verdict = "B-LEVEL-NEEDS-MITIGATION";
  verdictRationale =
    "At least one continuation request failed. Phase 2's recovery pattern needs a mitigation step " +
    "before the replaceMessages call — likely stripping or rewriting the partial assistant's " +
    "unsigned thinking blocks. See the per-experiment errors below for the exact failure mode.";
} else {
  verdict = "INCONCLUSIVE";
  verdictRationale = "Unexpected state — some experiments triggered length but continuation state is ambiguous.";
}

console.log(`\n══ VERDICT: ${verdict} ══`);
console.log(verdictRationale);

// ── Write notes ─────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const notesDir = join(here, "..", "notes");
mkdirSync(notesDir, { recursive: true });
const outPath = join(notesDir, "phase-2-real-provider-verification.md");

const lines: string[] = [];
lines.push(`# Phase 2 real-provider verification`);
lines.push(``);
lines.push(`Date: ${new Date().toISOString()}`);
lines.push(`Provider: Anthropic (direct API), model \`claude-haiku-4-5-20251001\``);
lines.push(`Script: \`scripts/spike_real_length_recovery.mts\``);
lines.push(``);
lines.push(`## Verdict: **${verdict}**`);
lines.push(``);
lines.push(verdictRationale);
lines.push(``);
lines.push(`## What was tested`);
lines.push(``);
lines.push(`The Phase 2 B-level recovery pattern sends a partial (stopReason=length)`);
lines.push(`assistant message back to the provider in the next request, with an isMeta`);
lines.push(`user marker appended, and expects continuation without a schema error. The`);
lines.push(`concern is that pi-agent-core's transformMessages does not strip length-`);
lines.push(`truncated content blocks — including any thinking blocks whose signature`);
lines.push(`was only valid for the un-truncated thinking. Mock smoke (PR-2) cannot`);
lines.push(`verify this; only a real provider can.`);
lines.push(``);
lines.push(`## Experiments`);
lines.push(``);
for (const r of results) {
  lines.push(`### ${r.label}`);
  lines.push(``);
  lines.push(`- reasoning: \`${r.reasoning}\``);
  lines.push(`- request 1 triggered length: ${r.triggeredLength ? "yes" : "**no** (inconclusive for this row)"}`);
  lines.push(`- partial content blocks: \`${r.partialBlockTypes.join(", ")}\``);
  lines.push(`- thinking signed: ${r.hasSignedThinking ? "yes" : "no"}`);
  if (r.triggeredLength) {
    if (r.continuationSucceeded === true) {
      lines.push(`- continuation request: **OK**`);
      lines.push(`  - stopReason: \`${r.continuationStopReason}\``);
      lines.push(`  - first text (first 200 chars): ${r.continuationFirstText ? `\`${r.continuationFirstText.replace(/\n/g, " ⏎ ")}\`` : "(none)"}`);
    } else if (r.continuationSucceeded === false) {
      lines.push(`- continuation request: **FAILED**`);
      lines.push(`  - error: \`\`\``);
      lines.push(r.continuationError ?? "(no error message)");
      lines.push(`  - \`\`\``);
    }
  }
  lines.push(``);
}
lines.push(`## Implications`);
lines.push(``);
if (verdict === "B-LEVEL-SAFE") {
  lines.push(`No code change needed. Phase 2's current recovery flow is safe for production.`);
  lines.push(``);
  lines.push(`Phase 2b (A-level stream merge) can proceed whenever scheduled; the B-level`);
  lines.push(`fallback remains valid.`);
} else if (verdict === "B-LEVEL-NEEDS-MITIGATION") {
  lines.push(`Add a mitigation step inside \`runWithLengthRecovery\` between the length`);
  lines.push(`detection and the \`replaceMessages\` call:`);
  lines.push(``);
  lines.push(`\`\`\`ts`);
  lines.push(`const sanitized = sanitizeLengthTruncatedAssistant(lastAssistant);`);
  lines.push(`agent.replaceMessages([...messagesWithoutLast, sanitized, markerUser]);`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`Strategy: drop thinking blocks (they're not needed for the continuation —`);
  lines.push(`the model will re-generate thinking from scratch), keep text blocks, drop`);
  lines.push(`any incomplete toolCall blocks. See per-experiment error for the exact`);
  lines.push(`schema complaint.`);
} else {
  lines.push(`Re-run with tighter \`maxTokens\` to force a length truncation. Current run`);
  lines.push(`either did not hit the length path or hit other edge cases.`);
}
lines.push(``);

writeFileSync(outPath, lines.join("\n"));
console.log(`\nWrote ${outPath}`);

process.exit(0);
