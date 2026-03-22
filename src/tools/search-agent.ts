/**
 * Search agent tool — dedicated agent that runs broad search and returns
 * a clean, consolidated summary. Keeps raw search results out of the
 * main research agent's context.
 */

import { Type } from "@sinclair/typebox";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as tmux from "../tmux.js";
import { createCodingToolsForProject } from "./coding.js";

function buildSearchAgentPrompt(projectDir: string): string {
  return `You are a search agent. Your job: search as broadly as possible for a given topic, then return a single consolidated summary. You do NOT write notes or reports — just search and summarize.

Working directory: ${projectDir}
Bash cwd is set to this directory. The search skill is at: skills/search/scripts/search

## Your search toolkit

Run these via bash:

\`\`\`bash
# Academic papers (OpenAlex + arXiv)
skills/search/scripts/search papers "query" --count 20
skills/search/scripts/search papers "query" --from-year 2024 --sort date --count 20

# Web search (news, press releases, recent results not yet in databases)
skills/search/scripts/search web "query" --count 10

# Citation chains (from a key paper)
skills/search/scripts/search citations <paper-id> --direction both

# BibTeX for a paper
skills/search/scripts/search bib "doi"
\`\`\`

## How to search

1. **Cast a wide net.** Use ALL tools above. Don't just search papers — also do web search.
2. **Multiple query angles.** Vary your search terms:
   - Core technical terms
   - Key people and group names
   - Application/deployment terms
   - Non-English terms if relevant (Chinese, Japanese, etc.)
3. **Foundational + recent.** Search by relevance (foundational work) AND by recency (--from-year, --sort date).
4. **Follow leads.** If a result mentions an important paper or group you haven't seen, do a targeted follow-up search.

## What to return

After searching, produce a SINGLE consolidated summary with:

1. **Key papers** — deduplicated list, each with: title, authors, year, venue, why it's relevant. Group by subtopic.
2. **Key groups/PIs** — who are the major players, what's their focus, latest work.
3. **Recent developments** — anything from the last 1-2 years that's notable.
4. **Non-academic findings** — government programs, industry players, standards, roadmaps found via web search.
5. **Recommended reading order** — which papers should be read first (must-read), which are secondary.

Be thorough in searching but concise in reporting. The research agent receiving your summary doesn't need to see raw search output — just the curated, deduplicated findings.`;
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
