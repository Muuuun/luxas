/**
 * Smoke: the sidecar monitor (src/tools/monitor-tools.ts, src/monitor-runner.ts,
 * src/agents/definitions/monitor.md).
 *
 * Producer/consumer edge under test: post_directive writes
 * notes/directives/<ts>-monitor.md; src/context.ts collectActiveDirectives
 * (the brain's per-call reader) must see it, and retract must hide it again.
 * Also: the tools never write anywhere else, the definition loads with a
 * working safety wrapper, run_status/recent_activity/transcript render from a
 * synthetic .agent/, and history trimming never starts on a tool result.
 * And (C2) a restored chat sends the current monitor prompt, once, and the
 * session file gains only the new turn. And (C52) run_status and `luxas
 * status` show in-process work as in flight while the brain lives; (C52b)
 * work hosted by another process is judged by that process, on resume too.
 *
 * Run:  npx tsx scripts/smoke_monitor.mts
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tools = await import(join(ROOT, "src/tools/monitor-tools.js"));
const runner = await import(join(ROOT, "src/monitor-runner.js"));
const { loadAgentDefinitions } = await import(join(ROOT, "src/agents/registry.js"));
const { buildSafetyWrapper } = await import(join(ROOT, "src/agents/safety-wrappers.js"));

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
	if (cond) console.log(`✓ ${label}`);
	else { failures++; console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

function snapshotTree(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const n of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, n.name);
			if (n.isDirectory()) walk(p); else out.push(p.slice(dir.length + 1));
		}
	};
	walk(dir);
	return out.sort();
}

// ── Definition loads and wraps ────────────────────────────────────────
const defs = loadAgentDefinitions();
const def = defs.get("monitor");
check("monitor definition loads", !!def);
check("monitor cannot spawn", def?.spawn.enabled === false);
check("monitor safety wrapper builds", !!buildSafetyWrapper(def?.safety));
check("monitor toolSets is read-only (pi = read+grep)", JSON.stringify(def?.toolSets) === JSON.stringify(["pi"]));

// ── Synthetic project ─────────────────────────────────────────────────
const d = mkdtempSync(join(tmpdir(), "luxas-monitor-"));
try {
	mkdirSync(join(d, ".agent", "conversations"), { recursive: true });
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(d, "RESEARCH.md"), "# Goal\nMeasure X.\n");
	writeFileSync(join(d, ".agent", "run_config.json"), JSON.stringify({ model: "opus", profile: "dual", maxCost: 40 }));
	writeFileSync(join(d, ".agent", "run.pid"), JSON.stringify({ pid: process.pid, startedAt: Date.now() - 90_000 }));
	// usage.log is TSV (src/usage-log.ts appendUsage): ts model provider in out cacheRead cacheWrite cost
	writeFileSync(join(d, ".agent", "usage.log"), [
		[Date.now(), "m", "p", 1000, 100, 0, 0, "1.25000000"].join("\t"),
		[Date.now(), "m", "p", 1000, 100, 0, 0, "0.75000000"].join("\t"),
	].join("\n") + "\n");
	writeFileSync(join(d, ".agent", "log.jsonl"), [
		JSON.stringify({ type: "session_start", timestamp: "2026-08-30T01:00:00.000Z" }),
		JSON.stringify({ type: "tool_call", tool: "read", args: { path: "notes/plan.md" }, success: true, timestamp: "2026-08-30T01:00:05.000Z" }),
		JSON.stringify({ type: "tool_call", tool: "bash", args: { command: "python x.py" }, success: false, errorCategory: "runtime", errorMessage: "boom", timestamp: "2026-08-30T01:00:09.000Z" }),
	].join("\n") + "\n");
	const convFile = join(d, ".agent", "conversations", "brain.experiment-abc123.jsonl");
	writeFileSync(convFile, [
		JSON.stringify({ type: "spawn_init", task: "run E1 sweep" }),
		JSON.stringify({ role: "user", content: [{ type: "text", text: "run E1 sweep" }], timestamp: 1 }),
		JSON.stringify({ role: "assistant", content: [{ type: "text", text: "Starting the sweep." }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }], timestamp: 2 }),
		JSON.stringify({ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "a.py" }], timestamp: 3 }),
		JSON.stringify({ role: "assistant", content: [{ type: "text", text: "Found a.py; sweep at 40%." }], timestamp: 4 }),
	].join("\n") + "\n");
	writeFileSync(join(d, ".agent", "active-agents.json"), JSON.stringify([
		{ id: "brain.experiment-abc123", name: "experiment", task: "run E1 sweep", mode: "background", startedAt: Date.now() - 600_000, conversationFile: convFile, status: "running" },
	]));

	// ── run_status ────────────────────────────────────────────────────
	const status = tools.summarizeRunStatus(d);
	check("run_status: process RUNNING from live pid", /process: RUNNING/.test(status), status);
	check("run_status: spend summed from usage.log", /\$2\.00 over 2 LLM calls/.test(status), status);
	check("run_status: budget fraction vs cap", /budget: 5% of \$40/.test(status), status);
	check("run_status: sub-agent listed with liveness verdict", /brain\.experiment-abc123 \[background\] NO heartbeat/.test(status), status);
	check("run_status: profile surfaced", /profile=dual/.test(status));

	// ── recent_activity ───────────────────────────────────────────────
	const act = tools.summarizeRecentActivity(d, 10);
	check("recent_activity renders tool, args, failure", /read path=notes\/plan\.md/.test(act) && /bash command=python x\.py ✗ runtime: boom/.test(act), act);

	// ── agent_transcript ──────────────────────────────────────────────
	const tr = tools.summarizeTranscript(d, "brain.experiment-abc123", 5);
	check("transcript: task + text + tool + result", /task: run E1 sweep/.test(tr) && /tool→bash/.test(tr) && /sweep at 40%/.test(tr), tr);
	check("transcript: unknown id lists known ids", /Known ids: .*brain\.experiment-abc123/.test(tools.summarizeTranscript(d, "brain.nope-1", 3)));
	check("transcript: path traversal id rejected", /no transcript/.test(tools.summarizeTranscript(d, "../../etc/passwd", 3)));

	// ── directives: producer → brain's consumer ───────────────────────
	const before = snapshotTree(d);
	const { collectActiveDirectives: collect } = await import(join(ROOT, "src/context.js"));

	const posted = tools.postDirective(d, "Prioritise E2 over E3; E3's premise was refuted in L2.1.", "user@example.com");
	check("post_directive ok", posted.ok === true, JSON.stringify(posted));
	const fileRel = `notes/directives/${posted.name}.md`;
	check("post writes exactly one file, under notes/directives/", (() => {
		const after = snapshotTree(d);
		const added = after.filter((f) => !before.includes(f));
		return added.length === 1 && added[0] === fileRel;
	})(), snapshotTree(d).join(","));
	const raw = readFileSync(join(d, fileRel), "utf-8");
	check("frontmatter carries source + by + issued_at", /source: studio-monitor/.test(raw) && /by: user@example\.com/.test(raw) && /issued_at: /.test(raw), raw);

	{
		const seen = collect(d, undefined);
		check("brain's collectActiveDirectives sees the posted directive (frontmatter stripped)", seen.length === 1 && seen[0].text === "Prioritise E2 over E3; E3's premise was refuted in L2.1.", JSON.stringify(seen));
	}

	const dup = tools.postDirective(d, "Prioritise E2 over E3; E3's premise was refuted in L2.1.");
	check("identical active directive is refused as duplicate", dup.ok === false && dup.duplicateOf === posted.name, JSON.stringify(dup));
	check("empty directive refused", tools.postDirective(d, "   ").ok === false);
	check("over-long directive refused (brain truncates at 3000 bytes)", tools.postDirective(d, "x".repeat(3000)).ok === false);

	// Launch directive (no source) must not be retractable by the monitor.
	writeFileSync(join(d, "notes", "directives", "2026-01-01T00-00-00-000Z.md"), "---\nissued_at: 2026-01-01T00:00:00.000Z\n---\n\nsimulate all 7 schemes\n");
	const rl = tools.retractDirective(d, "2026-01-01T00-00-00-000Z");
	check("launch directive cannot be retracted by monitor", rl.ok === false && /not posted by the monitor/.test(rl.error ?? ""), JSON.stringify(rl));
	check("retract rejects path-shaped names", tools.retractDirective(d, "../RESEARCH").ok === false);

	const listed = tools.listDirectives(d);
	check("list_directives newest first, both producers visible", listed.length === 2 && listed[0].name === posted.name && listed[1].source === undefined, JSON.stringify(listed.map((x: any) => x.name)));

	const rr = tools.retractDirective(d, posted.name);
	check("retract monitor directive ok", rr.ok === true, JSON.stringify(rr));
	check("retracted file moved to archived/", !existsSync(join(d, fileRel)) && existsSync(join(d, "notes", "directives", "archived", `${posted.name}.md`)));
	{
		const seen = collect(d, undefined);
		check("brain no longer sees the retracted directive; launch one remains", seen.length === 1 && seen[0].text === "simulate all 7 schemes", JSON.stringify(seen));
	}
	check("list_directives shows the archived one flagged", tools.listDirectives(d).some((x: any) => x.archived && x.name === posted.name));

	// ── tool factory: every tool executes, and only directive tools write ──
	const changes: any[] = [];
	const factory = tools.createMonitorTools(d, { postedBy: "who@x", onDirectiveChange: (c: any) => changes.push(c) });
	const names = factory.map((t: any) => t.name).sort();
	check("tool names", JSON.stringify(names) === JSON.stringify(["agent_transcript", "list_directives", "list_files", "post_directive", "recent_activity", "retract_directive", "run_status"]), JSON.stringify(names));
	const treeBefore = snapshotTree(d);
	for (const t of factory) {
		if (t.name === "post_directive" || t.name === "retract_directive") continue;
		const r = await t.execute("id", t.name === "agent_transcript" ? { agent_id: "brain.experiment-abc123" } : {});
		check(`${t.name} executes`, typeof r?.content?.[0]?.text === "string" && r.content[0].text.length > 0);
	}
	check("read-only tools wrote nothing", JSON.stringify(snapshotTree(d)) === JSON.stringify(treeBefore));
	const pd = factory.find((t: any) => t.name === "post_directive");
	const pr = await pd.execute("id", { text: "Stop E3 after the current step." });
	check("post_directive tool emits directive event", changes.length === 1 && changes[0].action === "post" && /Posted /.test(pr.content[0].text), JSON.stringify(changes));
	const escaped = await factory.find((t: any) => t.name === "list_files").execute("id", { path: "../../" });
	check("list_files refuses to leave the project", /restricted/.test(escaped.content[0].text));

	// ── runner helpers ────────────────────────────────────────────────
	const msgs = [
		{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "toolResult", content: "c" },
		{ role: "user", content: "d" }, { role: "assistant", content: "e" },
	];
	const trimmed = runner.trimHistory(msgs, 3);
	check("trimHistory never starts on a tool result", trimmed.length === 2 && trimmed[0].role === "user" && trimmed[0].content === "d", JSON.stringify(trimmed));
	check("trimHistory is identity under the cap", runner.trimHistory(msgs, 10) === msgs);
	const parsed = runner.parseMonitorArgs(["--project", d, "--message", "what is --running", "--json", "--by", "me@x"]);
	check("parseMonitorArgs keeps free text with dashes", parsed.message === "what is --running" && parsed.json === true && parsed.by === "me@x" && parsed.project === d);
	delete process.env.LUXAS_MODEL_PROFILE;
	check("applyProjectProfile maps dual → deepseek text profile", runner.applyProjectProfile(d) === "dual" && process.env.LUXAS_MODEL_PROFILE === "deepseek-v4-pro");
	delete process.env.LUXAS_MODEL_PROFILE;
} finally {
	rmSync(d, { recursive: true, force: true });
}

// `luxas status`, the real CLI as a child: offline, no model call. Returns its
// output and the "  - " lines under its In flight and gone headers.
function luxasStatus(dir: string) {
	const r = spawnSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "src", "index.ts"), "status", dir], { cwd: ROOT, encoding: "utf-8", timeout: 60_000 });
	const out = (r.stdout ?? "") + (r.stderr ?? "");
	const all = out.split("\n");
	const group = (header: RegExp) => {
		const h = all.findIndex((l) => header.test(l));
		const g: string[] = [];
		for (let i = h + 1; h >= 0 && i < all.length && all[i].startsWith("  - "); i++) g.push(all[i]);
		return g.join("\n");
	};
	return { out, inFlight: group(/^In flight\b/), gone: group(/^Registered as running, but gone\b/) };
}

// ── §C52 in-process work a restart would kill ────────────────────────
// A reader fan-out runs inside the brain process: registered as parallel or
// foreground, with no pid and no heartbeat (src/agents/spawn.ts addAgent).
// run_status called every live reader "likely dead" and `luxas status` listed
// nothing, so stopping the brain mid fan-out looked free.
{
	const f = mkdtempSync(join(tmpdir(), "luxas-monitor-c52-"));
	try {
		mkdirSync(join(f, ".agent", "conversations"), { recursive: true });
		writeFileSync(join(f, "RESEARCH.md"), "# Goal\nMeasure X.\n");
		const setBrainPid = (pid: number) => writeFileSync(join(f, ".agent", "run.pid"), JSON.stringify({ pid, startedAt: Date.now() - 90_000 }));
		const entry = (id: string, mode: string, extra: object = {}) => ({
			id, name: id.split(".").pop()!.replace(/-.*/, ""), task: `task of ${id}`, mode, startedAt: Date.now() - 35_000,
			conversationFile: join(f, ".agent", "conversations", `${id}.jsonl`), status: "running", ...extra,
		});
		const readers = ["brain.reader-x0", "brain.reader-x1", "brain.reader-x2"];
		writeFileSync(join(f, ".agent", "active-agents.json"), JSON.stringify([
			entry(readers[0], "foreground"), entry(readers[1], "parallel"), entry(readers[2], "parallel"),
			// A background runner's own in-process children share this registry
			// under its id; they live and die with the runner, not the brain.
			entry("brain.experiment-bg1", "background", { pid: process.pid }),
			entry("brain.experiment-bg1.tool_impl-0", "parallel"),
		]));
		const line = (s: string, id: string) => s.split("\n").find((l) => l.includes(`${id} [`)) ?? "";

		setBrainPid(process.pid);
		const live = tools.summarizeRunStatus(f);
		check("§C52 live in-process readers are not labelled likely dead", !/reader-.*\[(parallel|foreground)\] NO heartbeat, process gone — likely dead/.test(live), live);
		for (const id of readers) {
			check(`§C52 ${id}: in-process with the brain pid, in flight, a restart kills it`,
				line(live, id).includes(`in-process with brain pid ${process.pid}, in flight; a restart kills it`), line(live, id));
		}
		check("§C52 a runner's in-process child is attributed to the runner",
			line(live, "brain.experiment-bg1.tool_impl-0").includes(`in-process in brain.experiment-bg1 pid ${process.pid}, in flight`), line(live, "brain.experiment-bg1.tool_impl-0"));

		const status = () => luxasStatus(f);
		// run.pid names this process, so the child sees a live brain.
		const s1 = status();
		check("§C52 luxas status prints an In flight section", /^In flight \(\d+\):/m.test(s1.out), s1.out);
		check("§C52 luxas status: brain.reader-x1 in flight, a restart kills it", line(s1.inFlight, "brain.reader-x1").includes("a restart kills it"), s1.out);

		// The brain is gone (a just-reaped child's pid): its readers went with it.
		const reaped = spawnSync(process.execPath, ["-e", ""]).pid;
		setBrainPid(reaped);
		const dead = tools.summarizeRunStatus(f);
		for (const id of readers) {
			check(`§C52 ${id}: died with the brain once run.pid is dead`, /died with the brain/.test(line(dead, id)) && !/in flight/.test(line(dead, id)), line(dead, id));
		}
		check("§C52 the runner's child does not die with the brain",
			!/died with the brain/.test(line(dead, "brain.experiment-bg1.tool_impl-0")) && /in flight/.test(line(dead, "brain.experiment-bg1.tool_impl-0")), line(dead, "brain.experiment-bg1.tool_impl-0"));
		const s2 = status();
		check("§C52 luxas status: a dead brain's readers are listed as gone, not in flight",
			!s1.gone && !line(s2.inFlight, "brain.reader-x1") && /died with the brain/.test(line(s2.gone, "brain.reader-x1")), s2.out);
	} finally {
		rmSync(f, { recursive: true, force: true });
	}
}

