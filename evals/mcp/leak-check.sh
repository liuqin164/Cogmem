#!/usr/bin/env bash
# Verifies that running the MCP test files leaves no cogmem MCP server behind.
#
# A leaked `bun src/bin/mcp.ts --transport http ...` process holds its port and
# its SQLite files open indefinitely, which is invisible to `bun test` because
# every test still reports pass. This compares the process set before and after
# a test run, so a leak fails the check instead of hiding in `ps`.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

FILES=(
  __tests__/mcp-execution.unit.test.ts
  __tests__/mcp-http.unit.test.ts
  __tests__/mcp-tools.unit.test.ts
  __tests__/mcp-cli.unit.test.ts
  __tests__/memory-atlas-mcp.unit.test.ts
  __tests__/candidate-review-cli-mcp.unit.test.ts
)

# Server processes only. `$$` and its parent are excluded because this script's
# own arguments mention the pattern it greps for.
server_pids() {
  ps -eo pid=,args= | awk -v me="$$" -v parent="$PPID" '
    $1 == me || $1 == parent { next }
    /bun .*bin\/mcp\.(ts|js)/ { print $1 }
  ' | sort -u
}

before=$(server_pids)
echo "== baseline MCP server pids =="
echo "${before:-<none>}"

echo "== running ${#FILES[@]} MCP test files =="
bun test "${FILES[@]}" 2>&1 | tail -6
suite_status=${PIPESTATUS[0]}

after=$(server_pids)
leaked=$(comm -13 <(echo "$before") <(echo "$after") | grep -v '^$' || true)

echo "== after: MCP server pids =="
echo "${after:-<none>}"

if [ -n "$leaked" ]; then
  echo "LEAK: the test run left MCP server processes behind:"
  for pid in $leaked; do
    ps -o pid=,lstart=,args= -p "$pid"
  done
  ss -ltnp 2>/dev/null | grep -E "pid=($(echo "$leaked" | paste -sd, -))" || true
  exit 2
fi

if [ "$suite_status" -ne 0 ]; then
  echo "tests failed (exit $suite_status); no new MCP server processes"
  exit "$suite_status"
fi

echo "no leaked MCP server processes"
