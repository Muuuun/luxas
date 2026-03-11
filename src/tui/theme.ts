/**
 * Semantic color theme — inspired by Claude Code's theming system.
 *
 * Uses semantic names instead of hardcoded colors.
 * Supports shimmer variants for breathing animations.
 */

export interface Theme {
  // Brand
  brand: string;
  brandShimmer: string;

  // Semantic
  success: string;
  error: string;
  warning: string;
  text: string;
  subtle: string;
  inactive: string;
  suggestion: string;

  // UI elements
  border: string;
  borderActive: string;
  borderShimmer: string;

  // Rate limit bar
  rateFill: string;
  rateEmpty: string;

  // Modes
  brainClaude: string;
  brainCodex: string;
}

export const dark: Theme = {
  brand: "#d77757",        // rgb(215,119,87) — Claude warm orange
  brandShimmer: "#eb9f7f",  // rgb(235,159,127)

  success: "#4eba65",       // rgb(78,186,101)
  error: "#ff6b80",         // rgb(255,107,128)
  warning: "#ffc107",       // rgb(255,193,7)
  text: "#ffffff",
  subtle: "#505050",        // rgb(80,80,80)
  inactive: "#999999",      // rgb(153,153,153)
  suggestion: "#b1b9f9",    // rgb(177,185,249)

  border: "#888888",
  borderActive: "#b1b9f9",  // permission blue
  borderShimmer: "#d1d7ff",

  rateFill: "#b1b9f9",
  rateEmpty: "#505370",     // rgb(80,83,112)

  brainClaude: "#d77757",
  brainCodex: "#af87ff",    // purple for codex
};

/** Icon set — matches Claude Code's semantic icons */
export const icons = {
  toolUse: "✻",         // tool in progress
  dot: "∙",             // separator
  interrupt: "↯",       // interrupted
  empty: "○",           // not started
  half: "◐",            // in progress
  full: "●",            // completed/active
  active: "◉",          // selected/active
  retry: "↻",           // retry/loop
  success: "·✔︎·",      // success confirmed
  fail: "×",            // failure
  record: "⏺",         // running indicator
};

/** Spinner frames — Claude Code style */
export const spinnerFrames = ["·|·", "·/·", "·—·", "·\\·"];

/** Format token count for display */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `~${(n / 1_000).toFixed(1)}k`;
  return `~${n}`;
}

/** Format cost for display */
export function formatCost(usd: number): string {
  return usd > 0.5 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

/** Format elapsed time */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}
