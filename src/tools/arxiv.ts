/**
 * arXiv API client for paper search.
 *
 * Uses the arXiv Atom XML API. Rate limit: 1 req / 3s.
 */

import type { Paper } from "./openalex.js";
import { sleep } from "../utils.js";

const ARXIV_API = "http://export.arxiv.org/api/query";
const RATE_LIMIT_DELAY = 3_000; // 3s

export class ArxivClient {
  /**
   * Search arXiv papers.
   * sortBy: submittedDate, relevance, lastUpdatedDate
   */
  async search(
    query: string,
    maxResults = 20,
    sortBy = "submittedDate",
  ): Promise<Paper[]> {
    const params = new URLSearchParams({
      search_query: `all:${query}`,
      start: "0",
      max_results: String(Math.min(maxResults, 100)),
      sortBy,
      sortOrder: "descending",
    });

    try {
      const resp = await fetch(`${ARXIV_API}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        console.warn(`[arxiv] Search failed: ${resp.status}`);
        return [];
      }
      const xml = await resp.text();
      await sleep(RATE_LIMIT_DELAY);
      return parseArxivResponse(xml);
    } catch (err: any) {
      console.warn(`[arxiv] Search error: ${err.message}`);
      return [];
    }
  }
}

/**
 * Parse arXiv Atom XML response into Paper objects.
 * Uses regex-based XML parsing to avoid external dependencies.
 */
function parseArxivResponse(xml: string): Paper[] {
  const papers: Paper[] = [];

  // Match each <entry>...</entry>
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const arxivId = extractArxivId(getTag(entry, "id"));
    if (!arxivId) continue;

    const title = cleanText(getTag(entry, "title"));
    const abstract = cleanText(getTag(entry, "summary"));
    const published = getTag(entry, "published");
    const year = published ? parseInt(published.slice(0, 4), 10) : null;

    // Extract authors
    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>(.*?)<\/name>/g;
    let authorMatch: RegExpExecArray | null;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    papers.push({
      paper_id: `arxiv:${arxivId}`,
      title,
      authors,
      year,
      citation_count: 0, // arXiv doesn't provide this
      arxiv_id: arxivId,
      doi: null,
      abstract,
      source: "arxiv_search",
    });
  }

  return papers;
}

function getTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = regex.exec(xml);
  return match ? match[1].trim() : "";
}

function extractArxivId(url: string): string | null {
  const match = /(\d{4}\.\d{4,5})(v\d+)?$/.exec(url);
  return match ? match[1] : null;
}

function cleanText(text: string): string {
  return text.split(/\s+/).join(" ").trim();
}
