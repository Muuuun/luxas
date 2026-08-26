/**
 * Deterministic overflow backstop (2026-08-25, found live on the 297nm run).
 *
 * An over-window checkpoint cannot be rescued by the summarizer — the
 * summarization call ITSELF overflows — and a successful condense keeps a
 * recent tail with no per-message size bound. This backstop is arithmetic and
 * cannot fail. It wraps the compaction transform on BOTH sides: pre-pack so
 * the summarizer only ever sees a bounded history, post-pack so the final
 * request fits. The provider reserves the model's max completion tokens
 * inside the window (live 400: "requested 1,092,147 tokens (698,931 in the
 * messages, 393,216 in the completion)"), so the budget subtracts it.
 *
 * PINNING (2026-08-26, cache-debate verdict). The first version re-derived
 * its cut-set and cap from the TOTAL size every call — as history grew, the
 * bytes of already-truncated messages shifted every turn, invalidating the
 * provider prefix cache from the first changed byte. Live usage.log showed
 * the bill: ~144K miss tokens per turn with the hit stuck at 132K. Decisions
 * are now PINNED in a ledger owned by the transform closure: once a message
 * is cut at cap C (or its thinking stripped), that exact byte result is
 * frozen for the rest of the append-only regime; new pressure is absorbed
 * only by cutting messages not yet pinned. The ledger resets itself when the
 * array is rebuilt (condense or resume) — detected by a shrunk length or a
 * changed head fingerprint.
 */
import type { Model } from "@earendil-works/pi-ai/compat";
import { getContextWindow } from "./create-transform.js";

/** Conservative chars-per-token for mixed prose/JSON/CJK. */
const CHARS_PER_TOKEN = 2.6;
/** Use at most this fraction of the post-reserve window for messages. */
const BACKSTOP_WINDOW_FRACTION = 0.75;
/** A single retained message may keep at most this many chars. */
const BACKSTOP_MAX_MSG_CHARS = 50_000;
/** Pass-2 cap floor. */
const BACKSTOP_MIN_CAP = 4_000;

export interface BackstopLedger {
  /** message key → pinned truncation cap (chars). */
  caps: Map<string, number>;
  /** message keys whose thinking blocks are pinned-stripped. */
  strippedThinking: Set<string>;
  /** fingerprint: array length at last call (shrink ⇒ rebuilt ⇒ reset). */
  lastLength: number;
  /** fingerprint: key of messages[0] at last call. */
  firstKey: string;
}

export function createBackstopLedger(): BackstopLedger {
  return { caps: new Map(), strippedThinking: new Set(), lastLength: 0, firstKey: "" };
}

function msgChars(m: any): number {
  try { return JSON.stringify(m?.content ?? "").length; } catch { return 0; }
}

/**
 * Stable identity for a canonical message. Prefers the message's own id;
 * falls back to position + role + original content size, which is stable in
 * the append-only regime the ledger's reset rule guarantees.
 */
function keyOf(m: any, i: number): string {
  if (typeof m?.id === "string" && m.id) return m.id;
  return `${i}:${m?.role ?? "?"}:${msgChars(m)}`;
}

function truncateContent(m: any, keep: number): any {
  const cut = (t: string) => t.length <= keep ? t :
    t.slice(0, Math.floor(keep * 0.6)) +
    `\n…[overflow backstop: ${t.length - keep} chars truncated — the full content lives on disk; re-read the file if needed]…\n` +
    t.slice(t.length - Math.floor(keep * 0.4));
  const c = m?.content;
  if (typeof c === "string") return { ...m, content: cut(c) };
  if (Array.isArray(c)) {
    return { ...m, content: c.map((b: any) =>
      b && typeof b === "object" && typeof b.text === "string" ? { ...b, text: cut(b.text) } : b) };
  }
  return m;
}

function stripThinking(m: any): any {
  if (!Array.isArray(m?.content)) return m;
  const content = m.content.filter(
    (b: any) => !(b && typeof b === "object" && typeof b.thinking === "string"),
  );
  if (content.length === m.content.length) return m;
  return {
    ...m,
    content: content.length > 0
      ? content
      : [{ type: "text", text: "[thinking removed by overflow backstop]" }],
  };
}

export interface BackstopResult {
  messages: any[];
  /** true when anything was truncated/stripped this call (pinned or new). */
  active: boolean;
}

