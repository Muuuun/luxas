/**
 * Executor — runs tasks via claude -p and codex exec (non-interactive subprocess).
 *
 * Live status panel shows all running tasks with spinners, elapsed time,
 * and last output line — inspired by opencode's TUI.
 */

import { spawn } from "node:child_process";
import type { ToolName, ModelTier } from "./types.js";

/** Map model tier to actual model IDs */
const CLAUDE_MODELS: Record<ModelTier, string> = {
  cheap: "claude-haiku-4-5-20251001",
  fast: "claude-sonnet-4-6",
  think: "claude-opus-4-6",
};

const CODEX_MODELS: Record<ModelTier, string> = {
  cheap: "o4-mini",
  fast: "o4-mini",
  think: "o3",
};

const DEFAULT_TIMEOUT = 600_000; // 10 min

// ============================================================
// ANSI helpers
// ============================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const CLEAR_LINE = "\x1b[2K";
const CURSOR_UP = (n: number) => `\x1b[${n}A`;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

// ============================================================
// Types
// ============================================================

export interface ExecResult {
  output: string;
  success: boolean;
  elapsed: number;
}

interface TaskState {
  id: number;
  action: string;
  tool: ToolName;
  model: ModelTier;
  status: "running" | "done" | "failed";
  startedAt: number;
  lastLine: string;
  outputLen: number;
  elapsed: number;
}

// ============================================================
// Single task execution
// ============================================================

/**
 * Execute a prompt via claude -p (subprocess, not PTY).
 * Prompt is passed via stdin to avoid ARG_MAX limits.
 * Reports progress via onProgress callback for live display.
 */
export function execTask(
  tool: ToolName,
  prompt: string,
  opts: {
    cwd?: string;
    timeout?: number;
    model?: ModelTier;
    onProgress?: (lastLine: string, outputLen: number) => void;
  } = {},
): Promise<ExecResult> {
  const cwd = opts.cwd ?? ".";
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const model = opts.model ?? "fast";
  const t0 = Date.now();

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    if (tool === "claude") {
      const modelId = CLAUDE_MODELS[model];
      cmd = "claude";
      args = ["-p", "--output-format", "stream-json", "--verbose", "--model", modelId, "--dangerously-skip-permissions"];
    } else {
      cmd = "codex";
      args = ["exec", "--full-auto", "-"];
    }

    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderr = "";
    let resultText = "";

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;

      if (tool === "claude" && opts.onProgress) {
        // Parse stream-json events for live status
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            const status = parseStreamEvent(evt);
            if (status) opts.onProgress(status, stdout.length);
            // Capture final result text
            if (evt.type === "result" && evt.result) {
              resultText = evt.result;
            }
          } catch {
            // partial JSON line, ignore
          }
        }
      } else if (opts.onProgress) {
        const lines = chunk.trimEnd().split("\n");
        const last = lines[lines.length - 1].slice(0, 100);
        if (last) opts.onProgress(last, stdout.length);
      }
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
    });

    // Write prompt to stdin
    child.stdin.write(prompt);
    child.stdin.end();

    child.on("close", (code) => {
      const el = Date.now() - t0;
      // For claude stream-json, use parsed result; for codex, use raw stdout
      const output = (tool === "claude" && resultText) ? resultText : (stdout || stderr);
      resolve({
        output,
        success: code === 0 && output.length > 0,
        elapsed: el,
      });
    });

    child.on("error", (err) => {
      const el = Date.now() - t0;
      resolve({
        output: `SPAWN ERROR: ${err.message}`,
        success: false,
        elapsed: el,
      });
    });

    // Handle timeout manually (spawn timeout kills with SIGTERM)
    setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeout);
  });
}

// ============================================================
// Stream event parser — extract status from claude stream-json
// ============================================================

