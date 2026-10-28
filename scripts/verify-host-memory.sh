#!/usr/bin/env bash
#
# Confirm, by conversation, that a host's memory backend actually works.
#
# The ledger records three separate instances of a host looking wired while being
# unable to remember anything: a config mentioning cogmem in thirty-three places, a
# `connect` that reported success, an exit code of zero. Two of the three hosts were
# broken in exactly that state, and the test suite could not see either, because what
# was wrong was which binary a plugin resolved and which shape a hook received on that
# machine. Only holding a conversation finds those.
#
# The check, as a script rather than a paragraph:
#
#   1. write a fact into cogmem through MCP, for the project the host's plugin uses
#   2. assert the host's own store has no copy, so an answer can only come from cogmem
#   3. ask the host in a fresh session and require the fact back
#
# Step 2 is what makes step 3 mean anything: without it a host answers from its own
# store and passes, which is how a broken backend stayed invisible for nine rounds.
#
# Usage:
#   INSTABOX_API_KEY=... scripts/verify-host-memory.sh <box> <openclaw|hermes|pi> [workdir]
#
# Run end to end against a box for all three hosts, each recalling a code written only
# into cogmem: openclaw VERIFY1985626, hermes VERIFY1987213, pi VERIFY1987556. Those are
# the same results the rounds reached by hand, now reachable by re-running this.
set -euo pipefail

BOX="${1:?usage: verify-host-memory.sh <box> <openclaw|hermes|pi> [workdir]}"
HOST="${2:?usage: verify-host-memory.sh <box> <openclaw|hermes|pi> [workdir]}"
WORKDIR="${3:-/data/workspace/flow}"
IB="${INSTABOX_BIN:-instabox}"
CODE="VERIFY$$"

case "$HOST" in openclaw|hermes|pi) ;; *) echo "unknown host: $HOST" >&2; exit 2 ;; esac

LIB=$(mktemp)
trap 'rm -f "$LIB"' EXIT

# The box-side half, written with a quoted heredoc so nothing expands here and the host,
# code and workdir arrive as arguments rather than through quoting layers.
cat > "$LIB" <<'BOXSIDE'
set -e
HOST="$1"; CODE="$2"; WORK="$3"
export PATH="/data/home/.npm-global/bin:/data/home/.bun/bin:/data/home/.local/bin:$PATH"
cd "$WORK"

case "$HOST" in
  openclaw) CONF=/data/home/.openclaw/openclaw.json; HOME_DIR=/data/home/.openclaw ;;
  hermes)   CONF=/data/home/.hermes/config.yaml;    HOME_DIR=/data/home/.hermes ;;
  pi)       CONF=/data/home/.pi/agent/mcp.json;     HOME_DIR=/data/home/.pi ;;
esac

PROJECT=$(python3 - "$HOST" "$CONF" <<'PY'
import json, re, sys
host, conf = sys.argv[1], sys.argv[2]
try:
    if host == 'openclaw':
        d = json.load(open(conf))
        for entry in (d.get('plugins', {}).get('entries') or {}).values():
            cfg = (entry or {}).get('config') or {}
            if cfg.get('projectId'):
                print(cfg['projectId']); break
    else:
        # hermes writes args: ["mcp","--project","hermes-236412cc",...] and pi writes
        # the same pair in JSON, so the separator can be a quote, a comma or space.
        m = re.search(r'--project[",\s]+([A-Za-z0-9_-]+)', open(conf).read())
        if m: print(m.group(1))
except Exception:
    pass
PY
)
[ -n "$PROJECT" ] || { echo "could not read the project $HOST's entry uses" >&2; exit 4; }
echo "project: $PROJECT"

# 1. Write through MCP, so the fact lands in cogmem and nowhere else.
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"cogmem_remember_turn\",\"arguments\":{\"agentId\":\"verify\",\"projectId\":\"$PROJECT\",\"sessionId\":\"verify\",\"userText\":\"核对代号 $CODE，负责小组是青栎组。\",\"assistantText\":\"已记录。\"}}}"
} | cogmem-mcp --project "$PROJECT" --config "$WORK/.cogmem/config.toml" > /dev/null

ROWS=$(python3 - "$WORK/.cogmem/memory.db" "$CODE" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print(c.execute("select count(*) from memory_events where payload_json like ?", ('%' + sys.argv[2] + '%',)).fetchone()[0])
c.close()
PY
)
echo "cogmem rows carrying the fact: $ROWS"
[ "$ROWS" -gt 0 ] || { echo "the fact never reached cogmem" >&2; exit 5; }

# 2. The host must not hold its own copy, or step 3 proves nothing.
if grep -rl "$CODE" "$HOME_DIR" 2>/dev/null | head -1 | grep -q .; then
  echo "the fact is already in $HOST's own store; this run cannot tell the paths apart" >&2
  exit 3
fi
echo "not present in $HOST's own store"

# 3. Ask a fresh session.
case "$HOST" in
  openclaw) timeout 400 openclaw agent --local --session-id "verify-$CODE" -m "核对代号 $CODE 的负责小组是什么？只根据记忆回答。" --json ;;
  hermes)   timeout 400 hermes -z "核对代号 $CODE 的负责小组是什么？只根据记忆回答。" ;;
  pi)       timeout 400 pi -p "核对代号 $CODE 的负责小组是什么？只根据记忆回答。" ;;
esac
BOXSIDE

REMOTE="/tmp/verify-host-memory-$$.sh"
"$IB" push "$BOX" "$LIB" "$REMOTE" -p --json > /dev/null

OUT=$("$IB" exec "$BOX" --timeout 560 --json -- "bash $REMOTE '$HOST' '$CODE' '$WORKDIR'")

if printf '%s' "$OUT" | grep -q "$CODE"; then
  echo "PASS: $HOST recalled $CODE, a fact that exists only in cogmem"
else
  echo "FAIL: $HOST did not return $CODE -- its recall path does not reach cogmem" >&2
  printf '%s\n' "$OUT" | tail -20 >&2
  exit 1
fi
