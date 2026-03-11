/**
 * Root TUI application — Sisyphus research agent dashboard.
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
import { Sidebar } from "./sidebar.js";
import { Activity } from "./activity.js";
import { InputBar } from "./input-bar.js";
import { bus } from "../events.js";
import { discoverProjects, createProject, type ProjectInfo } from "./projects.js";
import { Conductor } from "../conductor.js";
import { loadState } from "../state.js";
import { dark, icons, formatTokens, formatCost } from "./theme.js";
import type { ResearchState } from "../types.js";

/** Rate limit progress bar — Claude Code style fill/empty blocks */
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
  const [activeBrainTool, setActiveBrainTool] = useState<"claude" | "codex">(brainTool);
  const [running, setRunning] = useState(false);
  const [projectState, setProjectState] = useState<ResearchState | null>(null);
  const conductorRef = useRef<Conductor | null>(null);

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

  // Load project state when selection changes
  useEffect(() => {
    if (projects.length === 0) return;
    const project = projects[selectedIdx];
    if (!project) return;
    try {
      const state = loadState(project.dir);
      setProjectState(state);
    } catch {
      setProjectState(null);
    }
  }, [projects, selectedIdx]);

  // Refresh project state periodically when running
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const project = projects[selectedIdx];
      if (!project) return;
      try {
        setProjectState(loadState(project.dir));
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [running, projects, selectedIdx]);

  // ── Event subscriptions ──────────────────────────
  useEffect(() => {
    const onLog = (e: { level: string; message: string }) => {
      const color = e.level === "error" ? dark.error : e.level === "warn" ? dark.warning : dark.text;
      setLogs((prev) => [...prev.slice(-200), { text: e.message, color }]);
    };
    const onBrain = (e: { status: string; elapsed: number; thought?: string; reason?: string; taskCount?: number }) => {
      if (e.status === "thinking") {
        setBrainStatus(`Thinking... ${e.elapsed}s${e.thought ? ` ${icons.dot} ${e.thought.slice(0, 60)}` : ""}`);
      } else if (e.status === "decided") {
        setBrainStatus(`Decided: ${e.reason?.slice(0, 80) ?? ""} (${e.taskCount ?? 0} tasks)`);
      } else {
        setBrainStatus(`Error: ${e.reason ?? "unknown"}`);
      }
    };
    const onTask = (e: { id: number; action: string; tool: string; model: string; status: string; elapsed: number; lastLine: string }) => {
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(e.id, e);
        if (e.status !== "running") {
          setTimeout(() => {
            setTasks((p) => {
              const n = new Map(p);
              n.delete(e.id);
              return n;
            });
          }, 10000);
        }
        return next;
      });
    };
    const onStep = (e: { step: number; globalStep: number; maxSteps: number }) => {
      setStepInfo(e);
    };
    const onAction = (e: { action: string; result: string; details: string }) => {
      const icon = e.result === "success" ? icons.full : e.result === "failed" ? icons.fail : icons.half;
      const color = e.result === "success" ? dark.success : e.result === "failed" ? dark.error : dark.warning;
      setLogs((prev) => [
        ...prev.slice(-200),
        { text: `${icon} ${e.action}: ${e.details.slice(0, 100)}`, color },
      ]);
    };
    const onUsage = (e: { inputTokens: number; outputTokens: number; costUsd: number }) => {
      setUsage((prev) => ({
        inputTokens: prev.inputTokens + e.inputTokens,
        outputTokens: prev.outputTokens + e.outputTokens,
        costUsd: prev.costUsd + e.costUsd,
      }));
    };
    const onRateLimit = (e: { utilization: number }) => {
      setRateLimit({ utilization: e.utilization });
    };
    const onDone = (e: { reason: string }) => {
      setRunning(false);
      setBrainStatus(`Done: ${e.reason}`);
      refreshProjects();
    };
    const onPaused = (e: { reason: string }) => {
      setRunning(false);
      setBrainStatus(`Paused: ${e.reason}`);
      refreshProjects();
    };

    bus.on("log", onLog);
    bus.on("brain", onBrain);
    bus.on("task", onTask);
    bus.on("step", onStep);
    bus.on("action", onAction);
    bus.on("usage", onUsage);
    bus.on("rate-limit", onRateLimit);
    bus.on("done", onDone);
    bus.on("paused", onPaused);

    return () => {
      bus.off("log", onLog);
      bus.off("brain", onBrain);
      bus.off("task", onTask);
      bus.off("step", onStep);
      bus.off("action", onAction);
      bus.off("usage", onUsage);
      bus.off("rate-limit", onRateLimit);
      bus.off("done", onDone);
      bus.off("paused", onPaused);
    };
  }, [refreshProjects]);

  // ── Commands ─────────────────────────────────────
  const handleCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      const [rawCommand, ...rest] = trimmed.split(/\s+/);
      const command = rawCommand.replace(/^\//, "");
      const arg = rest.join(" ");

      switch (command) {
        case "new": {
          if (!arg) {
            setLogs((p) => [...p, { text: 'Usage: /new "Research Topic"', color: dark.warning }]);
            return;
          }
          const topic = arg.replace(/^["']|["']$/g, "");
          const dir = createProject(baseDir, topic);
          setLogs((p) => [...p, { text: `Created project: ${dir}`, color: dark.success }]);
          refreshProjects();
          const found = discoverProjects(baseDir);
          const idx = found.findIndex((p) => p.dir === dir);
          if (idx >= 0) setSelectedIdx(idx);
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
          setRunning(true);
          setLogs((p) => [...p, { text: `${icons.record} Starting: ${project.topic}`, color: dark.suggestion }]);
          const topic = arg || undefined;
          const c1 = new Conductor({ projectDir: project.dir, brainTool: activeBrainTool });
          conductorRef.current = c1;
          c1.run(topic).catch((err: Error) => {
            setLogs((p) => [...p, { text: `${icons.fail} Error: ${err.message}`, color: dark.error }]);
          }).finally(() => {
            conductorRef.current = null;
            setRunning(false);
            refreshProjects();
          });
          break;
        }
        case "resume": {
          const project = projects[selectedIdx];
          if (!project) return;
          if (running) {
            setLogs((p) => [...p, { text: "Already running", color: dark.warning }]);
            return;
          }
          setRunning(true);
          setLogs((p) => [...p, { text: `${icons.retry} Resuming: ${project.topic}`, color: dark.suggestion }]);
          const c2 = new Conductor({ projectDir: project.dir, brainTool: activeBrainTool });
          conductorRef.current = c2;
          c2.run().catch((err: Error) => {
            setLogs((p) => [...p, { text: `${icons.fail} Error: ${err.message}`, color: dark.error }]);
          }).finally(() => {
            conductorRef.current = null;
            setRunning(false);
            refreshProjects();
          });
          break;
        }
        case "refine": {
          const project = projects[selectedIdx];
          if (!project || !arg) return;
          if (running) {
            setLogs((p) => [...p, { text: "Already running", color: dark.warning }]);
            return;
          }
          setRunning(true);
          setLogs((p) => [...p, { text: `${icons.toolUse} Refining: ${arg.slice(0, 60)}`, color: dark.suggestion }]);
          const c3 = new Conductor({ projectDir: project.dir, brainTool: activeBrainTool });
          conductorRef.current = c3;
          c3.run(undefined, arg).catch((err: Error) => {
            setLogs((p) => [...p, { text: `${icons.fail} Error: ${err.message}`, color: dark.error }]);
          }).finally(() => {
            conductorRef.current = null;
            setRunning(false);
            refreshProjects();
          });
          break;
        }
        case "brain": {
          const tool = arg.toLowerCase();
          if (tool === "claude" || tool === "codex") {
            setActiveBrainTool(tool);
            setLogs((p) => [...p, { text: `${icons.full} Brain switched to: ${tool}`, color: dark.success }]);
          } else {
            setLogs((p) => [...p, { text: `Current brain: ${activeBrainTool}. Usage: /brain claude or /brain codex`, color: dark.warning }]);
          }
          break;
        }
        case "quit":
        case "exit":
          exit();
          break;
        case "help":
          setLogs((p) => [...p,
            { text: "/new <topic>     Create a new research project", color: dark.text },
            { text: "/run             Start research on selected project", color: dark.text },
            { text: "/resume          Resume from last saved state", color: dark.text },
            { text: "/refine <text>   Refine/expand existing research", color: dark.text },
            { text: `/brain <tool>    Switch brain (current: ${activeBrainTool})`, color: dark.text },
            { text: "/quit            Exit", color: dark.text },
          ]);
          break;
        default:
          setLogs((p) => [...p, { text: `Unknown: /${command}. Type /help for commands`, color: dark.warning }]);
      }
    },
    [projects, selectedIdx, running, baseDir, exit, refreshProjects, activeBrainTool],
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

  // Shimmer border color when running
  const activeBorder = running
    ? (shimmer ? dark.borderShimmer : dark.borderActive)
    : dark.border;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Header */}
      <Box justifyContent="center" paddingX={1}>
        <Text bold color={dark.brand}>
          {" "}Sisyphus{" "}
        </Text>
        <Text color={dark.subtle}> Il faut imaginer Sisyphe heureux </Text>
        {running && <Text color={dark.success}> {icons.record} running</Text>}
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
            projectState={projectState}
            focused={focus === "sidebar"}
            pdfPath={projects[selectedIdx]?.pdfPath ?? null}
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
            if (running && conductorRef.current) {
              conductorRef.current.abort();
            }
          }}
          placeholder={
            projects.length === 0
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
          <Text color={dark.suggestion}>^Q</Text> quit
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
          <Text color={activeBrainTool === "codex" ? dark.brainCodex : dark.brainClaude}>
            {activeBrainTool}
          </Text>
          <Text color={dark.inactive}>
            {" "}{projects[selectedIdx]?.displayName.slice(0, 25) ?? "no project"}
            {stepInfo.globalStep > 0 && ` step ${stepInfo.globalStep}`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
