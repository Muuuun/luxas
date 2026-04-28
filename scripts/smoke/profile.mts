import { resolveModel } from "../../src/agents/spawn.js";

function check(label: string, modelKey: string, expectId: string, expectProvider: string) {
  const m: any = resolveModel(modelKey);
  const ok = m.id === expectId && m.provider === expectProvider;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(45)} -> ${m.id} (${m.provider})`);
  if (!ok) {
    console.log(`  expected: ${expectId} (${expectProvider})`);
    process.exitCode = 1;
  }
}

console.log("=== profile=unset (today's behavior) ===");
delete process.env.LUXAS_MODEL_PROFILE;
check("opus", "opus", "claude-opus-4-6", "anthropic");
check("sonnet", "sonnet", "claude-sonnet-4-6", "anthropic");
check("haiku", "haiku", "claude-haiku-4-5-20251001", "anthropic");
check("gpt-5.2", "gpt-5.2", "gpt-5.2", "openai-codex");
check("deepseek-v4-flash", "deepseek-v4-flash", "deepseek-v4-flash", "deepseek");

console.log("\n=== profile=deepseek-v4-flash ===");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-flash";
check("opus -> deepseek-v4-flash", "opus", "deepseek-v4-flash", "deepseek");
check("sonnet -> deepseek-v4-flash", "sonnet", "deepseek-v4-flash", "deepseek");
check("haiku -> deepseek-v4-flash", "haiku", "deepseek-v4-flash", "deepseek");
check("gpt-5.2 (preserved)", "gpt-5.2", "gpt-5.2", "openai-codex");
check("o3 (preserved)", "o3", "o3", "openai");
check("deepseek-v4-pro (passthrough)", "deepseek-v4-pro", "deepseek-v4-pro", "deepseek");

console.log("\n=== profile=deepseek-v4-pro ===");
process.env.LUXAS_MODEL_PROFILE = "deepseek-v4-pro";
check("opus -> deepseek-v4-pro", "opus", "deepseek-v4-pro", "deepseek");
check("sonnet -> deepseek-v4-pro", "sonnet", "deepseek-v4-pro", "deepseek");
check("gpt-5.2 (preserved)", "gpt-5.2", "gpt-5.2", "openai-codex");

console.log("\nDone.");
