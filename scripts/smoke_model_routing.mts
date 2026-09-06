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
import { resolveModel, listRoutedModels } from "../src/agents/spawn.ts";

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

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — every agent resolves to a real model on a provider this install can authenticate.");
