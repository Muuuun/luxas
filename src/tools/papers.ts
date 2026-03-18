/**
 * Paper tools — download PDFs, arXiv LaTeX source, DOI→BibTeX.
 */

import { Type } from "@sinclair/typebox";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PaperDownloader } from "./downloader.js";
import { hasTexFiles } from "../utils.js";

const DownloadParams = Type.Object({
  arxivId: Type.Optional(Type.String({ description: "arXiv paper ID (e.g. 2301.07041)" })),
  doi: Type.Optional(Type.String({ description: "DOI to download via Sci-Hub (e.g. 10.1038/s41586-021-03819-2)" })),
  url: Type.Optional(Type.String({ description: "Direct URL to download (if not arXiv)" })),
  filename: Type.Optional(Type.String({ description: "Output filename (for URL downloads)" })),
});

const SourceParams = Type.Object({
  arxivId: Type.String({ description: "arXiv paper ID (e.g. 2301.07041)" }),
  maxChars: Type.Optional(Type.Number({ description: "Max characters to return (default 100000)" })),
});

const BibParams = Type.Object({
  doi: Type.String({ description: "DOI of the paper (e.g. 10.1038/s41586-021-03819-2)" }),
  save: Type.Optional(Type.Boolean({ description: "Append to report/references.bib (default true)" })),
});

