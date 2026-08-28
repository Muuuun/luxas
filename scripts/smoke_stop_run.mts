/**
 * smoke_stop_run — `luxas stop` finds the run.pid process AND the exec'd
 * children / background runners that name the project, never the caller.
 * Regression for 2026-08-28: killing only the npx wrapper left the node child
 * running a $60-capped project to $95.
 */
import { findRunProcesses, parsePs } from "../src/stop-run.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}
const DIR = "/Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project";
const ps = parsePs([
  "  100 sshd: muqiao [priv]",
  "  200 bash -c P=" + DIR + "; kill -0 1552090",                                  // an ssh shell merely mentioning the dir
  " 1552104 node /Users/muqiao/.npm/_npx/x/node_modules/.bin/tsx /Users/muqiao/Documents/Sisyphus/src/index.ts run " + DIR + " --profile dual",
  " 1552115 /usr/bin/node --require /x/preflight.cjs --import file:///x/loader.mjs /Users/muqiao/Documents/Sisyphus/src/index.ts run " + DIR,
  " 1560000 /usr/bin/node /Users/muqiao/Documents/Sisyphus/src/subagent-runner.ts --project " + DIR + " --id brain.reader-abc",
  " 1570000 node /Users/muqiao/Documents/Sisyphus/src/index.ts run /Users/muqiao/Documents/sisyphus-projects/other/project",
  " 1580000 node /Users/muqiao/Documents/Sisyphus/src/index.ts stop " + DIR,
  " 1590000 python3 /Users/muqiao/Documents/sisyphus-projects/pp-vs-ss-gate-packing-20260826/project/data/experiments/E1/scripts/x.py",
].join("\n"));
check("parsePs reads pid + args", ps.length === 8 && ps[2].pid === 1552104);
const found = findRunProcesses(ps, DIR, 1552115, 1580000);
check("wrapper, exec'd child and background runner are all found", [1552104, 1552115, 1560000].every((p) => found.includes(p)), found.join(","));
check("an ssh/bash line that merely mentions the dir is NOT a target", !found.includes(200));
check("another project's run is NOT a target", !found.includes(1570000));
check("the `luxas stop` process itself is NOT a target", !found.includes(1580000));
check("a python experiment job is NOT a target (owned by the run; dies with it)", !found.includes(1590000));
check("run.pid is included even when its args don't match (stale table)", findRunProcesses(parsePs("  42 /usr/bin/node something-else"), DIR, 42, 1).includes(42));
check("trailing slash on the dir is tolerated", findRunProcesses(ps, DIR + "/", null, 1).includes(1552115));
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — luxas stop targets the whole run, not just the wrapper.");
