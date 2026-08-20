#!/usr/bin/env tsx
/**
 * Test C — long-context goal-expansion probe.
 *
 * Recreates the actual reader scenario: full reader.md as system prompt,
 * paper TeX source as user content, asks for the BibTeX entry.
 * Measures: (a) entries returned, (b) which paper(s) they refer to.
 *
 * Single-turn (no tools) — isolates the long-context constraint-decay
 * failure mode from the agent-loop / tool-bypass mode.
 *
 *   npx tsx scripts/smoke_model_diff_C.mts <N>
 */
import { readFileSync, writeFileSync } from "node:fs";

const N = parseInt(process.argv[2] ?? "5");

const READER_MD = readFileSync("/Users/muqiao/Documents/Sisyphus/src/agents/definitions/reader.md", "utf-8")
  .replace(/^---[\s\S]*?---/, "")  // strip frontmatter
  .replace(/\{\{PROJECT_DIR\}\}/g, "/test/proj")
  .replace(/\{\{PAPER_ID\}\}/g, "1811.06014")
  .replace(/\{\{SEARCH_SCRIPT\}\}/g, "/usr/local/bin/search");

const PAPER_TEX = readFileSync(
  "/Users/muqiao/Documents/sisyphus-projects/ba-atom-qc-feasibility/data/papers/1811.06014/lossless_imaging.tex",
  "utf-8",
);

// Simulate the reader's typical user message: short task + then context the
// reader would have gathered after a couple of read-tool calls.
const USER_MSG = `Read paper 1811.06014 ("2000-Times Repeated Imaging of Strontium Atoms in Clock-Magic Tweezer Arrays" by Covey et al.) and extract methodology + literature entry. Focus on: Sr magic wavelength tweezer (515 nm), imaging survival probability, lifetimes under laser cooling.

Below is the paper's main TeX content (assume you already ran the read tool):

<paper_tex>
${PAPER_TEX}
</paper_tex>

Now please provide your final reader output. Specifically:

1. The notes/literature.d/<cite_key>.md content for THIS paper.
2. The BibTeX entries you would add to report/references.bib (per spec, entries needed for this paper to be citeable).

Output format:
=== literature.d/<cite_key>.md ===
<content>

=== references.bib additions ===
<bibtex blocks>`;

async function callDeepseek(): Promise<{ content: string; usage: any }> {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [
        { role: "system", content: READER_MD },
        { role: "user", content: USER_MSG },
      ],
    }),
  });
  const data = await r.json();
  return {
    content: data.choices?.[0]?.message?.content ?? `<err: ${JSON.stringify(data).slice(0, 300)}>`,
    usage: data.usage,
  };
}

console.log(`Test C — long-context scope bleed, DeepSeek N=${N}`);
console.log(`System prompt: ${READER_MD.length} chars (reader.md)`);
console.log(`User msg: ${USER_MSG.length} chars (paper TeX inlined)\n`);

const results: any[] = [];
for (let i = 0; i < N; i++) {
  const t0 = Date.now();
  const r = await callDeepseek();
  const elapsed = Math.round((Date.now() - t0) / 1000);
  // Count bibtex entries in the response
  const entries = [...r.content.matchAll(/@\w+\s*\{\s*([A-Za-z0-9_]+)/g)].map(m => m[1]);
  console.log(`--- run ${i + 1} (${elapsed}s, ${r.usage?.completion_tokens ?? "?"} out tokens) ---`);
  console.log(`bibtex entries: ${entries.length} → ${entries.join(", ") || "(none)"}`);
  results.push({ run: i + 1, entries, content: r.content, usage: r.usage });
}

writeFileSync("/tmp/smoke_model_diff_C_deepseek.json", JSON.stringify(results, null, 2));

// Summary
const counts = results.map(r => r.entries.length);
const onSpec = results.filter(r => r.entries.length === 1 && /covey/i.test(r.entries[0])).length;
const offSpec = results.filter(r => r.entries.length > 1).length;
const wrongSingle = results.filter(r => r.entries.length === 1 && !/covey/i.test(r.entries[0])).length;
const noEntry = results.filter(r => r.entries.length === 0).length;
console.log(`\n=== Summary ===`);
console.log(`On-spec (1 entry, Covey): ${onSpec}/${N}`);
console.log(`Scope-bleed (>1 entry):    ${offSpec}/${N}`);
console.log(`Wrong-single (not Covey):  ${wrongSingle}/${N}`);
console.log(`No-entry:                  ${noEntry}/${N}`);
console.log(`Entry counts: ${counts.join(", ")}`);
