#!/bin/bash
# Patch pi-agent-core agent-loop.js so orchestrator agents only ever exit
# via the `finish` tool, never via "no tool_use this turn".
#
# Default agent-loop semantics: any turn whose assistant message contains
# zero toolCall blocks ends the loop ("looks done"). Right for one-shot
# coding agents — they finish a task and naturally stop.
#
# Wrong for the brain orchestrator: brain might emit a single
# spawn_agent(background=true) and then, on the next turn, generate a
# text-only "I'll wait for the search to come back" message. Default loop
# treats that as "done", brain exits, the background sub-agent gets
# orphaned, and from the user's perspective clicking Start did nothing.
#
# Patch: when the loop sees an assistant message with no toolCall blocks
# AND the agent has a `finish` tool, inject a steer message
# ("call finish() now if done, otherwise emit the tool you intended")
# and continue the loop. Repeat as long as the model keeps producing
# text-only turns. Bounded by maxTurns (default 500 in src/agent.ts) and
# by the budget watcher.
#
# Sub-agents like experiment_reviewer don't have `finish` and naturally
# terminate via verdict-text turn — they bypass the guard.

TARGET="node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js"
MARKER="[no-tool-retry-guard patched]"

if [ ! -f "$TARGET" ]; then
  exit 0
fi

if grep -qF "$MARKER" "$TARGET"; then
  echo "[patch] agent-loop no-tool-retry-guard already applied"
  exit 0
fi

python3 - "$TARGET" "$MARKER" <<'PYEOF'
import sys

path, marker = sys.argv[1], sys.argv[2]
src = open(path).read()

# Anchor: add else-if retry block after the toolResults-push if-block.
# Fires every time the model emits no tool calls but DOES have a finish
# tool — keeps the loop alive until finish() is explicitly called.
old = """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }
            await emit({ type: \"turn_end\", message, toolResults });"""
new = """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }
            else if (currentContext.tools?.some?.((t) => t?.name === \"finish\")) { // """ + marker + """
                const hasText = message.content.some((c) => c.type === \"text\" && (c.text?.trim().length ?? 0) > 0);
                const hasThinking = message.content.some((c) => c.type === \"thinking\" && (c.thinking?.trim().length ?? 0) > 0);
                if (hasText || hasThinking) {
                    hasMoreToolCalls = true;
                    steeringAfterTools = [{
                        role: \"user\",
                        content: \"[no_tool_retry_guard] Your previous turn produced text/thinking but no tool_use. Orchestrator agents only end via finish(). If all work is complete, call finish() now. Otherwise emit the tool_use you intended in your next turn.\",
                        timestamp: Date.now(),
                    }];
                    console.error(\"[no_tool_retry_guard] retrying assistant turn (no tool_use; orchestrator must finish() to exit)\");
                }
            }
            await emit({ type: \"turn_end\", message, toolResults });"""
if old not in src:
    print("[patch] FAIL: anchor (turn_end) not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old, new, 1)

open(path, "w").write(src)
print("[patch] agent-loop no-tool-retry-guard applied")
PYEOF
