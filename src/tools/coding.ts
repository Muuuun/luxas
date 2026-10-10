/**
 * Coding tools — read, write, edit from pi-coding-agent + Sisyphus's hardened
 * bash + job-control tools. We swap the bash entry from createCodingTools'
 * result with our own (default 600s timeout, SIGTERM grace, .agent/jobs/<id>/
 * state.json + log, ALS owner identity) and append job_status / job_output /
 * job_wait / job_kill so every agent that has bash can also observe and
 * control its background jobs.
 */

import {
  createCodingTools,
  detectSupportedImageMimeTypeFromFile,
  type ReadToolOptions,
} from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createHardenedBashTool } from "./bash-hardened.js";
import { createJobControlTools } from "./job-control.js";

const PDF_READ_NOTE = " A PDF returns its text layer (pdftotext -layout).";

/**
 * pi's read hands a PDF back as its raw bytes: ~100 KB of noise that rides in
 * context on every later turn, and the PI reviewer has no bash to extract text
 * itself. This read returns the text layer instead; offset/limit/truncation
 * stay pi's. Decided by the file's magic bytes, not its extension.
 */
export function pdfTextReadOptions(): ReadToolOptions {
  return {
    operations: {
      access: (p) => access(p, constants.R_OK),
      detectImageMimeType: detectSupportedImageMimeTypeFromFile,
      readFile: async (p) => {
        const buf = await readFile(p);
        if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return buf;
        const r = spawnSync("pdftotext", ["-layout", p, "-"], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
        if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          const q = JSON.stringify(p);
          throw new Error(
            `pdftotext is not installed, so this PDF's text layer cannot be read. Extract it with bash, then read out.txt: ` +
            `pdftotext -layout ${q} out.txt (poppler), or ` +
            `python3 -c "import fitz,sys; print(''.join(pg.get_text() for pg in fitz.open(sys.argv[1])))" ${q} > out.txt (PyMuPDF).`,
          );
        }
        if (r.error) throw new Error(`pdftotext failed on ${p}: ${r.error.message}`);
        if (r.status !== 0) {
          throw new Error(`pdftotext failed on ${p}: ${r.stderr?.toString().trim() || `exit ${r.status}`}`);
        }
        if (!/\S/.test(r.stdout.toString("utf-8"))) { // \s covers the \f page breaks
          throw new Error(`${p} has no text layer (scanned image PDF): render pages with pdftoppm -r 150 -png and read the images.`);
        }
        return r.stdout;
      },
    },
  };
}

/** Name the PDF behaviour where the model chooses tools. */
export function withPdfReadNote<T extends { description: string }>(tool: T): T {
  return { ...tool, description: tool.description + PDF_READ_NOTE };
}

export function createCodingToolsForProject(projectDir: string): any[] {
  const tools = createCodingTools(projectDir, { read: pdfTextReadOptions() });
  const hardened = createHardenedBashTool(projectDir);
  const swapped = tools.map(t => (t?.name === "bash" ? hardened : t?.name === "read" ? withPdfReadNote(t) : t));
  return [...swapped, ...createJobControlTools(projectDir)];
}
