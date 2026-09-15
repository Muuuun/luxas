/**
 * model-autofix — when a provider renames a model out from under a pin, find
 * its successor, PROVE the successor can do the job, and route to it.
 *
 * Why this exists
 * ───────────────
 * `model-check.ts` catches a dead pin and `luxas run` refuses to start. That is
 * correct (failing at launch beats failing eight hours in) but it needs a human
 * to edit `src/agents/spawn.ts` before any research can run. On 2026-09-12 a
 * launch hit exactly that and sat dead for three days: DeepSeek had folded
 * `deepseek-v4-flash-vision-exp` into `deepseek-flash`, and every `--profile
 * dual` run refused because the vision half of the profile no longer existed.
 * The model was renamed, not withdrawn — the capability was there the whole
 * time.
 *
 * The hard part is not the rename. It is not adopting a WRONG successor.
 *
 * Two facts from the 2026-09-15 probe make that concrete:
 *
 *   1. Name matching cannot find this successor. `model-check.ts`'s own
 *      `parseModelId` puts `deepseek-v4-flash-vision-exp` in family
 *      "deepseek-v-flash-vision-exp" and `deepseek-flash` in family
 *      "deepseek-flash". They do not match, and no amount of string surgery
 *      makes them match without also matching things that are not successors.
 *      So a model proposes the candidates — that is the "agent" here.
 *
 *   2. A successful call is NOT evidence of capability. Handed a PNG of the
 *      digits "74629" and asked to read them, `deepseek-v4-pro` returned
 *      HTTP 200 with a well-formed `tool_call` whose argument said the image
 *      was "not available". It is stone blind. Had autofix trusted the status
 *      code it would have silently routed every illustrator, illustrator_write
 *      and typesetter spawn to a model that cannot see a figure — strictly
 *      worse than today's hard refusal, because the run would look healthy
 *      while producing visually unverified figures. That is the Ba-run failure
 *      (notes/figure-pipeline-review-2026-09-02.md §3.6) with the alarm
 *      disconnected.
 *
 * So: propose with a model, adopt only on GROUND TRUTH. Every probe checks an
 * answer the candidate can only produce by actually doing the thing — digits
 * it must read off a freshly generated image, a nonce it must echo through a
 * tool call. The image is rendered here, in-process, with random digits per
 * probe, so there is nothing to memorize and no Python/matplotlib dependency.
 *
 * Producer–consumer (CLAUDE.md): this ships with its readers in the same diff.
 *   - `resolveModel` (src/agents/spawn.ts) applies adopted overrides, so a run
 *     actually reaches the new id.
 *   - `luxas run` preflight (src/index.ts) calls `autofixDeadPins` before it
 *     refuses, and only refuses on what autofix could not fix.
 *   - `luxas models` prints active overrides; `luxas models --fix` runs it by
 *     hand.
 *   - gate: scripts/smoke_model_autofix.mts
 *
 * Scope limit, deliberate: overrides apply to INLINE model entries (the custom
 * pins in MODEL_MAP, which are the ones that go stale). Tuple-form entries are
 * resolved from pi-ai's own catalog; a dead id there means the package needs
 * updating, and autofix reports it rather than rewriting a foreign catalog.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { Finding, ProviderId } from "./model-check.js";

export const OVERRIDES_PATH = join(homedir(), ".sisyphus", "model-overrides.json");

/** One adopted rename. Written only after every required probe passed. */
export interface ModelOverride {
  /** The dead id, as pinned in MODEL_MAP. */
  from: string;
  /** The live id that replaced it. */
  to: string;
  provider: string;
  /** ISO timestamp of adoption. */
  at: string;
  /** Capabilities proved against ground truth before adopting. */
  verified: Capability[];
  /** Why the proposer picked it, plus probe detail — for the audit trail. */
  reason: string;
  /** Agents that were routed to `from` when it went dead. */
  usedBy: string[];
}

export type Capability = "text" | "tools" | "vision";

// ── override store ───────────────────────────────────────────────────────────

