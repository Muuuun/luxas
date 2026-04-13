/**
 * Figure generation tools — hybrid raster+vector pipeline for illustrator agent.
 *
 * Three tools:
 *   - generate_raster_component: Gemini (Nano Banana) + rembg → isolated PNG
 *   - compile_tikz:              pdflatex + optional pdftoppm preview
 *   - extract_pdf_figures:       pdftoppm page rasterization for style learning
 *
 * Requires GEMINI_API_KEY for generate_raster_component.
 * Requires pdflatex + pdftoppm on PATH for compile_tikz / extract_pdf_figures.
 * Requires python3 with rembg[cpu]+google-genai for generate_raster_component
 * (installed by skills/figure/scripts/requirements.txt).
 */

import { Type } from "@sinclair/typebox";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, isAbsolute, resolve as resolvePath, basename, relative as relativePath } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSafe } from "../utils.js";
import { getTexEnv } from "./report.js";

const DEFAULT_STYLE_SUFFIX =
  "Isolated object on pure white background, no text, no labels, no captions, " +
  "no shadows on the ground, centered, square 1024x1024, flat scientific " +
  "illustration, soft top-left lighting.";

function resolveInProject(projectDir: string, p: string): string {
  return isAbsolute(p) ? p : resolvePath(projectDir, p);
}

const ok = (text: string, details: Record<string, any> = {}) => ({
  content: [{ type: "text" as const, text }],
  details: { success: true, ...details },
});
const fail = (text: string, details: Record<string, any> = {}) => ({
  content: [{ type: "text" as const, text }],
  details: { success: false, ...details },
});

export function createGenerateRasterComponentTool(projectDir: string) {
  return {
    name: "generate_raster_component",
    label: "Generate Raster Component",
    description:
      "Generate ONE isolated raster component (e.g. optical tweezer beam, Paul trap, " +
      "cell, apparatus) via Gemini Nano Banana, then remove background via rembg to " +
      "produce a transparent PNG. For use as a raster slot in a TikZ hybrid figure.\n\n" +
      "STRICT: prompt must describe a single object on white background with NO text, " +
      "NO labels, NO captions. All text/symbols go in TikZ overlay separately.\n\n" +
      "Share a consistent `styleSuffix` across components of one figure to maintain " +
      "lighting/palette coherence. Output is saved to <projectDir>/<outPath>. Both " +
      "the transparent cut and the pre-rembg raw are kept (raw at <stem>_raw.png).",
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "Object description. Be specific about geometry, colors (hex preferred), " +
          "perspective, material (glossy, matte, metal). Do NOT include any text/labels.",
      }),
      outPath: Type.String({
        description:
          "Relative path inside project for the output PNG (e.g. 'figures/assets/tweezer.png').",
      }),
      styleSuffix: Type.Optional(Type.String({
        description:
          "Shared style suffix across components of one figure. Default is a flat " +
          "scientific illustration style with white bg + top-left lighting.",
      })),
      removeBackground: Type.Optional(Type.Boolean({
        description: "Run rembg to produce transparent PNG. Default: true.",
      })),
      model: Type.Optional(Type.String({
        description: "Gemini image model. Default: 'gemini-2.5-flash-image' (Nano Banana).",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        prompt: string;
        outPath: string;
        styleSuffix?: string;
        removeBackground?: boolean;
        model?: string;
      },
    ) {
      if (!process.env.GEMINI_API_KEY) {
        return fail("GEMINI_API_KEY not set. Cannot generate raster.");
      }

      const outAbs = resolveInProject(projectDir, params.outPath);
      mkdirSync(dirname(outAbs), { recursive: true });

      const scriptPath = resolvePath(
        dirname(new URL(import.meta.url).pathname),
        "../../skills/figure/scripts/hybrid_gen.py",
      );
      if (!existsSync(scriptPath)) {
        return fail(`Hybrid gen script not found at ${scriptPath}. Did the skills/figure/ skill get installed?`);
      }

      const args = [
        scriptPath,
        "--name", basename(outAbs, ".png"),
        "--prompt", params.prompt,
        "--style", params.styleSuffix ?? DEFAULT_STYLE_SUFFIX,
        "--out", outAbs,
        "--model", params.model ?? "gemini-2.5-flash-image",
      ];
      if (params.removeBackground === false) args.push("--no-rembg");

      const result = spawnSync("python3", args, {
        env: process.env,
        timeout: 180_000,
        encoding: "utf-8",
      });

      if (result.status !== 0) {
        const stderr = (result.stderr || "").slice(-1500);
        const stdout = (result.stdout || "").slice(-500);
        return fail(`Raster generation failed (exit ${result.status}).\nstderr:\n${stderr}\nstdout:\n${stdout}`);
      }

      if (!existsSync(outAbs)) {
        return fail(`Script succeeded but output file is missing: ${outAbs}\nstdout: ${result.stdout}`);
      }

      const sizeKb = Math.round(statSync(outAbs).size / 1024);
      const suffix = params.removeBackground === false ? "" : " — transparent background";
      return ok(
        `Raster component saved: ${params.outPath} (${sizeKb} KB)${suffix}\n\nstdout:\n${(result.stdout || "").slice(-300)}`,
        { path: outAbs, sizeKb },
      );
    },
  };
}

