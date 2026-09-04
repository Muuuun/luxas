/**
 * smoke_model_check — the freshness/liveness detector, tested against the three
 * failures it exists to catch. Each case is a real incident, replayed from the
 * catalogs as they actually were, so this is a detector test, not a self-test.
 *
 * Offline by construction: compareCatalog is pure and the "listed" arrays are
 * fixtures, so the gate never touches the network.
 */
import { parseModelId, isNewer, compareCatalog, formatFindings } from "../src/model-check.ts";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails++;
}

// ── version parsing ────────────────────────────────────────────────────
check("claude-sonnet-5 parses as family claude-sonnet v[5]",
  JSON.stringify(parseModelId("claude-sonnet-5")) === JSON.stringify({ family: "claude-sonnet", version: [5] }),
  JSON.stringify(parseModelId("claude-sonnet-5")));
check("claude-sonnet-4-6 shares that family at v[4,6]",
  parseModelId("claude-sonnet-4-6").family === "claude-sonnet");
check("5 outranks 4.6 (shorter but larger)", isNewer([5], [4, 6]));
check("4.6 does not outrank 5", !isNewer([4, 6], [5]));
check("a dated snapshot is NOT newer than its base id",
  !isNewer(parseModelId("claude-haiku-4-5-20251001").version, parseModelId("claude-haiku-4-5").version),
  JSON.stringify(parseModelId("claude-haiku-4-5-20251001")));
// Tier words must keep separate lineages or flash would "upgrade" to pro.
check("deepseek pro and flash are different families",
  parseModelId("deepseek-v4-pro").family !== parseModelId("deepseek-v4-flash").family);
check("glm-5.3 and glm-5.3-flash are different families",
  parseModelId("glm-5.3").family !== parseModelId("glm-5.3-flash").family);
check("opus and sonnet are different families",
  parseModelId("claude-opus-5").family !== parseModelId("claude-sonnet-5").family);

// ── incident 1: the Anthropic pins sat on 4.6 from 2026-03-31 to 2026-09-04 ──
{
  const listed = ["claude-haiku-4-5", "claude-opus-4-6", "claude-opus-5", "claude-sonnet-4-6", "claude-sonnet-5", "claude-fable-5"];
  const f = compareCatalog("anthropic", [
    { id: "claude-sonnet-4-6", usedBy: ["figure_auditor"] },
    { id: "claude-opus-4-6", usedBy: ["reviewer"] },
  ], listed);
  const sonnet = f.find((x) => x.kind === "newer" && (x as any).pinned === "claude-sonnet-4-6") as any;
  const opus = f.find((x) => x.kind === "newer" && (x as any).pinned === "claude-opus-4-6") as any;
  check("would have caught sonnet-4-6 → sonnet-5", sonnet?.candidate === "claude-sonnet-5", JSON.stringify(sonnet));
  check("would have caught opus-4-6 → opus-5", opus?.candidate === "claude-opus-5", JSON.stringify(opus));
  check("does NOT propose fable as an opus upgrade (different family)",
    !f.some((x) => (x as any).candidate === "claude-fable-5"));
}

// ── incident 2: kimi-k2.5 started 404ing mid-run on 2026-08-31 ──────────
{
  const listed = ["moonshot-v1-8k", "moonshot-v1-32k", "kimi-k2"];   // k2.5 gone
  const f = compareCatalog("kimi-coding", [
    { id: "kimi-k2.5", usedBy: ["illustrator", "illustrator_write", "typesetter"] },
  ], listed);
  const dead = f.find((x) => x.kind === "dead") as any;
  check("would have caught kimi-k2.5 disappearing from the catalog",
    dead?.pinned === "kimi-k2.5", JSON.stringify(f));
  check("names the agents that would have died with it",
    dead?.usedBy?.includes("illustrator_write"));
}

// ── incident 3: the GLM catalog moved on while tool_review sat on 5.2 ───
{
  const listed = ["glm-4.5", "glm-4.7", "glm-5", "glm-5.1", "glm-5.2", "glm-5.3", "glm-5.3-flash"];
  const f = compareCatalog("glm", [{ id: "glm-5.2", usedBy: ["tool_review"] }], listed);
  const newer = f.find((x) => x.kind === "newer") as any;
  check("would have caught glm-5.2 → glm-5.3", newer?.candidate === "glm-5.3", JSON.stringify(f));
  check("picks the HIGHEST candidate, not merely the first",
    newer?.candidate === "glm-5.3" && newer?.candidate !== "glm-5.1");
}

// ── quiet when the pins are current ────────────────────────────────────
{
  const listed = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
  const f = compareCatalog("anthropic", [
    { id: "claude-opus-5", usedBy: ["reviewer"] },
    { id: "claude-sonnet-5", usedBy: ["figure_auditor"] },
  ], listed);
  check("no findings when every pin is current", f.length === 0, JSON.stringify(f));
  check("formatFindings says so plainly", formatFindings(f).startsWith("✓"));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS — detector catches the stale pin, the dead model, and the newer sibling.");
