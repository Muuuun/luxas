/**
 * Input bar — command input with cursor movement and slash command autocomplete.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { dark } from "./theme.js";

export interface SlashCommand {
  name: string;
  description: string;
  hasArg?: boolean;
}

export const COMMANDS: SlashCommand[] = [
  { name: "new", description: "Create a new research project", hasArg: true },
  { name: "run", description: "Start research on selected project" },
  { name: "resume", description: "Resume from last saved state" },
  { name: "refine", description: "Refine/expand existing research", hasArg: true },
  { name: "brain", description: "Switch brain tool: /brain codex or /brain claude", hasArg: true },
  { name: "help", description: "Show all commands" },
  { name: "quit", description: "Exit Sisyphus" },
];

export function InputBar({
  focused,
  onSubmit,
  onEscape,
  placeholder,
}: {
  focused: boolean;
  onSubmit: (value: string) => void;
  onEscape?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0); // cursor position within value
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [menuIdx, setMenuIdx] = useState(0);

  // Blink cursor
  React.useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(timer);
  }, [focused]);

  // Show menu when input starts with "/" and no space yet (still typing command name)
  const showMenu = value.startsWith("/") && !value.includes(" ");
  const query = value.slice(1).toLowerCase();

  const filtered = useMemo(() => {
    if (!showMenu) return [];
    if (!query) return COMMANDS;
    return COMMANDS.filter(
      (cmd) => cmd.name.startsWith(query) || cmd.name.includes(query),
    );
  }, [showMenu, query]);

  // Clamp menu index when filtered list changes
  React.useEffect(() => {
    if (menuIdx >= filtered.length) setMenuIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, menuIdx]);

  // Helper: set value and move cursor to end
  const setValueAndCursorEnd = (v: string) => {
    setValue(v);
    setCursor(v.length);
  };

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.return) {
        if (showMenu && filtered.length > 0) {
          const cmd = filtered[menuIdx];
          const filled = `/${cmd.name}${cmd.hasArg ? " " : ""}`;
          setValueAndCursorEnd(filled);
          setMenuIdx(0);
          if (!cmd.hasArg) {
            onSubmit(filled);
            setHistory((h) => [...h, filled]);
            setHistoryIdx(-1);
            setValue("");
            setCursor(0);
          }
          return;
        }
        if (value.trim()) {
          onSubmit(value);
          setHistory((h) => [...h, value]);
          setHistoryIdx(-1);
        }
        setValue("");
        setCursor(0);
        return;
      }

      if (key.escape) {
        if (showMenu) {
          setValue("");
          setCursor(0);
          setMenuIdx(0);
        } else if (onEscape) {
          onEscape();
        }
        return;
      }

      // Backspace: delete char before cursor
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
        }
        setMenuIdx(0);
        return;
      }

      // Cursor movement: left/right
      if (key.leftArrow) {
        if (key.ctrl || key.meta) {
          // Jump to start of previous word
          const before = value.slice(0, cursor);
          const match = before.match(/.*\s(\S)/);
          setCursor(match ? before.lastIndexOf(match[1]) : 0);
        } else {
          setCursor((c) => Math.max(0, c - 1));
        }
        return;
      }
      if (key.rightArrow) {
        if (key.ctrl || key.meta) {
          // Jump to end of next word
          const after = value.slice(cursor);
          const match = after.match(/\S+\s?/);
          setCursor((c) => Math.min(value.length, c + (match ? match[0].length : 0)));
        } else {
          setCursor((c) => Math.min(value.length, c + 1));
        }
        return;
      }

      // Ctrl+A: start, Ctrl+E: end
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        setCursor(value.length);
        return;
      }

      // Ctrl+U: delete to start, Ctrl+K: delete to end
      if (key.ctrl && input === "u") {
        setValue((v) => v.slice(cursor));
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "k") {
        setValue((v) => v.slice(0, cursor));
        return;
      }

      // Ctrl+W: delete word before cursor
      if (key.ctrl && input === "w") {
        const before = value.slice(0, cursor);
        const trimmed = before.replace(/\S+\s*$/, "");
        setValue(trimmed + value.slice(cursor));
        setCursor(trimmed.length);
        return;
      }

      // Menu navigation when visible
      if (showMenu && filtered.length > 0) {
        if (key.upArrow) {
          setMenuIdx((i) => (i <= 0 ? filtered.length - 1 : i - 1));
          return;
        }
        if (key.downArrow) {
          setMenuIdx((i) => (i >= filtered.length - 1 ? 0 : i + 1));
          return;
        }
        if (key.tab) {
          const cmd = filtered[menuIdx];
          const filled = `/${cmd.name}${cmd.hasArg ? " " : ""}`;
          setValueAndCursorEnd(filled);
          setMenuIdx(0);
          return;
        }
      }

      // History navigation (only when menu is not shown)
      if (!showMenu) {
        if (key.upArrow && history.length > 0) {
          const newIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
          setHistoryIdx(newIdx);
          setValueAndCursorEnd(history[newIdx]);
          return;
        }
        if (key.downArrow) {
          if (historyIdx >= 0 && historyIdx < history.length - 1) {
            const newIdx = historyIdx + 1;
            setHistoryIdx(newIdx);
            setValueAndCursorEnd(history[newIdx]);
          } else {
            setHistoryIdx(-1);
            setValue("");
            setCursor(0);
          }
          return;
        }
      }

      // Regular input: insert at cursor position
      if (input && !key.ctrl && !key.meta && !key.tab) {
        setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + input.length);
      }
    },
    { isActive: focused },
  );

  // Split value into before-cursor and after-cursor for rendering
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);

  return (
    <Box flexDirection="column">
      {/* Command menu */}
      {showMenu && filtered.length > 0 && (
        <Box flexDirection="column" marginBottom={0}>
          {filtered.map((cmd, idx) => {
            const selected = idx === menuIdx;
            return (
              <Box key={cmd.name}>
                <Text color={selected ? dark.suggestion : dark.text} bold={selected}>
                  {selected ? "\u25B8 " : "  "}
                </Text>
                <Text color={selected ? dark.suggestion : dark.text} bold={selected}>
                  {"/" + cmd.name.padEnd(10)}
                </Text>
                <Text color={dark.inactive}> {cmd.description}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Input line */}
      <Box>
        <Text color={focused ? dark.suggestion : dark.inactive} bold>
          {">"}{" "}
        </Text>
        {value ? (
          <Text>
            {before}
            {focused && cursorVisible ? (
              after.length > 0
                ? <Text inverse>{after[0]}</Text>
                : <Text>{"\u2588"}</Text>
            ) : (
              <Text>{after[0] ?? ""}</Text>
            )}
            {after.slice(1)}
          </Text>
        ) : (
          <>
            {focused && cursorVisible && <Text>{"\u2588"}</Text>}
            <Text dimColor> {placeholder ?? "Type / for commands"}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
