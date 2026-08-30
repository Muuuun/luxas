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
 *
 * Run:  npx tsx scripts/smoke_monitor.mts
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nsmoke_monitor: all checks passed");
