/**
 * Gate runner: the single consumer for the assertion scripts under scripts/.
 *
 * Before this existed, ~50 smoke_*.mts files were produced and never read —
 * the orphan-mechanism failure CLAUDE.md warns about, applied to the tests
 * themselves. This file is that missing consumer.
 *
 * Usage:
 *   npm test                       # every keyless assert gate
 *   npx tsx scripts/run-gates.mts --list
 *   npx tsx scripts/run-gates.mts --only cache_pin,write_scope
 *   npx tsx scripts/run-gates.mts --jobs 1        # serial, for debugging
 *   npx tsx scripts/run-gates.mts --live          # also run real-model gates (slow, billable)
 *
 * MANIFEST is exhaustive by construction: an unlisted scripts/smoke_*.mts is a
 * hard error, not a silent skip, so a new gate cannot become an orphan the way
 * its predecessors did.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");

/**
 * `assert` gates verify behavior offline and gate `npm test`.
 * `live` gates drive a real model: correct, but slow and billable, so they run
 * only under --live (dsh's separate real-API lane, for the same reason).
 * `experiment` scripts measure behavior and never fail.
 */
type Kind = "assert" | "live" | "experiment";

interface GateSpec {
	kind: Kind;
	/** Env vars that must be set, else the gate self-skips (keyless runs stay green). */
	needsKey?: string[];
	timeoutMs?: number;
	/** Why an experiment script is not an assert gate. */
	note?: string;
}

const MANIFEST: Record<string, GateSpec> = {
	// ── assert gates ────────────────────────────────────────────────────────
	smoke_active_agents_lock: { kind: "assert" },
	smoke_agent_defs: { kind: "assert" },
	smoke_agent_loop_patches: { kind: "assert", timeoutMs: 180_000 },
	smoke_allowed_write_roots: { kind: "assert" },
	smoke_atomic_counter: { kind: "assert" },
	smoke_bash_status_truth: { kind: "assert" },
	smoke_bash_write_guard: { kind: "assert" },
	smoke_benchmarks_discovery: { kind: "assert" },
	smoke_brain_context: { kind: "assert" },
	smoke_cache_pin: { kind: "assert" },
	smoke_cache_pin_luxas: { kind: "assert" },
	smoke_carry_forward_attachments: { kind: "assert" },
	smoke_career: { kind: "assert" },
	smoke_claim_registry: { kind: "assert" },
	smoke_compaction_ratchet: { kind: "assert" },
	smoke_dual_profile: { kind: "assert" },
	smoke_edit_noop_guard: { kind: "assert" },
	smoke_experiment_paths: { kind: "assert" },
	smoke_figlint: { kind: "assert", timeoutMs: 180_000 },
	smoke_figstyle_scaffold: { kind: "assert" },
	smoke_file_context_cache: { kind: "assert" },
	smoke_finish_gate: { kind: "assert" },
	smoke_illustrator_per_spawn: { kind: "assert" },
	smoke_language_gate: { kind: "assert" },
	smoke_length_recovery: { kind: "assert" },
	smoke_merge_notes_normalize: { kind: "assert" },
	smoke_meta_registry: { kind: "assert" },
	smoke_meta_spawn_wiring: { kind: "assert" },
	smoke_meta_state: { kind: "assert" },
	smoke_observations: { kind: "assert" },
	smoke_premise_corrections: { kind: "assert" },
	smoke_xval_dispute_gate: { kind: "assert" },
	smoke_claim_table: { kind: "assert" },
	smoke_claims_review: { kind: "assert" },
	smoke_claim_table_legacy: { kind: "assert" },
	smoke_open_discrepancies: { kind: "assert" },
	smoke_claims_compliance: { kind: "assert" },
	smoke_claims_dispatch: { kind: "assert" },
	smoke_cost_cap: { kind: "assert" },
	smoke_claim_table_colocated: { kind: "assert" },
	smoke_overflow_backstop: { kind: "assert" },
	smoke_prior_art_gate: { kind: "assert" },
	smoke_prompt_assembly: { kind: "assert" },
	smoke_read_scope: { kind: "assert" },
	smoke_reader_merge: { kind: "assert", timeoutMs: 120_000 },
	smoke_spawn_cycle_static: { kind: "assert" },
	smoke_subagent_exit: { kind: "assert" },
	smoke_synthesis_owner: { kind: "assert" },
	smoke_tool_pruner_defaults: { kind: "assert" },
	smoke_transient_retry: { kind: "assert" },

	smoke_validate_observation_parse: { kind: "assert" },
	smoke_validate_pending_merge: { kind: "assert" },
	smoke_validate_session_path: { kind: "assert" },
	smoke_write_scope: { kind: "assert" },
	smoke_write_time_validation: { kind: "assert" },
	smoke_xval_coverage: { kind: "assert" },

	// ── live-model gates: --live only ───────────────────────────────────────
	smoke_typesetter: { kind: "live", timeoutMs: 600_000, note: "drives the typesetter agent end to end" },

	smoke_brain_guards: { kind: "live", needsKey: ["ANTHROPIC_API_KEY"], timeoutMs: 300_000 },
	smoke_credential_guard: { kind: "live", needsKey: ["ANTHROPIC_API_KEY"], timeoutMs: 300_000 },
	smoke_deepseek_web: { kind: "live", needsKey: ["DEEPSEEK_API_KEY"], timeoutMs: 300_000 },

	// ── measurement scripts, not gates ──────────────────────────────────────
	smoke_bib_dedup: { kind: "experiment", note: "A1/A2 trial harness; reports collision counts, asserts nothing" },
	smoke_model_diff: { kind: "experiment", note: "cross-model prompt comparison; needs a key and reports diffs" },
	smoke_model_diff_C: { kind: "experiment", note: "condition-C variant of smoke_model_diff" },
};

