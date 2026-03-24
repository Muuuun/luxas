/**
 * Search agent tool — dedicated agent that runs broad search and returns
 * a clean, consolidated summary. Keeps raw search results out of the
 * main research agent's context.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import { nameAgent } from "agentsmelt";
import type { Model } from "@mariozechner/pi-ai";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as tmux from "../tmux.js";
import { createCodingToolsForProject } from "./coding.js";

const SISYPHUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEARCH_SCRIPT = join(SISYPHUS_ROOT, "skills", "search", "scripts", "search");

function buildSearchAgentPrompt(projectDir: string): string {
  return `You are a search agent. Search broadly for a given topic, then return a consolidated summary. You do NOT write notes or reports — just search and summarize.

<environment>
Working directory: ${projectDir}
Search script: ${SEARCH_SCRIPT}
</environment>

<tools>
<tool name="papers-by-relevance">${SEARCH_SCRIPT} papers "query" --count 20</tool>
<tool name="papers-by-recency">${SEARCH_SCRIPT} papers "query" --from-year 2024 --sort date --count 20</tool>
<tool name="web-search">${SEARCH_SCRIPT} web "query" --count 10</tool>
<tool name="citation-chain">${SEARCH_SCRIPT} citations PAPER_ID --direction both</tool>
<tool name="bibtex">${SEARCH_SCRIPT} bib "doi"</tool>
</tools>

<search_procedure>
For EACH query topic, you MUST run exactly these three searches as parallel bash calls:

1. ${SEARCH_SCRIPT} papers "query" --count 20
2. ${SEARCH_SCRIPT} papers "query" --from-year 2024 --sort date --count 20
3. ${SEARCH_SCRIPT} web "query" --count 10

NEVER skip search #2 (recency). The default relevance sort is citation-weighted and systematically misses papers published in the last 1-2 years. Search #2 is the ONLY way to find recent work.

After the initial triple search, vary your query angles:
- Core technical terms
- Key people and group names
- Application/deployment terms
- Non-English terms if relevant (Chinese, Japanese, etc.)

Follow leads: if results mention important papers or groups you haven't seen, do targeted follow-up searches.
</search_procedure>

<output_format>
Return a SINGLE consolidated summary with these sections:

1. Key papers — deduplicated, each with: title, authors, year, venue, why relevant. Group by subtopic.
2. Key groups/PIs — major players, their focus, latest work.
3. Recent developments (2024-2025) — this section is critical. The research agent needs the cutting edge, not just classic references.
4. Non-academic findings — government programs, industry, standards, roadmaps from web search.
5. Recommended reading order — must-read first, then secondary.

Be thorough in searching but concise in reporting.
</output_format>`;
}

export function createSearchAgentTool(
  model: Model<any>,
  getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  projectDir: string,
  trackUsage?: (usage: any) => void,
) {
  return {
    name: "search_literature",
    label: "Search Literature",
    description:
      "Launch a dedicated search agent that broadly searches for literature on a topic using all available tools (academic databases, web search, citation chains). " +
      "Returns a consolidated, deduplicated summary with key papers, groups, recent developments, and recommended reading order. " +
      "Use this instead of running individual search commands — it keeps your context clean.",
    parameters: Type.Object({
      topic: Type.String({
        description: "The research topic or question to search for. Be specific about what aspects you want covered.",
      }),
      context: Type.Optional(
        Type.String({
          description: "Optional context: what you already know, specific gaps to fill, particular groups or methods to look for.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { topic: string; context?: string },
    ) {
      const t0 = Date.now();
      const logFile = tmux.openWindow(`search: ${params.topic.slice(0, 20)}`);
      let agent: Agent | null = null;

      try {
        const tools = createCodingToolsForProject(projectDir);
        agent = new Agent({
          initialState: {
            systemPrompt: buildSearchAgentPrompt(projectDir),
            model,
            thinkingLevel: "medium" as any,
            tools,
          },
          getApiKey,
        });
        nameAgent(agent, "search", "search");

        if (logFile) {
          agent.subscribe(tmux.createAgentObserver(logFile));
        }

        let prompt = `Search broadly for: ${params.topic}`;
        if (params.context) {
          prompt += `\n\nContext from the research agent: ${params.context}`;
        }

        await agent.prompt(prompt);

        // Extract the final summary
        const messages = agent.state.messages;
        const lastAssistant = [...messages].reverse().find(
          (m: any) => m.role === "assistant"
        ) as any;
        const output = lastAssistant?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") ?? "(no output)";

        const elapsed = Date.now() - t0;
        tmux.closeWindow(logFile, `search: ${params.topic.slice(0, 30)}`, true, elapsed);

        return {
          content: [{ type: "text" as const, text: output.slice(0, 30_000) }],
          details: { elapsed, success: true },
        };
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        tmux.closeWindow(logFile, `search: ${params.topic.slice(0, 30)}`, false, elapsed);
        return {
          content: [{ type: "text" as const, text: `Search agent error: ${err.message}` }],
          details: { elapsed, success: false },
        };
      } finally {
        if (trackUsage && agent) {
          for (const m of agent.state.messages) {
            if ((m as any).role === "assistant" && (m as any).usage) {
              trackUsage((m as any).usage);
            }
          }
        }
      }
    },
  };
}
