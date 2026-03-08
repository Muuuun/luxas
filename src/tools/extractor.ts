/**
 * Extract structured information from paper chunks using LLM (claude -p).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parsePaper } from "./reader.js";

export interface Extraction {
  title: string;
  core_method: string;
  key_results: string[];
  benchmarks: Array<{
    name: string;
    metric: string;
    score: string;
    comparison: string;
  }>;
  limitations: string[];
  open_problems: string[];
  compared_methods: string[];
  improvements_over_prior: string;
  dependencies: string[];
}

const EXTRACTION_PROMPT = `You are an expert research paper analyst. Read the following paper content and extract structured information.

Paper content:
{content}

Extract the following as JSON (no other text):
{
  "title": "paper title",
  "core_method": "2-5 sentence description of the core methodology",
  "key_results": ["result 1", "result 2"],
  "benchmarks": [{"name": "benchmark", "metric": "metric", "score": "value", "comparison": "vs prior SOTA"}],
  "limitations": ["limitation stated by authors"],
  "open_problems": ["open problem or future work mentioned"],
  "compared_methods": ["method names compared against"],
  "improvements_over_prior": "what this paper improves over prior work",
  "dependencies": ["key prerequisite techniques or frameworks"]
}

Rules:
- Only include information explicitly stated in the paper
- For benchmarks, include specific numbers
- Distinguish author-stated limitations from your own observations
- If a field has no relevant info, use empty array [] or empty string ""`;

/**
 * Extract structured info from a paper file/directory.
 * Uses claude -p for LLM extraction.
 */
export function extractPaper(
  filePath: string,
  outputDir?: string,
): Extraction | null {
  const chunks = parsePaper(filePath);
  if (chunks.length === 0) {
    console.warn(`[extractor] No content parsed from ${filePath}`);
    return null;
  }

  // Combine chunks into one prompt
  let combined = chunks
    .map((c) => `=== ${c.section} ===\n${c.text}`)
    .join("\n\n");

  // Truncate to ~60K chars to fit in context window
  if (combined.length > 60_000) {
    combined = combined.slice(0, 60_000) + "\n\n[TRUNCATED]";
  }

  const prompt = EXTRACTION_PROMPT.replace("{content}", combined);

  try {
    const resultText = callClaude(prompt);
    const extraction = parseExtraction(resultText);

    if (extraction && outputDir) {
      mkdirSync(outputDir, { recursive: true });
      const stem =
        extname(filePath) === "" ? basename(filePath) : basename(filePath, extname(filePath));
      const outPath = join(outputDir, `${stem}.json`);
      writeFileSync(
        outPath,
        JSON.stringify(extraction, null, 2),
        "utf-8",
      );
      console.log(`[extractor] Extraction saved to ${outPath}`);
    }

    return extraction;
  } catch (err: any) {
    console.error(`[extractor] Extraction failed for ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Call claude -p for extraction.
 */
function callClaude(prompt: string): string {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  try {
    const stdout = execFileSync(
      "claude",
      ["-p", "--output-format", "json", "--max-turns", "1"],
      {
        input: prompt,
        encoding: "utf-8",
        timeout: 300_000, // 5 min for paper extraction
        env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    try {
      const data = JSON.parse(stdout);
      return data.result ?? stdout;
    } catch {
      return stdout;
    }
  } catch (err: any) {
    throw new Error(`claude -p call failed: ${err.message?.slice(0, 300)}`);
  }
}

/**
 * Parse JSON extraction from LLM response.
 */
function parseExtraction(text: string): Extraction | null {
  text = text.trim();

  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Find JSON object in response
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}") + 1;
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      // continue
    }
  }

  // Try ```json ... ```
  const fenceMatch = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(text);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  console.warn("[extractor] Could not parse extraction JSON from response");
  return null;
}
