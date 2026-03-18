/**
 * Search tools — search_papers and get_citations as AgentTool wrappers.
 */

import { Type } from "@sinclair/typebox";
import { OpenAlexClient } from "./openalex.js";
import { ArxivClient } from "./arxiv.js";
import type { Paper } from "./openalex.js";

function formatPapers(papers: Paper[], source: string): string {
  return papers.map((p, i) =>
    `[${source} ${i + 1}] ${p.title} (${p.year ?? "?"}, ${p.citation_count} cites)\n` +
    `  ID: ${p.paper_id}${p.arxiv_id ? ` | arXiv: ${p.arxiv_id}` : ""}` +
    `${p.doi ? ` | DOI: ${p.doi}` : ""}\n` +
    `  ${(p.abstract || "No abstract").slice(0, 300)}`
  ).join("\n\n");
}

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  source: Type.Optional(Type.String({ description: "Search source: openalex, arxiv, or both (default: both)" })),
  count: Type.Optional(Type.Number({ description: "Max results per source (default 10, max 50)" })),
});

const CitationParams = Type.Object({
  paperId: Type.String({ description: "Paper ID — OpenAlex ID (W...), DOI (10.xxx/...), or arXiv ID (2301.07041)" }),
  direction: Type.Optional(Type.String({ description: "references, citations, or both (default: both)" })),
  limit: Type.Optional(Type.Number({ description: "Max results per direction (default 20)" })),
});

export function createSearchTools() {
  const oa = new OpenAlexClient();
  const arxiv = new ArxivClient();

  const searchPapers = {
    name: "search_papers",
    label: "Search Papers",
    description: "Search academic papers via OpenAlex and/or arXiv. OpenAlex has broader coverage (all fields, DOIs, citation counts). arXiv is better for recent physics/CS/math preprints. Returns titles, abstracts, citation counts, and IDs for downloading.",
    parameters: SearchParams,
    async execute(
      _toolCallId: string,
      params: { query: string; source?: string; count?: number },
    ) {
      const source = params.source ?? "both";
      const count = Math.min(params.count ?? 10, 50);
      const parts: string[] = [];

      if (source === "openalex" || source === "both") {
        const papers = await oa.search(params.query, count);
        if (papers.length > 0) parts.push(formatPapers(papers, "OA"));
        else parts.push("[OA] No results");
      }

      if (source === "arxiv" || source === "both") {
        const papers = await arxiv.search(params.query, count);
        if (papers.length > 0) parts.push(formatPapers(papers, "arXiv"));
        else parts.push("[arXiv] No results");
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") || "No results found" }],
        details: undefined,
      };
    },
  };

  const getCitations = {
    name: "get_citations",
    label: "Get Citations",
    description: "Get papers that cite a given paper (forward citations) and/or papers it references (backward references). Accepts OpenAlex ID (W...), DOI, or arXiv ID. Use for citation chain snowballing.",
    parameters: CitationParams,
    async execute(
      _toolCallId: string,
      params: { paperId: string; direction?: string; limit?: number },
    ) {
      const direction = params.direction ?? "both";
      const limit = Math.min(params.limit ?? 20, 100);
      const parts: string[] = [];

      if (direction === "citations" || direction === "both") {
        const papers = await oa.getCitations(params.paperId, limit);
        parts.push(`Forward citations (${papers.length} papers citing this):\n` +
          (papers.length > 0 ? formatPapers(papers, "cite") : "  None found"));
      }

      if (direction === "references" || direction === "both") {
        const papers = await oa.getReferences(params.paperId, limit);
        parts.push(`Backward references (${papers.length} papers cited by this):\n` +
          (papers.length > 0 ? formatPapers(papers, "ref") : "  None found"));
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n") }],
        details: undefined,
      };
    },
  };

  return [searchPapers, getCitations];
}
