/**
 * smoke_active_agents_lock — verify withRegistryLock serializes concurrent
 * markDone / markFailed / addAgent calls so no update is lost.
 *
 *   npx tsx scripts/smoke_active_agents_lock.mts
 *
 * Before the lock: two sub-agents finishing simultaneously both read the old
 * registry, both write their own update, last-writer wins → one update
 * vanishes. With the lock: all updates land. This test proves the invariant
 * by spawning 20 concurrent markDone calls via worker threads (true OS-level
 * concurrency — in-process Promise.all doesn't actually race because Node's
 * main thread is single-threaded).
 */

import { mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { addAgent, loadRegistry } from "../src/active-agents.js";

const root = join(tmpdir(), `luxas-lock-smoke-${Date.now()}`);
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
mkdirSync(root, { recursive: true });

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const N = 20;

// Seed the registry with N agents in "running" state.
console.log(`1. seeding ${N} running agents`);
for (let i = 0; i < N; i++) {
  addAgent(root, {
    id: `test.agent-${i}`,
    name: "test",
    task: `task ${i}`,
    mode: "background",
    startedAt: Date.now(),
    conversationFile: "",
    status: "running",
  });
}
const seeded = loadRegistry(root);
check(`${N} agents seeded`, seeded.length === N, `got ${seeded.length}`);
check("all are running initially", seeded.every(a => a.status === "running"));

// Spawn N child processes, each calls markDone once. Separate Node processes
// → true concurrent access to the file system. Without the lock, the
// registry would lose updates under this load.
console.log(`\n2. spawning ${N} concurrent markDone subprocesses`);

const LUXAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerScript = join(LUXAS_ROOT, "scripts/test-helpers/mark-done-worker.mts");
const tsx = join(LUXAS_ROOT, "node_modules/.bin/tsx");

async function runWorker(agentId: string, i: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(tsx, [workerScript, root, agentId, String(i)], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("exit", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: `exit ${code}: ${stderr.slice(0, 200)}` });
    });
    child.on("error", (err) => resolve({ ok: false, error: String(err) }));
  });
}

const results = await Promise.all(Array.from({ length: N }, (_, i) => runWorker(`test.agent-${i}`, i)));
check(`all ${N} workers succeeded`, results.every(r => r.ok),
  `failures: ${results.filter(r => !r.ok).map(r => r.error).slice(0, 3).join(" | ")}`);

// Assert: all N agents are now "done" with unique result strings.
console.log(`\n3. verifying registry state after concurrent writes`);
const final = loadRegistry(root);
check(`registry still has ${N} agents`, final.length === N, `got ${final.length}`);
const doneCount = final.filter(a => a.status === "done").length;
check(`all ${N} are marked done (no lost updates)`, doneCount === N, `only ${doneCount} done`);
const resultSet = new Set(final.map(a => a.result));
check(`${N} distinct result strings present`, resultSet.size === N, `distinct: ${resultSet.size}`);

console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
