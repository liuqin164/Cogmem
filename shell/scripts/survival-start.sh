#!/usr/bin/env bash
# Start the resident companion shell for the 7-day survival run. Idempotent: refuses when the
# recorded pid is still alive, recovers a stale lock after a kill.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="${COGMEM_SHELL_DATA:-$PWD/.cogmem-shell}"
mkdir -p "$DATA_DIR"
PID_FILE="$DATA_DIR/survival.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "companion shell already running (pid $(cat "$PID_FILE"))" >&2
  exit 1
fi
nohup bun run src/cli.ts start >>"$DATA_DIR/survival.log" 2>&1 &
echo $! >"$PID_FILE"
echo "companion shell started: pid $(cat "$PID_FILE"), log $DATA_DIR/survival.log"
