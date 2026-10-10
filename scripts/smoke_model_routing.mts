/**
 * smoke_model_routing — every agent must route to a model that exists AND to a
 * provider this installation can actually authenticate.
 *
 * Two real incidents this catches:
 *
 *  1. Hollow model ids. Asking pi-ai's catalog for an id it does not carry
 *     returns an object with an undefined `id` rather than throwing, so a typo
 *     or a dropped catalog tier becomes a run that dies on its first turn with
 *     a confusing error. (claude-fable-5.1 hit this; see the MODEL_MAP comment.)
 *
 *  2. Routing to a provider with no credential. `math` sat on
 *     ["openai-codex", "gpt-5.6-terra"] while ~/.sisyphus/auth.json carried no
 *     openai-codex slot — the platform key and the Codex OAuth token are not
 *     interchangeable. Both brain and experiment can spawn `math`, so every
 *     spawn died on turn 1. Same armed-hazard class as the Kimi 404 that killed
 *     eight figure spawns mid-run and the dry GLM account.
 *
 * The credential half reads the real auth file when it is present and self-skips
 * when it is not, so a keyless checkout stays green while the machines that
 * actually launch runs get the check that matters.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAgentDefinitions } from "../src/agents/registry.ts";
import { resolveModel, listRoutedModels, registerBenchModel } from "../src/agents/spawn.ts";
// §5 reads routeAllAgents / unresolvedRoutes through the namespace so a missing
// export shows up as counted failures beside the wiring checks, not an import crash.
import * as spawnModule from "../src/agents/spawn.ts";
import { applyDualProfileEnv } from "../src/profiles.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

// ── 1. every agent resolves to a real model id ──────────────────────────
const defs = loadAgentDefinitions();
check("agent definitions load", defs.size > 0, `${defs.size} definitions`);

const hollow: string[] = [];
for (const [name, def] of defs) {
  let id = "";
  try {
    const m: any = resolveModel((def as any).model, name);
    id = String(m?.id ?? m?.model?.id ?? "");
  } catch (e: any) {
    id = "";
  }
  if (!id) hollow.push(`${name} → ${(def as any).model}`);
}
check("no agent resolves to a hollow model (undefined id)", hollow.length === 0, hollow.join(", "));

// ── 2. no agent routes to a provider with no credential slot ────────────
// openai-codex needs a Codex OAuth token, which is not part of the standard auth
// set. The same GPT-5.x models are available under `openai` at the same price, so
// routing there is never necessary unless that token is deliberately installed.
const routed = listRoutedModels();
check("routing table is non-empty", routed.length > 0, `${routed.length} models`);

const codex = routed.filter((r) => r.provider === "openai-codex");
check(
  "no agent routes to openai-codex (needs a Codex OAuth token; use provider `openai` for the same models)",
  codex.length === 0,
  codex.map((r) => `${r.id} used by ${r.usedBy.join("/")}`).join("; "),
);

// ── 3. against the real auth file, when there is one ────────────────────
const authPath = join(homedir(), ".sisyphus", "auth.json");
if (!existsSync(authPath)) {
  console.log("• credential check skipped (no ~/.sisyphus/auth.json — keyless checkout)");
} else {
  let slots: string[] = [];
  try {
    slots = Object.keys(JSON.parse(readFileSync(authPath, "utf-8")));
  } catch (e: any) {
    check("auth.json parses", false, String(e?.message).slice(0, 80));
  }
  // provider id as pi-ai reports it → the auth.json slot that serves it
  const SLOT: Record<string, string> = {
    anthropic: "anthropic",
    deepseek: "deepseek",
    openai: "openai",
    "openai-codex": "openai-codex",
    glm: "glm",
    zai: "glm",
    "zai-coding-cn": "glm",
    moonshotai: "kimi",
    "moonshotai-cn": "kimi",
    "kimi-coding": "kimi",
  };
  const missing: string[] = [];
  for (const r of routed) {
    const slot = SLOT[r.provider];
    if (!slot) { missing.push(`${r.provider} (no known auth slot) → ${r.usedBy.join("/")}`); continue; }
    if (!slots.includes(slot)) missing.push(`${r.provider} needs slot "${slot}" → ${r.usedBy.join("/")}`);
  }
  check(
    "every routed provider has a credential slot in auth.json",
    missing.length === 0,
    missing.join("; "),
  );
  console.log(`  (auth slots present: ${slots.join(", ")})`);
}

// ── 4. the specific regression: math must be reachable ──────────────────
const mathDef = defs.get("math");
if (!mathDef) {
  check("math agent definition exists", false);
} else {
  const m: any = resolveModel((mathDef as any).model, "math");
  check(
    "math routes to a provider with a credential (was openai-codex with no token; every spawn died on turn 1)",
    m?.provider === "openai" && String(m?.id ?? "").length > 0,
    `provider=${m?.provider} id=${m?.id}`,
  );
}

// ── 5. C20: an agent whose route does not resolve is reported, not dropped ──
// listRoutedModels skips an agent whose resolveModel throws or comes back with
// no id, so a typo'd LUXAS_READER_MODEL left the reader out of the routing table,
// out of the liveness check and out of the canary; the run launched and every
// reader spawn threw. The launch must name each such agent and refuse.
type Unresolved = { agent: string; error: string };
const routing: any = spawnModule;
const unresolvedNow = (): Unresolved[] => routing.unresolvedRoutes?.() ?? [];
const ROUTING_ENV = [
  "LUXAS_MODEL_PROFILE", "LUXAS_VISION_MODEL_PROFILE", "LUXAS_VISION_AUDIT_MODEL_PROFILE",
  "LUXAS_BRAIN_MODEL", "LUXAS_READER_MODEL", "LUXAS_EXECUTOR_MODEL", "LUXAS_TOOL_REVIEW_MODEL",
  "LUXAS_EXPERIMENT_MODE",
];
const savedRouting = Object.fromEntries(ROUTING_ENV.map((k) => [k, process.env[k]]));
function routingCase(env: Record<string, string>, dual: boolean) {
  for (const k of ROUTING_ENV) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  if (dual) applyDualProfileEnv({ setBrain: true });
}
const allAgents = [...defs.keys()];
function uncovered(un: Unresolved[]): string[] {
  const routedTo = new Set(listRoutedModels().flatMap((r) => r.usedBy));
  return allAgents.filter((n) => !routedTo.has(n) && !un.some((u) => u.agent === n));
}

try {
  for (const [label, env, victim] of [
    ["LUXAS_READER_MODEL typo", { LUXAS_READER_MODEL: "deepseek-flahs" }, "reader"],
    ["LUXAS_TOOL_REVIEW_MODEL typo", { LUXAS_TOOL_REVIEW_MODEL: "glm-5.2x" }, "tool_review"],
    ["solo LUXAS_EXECUTOR_MODEL typo", { LUXAS_EXPERIMENT_MODE: "solo", LUXAS_EXECUTOR_MODEL: "claude-opus-5.5" }, "experiment"],
  ] as const) {
    routingCase(env, true);
    const un = unresolvedNow();
    const hit = un.find((u) => u.agent === victim);
    check(`C20 dual, ${label}: ${victim} reported by unresolvedRoutes() with "unknown model"`,
      !!hit && /unknown model/.test(hit.error), JSON.stringify(un).slice(0, 200));
    const missing = uncovered(un);
    check(`C20 dual, ${label}: every definition is routed or reported`, missing.length === 0, `missing: ${missing.join(", ")}`);
  }

  // pi-ai's getModel returns undefined for an id its catalog lacks; that is a
  // route too, and must not pass as resolved.
  registerBenchModel("__c20_hollow", ["anthropic", "no-such-model-id"] as any);
  routingCase({ LUXAS_TOOL_REVIEW_MODEL: "__c20_hollow" }, true);
  {
    const un = unresolvedNow();
    check("C20 hollow catalog id: tool_review reported as a hollow model",
      un.some((u) => u.agent === "tool_review" && /hollow/.test(u.error)), JSON.stringify(un).slice(0, 200));
  }

  // A definition without `model:` is "inherit" and spawns on the sonnet tier.
  routingCase({}, false);
  {
    const probe = new Map([["__c20_inherit", { ...defs.get("reader")!, name: "__c20_inherit", model: "inherit" }]]);
    const r = routing.routeAllAgents?.(probe);
    const sonnetId = String((resolveModel("sonnet", "__c20_inherit") as any)?.id ?? "");
    check("C20 inherit definition is routed on the sonnet tier, not reported",
      !!r && r.unresolved.length === 0 && r.rows.some((row: any) => row.id === sonnetId && row.usedBy.includes("__c20_inherit")),
      JSON.stringify(r ?? null).slice(0, 200));
  }

  // A healthy launch must not be refused.
  for (const [label, env, dual] of [
    ["dual pipeline", {}, true],
    ["dual solo", { LUXAS_EXPERIMENT_MODE: "solo" }, true],
    ["claude profile", {}, false],
  ] as const) {
    routingCase(env, dual);
    const un = unresolvedNow();
    check(`C20 ${label}: 0 unresolved routes`, un.length === 0, JSON.stringify(un).slice(0, 200));
    const missing = uncovered(un);
    check(`C20 ${label}: routing table covers all ${allAgents.length} definitions`, missing.length === 0, `missing: ${missing.join(", ")}`);
  }
} finally {
  for (const k of ROUTING_ENV) {
    if (savedRouting[k] === undefined) delete process.env[k];
    else process.env[k] = savedRouting[k];
  }
}

// The launch consults it inside run() before the LUXAS_SKIP_MODEL_CHECK block:
// the check is offline and deterministic, and autofix cannot repair a route.
// Sliced, because the `luxas models` block comes first in the file and a
// whole-file search would be satisfied by it alone.
{
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
  const runStart = src.indexOf("async function run(");
  const skip = src.indexOf('LUXAS_SKIP_MODEL_CHECK !== "1"', runStart);
  const preflight = runStart > 0 && skip > runStart ? src.slice(runStart, skip) : "";
  const call = preflight.indexOf("unresolvedRoutes(");
  check("C20 run() refuses on unresolvedRoutes() before the LUXAS_SKIP_MODEL_CHECK block",
    call >= 0 && preflight.slice(call).includes("process.exit(1)"), `run@${runStart} skip@${skip}`);
  const modelsStart = src.indexOf('if (command === "models")');
  const modelsEnd = src.indexOf('if (command === "status")', modelsStart);
  check("C20 `luxas models` reports unresolvedRoutes()",
    modelsStart >= 0 && modelsEnd > modelsStart && src.slice(modelsStart, modelsEnd).includes("unresolvedRoutes("));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — every agent resolves to a real model on a provider this install can authenticate.");
