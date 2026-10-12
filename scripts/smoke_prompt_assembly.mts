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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	const order = ["<research_goal>", "<lessons_learned>", "## Available Skills"];
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

	// ── C84a. <past_research> is scoped to the project's tenant ─────────────
	// Studio projects live at <root>/<userHash>/projects/<name>, and every
	// tenant shares one ~/.sisyphus/projects.json. Dy's brain was handed other
	// studio users' research questions, and 4 of 23 digest-era brains read
	// another tenant's notes. Paths are deliberately dead: isThrowawayPath()
	// drops mkdtemp dirs, while a dead path still renders its name (archive
	// fallback). Runs last: §1-6 assume no registry exists in this HOME.
	const mem = await import(join(ROOT, "src/memory.js"));
	const R = "/luxas-c84-fixture/sisyphus-projects";
	const A = "aaaaaaaaaaaa", B = "bbbbbbbbbbbb";
	const ownPast = `${R}/${A}/projects/past-own`;
	const otherPast = `${R}/${B}/projects/past-other`;
	const cliPast = `${R}/cli-root-project`;
	// A bench run (scripts/bench_run.mts) under the default runs directory. The path is dead like the
	// others, so only the bench-runs clause of isThrowawayPath can keep it out.
	const benchPast = `${R}/.sisyphus/bench-runs/2026-10-09T00-00-00-luxas-blender-02-lit-scene`;
	const entry = (path: string, name: string, lastRun: string) => ({
		path, name, created: lastRun, lastRun, summary: "Report: completed (PDF generated)", costUsd: 1, tokens: 1,
	});
	writeFileSync(join(home, ".sisyphus", "projects.json"), JSON.stringify([
		entry(ownPast, "TENANT-A-OWN-PAST", "2026-06-01T00:00:00Z"),
		entry(otherPast, "TENANT-B-PRIVATE-QUESTION", "2026-06-02T00:00:00Z"),
		entry(cliPast, "CLI-ROOT-PROJECT", "2026-06-03T00:00:00Z"),
		entry(benchPast, "BENCH-RUN-SAME-TASK", "2026-06-04T00:00:00Z"),
	]));

	const ownerKey: ((p: string) => string) | undefined = mem.ownerKey;
	const key = (p: string) => (typeof ownerKey === "function" ? ownerKey(p) : "<ownerKey not exported>");
	check("C84a ownerKey: tenant A path → its userHash", key(ownPast) === A, key(ownPast));
	check("C84a ownerKey: tenant B path → its userHash", key(otherPast) === B, key(otherPast));
	check("C84a ownerKey: CLI path → local", key(cliPast) === "local", key(cliPast));
	check("C84a ownerKey: 12-hex dir without /projects/ → local",
		key(`${R}/${A}/past-own`) === "local", key(`${R}/${A}/past-own`));

	const l3a: string = buildSemiStaticSystemLayer(`${R}/${A}/projects/current`);
	check("C84a tenant A sees its own past project", l3a.includes("TENANT-A-OWN-PAST"));
	check("C84a tenant A does not see tenant B's project", !l3a.includes("TENANT-B-PRIVATE-QUESTION"));
	check("C84a tenant A does not see tenant B's path or archive copy",
		!l3a.includes(otherPast) && !l3a.includes(mem.archiveSlug(otherPast)));
	check("C84a tenant A does not see a CLI project", !l3a.includes("CLI-ROOT-PROJECT"));

	const l3b: string = buildSemiStaticSystemLayer(`${R}/${B}/projects/current`);
	check("C84a tenant B sees its own past project", l3b.includes("TENANT-B-PRIVATE-QUESTION"));
	check("C84a tenant B does not see tenant A's project", !l3b.includes("TENANT-A-OWN-PAST"));

	// The accepted trade-off: a CLI run sees CLI projects only, so the
	// operator's own studio-account projects drop out of it too.
	const l3cli: string = buildSemiStaticSystemLayer(`${R}/cli-current`);
	check("C84a CLI run sees CLI projects", l3cli.includes("CLI-ROOT-PROJECT"));
	check("C84a CLI run sees no tenant project",
		!l3cli.includes("TENANT-A-OWN-PAST") && !l3cli.includes("TENANT-B-PRIVATE-QUESTION"));
	// The consumers of isThrowawayPath's bench-runs clause (smoke_bench_pipeline §10 holds the clause
	// itself): removing the test from selectPastProjects or from registerProject passed every gate.
	check("a finished bench run in the registry is not shown as past research", !l3cli.includes("BENCH-RUN-SAME-TASK"));
	const benchNew = `${R}/.sisyphus/bench-runs/2026-10-09T01-00-00-luxas-blender-02-lit-scene`;
	mem.registerProject(benchNew);
	const registered: Array<{ path: string }> = JSON.parse(readFileSync(join(home, ".sisyphus", "projects.json"), "utf8"));
	check("a bench run is not written into the registry by registerProject", !registered.some((p) => p.path === benchNew) && registered.length === 4, JSON.stringify(registered.map((p) => p.path)));

	// index.ts prints this count as "N past project(s) in <past_research>".
	const names = mem.selectPastProjects(`${R}/${A}/projects/current`).map((p: { name: string }) => p.name);
	check("C84a selectPastProjects for tenant A is exactly its own",
		names.length === 1 && names[0] === "TENANT-A-OWN-PAST", JSON.stringify(names));

	// ── C84b. no <global_memory>, and no brain write root that fed it ───────
	// ~/.sisyphus/memory.md rode in every brain's system prompt while brains
	// stopped writing it: one entry across the digest era, pointing at an
	// archive path that no longer exists. makeHome() writes the file, so
	// anything that still reads it shows up in `first`.
	const globalMem = readFileSync(join(home, ".sisyphus", "memory.md"), "utf8").trim();
	check("C84b L3 has no <global_memory> block", !first.includes("<global_memory>"));
	check("C84b L3 carries no text from ~/.sisyphus/memory.md", !first.includes(globalMem));
	const brainMd = readFileSync(join(ROOT, "src/agents/definitions/brain.md"), "utf8");
	check("C84b brain.md has no {{SISYPHUS_DIR}}/memory.md write root",
		!brainMd.includes("{{SISYPHUS_DIR}}/memory.md"));
	for (const rel of ["src/agents/definitions/brain.md", "skills/memory/SKILL.md"]) {
		check(`C84b ${rel} does not mention <global_memory>`,
			!readFileSync(join(ROOT, rel), "utf8").includes("<global_memory>"));
	}

	// ── C28. the experiment's <project_structure> is scoped to its task ─────
	// It listed every project file: one line per downloaded paper (600 on a
	// 600-paper project) plus pytest/pycache debris, around the few files the
	// experiment works with. Built through buildAgentFromDefinition because
	// the builder learns EXPERIMENT_ID only from what spawn.ts hands it.
	process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
	const { buildAgentFromDefinition } = await import(join(ROOT, "src/agents/spawn.js"));
	const { resolveContextBuilder } = await import(join(ROOT, "src/agents/context-builders.js"));
	const c28Dirs: string[] = [];
	const c28Project = (nPapers: number): string => {
		const p = mkdtempSync(join(tmpdir(), "luxas-c28-"));
		c28Dirs.push(p);
		const w = (rel: string, body = "x") => {
			mkdirSync(join(p, rel, ".."), { recursive: true });
			writeFileSync(join(p, rel), body);
		};
		w("RESEARCH.md", "# Research question\n\nDoes X cause Y?\n");
		for (let i = 0; i < nPapers; i++) w(`data/papers/2301.${10000 + i}/main.tex`);
		w("notes/literature.d/Smith2020.md", "- **Source file**: data/papers/2301.10000/main.tex\n");
		for (const d of ["", "data/experiments/E1_up/", "data/experiments/E2_me/"]) {
			w(`${d}.pytest_cache/v/cache/nodeids`, "[]");
		}
		w("data/experiments/E1_up/scripts/up_model.py");
		w("data/experiments/E1_up/scripts/__pycache__/up_model.cpython-312.pyc");
		w("data/experiments/E1_up/tests/test_up_model.py");
		w("data/experiments/E1_up/runs/run_1/results.json", "{}");
		w("data/experiments/E1_up/runs/run_1/data/big.csv");
		w("data/experiments/E2_me/scripts/my_tool.py");
		w("data/experiments/E2_me/tests/test_my_tool.py");
		w("data/experiments/E2_me/runs/run_1/results.json", "{}");
		return p;
	};
	const structure = (s: string): string =>
		s.match(/<project_structure>\n([\s\S]*?)\n<\/project_structure>/)?.[1] ?? "";
	const experimentPrompt = (p: string): string => buildAgentFromDefinition({
		name: "experiment", projectDir: p, prompt: "E2 task",
		templateVars: { EXPERIMENT_ID: "E2_me", PROJECT_DIR: p },
		contextExtra: { task: "E2 task" }, getApiKey: () => "k",
	}).agent.state.systemPrompt;
	const own = ["E2_me/scripts/my_tool.py", "E2_me/tests/test_my_tool.py", "E2_me/runs/run_1/results.json"];
	const noCache = (lines: string[]) => !lines.some((l) => /pytest_cache|__pycache__/.test(l));
	const savedMode = process.env.LUXAS_EXPERIMENT_MODE;
	try {
		const big = c28Project(600);
		const small = c28Project(6);
		for (const mode of ["pipeline", "solo"]) {
			if (mode === "solo") process.env.LUXAS_EXPERIMENT_MODE = "solo";
			else delete process.env.LUXAS_EXPERIMENT_MODE;
			const tree = structure(experimentPrompt(big));
			const lines = tree.split("\n");
			const listed = (f: string) => lines.includes(`data/experiments/${f}`);
			check(`C28 ${mode}: system prompt carries <project_structure>`, tree.length > 0);
			const paperLines = lines.filter((l) => l.startsWith("data/papers/")).length;
			check(`C28 ${mode}: no per-paper lines`, paperLines === 0, `${paperLines} lines`);
			check(`C28 ${mode}: one line counts the 600 papers`,
				lines.filter((l) => /\b600\b.*data\/papers\//.test(l)).length === 1);
			check(`C28 ${mode}: no pytest_cache / __pycache__ lines`, noCache(lines),
				lines.filter((l) => /pytest_cache|__pycache__/.test(l)).join(", "));
			check(`C28 ${mode}: every file of its own experiment listed`, own.every(listed),
				own.filter((f) => !listed(f)).join(", "));
			check(`C28 ${mode}: upstream results.json and scripts/ module listed`,
				listed("E1_up/runs/run_1/results.json") && listed("E1_up/scripts/up_model.py"));
			check(`C28 ${mode}: upstream tests/ and run data not listed`,
				!listed("E1_up/tests/test_up_model.py") && !listed("E1_up/runs/run_1/data/big.csv"));
			const smallTree = structure(experimentPrompt(small));
			check(`C28 ${mode}: listing size independent of the paper count`,
				Math.abs(tree.length - smallTree.length) < 40,
				`${smallTree.length} chars at 6 papers, ${tree.length} at 600`);
		}

		// No usable EXPERIMENT_ID: every experiment's files stay listed, as before.
		const exp = resolveContextBuilder("experiment");
		const unscoped: Array<[string, Record<string, any>]> = [
			["no EXPERIMENT_ID", { task: "t" }],
			["unresolved {{EXPERIMENT_ID}}", { task: "t", templateVars: { EXPERIMENT_ID: "{{EXPERIMENT_ID}}" } }],
		];
		for (const [label, extra] of unscoped) {
			const lines = structure(exp(big, extra)).split("\n");
			const listed = (f: string) => lines.includes(`data/experiments/${f}`);
			check(`C28 ${label}: own experiment's files listed`, own.every(listed));
			check(`C28 ${label}: other experiments' files listed`,
				listed("E1_up/tests/test_up_model.py") && listed("E1_up/runs/run_1/data/big.csv"));
			check(`C28 ${label}: caches still dropped`, noCache(lines));
		}
	} finally {
		if (savedMode === undefined) delete process.env.LUXAS_EXPERIMENT_MODE;
		else process.env.LUXAS_EXPERIMENT_MODE = savedMode;
		for (const d of c28Dirs) {
			try { rmSync(d, { recursive: true, force: true }); } catch {}
		}
	}
} finally {
	for (const d of [home, proj, empty]) {
		try { rmSync(d, { recursive: true, force: true }); } catch {}
	}
}

console.log(failures === 0 ? "\nALL PASS — L3 assembly is deterministic." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
