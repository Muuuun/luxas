// Worker for scripts/smoke_active_agents_lock.mts. Spawned once per test
// agent; calls markDone and exits. Kept as a static file (not inlined into
// the smoke test's fixture dir) so it stays typecheckable and diffable.
import { markDone } from "../../src/active-agents.js";

const [root, agentId, i] = process.argv.slice(2);
if (!root || !agentId || i === undefined) {
  console.error("Usage: mark-done-worker.mts <projectDir> <agentId> <index>");
  process.exit(2);
}
markDone(root, agentId, "result-" + i);
