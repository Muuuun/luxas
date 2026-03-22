/**
 * Tmux observability — manages windows and provides agent event observer.
 */

import { execSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SESSION = "sisyphus";
const LOG_DIR = "/tmp/sisyphus";

let available: boolean | null = null;

export function ensureSession(): boolean {
  if (available !== null) return available;
  try {
    execSync("which tmux", { stdio: "pipe" });
  } catch {
    available = false;
    return false;
  }
  try {
    execSync(`tmux has-session -t ${SESSION} 2>/dev/null`, { stdio: "pipe" });
  } catch {
    try {
      execSync(`tmux new-session -d -s ${SESSION} -n overview`, { stdio: "pipe" });
    } catch {
      available = false;
      return false;
    }
  }
  mkdirSync(LOG_DIR, { recursive: true });
  available = true;
  return true;
}

let windowCounter = 0;

export function openWindow(label: string): string | null {
  if (!ensureSession()) return null;
  const id = windowCounter++;
  const logFile = join(LOG_DIR, `task_${id}.log`);
  const winName = `${id}_${label.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20)}`;
  try {
    const header = [
      `╔══ ${label} ══╗`,
      `║ started: ${new Date().toLocaleTimeString()}`,
      `╚${"═".repeat(40)}╝`,
      "",
    ].join("\n");
    writeFileSync(logFile, header);
    execSync(`tmux new-window -t ${SESSION} -n "${winName}" "tail -f ${logFile}"`, { stdio: "pipe" });
    return logFile;
  } catch {
    return null;
  }
}

export function log(logFile: string | null, line: string): void {
  if (!logFile) return;
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  try { appendFileSync(logFile, `[${ts}] ${line}\n`); } catch {}
}

export function closeWindow(logFile: string | null, label: string, success: boolean, elapsedMs: number): void {
  if (!logFile || !ensureSession()) return;
  const winName = logFile.split("/").pop()?.replace(".log", "") ?? "";
  const prefix = success ? "✓" : "✗";
  const el = Math.floor(elapsedMs / 1000);
  log(logFile, `\n${prefix} Done in ${el}s`);
  try {
    // Find window by searching for our log file
    execSync(`tmux rename-window -t "${SESSION}:${winName}" "${prefix}${el}s_${label.slice(0, 15)}" 2>/dev/null`, { stdio: "pipe" });
  } catch {}
}

/**
 * Create an agent event observer that logs to a tmux window.
 * Usage: agent.subscribe(createAgentObserver(logFile))
 */
export function createAgentObserver(logFile: string | null): (event: any) => void {
  return (event: any) => {
    if (!logFile) return;

    if (event.type === "tool_execution_start") {
      const argsPreview = event.args ? JSON.stringify(event.args).slice(0, 200) : "";
      log(logFile, `✻ ${event.toolName} ${argsPreview}`);
    }
    if (event.type === "tool_execution_end") {
      const preview = String(event.result ?? "").slice(0, 120).replace(/\n/g, " ");
      log(logFile, `  ${event.isError ? "✗" : "→"} ${event.toolName}: ${preview}`);
    }
    if (event.type === "message_update") {
      const msg = event.assistantMessageEvent;
      if (msg?.type === "text" && msg.text) {
        const line = msg.text.trim().split("\n").pop()?.slice(0, 80);
        if (line && line.length > 3) log(logFile, `💬 ${line}`);
      }
    }
    if (event.type === "turn_end") {
      log(logFile, `  [turn complete]`);
    }
    if (event.type === "agent_end") {
      log(logFile, `\n✓ Agent finished`);
    }
  };
}

export function sessionName(): string { return SESSION; }
