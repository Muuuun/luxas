#!/usr/bin/env tsx
/**
 * cache_probe — does the ASSEMBLED brain read its history back from Anthropic's
 * cache? Live and billed (a few cents on haiku), so it is not a gate.
 *
 * Builds the brain with createResearchAgent on a throwaway project, gives it a
 * scripted chore (read / append a note, repeated) so every turn changes the
 * research snapshot, and prints per call what the API billed as fresh input,
 * cache write and cache read, next to the breakpoints the request carried.
 *
 * A healthy run: after the first call, cache write per call ≈ the new blocks
 * only, and cache read grows with the conversation.
 *
 * --pause S waits S seconds before the third call. With S > 300 that call
 * shows whether the cache outlived the wait (the brain's 1-hour
 * lifetime) or the whole prefix was written again (LUXAS_BRAIN_CACHE_RETENTION=short).
 *
 *   npx tsx scripts/cache_probe.mts [--model haiku] [--turns 6] [--pause 320]
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const modelKey = arg("--model", "haiku");
const turns = Number(arg("--turns", "6"));
const pause = Number(arg("--pause", "0"));

const proj = mkdtempSync(join(tmpdir(), "luxas-cache-probe-"));
mkdirSync(join(proj, "notes"), { recursive: true });
writeFileSync(join(proj, "RESEARCH.md"), "# cache probe\nA throwaway chore to measure prompt caching. No research.\n");
// Notes big enough that a snapshot rewritten every turn shows up in the bill.
writeFileSync(join(proj, "notes", "memory.md"), "# memory\n" + Array.from({ length: 300 }, (_, i) => `- filler line ${i}: the probe needs a snapshot of realistic size.`).join("\n") + "\n");
writeFileSync(join(proj, "notes", "experiments.md"), "# experiments\n");
writeFileSync(join(proj, "notes", "literature.md"), "# literature\n");

delete process.env.LUXAS_MODEL_PROFILE;
delete process.env.LUXAS_BRAIN_MODEL;
process.env.LUXAS_CAPTURE_PAYLOADS = "1";

const { createResearchAgent } = await import("../src/agent.js");
const { agent } = createResearchAgent({ projectDir: proj, maxCostUsd: 1, model: modelKey, maxTurns: turns + 12, thinkingLevel: arg("--thinking", "off") } as any);

const steps = Array.from({ length: turns }, (_, i) => `${i + 1}. bash: echo "- probe step ${i + 1}" >> notes/memory.md`).join("\n");
// The wait is the probe's, not the model's: a model asked to `sleep 320` shortens it.
if (pause) {
  const inner = (agent as any).streamFunction;
  let n = 0;
  (agent as any).streamFunction = async (...a: any[]) => {
    if (++n === 3) { console.log(`(waiting ${pause}s before call 3)`); await new Promise((r) => setTimeout(r, pause * 1000)); }
    return inner.apply(agent, a);
  };
}
// The turn-budget kill switch exits the process; print what was measured first.
process.on("exit", () => report());
const guard = setTimeout(() => { console.log("probe timed out"); process.exit(1); }, 900_000);
try {
  await (agent as any).prompt(`This is a harness wiring test, not research. Do NOT spawn agents, search, or write a report. Make exactly ONE tool call per turn, in this order, then call finish:\n${steps}\nIf finish is refused, stop calling tools.`);
} catch (e: any) { console.log(`(run ended: ${String(e?.message).slice(0, 200)})`); }
clearTimeout(guard);
for (const m of (agent as any).state?.messages ?? []) if (m?.errorMessage) console.log(`(provider error: ${String(m.errorMessage).slice(0, 400)})`);
process.exit(0);

let reported = false;
function report() {
  if (reported) return; reported = true;
  const usage = (() => { try { return readFileSync(join(proj, ".agent", "usage.log"), "utf-8").trim().split("\n").map((l) => l.split("\t")); } catch { return []; } })();
  const pdir = join(proj, ".agent", "payloads");
  const payloads = (() => { try { return readdirSync(pdir).sort().map((f) => JSON.parse(readFileSync(join(pdir, f), "utf-8"))); } catch { return []; } })();
  console.log(`\nproject ${proj}  model ${modelKey}`);
  console.log("call\tfresh_in\tcache_write\tcache_read\tout\tbreakpoints (where)");
  usage.forEach((u, i) => {
    const p: any = payloads[i]?.payload ?? payloads[i];
    const where: string[] = [];
    if (p) {
      (p.system ?? []).forEach((b: any, j: number) => b?.cache_control && where.push(`sys${j}`));
      (p.tools ?? []).forEach((b: any, j: number) => b?.cache_control && where.push(`tool${j}`));
      (p.messages ?? []).forEach((m: any, j: number) => Array.isArray(m.content) && m.content.forEach((b: any, k: number) => b?.cache_control && where.push(`msg${j}/${p.messages.length}.${k}`)));
    }
    console.log(`${i + 1}\t${u[3]}\t${u[6]}\t${u[5]}\t${u[4]}\t${where.join(" ")}`);
  });
  const sum = (c: number) => usage.reduce((a, u) => a + Number(u[c] || 0), 0);
  console.log(`total\t${sum(3)}\t${sum(6)}\t${sum(5)}\t${sum(4)}\tcost $${sum(7).toFixed(4)}`);
}