export function createCompileTikzTool(projectDir: string) {
  return {
    name: "compile_tikz",
    label: "Compile TikZ Figure",
    description:
      "Compile a standalone TikZ .tex file to PDF via pdflatex. Optionally rasterize " +
      "the first page to PNG via pdftoppm (for vision-based iteration). On failure, " +
      "returns the last ~30 lines of the pdflatex log for debugging.",
    parameters: Type.Object({
      texPath: Type.String({
        description: "Path to the .tex file, relative to project dir (e.g. 'figures/figure_1.tex').",
      }),
      preview: Type.Optional(Type.Boolean({
        description: "Also produce a PNG preview via pdftoppm -r 200. Default: true.",
      })),
      dpi: Type.Optional(Type.Number({
        description: "DPI for PNG preview. Default 200.",
      })),
      engine: Type.Optional(Type.String({
        description: "'pdflatex' (default) or 'lualatex' (for tikz-feynman).",
      })),
      twoPass: Type.Optional(Type.Boolean({
        description: "Run pdflatex twice to resolve cross-refs. Default false — standalone TikZ figures rarely need it and one pass is ~2x faster.",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: { texPath: string; preview?: boolean; dpi?: number; engine?: string; twoPass?: boolean },
    ) {
      const texAbs = resolveInProject(projectDir, params.texPath);
      if (!existsSync(texAbs)) {
        return fail(`TeX file not found: ${params.texPath}`);
      }

      const texDir = dirname(texAbs);
      const stem = basename(texAbs, ".tex");
      const engine = params.engine ?? "pdflatex";
      const env = getTexEnv();

      const runLatex = () =>
        spawnSync(engine, ["-interaction=nonstopmode", "-halt-on-error", stem + ".tex"], {
          cwd: texDir,
          env,
          encoding: "utf-8",
          timeout: 120_000,
        });

      const r1 = runLatex();
      // Second pass for cross-refs: either on demand, or if log signals a rerun is needed.
      const needsRerun = params.twoPass === true
        || (r1.status === 0 && /Rerun to get cross-references right|There were undefined references/.test(r1.stdout ?? ""));
      if (r1.status === 0 && needsRerun) runLatex();

      const pdfPath = join(texDir, stem + ".pdf");
      if (r1.status !== 0 || !existsSync(pdfPath)) {
        const log = readFileSafe(join(texDir, stem + ".log"));
        const logTail = log.split("\n").slice(-40).join("\n");
        return fail(
          `pdflatex failed (exit ${r1.status}).\nLast 40 lines of ${stem}.log:\n${logTail}`,
          { logTail },
        );
      }

      let pngPath: string | undefined;
      if (params.preview !== false) {
        const dpi = params.dpi ?? 200;
        const pngStem = join(texDir, stem + "_preview");
        const r2 = spawnSync("pdftoppm", ["-r", String(dpi), "-png", "-singlefile", pdfPath, pngStem], {
          env,
          encoding: "utf-8",
          timeout: 30_000,
        });
        if (r2.status === 0) pngPath = pngStem + ".png";
      }

      for (const ext of [".aux", ".out"]) {
        try { unlinkSync(join(texDir, stem + ext)); } catch { /* file may not exist */ }
      }

      const relPdf = relativePath(projectDir, pdfPath);
      const relPng = pngPath ? relativePath(projectDir, pngPath) : undefined;
      const msg = relPng
        ? `Compiled: ${relPdf}\nPreview: ${relPng} (Read it to inspect visually)`
        : `Compiled: ${relPdf}`;
      return ok(msg, { pdfPath, pngPath });
    },
  };
}

export function createExtractPdfFiguresTool(projectDir: string) {
  return {
    name: "extract_pdf_figures",
    label: "Extract PDF Figures",
    description:
      "Rasterize every page of a PDF to PNGs (for learning figure style from " +
      "related papers). Returns paths to all produced PNGs. Uses pdftoppm.",
    parameters: Type.Object({
      pdfPath: Type.String({
        description: "Relative path to the PDF within the project.",
      }),
      outDir: Type.String({
        description: "Relative path to directory for output PNGs (created if missing).",
      }),
      dpi: Type.Optional(Type.Number({
        description: "DPI. Default 150 (reasonable for style inspection).",
      })),
      prefix: Type.Optional(Type.String({
        description: "Output filename prefix. Default: PDF stem.",
      })),
    }),
    async execute(
      _toolCallId: string,
      params: { pdfPath: string; outDir: string; dpi?: number; prefix?: string },
    ) {
      const pdfAbs = resolveInProject(projectDir, params.pdfPath);
      const outAbs = resolveInProject(projectDir, params.outDir);
      if (!existsSync(pdfAbs)) {
        return fail(`PDF not found: ${params.pdfPath}`);
      }
      mkdirSync(outAbs, { recursive: true });

      const dpi = params.dpi ?? 150;
      const prefix = params.prefix ?? basename(pdfAbs, ".pdf");
      const stemAbs = join(outAbs, prefix);

      // Snapshot existing files so we only report newly-produced PNGs
      // (avoids stale-file contamination from prior runs with the same prefix).
      const preexisting = new Set(
        readdirSync(outAbs).filter(f => f.startsWith(prefix) && f.endsWith(".png"))
      );

      const r = spawnSync("pdftoppm", ["-r", String(dpi), "-png", pdfAbs, stemAbs], {
        env: getTexEnv(),
        encoding: "utf-8",
        timeout: 120_000,
      });
      if (r.status !== 0) {
        return fail(`pdftoppm failed: ${r.stderr}`);
      }

      const pngs = readdirSync(outAbs)
        .filter(f => f.startsWith(prefix) && f.endsWith(".png") && !preexisting.has(f))
        .sort()
        .map(f => join(params.outDir, f));

      return ok(
        `Extracted ${pngs.length} page(s):\n${pngs.map(p => "  - " + p).join("\n")}`,
        { paths: pngs },
      );
    },
  };
}

export function createFigureGenTools(projectDir: string) {
  return [
    createGenerateRasterComponentTool(projectDir),
    createCompileTikzTool(projectDir),
    createExtractPdfFiguresTool(projectDir),
  ];
}
