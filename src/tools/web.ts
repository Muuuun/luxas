/**
 * Web tools — web_search (Brave) and web_fetch.
 */

import { Type } from "@sinclair/typebox";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  count: Type.Optional(Type.Number({ description: "Number of results (default 5, max 20)" })),
});

const WebFetchParams = Type.Object({
  url: Type.String({ description: "URL to fetch" }),
});

export function createWebTools() {
  const webSearch = {
    name: "web_search",
    label: "Web Search",
    description: "Search the web via Brave Search API. Returns titles, URLs, and snippets.",
    parameters: WebSearchParams,
    async execute(
      _toolCallId: string,
      params: { query: string; count?: number },
    ) {
      const key = process.env.BRAVE_API_KEY;
      if (!key) {
        return { content: [{ type: "text" as const, text: "Error: BRAVE_API_KEY not set" }], details: undefined };
      }
      const count = Math.min(params.count ?? 5, 20);
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(params.query)}&count=${count}`;
      const res = await fetch(url, {
        headers: { "accept": "application/json", "accept-encoding": "gzip", "x-subscription-token": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        return { content: [{ type: "text" as const, text: `Brave API ${res.status}: ${body}` }], details: undefined };
      }
      const data = await res.json() as any;
      const results = (data.web?.results ?? []).map((r: any, i: number) =>
        `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description ?? ""}`
      ).join("\n\n");
      return { content: [{ type: "text" as const, text: results || "No results found" }], details: undefined };
    },
  };

  const webFetch = {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a URL and return its text content. HTML is stripped to plain text.",
    parameters: WebFetchParams,
    async execute(
      _toolCallId: string,
      params: { url: string },
    ) {
      try {
        const res = await fetch(params.url, {
          headers: { "user-agent": "Sisyphus/2.0" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `HTTP ${res.status}` }], details: undefined };
        }
        const ct = res.headers.get("content-type") ?? "";
        let text: string;
        if (ct.includes("html")) {
          const html = await res.text();
          text = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim();
        } else {
          text = await res.text();
        }
        return { content: [{ type: "text" as const, text: text.slice(0, 80_000) }], details: undefined };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Fetch error: ${err.message}` }], details: undefined };
      }
    },
  };

  return [webSearch, webFetch];
}