export function createPaperTools(projectDir: string) {
  const papersDir = join(projectDir, "data", "papers");
  const downloader = new PaperDownloader(papersDir);

  const downloadPaper = {
    name: "download_paper",
    label: "Download Paper",
    description: "Download a paper. Supports: arxivId (LaTeX source preferred, PDF fallback), doi (via Sci-Hub), or direct url. Figures are auto-extracted to data/papers/{id}/figures/ with a manifest.json.",
    parameters: DownloadParams,
    async execute(
      _toolCallId: string,
      params: { arxivId?: string; doi?: string; url?: string; filename?: string },
    ) {
      if (params.arxivId) {
        const path = await downloader.download(params.arxivId);
        if (path) {
          const figInfo = getFigureInfo(projectDir, params.arxivId.replace(/\//g, "_"));
          return {
            content: [{ type: "text" as const, text: `Downloaded to: ${path}${figInfo}` }],
            details: { path },
          };
        }
        return {
          content: [{ type: "text" as const, text: `Failed to download arXiv paper ${params.arxivId}` }],
          details: undefined,
        };
      }

      if (params.doi) {
        const doi = params.doi.replace(/^https?:\/\/doi\.org\//, "");
        const path = await downloader.downloadByDoi(doi);
        if (path) {
          const safeName = doi.replace(/[\/:.]/g, "_");
          const figInfo = getFigureInfo(projectDir, safeName);
          return {
            content: [{ type: "text" as const, text: `Downloaded via Sci-Hub: ${path}${figInfo}` }],
            details: { path, doi },
          };
        }
        return {
          content: [{ type: "text" as const, text: `Failed to download DOI ${doi} via Sci-Hub. All mirrors failed.` }],
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
        content: [{ type: "text" as const, text: "Error: provide arxivId, doi, or url" }],
        details: undefined,
      };
    },
  };

  const getPaperSourceArxiv = {
    name: "get_paper_source_arxiv",
    label: "Get arXiv Source",
    description: "Download arXiv LaTeX source and return the .tex content. Much better than PDF for extracting equations, methodology details, exact citations, table data, and algorithm pseudocode. Returns concatenated .tex files with filenames as headers.",
    parameters: SourceParams,
    async execute(
      _toolCallId: string,
      params: { arxivId: string; maxChars?: number },
    ) {
      const maxChars = params.maxChars ?? 100_000;
      const safeName = params.arxivId.replace(/\//g, "_");
      const texDir = join(papersDir, safeName);

      // Download if not already present
      if (!existsSync(texDir) || !hasTexFiles(texDir)) {
        const path = await downloader.download(params.arxivId);
        if (!path || !existsSync(texDir) || !hasTexFiles(texDir)) {
          return {
            content: [{ type: "text" as const, text: `LaTeX source not available for ${params.arxivId}. Try download_paper for PDF instead.` }],
            details: undefined,
          };
        }
      }

      // Read all .tex and .bib files
      const texContent = readTexDir(texDir, maxChars);

      return {
        content: [{ type: "text" as const, text: texContent }],
        details: { dir: texDir, arxivId: params.arxivId },
      };
    },
  };

  const getBib = {
    name: "get_bib",
    label: "Get BibTeX",
    description: "Fetch BibTeX citation for a paper by DOI. Tries doi.org content negotiation (official metadata), falls back to CrossRef API. Optionally appends to report/references.bib.",
    parameters: BibParams,
    async execute(
      _toolCallId: string,
      params: { doi: string; save?: boolean },
    ) {
      const shouldSave = params.save ?? true;
      const doi = params.doi.replace(/^https?:\/\/doi\.org\//, "");

      let bib: string | null = null;

      // Try doi.org content negotiation (returns official BibTeX)
      try {
        const resp = await fetch(`https://doi.org/${doi}`, {
          headers: { Accept: "application/x-bibtex" },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        if (resp.ok) {
          const text = await resp.text();
          if (text.includes("@")) bib = text.trim();
        }
      } catch {}

      // Fallback: CrossRef API → convert to BibTeX
      if (!bib) {
        try {
          const resp = await fetch(`https://api.crossref.org/works/${doi}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
          if (resp.ok) {
            const data = await resp.json() as any;
            bib = crossrefToBib(data.message, doi);
          }
        } catch {}
      }

      if (!bib) {
        return {
          content: [{ type: "text" as const, text: `Could not fetch BibTeX for DOI: ${doi}` }],
          details: undefined,
        };
      }

      // Save to references.bib
      if (shouldSave) {
        const bibPath = join(projectDir, "report", "references.bib");
        mkdirSync(join(projectDir, "report"), { recursive: true });
        const existing = existsSync(bibPath) ? readFileSync(bibPath, "utf-8") : "";
        // Avoid duplicates by checking if DOI is already present
        if (!existing.includes(doi)) {
          writeFileSync(bibPath, existing + (existing.endsWith("\n") || !existing ? "" : "\n") + bib + "\n\n");
        }
      }

      return {
        content: [{ type: "text" as const, text: bib }],
        details: { doi, saved: shouldSave },
      };
    },
  };

  return [downloadPaper, getPaperSourceArxiv, getBib];
}

function crossrefToBib(work: any, doi: string): string {
  const type = work.type === "journal-article" ? "article"
    : work.type === "proceedings-article" ? "inproceedings"
    : work.type === "book" ? "book"
    : "misc";

  const authors = (work.author ?? [])
    .map((a: any) => `${a.family ?? ""}, ${a.given ?? ""}`.trim())
    .join(" and ");

  const title = Array.isArray(work.title) ? work.title[0] : (work.title ?? "");
  const year = work.published?.["date-parts"]?.[0]?.[0]
    ?? work.created?.["date-parts"]?.[0]?.[0]
    ?? "";
  const journal = Array.isArray(work["container-title"]) ? work["container-title"][0] : (work["container-title"] ?? "");
  const volume = work.volume ?? "";
  const pages = work.page ?? "";

  // Generate a cite key: firstAuthorLastName + year
  const firstLast = (work.author?.[0]?.family ?? "unknown").toLowerCase().replace(/[^a-z]/g, "");
  const key = `${firstLast}${year}`;

  const fields: string[] = [];
  if (authors) fields.push(`  author = {${authors}}`);
  if (title) fields.push(`  title = {${title}}`);
  if (year) fields.push(`  year = {${year}}`);
  if (journal) fields.push(`  journal = {${journal}}`);
  if (volume) fields.push(`  volume = {${volume}}`);
  if (pages) fields.push(`  pages = {${pages}}`);
  fields.push(`  doi = {${doi}}`);

  return `@${type}{${key},\n${fields.join(",\n")}\n}`;
}

function getFigureInfo(projectDir: string, safeName: string): string {
  const manifestPath = join(projectDir, "data", "papers", safeName, "figures", "manifest.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (manifest.figures?.length > 0) {
      return ` (${manifest.figures.length} figures extracted)`;
    }
  } catch {}
  return "";
}

function readTexDir(dir: string, maxChars: number): string {
  const parts: string[] = [];
  let totalChars = 0;

  // Collect .tex and .bib files, sort main.tex first
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".tex") || f.endsWith(".bib"))
    .sort((a, b) => {
      // main.tex first, then alphabetical
      if (a === "main.tex") return -1;
      if (b === "main.tex") return 1;
      // .tex before .bib
      if (a.endsWith(".tex") && b.endsWith(".bib")) return -1;
      if (a.endsWith(".bib") && b.endsWith(".tex")) return 1;
      return a.localeCompare(b);
    });

  for (const file of files) {
    if (totalChars >= maxChars) {
      parts.push(`\n--- truncated (${maxChars} char limit) ---`);
      break;
    }

    try {
      let content = readFileSync(join(dir, file), "utf-8");
      const remaining = maxChars - totalChars;
      if (content.length > remaining) {
        content = content.slice(0, remaining) + "\n... [truncated]";
      }
      parts.push(`=== ${file} ===\n${content}`);
      totalChars += content.length;
    } catch {
      // skip unreadable files
    }
  }

  if (parts.length === 0) {
    return "No .tex files found in source directory.";
  }

  return parts.join("\n\n");
}
