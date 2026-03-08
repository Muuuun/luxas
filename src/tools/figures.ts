/**
 * Figure extraction — extract images from papers (LaTeX source or PDF).
 *
 * For LaTeX: copy figure files + parse captions from \begin{figure}...\end{figure}
 * For PDF: use pdfimages (poppler) to extract embedded images
 *
 * All figures saved to data/papers/{id}/figures/ with a manifest.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, extname, basename } from "node:path";
import { execSync } from "node:child_process";

export interface FigureInfo {
  /** Filename in figures/ dir */
  filename: string;
  /** Original source path */
  source: string;
  /** Caption text (if found) */
  caption: string;
  /** Figure label (if found) */
  label: string;
  /** Paper it came from */
  paper_id: string;
  /** Extraction method */
  method: "latex" | "pdfimages";
  /** Width in pixels (if known) */
  width?: number;
  /** Height in pixels (if known) */
  height?: number;
}

export interface FigureManifest {
  paper_id: string;
  extracted_at: number;
  figures: FigureInfo[];
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".eps", ".svg"]);
const FIGURE_PDF_MIN_SIZE = 5_000; // skip tiny PDFs (likely not figures)

/**
 * Extract figures from a paper's source directory.
 * Returns manifest of extracted figures.
 */
export function extractFigures(paperId: string, sourceDir: string, outputDir: string): FigureManifest {
  mkdirSync(outputDir, { recursive: true });

  const manifest: FigureManifest = {
    paper_id: paperId,
    extracted_at: Date.now(),
    figures: [],
  };

  if (!existsSync(sourceDir)) return manifest;

  // Check if source has LaTeX or PDF
  const files = listFilesRecursive(sourceDir);
  const hasLatex = files.some((f) => f.endsWith(".tex"));
  const pdfs = files.filter((f) => f.endsWith(".pdf"));

  if (hasLatex) {
    // LaTeX source: extract figures from .tex files + copy image files
    manifest.figures = extractFromLatex(paperId, sourceDir, outputDir, files);
  } else if (pdfs.length === 1) {
    // Single PDF: extract images using pdfimages
    manifest.figures = extractFromPdf(paperId, pdfs[0], outputDir);
  }

  // Save manifest
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Extract figures from LaTeX source.
 */
function extractFromLatex(
  paperId: string,
  sourceDir: string,
  outputDir: string,
  files: string[],
): FigureInfo[] {
  const figures: FigureInfo[] = [];

  // 1. Find all image files in source
  const imageFiles = files.filter((f) => {
    const ext = extname(f).toLowerCase();
    if (IMAGE_EXTS.has(ext)) return true;
    // PDF files that look like figures (not the main paper)
    if (ext === ".pdf") {
      const size = statSync(f).size;
      const name = basename(f).toLowerCase();
      return size > FIGURE_PDF_MIN_SIZE && !name.includes("paper") && !name.includes("main") && !name.includes("article");
    }
    return false;
  });

  // 2. Parse captions from .tex files
  const texFiles = files.filter((f) => f.endsWith(".tex"));
  const captionMap = new Map<string, { caption: string; label: string }>();
  for (const texFile of texFiles) {
    const content = readFileSync(texFile, "utf-8");
    parseFigureCaptions(content, captionMap);
  }

  // 3. Copy images to output dir
  let idx = 0;
  for (const imgPath of imageFiles) {
    const origName = basename(imgPath);
    const ext = extname(origName).toLowerCase();
    const outName = `fig_${idx}${ext}`;
    const outPath = join(outputDir, outName);

    try {
      // Convert PDF figures to PNG for easier embedding
      if (ext === ".pdf") {
        try {
          execSync(
            `pdftoppm -png -singlefile -r 200 "${imgPath}" "${join(outputDir, `fig_${idx}`)}"`,
            { stdio: "ignore", timeout: 10_000 },
          );
          // pdftoppm outputs fig_N.png
          const pngName = `fig_${idx}.png`;
          if (existsSync(join(outputDir, pngName))) {
            const info = captionMap.get(origName.replace(ext, "")) || captionMap.get(origName) || { caption: "", label: "" };
            figures.push({
              filename: pngName,
              source: imgPath,
              caption: info.caption,
              label: info.label,
              paper_id: paperId,
              method: "latex",
            });
            idx++;
            continue;
          }
        } catch {
          // Fall through to copy as-is
        }
      }

      copyFileSync(imgPath, outPath);
      const nameKey = origName.replace(ext, "");
      const info = captionMap.get(nameKey) || captionMap.get(origName) || { caption: "", label: "" };
      figures.push({
        filename: outName,
        source: imgPath,
        caption: info.caption,
        label: info.label,
        paper_id: paperId,
        method: "latex",
      });
      idx++;
    } catch {
      // skip files that fail to copy
    }
  }

  return figures;
}

/**
 * Extract images from a PDF using pdfimages (poppler).
 */
function extractFromPdf(paperId: string, pdfPath: string, outputDir: string): FigureInfo[] {
  const figures: FigureInfo[] = [];
  const prefix = join(outputDir, "fig");

  try {
    // Extract all images as PNG
    execSync(`pdfimages -png "${pdfPath}" "${prefix}"`, {
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch {
    console.warn(`[figures] pdfimages failed for ${pdfPath}`);
    return figures;
  }

  // List extracted images, filter out tiny ones
  const extracted = readdirSync(outputDir).filter((f) => f.startsWith("fig-") && f.endsWith(".png"));

  for (const fname of extracted) {
    const fpath = join(outputDir, fname);
    const stat = statSync(fpath);

    // Skip tiny images (icons, logos) — less than 10KB
    if (stat.size < 10_000) {
      try { execSync(`rm "${fpath}"`, { stdio: "ignore" }); } catch { /* ignore */ }
      continue;
    }

    figures.push({
      filename: fname,
      source: pdfPath,
      caption: "",
      label: "",
      paper_id: paperId,
      method: "pdfimages",
      width: undefined,
      height: undefined,
    });
  }

  return figures;
}

/**
 * Parse \begin{figure}...\end{figure} blocks for captions and labels.
 * Maps includegraphics filename → {caption, label}
 */
function parseFigureCaptions(
  tex: string,
  out: Map<string, { caption: string; label: string }>,
): void {
  const figureBlocks = tex.match(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/g) || [];

  for (const block of figureBlocks) {
    // Extract includegraphics filename
    const graphicsMatch = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/.exec(block);
    if (!graphicsMatch) continue;

    let filename = graphicsMatch[1];
    // Strip path prefix (e.g., "figures/foo.pdf" → "foo.pdf" and "foo")
    filename = basename(filename);
    const nameNoExt = filename.replace(extname(filename), "");

    // Extract caption
    const captionMatch = /\\caption\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/.exec(block);
    const caption = captionMatch ? captionMatch[1].replace(/\\[a-z]+\{[^}]*\}/g, "").trim() : "";

    // Extract label
    const labelMatch = /\\label\{([^}]+)\}/.exec(block);
    const label = labelMatch ? labelMatch[1] : "";

    out.set(filename, { caption, label });
    out.set(nameNoExt, { caption, label });
  }
}

/**
 * List all files recursively in a directory.
 */
function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Get all figure manifests across papers.
 */
export function getAllFigures(dataDir: string): FigureManifest[] {
  const papersDir = join(dataDir, "papers");
  if (!existsSync(papersDir)) return [];

  const manifests: FigureManifest[] = [];
  for (const dir of readdirSync(papersDir)) {
    const manifestPath = join(papersDir, dir, "figures", "manifest.json");
    if (existsSync(manifestPath)) {
      manifests.push(JSON.parse(readFileSync(manifestPath, "utf-8")));
    }
  }
  return manifests;
}
