#!/usr/bin/env tsx
/**
 * Smoke: bash command filter blocks write-to-protected-path bypasses.
 *
 * Catches the specific attack the Apr-24 incident exposed: when brain gets
 * PI-STEER to "just run it, fall back, start report", the allowedWriteRoots
 * whitelist blocks `write` + `edit` but bash has no such filter, so the agent
 * reaches for `cat > data/experiments/.../script.py <<'EOF' ... EOF` to bypass.
 *
 * The filter is pattern-based (not a full shell parser), so:
 *   - common write idioms (>, >>, tee, cp, mv, touch, sed -i, open('x','w'),
 *     writeFileSync) ARE caught.
 *   - read-only or non-redirect operations (cat without >, pytest, find,
 *     python3 script.py) are NOT caught — as intended.
 *   - motivated evasion via shell variables / base64 remains possible; the
 *     filter is defense-in-depth, not airtight.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSafetyWrapper, type SafetyWrapper } from "../src/agents/safety-wrappers.js";
import { getDefinition } from "../src/agents/registry.js";

function wrapperFor(name: string): SafetyWrapper {
  const wrap = buildSafetyWrapper(getDefinition(name).safety);
  if (!wrap) throw new Error(`${name}.md must declare safety`);
  return wrap;
}

const dir = mkdtempSync(join(tmpdir(), "smoke-bash-guard-"));
mkdirSync(join(dir, "data/experiments/E_test/scripts"), { recursive: true });
mkdirSync(join(dir, "data/experiments/E_test/tests"), { recursive: true });
mkdirSync(join(dir, "data/experiments/E_test/runs"), { recursive: true });
mkdirSync(join(dir, "notes"), { recursive: true });
mkdirSync(join(dir, "report"), { recursive: true });

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.log(`FAIL ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const fakeBash = {
  name: "bash",
  execute: async (_id: string, params: any) => ({
    content: [{ type: "text" as const, text: `RAN:${params.command}` }],
  }),
};

async function runCmd(wrapper: any, templateVars: Record<string, string>, command: string) {
  const wrapped = wrapper([fakeBash], dir, templateVars);
  const bash = wrapped.find((t: any) => t.name === "bash")!;
  const r = await bash.execute("1", { command });
  const text = r.content[0].text;
  return text.startsWith("BLOCKED") ? "blocked" : "ok";
}

async function test(label: string, wrapper: any, tvars: Record<string, string>, cases: Array<[string, "ok" | "blocked"]>) {
  console.log(`\n[${label}]`);
  for (const [cmd, want] of cases) {
    const got = await runCmd(wrapper, tvars, cmd);
    assert(got === want, `${cmd.slice(0, 70)}${cmd.length > 70 ? "…" : ""} → ${got} (expected ${want})`);
  }
}

// ── brain: bash writes must be inside allowedWriteRoots (notes/, report/,
//          reviews/). data/experiments/ blocklist + anything else outside
//          allowlist also blocked.
await test("brain", wrapperFor("brain"), {}, [
  // Blocklist attack vectors (data/experiments/) — must be blocked
  ["cat > data/experiments/E1/scripts/foo.py", "blocked"],
  ["cat >> data/experiments/E1/scripts/foo.py", "blocked"],
  ["echo 'x' > data/experiments/E1/runs/run_1/results.json", "blocked"],
  ["python3 -c \"open('data/experiments/E1/foo.py', 'w').write('x')\"", "blocked"],
  ["tee data/experiments/E1/scripts/foo.py", "blocked"],
  ["tee -a data/experiments/E1/runs/results.json", "blocked"],
  ["cp /tmp/x.py data/experiments/E1/scripts/y.py", "blocked"],
  ["mv /tmp/x.py data/experiments/E1/scripts/y.py", "blocked"],
  ["touch data/experiments/E1/scripts/new.py", "blocked"],
  ["sed -i 's/x/y/' data/experiments/E1/scripts/foo.py", "blocked"],
  // Allowlist-outside (not data/experiments/) — must also be blocked
  ["cat > RESEARCH.md", "blocked"],                              // root-level file
  ["cat > plan.md", "blocked"],                                  // root-level file
  ["echo 'x' > data/papers/2308.07915/main.tex", "blocked"],     // other data/ subtree
  ["tee src/agents/definitions/brain.md", "blocked"],            // source tree
  // Read-only / run / navigation operations — must pass
  ["cat data/experiments/E1/scripts/foo.py", "ok"],
  ["ls data/experiments/E1/", "ok"],
  ["cd data/experiments/E1 && pytest tests/", "ok"],
  ["find data/experiments/ -name '*.py'", "ok"],
  ["python3 data/experiments/E1/scripts/foo.py", "ok"],
  // Writes under brain's allowed roots (via bash) — must pass
  ["cat > notes/memory.md", "ok"],
  ["echo 'x' > report/report.tex", "ok"],
  ["tee reviews/pi_feedback.md", "ok"],
  // /dev/null and fd redirects — must pass
  ["ls data/experiments/ 2>/dev/null", "ok"],
  ["python3 script.py 2>&1", "ok"],
  // Out-of-project scratch (e.g. /tmp) — must pass
  ["cat > /tmp/foo.txt", "ok"],
  ["tee /var/folders/xyz", "ok"],
  // P1 extended patterns — must be blocked under data/experiments/
  ["python3 -c \"from pathlib import Path; Path('data/experiments/E1/foo.py').write_text('x')\"", "blocked"],
  ["python3 -c \"from pathlib import Path; Path('data/experiments/E1/foo.bin').write_bytes(b'x')\"", "blocked"],
  ["dd if=/tmp/src of=data/experiments/E1/scripts/foo.py", "blocked"],
  ["rsync -av /tmp/src/ data/experiments/E1/", "blocked"],
  ["install -m 644 /tmp/src.py data/experiments/E1/scripts/foo.py", "blocked"],
  ["cp /tmp/a.py /tmp/b.py data/experiments/E1/scripts/", "blocked"],    // multi-source → destdir
  ["mv /tmp/a /tmp/b /tmp/c data/experiments/E1/", "blocked"],           // multi-source → destdir
  // P1 extended patterns outside project — must pass
  ["dd if=/tmp/src of=/tmp/dst", "ok"],
  ["rsync -av /tmp/src/ /tmp/dst/", "ok"],
  // P1 no-false-positive: package manager `install` must pass (no `/` in target)
  ["sudo apt install stim", "ok"],
  ["pip install numpy scipy", "ok"],
]);
// Note: out-of-project absolute paths (/tmp, /var, /etc) pass both the
// allowlist and blocklist. This is intentional — the wrapper enforces
// the agent's IN-PROJECT write scope; OS-level permissions handle paths
// outside. Scratch writes (/tmp, /var) are a common legitimate pattern.

// ── experiment: writes outside { notes/, runs/ of own, report/figures/ }
//               are blocked by allowlist. scripts/ and tests/ of own
//               experiment are blocked by both blocklist and allowlist.
await test("experiment", wrapperFor("experiment"), { EXPERIMENT_ID: "E_test" }, [
  // Own-experiment blocklist hits
  ["cat > data/experiments/E_test/scripts/foo.py", "blocked"],
  ["cat > data/experiments/E_test/tests/test_foo.py", "blocked"],
  ["python3 -c \"open('data/experiments/E_test/scripts/foo.py','w').write('x')\"", "blocked"],
  // Sibling experiment — blocked by allowlist, not blocklist (catches the
  // class of "experiment writes to other experiments' dirs" which
  // blockedBashWriteRoots alone cannot express)
  ["cat > data/experiments/E_other/runs/run_1/results.json", "blocked"],
  ["tee data/experiments/E_other/scripts/foo.py", "blocked"],
  // Other root-level paths outside allowlist
  ["cat > RESEARCH.md", "blocked"],
  ["cat > report/report.tex", "blocked"],                        // report/ root not allowed; only report/figures/
  // Legitimate writes — must pass
  ["cat > data/experiments/E_test/runs/run_1/results.json", "ok"],
  ["cat > notes/experiments.md", "ok"],
  ["cat > report/figures/e1.png", "ok"],
  // Running own scripts, pytest — must pass
  ["cd data/experiments/E_test && pytest tests/", "ok"],
  ["python3 data/experiments/E_test/scripts/foo.py", "ok"],
  ["mkdir -p data/experiments/E_test/runs/run_1/data", "ok"],
]);

// ── tool_impl: only own scripts/ allowed. Anything else blocked.
await test("tool_impl", wrapperFor("tool_impl"), { EXPERIMENT_ID: "E_test" }, [
  // Own-experiment blocklist hits
  ["cat > data/experiments/E_test/tests/test_foo.py", "blocked"],
  ["cat > data/experiments/E_test/runs/run_1/results.json", "blocked"],
  // Sibling experiment — allowlist catches
  ["cat > data/experiments/E_other/scripts/foo.py", "blocked"],
  ["cat > data/experiments/E_other/tests/test_x.py", "blocked"],
  // Root-level / notes — allowlist catches
  ["cat > notes/memory.md", "blocked"],
  ["cat > RESEARCH.md", "blocked"],
  // scripts/ is the legitimate write target
  ["cat > data/experiments/E_test/scripts/foo.py", "ok"],
  ["python3 -c 'import stim; print(stim.__version__)'", "ok"],
]);

// ── tool_review: only own tests/ allowed. Anything else blocked.
await test("tool_review", wrapperFor("tool_review"), { EXPERIMENT_ID: "E_test" }, [
  ["cat > data/experiments/E_test/scripts/foo.py", "blocked"],
  ["cat > data/experiments/E_test/runs/run_1/results.json", "blocked"],
  ["cat > data/experiments/E_other/tests/test_x.py", "blocked"],
  ["cat > data/experiments/E_other/scripts/foo.py", "blocked"],
  ["cat > notes/memory.md", "blocked"],
  // tests/ is the legitimate write target
  ["cat > data/experiments/E_test/tests/test_foo.py", "ok"],
]);

rmSync(dir, { recursive: true, force: true });

if (failures === 0) {
  console.log("\nPASS — bash write guard enforces allowedWriteRoots across agents");
  process.exit(0);
} else {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
