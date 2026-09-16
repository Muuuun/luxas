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

# Web search API keys (Tavily preferred, Brave as fallback)
if [ -n "$TAVILY_API_KEY" ]; then
  echo "Tavily API key: set (preferred web search provider)"
elif [ -n "$BRAVE_API_KEY" ]; then
  echo "Brave API key: set (fallback web search provider)"
  echo "Tip: Set TAVILY_API_KEY for preferred web search. Get a free key at https://app.tavily.com"
else
  echo "Note: No web search API key set — 'search web' will not work."
  echo "Set TAVILY_API_KEY (preferred, https://app.tavily.com) or BRAVE_API_KEY (https://brave.com/search/api/)"
fi

echo ""
echo "=== search skill ready ==="
echo "  $SCRIPT_DIR/search papers <query>"
echo "  $SCRIPT_DIR/search citations <id>"
echo "  $SCRIPT_DIR/search web <query>"
echo "  $SCRIPT_DIR/search fetch <url>"
echo "  browser-use open <url>"
