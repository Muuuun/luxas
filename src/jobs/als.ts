/**
 * AsyncLocalStorage carrying owner identity through to the bash tool. Every
 * agent entry point (brain agent.prompt; in-process spawnAgent; detached
 * subagent-runner) wraps its run in `jobOwnerAls.run(ctx, …)` so any bash
 * call inside the loop tags its job record with the right `ownerAgentId`.
 *
 * If a bash call fires outside any wrapped entry point, `getStore()` returns
 * undefined and the registry falls back to "unknown" — better than crashing,
 * but every production path should be wrapped.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface JobOwnerContext {
  agentId: string;
  agentType: string;
  projectDir: string;
}

export const jobOwnerAls = new AsyncLocalStorage<JobOwnerContext>();

export function currentJobOwner(): JobOwnerContext | undefined {
  return jobOwnerAls.getStore();
}