export function applyOverflowBackstop(
  messages: any[],
  model: Model<any> | undefined,
  ledger: BackstopLedger,
): BackstopResult {
  const windowTokens = (model ? getContextWindow(model) : undefined) ?? 200_000;
  const completionReserve = (model as any)?.maxTokens ?? Math.floor(windowTokens * 0.25);
  const budgetChars = Math.floor(
    Math.max(32_000, windowTokens - completionReserve) * BACKSTOP_WINDOW_FRACTION * CHARS_PER_TOKEN,
  );

  // Ledger reset on array rebuild (condense/resume): position-based keys are
  // only meaningful while the array is append-only.
  if (
    messages.length < ledger.lastLength ||
    (ledger.firstKey && messages.length > 0 && keyOf(messages[0], 0) !== ledger.firstKey)
  ) {
    ledger.caps.clear();
    ledger.strippedThinking.clear();
  }
  ledger.lastLength = messages.length;
  ledger.firstKey = messages.length > 0 ? keyOf(messages[0], 0) : "";

  // Phase 0: apply every pinned decision — byte-identical replay.
  const out = [...messages];
  const keys = out.map((m, i) => keyOf(m, i));
  let active = false;
  for (let i = 0; i < out.length; i++) {
    const cap = ledger.caps.get(keys[i]);
    if (cap !== undefined) {
      const t = truncateContent(out[i], cap);
      if (t !== out[i]) { out[i] = t; active = true; }
    }
    if (ledger.strippedThinking.has(keys[i])) {
      const s = stripThinking(out[i]);
      if (s !== out[i]) { out[i] = s; active = true; }
    }
  }
  let total = out.reduce((s, m) => s + msgChars(m), 0);
  if (total <= budgetChars) return { messages: out, active };

  const pin = (i: number, cap: number) => {
    const before = msgChars(out[i]);
    out[i] = truncateContent(out[i], cap);
    ledger.caps.set(keys[i], cap);
    total -= before - msgChars(out[i]);
    active = true;
  };

  // Pass 1: cap oversized unpinned tool-result/user messages (largest first).
  const order = out.map((m, i) => ({ i, c: msgChars(m), role: m?.role }))
    .filter((x) => x.c > BACKSTOP_MAX_MSG_CHARS && x.role !== "assistant" && !ledger.caps.has(keys[x.i]))
    .sort((a, b) => b.c - a.c);
  for (const { i } of order) {
    pin(i, BACKSTOP_MAX_MSG_CHARS);
    if (total <= budgetChars) return { messages: out, active };
  }

  // Pass 2: still over — cut UNPINNED non-assistant messages oldest-first at
  // progressively smaller caps. Pinned messages keep their original cap
  // forever (that is the point); growth pressure lands on fresh messages.
  let cap = BACKSTOP_MAX_MSG_CHARS;
  while (total > budgetChars && cap > BACKSTOP_MIN_CAP) {
    cap = Math.floor(cap / 2);
    for (let i = 0; i < out.length && total > budgetChars; i++) {
      if (out[i]?.role === "assistant") continue;
      if (ledger.caps.has(keys[i])) continue;
      if (msgChars(out[i]) <= cap) continue;
      pin(i, cap);
    }
  }
  if (total <= budgetChars) return { messages: out, active };

  // Pass 3: last resort — strip thinking blocks from historical assistant
  // messages (the 297nm mass: 70-82K-char thinking blocks), oldest first,
  // sparing the last two assistant messages at pin time (Anthropic signature
  // rules for the in-flight tool-use turn). A pinned strip stays stripped:
  // a message can only get older.
  const assistantIdx = out
    .map((m, i) => (m?.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(assistantIdx.slice(-2));
  for (const i of assistantIdx) {
    if (total <= budgetChars) break;
    if (keep.has(i) || ledger.strippedThinking.has(keys[i])) continue;
    const before = msgChars(out[i]);
    const s = stripThinking(out[i]);
    if (s === out[i]) continue;
    out[i] = s;
    ledger.strippedThinking.add(keys[i]);
    total -= before - msgChars(out[i]);
    active = true;
  }
  if (total <= budgetChars) return { messages: out, active };

  // Pass 4: safety valve. Pins are normally permanent (that is the cache
  // guarantee), but when every message is already pinned and the budget is
  // STILL unreachable, correctness beats cache stability: re-cut pinned
  // non-assistant messages at progressively smaller caps, UPDATING their
  // pins — a one-time byte change per escalation, after which the new pins
  // are stable again. Without this the hard guarantee "overflow is
  // arithmetically impossible" would not survive pinning (N×50K pins can
  // exceed the budget on their own).
  cap = BACKSTOP_MAX_MSG_CHARS;
  while (total > budgetChars && cap > 1_000) {
    cap = Math.floor(cap / 2);
    for (let i = 0; i < out.length && total > budgetChars; i++) {
      if (out[i]?.role === "assistant") continue;
      if (msgChars(out[i]) <= cap) continue;
      pin(i, cap);
    }
  }
  return { messages: out, active };
}

/** Stateless wrapper — one-shot bound with a throwaway ledger. */
export function overflowBackstop(messages: any[], model?: Model<any>): any[] {
  return applyOverflowBackstop(messages, model, createBackstopLedger()).messages;
}