export function loadOverrides(path = OVERRIDES_PATH): Record<string, ModelOverride> {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!raw || typeof raw !== "object") return {};
    // Tolerate hand-edits: drop anything that is not a well-formed override
    // rather than throwing, or one bad line would block every run.
    const out: Record<string, ModelOverride> = {};
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
      if (v && typeof v.to === "string" && v.to && typeof k === "string") {
        out[k] = { from: k, to: v.to, provider: String(v.provider ?? ""), at: String(v.at ?? ""),
                   verified: Array.isArray(v.verified) ? v.verified : [],
                   reason: String(v.reason ?? ""), usedBy: Array.isArray(v.usedBy) ? v.usedBy : [] };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Atomic write — a torn overrides file would break every subsequent run. */
export function saveOverrides(all: Record<string, ModelOverride>, path = OVERRIDES_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export function recordOverride(o: ModelOverride, path = OVERRIDES_PATH): void {
  const all = loadOverrides(path);
  all[o.from] = o;
  saveOverrides(all, path);
}

// ── ground-truth probe image ─────────────────────────────────────────────────

/** 5x7 bitmaps, one row per scanline, MSB = leftmost pixel of 5. */
const FONT_5X7: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Render `digits` as a black-on-white PNG, large and monospaced.
 *
 * Deliberately dependency-free: the gate must run offline with no matplotlib,
 * and the probe must be able to mint a FRESH image per call so a candidate
 * cannot pass by having memorized a fixture.
 */
export function renderDigitsPng(digits: string, scale = 14): Buffer {
  const pad = 4 * scale, gap = 2 * scale;
  const glyphW = 5 * scale, glyphH = 7 * scale;
  const w = pad * 2 + digits.length * glyphW + (digits.length - 1) * gap;
  const h = pad * 2 + glyphH;

  // White RGB canvas.
  const px = Buffer.alloc(w * h * 3, 0xff);
  digits.split("").forEach((ch, i) => {
    const rows = FONT_5X7[ch];
    if (!rows) return;
    const x0 = pad + i * (glyphW + gap);
    for (let ry = 0; ry < 7; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (!((rows[ry] >> (4 - rx)) & 1)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = x0 + rx * scale + dx, y = pad + ry * scale + dy;
            px.fill(0x00, (y * w + x) * 3, (y * w + x) * 3 + 3);
          }
        }
      }
    }
  });

  // Scanlines, each prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    px.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Read the digits back out of a PNG produced by `renderDigitsPng`.
 *
 * This is the honest test double for "a model that can actually see": the gate
 * uses it to answer the vision probe the way a sighted model would, from the
 * pixels rather than from the prompt. It therefore also asserts the real
 * property the probe depends on — that the rendered glyphs are legible and
 * say what the caller asked for. A silently blank or garbled probe image would
 * fail every candidate, including good ones, and quietly disable autofix.
 *
 * Only handles what renderDigitsPng emits: RGB8, no interlace, filter 0.
 */
export function decodeDigitsPng(png: Buffer, scale = 14): string {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let w = 0, h = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + w * 3;
  const dark = (x: number, y: number) => raw[y * stride + 1 + x * 3] < 128;

  const pad = 4 * scale, gap = 2 * scale, glyphW = 5 * scale, glyphH = 7 * scale;
  const n = Math.round((w - 2 * pad + gap) / (glyphW + gap));
  let out = "";
  for (let i = 0; i < n; i++) {
    const x0 = pad + i * (glyphW + gap);
    const rows: number[] = [];
    for (let ry = 0; ry < 7; ry++) {
      let bits = 0;
      for (let rx = 0; rx < 5; rx++) {
        // Sample each cell's centre.
        const x = x0 + rx * scale + (scale >> 1);
        const y = pad + ry * scale + (scale >> 1);
        if (x < w && y < h && dark(x, y)) bits |= 1 << (4 - rx);
      }
      rows.push(bits);
    }
    const hit = Object.entries(FONT_5X7).find(([, pat]) => pat.every((v, k) => v === rows[k]));
    out += hit ? hit[0] : "?";
  }
  return out;
}

/** A fresh 5-digit nonce, never starting with 0 (so the string round-trips). */
export function randomDigits(n = 5): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < n) s += String(Math.floor(Math.random() * 10));
  return s;
}

