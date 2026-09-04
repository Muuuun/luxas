/**
 * model-check — is every model Luxas pins still alive, and has the provider
 * shipped a newer one in the same family?
 *
 * Why this exists (three failures this catches, all of which already happened):
 *   1. Kimi K2.5 started returning 404 mid-run on 2026-08-31. Every figure
 *      agent died on turn 1 for the rest of the run while the reviewer kept
 *      spawning audits nobody could act on.
 *   2. The GLM account ran dry. `glm-5.2` is the unconditional route for
 *      tool_review, so every experiment's blind tests would have failed — and
 *      the existing preflight would not have noticed, because it checks that a
 *      key EXISTS, not that it works.
 *   3. The Anthropic pins sat on the 4.6 generation from 2026-03-31 until
 *      2026-09-04. Sonnet 5 was a third cheaper the whole time.
 *
 * Deliberately NOT an orphan scanner (CLAIM: CLAUDE.md's producer-consumer
 * rule). Two real consumers ship in the same change:
 *   - `luxas models` prints the report on demand.
 *   - `preflightModels()` runs on `luxas run`, before any spend, and REFUSES
 *     to start when a model the run will actually use is gone.
 */

export type ProviderId = "anthropic" | "deepseek" | "glm" | "kimi-coding";

/** Where each provider lists its models, and how the response is shaped. */
const CATALOG_ENDPOINT: Record<ProviderId, { url: string; auth: (k: string) => Record<string, string> }> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=100",
    auth: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/models",
    auth: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  glm: {
    url: "https://open.bigmodel.cn/api/paas/v4/models",
    auth: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  "kimi-coding": {
    url: "https://api.moonshot.cn/v1/models",
    auth: (k) => ({ Authorization: `Bearer ${k}` }),
  },
};

/**
 * Split an id into a family and a numeric version.
 *
 * The family is the id with its version numbers removed, so tier words survive
 * and keep separate lineages: `deepseek-v4-pro` and `deepseek-v4-flash` are
 * different families, as are `glm-5.3` and `glm-5.3-flash`. Date-like runs of
 * 6+ digits are dropped — a dated snapshot (`claude-haiku-4-5-20251001`) must
 * not read as a higher version than its base id.
 */
export function parseModelId(id: string): { family: string; version: number[] } {
  const parts = id.split(/[-.]/);
  const version: number[] = [];
  const familyParts: string[] = [];
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      if (p.length >= 6) continue;          // 20251001 — a date, not a version
      version.push(Number(p));
    } else {
      // strip an embedded version digit (k2 → k, v4 → v) so tier words survive
      familyParts.push(p.replace(/\d+$/, ""));
      const embedded = p.match(/(\d+)$/);
      if (embedded) version.push(Number(embedded[1]));
    }
  }
  return { family: familyParts.filter(Boolean).join("-"), version };
}

/** Is `a` a strictly higher version than `b`? Shorter-but-larger wins (5 > 4.6). */
export function isNewer(a: number[], b: number[]): boolean {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return false;
}

export type Finding =
  | { kind: "dead"; provider: ProviderId; pinned: string; usedBy: string[] }
  | { kind: "newer"; provider: ProviderId; pinned: string; candidate: string; usedBy: string[] }
  | { kind: "unreachable"; provider: ProviderId; detail: string };

/**
 * Compare the ids Luxas pins against a provider's live catalog.
 * Pure: the caller supplies `listed`, so this is gate-testable without network.
 */
export function compareCatalog(
  provider: ProviderId,
  pinned: { id: string; usedBy: string[] }[],
  listed: string[],
): Finding[] {
  const out: Finding[] = [];
  const listedSet = new Set(listed);
  for (const p of pinned) {
    if (!listedSet.has(p.id)) {
      out.push({ kind: "dead", provider, pinned: p.id, usedBy: p.usedBy });
      continue;
    }
    const mine = parseModelId(p.id);
    // Best candidate in the same family that outranks the pin.
    let best: { id: string; version: number[] } | null = null;
    for (const cand of listed) {
      if (cand === p.id) continue;
      const c = parseModelId(cand);
      if (c.family !== mine.family) continue;
      if (!isNewer(c.version, mine.version)) continue;
      if (!best || isNewer(c.version, best.version)) best = { id: cand, version: c.version };
    }
    if (best) out.push({ kind: "newer", provider, pinned: p.id, candidate: best.id, usedBy: p.usedBy });
  }
  return out;
}

/** Fetch a provider's catalog. Returns null when the provider cannot be reached. */
export async function listModels(
  provider: ProviderId,
  key: string,
  timeoutMs = 15000,
): Promise<string[] | null> {
  const spec = CATALOG_ENDPOINT[provider];
  if (!spec) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(spec.url, { headers: spec.auth(key), signal: ctl.signal });
    if (!res.ok) return null;
    const body: any = await res.json();
    const rows: any[] = body?.data ?? body?.models ?? [];
    return rows.map((r) => String(r?.id ?? "")).filter(Boolean);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function formatFindings(findings: Finding[]): string {
  if (!findings.length) return "✓ every pinned model is listed by its provider, and none has a newer sibling.";
  const lines: string[] = [];
  for (const f of findings) {
    if (f.kind === "dead") {
      lines.push(`✗ DEAD      ${f.pinned} — ${f.provider} no longer lists it. Used by: ${f.usedBy.join(", ")}`);
    } else if (f.kind === "newer") {
      lines.push(`→ NEWER     ${f.pinned} → ${f.candidate} (${f.provider}). Used by: ${f.usedBy.join(", ")}`);
    } else {
      lines.push(`? UNREACHED ${f.provider} — ${f.detail} (not a failure; skipped)`);
    }
  }
  return lines.join("\n");
}
