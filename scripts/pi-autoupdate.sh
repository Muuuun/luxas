#!/usr/bin/env bash
# pi-autoupdate — keep the vendored pi packages current, but only land an
# upgrade that has been proven on this machine. Runs daily from cron on the
# droplet (see the install note at the bottom).
#
#   1. npm has a newer @earendil-works/pi-* release, all four packages at the
#      same version (they ship in lockstep; a partial release waits a day)?
#   2. In a throwaway git worktree: vendor the tgzs, npm install (postinstall
#      patches fail HARD on a layout change), npm test (every offline gate),
#      smoke_live_canary (one real system-prompt → tool → result → finish
#      round trip per routed model, ~$0.02). Any failure: record it, touch
#      nothing, don't retry that version.
#   3. Green → commit on branch pi-auto/<ver>. Apply only when no Luxas run is
#      active (swapping node_modules under a live run mixes old and new code
#      on lazy imports); otherwise leave the branch and apply on a later day.
#   4. Apply = fast-forward the real checkout, npm ci, re-run npm test +
#      canary there. A failure here reverts the commit and reinstalls.
#
# Status: ~/.sisyphus/pi-autoupdate.json (one line of truth), logs in
# ~/.sisyphus/pi-autoupdate/<date>.log.
#   scripts/pi-autoupdate.sh              daily check (what cron runs)
#   scripts/pi-autoupdate.sh --dry-run    report what would happen, change nothing
#   scripts/pi-autoupdate.sh --rollback   revert the last auto-update commit
set -uo pipefail

REPO="${LUXAS_REPO:-$HOME/Documents/Sisyphus}"
STATE="${LUXAS_PI_AUTOUPDATE_STATE:-$HOME/.sisyphus/pi-autoupdate}"
STATUS="${LUXAS_PI_AUTOUPDATE_STATUS:-$HOME/.sisyphus/pi-autoupdate.json}"
PKGS=(pi-ai pi-agent-core pi-coding-agent pi-tui)
AUTHOR=(-c user.name=Muuuun -c user.email=mu.q.phys@gmail.com)
MODE="${1:-check}"
mkdir -p "$STATE"
LOG="$STATE/$(date -u +%F).log"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) pi-autoupdate $MODE"

exec 9>"$STATE/lock"
flock -n 9 || { echo "another pi-autoupdate is running"; exit 0; }

status() { # status <state> <detail>
  printf '{"checked_at":"%s","current":"%s","latest":"%s","status":"%s","detail":%s,"log":"%s"}\n' \
    "$(date -u +%FT%TZ)" "${CURRENT:-?}" "${LATEST:-?}" "$1" "$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$LOG" > "$STATUS"
  echo "STATUS $1: $2"
}

busy() { # a Luxas run or detached sub-agent is alive
  pgrep -f 'src/index\.ts run|subagent-runner\.ts' >/dev/null 2>&1
}

vendored_version() {
  node -p "require('$REPO/package.json').dependencies['@earendil-works/pi-ai']" | sed -E 's/.*-([0-9][0-9.]*)\.tgz$/\1/'
}

verify_in() { # verify_in <dir>: offline gates + live canary
  ( cd "$1" && npm test ) || return 1
  ( cd "$1" && npx tsx scripts/smoke_live_canary.mts ) || return 2
}

if [ "$MODE" = "--rollback" ]; then
  C=$(git -C "$REPO" log --grep='^pi .* (auto-update' --format=%H -1)
  [ -n "$C" ] || { echo "no auto-update commit to roll back"; exit 1; }
  if busy; then echo "a run is active; refusing to swap node_modules under it"; exit 1; fi
  git -C "$REPO" "${AUTHOR[@]}" revert --no-edit "$C" && (cd "$REPO" && npm ci --no-audit --no-fund) || exit 1
  CURRENT=$(vendored_version); LATEST="$CURRENT"
  status rolled_back "reverted $C"
  exit 0
fi

CURRENT=$(vendored_version)
LATEST=""
for p in "${PKGS[@]}"; do
  v=$(npm view "@earendil-works/$p" version 2>/dev/null) || { status error "npm view $p failed (network?)"; exit 0; }
  if [ -z "$LATEST" ]; then LATEST="$v"; elif [ "$v" != "$LATEST" ]; then
    status waiting "packages not in lockstep yet ($p=$v vs pi-ai=$LATEST)"; exit 0
  fi
done
if [ "$LATEST" = "$CURRENT" ] || [ "$(printf '%s\n%s\n' "$CURRENT" "$LATEST" | sort -V | tail -1)" = "$CURRENT" ]; then
  status up_to_date "vendored $CURRENT, npm $LATEST"; exit 0
fi
if [ -e "$STATE/failed-$LATEST" ]; then
  status blocked "$LATEST failed verification earlier: $(cat "$STATE/failed-$LATEST"); waiting for a newer release"; exit 0
