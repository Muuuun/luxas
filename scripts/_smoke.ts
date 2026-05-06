/**
 * Shared smoke-test helpers. Each smoke script (scripts/smoke_*.mts)
 * historically rolled its own `check(label, cond, detail?)` plus a
 * module-level `let failures = 0`. Hoist the pattern here so new smokes
 * can `import { createCheck } from "./_smoke.js"` instead of copy-pasting.
 *
 * Returns `{ check, summary }`:
 *   - check(label, cond, detail?) — log ✓ / ✗ to stdout, increment counter
 *   - summary() — print "OK" or "FAIL (N)" and exit with the right code
 */
export function createCheck() {
  let failures = 0;
  function check(label: string, cond: boolean, detail?: string): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
  }
  function summary(): never {
    console.log(`\n${failures === 0 ? "OK" : `FAIL (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
  return { check, summary };
}
