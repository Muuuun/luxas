/**
 * Sidebar — project list + selected project stats.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProjectInfo } from "./projects.js";
import type { ResearchState } from "../types.js";

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  running: { icon: "\u25B6", color: "green" },
  paused: { icon: "\u2759\u2759", color: "yellow" },
  done: { icon: "\u2714", color: "green" },
  failed: { icon: "\u2718", color: "red" },
};

/** OSC 8 clickable hyperlink — zero-width escape codes, terminal renders as link */
function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

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
      <Text bold color={focused ? "cyan" : "white"}>
        Projects
      </Text>
      <Text dimColor>{"─".repeat(20)}</Text>

      {/* Project list */}
      {projects.length === 0 ? (
        <Text dimColor italic>
          No projects yet.{"\n"}Type: new "topic"
        </Text>
      ) : (
        projects.map((project, idx) => {
          const selected = idx === selectedIdx;
          const si = STATUS_ICON[project.status] ?? { icon: "?", color: "gray" };
          return (
            <Box key={project.dir}>
              <Text color={selected ? "cyan" : "white"}>
                {selected ? (focused ? "\u25B8 " : "\u25B9 ") : "  "}
              </Text>
              <Text color={si.color}>{si.icon} </Text>
              <Text
                color={selected ? "cyan" : "white"}
                bold={selected}
                wrap="truncate"
              >
                {project.displayName.slice(0, 18)}
              </Text>
            </Box>
          );
        })
      )}

      {/* Stats for selected project */}
      {projectState && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(20)}</Text>
          <Text dimColor bold>Stats</Text>
          <StatLine label="Papers" value={`${projectState.artifacts.core_papers_count} core`} />
          <StatLine
            label="Downloaded"
            value={`${projectState.artifacts.downloaded_count}`}
          />
          <StatLine
            label="Extracted"
            value={`${projectState.artifacts.extracted_count}`}
          />
          {pdfPath ? (
            <Box>
              <Text dimColor>{"Report".padEnd(11)}</Text>
              <Text color="green">{hyperlink(`file://${pdfPath}`, "\u2714 PDF \u2197")}</Text>
            </Box>
          ) : (
            <StatLine
              label="Report"
              value={
                projectState.artifacts.has_report_pdf
                  ? "\u2714 PDF"
                  : projectState.artifacts.has_report_tex
                    ? "~ tex only"
                    : "\u2718 none"
              }
              color={
                projectState.artifacts.has_report_pdf
                  ? "green"
                  : projectState.artifacts.has_report_tex
                    ? "yellow"
                    : "red"
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
      <Text dimColor>{label.padEnd(11)}</Text>
      <Text color={color ?? "white"}>{value}</Text>
    </Box>
  );
}