// ── §C52b in-process work hosted outside the brain ───────────────────
// scripts/review_experiment.mts runs its replicator and reviewer in its own
// process, and a background runner runs its revision and review loop in its:
// pid-less entries like a reader fan-out's, but the brain does not host them.
// Judged by run.pid, a live review read "died with the brain", `luxas status`
// said "In flight: nothing", a resumed brain was told "[Lost: …] Decide
// whether to retry", and the zombie sweeps reported it failed — while the
// review went on to write its file. spawn.ts records hostPid; all of these
// judge by it.
{
	const AA = await import(join(ROOT, "src/active-agents.js"));
	const g = mkdtempSync(join(tmpdir(), "luxas-monitor-c52b-"));
	// Live stand-ins, neither of them this process: a review_experiment and a runner.
	const hosts = [spawn("sleep", ["300"], { stdio: "ignore" }), spawn("sleep", ["300"], { stdio: "ignore" })];
	const [rePid, runnerPid] = hosts.map((h) => h.pid!);
	const deadHost = spawnSync(process.execPath, ["-e", ""]).pid;
	const deadBrain = spawnSync(process.execPath, ["-e", ""]).pid;
	const home = process.env.HOME;
	const profile = process.env.LUXAS_MODEL_PROFILE;
	const fetch0 = globalThis.fetch;
	try {
		const agentDir = join(g, ".agent");
		mkdirSync(join(agentDir, "conversations"), { recursive: true });
		writeFileSync(join(g, "RESEARCH.md"), "# Goal\nMeasure X.\n");
		const setBrainPid = (pid: number) => writeFileSync(join(agentDir, "run.pid"), JSON.stringify({ pid, startedAt: Date.now() - 90_000 }));
		const entry = (id: string, name: string, mode: string, extra: object) => ({
			id, name, task: `task of ${id}`, mode, startedAt: Date.now() - 120_000,
			conversationFile: join(agentDir, "conversations", `${id}.jsonl`), status: "running", ...extra,
		});
		const reviewer = "review_experiment.E2_x.experiment-review-1.experiment_reviewer-def456";
		const replicator = "review_experiment.E2_x.blind-estimate-q.replicator-abc123";
		const runner = "brain.experiment-bg2";
		// The runner's revision is named under the brain, not under the runner.
		const revision = "brain.experiment-k3j2x1";
		const reader = "brain.reader-y0";
		writeFileSync(join(agentDir, "active-agents.json"), JSON.stringify([
			entry(reviewer, "experiment_reviewer", "foreground", { hostPid: rePid }),
			entry(replicator, "replicator", "foreground", { hostPid: deadHost }),
			entry(runner, "experiment", "background", { pid: runnerPid }),
			entry(revision, "experiment", "foreground", { hostPid: runnerPid }),
			entry(reader, "reader", "parallel", { hostPid: process.pid }),
		]));
		AA.touchHeartbeat(agentDir, runner);
		const line = (s: string, id: string) => s.split("\n").find((l) => l.includes(`${id} [`)) ?? "";
		const elsewhere = `in-process in pid ${rePid} (not the brain), in flight; a brain restart or luxas stop does not stop it`;

		for (const brainAlive of [false, true]) {
			setBrainPid(brainAlive ? process.pid : deadBrain);
			const tag = `§C52b run.pid ${brainAlive ? "alive" : "dead"}:`;
			const mon = tools.summarizeRunStatus(g);
			check(`${tag} run_status: the review is in flight in its own process`, line(mon, reviewer).includes(elsewhere), line(mon, reviewer));
			check(`${tag} run_status: an entry whose host is gone died with its host, not the brain`, line(mon, replicator).includes(`died with its host pid ${deadHost}`), line(mon, replicator));
			check(`${tag} run_status: the runner's revision is in flight in the runner`, line(mon, revision).includes(`in-process in ${runner} pid ${runnerPid}, in flight`), line(mon, revision));
			const st = luxasStatus(g);
			check(`${tag} luxas status: the review is in flight, labelled by its host`, line(st.inFlight, reviewer).includes(elsewhere), st.out);
			check(`${tag} luxas status: the dead host's entry is listed as gone with its host`, line(st.gone, replicator).includes(`died with its host pid ${deadHost}`), st.out);
		}
		// run.pid is this process now: only the brain's own work dies with a restart.
		check("§C52b run.pid alive: the brain's own reader is in flight, a restart kills it",
			line(tools.summarizeRunStatus(g), reader).includes(`in-process with brain pid ${process.pid}, in flight; a restart kills it`), line(tools.summarizeRunStatus(g), reader));

		// Resume: this process is the new brain.
		const said = AA.reconcileOrphans(g, agentDir) as string[];
		const first = (prefix: string) => said.find((l) => l.startsWith(prefix)) ?? "";
		const all = said.join("\n---\n");
		check("§C52b resume: the live review is still running in its pid, not Lost",
			!!first(`[Still running in pid ${rePid}: experiment_reviewer] ${reviewer}`) && !first("[Lost: experiment_reviewer]") && !first("[Recovered: experiment_reviewer]"), all);
		check("§C52b resume: the live runner's revision is still running inside it, not Lost or Completed",
			first(`[Still running in pid ${runnerPid}: experiment] ${revision}`).includes(runner)
				&& !first("[Lost: experiment]") && !first("[Recovered: experiment]") && !first("[Completed on disk"), all);
		check("§C52b resume: an entry whose host died is Lost", !!first("[Lost: replicator]"), all);
		check("§C52b resume: an entry hosted by the resuming process itself is not kept", !!first("[Lost: reader]"), all);
		const kept = AA.loadRegistry(agentDir).map((a: any) => a.id).sort();
		check("§C52b resume keeps the runner and the two live-hosted entries, removes the rest",
			JSON.stringify(kept) === JSON.stringify([runner, revision, reviewer].sort()), JSON.stringify(kept));

		// The zombie sweeps (finish's and idle's) must agree with the resume.
		// Seeded afresh before each, so no check rides on the one before it.
		const seed = () => writeFileSync(join(agentDir, "active-agents.json"), JSON.stringify([
			entry(reviewer, "experiment_reviewer", "foreground", { hostPid: rePid }),
			entry(runner, "experiment", "background", { pid: runnerPid }),
			entry(revision, "experiment", "foreground", { hostPid: runnerPid }),
		]));
		const { getActiveBackgroundAgents } = await import(join(ROOT, "src/tools/spawn-agent.js"));
		const { waitAndHarvestBackground } = await import(join(ROOT, "src/tools/index.js"));
		const statusOf = (id: string) => AA.loadRegistry(agentDir).find((a: any) => a.id === id)?.status;
		seed();
		const active = getActiveBackgroundAgents(g).map((a: any) => a.id);
		check("§C52b finish's sweep keeps both live-hosted entries running",
			active.includes(reviewer) && active.includes(revision) && statusOf(reviewer) === "running" && statusOf(revision) === "running", JSON.stringify(AA.loadRegistry(agentDir)));
		seed();
		// Past idle's 90 s grace (startedAt is 120 s back); one poll, then the harvest.
		const blob = await waitAndHarvestBackground(g, 1_500);
		check("§C52b idle's sweep reports no live-hosted entry as failed",
			!/Background Agent Failed/.test(blob) && statusOf(reviewer) === "running" && statusOf(revision) === "running", blob);
		// Not immortal: once its host is gone the sweep fails it as before.
		const h0 = hosts[0];
		if (h0.exitCode === null && h0.signalCode === null) await new Promise((r) => { h0.once("exit", r); h0.kill("SIGKILL"); });
		seed();
		getActiveBackgroundAgents(g);
		check("§C52b once its host dies, finish's sweep marks the entry failed", statusOf(reviewer) === "failed", String(statusOf(reviewer)));

		// A studio launch: luxas-studio writes run.pid as the pid of the tsx
		// wrapper it spawned, and the brain runs in tsx's inner node process,
		// so the brain's own fan-out never has hostPid === run.pid. A real
		// wrapper here, not a stand-in: what matters is the process tree tsx makes.
		const innerPidFile = join(g, "inner.pid");
		writeFileSync(join(g, "inner.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(innerPidFile)}, process.pid + " " + process.ppid);\nsetTimeout(() => {}, 60_000);\n`);
		const wrapper = spawn(join(ROOT, "node_modules", ".bin", "tsx"), [join(g, "inner.mjs")], { stdio: "ignore" });
		hosts.push(wrapper);
		for (let i = 0; i < 200 && !existsSync(innerPidFile); i++) await new Promise((r) => setTimeout(r, 50));
		const [innerPid, innerPpid] = existsSync(innerPidFile) ? readFileSync(innerPidFile, "utf-8").split(" ").map(Number) : [0, 0];
		const pidUp = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
		const studioReader = "brain.reader-s0";
		writeFileSync(join(agentDir, "active-agents.json"), JSON.stringify([
			entry(studioReader, "reader", "parallel", { hostPid: innerPid, hostPpid: innerPpid }),
			// A runner that crashed after the brain spawned it: its parent is the
			// brain, but the brain is alive and the entry's own host is not.
			entry(replicator, "replicator", "foreground", { hostPid: deadHost, hostPpid: wrapper.pid }),
		]));
		setBrainPid(wrapper.pid!);
		const studio = tools.summarizeRunStatus(g);
		check("§C52b studio launch: the brain's reader is in flight with the brain, a restart kills it",
			innerPid > 0 && line(studio, studioReader).includes(`in-process with brain pid ${wrapper.pid}, in flight; a restart kills it`), `wrapper ${wrapper.pid}, inner ${innerPid}: ${line(studio, studioReader)}`);
		check("§C52b studio launch: a dead host whose parent is the live brain died with its host, not the brain",
			line(studio, replicator).includes(`died with its host pid ${deadHost}`), line(studio, replicator));
		// Stopping the run stops the wrapper, and tsx takes the brain down with it.
		wrapper.kill("SIGTERM");
		for (let i = 0; i < 100 && (pidUp(wrapper.pid!) || pidUp(innerPid)); i++) await new Promise((r) => setTimeout(r, 50));
		check("§C52b studio launch: once the run is stopped, the reader died with the brain",
			!pidUp(innerPid) && line(tools.summarizeRunStatus(g), studioReader).includes(`died with the brain (pid ${wrapper.pid} gone)`), line(tools.summarizeRunStatus(g), studioReader));
		if (pidUp(innerPid)) process.kill(innerPid, "SIGKILL");

		// Producer: spawnAgent records the process it runs in. Every pi-ai API is
		// scripted, fetch is blocked, HOME is empty; the reply reads the registry mid-spawn.
		const { getApiProviders, registerApiProvider } = await import("@earendil-works/pi-ai/compat");
		const { spawnAgent } = await import(join(ROOT, "src/agents/spawn.js"));
		let during: any[] = [];
		const scripted = (model: any) => {
			during = AA.loadRegistry(agentDir);
			const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }], api: model.api, provider: model.provider, model: model.id,
				timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, result: async () => msg };
		};
		for (const p of getApiProviders()) registerApiProvider({ api: p.api, stream: scripted, streamSimple: scripted } as any, "smoke-monitor-c52b");
		(globalThis as any).fetch = async () => { throw new Error("smoke_monitor: network blocked"); };
		process.env.HOME = join(g, "home");
		delete process.env.LUXAS_MODEL_PROFILE;
		const r = await spawnAgent({ name: "replicator", projectDir: g, getApiKey: () => "offline", templateVars: { PROJECT_DIR: g }, prompt: "Estimate q.", parentAgentId: "review_experiment.E2_x" });
		const mine = during.find((a: any) => a.id === r.agentId);
		check("§C52b spawnAgent registers its in-process entry with this process as host, and its parent",
			!!mine && mine.hostPid === process.pid && mine.hostPpid === process.ppid && mine.pid === undefined, `${r.agentId}: ${JSON.stringify(mine)}`);
	} finally {
		if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
		if (profile !== undefined) process.env.LUXAS_MODEL_PROFILE = profile;
		globalThis.fetch = fetch0;
		for (const h of hosts) h.kill("SIGKILL");
		rmSync(g, { recursive: true, force: true });
	}
}

