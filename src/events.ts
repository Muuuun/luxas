/**
 * Event bus — decouples conductor/brain/terminal from rendering.
 *
 * In CLI mode, events go to console. In TUI mode, events drive the UI.
 * The conductor, brain, and terminal emit events; the renderer consumes them.
 */

import { EventEmitter } from "node:events";

// ── Event types ──────────────────────────────────────────────

export interface LogEvent {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface StepEvent {
  step: number;
  globalStep: number;
  maxSteps: number;
}

export interface BrainEvent {
  status: "thinking" | "decided" | "error";
  elapsed: number;
  thought?: string;
  reason?: string;
  taskCount?: number;
}

export interface TaskEvent {
  id: number;
  action: string;
  tool: string;
  model: string;
  status: "running" | "done" | "failed";
  elapsed: number;
  lastLine: string;
  outputLen: number;
}

export interface ActionEvent {
  action: string;
  result: "success" | "partial" | "failed";
  details: string;
  timestamp: number;
}

export interface UsageEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface RateLimitEvent {
  utilization: number;
  resetsAt: number;
  isUsingOverage: boolean;
}

// ── Typed emitter ────────────────────────────────────────────

export interface SisyphusEvents {
  log: [LogEvent];
  step: [StepEvent];
  brain: [BrainEvent];
  task: [TaskEvent];
  action: [ActionEvent];
  usage: [UsageEvent];
  "rate-limit": [RateLimitEvent];
  "state-change": [];
  done: [{ reason: string }];
  paused: [{ reason: string }];
}

class SisyphusEmitter extends EventEmitter {
  emitLog(level: LogEvent["level"], message: string): void {
    this.emit("log", { level, message, timestamp: Date.now() } satisfies LogEvent);
  }
  emitStep(step: number, globalStep: number, maxSteps: number): void {
    this.emit("step", { step, globalStep, maxSteps } satisfies StepEvent);
  }
  emitBrain(event: BrainEvent): void {
    this.emit("brain", event);
  }
  emitTask(event: TaskEvent): void {
    this.emit("task", event);
  }
  emitAction(event: ActionEvent): void {
    this.emit("action", event);
  }
  emitUsage(event: UsageEvent): void {
    this.emit("usage", event);
  }
  emitRateLimit(event: RateLimitEvent): void {
    this.emit("rate-limit", event);
  }
  emitStateChange(): void {
    this.emit("state-change");
  }
}

// ── Singleton ────────────────────────────────────────────────

export const bus = new SisyphusEmitter();
bus.setMaxListeners(50);

/** Whether the TUI is active (suppresses console output in conductor/brain/terminal) */
export let tuiActive = false;

export function enableTUI(): void {
  tuiActive = true;
}

// Default console handler for non-TUI mode
bus.on("log", (event: LogEvent) => {
  if (tuiActive) return;
  if (event.level === "error") console.error(event.message);
  else if (event.level === "warn") console.warn(event.message);
  else console.log(event.message);
});
