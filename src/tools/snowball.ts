/**
 * Citation snowballing — iteratively expand paper graph until convergence.
 *
 * Takes seed papers, expands via Semantic Scholar citations/references,
 * uses LLM to judge relevance, repeats until no new core papers found.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SemanticScholarClient, type Paper } from "./semantic-scholar.js";

const MAX_PAPERS = 200;
const MAX_ROUNDS = 10;
const CONVERGENCE_ROUNDS = 2;
const BATCH_SIZE = 50;

export interface SnowballResult {
  totalCore: number;
  rounds: number;
  allPapers: Paper[];
  corePapers: Paper[];
}

/**
 * Expand paper graph via citation chains until convergence.
 */
export async function snowball(
  topic: string,
  seedPapers: Paper[],
  s2?: SemanticScholarClient,
): Promise<SnowballResult> {
  const client = s2 ?? new SemanticScholarClient();

  // Track all known papers by ID
  const knownIds = new Set<string>();
  const allPapers: Paper[] = [];
  const coreIds = new Set<string>();

  // Initialize with seeds
  for (const p of seedPapers) {
    if (p.paper_id && !knownIds.has(p.paper_id)) {
      knownIds.add(p.paper_id);
      allPapers.push(p);
    }
  }

  // Auto-promote top seeds to core (by citation count)
  const sortedSeeds = [...seedPapers]
    .sort((a, b) => (b.citation_count ?? 0) - (a.citation_count ?? 0))
    .slice(0, 20);
  for (const p of sortedSeeds) {
    coreIds.add(p.paper_id);
  }

  let noNewCount = 0;
  let round = 0;

  while (noNewCount < CONVERGENCE_ROUNDS && round < MAX_ROUNDS) {
    round++;
    if (allPapers.length >= MAX_PAPERS) {
      console.log(
        `[snowball] Paper limit reached: ${allPapers.length} >= ${MAX_PAPERS}`,
      );
      break;
    }

    // Get core papers to expand from
    const corePapers = allPapers.filter((p) => coreIds.has(p.paper_id));
    if (corePapers.length === 0) break;

    // Expand citations
    const candidates: Paper[] = [];

    for (const paper of corePapers) {
      // Forward: who cited this paper?
      const forward = await client.getCitations(paper.paper_id, 30);
      for (const fp of forward) {
        if (fp.paper_id && !knownIds.has(fp.paper_id)) {
          fp.source = "snowball_forward";
          knownIds.add(fp.paper_id);
          allPapers.push(fp);
          candidates.push(fp);
        }
      }

      // Backward: who did this paper cite?
      const backward = await client.getReferences(paper.paper_id, 30);
      for (const bp of backward) {
        if (bp.paper_id && !knownIds.has(bp.paper_id)) {
          bp.source = "snowball_backward";
          knownIds.add(bp.paper_id);
          allPapers.push(bp);
          candidates.push(bp);
        }
      }
    }

    if (candidates.length === 0) {
      noNewCount++;
      console.log(
        `[snowball] Round ${round}: no new candidates, convergence=${noNewCount}`,
      );
      continue;
    }

    // Batch judge relevance using LLM
    let newCore = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const coreInBatch = await judgeRelevance(batch, topic);
      for (const pid of coreInBatch) {
        if (!coreIds.has(pid)) {
          coreIds.add(pid);
          newCore++;
        }
      }
    }

    if (newCore > 0) {
      noNewCount = 0;
      console.log(`[snowball] Round ${round}: found ${newCore} new core papers`);
    } else {
      noNewCount++;
      console.log(
        `[snowball] Round ${round}: no new core papers, convergence=${noNewCount}`,
      );
    }
  }

  const corePapers = allPapers.filter((p) => coreIds.has(p.paper_id));
  console.log(
    `[snowball] Complete: ${corePapers.length} core papers after ${round} rounds`,
  );

  return {
    totalCore: corePapers.length,
    rounds: round,
    allPapers,
    corePapers,
  };
}

/**
 * Use LLM to judge which papers are core-relevant to the topic.
 */
async function judgeRelevance(
  papers: Paper[],
  topic: string,
): Promise<string[]> {
  const paperList = papers
    .map(
      (p) =>
        `- ID: ${p.paper_id} | Title: ${p.title ?? "N/A"} | ` +
        `Year: ${p.year ?? "?"} | Citations: ${p.citation_count ?? 0} | ` +
        `Abstract: ${(p.abstract ?? "").slice(0, 200)}`,
    )
    .join("\n");

  const prompt = `You are a research paper relevance judge.

Topic: ${topic}

Below is a list of candidate papers. For each, decide if it is CORE to this research topic.
A paper is CORE if it directly addresses, advances, or is foundational to the topic.
Tangentially related papers are NOT core.

Papers:
${paperList}

Return ONLY a JSON array of paper_id strings that are CORE. Example: ["id1", "id2"]
No explanation, just the JSON array.`;

  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const stdout = execFileSync(
      "claude",
      ["-p", "--output-format", "json", "--max-turns", "1"],
      {
        input: prompt,
        encoding: "utf-8",
        timeout: 120_000,
        env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    let text: string;
    try {
      const data = JSON.parse(stdout);
      text = data.result ?? stdout;
    } catch {
      text = stdout;
    }

    // Parse JSON array from response
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]") + 1;
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end));
    }
  } catch (err: any) {
    console.warn(`[snowball] Relevance judging failed: ${err.message}`);
  }

  return [];
}