// ── §C2 a restored chat sends the current monitor prompt ─────────────
// pi 0.87 keeps the prompt and tool declarations in a leading role:"system"
// message. Restoring the stored chat over it sent the first turn's stored
// prompt, or nothing once trimHistory had cut it. Real runMonitorTurn; every
// pi-ai API is scripted, HOME points at an empty dir so no credential is read.
{
	const { getApiProviders, registerApiProvider } = await import("@earendil-works/pi-ai/compat");
	const { getCurrentSystemPrompt } = await import(join(ROOT, "node_modules/@earendil-works/pi-ai/dist/utils/transcript.js"));
	const { Session } = await import(join(ROOT, "src/session.js"));
	const { getDefinition, resolvePrompt } = await import(join(ROOT, "src/agents/registry.js"));
	const sent: any[][] = [];
	const scripted = (model: any, ctx: any) => {
		sent.push(ctx.messages);
		const msg = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "(scripted monitor reply)" }], api: model.api, provider: model.provider, model: model.id,
			timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		return { async *[Symbol.asyncIterator]() { yield { type: "done" }; }, result: async () => msg };
	};
	for (const p of getApiProviders()) registerApiProvider({ api: p.api, stream: scripted, streamSimple: scripted } as any, "smoke-monitor");
	(globalThis as any).fetch = async () => { throw new Error("smoke_monitor: network blocked"); };
	const home = process.env.HOME;
	const scratch = mkdtempSync(join(tmpdir(), "luxas-monitor-c2-"));
	process.env.HOME = join(scratch, "home");
	delete process.env.LUXAS_MODEL_PROFILE;
	const stored = (file: string) => readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e: any) => e.type === "message");
	try {
		for (const pairs of [5, 35]) {
			const proj = mkdtempSync(join(scratch, "proj-"));
			mkdirSync(join(proj, ".agent", "monitor"), { recursive: true });
			writeFileSync(join(proj, "RESEARCH.md"), "# Goal\nMeasure X.\n");
			const file = join(proj, ".agent", "monitor", "session.jsonl");
			const s = Session.open(file, proj);
			s.appendMessage({ role: "system", content: "OLD MONITOR PROMPT", toolsAdded: [{ name: "read", description: "x", parameters: { type: "object" } }], timestamp: 0 });
			for (let i = 0; i < pairs; i++) {
				s.appendMessage({ role: "user", content: `q${i}`, timestamp: i });
				s.appendMessage({ role: "assistant", content: [{ type: "text", text: `a${i}` }], stopReason: "stop", api: "x", provider: "x", model: "x", timestamp: i });
			}
			const before = stored(file).length;
			const want = resolvePrompt(getDefinition("monitor"), { PROJECT_DIR: proj, SPAWN_ID: "monitor" });
			const nBefore = sent.length;
			const code = await runner.runMonitorTurn({ project: proj, message: "status?" });
			// Without this turn's own request the checks below would read the previous one.
			const req = sent[nBefore] ?? [];
			const sys = getCurrentSystemPrompt(req) ?? "";
			const tag = `§C2 system + ${pairs * 2} stored messages`;
			check(`${tag}: turn completed`, code === 0, `code ${code}`);
			check(`${tag}: the turn reached the provider`, sent.length > nBefore, `${sent.length - nBefore} request(s)`);
			check(`${tag}: the request carries the current monitor prompt, not the stored one`, sys.length > 1000 && sys === want, `${sys.length} chars: ${JSON.stringify(sys.slice(0, 40))}`);
			check(`${tag}: exactly one system message in the request`, req.filter((m: any) => m.role === "system").length === 1, `${req.filter((m: any) => m.role === "system").length}`);
			const added = stored(file).slice(before).map((e: any) => e.message.role);
			check(`${tag}: the session gains exactly [user, assistant]`, JSON.stringify(added) === JSON.stringify(["user", "assistant"]), JSON.stringify(added));
		}
	} finally {
		if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nsmoke_monitor: all checks passed");
