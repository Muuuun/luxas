#!/usr/bin/env tsx
/**
 * smoke_deepseek_web — empirical test of whether DeepSeek-v4-pro, given only
 * a bash tool, will spontaneously use it for vendor-price lookup.
 *
 * Hypothesis being tested: experiment agent's "工具环境无网络访问能力" is
 * a model-side hallucination, NOT a real capability gap. bash can curl;
 * skills/search/scripts/search wraps web search/fetch. If DeepSeek understands
 * "bash = network", it should use it. If it gives up immediately, the prompt
 * needs to surface the search skill explicitly.
 *
 * Three conditions:
 *   A. bash only, no hint about search skill
 *   B. bash only + system mentions skills/search/scripts/{search,browse}
 *   C. bash only + explicit example "scripts/search web 'X' → snippet prices"
 *
 *   npx tsx scripts/smoke_deepseek_web.mts <A|B|C>
 */
import { execSync } from "node:child_process";

const COND = (process.argv[2] ?? "A") as "A" | "B" | "C";

const TASK = `Find the catalog price (USD) of the Edmund Optics "25mm UC Series Fixed Focal Length Lens". Report the number and the source. If you cannot find it, explain why.`;

const SYS_A = `You are a research assistant with access to a bash tool. You are running on a developer's laptop with full network access. Use bash to investigate the user's question.`;

const SYS_B = `You are a research assistant with access to a bash tool. You are running on a developer's laptop with full network access.

Your environment includes a search skill at /Users/muqiao/Documents/Sisyphus/skills/search/scripts/. The relevant commands:
  - scripts/search web "<query>"    — Google web search, returns title + URL + snippet
  - scripts/search fetch "<url>"    — fetch URL and extract text (HTML→plain)
  - scripts/browse open "<url>"     — browser-use for JS-heavy / Cloudflare sites

Use bash to investigate the user's question.`;

const SYS_C = `You are a research assistant with access to a bash tool. You are running on a developer's laptop with full network access.

Your environment includes a search skill at /Users/muqiao/Documents/Sisyphus/skills/search/scripts/. The relevant commands:
  - scripts/search web "<query>"    — Google web search, returns title + URL + snippet
  - scripts/search fetch "<url>"    — fetch URL and extract text
  - scripts/browse open "<url>"     — browser-use for JS-heavy sites

EXAMPLE — for vendor catalog price lookups, web-search snippets often contain the price directly without needing to fetch the page:

  $ scripts/search web "Edmund Optics 25mm lens price USD"
  [1] 25mm C Series Fixed Focal Length Lens | Edmund Optics
      https://www.edmundoptics.com/p/25mm-c-series-...
      $374.00 ... TECHSPEC C Series Fixed Focal Length...

Use bash to investigate the user's question.`;

const SYS = COND === "A" ? SYS_A : COND === "B" ? SYS_B : SYS_C;

console.log(`\n=== Condition ${COND} ===\n`);
console.log(`SYSTEM PROMPT:\n${SYS}\n`);
console.log(`TASK: ${TASK}\n`);

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: any[] }
  | { role: "tool"; content: string; tool_call_id: string };

const messages: Message[] = [
  { role: "system", content: SYS },
  { role: "user", content: TASK },
];

const tools = [{
  type: "function",
  function: {
    name: "bash",
    description: "Execute a bash command in /Users/muqiao/Documents/Sisyphus. Returns stdout (truncated to 4000 chars).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run" },
      },
      required: ["command"],
    },
  },
}];

function runBash(cmd: string): string {
  try {
    const out = execSync(cmd, {
      cwd: "/Users/muqiao/Documents/Sisyphus",
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return out.slice(0, 4000);
  } catch (err: any) {
    const stderr = (err.stderr ?? "").toString().slice(0, 2000);
    const stdout = (err.stdout ?? "").toString().slice(0, 2000);
    return `[exit ${err.status ?? "?"}]\nstdout: ${stdout}\nstderr: ${stderr}`;
  }
}

async function callDeepseek(): Promise<any> {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 2000,
      temperature: 0.3,
      tools,
      messages,
    }),
  });
  const data = await r.json();
  if (!data.choices) throw new Error(`DeepSeek error: ${JSON.stringify(data).slice(0, 500)}`);
  return data.choices[0].message;
}

const MAX_TURNS = 8;
let toolCallCount = 0;
let usedSearchSkill = false;
let usedRawCurl = false;
let claimedNoNetwork = false;

for (let turn = 0; turn < MAX_TURNS; turn++) {
  console.log(`\n--- turn ${turn + 1} ---`);
  const msg = await callDeepseek();
  messages.push(msg);

  if (msg.content) {
    console.log(`ASSISTANT: ${msg.content.slice(0, 800)}`);
    if (/(no|cannot|don't have|不能|无法).{0,30}(network|internet|web|access|联网|网络)/i.test(msg.content)) {
      claimedNoNetwork = true;
    }
  }

  const calls = msg.tool_calls ?? [];
  if (calls.length === 0) {
    console.log(`(no tool calls — terminating)`);
    break;
  }

  for (const call of calls) {
    toolCallCount++;
    const args = JSON.parse(call.function.arguments);
    const cmd = args.command;
    console.log(`TOOL CALL: bash → ${cmd.slice(0, 200)}`);
    if (/scripts\/search|scripts\/browse/.test(cmd)) usedSearchSkill = true;
    if (/curl|wget/.test(cmd)) usedRawCurl = true;
    const out = runBash(cmd);
    console.log(`OUTPUT (${out.length} chars): ${out.slice(0, 400).replace(/\n/g, " ")}`);
    messages.push({ role: "tool", content: out, tool_call_id: call.id });
  }
}

console.log(`\n=== Summary (Condition ${COND}) ===`);
console.log(`  tool calls:           ${toolCallCount}`);
console.log(`  used search skill:    ${usedSearchSkill}`);
console.log(`  used raw curl/wget:   ${usedRawCurl}`);
console.log(`  claimed no network:   ${claimedNoNetwork}`);
console.log(`  final answer present: ${(messages[messages.length - 1] as any).content ? "yes" : "no"}`);