/** Output lines that mean failure in scripts that exit 0 regardless. */
const FAIL_LINE = /^\s*(?:✗|FAIL\b|FAILED\b)/m;

interface Result {
	name: string;
	status: "pass" | "fail" | "skip";
	ms: number;
	reason?: string;
	output?: string;
}

function runGate(name: string, spec: GateSpec): Promise<Result> {
	const missing = (spec.needsKey ?? []).filter((k) => !process.env[k]);
	if (missing.length > 0) {
		return Promise.resolve({ name, status: "skip", ms: 0, reason: `needs ${missing.join(", ")}` });
	}
	const started = Date.now();
	return new Promise((resolve) => {
		const child = spawn("npx", ["tsx", join(SCRIPTS, `${name}.mts`)], {
			cwd: ROOT,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));

		const timeoutMs = spec.timeoutMs ?? 60_000;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.on("close", (code) => {
			clearTimeout(timer);
			const ms = Date.now() - started;
			// Orthogonal outcomes reported independently: a gate can both time out
			// and exit 0, and a gate can exit 0 while printing ✗.
			if (timedOut) return resolve({ name, status: "fail", ms, reason: `timed out after ${timeoutMs}ms`, output: out });
			if (code !== 0) return resolve({ name, status: "fail", ms, reason: `exit ${code}`, output: out });
			const m = out.match(FAIL_LINE);
			if (m) return resolve({ name, status: "fail", ms, reason: `failure line: ${m[0].trim()}`, output: out });
			resolve({ name, status: "pass", ms });
		});
	});
}

async function pool<T, R>(items: T[], jobs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(jobs, items.length) }, async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return results;
}

function arg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
	// The manifest must account for every gate-shaped script on disk.
	const onDisk = readdirSync(SCRIPTS)
		.filter((f) => f.startsWith("smoke_") && f.endsWith(".mts"))
		.map((f) => basename(f, ".mts"));
	const unlisted = onDisk.filter((n) => !(n in MANIFEST));
	const missingFile = Object.keys(MANIFEST).filter((n) => !onDisk.includes(n));
	if (unlisted.length || missingFile.length) {
		if (unlisted.length) console.error(`run-gates: unlisted gate script(s): ${unlisted.join(", ")}\n  Add them to MANIFEST in scripts/run-gates.mts.`);
		if (missingFile.length) console.error(`run-gates: MANIFEST names missing file(s): ${missingFile.join(", ")}`);
		process.exit(2);
	}

	if (process.argv.includes("--list")) {
		for (const [name, spec] of Object.entries(MANIFEST).sort()) {
			const tag = spec.kind === "assert" ? "assert" : spec.needsKey ? `${spec.kind} (${spec.needsKey.join("+")})` : spec.kind;
			console.log(`${name.padEnd(40)} ${tag}${spec.note ? ` — ${spec.note}` : ""}`);
		}
		return;
	}

	const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
	const jobs = Number(arg("--jobs") ?? 4);
	const live = process.argv.includes("--live");

	let selected = Object.entries(MANIFEST).filter(([, s]) => s.kind === "assert" || (live && s.kind === "live"));
	if (only) selected = selected.filter(([n]) => only.some((o) => n.includes(o)));

	if (selected.length === 0) {
		console.error("run-gates: no gates selected");
		process.exit(2);
	}

	console.log(`run-gates: ${selected.length} gate(s), jobs=${jobs}\n`);
	const results = await pool(selected, jobs, async ([name, spec]) => {
		const r = await runGate(name, spec);
		const mark = r.status === "pass" ? "✓" : r.status === "skip" ? "-" : "✗";
		console.log(`${mark} ${name.padEnd(40)} ${r.status === "skip" ? r.reason : `${r.ms}ms`}`);
		return r;
	});

	const failed = results.filter((r) => r.status === "fail");
	const skipped = results.filter((r) => r.status === "skip");
	const passed = results.filter((r) => r.status === "pass");

	for (const f of failed) {
		console.log(`\n${"─".repeat(70)}\n✗ ${f.name} — ${f.reason}\n${"─".repeat(70)}`);
		console.log((f.output ?? "").trimEnd().split("\n").slice(-40).join("\n"));
	}

	console.log(`\nrun-gates: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
	if (skipped.length) console.log(`  skipped: ${skipped.map((s) => s.name).join(", ")}`);
	process.exit(failed.length > 0 ? 1 : 0);
}

main();
