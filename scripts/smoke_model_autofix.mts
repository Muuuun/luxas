/**
 * smoke_model_autofix — a provider rename is adopted only when the replacement
 * PROVES it can still do the job.
 *
 * The load-bearing cases are the rejections. Autofix's whole risk is adopting a
 * candidate that answers successfully and wrongly: probed on 2026-09-15,
 * `deepseek-v4-pro` met a read-these-digits image with a confident
 * `{"answer":"3"}` at HTTP 200. Routing illustrator/illustrator_write/
 * typesetter to that is strictly worse than refusing the run, because the run
 * then looks healthy while shipping figures nothing ever looked at — the Ba-run
 * failure with the alarm disconnected.
 *
 * Offline by construction: fetch and the proposer are injected, so this gates
 * `npm test` with no keys and no spend.
 */
import {
  autofixDeadPins, probeCapability, renderDigitsPng, randomDigits,
  requiredCapabilities, loadOverrides, saveOverrides, formatOutcomes, decodeDigitsPng,
  type Capability,
} from "../src/model-autofix.ts";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

// ── 1. the probe image is real, and carries the ground truth ────────────────
const digits = randomDigits();
const png = renderDigitsPng(digits);
check("probe image is a valid PNG", png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
check("probe image is non-trivial", png.length > 200, `${png.length} bytes`);
check("probe digits are fresh per call", new Set(Array.from({ length: 20 }, () => randomDigits())).size > 10);
check("probe image is legible — the rendered digits decode back exactly", decodeDigitsPng(png) === digits, `${digits} -> ${decodeDigitsPng(png)}`);

// ── 2. required capabilities follow the dead pin's declared modalities ──────
check("text pin requires text+tools", requiredCapabilities({ input: ["text"] }).join() === "text,tools");
check("vision pin also requires vision", requiredCapabilities({ input: ["text", "image"] }).includes("vision"));

// ── 3. probe verdicts come from ground truth, not status codes ──────────────
const ENTRY = { id: "cand", api: "openai-completions", provider: "p", baseUrl: "https://x/v1", reasoning: true, input: ["text", "image"] };

/** A fake endpoint that answers with whatever `answer` says. */
function fakeFetch(answer: (body: any) => string, status = 200): typeof fetch {
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    return {
      ok: status === 200, status,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "", tool_calls: [{ function: { name: "report", arguments: JSON.stringify({ answer: answer(body) }) } }] } }],
      }),
    } as any;
  }) as any;
}
/**
 * A model that actually does the task: reads the digits out of the IMAGE when
 * one is attached (decoding the pixels, exactly as a sighted model would),
 * and echoes the nonce from the prompt otherwise. Never reads the nonce out of
 * the prompt on a vision probe — that is the shortcut the probe must not admit.
 */
function answerHonestly(body: any): string {
  const img = findImage(body);
  if (img) return decodeDigitsPng(Buffer.from(img, "base64"));
  return (JSON.stringify(body.messages).match(/\b(\d{5})\b/) ?? ["", "no-nonce"])[1];
}
function findImage(body: any): string | null {
  const m = JSON.stringify(body.messages).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  return m ? m[1] : null;
}
const honest = fakeFetch(answerHonestly);
/** 200, well-formed tool call, wrong answer. The deepseek-v4-pro shape. */
const confabulating = fakeFetch(() => "3");

for (const cap of ["text", "tools", "vision"] as Capability[]) {
  const good = await probeCapability(ENTRY, cap, "k", 5000, honest);
  check(`probe passes a model that returns the ground truth (${cap})`, good.ok, good.detail);
  const bad = await probeCapability(ENTRY, cap, "k", 5000, confabulating);
  check(`probe REJECTS a confident wrong answer at HTTP 200 (${cap})`, !bad.ok, bad.detail);
}
const http500 = await probeCapability(ENTRY, "text", "k", 5000, fakeFetch(() => "x", 500));
check("probe rejects a non-200", !http500.ok, http500.detail);

const noTool = await probeCapability(ENTRY, "tools", "k", 5000, (async () => ({
  ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "12345" } }] }),
})) as any);
check("tools probe rejects a text-only reply even when it contains the nonce", !noTool.ok, noTool.detail);

