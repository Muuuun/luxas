#!/bin/bash
# Patch pi-coding-agent read tool limits to match Claude Code behavior.
# Increases DEFAULT_MAX_LINES from 2000→10000, DEFAULT_MAX_BYTES from 50KB→200KB.
# This prevents experiment agents from re-reading the same file 50+ times.

TRUNCATE="node_modules/@mariozechner/pi-coding-agent/dist/core/tools/truncate.js"

if [ -f "$TRUNCATE" ]; then
  sed -i '' \
    -e 's/DEFAULT_MAX_LINES = 2000/DEFAULT_MAX_LINES = 10000/' \
    -e 's/DEFAULT_MAX_BYTES = 50 \* 1024/DEFAULT_MAX_BYTES = 200 * 1024/' \
    "$TRUNCATE"
  echo "[patch] pi-coding-agent read limits updated (10000 lines, 200KB)"
fi
