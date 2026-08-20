/**
 * Root TUI application — Luxas research agent dashboard.
 *
 * Layout:
 *   ┌─────────────┬──────────────────────────────────┐
 *   │  Sidebar    │  Activity                        │
 *   │  (projects  │  (brain status, tasks, logs)     │
 *   │   + stats)  │                                  │
 *   ├─────────────┴──────────────────────────────────┤
 *   │  Input bar                                     │
 *   ├────────────────────────────────────────────────┤
 *   │  Status bar (keybindings + usage + rate bar)   │
 *   └────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { execSync } from "child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sidebar } from "./sidebar.js";
import { Activity } from "./activity.js";
import { InputBar } from "./input-bar.js";
import { discoverProjects, createProjectShell, type ProjectInfo } from "./projects.js";
import { dark, icons, formatTokens, formatCost } from "./theme.js";
import { createResearchAgent } from "../agent.js";
import { jobOwnerAls } from "../jobs/als.js";
import { reconcileOnStartup, sweepJobs } from "../jobs/registry.js";
import { createBrainstormAgent } from "./brainstorm.js";
import type { Agent } from "@earendil-works/pi-agent-core";

function RateBar({ utilization, width = 10 }: { utilization: number; width?: number }) {
  const filled = Math.round(utilization * width);
  const empty = width - filled;
  const color = utilization > 0.8 ? dark.error : utilization > 0.5 ? dark.warning : dark.rateFill;
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={dark.rateEmpty}>{"░".repeat(empty)}</Text>
    </Text>
  );
}

export default function App({ baseDir, brainTool = "claude" }: { baseDir: string; brainTool?: "claude" | "codex" }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 40;
  const cols = stdout?.columns ?? 120;

  // ── State ────────────────────────────────────────
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [focus, setFocus] = useState<"sidebar" | "input">("input");
  const [running, setRunning] = useState(false);
  const agentRef = useRef<Agent | null>(null);

  // Brainstorm mode
  const [mode, setMode] = useState<"command" | "brainstorm">("command");
  const brainstormAgentRef = useRef<Agent | null>(null);
  const brainstormDirRef = useRef<string | null>(null);

  // Activity log
  const [logs, setLogs] = useState<Array<{ text: string; color: string }>>([]);

  // Brain status
  const [brainStatus, setBrainStatus] = useState("");

  // Tasks
  const [tasks, setTasks] = useState<
    Map<number, { action: string; tool: string; model: string; status: string; elapsed: number; lastLine: string }>
  >(new Map());

  // Step info
  const [stepInfo, setStepInfo] = useState({ step: 0, globalStep: 0, maxSteps: 50 });

  // Usage tracking
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  const [rateLimit, setRateLimit] = useState<{ utilization: number } | null>(null);

  // Shimmer state for active border
  const [shimmer, setShimmer] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setShimmer((s) => !s), 600);
    return () => clearInterval(timer);
  }, [running]);

  // ── Project discovery ────────────────────────────
  const refreshProjects = useCallback(() => {
    const found = discoverProjects(baseDir);
    setProjects(found);
    if (found.length > 0 && selectedIdx >= found.length) {
      setSelectedIdx(found.length - 1);
    }
  }, [baseDir, selectedIdx]);

  useEffect(() => {
    refreshProjects();
    const timer = setInterval(refreshProjects, 5000);
    return () => clearInterval(timer);
  }, [refreshProjects]);

  // ── Run agent on a project ──────────────────────
  const runAgent = useCallback(async (project: ProjectInfo, directive?: string) => {
    if (running) return;
    setRunning(true);
    setLogs((p) => [...p, { text: `${icons.record} Starting: ${project.topic}`, color: dark.suggestion }]);
    setBrainStatus("Starting...");
    setStepInfo({ step: 0, globalStep: 0, maxSteps: 0 });

    let turnCount = 0;
    let toolCallCounter = 0;

    // Match CLI: reconcile prior-session jobs before starting sweep so a
    // crashed previous TUI session's bash records get classified instead
    // of being treated as healthy until their original deadline.
    reconcileOnStartup(project.dir).then(r => {
      if (r.scanned > 0 && (r.markedDone + r.killedOrphans + r.unverifiable) > 0) {
        setLogs((p) => [...p.slice(-200), {
          text: `⟳ Reconciled ${r.scanned} prior bash job(s): ${r.markedDone} done, ${r.killedOrphans} killed, ${r.unverifiable} orphaned`,
          color: dark.suggestion,
        }]);
      }
    }).catch(err => {
      setLogs((p) => [...p.slice(-200), { text: `[reconcile] ${err?.message ?? err}`, color: dark.error }]);
    });

    const sweepInterval = setInterval(() => {
      sweepJobs(project.dir).catch(err => {
        setLogs((p) => [...p.slice(-200), { text: `[sweep] ${err?.message ?? err}`, color: dark.error }]);
      });
    }, 15_000);
    sweepInterval.unref();

    try {
      const { agent, hooks, usageLogPath } = createResearchAgent({
        projectDir: project.dir,
        model: "sonnet",
      });
      agentRef.current = agent;

      // Subscribe to agent events → TUI state
      agent.subscribe((event: any) => {
        if (event.type === "tool_execution_start") {
          const id = ++toolCallCounter;
          const argsPreview = event.args ? JSON.stringify(event.args).slice(0, 60) : "";
          setTasks((prev) => {
            const next = new Map(prev);
            next.set(id, {
              action: event.toolName,
              tool: event.toolName,
              model: "sonnet",
              status: "running",
              elapsed: 0,
              lastLine: argsPreview,
            });
            return next;
          });
          setLogs((p) => [...p.slice(-200), {
            text: `${icons.toolUse} ${event.toolName} ${argsPreview}`,
            color: dark.suggestion,
          }]);
          // Store mapping from toolCallId to our counter
          (event as any)._tuiId = id;
        }
        if (event.type === "tool_execution_end") {
          const icon = event.isError ? icons.fail : icons.full;
          const color = event.isError ? dark.error : dark.success;
          setLogs((p) => [...p.slice(-200), {
            text: `${icon} ${event.toolName}`,
            color,
          }]);
          // Remove from active tasks after delay
          setTasks((prev) => {
            const next = new Map(prev);
            // Find the task for this tool (latest running one with matching name)
            for (const [id, t] of next) {
              if (t.tool === event.toolName && t.status === "running") {
                next.set(id, { ...t, status: event.isError ? "failed" : "done" });
                setTimeout(() => {
                  setTasks((p) => { const n = new Map(p); n.delete(id); return n; });
                }, 5000);
                break;
              }
            }
            return next;
          });
        }
        if (event.type === "turn_end") {
          turnCount++;
          setStepInfo({ step: turnCount, globalStep: turnCount, maxSteps: 0 });
        }
        if (event.type === "message_update") {
          const msg = event.assistantMessageEvent;
          if (msg?.usage) {
            setUsage((prev) => ({
              inputTokens: prev.inputTokens + (msg.usage.inputTokens ?? 0),
              outputTokens: prev.outputTokens + (msg.usage.outputTokens ?? 0),
              costUsd: prev.costUsd + (msg.usage.totalCost ?? 0),
            }));
          }
          // Show thinking/text snippets as brain status
          const content = event.message?.content;
          if (Array.isArray(content)) {
            const textBlock = content.filter((c: any) => c.type === "text").pop();
            if (textBlock?.text) {
              setBrainStatus(textBlock.text.slice(-80));
            }
          }
        }
      });

      // Build prompt
      const researchFile = join(project.dir, "RESEARCH.md");
      const researchGoal = readFileSync(researchFile, "utf-8").trim();
      const prompt = directive
        ? `Research goal (from RESEARCH.md):\n${researchGoal}\n\nAdditional directive: ${directive}`
        : `Research goal (from RESEARCH.md):\n${researchGoal}\n\nStart by reading RESEARCH.md for the full goal, then check notes/literature.md and notes/experiments.md for any existing progress. Proceed with the research.`;

      await jobOwnerAls.run(
        { agentId: "brain", agentType: "brain", projectDir: project.dir },
        () => agent.prompt(prompt),
      );

      const { readUsageTotals } = await import("../usage-log.js");
      const totals = readUsageTotals(usageLogPath);
      setBrainStatus(`Done | $${totals.cost.toFixed(4)}`);
      setLogs((p) => [...p, { text: `${icons.full} Completed`, color: dark.success }]);
    } catch (err: any) {
      setBrainStatus(`Error: ${err.message}`);
      setLogs((p) => [...p, { text: `${icons.fail} ${err.message}`, color: dark.error }]);
    } finally {
      clearInterval(sweepInterval);
      setRunning(false);
      agentRef.current = null;
      refreshProjects();
    }
  }, [running, refreshProjects]);

  // ── Brainstorm flow ─────────────────────────────
  const startBrainstorm = useCallback(async (topic: string, existingDir?: string) => {
    setLogs((p) => [...p, { text: `${icons.toolUse} Starting brainstorm for: ${topic}`, color: dark.suggestion }]);
    setBrainStatus("Brainstorming...");

    try {
      const dir = existingDir ?? await createProjectShell(baseDir, topic);
      brainstormDirRef.current = dir;

      const agent = createBrainstormAgent(dir, {
        onText: (text) => {
          // Show agent's response as log lines
          for (const line of text.split("\n")) {
            if (line.trim()) {
              setLogs((p) => [...p.slice(-200), { text: line, color: dark.text }]);
            }
          }
          setBrainStatus("Waiting for your answer...");
        },
        onFinalized: (content) => {
          setLogs((p) => [...p,
            { text: `${icons.full} RESEARCH.md finalized`, color: dark.success },
          ]);
          // Show first few lines of the brief
          const preview = content.split("\n").slice(0, 3).join(" ").slice(0, 100);
          setLogs((p) => [...p, { text: `  ${preview}...`, color: dark.inactive }]);
        },
        onError: (error) => {
          setLogs((p) => [...p, { text: `${icons.fail} ${error}`, color: dark.error }]);
        },
        onDone: () => {},
      });

      brainstormAgentRef.current = agent;
      setMode("brainstorm");
      setRunning(true);

      // Initial prompt — include existing RESEARCH.md if re-brainstorming
      let initialPrompt = `The user wants to research: "${topic}"`;
      if (existingDir) {
        try {
          const existing = readFileSync(join(dir, "RESEARCH.md"), "utf-8").trim();
          if (existing && existing.length > 20) {
            initialPrompt += `\n\nThere is an existing RESEARCH.md — refine and improve it based on the conversation:\n\n${existing}`;
          }
        } catch {}
      }
      await agent.prompt(initialPrompt);

      // Agent finished first turn — now waiting for user input
      // (don't exit brainstorm mode yet, user needs to answer questions)
    } catch (err: any) {
      setLogs((p) => [...p, { text: `${icons.fail} Brainstorm failed: ${err.message}`, color: dark.error }]);
      setBrainStatus("");
      setMode("command");
      setRunning(false);
      brainstormAgentRef.current = null;
      brainstormDirRef.current = null;
    }
  }, [baseDir]);

  const handleBrainstormInput = useCallback(async (input: string) => {
    const agent = brainstormAgentRef.current;
    if (!agent) return;

    // Show user's message
    setLogs((p) => [...p, { text: `> ${input}`, color: dark.suggestion }]);
    setBrainStatus("Thinking...");

    try {
      agent.followUp({
        role: "user",
        content: [{ type: "text", text: input }],
        timestamp: Date.now(),
      } as any);
      await agent.continue();
    } catch (err: any) {
      setLogs((p) => [...p, { text: `${icons.fail} ${err.message}`, color: dark.error }]);
    }

    // Check if RESEARCH.md was finalized (agent called finalize_brief)
    const dir = brainstormDirRef.current;
    if (dir) {
      try {
        const { existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        if (existsSync(join(dir, "RESEARCH.md"))) {
          // Brainstorm complete
          setMode("command");
          setRunning(false);
          setBrainStatus("Research brief ready — /run to start");
          brainstormAgentRef.current = null;
          brainstormDirRef.current = null;
          refreshProjects();
          // Select the new project
          const found = discoverProjects(baseDir);
          const idx = found.findIndex((p) => p.dir === dir);
          if (idx >= 0) setSelectedIdx(idx);
          return;
        }
      } catch {}
    }
  }, [baseDir, refreshProjects]);

  // ── Commands ─────────────────────────────────────
  const handleCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      // In brainstorm mode, route input to brainstorm agent
      if (mode === "brainstorm") {
        // Allow escape commands
        if (trimmed === "/cancel") {
          brainstormAgentRef.current?.abort();
          brainstormAgentRef.current = null;
          brainstormDirRef.current = null;
          setMode("command");
          setRunning(false);
          setBrainStatus("Brainstorm cancelled");
          setLogs((p) => [...p, { text: "Brainstorm cancelled", color: dark.warning }]);
          return;
        }
        if (trimmed === "/done") {
          // Force finalize with what we have
          const agent = brainstormAgentRef.current;
          if (agent) {
            setLogs((p) => [...p, { text: `> /done — finalizing...`, color: dark.suggestion }]);
            setBrainStatus("Finalizing...");
            agent.followUp({
              role: "user",
              content: [{ type: "text", text: "That's enough information. Please finalize the research brief now by calling finalize_brief." }],
              timestamp: Date.now(),
            } as any);
            try {
              await agent.continue();
            } catch {}
          }
          return;
        }
        await handleBrainstormInput(trimmed);
        return;
      }

      const [rawCommand, ...rest] = trimmed.split(/\s+/);
      const command = rawCommand.replace(/^\//, "");
      const arg = rest.join(" ");

      switch (command) {
        case "new": {
          if (!arg) {
            // No topic — brainstorm selected project
            const project = projects[selectedIdx];
            if (!project) {
              setLogs((p) => [...p, { text: 'Usage: /new "Research Topic" or select a project first', color: dark.warning }]);
              return;
            }
            if (running) {
              setLogs((p) => [...p, { text: "Already running", color: dark.warning }]);
              return;
            }
            startBrainstorm(project.topic, project.dir);
          } else {
            // Topic given — create new project + brainstorm
            const topic = arg.replace(/^["']|["']$/g, "");
            startBrainstorm(topic);
          }
          break;
        }
        case "run": {
          const project = projects[selectedIdx];
          if (!project) {
            setLogs((p) => [...p, { text: "No project selected", color: dark.error }]);
            return;
          }
          if (running) {
            setLogs((p) => [...p, { text: "Already running", color: dark.warning }]);
            return;
          }
          runAgent(project, arg || undefined);
          break;
        }
        case "open": {
          openPdf();
          break;
        }
        case "exit":
          exit();
          break;
        case "help":
          setLogs((p) => [...p,
            { text: "/new <topic>  Create project via brainstorm Q&A", color: dark.text },
            { text: "/new          Re-brainstorm selected project", color: dark.text },
            { text: "/run [text]   Run research (optional directive)", color: dark.text },
            { text: "/open         Open PDF report", color: dark.text },
            { text: "/exit         Exit", color: dark.text },
          ]);
          break;
        default:
          setLogs((p) => [...p, { text: `Unknown: /${command}. Type /help for commands`, color: dark.warning }]);
      }
    },
    [projects, selectedIdx, running, baseDir, exit, refreshProjects, runAgent, mode, handleBrainstormInput, startBrainstorm],
  );

  // ── Keyboard shortcuts ───────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === "q") {
      exit();
      return;
    }
    if (key.ctrl && input === "n") {
      setFocus("input");
      return;
    }
    if (key.tab) {
      setFocus((f) => (f === "sidebar" ? "input" : "sidebar"));
      return;
    }
    if (key.ctrl && input === "j") {
      setSelectedIdx((i) => Math.min(projects.length - 1, i + 1));
      return;
    }
    if (key.ctrl && input === "k") {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.ctrl && input === "o") {
      openPdf();
      return;
    }
    if (focus === "sidebar") {
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIdx((i) => Math.min(projects.length - 1, i + 1));
      } else if (key.return) {
        openPdf();
      }
    }
  });

  const openPdf = useCallback(() => {
    const pdf = projects[selectedIdx]?.pdfPath;
    if (!pdf) {
      setLogs((p) => [...p, { text: "No PDF available for this project", color: dark.warning }]);
      return;
    }
    try {
      execSync(`open "${pdf}"`);
      setLogs((p) => [...p, { text: `${icons.full} Opened: ${pdf.split("/").pop()}`, color: dark.success }]);
    } catch {
      setLogs((p) => [...p, { text: `${icons.fail} Failed to open PDF`, color: dark.error }]);
    }
  }, [projects, selectedIdx]);

  // ── Layout ───────────────────────────────────────
  const sidebarWidth = Math.min(28, Math.floor(cols * 0.25));
  const mainHeight = rows - 6;

  const activeBorder = running
    ? (shimmer ? dark.borderShimmer : dark.borderActive)
    : dark.border;

  const selectedProject = projects[selectedIdx] ?? null;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Header */}
      <Box justifyContent="center" paddingX={1}>
        <Text bold color={dark.brand}>
          {" "}Luxas{" "}
        </Text>
        <Text color={dark.subtle}> Il faut imaginer Sisyphe heureux </Text>
        {mode === "brainstorm" && <Text color={dark.warning}> {icons.record} brainstorming</Text>}
        {running && mode !== "brainstorm" && <Text color={dark.success}> {icons.record} running</Text>}
      </Box>

      {/* Main: sidebar + activity */}
      <Box flexGrow={1} height={mainHeight}>
        <Box
          width={sidebarWidth}
          flexDirection="column"
          borderStyle="round"
          borderColor={focus === "sidebar" ? activeBorder : dark.border}
        >
          <Sidebar
            projects={projects}
            selectedIdx={selectedIdx}
            selectedProject={selectedProject}
            focused={focus === "sidebar"}
            pdfPath={selectedProject?.pdfPath ?? null}
          />
        </Box>

        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={running ? activeBorder : dark.border}>
          <Activity
            brainStatus={brainStatus}
            tasks={tasks}
            logs={logs}
            stepInfo={stepInfo}
            running={running}
            maxLines={mainHeight - 4}
          />
        </Box>
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor={focus === "input" ? activeBorder : dark.border} paddingX={1}>
        <InputBar
          focused={focus === "input"}
          onSubmit={handleCommand}
          onEscape={() => {
            if (mode === "brainstorm" && brainstormAgentRef.current) {
              brainstormAgentRef.current.abort();
              brainstormAgentRef.current = null;
              brainstormDirRef.current = null;
              setMode("command");
              setRunning(false);
              setBrainStatus("Brainstorm cancelled");
            } else if (running && agentRef.current) {
              agentRef.current.abort();
            }
          }}
          placeholder={
            mode === "brainstorm"
              ? "Answer the question... (/done to finalize, /cancel to abort)"
              : projects.length === 0
                ? '/new "Your Research Topic"'
                : running ? "Esc to interrupt" : "Type / for commands"
          }
        />
      </Box>

      {/* Status bar */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color={dark.inactive}>
          {running && <><Text color={dark.warning}>Esc</Text> stop{" "}</>}
          <Text color={dark.suggestion}>Tab</Text> focus{" "}
          <Text color={dark.suggestion}>^J/^K</Text> project{" "}
          <Text color={dark.suggestion}>^O</Text> pdf{" "}
          <Text color={dark.suggestion}>^N</Text> new{" "}
          <Text color={dark.suggestion}>^Q</Text> exit
        </Text>
        <Box>
          {usage.costUsd > 0 && (
            <Text>
              <Text color={rateLimit && rateLimit.utilization > 0.8 ? dark.error : dark.warning}>
                {formatCost(usage.costUsd)}
              </Text>
              <Text color={dark.inactive}>
                {" "}{formatTokens(usage.inputTokens)}in/{formatTokens(usage.outputTokens)}out
              </Text>
              {rateLimit && (
                <>
                  <Text> </Text>
                  <RateBar utilization={rateLimit.utilization} width={8} />
                </>
              )}
              <Text>{"  "}</Text>
            </Text>
          )}
          <Text color={dark.brainClaude}>
            claude
          </Text>
          <Text color={dark.inactive}>
            {" "}{selectedProject?.displayName.slice(0, 25) ?? "no project"}
            {stepInfo.globalStep > 0 && ` step ${stepInfo.globalStep}`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
