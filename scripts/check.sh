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

MODE="${1:-all}"
if [ "$MODE" = "all" ]; then
  step bunx tsc --noEmit
  step bun run lint
fi
step bun test

echo "check.sh exit: $overall (full log: $LOG)" | tee -a "$LOG"
exit "$overall"
