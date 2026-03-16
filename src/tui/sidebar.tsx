/**
 * Sidebar — project list + selected project stats.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProjectInfo } from "./projects.js";
import { dark, icons } from "./theme.js";

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  running: { icon: icons.record, color: dark.success },
  paused: { icon: icons.half, color: dark.warning },
  done: { icon: icons.full, color: dark.success },
  idle: { icon: icons.empty, color: dark.inactive },
};

export function Sidebar({
  projects,
  selectedIdx,
  selectedProject,
  focused,
  pdfPath,
}: {
  projects: ProjectInfo[];
  selectedIdx: number;
  selectedProject: ProjectInfo | null;
  focused: boolean;
  pdfPath: string | null;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={focused ? dark.borderActive : dark.text}>
        Projects
      </Text>
      <Text color={dark.subtle}>{"─".repeat(20)}</Text>

      {projects.length === 0 ? (
        <Text color={dark.inactive} italic>
          No projects yet.{"\n"}Type: /new "topic"
        </Text>
      ) : (
        projects.map((project, idx) => {
          const selected = idx === selectedIdx;
          const si = STATUS_ICON[project.status] ?? { icon: "?", color: dark.inactive };
          return (
            <Box key={project.dir}>
              <Text color={selected ? dark.borderActive : dark.text}>
                {selected ? (focused ? "\u25B8 " : "\u25B9 ") : "  "}
              </Text>
              <Text color={si.color}>{si.icon} </Text>
              <Text
                color={selected ? dark.borderActive : dark.text}
                bold={selected}
                wrap="truncate"
              >
                {project.displayName.slice(0, 18)}
              </Text>
            </Box>
          );
        })
      )}

      {selectedProject && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={dark.subtle}>{"─".repeat(20)}</Text>
          <Text color={dark.inactive} bold>Stats</Text>
          <StatLine label="Actions" value={`${selectedProject.totalActions}`} />
          <StatLine label="Decisions" value={`${selectedProject.decisions}`} />
          {pdfPath ? (
            <Box>
              <Text color={dark.inactive}>{"Report".padEnd(11)}</Text>
              <Text color={dark.success}>{icons.full} </Text>
              <Text color={dark.suggestion} bold>PDF</Text>
              <Text color={dark.inactive}> ^O open</Text>
            </Box>
          ) : (
            <StatLine
              label="Report"
              value={`${icons.empty} none`}
              color={dark.inactive}
            />
          )}
        </Box>
      )}
    </Box>
  );
}

function StatLine({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Box>
      <Text color={dark.inactive}>{label.padEnd(11)}</Text>
      <Text color={color ?? dark.text}>{value}</Text>
    </Box>
  );
}