fi
[ "$MODE" = "--dry-run" ] && { status would_update "$CURRENT -> $LATEST"; exit 0; }

BRANCH="pi-auto/$LATEST"
if ! git -C "$REPO" rev-parse -q --verify "$BRANCH" >/dev/null; then
  # ── prepare + verify in a worktree ───────────────────────────────────────
  WT="$STATE/wt-$LATEST"
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT"
  git -C "$REPO" worktree add --detach "$WT" HEAD || { status error "worktree add failed"; exit 1; }
  (
    set -e
    cd "$WT"
    for p in "${PKGS[@]}"; do
      old="vendor/earendil-works-$p-$CURRENT.tgz"
      (cd vendor && npm pack "@earendil-works/$p@$LATEST" >/dev/null)
      git rm -q "$old"
      sed -i "s#vendor/earendil-works-$p-$CURRENT.tgz#vendor/earendil-works-$p-$LATEST.tgz#" package.json
    done
    npm install --no-audit --no-fund
  )
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "install/patch failed (rc=$rc)" > "$STATE/failed-$LATEST"
    status failed "npm install / postinstall patches failed on $LATEST — a patch anchor likely moved; see log"
    git -C "$REPO" worktree remove --force "$WT"; exit 1
  fi
  verify_in "$WT"; rc=$?
  if [ $rc -ne 0 ]; then
    what=$([ $rc -eq 2 ] && echo "live canary" || echo "npm test")
    echo "$what failed" > "$STATE/failed-$LATEST"
    status failed "$what failed on $LATEST in the worktree; production untouched"
    git -C "$REPO" worktree remove --force "$WT"; exit 1
  fi
  (cd "$WT" && git add -A vendor package.json package-lock.json && git "${AUTHOR[@]}" commit -q -m "pi $CURRENT -> $LATEST (auto-update: npm test + live canary green)") \
    || { status error "commit failed in worktree"; exit 1; }
  git -C "$REPO" branch -f "$BRANCH" "$(git -C "$WT" rev-parse HEAD)"
  git -C "$REPO" worktree remove --force "$WT"
  echo "verified and committed on $BRANCH"
fi

# ── apply ──────────────────────────────────────────────────────────────────
if busy; then status verified_waiting_idle "$LATEST verified on $BRANCH; a run is active, will apply when idle"; exit 0; fi
PREV=$(git -C "$REPO" rev-parse HEAD)
if ! git -C "$REPO" merge-base --is-ancestor HEAD "$BRANCH"; then
  # The checkout moved (a deploy landed). Rebuild from the new HEAD next run.
  git -C "$REPO" branch -D "$BRANCH" >/dev/null
  status needs_rebuild "checkout moved past the verified base; will re-verify on the new HEAD next run"; exit 0
fi
# Only the files this upgrade touches matter. package-lock.json drift from an
# earlier `npm install` is noise the verified commit replaces; anything else
# dirty is someone's work, so stop and keep the verified branch.
touched=$(git -C "$REPO" diff --name-only HEAD "$BRANCH")
dirty=$(git -C "$REPO" status --porcelain --untracked-files=no | awk '{print $2}' | grep -Fx -f <(printf '%s\n' $touched) || true)
if [ "$dirty" = "package-lock.json" ]; then git -C "$REPO" checkout -- package-lock.json; dirty=""; fi
if [ -n "$dirty" ]; then
  status blocked_dirty "$LATEST verified on $BRANCH, but uncommitted changes in: $(echo $dirty); commit or discard them, the next run applies"; exit 0
fi
git -C "$REPO" merge --ff-only -q "$BRANCH" || { status error "ff-merge of $BRANCH failed unexpectedly; see log"; exit 1; }
# npm ci installs exactly the verified lockfile and never rewrites it.
if (cd "$REPO" && npm ci --no-audit --no-fund) && verify_in "$REPO"; then
  git -C "$REPO" branch -D "$BRANCH" >/dev/null
  status updated "$CURRENT -> $LATEST applied at $(git -C "$REPO" rev-parse --short HEAD) (was $(git -C "$REPO" rev-parse --short "$PREV"))"
  exit 0
fi
# Post-apply verification failed in the real checkout: undo.
git -C "$REPO" "${AUTHOR[@]}" revert --no-edit HEAD && (cd "$REPO" && npm ci --no-audit --no-fund)
echo "post-apply verification failed" > "$STATE/failed-$LATEST"
status rolled_back "$LATEST passed in the worktree but failed after apply; reverted to $(git -C "$REPO" rev-parse --short HEAD)"
exit 1

# Install (droplet, user muqiao):
#   crontab -e  →  41 4 * * * PATH=/usr/local/bin:/usr/bin:/bin /Users/muqiao/Documents/Sisyphus/scripts/pi-autoupdate.sh
