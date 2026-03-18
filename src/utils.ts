/**
 * Shared utility functions used across multiple modules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasTexFiles(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith(".tex"));
  } catch {
    return false;
  }
}

export function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...listFilesRecursive(full));
      else results.push(full);
    }
  } catch {}
  return results;
}

export function readFileSafe(path: string, fallback = ""): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return fallback;
  }
}
