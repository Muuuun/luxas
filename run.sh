#!/bin/bash
# Sisyphus — run a research survey
# Usage: ./run.sh "Large Language Model Reasoning"
#        ./run.sh  (resume from saved state)

set -euo pipefail
cd "$(dirname "$0")"

TOPIC="${1:-}"

if [ -n "$TOPIC" ]; then
    echo "🪨 Sisyphus: Starting research on '$TOPIC'"
    npx tsx src/index.ts run "$TOPIC"
else
    if [ -f research-state.json ]; then
        echo "🪨 Sisyphus: Resuming research..."
        npx tsx src/index.ts resume
    else
        echo "Usage: ./run.sh \"your research topic\""
        echo "       ./run.sh  (resume from saved state)"
        exit 1
    fi
fi
