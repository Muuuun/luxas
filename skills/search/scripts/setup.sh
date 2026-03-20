#!/bin/bash
# Setup search skill dependencies.
# Run once: bash skills/search/scripts/setup.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Setting up search skill ==="

# search CLI needs Node.js 22+ (built-in fetch)
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "Error: Node.js 22+ required (have $NODE_VERSION). Install via nvm or brew."
  exit 1
fi
echo "Node.js: v$(node -v | tr -d v)"

# sb-browser needs Python + seleniumbase
if command -v python3 &>/dev/null; then
  echo "Python: $(python3 --version 2>&1 | awk '{print $2}')"
  echo "Installing seleniumbase..."
  pip3 install --user seleniumbase 2>&1 | tail -3

  # Rosetta 2 for Apple Silicon
  if [[ "$(uname -m)" == "arm64" ]] && [[ "$(uname)" == "Darwin" ]]; then
    if ! /usr/bin/pgrep oahd &>/dev/null; then
      echo "Installing Rosetta 2 (needed for chromedriver)..."
      softwareupdate --install-rosetta --agree-to-license 2>/dev/null || true
    fi
  fi
  echo "sb-browser: ready"
else
  echo "Warning: python3 not found — sb-browser (anti-detect browser) will not work."
  echo "Install Python 3.9+ if you need Cloudflare bypass."
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/search" "$SCRIPT_DIR/sb-browser" 2>/dev/null

# Brave Search (optional)
if [ -z "$BRAVE_API_KEY" ]; then
  echo "Note: BRAVE_API_KEY not set — 'search web' will not work."
  echo "Get a free key at https://brave.com/search/api/"
fi

echo ""
echo "=== search skill ready ==="
echo "  $SCRIPT_DIR/search papers <query>"
echo "  $SCRIPT_DIR/search citations <id>"
echo "  $SCRIPT_DIR/search web <query>"
echo "  $SCRIPT_DIR/search fetch <url>"
echo "  $SCRIPT_DIR/sb-browser open <url>"
