/**
 * Notes compaction — LLM-based cleanup of notes files.
 *
 * Different from context compaction (which summarizes conversation messages):
 * this compacts the persistent notes files on disk when they grow too large.
 *
 * Triggered during context compaction to keep notes lean and high-signal.
 * Only compacts files that exceed the size threshold.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSafe, extractTextContent } from "./utils.js";
import type { ExtensionBus } from "./extensions.js";

const NOTES_COMPACTION_THRESHOLD = 8000; // chars — ~2K tokens

const COMPACTION_SYSTEM_PROMPT = `You are a research notes editor for an autonomous research agent. Your ONLY job is to clean up a notes file by removing noise while preserving all valuable information.`;

const COMPACTION_PROMPTS: Record<string, string> = {
  "notes/memory.md": `Clean up this freeform research scratchpad:

1. Remove TODO items that are clearly done (marked complete, or superseded by later entries)
2. Merge duplicate observations about the same topic
3. Consolidate dead-end notes: keep "X doesn't work because Y" as one line, remove verbose debugging logs
4. Remove stale intermediate thoughts superseded by later conclusions
5. Keep: key decisions + rationale, working hypotheses, open questions, file paths, parameter values

Output the cleaned file. Same format, same section headers. Do NOT add new information.
If in doubt, KEEP the entry — false deletion is worse than noise.`,

  "notes/literature.md": `Clean up this literature notes file:

1. Merge duplicate entries for the same paper (keep the most complete version)
2. Remove redundant cross-references if the same connection is stated multiple times
3. Consolidate "To read" lists — remove papers that appear later in detailed notes
4. Preserve ALL: citation keys, numerical results, method descriptions, limitations

Output the cleaned file. Same format, same section headers. Do NOT add new information.`,

  "notes/experiments.md": `Clean up this experiment notes file:

1. For experiments that were re-run with fixes, merge the entries (keep final result, note what was fixed)
2. Remove verbose debug output or intermediate print statements
3. Keep ALL experiment entries — even failed ones are valuable (record what didn't work)
4. Preserve ALL: hypothesis, setup, numerical results, file paths, parameter values, interpretation

Output the cleaned file. Same format, same section headers. Do NOT add new information.`,
};

export interface NotesCompactionResult {
  compacted: string[];
  skipped: string[];
  savings: Record<string, { before: number; after: number }>;
}

/**
 * Compact notes files that exceed the size threshold.
 * Called during context compaction to keep notes lean.
 * Files are compacted in parallel since they are independent.
 */
export async function compactNotesIfNeeded(
  projectDir: string,
  model: Model<any>,
  apiKey: string,
  bus?: ExtensionBus,
): Promise<NotesCompactionResult> {
  const files = ["notes/memory.md", "notes/literature.md", "notes/experiments.md"];
  const result: NotesCompactionResult = { compacted: [], skipped: [], savings: {} };

  // Collect files that need compaction
  const candidates: { file: string; path: string; content: string; prompt: string }[] = [];
  for (const file of files) {
    const path = join(projectDir, file);
    const content = readFileSafe(path);
    if (!content || content.length < NOTES_COMPACTION_THRESHOLD) {
      result.skipped.push(file);
      continue;
    }
    candidates.push({
      file,
      path,
      content,
      prompt: COMPACTION_PROMPTS[file] ?? COMPACTION_PROMPTS["notes/memory.md"],
    });
  }

  if (candidates.length === 0) return result;

  // Compact all eligible files in parallel
  const outcomes = await Promise.allSettled(
    candidates.map(async ({ file, path, content, prompt }) => {
      const cleaned = await compactSingleFile(content, file, prompt, model, apiKey);
      // Only write if meaningfully shorter (>10% reduction)
      if (cleaned.length < content.length * 0.9) {
        writeFileSync(path, cleaned);
        return { file, before: content.length, after: cleaned.length };
      }
      return null;
    }),
  );

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const file = candidates[i].file;
    if (outcome.status === "fulfilled" && outcome.value) {
      result.compacted.push(file);
      result.savings[file] = { before: outcome.value.before, after: outcome.value.after };
    } else {
      result.skipped.push(file);
    }
  }

  if (result.compacted.length > 0) {
    await bus?.emit({
      type: "notes_compaction",
      files: result.compacted,
      savings: result.savings,
    });
  }

  return result;
}

async function compactSingleFile(
  content: string,
  filename: string,
  prompt: string,
  model: Model<any>,
  apiKey: string,
): Promise<string> {
  const response = await completeSimple(model, {
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{ type: "text", text: `File: ${filename} (${content.length} chars)\n\n<notes>\n${content}\n</notes>\n\n${prompt}` }],
      timestamp: Date.now(),
    }],
    tools: [],
  }, {
    maxTokens: 4096,
    apiKey,
  } as any);

  return extractTextContent(response.content);
}