// ── capability probes ────────────────────────────────────────────────────────

export interface ProbeResult {
  capability: Capability;
  ok: boolean;
  detail: string;
}

/** What a replacement must prove, derived from what the dead pin declared. */
export function requiredCapabilities(entry: any): Capability[] {
  const caps: Capability[] = ["text", "tools"];
  if (Array.isArray(entry?.input) && entry.input.includes("image")) caps.push("vision");
  return caps;
}

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Build the probe request in the model's own wire format.
 *
 * `tool_choice` stays "auto" on reasoning models on purpose: DeepSeek returns
 * 400 "Thinking mode does not support this tool_choice" for "required", and
 * pickRequireToolChoice already sends "auto" for them in production. Probing a
 * shape production never uses would test the wrong thing.
 */
function buildProbe(entry: any, cap: Capability, key: string, nonce: string, png?: Buffer): WireRequest {
  const anthropic = entry.api === "anthropic" || entry.provider === "anthropic";
  const tool = {
    name: "report",
    description: "Report the answer.",
    parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  };
  const ask =
    cap === "vision"
      ? "Read the digits printed in this image. Call report with exactly those digits and nothing else."
      : cap === "tools"
        ? `Call report with answer set to exactly ${nonce}.`
        : `Reply with exactly ${nonce} and nothing else.`;

  if (anthropic) {
    const content: any[] = [{ type: "text", text: ask }];
    if (png) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    return {
      url: `${entry.baseUrl ?? "https://api.anthropic.com/v1"}/messages`.replace(/\/v1\/v1\//, "/v1/"),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: {
        model: entry.id, max_tokens: 4096,
        messages: [{ role: "user", content }],
        ...(cap === "text" ? {} : { tools: [{ name: tool.name, description: tool.description, input_schema: tool.parameters }] }),
      },
    };
  }

  const content: any[] = [{ type: "text", text: ask }];
  if (png) content.push({ type: "image_url", image_url: { url: "data:image/png;base64," + png.toString("base64") } });
  return {
    url: `${entry.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: {
      model: entry.id,
      max_tokens: 8192,
      messages: [{ role: "user", content: png ? content : ask }],
      ...(cap === "text" ? {} : { tools: [{ type: "function", function: tool }], tool_choice: "auto" }),
    },
  };
}

/** Everything the candidate said, flattened, so ground truth can be searched for. */
function harvestText(json: any): string {
  const parts: string[] = [];
  const msg = json?.choices?.[0]?.message;
  if (msg) {
    if (typeof msg.content === "string") parts.push(msg.content);
    for (const tc of msg.tool_calls ?? []) parts.push(String(tc?.function?.arguments ?? ""));
  }
  for (const block of json?.content ?? []) {
    if (block?.type === "text") parts.push(String(block.text ?? ""));
    if (block?.type === "tool_use") parts.push(JSON.stringify(block.input ?? {}));
  }
  return parts.join(" ");
}

function usedATool(json: any): boolean {
  if ((json?.choices?.[0]?.message?.tool_calls ?? []).length) return true;
  return (json?.content ?? []).some((b: any) => b?.type === "tool_use");
}

/**
 * Run one capability probe against a live endpoint.
 *
 * Pass/fail is decided ONLY by whether the ground-truth token comes back.
 * A 200 proves the id resolves; it does not prove the model can see.
 */
export async function probeCapability(
  entry: any,
  cap: Capability,
  key: string,
  timeoutMs = 120_000,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const nonce = randomDigits();
  const png = cap === "vision" ? renderDigitsPng(nonce) : undefined;
  const req = buildProbe(entry, cap, key, nonce, png);
  try {
    const res = await fetchImpl(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) return { capability: cap, ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    let json: any;
    try { json = JSON.parse(text); } catch { return { capability: cap, ok: false, detail: "unparseable response" }; }

    const said = harvestText(json);
    if (cap === "tools" && !usedATool(json)) {
      return { capability: cap, ok: false, detail: "returned no tool call" };
    }
    if (!said.includes(nonce)) {
      // The informative failure: the call worked, the answer did not.
      return {
        capability: cap,
        ok: false,
        detail: `did not return the ground truth ${nonce} — said ${JSON.stringify(said.trim().slice(0, 120))}`,
      };
    }
    return { capability: cap, ok: true, detail: `returned ${nonce}` };
  } catch (e: any) {
    return { capability: cap, ok: false, detail: `request failed: ${e?.message ?? e}` };
  }
}

/** Probe every required capability. Stops at the first failure (spend guard). */
export async function verifyCandidate(
  entry: any,
  caps: Capability[],
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; results: ProbeResult[] }> {
  const results: ProbeResult[] = [];
  for (const cap of caps) {
    const r = await probeCapability(entry, cap, key, 120_000, fetchImpl);
    results.push(r);
    if (!r.ok) return { ok: false, results };
  }
  return { ok: true, results };
}

// ── candidate proposal (the model-driven half) ───────────────────────────────

const PROPOSE_SYSTEM = `You match a retired AI model id to its replacement in the same provider's current catalog.

The retired id is GONE from the catalog. Providers retire ids by: bumping a version, dropping an "-exp"/"-preview" suffix on graduation, merging a specialised variant back into a base model, or renaming a tier.

Pick the candidates most likely to be the SAME MODEL LINEAGE at a similar capability tier. Prefer a model that plausibly absorbed the retired one's speciality. Never propose a cheaper/weaker tier just because the name is closer.

Reply with ONLY a JSON array, best first, at most 3 entries:
[{"id": "<exact id from the catalog>", "why": "<one short sentence>"}]
No prose, no code fence.`;

export interface Candidate { id: string; why: string; }

/**
 * Ask a model which live ids could be the successor.
 *
 * Constrained hard: the result is intersected with the real catalog, so a
 * hallucinated id cannot reach a probe, let alone production.
 */
export async function proposeSuccessors(
  dead: { id: string; entry: any; usedBy: string[] },
  catalog: string[],
  complete: (systemPrompt: string, user: string) => Promise<string>,
): Promise<Candidate[]> {
  const caps = requiredCapabilities(dead.entry);
  const user = [
    `Retired id: ${dead.id}`,
    `Provider: ${dead.entry?.provider ?? "unknown"}`,
    `It was used by these agents: ${dead.usedBy.join(", ") || "(unknown)"}`,
    `It had to support: ${caps.join(", ")}`,
    `Declared input modalities: ${(dead.entry?.input ?? ["text"]).join(", ")}`,
    ``,
    `Current catalog:`,
    ...catalog.map((c) => `  ${c}`),
  ].join("\n");

  let raw = "";
  try {
    raw = await complete(PROPOSE_SYSTEM, user);
  } catch (e: any) {
    return [];
  }
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  const live = new Set(catalog);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of parsed) {
    const id = String(c?.id ?? "");
    // Reject hallucinations and the corpse itself.
    if (!live.has(id) || id === dead.id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, why: String(c?.why ?? "").slice(0, 200) });
    if (out.length >= 3) break;
  }
  return out;
}

// ── orchestration ────────────────────────────────────────────────────────────

export interface AutofixOutcome {
  from: string;
  provider: string;
  usedBy: string[];
  adopted?: ModelOverride;
  /** Why nothing was adopted, when nothing was. */
  failure?: string;
  attempts: { id: string; why: string; results: ProbeResult[] }[];
}

export interface AutofixDeps {
  /** Live catalog for a provider, or null when unreachable. */
  listModels: (provider: ProviderId, key: string) => Promise<string[] | null>;
  getApiKey: (provider: string) => Promise<string | undefined>;
  /** Resolve a pinned key to its inline model entry (null for tuple/catalog form). */
  lookupEntry: (id: string) => any | null;
  /** Text completion used for candidate proposal. */
  complete: (systemPrompt: string, user: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** Override store location. Injected by the gate so tests never touch the real one. */
  overridesPath?: string;
}

/**
 * For each dead finding: propose successors, probe them in order, adopt the
 * first that proves every required capability.
 *
 * Adopting nothing is a normal outcome, not an error — the caller still
 * refuses the run. The contract is only that we never adopt something
 * unproven.
 */
export async function autofixDeadPins(
  findings: Finding[],
  deps: AutofixDeps,
): Promise<AutofixOutcome[]> {
  const log = deps.log ?? (() => {});
  const dead = findings.filter((f): f is Extract<Finding, { kind: "dead" }> => f.kind === "dead");
  const outcomes: AutofixOutcome[] = [];

  for (const d of dead) {
    const outcome: AutofixOutcome = { from: d.pinned, provider: d.provider, usedBy: d.usedBy, attempts: [] };
    outcomes.push(outcome);

    const entry = deps.lookupEntry(d.pinned);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      outcome.failure = "not an inline pin — resolved from pi-ai's catalog, so the package needs updating, not an override";
      continue;
    }
    const key = await deps.getApiKey(d.provider);
    if (!key) { outcome.failure = "no API key for this provider"; continue; }

    const catalog = await deps.listModels(d.provider, key);
    if (!catalog || !catalog.length) { outcome.failure = "provider catalog unreachable"; continue; }

    const caps = requiredCapabilities(entry);
    log(`  autofix: ${d.pinned} is gone; asking for a successor among ${catalog.length} live ${d.provider} model(s), must prove: ${caps.join(", ")}`);

    const candidates = await proposeSuccessors({ id: d.pinned, entry, usedBy: d.usedBy }, catalog, deps.complete);
    if (!candidates.length) { outcome.failure = "no candidate successor proposed from the live catalog"; continue; }

    for (const cand of candidates) {
      log(`  autofix: probing ${cand.id} — ${cand.why}`);
      // Probe the CANDIDATE's id against the dead entry's transport settings;
      // same provider, so baseUrl/auth carry over unchanged.
      const trial = { ...entry, id: cand.id };
      const { ok, results } = await verifyCandidate(trial, caps, key, deps.fetchImpl);
      outcome.attempts.push({ id: cand.id, why: cand.why, results });
      for (const r of results) {
        log(`    ${r.ok ? "✓" : "✗"} ${r.capability}: ${r.detail}`);
      }
      if (!ok) continue;

      const override: ModelOverride = {
        from: d.pinned,
        to: cand.id,
        provider: String(d.provider),
        at: new Date().toISOString(),
        verified: caps,
        reason: cand.why,
        usedBy: d.usedBy,
      };
      recordOverride(override, deps.overridesPath ?? OVERRIDES_PATH);
      outcome.adopted = override;
      log(`  autofix: adopted ${d.pinned} → ${cand.id} (proved ${caps.join(", ")}). Recorded in ${deps.overridesPath ?? OVERRIDES_PATH}.`);
      break;
    }
    if (!outcome.adopted && !outcome.failure) {
      outcome.failure = `no candidate proved ${caps.join(", ")}`;
    }
  }
  return outcomes;
}

export function formatOutcomes(outcomes: AutofixOutcome[]): string {
  const lines: string[] = [];
  for (const o of outcomes) {
    if (o.adopted) {
      lines.push(`✓ AUTOFIXED ${o.from} → ${o.adopted.to} (${o.provider}) — proved ${o.adopted.verified.join(", ")}. Used by: ${o.usedBy.join(", ")}`);
    } else {
      lines.push(`✗ UNFIXED   ${o.from} (${o.provider}) — ${o.failure}. Used by: ${o.usedBy.join(", ")}`);
      for (const a of o.attempts) {
        const bad = a.results.filter((r) => !r.ok).map((r) => `${r.capability}: ${r.detail}`);
        if (bad.length) lines.push(`              tried ${a.id} — ${bad.join("; ")}`);
      }
    }
  }
  return lines.join("\n");
}
