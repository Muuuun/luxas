/**
 * Paper download tool — downloads papers from arXiv (LaTeX source preferred).
 */

import { Type } from "@sinclair/typebox";
import { join } from "node:path";
import { PaperDownloader } from "./downloader.js";

const DownloadParams = Type.Object({
  arxivId: Type.Optional(Type.String({ description: "arXiv paper ID (e.g. 2301.07041)" })),
  url: Type.Optional(Type.String({ description: "Direct URL to download (if not arXiv)" })),
  filename: Type.Optional(Type.String({ description: "Output filename (for URL downloads)" })),
});

export function createPaperTools(projectDir: string) {
  const downloader = new PaperDownloader(join(projectDir, "data", "papers"));

  const downloadPaper = {
    name: "download_paper",
    label: "Download Paper",
    description: "Download a paper from arXiv (tries LaTeX source first, falls back to PDF). Use arxivId for arXiv papers, or url for direct downloads.",
    parameters: DownloadParams,
    async execute(
      _toolCallId: string,
      params: { arxivId?: string; url?: string; filename?: string },
    ) {
      if (params.arxivId) {
        const path = await downloader.download(params.arxivId);
        if (path) {
          return {
            content: [{ type: "text" as const, text: `Downloaded to: ${path}` }],
            details: { path },
          };
        }
        return {
          content: [{ type: "text" as const, text: `Failed to download arXiv paper ${params.arxivId}` }],
          details: undefined,
        };
      }

      if (params.url) {
        try {
          const resp = await fetch(params.url, {
            redirect: "follow",
            signal: AbortSignal.timeout(60_000),
          });
          if (!resp.ok) {
            return {
              content: [{ type: "text" as const, text: `HTTP ${resp.status} fetching ${params.url}` }],
              details: undefined,
            };
          }
          const buffer = Buffer.from(await resp.arrayBuffer());
          const fname = params.filename ?? params.url.split("/").pop() ?? "paper.pdf";
          const outPath = join(projectDir, "data", "papers", fname);
          const { writeFileSync, mkdirSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, buffer);
          return {
            content: [{ type: "text" as const, text: `Downloaded to: ${outPath} (${buffer.length} bytes)` }],
            details: { path: outPath },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Download failed: ${err.message}` }],
            details: undefined,
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: "Error: provide either arxivId or url" }],
        details: undefined,
      };
    },
  };

  return [downloadPaper];
}
