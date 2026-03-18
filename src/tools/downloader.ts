/**
 * Download papers from arXiv — LaTeX source preferred, PDF fallback.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { execSync } from "node:child_process";
import { sleep, hasTexFiles, listFilesRecursive } from "../utils.js";

const ARXIV_DELAY = 1_000; // 1s rate limit

// Sci-Hub mirror discovery — probes candidates to find a working one, caches for session
const SCIHUB_CANDIDATES = [
  "sci-hub.ren",
  "sci-hub.fr",
  "sci-hub.st",
  "sci-hub.se",
  "sci-hub.ru",
  "sci-hub.shop",
  "sci-hub.ee",
  "sci-hub.wf",
  "sci-hub.3800808.com",
  "sci-hub.mksa.top",
];

// A test DOI that every Sci-Hub mirror should have (Shannon 1948)
const PROBE_DOI = "10.1002/j.1538-7305.1948.tb01338.x";

let cachedMirror: string | null = null;

/**
 * Find a working Sci-Hub mirror by probing candidates.
 * Also tries to scrape fresh mirrors from a well-known listing page.
 * Caches the result for the session.
 */
async function findWorkingMirror(): Promise<string | null> {
  if (cachedMirror) return cachedMirror;

  // Combine hardcoded candidates + dynamically discovered ones
  const candidates = [...SCIHUB_CANDIDATES];

  // Try to discover fresh mirrors from a listing page
  try {
    const html = execSync(
      `curl -sL --max-time 10 --doh-url https://1.1.1.1/dns-query "https://www.sci-hub.pub/"`,
      { encoding: "utf-8", timeout: 15_000 },
    );
    const domains = html.match(/sci-hub\.[a-z0-9]+(?:\.[a-z]{2,})?/gi) ?? [];
    for (const d of domains) {
      const normalized = d.toLowerCase();
      if (!candidates.includes(normalized)) candidates.push(normalized);
    }
  } catch {}

  // Probe each candidate: HTTP GET with DoH, check for 200 + valid page
  for (const domain of candidates) {
    try {
      const status = execSync(
        `curl -s --max-time 8 --doh-url https://1.1.1.1/dns-query -o /dev/null -w "%{http_code}" "https://${domain}/${PROBE_DOI}"`,
        { encoding: "utf-8", timeout: 12_000 },
      ).trim();
      if (status === "200") {
        console.log(`[downloader] Found working Sci-Hub mirror: ${domain}`);
        cachedMirror = `https://${domain}`;
        return cachedMirror;
      }
    } catch {}
  }

  console.warn("[downloader] No working Sci-Hub mirror found");
  return null;
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
      this.extractFigures(safeName, texDir);
      return texDir;
    }
    if (existsSync(pdfPath)) {
      this.extractFigures(safeName, pdfPath);
      return pdfPath;
    }

    // Try LaTeX source first
    const latexPath = await this.downloadLatex(arxivId);
    if (latexPath) {
      this.extractFigures(safeName, latexPath);
      return latexPath;
    }

    // Fall back to PDF
    const pdf = await this.downloadPdf(arxivId);
    if (pdf) {
      this.extractFigures(safeName, pdf);
    }
    return pdf;
  }

  /**
   * Download paper by DOI via Sci-Hub.
   * Auto-discovers a working mirror, then downloads. Returns path to PDF, or null on failure.
   */
  async downloadByDoi(doi: string): Promise<string | null> {
    if (!doi) return null;

    const safeName = doi.replace(/[\/:.]/g, "_");
    const pdfPath = join(this.papersDir, `${safeName}.pdf`);

    // Check if already downloaded
    if (existsSync(pdfPath)) {
      this.extractFigures(safeName, pdfPath);
      return pdfPath;
    }

    const mirror = await findWorkingMirror();
    if (!mirror) return null;

    try {
      const pdf = await this.fetchFromScihub(mirror, doi, pdfPath);
      if (pdf) {
        this.extractFigures(safeName, pdf);
        return pdf;
      }
    } catch (err: any) {
      // Mirror stopped working mid-session — clear cache and retry once
      console.warn(`[downloader] Sci-Hub mirror ${mirror} failed: ${err.message}, retrying discovery...`);
      cachedMirror = null;
      const fallback = await findWorkingMirror();
      if (fallback && fallback !== mirror) {
        try {
          const pdf = await this.fetchFromScihub(fallback, doi, pdfPath);
          if (pdf) {
            this.extractFigures(safeName, pdf);
            return pdf;
          }
        } catch {}
      }
    }

    console.warn(`[downloader] Failed to download DOI ${doi} via Sci-Hub`);
    return null;
  }

  /**
   * Try to download PDF from a single Sci-Hub mirror.
   * Uses curl with DoH (DNS-over-HTTPS) to bypass ISP DNS blocking.
   */
  private async fetchFromScihub(mirror: string, doi: string, outPath: string): Promise<string | null> {
    const url = `${mirror}/${doi}`;
    console.log(`[downloader] Trying Sci-Hub: ${url}`);

    // Step 1: Fetch the Sci-Hub page (may be HTML with embedded PDF or redirect)
    const tmpHtml = outPath + ".tmp";
    try {
      execSync(
        `curl -sL --max-time 30 --doh-url https://1.1.1.1/dns-query -o "${tmpHtml}" -w "%{content_type}" "${url}"`,
        { encoding: "utf-8", timeout: 35_000 },
      );
    } catch {
      try { unlinkSync(tmpHtml); } catch {}
      return null;
    }
    await sleep(ARXIV_DELAY);

    if (!existsSync(tmpHtml) || statSync(tmpHtml).size < 100) {
      try { unlinkSync(tmpHtml); } catch {}
      return null;
    }

    // Check if we got a PDF directly
    const head = readFileSync(tmpHtml).subarray(0, 5).toString();
    if (head === "%PDF-") {
      copyFileSync(tmpHtml, outPath);
      unlinkSync(tmpHtml);
      console.log(`[downloader] Downloaded PDF via Sci-Hub for ${doi}`);
      return outPath;
    }

    // Otherwise parse HTML to find embedded PDF URL
    const html = readFileSync(tmpHtml, "utf-8");
    try { unlinkSync(tmpHtml); } catch {}

    const pdfUrlMatch =
      html.match(/iframe[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i) ??
      html.match(/id\s*=\s*["']pdf["'][^>]+src\s*=\s*["']([^"']+)["']/i) ??
      html.match(/embed[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i) ??
      html.match(/location\.href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i) ??
      html.match(/src\s*=\s*["'](\/\/[^"']+)["']/i);

    if (!pdfUrlMatch) {
      console.warn(`[downloader] No PDF URL found in Sci-Hub page`);
      return null;
    }

    let pdfUrl = pdfUrlMatch[1];
    if (pdfUrl.startsWith("//")) pdfUrl = "https:" + pdfUrl;
    if (pdfUrl.startsWith("/")) pdfUrl = mirror + pdfUrl;

    // Step 2: Download the actual PDF
    try {
      execSync(
        `curl -sL --max-time 60 --doh-url https://1.1.1.1/dns-query -o "${outPath}" "${pdfUrl}"`,
        { stdio: "ignore", timeout: 65_000 },
      );
    } catch {
      try { unlinkSync(outPath); } catch {}
      return null;
    }
    await sleep(ARXIV_DELAY);

    if (!existsSync(outPath) || statSync(outPath).size < 1000) {
      try { unlinkSync(outPath); } catch {}
      return null;
    }

    // Verify it's actually a PDF
    const pdfHead = readFileSync(outPath).subarray(0, 5).toString();
    if (pdfHead !== "%PDF-") {
      console.warn(`[downloader] Downloaded file is not a PDF`);
      try { unlinkSync(outPath); } catch {}
      return null;
    }

    console.log(`[downloader] Downloaded PDF via Sci-Hub for ${doi}`);
    return outPath;
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

  // ── Auto figure extraction after download ──────────────────

  /**
   * Extract figures from a downloaded paper.
   * @param paperId  sanitized paper ID (e.g. "2301.07041")
   * @param path     path to downloaded content (directory for LaTeX, .pdf file for PDF)
   */
  private extractFigures(paperId: string, path: string): void {
    const figDir = join(this.papersDir, paperId, "figures");

    // Skip if already extracted
    if (existsSync(join(figDir, "manifest.json"))) return;

    try {
      if (existsSync(path) && statSync(path).isDirectory() && hasTexFiles(path)) {
        this.extractFromLatex(paperId, path, figDir);
      } else if (path.endsWith(".pdf")) {
        this.extractFromPdf(paperId, path, figDir);
      }
    } catch {
      // Figure extraction is best-effort — never block download
    }
  }

  /**
   * Extract figures from LaTeX source: copy image files + parse captions.
   */
  private extractFromLatex(paperId: string, sourceDir: string, figDir: string): void {
    const files = listFilesRecursive(sourceDir);

    // Collect image files
    const imageFiles = files.filter((f) => {
      const ext = extname(f).toLowerCase();
      if (IMAGE_EXTS.has(ext)) return true;
      if (ext === ".pdf") {
        const size = statSync(f).size;
        const name = basename(f).toLowerCase();
        return size > MIN_PDF_FIGURE_SIZE && !name.includes("main") && !name.includes("paper") && !name.includes("article");
      }
      return false;
    });

    if (imageFiles.length === 0) return;
    mkdirSync(figDir, { recursive: true });

    // Parse captions from .tex files
    const captionMap = new Map<string, { caption: string; label: string }>();
    for (const f of files.filter((f) => f.endsWith(".tex"))) {
      const parsed = parseFigureCaptions(readFileSync(f, "utf-8"));
      for (const [k, v] of parsed) captionMap.set(k, v);
    }

    // Copy figures
    const manifest: any[] = [];
    let idx = 0;
    for (const imgPath of imageFiles) {
      const origName = basename(imgPath);
      const ext = extname(origName).toLowerCase();

      try {
        // Convert PDF figures to PNG
        if (ext === ".pdf") {
          try {
            execSync(`pdftoppm -png -singlefile -r 200 "${imgPath}" "${join(figDir, `fig_${idx}`)}"`, {
              stdio: "ignore", timeout: 10_000,
            });
            const pngName = `fig_${idx}.png`;
            if (existsSync(join(figDir, pngName))) {
              const info = captionMap.get(origName.replace(ext, "")) ?? captionMap.get(origName) ?? { caption: "", label: "" };
              manifest.push({ filename: pngName, source: origName, caption: info.caption, label: info.label, method: "latex" });
              idx++;
              continue;
            }
          } catch {}
        }

        const outName = `fig_${idx}${ext}`;
        copyFileSync(imgPath, join(figDir, outName));
        const nameKey = origName.replace(ext, "");
        const info = captionMap.get(nameKey) ?? captionMap.get(origName) ?? { caption: "", label: "" };
        manifest.push({ filename: outName, source: origName, caption: info.caption, label: info.label, method: "latex" });
        idx++;
      } catch {}
    }

    if (manifest.length > 0) {
      writeFileSync(join(figDir, "manifest.json"), JSON.stringify({ paper_id: paperId, figures: manifest }, null, 2));
      console.log(`[downloader] Extracted ${manifest.length} figures for ${paperId}`);
    }
  }

  /**
   * Extract embedded images from PDF using pdfimages (poppler).
   */
  private extractFromPdf(paperId: string, pdfPath: string, figDir: string): void {
    // Check if pdfimages is available
    try { execSync("which pdfimages", { stdio: "pipe" }); } catch { return; }

    mkdirSync(figDir, { recursive: true });
    const prefix = join(figDir, "fig");

    try {
      execSync(`pdfimages -png "${pdfPath}" "${prefix}"`, { stdio: "ignore", timeout: 30_000 });
    } catch { return; }

    // Filter out tiny images (icons, logos)
    const manifest: any[] = [];
    for (const fname of readdirSync(figDir).filter((f) => f.startsWith("fig-") && f.endsWith(".png"))) {
      const fpath = join(figDir, fname);
      if (statSync(fpath).size < MIN_IMG_SIZE) {
        try { unlinkSync(fpath); } catch {}
        continue;
      }
      manifest.push({ filename: fname, source: basename(pdfPath), caption: "", label: "", method: "pdfimages" });
    }

    if (manifest.length > 0) {
      writeFileSync(join(figDir, "manifest.json"), JSON.stringify({ paper_id: paperId, figures: manifest }, null, 2));
      console.log(`[downloader] Extracted ${manifest.length} figures from PDF for ${paperId}`);
    }
  }
}

// ─── Figure extraction ───────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".eps", ".svg"]);
const MIN_PDF_FIGURE_SIZE = 5_000;  // skip tiny PDFs (not figures)
const MIN_IMG_SIZE = 10_000;        // skip tiny images from pdfimages (icons/logos)

/**
 * Parse \begin{figure}...\end{figure} blocks for caption → filename mapping.
 */
function parseFigureCaptions(tex: string): Map<string, { caption: string; label: string }> {
  const out = new Map<string, { caption: string; label: string }>();
  const blocks = tex.match(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/g) || [];

  for (const block of blocks) {
    const gfx = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/.exec(block);
    if (!gfx) continue;

    const filename = basename(gfx[1]);
    const nameNoExt = filename.replace(extname(filename), "");

    const capMatch = /\\caption\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/.exec(block);
    const caption = capMatch ? capMatch[1].replace(/\\[a-z]+\{[^}]*\}/g, "").trim() : "";

    const lblMatch = /\\label\{([^}]+)\}/.exec(block);
    const label = lblMatch ? lblMatch[1] : "";

    out.set(filename, { caption, label });
    out.set(nameNoExt, { caption, label });
  }
  return out;
}

