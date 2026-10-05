/**
 * Keep the brain's conversation history a cached prefix on Anthropic.
 *
 * The research snapshot is regenerated every turn and sent as the trailing
 * user message (context.ts injectSnapshot). pi-ai puts its one history
 * breakpoint on the LAST user block — the snapshot — so the prefix a turn
 * writes to the cache ends in a block the next turn does not contain. The
 * history between the tool definitions and the trailer was therefore written
 * every turn and never read back: the one Anthropic run in the corpus wrote
 * 30.3 M cache tokens and read 21.1 M, $133 of its $155.
 *
 * pi-ai 0.84 removed per-block cacheControl from its message types, so the
 * breakpoint cannot be expressed in the transcript. It can be expressed in the
 * outbound payload: onPayload may return a replacement. This adds one
 * breakpoint on the last block BEFORE the snapshot. What the model sees is
 * unchanged — only where the provider is told it may cut.
 *
 * Providers with automatic prefix caching (DeepSeek, OpenAI) already hit on
 * the history because the trailer is last; this is a no-op for them.
 *
 * Reader: agent.ts wires pinHistoryBreakpoint into the brain's onPayload.
 */

const SNAPSHOT_OPEN = "<research_snapshot>";
const MAX_BREAKPOINTS = 4; // Anthropic's limit per request
const MARKABLE = new Set(["text", "image", "tool_result", "tool_use", "document"]);

function blockText(b: any): string {
  return typeof b === "string" ? b : (b?.type === "text" && typeof b.text === "string" ? b.text : "");
}

function countBreakpoints(payload: any): number {
  let n = 0;
  const visit = (blocks: any) => { if (Array.isArray(blocks)) for (const b of blocks) if (b && typeof b === "object" && b.cache_control) n++; };
  visit(payload.system);
  visit(payload.tools);
  for (const m of payload.messages ?? []) visit(m?.content);
  return n;
}

/**
 * Returns a replacement payload with the extra breakpoint, or undefined to
 * leave the payload alone (not Anthropic-shaped, no snapshot trailer, caching
 * off, or nothing safe to mark).
 */
export function pinHistoryBreakpoint(payload: any): any | undefined {
  const messages: any[] | undefined = payload?.messages;
  if (!Array.isArray(messages) || messages.length < 2) return undefined;

  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (last?.role !== "user") return undefined;
  const lastBlocks: any[] = Array.isArray(last.content) ? last.content : [last.content];
  const snapAt = lastBlocks.findIndex((b) => blockText(b).startsWith(SNAPSHOT_OPEN));
  if (snapAt < 0) return undefined;

  // Reuse the marker pi-ai put on the trailer (same type / ttl). None = caching is off.
  const marker = lastBlocks.map((b) => b?.cache_control).find(Boolean);
  if (!marker) return undefined;

  // Where the stable history ends: the block before the snapshot when the
  // adapter merged it into the preceding user message, else the last markable
  // block of the previous message.
  let mi: number, bi: number;
  if (snapAt > 0) { mi = lastIdx; bi = snapAt - 1; }
  else {
    mi = lastIdx - 1;
    const prev = messages[mi];
    if (typeof prev?.content === "string") bi = 0;
    else if (Array.isArray(prev?.content)) {
      bi = prev.content.length - 1;
      // thinking / redacted_thinking blocks cannot carry cache_control
      while (bi >= 0 && !MARKABLE.has(prev.content[bi]?.type)) bi--;
    } else return undefined;
    if (bi < 0) return undefined;
  }

  // Copy only what is touched; never mutate the adapter's object.
  const out = { ...payload, messages: [...messages] };
  const target = { ...out.messages[mi] };
  const content: any[] = typeof target.content === "string"
    ? [{ type: "text", text: target.content }]
    : [...target.content];
  if (content[bi]?.cache_control) return undefined; // already a breakpoint
  content[bi] = { ...content[bi], cache_control: marker };
  target.content = content;
  out.messages[mi] = target;

  // An OAuth request already carries four (two system blocks, tools, trailer).
  // The first system block is a strict prefix of the second, so its marker is
  // the one that buys nothing.
  if (countBreakpoints(out) > MAX_BREAKPOINTS && Array.isArray(out.system) && out.system.length > 1 && out.system[0]?.cache_control) {
    const [first, ...rest] = out.system;
    const { cache_control: _dropped, ...bare } = first;
    out.system = [bare, ...rest];
  }
  if (countBreakpoints(out) > MAX_BREAKPOINTS) return undefined; // never send a request the API would reject
  return out;
}
