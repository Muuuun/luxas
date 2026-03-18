/**
 * OpenAlex API client for paper search, citations, and references.
 *
 * Free API, no key required. 10,000 req/day with polite pool (mailto param).
 * Docs: https://docs.openalex.org/
 */

import { sleep } from "../utils.js";

const BASE_URL = "https://api.openalex.org";
const MAILTO = "mailto=sisyphus-agent@example.com";
const MIN_INTERVAL = 200; // 200ms between requests (well under 10/s limit)

let lastRequest = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastRequest);
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

export interface Paper {
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  citation_count: number;
  arxiv_id: string | null;
  doi: string | null;
  abstract: string;
  source?: string;
}

export class OpenAlexClient {
  /**
   * Search papers by query string.
   */
  async search(
    query: string,
    limit = 20,
    yearRange?: string,
  ): Promise<Paper[]> {
    const params = new URLSearchParams({
      search: query,
      per_page: String(Math.min(limit, 100)),
      [MAILTO.split("=")[0]]: MAILTO.split("=")[1],
    });
    if (yearRange) {
      // yearRange format: "2020-2025" or "2020-" or "-2025"
      params.set("filter", `publication_year:${yearRange}`);
    }

    try {
      await rateLimit();
      const resp = await fetch(`${BASE_URL}/works?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        console.warn(`[openalex] Search failed: ${resp.status} ${resp.statusText}`);
        return [];
      }
      const data = (await resp.json()) as any;
      return (data.results ?? []).map(normalizeWork);
    } catch (err: any) {
      console.warn(`[openalex] Search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Get papers that cite this paper (forward citations).
   * @param paperId OpenAlex work ID (e.g. "W2057883617") or DOI
   */
  async getCitations(paperId: string, limit = 50): Promise<Paper[]> {
    const oaId = await this.resolveId(paperId);
    if (!oaId) return [];

    const params = new URLSearchParams({
      filter: `cites:${oaId}`,
      per_page: String(Math.min(limit, 200)),
      sort: "cited_by_count:desc",
      [MAILTO.split("=")[0]]: MAILTO.split("=")[1],
    });

    try {
      await rateLimit();
      const resp = await fetch(`${BASE_URL}/works?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        console.warn(`[openalex] Citations failed for ${paperId}: ${resp.status}`);
        return [];
      }
      const data = (await resp.json()) as any;
      return (data.results ?? []).map(normalizeWork);
    } catch (err: any) {
      console.warn(`[openalex] Citations error for ${paperId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Get papers this paper cites (backward references).
   * @param paperId OpenAlex work ID (e.g. "W2057883617") or DOI
   */
  async getReferences(paperId: string, limit = 50): Promise<Paper[]> {
    const oaId = await this.resolveId(paperId);
    if (!oaId) return [];

    const params = new URLSearchParams({
      filter: `cited_by:${oaId}`,
      per_page: String(Math.min(limit, 200)),
      sort: "cited_by_count:desc",
      [MAILTO.split("=")[0]]: MAILTO.split("=")[1],
    });

    try {
      await rateLimit();
      const resp = await fetch(`${BASE_URL}/works?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        console.warn(`[openalex] References failed for ${paperId}: ${resp.status}`);
        return [];
      }
      const data = (await resp.json()) as any;
      return (data.results ?? []).map(normalizeWork);
    } catch (err: any) {
      console.warn(`[openalex] References error for ${paperId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Resolve various ID formats to an OpenAlex short ID (e.g. "W2057883617").
   * Accepts: OpenAlex ID, DOI, arXiv ID, S2 paper ID.
   */
  private async resolveId(id: string): Promise<string | null> {
    // Already an OpenAlex ID
    if (id.startsWith("W") && /^W\d+$/.test(id)) return id;
    if (id.startsWith("https://openalex.org/W")) return id.replace("https://openalex.org/", "");

    // DOI
    if (id.startsWith("10.") || id.startsWith("https://doi.org/")) {
      const doi = id.replace("https://doi.org/", "");
      return this.lookupOaId(`doi:${doi}`);
    }

    // arXiv ID (e.g. "2301.07041" or "arxiv:2301.07041")
    const arxivMatch = id.match(/(?:arxiv:)?(\d{4}\.\d{4,5})/i);
    if (arxivMatch) {
      // arXiv papers have DOI 10.48550/arxiv.XXXX.XXXXX
      return this.lookupOaId(`doi:10.48550/arxiv.${arxivMatch[1]}`);
    }

    // S2 paper ID — try as-is with OpenAlex (won't work, but try DOI lookup as fallback)
    console.warn(`[openalex] Cannot resolve ID format: ${id}`);
    return null;
  }

  private async lookupOaId(filter: string): Promise<string | null> {
    try {
      await rateLimit();
      const resp = await fetch(`${BASE_URL}/works/${filter}?${MAILTO}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as any;
      return data.id?.replace("https://openalex.org/", "") ?? null;
    } catch {
      return null;
    }
  }
}

function normalizeWork(raw: any): Paper {
  const doi = raw.doi?.replace("https://doi.org/", "") ?? null;
  const authors = (raw.authorships ?? []).map(
    (a: any) => a.author?.display_name ?? "",
  );

  // Extract arXiv ID from DOI if it's an arXiv paper (10.48550/arxiv.XXXX.XXXXX)
  let arxivId: string | null = null;
  if (doi) {
    const match = doi.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i);
    if (match) arxivId = match[1];
  }

  // Also check locations for arXiv
  if (!arxivId) {
    for (const loc of raw.locations ?? []) {
      const url = loc.landing_page_url ?? "";
      const m = url.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/);
      if (m) { arxivId = m[1]; break; }
    }
  }

  return {
    paper_id: raw.id?.replace("https://openalex.org/", "") ?? "",
    title: raw.display_name ?? "",
    authors,
    year: raw.publication_year ?? null,
    citation_count: raw.cited_by_count ?? 0,
    arxiv_id: arxivId,
    doi,
    abstract: invertAbstract(raw.abstract_inverted_index),
  };
}

/**
 * OpenAlex stores abstracts as inverted indexes. Reconstruct plaintext.
 */
function invertAbstract(inverted: Record<string, number[]> | null | undefined): string {
  if (!inverted) return "";
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(" ");
}
