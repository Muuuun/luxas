/**
 * Download papers from arXiv — LaTeX source preferred, PDF fallback.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ARXIV_DELAY = 1_000; // 1s rate limit

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PaperDownloader {
  private papersDir: string;

  constructor(papersDir = "data/papers") {
    this.papersDir = papersDir;
    mkdirSync(papersDir, { recursive: true });
  }

  /**
   * Download paper by arXiv ID.
   * Tries LaTeX source first, falls back to PDF.
   * Returns path to downloaded file, or null on failure.
   */
  async download(arxivId: string): Promise<string | null> {
    if (!arxivId) return null;

    const safeName = arxivId.replace(/\//g, "_");
    const texDir = join(this.papersDir, safeName);
    const pdfPath = join(this.papersDir, `${safeName}.pdf`);

    // Check if already downloaded
    if (existsSync(texDir) && hasTexFiles(texDir)) {
      return texDir;
    }
    if (existsSync(pdfPath)) {
      return pdfPath;
    }

    // Try LaTeX source first
    const latexPath = await this.downloadLatex(arxivId);
    if (latexPath) return latexPath;

    // Fall back to PDF
    const pdf = await this.downloadPdf(arxivId);
    return pdf;
  }

  /**
   * Download and extract LaTeX source from arXiv.
   */
  private async downloadLatex(arxivId: string): Promise<string | null> {
    const safeName = arxivId.replace(/\//g, "_");
    const url = `https://arxiv.org/src/${arxivId}`;
    const outDir = join(this.papersDir, safeName);
    const tarPath = join(this.papersDir, `${safeName}.tar.gz`);

    try {
      const resp = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      await sleep(ARXIV_DELAY);

      if (!resp.ok) {
        console.log(
          `[downloader] LaTeX source not available for ${arxivId} (${resp.status})`,
        );
        return null;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      mkdirSync(outDir, { recursive: true });

      // Write tar.gz and try to extract
      writeFileSync(tarPath, buffer);

      try {
        // Try as tar.gz
        execSync(`tar xzf "${tarPath}" -C "${outDir}"`, { stdio: "ignore" });
        // Clean up tar.gz
        try {
          execSync(`rm "${tarPath}"`, { stdio: "ignore" });
        } catch {
          // ignore
        }
        console.log(`[downloader] Downloaded LaTeX source for ${arxivId}`);
        return outDir;
      } catch {
        // Might be single gzipped file
        try {
          execSync(`gunzip -c "${tarPath}" > "${join(outDir, "main.tex")}"`, {
            stdio: "ignore",
          });
          try {
            execSync(`rm "${tarPath}"`, { stdio: "ignore" });
          } catch {
            // ignore
          }
          console.log(`[downloader] Downloaded single .tex for ${arxivId}`);
          return outDir;
        } catch {
          // Not gzip either, clean up
          try {
            execSync(`rm -rf "${outDir}" "${tarPath}"`, { stdio: "ignore" });
          } catch {
            // ignore
          }
        }
      }

      return null;
    } catch (err: any) {
      console.warn(
        `[downloader] Failed to download LaTeX for ${arxivId}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Download PDF from arXiv.
   */
  private async downloadPdf(arxivId: string): Promise<string | null> {
    const safeName = arxivId.replace(/\//g, "_");
    const url = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const pdfPath = join(this.papersDir, `${safeName}.pdf`);

    try {
      const resp = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
      await sleep(ARXIV_DELAY);

      if (!resp.ok) {
        console.warn(
          `[downloader] PDF not available for ${arxivId} (${resp.status})`,
        );
        return null;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      writeFileSync(pdfPath, buffer);
      console.log(`[downloader] Downloaded PDF for ${arxivId}`);
      return pdfPath;
    } catch (err: any) {
      console.warn(
        `[downloader] Failed to download PDF for ${arxivId}: ${err.message}`,
      );
      return null;
    }
  }
}

function hasTexFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith(".tex"));
  } catch {
    return false;
  }
}
