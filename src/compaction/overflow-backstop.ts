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
 */
import type { Model } from "@earendil-works/pi-ai/compat";
import { getContextWindow } from "./create-transform.js";

/** Conservative chars-per-token for mixed prose/JSON/CJK. */
const CHARS_PER_TOKEN = 2.6;
/** Use at most this fraction of the model window for messages. */
const BACKSTOP_WINDOW_FRACTION = 0.75;
/** A single retained message may keep at most this many chars. */
const BACKSTOP_MAX_MSG_CHARS = 50_000;

function msgChars(m: any): number {
  try { return JSON.stringify(m?.content ?? "").length; } catch { return 0; }
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

export function overflowBackstop(messages: any[], model?: Model<any>): any[] {
  const windowTokens = (model ? getContextWindow(model) : undefined) ?? 200_000;
  // The provider reserves the model's max completion tokens INSIDE the window
  // (live 400: "requested 1,092,147 tokens (698,931 in the messages, 393,216
  // in the completion)" — messages + completion must fit together). Budget
  // only what remains after that reservation.
  const completionReserve = (model as any)?.maxTokens ?? Math.floor(windowTokens * 0.25);
  const budgetChars = Math.floor(
    Math.max(32_000, windowTokens - completionReserve) * BACKSTOP_WINDOW_FRACTION * CHARS_PER_TOKEN,
  );
  let total = messages.reduce((s, m) => s + msgChars(m), 0);
  if (total <= budgetChars) return messages;

  // Pass 1: cap every oversized tool-result/user message (largest first).
  const out = [...messages];
  const order = out.map((m, i) => ({ i, c: msgChars(m), role: m?.role }))
    .filter((x) => x.c > BACKSTOP_MAX_MSG_CHARS && x.role !== "assistant")
    .sort((a, b) => b.c - a.c);
  for (const { i } of order) {
    const before = msgChars(out[i]);
    out[i] = truncateContent(out[i], BACKSTOP_MAX_MSG_CHARS);
    total -= before - msgChars(out[i]);
    if (total <= budgetChars) break;
  }
  if (total <= budgetChars) return out;

  // Pass 2: still over — shrink the cap oldest-first until it fits or hits
  // the floor. Assistant messages are spared (they carry the reasoning
  // thread); the summary produced by past condensations is message 0-ish and
  // typically small anyway.
  let cap = BACKSTOP_MAX_MSG_CHARS;
  while (total > budgetChars && cap > 4_000) {
    cap = Math.floor(cap / 2);
    for (let i = 0; i < out.length && total > budgetChars; i++) {
      if (out[i]?.role === "assistant") continue;
      const before = msgChars(out[i]);
      if (before <= cap) continue;
      out[i] = truncateContent(out[i], cap);
      total -= before - msgChars(out[i]);
    }
  }
  if (total <= budgetChars) return out;

  // Pass 3: last resort — strip thinking blocks from historical assistant
  // messages. The 297nm checkpoint showed the real mass: 70-82K-char thinking
  // blocks that passes 1-2 deliberately spare. Historical thinking is a
  // per-call VIEW (the stored session is untouched) and no provider requires
  // replayed thinking on old turns; the last two assistant messages keep
  // theirs (Anthropic signature rules for the in-flight tool-use turn).
  const assistantIdx = out
    .map((m, i) => (m?.role === "assistant" ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(assistantIdx.slice(-2));
  for (const i of assistantIdx) {
    if (total <= budgetChars) break;
    if (keep.has(i)) continue;
    const msg = out[i];
    if (!Array.isArray(msg?.content)) continue;
    const before = msgChars(msg);
    const content = msg.content.filter(
      (b: any) => !(b && typeof b === "object" && typeof b.thinking === "string"),
    );
    if (content.length === msg.content.length) continue;
    out[i] = { ...msg, content: content.length > 0 ? content : [{ type: "text", text: "[thinking removed by overflow backstop]" }] };
    total -= before - msgChars(out[i]);
  }
  return out;
}