function parseStreamEvent(evt: any): string | null {
  if (!evt || !evt.type) return null;

  // Tool use: show what tool is being called
  if (evt.type === "assistant" && evt.message?.content) {
    for (const part of evt.message.content) {
      if (part.type === "tool_use") {
        const name = part.name || "unknown";
        const input = part.input || {};
        // Extract meaningful info from tool input
        if (name === "Read" && input.file_path) {
          const file = input.file_path.split("/").slice(-2).join("/");
          return `✻ Reading ${file}`;
        }
        if (name === "Write" && input.file_path) {
          const file = input.file_path.split("/").slice(-2).join("/");
          return `✻ Writing ${file}`;
        }
        if (name === "Edit" && input.file_path) {
          const file = input.file_path.split("/").slice(-2).join("/");
          return `✻ Editing ${file}`;
        }
        if (name === "Bash" && input.command) {
          return `✻ Running: ${input.command.slice(0, 60)}`;
        }
        if (name === "Grep" && input.pattern) {
          return `✻ Searching: ${input.pattern.slice(0, 40)}`;
        }
        if (name === "Glob" && input.pattern) {
          return `✻ Finding: ${input.pattern}`;
        }
        if (name === "WebFetch" && input.url) {
          return `✻ Fetching: ${input.url.slice(0, 60)}`;
        }
        return `✻ ${name}`;
      }
      if (part.type === "text" && part.text) {
        // Show first meaningful line of assistant text
        const line = part.text.trim().split("\n")[0].slice(0, 80);
        if (line) return `💬 ${line}`;
      }
      if (part.type === "thinking" && part.thinking) {
        const line = part.thinking.trim().split("\n")[0].slice(0, 80);
        if (line) return `🧠 ${line}`;
      }
    }
  }

  // Rate limit
  if (evt.type === "rate_limit_event") {
    return "⚠ Rate limit check...";
  }

  return null;
}

// ============================================================
// Live Status Panel
// ============================================================

class LivePanel {
  private tasks: TaskState[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private lastLineCount = 0;

  start(tasks: TaskState[]): void {
    this.tasks = tasks;
    this.frame = 0;
    this.lastLineCount = 0;
    process.stderr.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => {
      this.frame++;
      this.render();
    }, 200); // 5 FPS
  }

  update(id: number, updates: Partial<TaskState>): void {
    const task = this.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, updates);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final render
    this.render();
    process.stderr.write(SHOW_CURSOR);
  }

  private render(): void {
    // Move cursor up to overwrite previous panel
    if (this.lastLineCount > 0) {
      process.stderr.write(CURSOR_UP(this.lastLineCount));
    }

    const width = Math.min(process.stderr.columns || 80, 100);
    const lines: string[] = [];
    const running = this.tasks.filter((t) => t.status === "running").length;
    const done = this.tasks.filter((t) => t.status !== "running").length;

    // Header
    lines.push(
      `${CLEAR_LINE}${DIM}┌─${RESET} ${BOLD}${running} running${RESET}` +
      `${DIM} · ${done}/${this.tasks.length} done${RESET}`,
    );

    // Task rows — fixed 2 lines per task (action + status)
    for (const task of this.tasks) {
      const tag = `${DIM}${task.tool}/${task.model}${RESET}`;
      const el = task.status === "running"
        ? elapsed(Date.now() - task.startedAt)
        : elapsed(task.elapsed);

      let icon: string;
      let statusColor: string;
      if (task.status === "running") {
        icon = CYAN + SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length] + RESET;
        statusColor = CYAN;
      } else if (task.status === "done") {
        icon = GREEN + "✓" + RESET;
        statusColor = GREEN;
      } else {
        icon = RED + "✗" + RESET;
        statusColor = RED;
      }

      const actionStr = task.action.padEnd(18);
      const elStr = `${DIM}${el.padStart(6)}${RESET}`;
      const sizeStr = task.outputLen > 0 ? `${DIM}${(task.outputLen / 1024).toFixed(1)}k${RESET}` : "";

      lines.push(
        `${CLEAR_LINE}${DIM}│${RESET} ${icon} ${tag} ${statusColor}${actionStr}${RESET} ${elStr} ${sizeStr}`,
      );

      // Always render status line (fixed height prevents cursor drift)
      const statusLine = task.status === "running" && task.lastLine
        ? task.lastLine.slice(0, width - 10)
        : "";
      lines.push(`${CLEAR_LINE}${DIM}│   ↳ ${statusLine}${RESET}`);
    }

    // Footer
    lines.push(`${CLEAR_LINE}${DIM}└${"─".repeat(Math.min(width - 2, 60))}${RESET}`);

    process.stderr.write(lines.join("\n") + "\n");
    this.lastLineCount = lines.length;
  }
}

