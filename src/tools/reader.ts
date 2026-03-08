/**
 * Paper reader — parse LaTeX source or PDF into text chunks.
 *
 * For LaTeX: resolve \input{}, split by \section{}, clean up markup.
 * For PDF: use `pdftotext` CLI (from poppler) for text extraction,
 *          then split by section headings heuristically.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";

export interface TextChunk {
  section: string;
  text: string;
}

/**
 * Parse a paper file/directory into text chunks.
 */
export function parsePaper(path: string): TextChunk[] {
  const stat = statSync(path);

  if (stat.isDirectory()) {
    return parseLatexDir(path);
  }
  if (extname(path) === ".pdf") {
    return parsePdf(path);
  }
  // Fallback: read as plain text
  return [{ section: "full", text: readFileSync(path, "utf-8") }];
}

// --- LaTeX ---

function parseLatexDir(dirPath: string): TextChunk[] {
  const texFiles = readdirSync(dirPath).filter((f) => f.endsWith(".tex"));
  if (texFiles.length === 0) return [];

  // Prefer main.tex, paper.tex, article.tex; otherwise largest .tex file
  let mainTex: string | null = null;
  for (const name of ["main.tex", "paper.tex", "article.tex"]) {
    if (texFiles.includes(name)) {
      mainTex = name;
      break;
    }
  }
  if (!mainTex) {
    mainTex = texFiles.reduce((a, b) => {
      const sizeA = statSync(join(dirPath, a)).size;
      const sizeB = statSync(join(dirPath, b)).size;
      return sizeA >= sizeB ? a : b;
    });
  }

  let content = readFileSync(join(dirPath, mainTex), "utf-8");
  content = resolveInputs(content, dirPath);
  return splitLatexSections(content);
}

/**
 * Resolve \input{} and \include{} directives recursively.
 */
function resolveInputs(content: string, baseDir: string, depth = 0): string {
  if (depth > 5) return content;

  return content.replace(
    /\\(?:input|include)\{([^}]+)\}/g,
    (_match, filename: string) => {
      if (!filename.endsWith(".tex")) {
        filename += ".tex";
      }
      const filepath = join(baseDir, filename);
      if (existsSync(filepath)) {
        const sub = readFileSync(filepath, "utf-8");
        return resolveInputs(sub, join(filepath, ".."), depth + 1);
      }
      return _match;
    },
  );
}

/**
 * Split LaTeX content by \section{} commands.
 */
function splitLatexSections(content: string): TextChunk[] {
  // Remove comments
  content = content.replace(/(?<!\\)%.*$/gm, "");

  // Split by \section, \subsection
  const pattern = /\\(?:section|subsection)\*?\{([^}]+)\}/;
  const parts = content.split(pattern);

  const chunks: TextChunk[] = [];

  // First part is preamble/abstract
  if (parts[0]?.trim()) {
    const abstractMatch =
      /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(parts[0]);
    if (abstractMatch) {
      chunks.push({
        section: "Abstract",
        text: cleanLatex(abstractMatch[1]),
      });
    }
  }

  // Remaining: section_name, section_content pairs
  for (let i = 1; i < parts.length - 1; i += 2) {
    const sectionName = parts[i].trim();
    const sectionText = parts[i + 1]?.trim() ?? "";
    if (sectionText) {
      chunks.push({
        section: sectionName,
        text: cleanLatex(sectionText),
      });
    }
  }

  // If no sections found, return whole content
  if (chunks.length === 0) {
    chunks.push({ section: "full", text: cleanLatex(content) });
  }

  return chunks;
}

// --- PDF ---

/**
 * Parse PDF into text chunks using pdftotext (poppler).
 * Falls back to page-based chunking if section detection fails.
 */
function parsePdf(pdfPath: string): TextChunk[] {
  let fullText: string;

  try {
    // Use pdftotext from poppler-utils (no Python dependency needed)
    fullText = execSync(`pdftotext -layout "${pdfPath}" -`, {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch {
    // Fallback: try without -layout
    try {
      fullText = execSync(`pdftotext "${pdfPath}" -`, {
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: 30_000,
      });
    } catch (err: any) {
      console.error(
        `[reader] Failed to parse PDF ${pdfPath}: ${err.message}. ` +
          `Install poppler: brew install poppler`,
      );
      return [
        {
          section: "full",
          text: `[PDF parsing requires poppler/pdftotext: ${pdfPath}]`,
        },
      ];
    }
  }

  // Try to split by section headings
  const chunks = splitPdfSections(fullText);
  if (chunks.length > 1) {
    return chunks;
  }

  // Fallback: fixed-size chunking
  return chunkBySize(fullText, 8000);
}

/**
 * Try to split PDF text by section headings.
 */
function splitPdfSections(text: string): TextChunk[] {
  const pattern =
    /\n((?:\d+\.?\s+)?(?:Abstract|Introduction|Related Work|Background|Method|Approach|Experiment|Result|Discussion|Conclusion|Limitation|Future|Acknowledgment|Reference)s?)/gi;

  const parts = text.split(pattern);
  const chunks: TextChunk[] = [];

  if (parts[0]?.trim()) {
    chunks.push({ section: "header", text: parts[0].trim().slice(0, 3000) });
  }

  for (let i = 1; i < parts.length - 1; i += 2) {
    const sectionName = parts[i].trim();
    const sectionText = parts[i + 1]?.trim() ?? "";
    if (sectionText) {
      chunks.push({ section: sectionName, text: sectionText });
    }
  }

  return chunks;
}

/**
 * Split text into fixed-size chunks.
 */
function chunkBySize(text: string, maxChars = 8000): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push({
      section: `chunk_${Math.floor(i / maxChars)}`,
      text: text.slice(i, i + maxChars),
    });
  }
  return chunks;
}

/**
 * Light cleanup of LaTeX markup (keep formulas readable).
 */
function cleanLatex(text: string): string {
  // Remove \cite{}, \ref{}, \label{}
  text = text.replace(/\\(?:cite|ref|label|eqref)\{[^}]*\}/g, "");
  // Remove figures
  text = text.replace(
    /\\begin\{figure\}[\s\S]*?\\end\{figure\}/g,
    "[FIGURE]",
  );
  // Keep math formulas as-is
  // Remove excessive whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
