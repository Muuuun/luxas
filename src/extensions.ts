/**
 * Lightweight extension system for Sisyphus.
 *
 * #8: Extension system (inspired by pi-coding-agent's full extension model,
 * simplified for research agent needs)
 *
 * Extensions subscribe to lifecycle events and can react to them.
 * This replaces hardcoded event handling scattered across files.
 */

export type SisyphusEvent =
  // Session lifecycle
  | { type: "session_start" }
  | { type: "session_end"; cost: number; tokens: number; elapsed: number }
  // Turn lifecycle
  | { type: "turn_start" }
  | { type: "turn_end"; message: any; toolCalls: number }
  // Compaction
  | { type: "before_compaction"; messages: any[]; tokenCount: number }
  | { type: "after_compaction"; summary: string; droppedCount: number }
  | { type: "memory_warning"; tokenCount: number; threshold: number }
  // Experiment
  | { type: "experiment_start"; hypothesis: string }
  | { type: "experiment_end"; hypothesis: string; success: boolean; elapsed: number }
  // PI review
  | { type: "pi_feedback"; verdict: string; feedback: string }
  // Resource
  | { type: "cost_warning"; currentCost: number; maxCost: number }
  | { type: "usage_update"; cost: number; inputTokens: number; outputTokens: number };

export type ExtensionHandler<E extends SisyphusEvent = SisyphusEvent> =
  (event: E) => Promise<void> | void;

export class ExtensionBus {
  private handlers = new Map<string, Set<ExtensionHandler<any>>>();

  on<T extends SisyphusEvent["type"]>(
    event: T,
    handler: ExtensionHandler<Extract<SisyphusEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  async emit(event: SisyphusEvent): Promise<void> {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of set) {
      try {
        await handler(event);
      } catch (err) {
        // Extensions should not crash the agent
        process.stderr.write(`[extension error] ${event.type}: ${err}\n`);
      }
    }
  }
}
