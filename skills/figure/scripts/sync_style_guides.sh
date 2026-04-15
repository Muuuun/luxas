#!/usr/bin/env bash
# Refresh skills/figure/style_guides/*.md from the aesthetic_style_skills repo.
# Idempotent. Requires read access to Muuuun/aesthetic_style_skills (private).
set -euo pipefail

REPO_URL="${AESTHETIC_REPO:-git@github.com:Muuuun/aesthetic_style_skills.git}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HERE/style_guides"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning $REPO_URL into $TMP ..."
git clone --depth 1 "$REPO_URL" "$TMP/aesthetic"

SRC="$TMP/aesthetic/data/style_guides"
if [[ ! -d "$SRC" ]]; then
  echo "Expected $SRC after clone; aborting." >&2
  exit 1
fi

for f in physics biology chemistry earth ml policy; do
  if [[ -f "$SRC/$f.md" ]]; then
    cp "$SRC/$f.md" "$DEST/$f.md"
    echo "  updated $f.md"
  else
    echo "  MISSING $f.md in source — skipped" >&2
  fi
done

echo "Done. _default.md and README.md are local — not overwritten."
