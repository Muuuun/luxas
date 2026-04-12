/**
 * Lightweight extension system for Luxas.
 *
 * #8: Extension system (inspired by pi-coding-agent's full extension model,
 * simplified for research agent needs)
 *
 * Extensions subscribe to lifecycle events and can react to them.
 * This replaces hardcoded event handling scattered across files.
 */

export type LuxasEvent =
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
  | { type: "micro_compaction"; charsFreed: number }
  // Experiment
  | { type: "experiment_start"; hypothesis: string }
  | { type: "experiment_end"; hypothesis: string; success: boolean; elapsed: number }
  // PI review
  | { type: "pi_feedback"; verdict: string; feedback: string }
  // Resource
  | { type: "cost_warning"; currentCost: number; maxCost: number }
  | { type: "usage_update"; cost: number; inputTokens: number; outputTokens: number }
  // Tool failures (structured observability)
  | { type: "tool_failure"; tool: string; errorCategory: string; errorMessage: string; args: any }
  // Notes compaction
  | { type: "notes_compaction"; files: string[]; savings: Record<string, { before: number; after: number }> }
  // Planning phase
  | { type: "plan_created"; path: string }
  | { type: "plan_reviewed"; verdict: string; feedback: string }
  // Methodology extraction (auto-dispatched after arXiv download)
  | { type: "methodology_worker_done"; paperId: string; success: boolean; elapsedMs: number; summary: string }
  | { type: "methodology_worker_failed"; paperId: string; error: string };

export type ExtensionHandler<E extends LuxasEvent = LuxasEvent> =
  (event: E) => Promise<void> | void;

export class ExtensionBus {
  private handlers = new Map<string, Set<ExtensionHandler<any>>>();

  on<T extends LuxasEvent["type"]>(
    event: T,
    handler: ExtensionHandler<Extract<LuxasEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  async emit(event: LuxasEvent): Promise<void> {
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
