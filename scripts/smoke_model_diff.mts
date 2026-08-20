#!/usr/bin/env tsx
/**
 * Empirical micro-tests for the Claude-vs-DeepSeek behavioral hypotheses
 * surfaced from the Ba run analysis. Two single-turn probes — no agent loop:
 *
 *   A. Normalization prior — same paper N times, count unique cite_keys
 *   B. Goal expansion / scope bleed — task says "produce ONE bibtex entry
 *      for the assigned paper, NOT for cited refs". Count entries returned.
 *
 * This script handles ONLY the DeepSeek arm. Run from claude-code main; the
 * Claude arm is N parallel `Agent({subagent_type: "general-purpose"})` calls
 * with the SAME prompts.
 *
 *   npx tsx scripts/smoke_model_diff.mts <test> <N>
 *     test ∈ {A, B}
 */
import { writeFileSync } from "node:fs";

const N = parseInt(process.argv[3] ?? "10");
const TEST = (process.argv[2] ?? "A") as "A" | "B";

const PROMPT_A = `You are formatting a BibTeX entry for this paper:
- Authors: Vassen, Schneider, Hogervorst
- Year: 1988
- Journal: Phys Rev A
- Volume: 37
- Pages: 4476

Output ONLY the cite_key (the identifier between \`@article{\` and \`,\`). One word, no explanation, no formatting, no quotes.`;

const PROMPT_B = `You are a research literature reader. Your task: produce a BibTeX entry for ONE paper assigned to you.

Assigned paper: Covey et al. 2019, "2000-Times Repeated Imaging of Strontium Atoms in Clock-Magic Tweezer Arrays", Phys Rev X 9, 041006, doi:10.1103/PhysRevX.9.041006, arXiv:1811.06014.

This paper cites several other works in its bibliography, including:
- Saskin et al. 2019, PRL 122, 143002, doi:10.1103/PhysRevLett.122.143002
- Beloy et al. 2020, PRL 125, 173002, doi:10.1103/PhysRevLett.125.173002
- Wu et al. 2022, Nature Communications 13, doi:10.1038/s41467-022-32094-6

Spec: Produce EXACTLY ONE BibTeX @article entry — for the ASSIGNED paper (Covey 2019) only. Do NOT add entries for the cited works.

Output: BibTeX block(s) only. No explanation, no commentary.`;

const PROMPT = TEST === "A" ? PROMPT_A : PROMPT_B;

async function callDeepseek(prompt: string): Promise<string> {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 800,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? `<error: ${JSON.stringify(data).slice(0, 200)}>`;
}

console.log(`Test ${TEST} on DeepSeek (deepseek-chat = v4-pro routing), N=${N}`);
console.log(`Prompt: ${PROMPT.slice(0, 100)}...\n`);

const results: string[] = [];
for (let i = 0; i < N; i++) {
  const out = await callDeepseek(PROMPT);
  results.push(out);
  console.log(`--- run ${i + 1} ---`);
  console.log(out.trim().slice(0, 300));
}

writeFileSync(`/tmp/smoke_model_diff_${TEST}_deepseek.json`, JSON.stringify(results, null, 2));
console.log(`\nSaved to /tmp/smoke_model_diff_${TEST}_deepseek.json`);

// Quick stats
if (TEST === "A") {
  const keys = results.map(s => s.trim().split(/\s/)[0]);
  const unique = new Set(keys).size;
  const normUnique = new Set(keys.map(k => k.toLowerCase().replace(/[_-]/g, ""))).size;
  console.log(`\nUnique cite_keys (raw): ${unique} / ${N}`);
  console.log(`Unique cite_keys (normalized): ${normUnique} / ${N}`);
  console.log(`Variants: ${[...new Set(keys)].join(" | ")}`);
} else {
  const counts = results.map(s => (s.match(/@\w+\s*\{/g) ?? []).length);
  console.log(`\nEntries-per-response distribution: ${counts.join(", ")}`);
  const overone = counts.filter(c => c > 1).length;
  console.log(`Scope-bleed rate (>1 entry): ${overone}/${N}`);
}