// ============================================================
// Session Pool — concurrent subprocess execution
// ============================================================

interface RunningTask {
  id: number;
  tool: ToolName;
  action: string;
  promise: Promise<ExecResult>;
  startedAt: number;
}

export class SessionPool {
  private workingDir: string;
  private nextId = 0;
  private running: RunningTask[] = [];
  private maxConcurrent: number;

  /** Total tasks completed */
  completed = 0;

  constructor(workingDir = ".", maxConcurrent = 8) {
    this.workingDir = workingDir;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Run a single task.
   */
  async run(
    tool: ToolName,
    prompt: string,
    timeout?: number,
  ): Promise<string> {
    const result = await execTask(tool, prompt, {
      cwd: this.workingDir,
      timeout,
    });
    this.completed++;
    return result.output;
  }

  /**
   * Run multiple tasks in parallel with live status panel.
   */
  async runParallel(
    tasks: Array<{ tool: ToolName; prompt: string; action: string; timeout?: number; model?: ModelTier }>,
    onTaskComplete?: (index: number, task: { action: string; tool: ToolName }, result: ExecResult) => void,
  ): Promise<ExecResult[]> {
    const results: ExecResult[] = [];

    // Process in batches of maxConcurrent
    for (let i = 0; i < tasks.length; i += this.maxConcurrent) {
      const batch = tasks.slice(i, i + this.maxConcurrent);

      // Initialize live panel
      const panel = new LivePanel();
      const taskStates: TaskState[] = batch.map((task, idx) => ({
        id: this.nextId + idx,
        action: task.action,
        tool: task.tool,
        model: task.model ?? "fast",
        status: "running" as const,
        startedAt: Date.now(),
        lastLine: "",
        outputLen: 0,
        elapsed: 0,
      }));

      panel.start(taskStates);

      const batchResults = await Promise.all(
        batch.map(async (task, batchIdx) => {
          const id = this.nextId++;
          const taskState = taskStates[batchIdx];

          const result = await execTask(task.tool, task.prompt, {
            cwd: this.workingDir,
            timeout: task.timeout,
            model: task.model,
            onProgress: (lastLine, outputLen) => {
              panel.update(taskState.id, { lastLine, outputLen });
            },
          });

          this.completed++;
          panel.update(taskState.id, {
            status: result.success ? "done" : "failed",
            elapsed: result.elapsed,
            outputLen: result.output.length,
            lastLine: result.success ? "completed" : result.output.slice(0, 80),
          });

          // Notify caller immediately so state can be saved incrementally
          if (onTaskComplete) {
            onTaskComplete(i + batchIdx, task, result);
          }

          return result;
        }),
      );

      panel.stop();

      // Print summary line
      const ok = batchResults.filter((r) => r.success).length;
      const fail = batchResults.length - ok;
      console.log(
        `${GREEN}✓ ${ok} succeeded${RESET}` +
        (fail > 0 ? ` ${RED}✗ ${fail} failed${RESET}` : "") +
        ` ${DIM}(batch ${Math.floor(i / this.maxConcurrent) + 1})${RESET}`,
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Pool stats.
   */
  stats(): { completed: number; maxConcurrent: number } {
    return {
      completed: this.completed,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * No-op for subprocess mode (no persistent sessions to close).
   */
  closeAll(): void {
    console.log(`[pool] Done. ${this.completed} tasks completed.`);
  }
}
