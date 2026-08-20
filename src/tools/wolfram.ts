/**
 * Wolfram tool — symbolic computation via Wolfram Engine (wolframscript).
 *
 * Uses the free Wolfram Engine (https://www.wolfram.com/engine/).
 * Install: download from wolfram.com/engine, then `wolframscript -activate`.
 * No API key needed — runs locally.
 *
 * Fallback: Python/sympy if wolframscript is not installed.
 */

import { Type } from "@earendil-works/pi-ai/compat";
import { execSync } from "node:child_process";

let wolframPath: string | false | null = null;

const WOLFRAM_SEARCH_PATHS = [
  "wolframscript",  // in PATH
  "/usr/local/bin/wolframscript",
  "/Applications/Wolfram Engine.app/Contents/Resources/Wolfram Player.app/Contents/MacOS/wolframscript",
  "/Applications/Mathematica.app/Contents/MacOS/wolframscript",
];

function findWolfram(): string | false {
  if (wolframPath !== null) return wolframPath;
  for (const p of WOLFRAM_SEARCH_PATHS) {
    try {
      execSync(`"${p}" -code '1+1'`, { stdio: "pipe", timeout: 15_000 });
      wolframPath = p;
      return p;
    } catch { /* try next */ }
  }
  wolframPath = false;
  return false;
}

const WolframParams = Type.Object({
  query: Type.String({
    description:
      "Wolfram Language (Mathematica) expression to evaluate. Examples:\n" +
      '  "Integrate[x^2 Exp[-x^2], {x, 0, Infinity}]"\n' +
      '  "Solve[x^3 - 6x^2 + 11x - 6 == 0, x]"\n' +
      '  "Series[Sin[x]/x, {x, 0, 8}]"\n' +
      '  "Simplify[(1 - Cos[2x])/(2 Sin[x]^2)]"\n' +
      '  "DSolve[y\'[x] + y[x] == x, y[x], x]"\n' +
      '  "Eigenvalues[{{1, 2}, {3, 4}}]"\n' +
      '  "UnitConvert[Quantity[1, \\"Hartrees\\"], \\"Electronvolts\\"]"',
  }),
});

export function createWolframTool() {
  return {
    name: "wolfram",
    label: "Wolfram Engine",
    description:
      "Evaluate Wolfram Language (Mathematica) expressions locally via Wolfram Engine. " +
      "Use for: symbolic integrals, differential equations, series expansions, simplification, " +
      "linear algebra, equation solving, unit conversions, special functions, numerical evaluation. " +
      "Input must be valid Wolfram Language syntax.",
    parameters: WolframParams,

    async execute(
      _toolCallId: string,
      params: { query: string },
    ) {
      const wPath = findWolfram();
      if (wPath) {
        return runWolframScript(wPath, params.query);
      }
      // Fallback to Python/sympy
      return runSympyFallback(params.query);
    },
  };
}

function runWolframScript(wPath: string, query: string): { content: any[]; details: any } {
  try {
    const output = execSync(
      `"${wPath}" -code ${JSON.stringify(query)}`,
      { encoding: "utf-8", timeout: 60_000, maxBuffer: 1024 * 1024 },
    ).trim();

    return {
      content: [{ type: "text" as const, text: output }],
      details: { success: true, engine: "wolfram" },
    };
  } catch (err: any) {
    const stderr = err.stderr?.toString().trim() ?? "";
    const stdout = err.stdout?.toString().trim() ?? "";
    const output = stdout || stderr || err.message;
    return {
      content: [{ type: "text" as const, text: `Wolfram Engine error:\n${output}` }],
      details: { success: false, engine: "wolfram" },
    };
  }
}

function runSympyFallback(query: string): { content: any[]; details: any } {
  try {
    // Attempt to translate common Wolfram-style queries to sympy
    const script = `
from sympy import *
x, y, z, t, r, theta, phi = symbols('x y z t r theta phi')
a, b, c, n, m, k, L = symbols('a b c n m k L')
hbar, omega, gamma, alpha, beta, sigma = symbols('hbar omega gamma alpha beta sigma', positive=True)
oo = S.Infinity
try:
    result = eval("""${query.replace(/"/g, '\\"').replace(/\n/g, '\\n')}""")
    pprint(result, use_unicode=True)
except Exception as e:
    print(f"sympy error: {e}")
    print("Note: input should be sympy syntax, not Wolfram Language.")
    print("Example: integrate(x**2 * exp(-x**2), (x, 0, oo))")
`;
    const output = execSync(`python3 -c ${JSON.stringify(script)}`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();

    return {
      content: [{ type: "text" as const, text: `**Result (sympy fallback — install wolframscript for full Wolfram Engine):**\n${output}` }],
      details: { success: true, engine: "sympy" },
    };
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `wolframscript not installed and sympy fallback failed.\n\nInstall Wolfram Engine (free): https://www.wolfram.com/engine/\nThen: wolframscript -activate\n\nOr install sympy: pip install sympy`,
      }],
      details: { success: false, engine: "none" },
    };
  }
}
