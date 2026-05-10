#!/usr/bin/env tsx
/**
 * smoke_atomic_counter — verify bumpRunCounter is atomic under concurrent
 * invocations. Spawns N parallel child processes that each call
 * bumpRunCounter() once. Final counter value MUST equal N. Pre-fix it was
 * frequently < N due to read-modify-write races (concurrent processes
 * both reading the same value and both writing value+1, losing
 * increments).
 *
 * Uses a temporary HOME-overridden state dir so the test doesn't disturb
 * the real ~/.sisyphus state.
 */
import { spawnSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "smoke-atomic-counter-"));
const sisyphusRoot = process.cwd();
const child = `
import { bumpRunCounter } from "${sisyphusRoot}/src/meta-agents/state.ts";
const n = bumpRunCounter();
console.log(n);
`;
const childScript = join(tmpHome, "bump.mts");
writeFileSync(childScript, child);

const N = 20;
console.log(`Spawning ${N} concurrent bumpRunCounter() invocations against HOME=${tmpHome}`);

// Spawn all N children in parallel using shell &-backgrounding then wait.
// Each gets HOME pointed at our tmp so they share a single counter file.
const cmd = `
HOME='${tmpHome}'
for i in $(seq 1 ${N}); do
  ${sisyphusRoot}/node_modules/.bin/tsx '${childScript}' &
done
wait
`;
const start = Date.now();
const r = spawnSync("bash", ["-c", cmd], { encoding: "utf-8" });
const elapsed = Date.now() - start;

const counterPath = join(tmpHome, ".sisyphus/reflect-state/run_counter");
const finalCounter = existsSync(counterPath)
  ? Number(readFileSync(counterPath, "utf-8").trim())
  : -1;

console.log(`Elapsed: ${elapsed}ms; final counter = ${finalCounter} (expected ${N})`);
console.log(`Children stdout (each child printed its returned value):`);
const returnedValues = (r.stdout ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(Number);
returnedValues.sort((a, b) => a - b);
console.log(`  returned: [${returnedValues.join(", ")}]`);

// Assertions:
// 1. Final counter equals N (no lost increments).
// 2. All returned values are unique 1..N (each child got a distinct number).
let ok = true;
if (finalCounter !== N) {
  console.error(`FAIL: counter=${finalCounter} != ${N} — lost ${N - finalCounter} increments`);
  ok = false;
}
const expected = Array.from({ length: N }, (_, i) => i + 1).join(",");
const got = returnedValues.join(",");
if (got !== expected) {
  console.error(`FAIL: returned values not unique 1..${N}; got [${got}] expected [${expected}]`);
  ok = false;
}

// Cleanup
rmSync(tmpHome, { recursive: true, force: true });

if (!ok) {
  console.error(`\nSTDERR from children (last 500 chars):\n${(r.stderr ?? "").slice(-500)}`);
  process.exit(1);
}
console.log(`\nOK: ${N} concurrent bumps; counter=${N}; all return values distinct.`);
