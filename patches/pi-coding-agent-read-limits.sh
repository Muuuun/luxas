#!/bin/bash
# Raise pi-coding-agent's read-tool limits to Claude Code's (2000→10000 lines,
# 50KB→200KB) so experiment agents stop re-reading one file dozens of times.
# A missed patch is a hard error: silently keeping the low limits is the bug
# this exists to prevent.

set -euo pipefail

TRUNCATE=""
for scope in @earendil-works @mariozechner; do
  cand="node_modules/$scope/pi-coding-agent/dist/core/tools/truncate.js"
  if [ -f "$cand" ]; then TRUNCATE="$cand"; break; fi
done

if [ -z "$TRUNCATE" ]; then
  echo "[patch] pi-coding-agent not installed; nothing to patch" >&2
  exit 0
fi

if grep -q "DEFAULT_MAX_LINES = 10000" "$TRUNCATE"; then
  echo "[patch] pi-coding-agent read limits already updated"
  exit 0
fi

if ! grep -q "DEFAULT_MAX_LINES = 2000" "$TRUNCATE"; then
  echo "[patch] FAIL: DEFAULT_MAX_LINES anchor not found in $TRUNCATE" >&2
  exit 1
fi

# Portable in-place edit: `sed -i ''` is BSD/macOS-only and GNU sed reads the
# '' as a script, which failed the first Linux install (droplet, 2026-08-23).
# Write to a temp file and move it over instead of relying on either dialect.
TMP="$(mktemp "${TRUNCATE}.XXXXXX")"
sed \
  -e 's/DEFAULT_MAX_LINES = 2000/DEFAULT_MAX_LINES = 10000/' \
  -e 's/DEFAULT_MAX_BYTES = 50 \* 1024/DEFAULT_MAX_BYTES = 200 * 1024/' \
  "$TRUNCATE" > "$TMP" && mv "$TMP" "$TRUNCATE"

grep -q "DEFAULT_MAX_LINES = 10000" "$TRUNCATE" || { echo "[patch] FAIL: read-limit rewrite did not take" >&2; exit 1; }
grep -q "DEFAULT_MAX_BYTES = 200 \* 1024" "$TRUNCATE" || { echo "[patch] FAIL: byte-limit rewrite did not take" >&2; exit 1; }
echo "[patch] pi-coding-agent read limits updated (10000 lines, 200KB)"
