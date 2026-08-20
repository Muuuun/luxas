#!/usr/bin/env tsx
/**
 * Empirical test: do the proposed brain.md guards (A: bib-class coupling,
 * B: table-star / figure-star in twocolumn) measurably change DeepSeek-v4-pro's
 * advice when faced with the report-writing decision they target?
 *
 *   npx tsx scripts/smoke_brain_guards.mts <control|treatment> <N>
 */
import { readFileSync, writeFileSync } from "node:fs";

const COND = (process.argv[2] ?? "control") as "control" | "treatment";
const N = parseInt(process.argv[3] ?? "10");

const BRAIN_PATH = "/Users/muqiao/Documents/Sisyphus/src/agents/definitions/brain.md";
const brainOriginal = readFileSync(BRAIN_PATH, "utf-8");

// Anchor: insert immediately after the existing Report-language rule (L271)
// which begins with "**Report language**:". Keep guards short, end-of-paragraph.
const ANCHOR = "- **Report language**:";
if (!brainOriginal.includes(ANCHOR)) {
  throw new Error(`anchor '${ANCHOR}' not found in brain.md — adjust insertion point`);
}

const GUARD_A = `- **Bibliography style coupling**: \`apsrev4-2.bst\`, \`naturemag.bst\`, \`IEEEtran.bst\`, \`splncs04.bst\`, \`ACM-Reference-Format.bst\` — these venue \`.bst\` files are tightly coupled to their venue document classes (revtex4-2 / nature / IEEEtran / llncs / acmart). Using a venue \`.bst\` with plain \`article\` produces malformed inline citations (full author lists dumped into \`\\cite{}\`, overflowing column width). If you're not using the matching documentclass, stick with \`\\bibliographystyle{unsrt}\` or \`plain\`.`;
const GUARD_B = `- **Wide tables in twocolumn**: in \`[twocolumn]article\` (the init_report default), \`\\begin{table}\` / \`\\begin{figure}\` constrains float to ONE column width (~3.5 in). Tables wider than ~4 numeric columns or with long headers MUST use \`\\begin{table*}\` / \`\\begin{figure*}\` to span both columns; otherwise cells overflow into the adjacent column's body text.`;

const SYS = COND === "control"
  ? brainOriginal
  : brainOriginal.replace(ANCHOR, `${GUARD_A}\n${GUARD_B}\n${ANCHOR}`);

const USER = `I'm writing the final report for a physics feasibility assessment project (Ba neutral atoms).
I just finished init_report which gave me a [twocolumn]article scaffold with \\bibliographystyle{unsrt}.

For this physics-flavored report, what bibliographystyle should I use? And how should I format
a 4-column comparison table (Species × MOT/Tweezer/Full) ~3 inches wide that I want centered
at the top of a page? Just show me the LaTeX directives I'd write, no rationale needed.`;

async function callDeepseek(): Promise<string> {
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
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: USER },
      ],
    }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? `<error: ${JSON.stringify(data).slice(0, 200)}>`;
}

// Scoring
function scoreBib(s: string): "BAD" | "GOOD" | "AMBIG" {
  const venueBst = /\\bibliographystyle\{(apsrev4-?2|naturemag|IEEEtran|splncs04|ACM-Reference-Format|revtex|nature)\}/i;
  const safeBst = /\\bibliographystyle\{(unsrt|plain|abbrv|alpha|ieeetr)\}/i;
  const hasVenue = venueBst.test(s);
  const hasSafe = safeBst.test(s);
  if (hasVenue && !hasSafe) return "BAD";
  if (hasSafe && !hasVenue) return "GOOD";
  if (!hasVenue && !hasSafe) return "AMBIG";
  // both: pick the LAST one mentioned (likely the recommendation)
  const lastVenue = s.search(venueBst); // first match positions
  const lastSafe = s.search(safeBst);
  return lastSafe > lastVenue ? "GOOD" : "BAD";
}
function scoreTable(s: string): "BAD" | "GOOD" | "AMBIG" {
  const wideEnv = /\\begin\{(table\*|figure\*)\}/;
  const narrowEnv = /\\begin\{(table|figure)\}(?!\*)/;
  const hasWide = wideEnv.test(s);
  const hasNarrow = narrowEnv.test(s);
  if (hasWide) return "GOOD"; // table* wins regardless — it's the correct env
  if (hasNarrow) return "BAD";
  return "AMBIG";
}

console.log(`=== Condition: ${COND} (N=${N}) ===`);
console.log(`brain.md size: ${SYS.length} chars (${COND === "treatment" ? "+guards A+B" : "stock"})\n`);

type Result = { i: number; bib: string; table: string; raw: string };
const results: Result[] = [];

for (let i = 0; i < N; i++) {
  const raw = await callDeepseek();
  const bib = scoreBib(raw);
  const table = scoreTable(raw);
  results.push({ i, bib, table, raw });
  console.log(`run ${i + 1}: bib=${bib}, table=${table}`);
  console.log(`  ${raw.replace(/\n/g, " ").slice(0, 240)}`);
}

const outPath = `/tmp/smoke_brain_guards_${COND}.json`;
writeFileSync(outPath, JSON.stringify(results, null, 2));

const bibBad = results.filter(r => r.bib === "BAD").length;
const tableBad = results.filter(r => r.table === "BAD").length;
const bibGood = results.filter(r => r.bib === "GOOD").length;
const tableGood = results.filter(r => r.table === "GOOD").length;

console.log(`\n=== Summary (${COND}) ===`);
console.log(`Bib metric:    BAD=${bibBad}/${N}  GOOD=${bibGood}/${N}  AMBIG=${N - bibBad - bibGood}/${N}`);
console.log(`Table metric:  BAD=${tableBad}/${N}  GOOD=${tableGood}/${N}  AMBIG=${N - tableBad - tableGood}/${N}`);
console.log(`Saved raw to ${outPath}`);