// ── 4. end-to-end: the real 2026-09-15 rename, with a blind decoy ranked first
const STORE = join(mkdtempSync(join(tmpdir(), "autofix-")), "overrides.json");
const DEAD = {
  kind: "dead" as const, provider: "deepseek" as const,
  pinned: "deepseek-v4-flash-vision-exp", usedBy: ["illustrator", "typesetter"],
};
const DEAD_ENTRY = { id: "deepseek-v4-flash-vision-exp", api: "openai-completions", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", reasoning: true, input: ["text", "image"] };

/** Blind on images, fine on text — exactly deepseek-v4-pro. */
const providerFetch: typeof fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init.body);
  const img = findImage(body);
  const blind = body.model === "deepseek-v4-pro";
  // Blind model on an image: a confident guess, not an error. HTTP 200 either way.
  const answer = img
    ? (blind ? "3" : decodeDigitsPng(Buffer.from(img, "base64")))
    : (JSON.stringify(body.messages).match(/\b(\d{5})\b/) ?? ["", ""])[1];
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: "", tool_calls: [{ function: { name: "report", arguments: JSON.stringify({ answer }) } }] } }],
    }),
  } as any;
}) as any;

const deps = {
  listModels: async () => ["deepseek-flash", "deepseek-v4-pro"],
  getApiKey: async () => "k",
  lookupEntry: (id: string) => (id === DEAD_ENTRY.id ? DEAD_ENTRY : null),
  // Proposer ranks the blind text model FIRST: name similarity is a bad guide,
  // and the probes — not the ranking — must be what protects the run.
  complete: async () => JSON.stringify([
    { id: "deepseek-v4-pro", why: "closest surviving v4 id" },
    { id: "deepseek-flash", why: "flash tier absorbed the vision variant" },
  ]),
  fetchImpl: providerFetch,
  log: () => {},
  overridesPath: STORE,
};
const outcomes = await autofixDeadPins([DEAD], deps as any);
check("autofix adopted a replacement", !!outcomes[0]?.adopted, outcomes[0]?.failure ?? "");
check("autofix skipped the blind top-ranked candidate", outcomes[0]?.adopted?.to === "deepseek-flash", String(outcomes[0]?.adopted?.to));
check("the blind candidate was tried and rejected on vision",
  outcomes[0]?.attempts.some((a) => a.id === "deepseek-v4-pro" && a.results.some((r) => r.capability === "vision" && !r.ok)));
check("adoption records what it proved",
  (outcomes[0]?.adopted?.verified ?? []).join() === "text,tools,vision");
check("adoption is persisted to the override store",
  loadOverrides(STORE)["deepseek-v4-flash-vision-exp"]?.to === "deepseek-flash");

// ── 5. refusals stay refusals ────────────────────────────────────────────────
const hallucinating = { ...deps, complete: async () => JSON.stringify([{ id: "deepseek-v9-imaginary", why: "made up" }]) };
const o2 = await autofixDeadPins([DEAD], hallucinating as any);
check("a candidate absent from the live catalog is never probed", !o2[0]?.adopted && o2[0]?.attempts.length === 0, o2[0]?.failure ?? "");

const allBlind = { ...deps, complete: async () => JSON.stringify([{ id: "deepseek-v4-pro", why: "x" }]) };
const o3 = await autofixDeadPins([DEAD], allBlind as any);
check("nothing is adopted when no candidate proves the capability", !o3[0]?.adopted, String(o3[0]?.adopted?.to));
check("the unfixed report names the missing capability", /vision/.test(formatOutcomes(o3)), formatOutcomes(o3));

const tupleForm = { ...deps, lookupEntry: () => null };
const o4 = await autofixDeadPins([DEAD], tupleForm as any);
check("a pi-ai catalog pin is reported, not overridden", !o4[0]?.adopted && /not an inline pin/.test(o4[0]?.failure ?? ""));

const noCatalog = { ...deps, listModels: async () => null };
const o5 = await autofixDeadPins([DEAD], noCatalog as any);
check("an unreachable catalog adopts nothing", !o5[0]?.adopted && /unreachable/.test(o5[0]?.failure ?? ""));

// ── 6. the store tolerates damage instead of blocking every run ─────────────
const BAD = join(mkdtempSync(join(tmpdir(), "autofix-bad-")), "overrides.json");
saveOverrides({ good: { from: "good", to: "live-id", provider: "p", at: "", verified: [], reason: "", usedBy: [] } } as any, BAD);
const reread = loadOverrides(BAD);
check("a written override round-trips", reread.good?.to === "live-id");
check("override file is owner-only", (statSync(BAD).mode & 0o077) === 0, (statSync(BAD).mode & 0o777).toString(8));
check("a missing override file is empty, not fatal", Object.keys(loadOverrides("/nonexistent/x.json")).length === 0);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — renames adopt only on proof; a confident wrong answer is rejected.");
