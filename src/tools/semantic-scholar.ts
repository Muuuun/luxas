/**
 * Semantic Scholar API client for paper search and citation traversal.
 */

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "paperId,title,authors,year,citationCount,externalIds,abstract";
const CITATION_FIELDS = "paperId,title,year,citationCount,externalIds,abstract";
const RATE_LIMIT_DELAY = 200; // 5 req/s

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SemanticScholarClient {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Search papers by query string.
   */
  async search(
    query: string,
    limit = 20,
    yearRange?: string,
  ): Promise<Paper[]> {
    const params = new URLSearchParams({
      query,
      fields: FIELDS,
      limit: String(Math.min(limit, 100)),
    });
    if (yearRange) {
      params.set("year", yearRange);
    }

    try {
      const resp = await this.fetch(`/paper/search?${params}`);
      if (!resp.ok) {
        console.warn(`[s2] Search failed: ${resp.status} ${resp.statusText}`);
        return [];
      }
      const data = await resp.json();
      await sleep(RATE_LIMIT_DELAY);
      return (data.data ?? []).map(normalizePaper);
    } catch (err: any) {
      console.warn(`[s2] Search error: ${err.message}`);
      return [];
    }
  }

  /**
   * Get papers that cite this paper (forward citations).
   */
  async getCitations(paperId: string, limit = 50): Promise<Paper[]> {
    const params = new URLSearchParams({
      fields: CITATION_FIELDS,
      limit: String(Math.min(limit, 500)),
    });

    try {
      const resp = await this.fetch(
        `/paper/${encodeURIComponent(paperId)}/citations?${params}`,
      );
      if (!resp.ok) {
        console.warn(`[s2] Citations failed for ${paperId}: ${resp.status}`);
        return [];
      }
      const data = await resp.json();
      await sleep(RATE_LIMIT_DELAY);
      return (data.data ?? [])
        .filter((item: any) => item.citingPaper?.paperId)
        .map((item: any) => normalizePaper(item.citingPaper));
    } catch (err: any) {
      console.warn(`[s2] Citations error for ${paperId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Get papers this paper cites (backward references).
   */
  async getReferences(paperId: string, limit = 50): Promise<Paper[]> {
    const params = new URLSearchParams({
      fields: CITATION_FIELDS,
      limit: String(Math.min(limit, 500)),
    });

    try {
      const resp = await this.fetch(
        `/paper/${encodeURIComponent(paperId)}/references?${params}`,
      );
      if (!resp.ok) {
        console.warn(`[s2] References failed for ${paperId}: ${resp.status}`);
        return [];
      }
      const data = await resp.json();
      await sleep(RATE_LIMIT_DELAY);
      return (data.data ?? [])
        .filter((item: any) => item.citedPaper?.paperId)
        .map((item: any) => normalizePaper(item.citedPaper));
    } catch (err: any) {
      console.warn(`[s2] References error for ${paperId}: ${err.message}`);
      return [];
    }
  }

  private fetch(path: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    return fetch(`${BASE_URL}${path}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  }
}

function normalizePaper(raw: any): Paper {
  const externalIds = raw.externalIds ?? {};
  const authors = raw.authors ?? [];
  return {
    paper_id: raw.paperId ?? "",
    title: raw.title ?? "",
    authors: authors.map((a: any) => a.name ?? ""),
    year: raw.year ?? null,
    citation_count: raw.citationCount ?? 0,
    arxiv_id: externalIds.ArXiv ?? null,
    doi: externalIds.DOI ?? null,
    abstract: raw.abstract ?? "",
  };
}
