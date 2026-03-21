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

# browser-use CLI for browser automation
BROWSER_USE="$HOME/.browser-use-env/bin/browser-use"
if [ -x "$BROWSER_USE" ]; then
  echo "browser-use: ready ($BROWSER_USE)"
  $BROWSER_USE doctor 2>&1 | grep -E '✓|✗|⚠' | head -5
else
  echo "Warning: browser-use not found — browser automation will not work."
  echo "Install: pip install browser-use (see https://github.com/browser-use/browser-use)"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/search" 2>/dev/null

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
echo "  browser-use open <url>"
