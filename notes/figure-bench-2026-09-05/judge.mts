// Blind pairwise judge: two figure PNGs, one claim, a fixed rubric; a vision model says which one a
// referee would accept, with per-criterion scores. Run with both orders and two judge families.
import { readFileSync, writeFileSync } from "node:fs";
import { resolveModel } from "/Users/muqiao/Documents/Sisyphus/src/agents/spawn.js";
import { getApiKey } from "/Users/muqiao/Documents/Sisyphus/src/auth.js";
import { streamSimple } from "@earendil-works/pi-ai/compat";

type Pair = { name: string; a: string; b: string; claim: string; kind: "data" | "schematic" };
const pairs: Pair[] = JSON.parse(readFileSync(process.argv[2], "utf-8"));
const judges = (process.argv[3] ?? "glm-5.3-flash,sonnet").split(",");
const repeats = Number(process.argv[4] ?? 1);
const outPath = process.argv[5] ?? "judge_results.json";

const RUBRIC = `You are a referee for a physics journal judging two candidate versions of the same figure. Look only at the pixels.
Score EACH figure 0-2 on each criterion (0 = fails, 1 = partly, 2 = fully):
1. claim: the stated claim can be read off the figure alone.
2. condition: every panel says what condition it shows (temperature, power, regime) if panels differ; n/a → 2.
3. physical: nothing impossible or inconsistent on the axes (an infidelity or probability above 1, a wrong axis name, a decaying quantity that grows).
4. legible: at journal print size (this figure would print 3.4 in or 7 in wide) every label is readable and nothing overlaps or is clipped.
5. focus: only the series that carry the claim; no more than ~4 lines per panel; references visibly subordinate.
6. space: no dead zone (empty band between axes and a legend), no page-tall aspect, the data fills the frame.
7. convention: for a schematic, correct visual conventions (straight arrow = coherent drive, wavy = spontaneous decay, level labels next to their level, no key box needed); for a data plot, direct labels rather than a legend, semantic colour (one hue per physical group).
Then decide the WINNER: the figure a referee would accept with fewer revisions. Answer ONLY with JSON:
{"fig1": {"claim":n,"condition":n,"physical":n,"legible":n,"focus":n,"space":n,"convention":n}, "fig2": {...}, "winner": 1|2|0, "reason": "<=40 words"}`;

function img(path: string) {
  return { type: "image" as const, data: readFileSync(path).toString("base64"), mimeType: "image/png" };
}
async function ask(judge: string, p: Pair, swap: boolean) {
  const model: any = resolveModel(judge);
  const apiKey = await getApiKey(model.provider);
  const [first, second] = swap ? [p.b, p.a] : [p.a, p.b];
  const stream: any = await streamSimple(model, {
    systemPrompt: RUBRIC,
    messages: [{ role: "user", content: [
      { type: "text", text: `Claim the figure must settle: ${p.claim}\nFigure type: ${p.kind}.\nFigure 1:` }, img(first),
      { type: "text", text: "Figure 2:" }, img(second),
      { type: "text", text: "Score both and pick the winner. JSON only." } ] }],
    tools: [],
  } as any, { apiKey, maxTokens: judge.startsWith("glm") ? 40000 : 3000, ...(judge.startsWith("glm") ? { reasoning: "low" } : {}) } as any);
  const final: any = await stream.finalResultPromise;
  const text = Array.isArray(final.content) ? final.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") : String(final.content ?? "");
  const m = text.match(/\{[\s\S]*\}/);
  let j: any = null;
  try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  const cost = final.usage?.cost?.total ?? final.cost ?? null;
  if (!j) return { judge, pair: p.name, swap, error: (final.errorMessage ?? text).slice(0, 200), cost };
  // map back to a/b
  const A = swap ? j.fig2 : j.fig1, B = swap ? j.fig1 : j.fig2;
  const winner = j.winner === 0 ? "tie" : ((j.winner === 1) !== swap) ? "a" : "b";
  return { judge, pair: p.name, swap, a: A, b: B, winner, reason: j.reason, cost };
}
const sum = (s: any) => s ? Object.values(s).reduce((x: any, y: any) => x + Number(y), 0) : null;
const results: any[] = [];
for (const p of pairs) for (const judge of judges) for (let r = 0; r < repeats; r++) for (const swap of [false, true]) {
  try {
    const res: any = await ask(judge, p, swap); results.push(res);
    console.log(`${p.name} | ${judge} | ${swap ? "B-first" : "A-first"} → winner=${res.winner ?? "ERR"} A=${sum(res.a)} B=${sum(res.b)} ${res.error ?? res.reason ?? ""}`);
  } catch (e: any) { console.log(`${p.name} | ${judge} | ERROR ${e?.message?.slice(0, 150)}`); results.push({ judge, pair: p.name, swap, error: String(e?.message).slice(0, 200) }); }
  writeFileSync(outPath, JSON.stringify(results, null, 1));
}
// tally
for (const p of pairs) {
  const rs = results.filter((r) => r.pair === p.name && r.winner);
  const wa = rs.filter((r) => r.winner === "a").length, wb = rs.filter((r) => r.winner === "b").length, t = rs.filter((r) => r.winner === "tie").length;
  const ma = rs.map((r) => sum(r.a)).filter((v) => v !== null), mb = rs.map((r) => sum(r.b)).filter((v) => v !== null);
  const avg = (v: any[]) => v.length ? (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : "?";
  console.log(`TALLY ${p.name}: A wins ${wa}, B wins ${wb}, ties ${t} (of ${rs.length}); mean score A ${avg(ma)}/14, B ${avg(mb)}/14`);
}
