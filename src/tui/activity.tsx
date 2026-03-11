/**
 * Activity panel — real-time agent activity display.
 *
 * Shows: brain status, running tasks, recent action log.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

function Spinner({ color = "cyan" }: { color?: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setVisible((v) => !v), 400);
    return () => clearInterval(timer);
  }, []);
  return <Text color={color}>{visible ? "\u2736" : " "}</Text>;
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

  // Calculate space: brain(2) + taskHeader(1) + tasks(2*n) + taskFooter(1) + logHeader(1) = rest for logs
  const taskLines = taskArr.length * 2 + (taskArr.length > 0 ? 2 : 0);
  const headerLines = 4; // step + divider + brain + spacing
  const logHeaderLines = 1;
  const availableLogLines = Math.max(3, maxLines - headerLines - taskLines - logHeaderLines);
  const visibleLogs = logs.slice(-availableLogLines);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Step header */}
      <Box>
        <Text bold color="white">
          {stepInfo.globalStep > 0
            ? `STEP ${stepInfo.globalStep} (${stepInfo.step}/${stepInfo.maxSteps})`
            : "Waiting..."}
        </Text>
        {running && (
          <Text dimColor> {"\u2502"} </Text>
        )}
        {running && <Spinner />}
      </Box>
      <Text dimColor>{"─".repeat(50)}</Text>

      {/* Brain status */}
      <Box>
        <Text dimColor>{"\uD83E\uDDE0"} </Text>
        <Text color={brainStatus.startsWith("Error") ? "red" : "cyan"} wrap="truncate">
          {brainStatus || "Idle"}
        </Text>
      </Box>

      {/* Task panel */}
      {taskArr.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {"\u250C"} {runningCount} running {"\u00B7"} {doneCount}/{taskArr.length} done
          </Text>
          {taskArr.map((task, idx) => {
            const isRunning = task.status === "running";
            const isDone = task.status === "done";
            const elapsed = formatElapsed(task.elapsed);

            return (
              <Box key={idx} flexDirection="column">
                <Box>
                  <Text dimColor>{"\u2502"} </Text>
                  {isRunning ? (
                    <Spinner />
                  ) : isDone ? (
                    <Text color="green">{"\u2714"}</Text>
                  ) : (
                    <Text color="red">{"\u2718"}</Text>
                  )}
                  <Text dimColor> {task.tool}/{task.model} </Text>
                  <Text color={isRunning ? "cyan" : isDone ? "green" : "red"}>
                    {task.action.padEnd(18)}
                  </Text>
                  <Text dimColor> {elapsed}</Text>
                </Box>
                {task.lastLine && (
                  <Box>
                    <Text dimColor>{"\u2502"}   {"\u21B3"} {task.lastLine.slice(0, 60)}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
          <Text dimColor>{"\u2514"}{"─".repeat(40)}</Text>
        </Box>
      )}

      {/* Log section */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor bold>Recent</Text>
        {visibleLogs.length === 0 ? (
          <Text dimColor italic>No activity yet</Text>
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

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
