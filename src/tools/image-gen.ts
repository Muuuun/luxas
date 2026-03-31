/**
 * Image generation tool — generates illustrations via Google Gemini's image generation.
 *
 * Uses Gemini 2.0 Flash (or Imagen 3) to generate scientific diagrams and
 * schematic figures from detailed text prompts.
 *
 * Requires GEMINI_API_KEY environment variable.
 * Free tier: 1500 requests/day for Gemini Flash.
 */

import { Type } from "@sinclair/typebox";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ImageGenParams = Type.Object({
  prompt: Type.String({
    description:
      "Detailed image generation prompt. Be extremely specific about:\n" +
      "- Layout and composition (what goes where)\n" +
      "- Colors, labels, and annotations\n" +
      "- Style (schematic diagram, physics illustration, flowchart, etc.)\n" +
      "- What to include and what to exclude\n" +
      "Example: 'Scientific schematic diagram showing a single atom trapped in a focused Gaussian laser beam (optical tweezer). Show the intensity profile as a red gradient, the atom as a blue sphere at the focus, and label the beam waist w0, Rayleigh range zR, and trap depth U0. Clean white background, publication-quality style.'",
  }),
  filename: Type.String({
    description: "Output filename (without path). Will be saved to report/figures/. Example: 'tweezer_schematic.png'",
  }),
  style: Type.Optional(Type.String({
    description: "Image style hint: 'schematic', 'diagram', 'illustration', 'plot', 'flowchart'. Default: 'schematic'",
  })),
  aspectRatio: Type.Optional(Type.String({
    description: "Aspect ratio: '1:1', '16:9', '4:3', '3:4'. Default: '16:9' (good for paper figures)",
  })),
});

export function createImageGenTool(projectDir: string) {
  return {
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate a scientific illustration, schematic diagram, or figure using AI image generation (Google Gemini). " +
      "Write a detailed, specific prompt describing exactly what the figure should show. " +
      "The image is saved to report/figures/. Use for: conceptual diagrams, experimental setups, " +
      "energy level diagrams, flowcharts, comparison schematics — anything that helps the reader understand the physics.",
    parameters: ImageGenParams,

    async execute(
      _toolCallId: string,
      params: { prompt: string; filename: string; style?: string; aspectRatio?: string },
    ) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text" as const, text: "GEMINI_API_KEY not set. Cannot generate images. Set the env var and retry." }],
          details: { success: false },
        };
      }

      const style = params.style ?? "schematic";
      const aspectRatio = params.aspectRatio ?? "16:9";

      // Enhance prompt with style guidance for scientific figures
      const enhancedPrompt = [
        `Scientific ${style} for a physics research paper.`,
        params.prompt,
        `Style requirements: clean, publication-quality, white or light background, `,
        `clear labels and annotations, no watermarks, no text artifacts. `,
        `Suitable for inclusion in a Physical Review journal article.`,
      ].join(" ");

      try {
        // Use Gemini 2.0 Flash image generation
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: enhancedPrompt }],
              }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                responseMimeType: "text/plain",
              },
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );

        if (!resp.ok) {
          const err = await resp.text();
          // Try Imagen 3 as fallback
          return await tryImagen3(apiKey, enhancedPrompt, params.filename, projectDir, aspectRatio, err);
        }

        const data = await resp.json() as any;
        const parts = data.candidates?.[0]?.content?.parts ?? [];

        // Find the image part
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith("image/")) {
            const imgBuffer = Buffer.from(part.inlineData.data, "base64");
            const outPath = join(projectDir, "report", "figures", params.filename);
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, imgBuffer);

            return {
              content: [{ type: "text" as const, text: `Image saved to report/figures/${params.filename} (${(imgBuffer.length / 1024).toFixed(0)} KB)` }],
              details: { success: true, path: outPath, engine: "gemini-flash" },
            };
          }
        }

        // No image in response — try Imagen 3
        return await tryImagen3(apiKey, enhancedPrompt, params.filename, projectDir, aspectRatio, "Gemini Flash returned no image");

      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Image generation failed: ${err.message}` }],
          details: { success: false },
        };
      }
    },
  };
}

/**
 * Fallback: Imagen 3 via Vertex AI-style endpoint.
 */
async function tryImagen3(
  apiKey: string,
  prompt: string,
  filename: string,
  projectDir: string,
  aspectRatio: string,
  previousError: string,
): Promise<{ content: any[]; details: any }> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!resp.ok) {
      const err = await resp.text();
      return {
        content: [{ type: "text" as const, text: `Image generation failed.\nGemini Flash: ${previousError}\nImagen 3: ${err}` }],
        details: { success: false },
      };
    }

    const data = await resp.json() as any;
    const predictions = data.predictions ?? [];
    if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
      const imgBuffer = Buffer.from(predictions[0].bytesBase64Encoded, "base64");
      const outPath = join(projectDir, "report", "figures", filename);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, imgBuffer);

      return {
        content: [{ type: "text" as const, text: `Image saved to report/figures/${filename} (${(imgBuffer.length / 1024).toFixed(0)} KB)` }],
        details: { success: true, path: outPath, engine: "imagen-3" },
      };
    }

    return {
      content: [{ type: "text" as const, text: `Image generation returned no image.\nGemini Flash: ${previousError}\nImagen 3: empty response` }],
      details: { success: false },
    };

  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Image generation failed.\nGemini Flash: ${previousError}\nImagen 3: ${err.message}` }],
      details: { success: false },
    };
  }
}
