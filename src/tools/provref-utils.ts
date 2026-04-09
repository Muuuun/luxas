/**
 * Shared provref CLI utilities — used by both init-report.ts and report.ts.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Cached provref CLI command. undefined = not yet resolved; null = not available. */
let cachedProvrefCmd: string | null | undefined;

export function resolveProvrefCmd(projectDir: string): string | null {
  if (cachedProvrefCmd !== undefined) return cachedProvrefCmd;

  try {
    execSync("provref --version", { stdio: "pipe", timeout: 5_000 });
    cachedProvrefCmd = "provref";
    return cachedProvrefCmd;
  } catch {}

  const localBin = join(projectDir, "..", "provref", "bin", "provref.mjs");
  if (existsSync(localBin)) {
    cachedProvrefCmd = `node "${localBin}"`;
    return cachedProvrefCmd;
  }

  cachedProvrefCmd = null;
  return null;
}

export function mergeRunsOrStub(provrefCmd: string, runsDir: string, allResultsPath: string): void {
  try {
    execSync(`${provrefCmd} merge "${runsDir}" --output "${allResultsPath}"`, {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    if (!existsSync(allResultsPath)) {
      mkdirSync(runsDir, { recursive: true });
      writeFileSync(allResultsPath, "{}\n");
    }
  }
}
