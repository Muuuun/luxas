/**
 * Activity panel — real-time agent activity display.
 *
 * Shows: brain status, running tasks, recent action log.
 * Uses Claude Code-style spinner, shimmer animations, and semantic icons.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { dark, icons, spinnerFrames, formatElapsed } from "./theme.js";

/** Claude Code-style spinner: ·|· ·/· ·—· ·\· */
function Spinner({ color = dark.brand }: { color?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 150);
    return () => clearInterval(timer);
  }, []);
  return <Text color={color}>{spinnerFrames[frame]}</Text>;
}

/** Shimmer text — oscillates between two colors */
function Shimmer({ children, color, shimmer }: { children: string; color: string; shimmer: string }) {
  const [phase, setPhase] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setPhase((p) => !p), 600);
    return () => clearInterval(timer);
  }, []);
  return <Text color={phase ? shimmer : color}>{children}</Text>;
}

export function Activity({
  brainStatus,
  tasks,
  logs,
  stepInfo,
  running,
  maxLines,
}: {
  brainStatus: string;
  tasks: Map<number, { action: string; tool: string; model: string; status: string; elapsed: number; lastLine: string }>;
  logs: Array<{ text: string; color: string }>;
  stepInfo: { step: number; globalStep: number; maxSteps: number };
  running: boolean;
  maxLines: number;
}) {
  const taskArr = [...tasks.values()];
  const runningCount = taskArr.filter((t) => t.status === "running").length;
  const doneCount = taskArr.filter((t) => t.status !== "running").length;

  // Calculate space
  const taskLines = taskArr.length * 2 + (taskArr.length > 0 ? 2 : 0);
  const headerLines = 4;
  const logHeaderLines = 1;
  const availableLogLines = Math.max(3, maxLines - headerLines - taskLines - logHeaderLines);
  const visibleLogs = logs.slice(-availableLogLines);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Step header */}
      <Box>
        {running ? (
          <Shimmer color={dark.brand} shimmer={dark.brandShimmer}>
            {stepInfo.globalStep > 0
              ? `STEP ${stepInfo.globalStep} (${stepInfo.step}/${stepInfo.maxSteps})`
              : "Starting..."}
          </Shimmer>
        ) : (
          <Text bold color={dark.inactive}>
            {stepInfo.globalStep > 0
              ? `STEP ${stepInfo.globalStep} (${stepInfo.step}/${stepInfo.maxSteps})`
              : "Waiting..."}
          </Text>
        )}
        {running && (
          <>
            <Text color={dark.subtle}> {"\u2502"} </Text>
            <Spinner />
          </>
        )}
      </Box>
      <Text color={dark.subtle}>{"─".repeat(50)}</Text>

      {/* Brain status */}
      <Box>
        <Text color={dark.subtle}>{icons.active} </Text>
        <Text
          color={
            brainStatus.startsWith("Error") ? dark.error
            : brainStatus.startsWith("Done") ? dark.success
            : running ? dark.suggestion
            : dark.inactive
          }
          wrap="truncate"
        >
          {brainStatus || "Idle"}
        </Text>
      </Box>

      {/* Task panel */}
      {taskArr.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={dark.subtle}>
            {"\u250C"} {runningCount} running {icons.dot} {doneCount}/{taskArr.length} done
          </Text>
          {taskArr.map((task, idx) => {
            const isRunning = task.status === "running";
            const isDone = task.status === "done";
            const el = formatElapsed(task.elapsed);

            return (
              <Box key={idx} flexDirection="column">
                <Box>
                  <Text color={dark.subtle}>{"\u2502"} </Text>
                  {isRunning ? (
                    <Spinner color={dark.suggestion} />
                  ) : isDone ? (
                    <Text color={dark.success}>{icons.full}</Text>
                  ) : (
                    <Text color={dark.error}>{icons.fail}</Text>
                  )}
                  <Text color={dark.inactive}> {task.tool}/{task.model} </Text>
                  <Text color={isRunning ? dark.suggestion : isDone ? dark.success : dark.error}>
                    {task.action.padEnd(18)}
                  </Text>
                  <Text color={dark.subtle}> {el}</Text>
                </Box>
                {task.lastLine && (
                  <Box>
                    <Text color={dark.subtle}>{"\u2502"}   {icons.toolUse} {task.lastLine.slice(0, 60)}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
          <Text color={dark.subtle}>{"\u2514"}{"─".repeat(40)}</Text>
        </Box>
      )}

      {/* Log section */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={dark.subtle} bold>Recent</Text>
        {visibleLogs.length === 0 ? (
          <Text color={dark.inactive} italic>No activity yet</Text>
        ) : (
          visibleLogs.map((log, idx) => (
            <Text key={`log-${logs.length - visibleLogs.length + idx}`} color={log.color} wrap="truncate">
              {log.text.slice(0, 80)}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
