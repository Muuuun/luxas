/**
 * Sidebar — project list + selected project stats.
 *
 * Uses Claude Code-style padded labels and semantic colors.
 */

import React from "react";
import { Box, Text } from "ink";
import Link from "ink-link";
import type { ProjectInfo } from "./projects.js";
import type { ResearchState } from "../types.js";
import { dark, icons } from "./theme.js";

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  running: { icon: icons.record, color: dark.success },
  paused: { icon: icons.half, color: dark.warning },
  done: { icon: icons.full, color: dark.success },
  failed: { icon: icons.fail, color: dark.error },
};

export function Sidebar({
  projects,
  selectedIdx,
  projectState,
  focused,
  pdfPath,
}: {
  projects: ProjectInfo[];
  selectedIdx: number;
  projectState: ResearchState | null;
  focused: boolean;
  pdfPath: string | null;
}) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Title */}
      <Text bold color={focused ? dark.borderActive : dark.text}>
        Projects
      </Text>
      <Text color={dark.subtle}>{"─".repeat(20)}</Text>

      {/* Project list */}
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

      {/* Stats for selected project — padded label alignment */}
      {projectState && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={dark.subtle}>{"─".repeat(20)}</Text>
          <Text color={dark.inactive} bold>Stats</Text>
          <StatLine label="Papers" value={`${projectState.artifacts.core_papers_count} core`} />
          <StatLine label="Downloaded" value={`${projectState.artifacts.downloaded_count}`} />
          <StatLine label="Extracted" value={`${projectState.artifacts.extracted_count}`} />
          {pdfPath ? (
            <Box>
              <Text color={dark.inactive}>{"Report".padEnd(11)}</Text>
              <Text color={dark.success}>{icons.full} </Text>
              <Link url={`file://${pdfPath}`} fallback={false}>
                <Text color={dark.suggestion} bold underline>PDF</Text>
              </Link>
            </Box>
          ) : (
            <StatLine
              label="Report"
              value={
                projectState.artifacts.has_report_pdf
                  ? `${icons.full} PDF`
                  : projectState.artifacts.has_report_tex
                    ? `${icons.half} tex only`
                    : `${icons.empty} none`
              }
              color={
                projectState.artifacts.has_report_pdf
                  ? dark.success
                  : projectState.artifacts.has_report_tex
                    ? dark.warning
                    : dark.error
              }
            />
          )}
          <StatLine label="Actions" value={`${projectState.actions_taken.length}`} />
          <StatLine label="Brain" value={`${projectState.total_brain_calls} calls`} />
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
