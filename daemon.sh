#!/bin/bash
# Luxas Daemon — continuously runs research until all phases complete.
# Restarts automatically if Claude Code session drops.
#
# Usage: ./daemon.sh "Large Language Model Reasoning"
#        ./daemon.sh  (resume)
#
# Stop: kill the process or Ctrl+C

set -euo pipefail
cd "$(dirname "$0")"

TOPIC="${1:-}"
MAX_RETRIES=10
RETRY_DELAY=30  # seconds between retries

echo "=========================================="
echo " Luxas Daemon"
echo " Il faut imaginer Sisyphe heureux."
echo "=========================================="

retry=0
while [ $retry -lt $MAX_RETRIES ]; do
    echo ""
    echo "[$(date)] Attempt $((retry + 1))/$MAX_RETRIES"

    if [ -n "$TOPIC" ]; then
        npx tsx src/index.ts run "$TOPIC" && break
    else
        npx tsx src/index.ts resume && break
    fi

    exit_code=$?

    # Check if we completed (state file says "done")
    if [ -f research-state.json ]; then
        phase=$(node -e "console.log(JSON.parse(require('fs').readFileSync('research-state.json','utf8')).current_phase||'')")
        if [ "$phase" = "done" ]; then
            echo "[$(date)] Research complete!"
            break
        fi
    fi

    retry=$((retry + 1))
    echo "[$(date)] Session ended (exit=$exit_code). Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY

    # After first run, always resume (topic is saved in state file)
    TOPIC=""
done

if [ $retry -ge $MAX_RETRIES ]; then
    echo "[$(date)] Max retries reached. Check logs."
    exit 1
fi
