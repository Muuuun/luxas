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
MARKER_EXIT="[finish-tool-exit patched]"

if [ ! -f "$TARGET" ]; then
  exit 0
fi

# ── Patch A: no-tool-retry-guard ─────────────────────────────────
# When an agent with a `finish` tool emits zero tool_use, inject a steer
# message ("call finish() now if done, else emit the tool you intended").
# Fires for agents like brain that CAN naturally emit text-only turns
# under tool_choice="any" (Anthropic) but shouldn't exit silently.

if grep -qF "$MARKER" "$TARGET"; then
  echo "[patch] agent-loop no-tool-retry-guard already applied"
else
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
fi

# ── Patch C: transient-error-retry ───────────────────────────────
# A transient network drop (errorMessage "terminated" / "fetch failed" /
# ECONNRESET / ...) during streaming surfaces as a GRACEFUL stopReason="error"
# message DOWNSTREAM of streamWithRetry: pi-ai's streamSimple returns an
# un-consumed EventStream, the fetch runs in a detached IIFE, and the rejection
# is caught there and converted to an error EVENT (never re-thrown). agent-loop.js
# then drains the stream, sees stopReason="error", and treats it as a clean
# terminal exit at the check below — short-circuiting every retry guard. A single
# blip kills a multi-hour session and waits for a human restart. Observed
# 2026-06-08 on a deepseek-v4-pro brain (Yb-collisional-gate): one "terminated"
# at the 4h mark ended the run; checkpoint resume worked, but only by hand.
#
# Patch: on a TRANSIENT stopReason="error" (same regex as Sisyphus's
# streamWithRetry), pop the error message, back off (1/2/4/8/16/30s), and re-stream
# the SAME turn, up to a per-streak cap of 6 (~61s — provider blips routinely exceed
# the old 15s/4-retry window; 2026-06-24 deepseek outage killed 4 runs at 4/15s). On
# exhaustion it logs a loud TRANSIENT-EXHAUSTED line (tripwire to widen the cap).
# "aborted" and non-transient errors keep the unconditional return. Bounded by the
# streak cap + maxTurns + cost/time hooks.

MARKER_RETRY="[transient-error-retry patched]"
if grep -qF "$MARKER_RETRY" "$TARGET"; then
  echo "[patch] agent-loop transient-error-retry already applied"
else
python3 - "$TARGET" "$MARKER_RETRY" <<'PYEOF'
import sys

path, marker = sys.argv[1], sys.argv[2]
src = open(path).read()

# Declaration: a per-streak counter alongside the inner-loop state.
old_decl = """        let hasMoreToolCalls = true;
        let steeringAfterTools = null;"""
new_decl = """        let hasMoreToolCalls = true;
        let steeringAfterTools = null;
        let __transientRetryStreak = 0; // """ + marker
if old_decl not in src:
    print("[patch] FAIL: transient-error-retry anchor (inner-loop state) not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old_decl, new_decl, 1)

# Re-issue a transient error-turn instead of exiting.
old_err = """            if (message.stopReason === "error" || message.stopReason === "aborted") {
                await emit({ type: "turn_end", message, toolResults: [] });
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }"""
new_err = """            if (message.stopReason === "error" || message.stopReason === "aborted") {
                const __errMsg = String(message.errorMessage ?? ""); // """ + marker + """
                const __TRANSIENT_RE = /connection.?error|connection.?refused|fetch failed|terminated|other side closed|stream aborted|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|overloaded/i;
                if (message.stopReason === "error" && __TRANSIENT_RE.test(__errMsg) && __transientRetryStreak < 6) {
                    const __backoff = [1000, 2000, 4000, 8000, 16000, 30000][__transientRetryStreak] ?? 30000;
                    __transientRetryStreak++;
                    newMessages.pop();
                    console.error(`[transient-error-retry ${__transientRetryStreak}/6] stopReason=error (${__errMsg.slice(0, 80)}); backoff ${__backoff}ms then re-stream the turn`);
                    await new Promise((r) => setTimeout(r, __backoff));
                    hasMoreToolCalls = true;
                    continue;
                }
                if (message.stopReason === "error" && __TRANSIENT_RE.test(__errMsg)) {
                    console.error(`[transient-error-retry] TRANSIENT-EXHAUSTED after 6 retries (~61s) — giving up turn: ${__errMsg.slice(0, 120)}`);
                }
                await emit({ type: "turn_end", message, toolResults: [] });
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }
            __transientRetryStreak = 0; // """ + marker
if old_err not in src:
    print("[patch] FAIL: transient-error-retry anchor (error stop) not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old_err, new_err, 1)

open(path, "w").write(src)
print("[patch] agent-loop transient-error-retry applied")
PYEOF
fi

# ── Patch B: finish-tool-exit ────────────────────────────────────
# Exit the inner loop only when finish() actually SUCCEEDED — keyed off
# the toolResult's `details.success === true`, which both finish tools set
# ONLY on their success path (src/tools/index.ts brain finish,
# src/tools/sub-agent-exit.ts). Without this, providers using
# tool_choice="required" (Kimi, deepseek-chat, openai chat — see
# pickRequireToolChoice) can never natural-exit: every turn has tool
# calls so `hasMoreToolCalls = toolCalls.length > 0` is always true, and
# finish() returning doesn't break the loop. Observed 2026-05-13 on Kimi
# typesetter (50-min spin).
#
# 2026-06-12 fix: the original condition keyed off the finish CALL, not its
# RESULT — so a gate-BLOCKED finish (e.g. the PDF-correctness gate catching
# an undefined citation on Yb-vs-Rb) still exited the loop, shipping a
# corpse: checkpoint left live, registry marked done, completion email sent.
# Every finish gate was decorative at the loop layer. Keying off
# details.success makes a blocked finish return its block text to the agent
# for another turn (bounded by maxTurns + cost/time hooks), while a real
# finish still exits — including sub-agents under tool_choice="required".
#
# Applies AFTER patch A's modification so the anchor matches the
# already-patched file.

if grep -qF "$MARKER_EXIT" "$TARGET"; then
  echo "[patch] agent-loop finish-tool-exit already applied"
  exit 0
fi

python3 - "$TARGET" "$MARKER_EXIT" <<'PYEOF'
import sys

path, marker = sys.argv[1], sys.argv[2]
src = open(path).read()

# Anchor: inside the `if (hasMoreToolCalls)` branch, after results are
# pushed but before any subsequent logic. Must work whether or not patch
# A is applied (we don't depend on patch A's modifications).
old = """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }"""
new = """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
                if (toolResults.some((r) => r?.toolName === \"finish\" && r?.details?.success === true)) { // """ + marker + """
                    hasMoreToolCalls = false;
                }
            }"""
if old not in src:
    print("[patch] FAIL: finish-tool-exit anchor (toolResults push) not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old, new, 1)

open(path, "w").write(src)
print("[patch] agent-loop finish-tool-exit applied")
PYEOF
