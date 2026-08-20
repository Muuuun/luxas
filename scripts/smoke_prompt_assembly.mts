/**
 * Smoke test: the semi-static system layer (L3) is a pure function of project
 * state, with no wall-clock or per-turn content baked in.
 *
 * Why this gate exists: L3 is frozen into the cache-pinned system block at
 * agent creation. Any turn-varying byte in it silently breaks prompt-cache
 * equality — the failure CLAUDE.md records as "不在 L3 output 里埋时间戳".
 * That class of bug is invisible in output review and produces no error; only
 * an equality check catches it.
 *
 * Runs against a hermetic HOME + fixture project so ~/.sisyphus state on the
 * developer's machine cannot make the result vary.
 *
 * Run:  npx tsx scripts/smoke_prompt_assembly.mts
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) {
		console.log(`✓ ${label}`);
	} else {
		failures++;
		console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/** Fixture project with every optional L3 input present. */
function makeProject(): string {
	const proj = mkdtempSync(join(tmpdir(), "luxas-l3-proj-"));
	writeFileSync(join(proj, "RESEARCH.md"), "# Research question\n\nDoes X cause Y under condition Z?\n");
	mkdirSync(join(proj, "notes"), { recursive: true });
	writeFileSync(join(proj, "notes", "lessons.md"), "- a lesson long enough to clear the twenty-character gate\n");
	return proj;
}

function makeHome(): string {
	const home = mkdtempSync(join(tmpdir(), "luxas-l3-home-"));
	mkdirSync(join(home, ".sisyphus"), { recursive: true });
	writeFileSync(
		join(home, ".sisyphus", "memory.md"),
		"- tmux windows die silently when the pane exits [luxas-probe, 2026-05]\n",
	);
	return home;
}

const home = makeHome();
const proj = makeProject();
const empty = mkdtempSync(join(tmpdir(), "luxas-l3-bare-"));

try {
	// HOME must be set before the module graph loads: memory.ts resolves
	// SISYPHUS_DIR from homedir() at module scope.
	process.env.HOME = home;
	const { buildSemiStaticSystemLayer } = await import(join(ROOT, "src/context.js"));

	const first = buildSemiStaticSystemLayer(proj);

	// ── 1. determinism within a process ─────────────────────────────────────
	await new Promise((r) => setTimeout(r, 1100)); // cross a wall-clock second
	const second = buildSemiStaticSystemLayer(proj);
	check("two in-process calls are byte-identical", first === second,
		first === second ? "" : `len ${first.length} vs ${second.length}`);

	// ── 2. determinism across processes ─────────────────────────────────────
	// Catches a timestamp captured once at module-load time, which repeated
	// in-process calls would happily agree on.
	const probe = join(tmpdir(), `luxas-l3-probe-${process.pid}.mts`);
	writeFileSync(
		probe,
		`const m = await import(${JSON.stringify(join(ROOT, "src/context.js"))});\n` +
			`process.stdout.write(m.buildSemiStaticSystemLayer(${JSON.stringify(proj)}));\n`,
	);
	const child = spawnSync("npx", ["tsx", probe], {
		cwd: ROOT,
		env: { ...process.env, HOME: home },
		encoding: "utf8",
		timeout: 60_000,
	});
	try { rmSync(probe, { force: true }); } catch {}
	if (child.status !== 0) {
		check("child process assembled L3", false, (child.stderr || "").trim().split("\n").slice(-3).join(" | "));
	} else {
		check("separate process produces identical L3", child.stdout === first,
			child.stdout === first ? "" : `len ${child.stdout.length} vs ${first.length}`);
	}

	// ── 3. no wall-clock content ────────────────────────────────────────────
	// Dates from stored project metadata (YYYY-MM-DD) are legitimate; a full
	// timestamp with time-of-day is not — nothing in L3 should know the hour.
	const clockLike = first.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
	check("no date+time timestamp in L3", clockLike === null, clockLike?.[0]);
	const epochLike = first.match(/\b17\d{11}\b/); // ms-epoch in the 2023-2026 range
	check("no epoch-ms value in L3", epochLike === null, epochLike?.[0]);

	// ── 4. section order is fixed ───────────────────────────────────────────
	const order = ["<research_goal>", "<lessons_learned>", "## Available Skills", "<global_memory>"];
	const positions = order.map((tag) => ({ tag, at: first.indexOf(tag) }));
	const missing = positions.filter((p) => p.at === -1).map((p) => p.tag);
	check("all expected sections present", missing.length === 0, missing.join(", "));
	if (missing.length === 0) {
		const ascending = positions.every((p, i) => i === 0 || p.at > positions[i - 1].at);
		check("sections in declared order", ascending, positions.map((p) => `${p.tag}@${p.at}`).join(" "));
	}

	// ── 5. absent input omits its block, never emits an empty tag ───────────
	const bare = buildSemiStaticSystemLayer(empty);
	check("bare project omits research_goal", !bare.includes("<research_goal>"));
	check("bare project omits lessons_learned", !bare.includes("<lessons_learned>"));
	const emptyTag = bare.match(/<([a-z_]+)>\s*<\/\1>/);
	check("no empty tag pairs emitted", emptyTag === null, emptyTag?.[0]);

	// ── 6. the layer is non-trivial ─────────────────────────────────────────
	// Guards against a refactor that silently returns "" and passes 1-5.
	check("L3 is non-empty and substantial", first.length > 500, `len ${first.length}`);
} finally {
	for (const d of [home, proj, empty]) {
		try { rmSync(d, { recursive: true, force: true }); } catch {}
	}
}

console.log(failures === 0 ? "\nALL PASS — L3 assembly is deterministic." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
