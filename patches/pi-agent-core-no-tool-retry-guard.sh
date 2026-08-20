#!/bin/bash
# Patch pi-agent-core's compiled agent-loop.js with three behaviors the
# published loop does not provide. See scripts/smoke_agent_loop_patches.mts,
# which proves each one still works against whatever version is installed.
#
#   A  no-tool-retry-guard   an orchestrator holding finish() must not exit on a
#                            text-only turn; re-steer it instead.
#   C  transient-error-retry a transient stream error re-streams the same turn
#                            with backoff instead of ending a multi-hour run.
#   B  finish-tool-exit      exit only when finish() actually SUCCEEDED, so a
#                            gate-blocked finish cannot ship a corpse.
#
# Upstream deleted `steeringAfterTools` after 0.58.1 and routes steering through
# `getSteeringMessages()`/`pendingMessages` instead. Both layouts are handled;
# an unrecognized layout is a hard error, never a silent no-op.

set -euo pipefail

TARGET=""
for scope in @earendil-works @mariozechner; do
  cand="node_modules/$scope/pi-agent-core/dist/agent-loop.js"
  if [ -f "$cand" ]; then TARGET="$cand"; break; fi
done

if [ -z "$TARGET" ]; then
  echo "[patch] pi-agent-core not installed; nothing to patch" >&2
  exit 0
fi

python3 - "$TARGET" <<'PYEOF'
import sys

path = sys.argv[1]
src = open(path).read()
orig = src

M_GUARD = "[no-tool-retry-guard patched]"
M_RETRY = "[transient-error-retry patched]"
M_EXIT = "[finish-tool-exit patched]"

# Layout A (<=0.58.1) declares steeringAfterTools; layout B (>=0.62) does not.
legacy = "let steeringAfterTools = null;" in src

def fail(msg):
    print(f"[patch] FAIL: {msg}", file=sys.stderr)
    sys.exit(1)

def sub(old, new, what):
    global src
    if old not in src:
        fail(f"{what}: anchor not found (pi-agent-core layout changed)")
    src = src.replace(old, new, 1)

PUSH_RESULTS = """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
            }"""

# ── Patch A: no-tool-retry-guard ─────────────────────────────────────────
if M_GUARD not in src:
    sink = "steeringAfterTools" if legacy else "__guardSteer"
    guard = PUSH_RESULTS + """
            else if (currentContext.tools?.some?.((t) => t?.name === "finish")) { // """ + M_GUARD + """
                const hasText = message.content.some((c) => c.type === "text" && (c.text?.trim().length ?? 0) > 0);
                const hasThinking = message.content.some((c) => c.type === "thinking" && (c.thinking?.trim().length ?? 0) > 0);
                if (hasText || hasThinking) {
                    hasMoreToolCalls = true;
                    """ + sink + """ = [{
                        role: "user",
                        content: "[no_tool_retry_guard] Your previous turn produced text/thinking but no tool_use. Orchestrator agents only end via finish(). If all work is complete, call finish() now. Otherwise emit the tool_use you intended in your next turn.",
                        timestamp: Date.now(),
                    }];
                    console.error("[no_tool_retry_guard] retrying assistant turn (no tool_use; orchestrator must finish() to exit)");
                }
            }"""
    sub(PUSH_RESULTS, guard, "no-tool-retry-guard")
    if not legacy:
        # The new loop reassigns pendingMessages after turn_end, so the guard
        # message must be merged in AFTER that assignment or it is discarded.
        drain = """            pendingMessages = (await config.getSteeringMessages?.()) || [];"""
        sub(drain,
            drain + """
            if (__guardSteer) { pendingMessages = [...pendingMessages, ...__guardSteer]; __guardSteer = null; } // """ + M_GUARD,
            "no-tool-retry-guard (steer drain)")
    print("[patch] agent-loop no-tool-retry-guard applied")
else:
    print("[patch] agent-loop no-tool-retry-guard already applied")

# ── Patch C: transient-error-retry ───────────────────────────────────────
if M_RETRY not in src:
    if legacy:
        decl_old = """        let hasMoreToolCalls = true;
        let steeringAfterTools = null;"""
    else:
        decl_old = """        let hasMoreToolCalls = true;"""
    decl_new = decl_old + """
        let __transientRetryStreak = 0; // """ + M_RETRY
    if not legacy:
        decl_new += """
        let __guardSteer = null; // """ + M_GUARD
    sub(decl_old, decl_new, "transient-error-retry (inner-loop state)")

    old_err = """            if (message.stopReason === "error" || message.stopReason === "aborted") {
                await emit({ type: "turn_end", message, toolResults: [] });
                await emit({ type: "agent_end", messages: newMessages });
                return;
            }"""
    new_err = """            if (message.stopReason === "error" || message.stopReason === "aborted") {
                const __errMsg = String(message.errorMessage ?? ""); // """ + M_RETRY + """
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
            __transientRetryStreak = 0; // """ + M_RETRY
    sub(old_err, new_err, "transient-error-retry (error stop)")
    print("[patch] agent-loop transient-error-retry applied")
else:
    print("[patch] agent-loop transient-error-retry already applied")

# ── Patch B: finish-tool-exit ────────────────────────────────────────────
# Keys off the RESULT, not the call: a gate-blocked finish must not exit.
if M_EXIT not in src:
    sub(PUSH_RESULTS,
        """                for (const result of toolResults) {
                    currentContext.messages.push(result);
                    newMessages.push(result);
                }
                if (toolResults.some((r) => r?.toolName === "finish" && r?.details?.success === true)) { // """ + M_EXIT + """
                    hasMoreToolCalls = false;
                }
            }""",
        "finish-tool-exit")
    print("[patch] agent-loop finish-tool-exit applied")
else:
    print("[patch] agent-loop finish-tool-exit already applied")

if src != orig:
    open(path, "w").write(src)
PYEOF
