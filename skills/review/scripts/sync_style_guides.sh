#!/usr/bin/env bash
# Refresh skills/review/style_guides/*.md from the review_style_skills repo.
# Source of truth: ~/Documents/review_style_skills/data/style_guides/
# Idempotent.
set -euo pipefail

SRC="${REVIEW_STYLE_SOURCE:-$HOME/Documents/review_style_skills/data/style_guides}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HERE/style_guides"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  echo "Set REVIEW_STYLE_SOURCE env var or clone review_style_skills locally." >&2
  exit 1
fi

mkdir -p "$DEST"

for d in physics chemistry biology medicine mathematics computer_science \
         earth_environment astronomy economics materials; do
  src="$SRC/$d.md"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/$d.md"
    echo "  updated $d.md"
  else
    echo "  MISSING $d.md in source — skipped" >&2
  fi
done

echo "Done."
