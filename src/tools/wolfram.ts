/**
 * Wolfram Alpha tool — symbolic computation via the Wolfram Alpha API.
 *
 * Requires WOLFRAM_APP_ID environment variable (free at https://developer.wolframalpha.com/).
 * Falls back to the Short Answers API if Full Results is unavailable.
 */

import { Type } from "@sinclair/typebox";

const WolframParams = Type.Object({
  query: Type.String({
    description:
      "Natural language or Mathematica-style query. Examples: " +
      '"integrate x^2 exp(-x^2) dx from 0 to infinity", ' +
      '"solve x^3 - 6x^2 + 11x - 6 = 0", ' +
      '"taylor series of sin(x)/x at x=0 to order 8", ' +
      '"simplify (1-cos(2x))/(2 sin(x)^2)", ' +
      '"dimensions of hbar^2 / (m * a0^2)"',
  }),
});

export function createWolframTool() {
  return {
    name: "wolfram",
    label: "Wolfram Alpha",
    description:
      "Query Wolfram Alpha for symbolic math: integrals, series, simplification, equation solving, " +
      "unit analysis, limits, differential equations, linear algebra, etc. " +
      "Use natural language or Mathematica syntax. Returns the computed result.",
    parameters: WolframParams,

    async execute(
      _toolCallId: string,
      params: { query: string },
    ) {
      const appId = process.env.WOLFRAM_APP_ID;

      if (!appId) {
        // No API key — fall back to using Python/sympy via bash
        return {
          content: [{
            type: "text" as const,
            text: "WOLFRAM_APP_ID not set. Use bash + Python/sympy for symbolic computation instead:\n" +
              "```bash\npython3 -c \"from sympy import *; x = symbols('x'); print(integrate(x**2 * exp(-x**2), (x, 0, oo)))\"\n```",
          }],
          details: { success: false, reason: "no_api_key" },
        };
      }

      try {
        // Try Full Results API first (richer output)
        const fullUrl = `https://api.wolframalpha.com/v2/query?input=${encodeURIComponent(params.query)}&appid=${appId}&output=json&podstate=Step-by-step+solution`;
        const fullResp = await fetch(fullUrl, { signal: AbortSignal.timeout(30_000) });

        if (fullResp.ok) {
          const data = await fullResp.json() as any;
          if (data.queryresult?.success) {
            const pods = data.queryresult.pods ?? [];
            const results: string[] = [];

            for (const pod of pods) {
              const title = pod.title;
              const subpods = pod.subpods ?? [];
              for (const sub of subpods) {
                const text = sub.plaintext;
                if (text) {
                  results.push(`**${title}:**\n${text}`);
                }
              }
            }

            if (results.length > 0) {
              return {
                content: [{ type: "text" as const, text: results.join("\n\n") }],
                details: { success: true, api: "full" },
              };
            }
          }
        }

        // Fall back to Short Answers API (simpler, more reliable)
        const shortUrl = `https://api.wolframalpha.com/v1/result?i=${encodeURIComponent(params.query)}&appid=${appId}`;
        const shortResp = await fetch(shortUrl, { signal: AbortSignal.timeout(15_000) });

        if (shortResp.ok) {
          const text = await shortResp.text();
          return {
            content: [{ type: "text" as const, text: `**Result:** ${text}` }],
            details: { success: true, api: "short" },
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Wolfram Alpha could not compute: "${params.query}". HTTP ${shortResp.status}. Try rephrasing or use Python/sympy via bash.`,
          }],
          details: { success: false, status: shortResp.status },
        };

      } catch (err: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Wolfram Alpha request failed: ${err.message}. Use Python/sympy via bash as fallback.`,
          }],
          details: { success: false, error: err.message },
        };
      }
    },
  };
}
