// Smoke test: verify spawn_agent's task/tasks normalization rejects
// bad inputs with clear messages. Does NOT exercise valid paths
// (those would trigger real agent spawns).
import { createSpawnAgentTool } from "../src/tools/spawn-agent.js";

const tool = createSpawnAgentTool("/tmp", {}, () => undefined);

async function expectReject(label: string, input: any, needle: string) {
  const res = await tool.execute("x", input);
  const msg = res.content[0].text;
  const ok = res.details?.success === false && msg.includes(needle);
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) console.log(`    got: ${msg.slice(0, 200)}`);
}

await expectReject(
  "neither task nor tasks → error",
  { agent: "worker" },
  "must provide either `task`",
);

await expectReject(
  "background + tasks[] → error",
  { agent: "worker", tasks: ["a", "b"], background: true },
  "background` mode expects a single task",
);

await expectReject(
  "empty tasks array → error",
  { agent: "worker", tasks: [] },
  "must provide either `task`",
);
