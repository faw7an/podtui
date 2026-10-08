#!/usr/bin/env bash
# Full verification pipeline. Every byte of output goes to stdout AND to
# .check-logs/last.log, so a failure can never be lost to tail-only output.
# Usage: scripts/check.sh [all|test]  (default: all)
set -u

mkdir -p .check-logs
LOG=.check-logs/last.log
: > "$LOG"

overall=0
step() {
  echo "+ $*" | tee -a "$LOG"
  "$@" 2>&1 | tee -a "$LOG"
  code="${PIPESTATUS[0]}"
  if [ "$code" -ne 0 ]; then
    overall="$code"
  fi
}

# bun.lock is lockfileVersion 2, written by the Bun pinned in package.json
# ("packageManager"). Older Bun cannot read it (Bun 1.3.10: "failed to parse
# lockfile"), so say so up front instead of letting `bun install` fail oddly.
PINNED_BUN=$(sed -n 's/.*"packageManager": *"bun@\([^"]*\)".*/\1/p' package.json)
if [ -n "$PINNED_BUN" ] && [ "$(bun --version)" != "$PINNED_BUN" ]; then
  echo "WARNING: Bun $(bun --version) is running, the project pins Bun $PINNED_BUN (package.json packageManager)." | tee -a "$LOG"
fi

MODE="${1:-all}"
if [ "$MODE" = "all" ]; then
  step bunx tsc --noEmit
  step bun run lint
fi
step bun test

echo "check.sh exit: $overall (full log: $LOG)" | tee -a "$LOG"
exit "$overall"
