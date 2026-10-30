#!/usr/bin/env bash
#
# Confirm, by conversation, that a host's memory backend actually works.
#
# The ledger records three separate instances of a host looking wired while being
# The pass condition is a recall, not an echo: the question carries the code (a
# distinctive retrieval key), the answer must carry an ASCII passcode that appears
# nowhere in the question. Two earlier versions of this line were worthless: grepping
# for the code passed a host that echoed its prompt, and asserting a CJK phrase
# measured whether the model paraphrased rather than whether it remembered.
#
# It writes one fact per run into the host's cogmem project, so it is a stateful
# check, not an idempotent command: the box's own store grows by one `verify` event
# each time. `--dry-run` is not offered; the point is a real round trip.
#
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
# What a FAIL means, and what it does not (#107, #109): it means the host did not
# recall the fact in a fresh one-shot session. It does NOT mean the host is unwired or
# that the server is unreachable, and this script cannot tell those apart. Measured
# 2026-10-30: pi listed `cogmem: connected, 6 tools` and its live session called
# `cogmem_recall` when asked to, yet failed here because the model does not reach for
# the tool unprompted; hermes failed here because its entry names a `--config` that
# does not exist, so its server never started. Same verdict, two unrelated fixes.
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
# What the host is asked to recall, and what the answer must contain. Unique per
# run, ASCII so a model reproduces it verbatim, and -- crucially -- never present
# in the question.
PASSCODE="BEACON-$$"

case "$HOST" in openclaw|hermes|pi) ;; *) echo "unknown host: $HOST" >&2; exit 2 ;; esac

LIB=$(mktemp)
trap 'rm -f "$LIB"' EXIT

# The box-side half, written with a quoted heredoc so nothing expands here and the host,
# code and workdir arrive as arguments rather than through quoting layers.
cat > "$LIB" <<'BOXSIDE'
set -e
HOST="$1"; CODE="$2"; WORK="$3"; PASSCODE="$4"
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
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"cogmem_remember_turn\",\"arguments\":{\"agentId\":\"verify\",\"projectId\":\"$PROJECT\",\"sessionId\":\"verify\",\"userText\":\"核对代号 $CODE，通行口令是 $PASSCODE。\",\"assistantText\":\"已记录。\"}}}"
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
  openclaw) timeout 400 openclaw agent --local --session-id "verify-$CODE" -m "核对代号 $CODE 的通行口令是什么？只根据记忆回答。" --json ;;
  hermes)   timeout 400 hermes -z "核对代号 $CODE 的通行口令是什么？只根据记忆回答。" ;;
  pi)       timeout 400 pi -p "核对代号 $CODE 的通行口令是什么？只根据记忆回答。" ;;
esac
BOXSIDE

REMOTE="/tmp/verify-host-memory-$$.sh"
"$IB" push "$BOX" "$LIB" "$REMOTE" -p --json > /dev/null

OUT=$("$IB" exec "$BOX" --timeout 560 --json -- "bash $REMOTE '$HOST' '$CODE' '$WORKDIR' '$PASSCODE'")

# The assertion is the passcode, which the question never contains. Grepping for the
# code instead let a host pass by echoing its own prompt; grepping for a CJK phrase
# measured the answer's shape instead (models paraphrased "青栎组-739198" to "青栎组").
if printf '%s' "$OUT" | grep -q "$PASSCODE"; then
  echo "PASS(session): $HOST recalled $PASSCODE for $CODE, a fact that exists only in cogmem"
else
  # This wording is the whole reason the check is worth running: an explanation that
  # names one cause for two different failures sends the next reader to fix the wrong
  # thing. Measured 2026-10-30 (#107, #108): pi's server IS connected and its live
  # session DOES call `cogmem_recall` when asked to, but the model does not reach for
  # the tool unprompted -- the tools arrive through its `codemode` sandbox. hermes' own
  # gateway reported `registered 0 tool(s) ... cogmem (Connection closed)` because the
  # `--config` its entry names does not exist. Same FAIL, two unrelated fixes.
  echo "FAIL(session): $HOST's one-shot invocation did not return the passcode for $CODE." >&2
  echo "  This measures ONE thing: whether $HOST reaches for cogmem on its own in a fresh" >&2
  echo "  session. It does not measure whether the server is reachable or wired -- this" >&2
  echo "  script cannot tell the two apart. Check that separately:" >&2
  echo "    pi:     pi mcp list            # expects 'cogmem: connected, N tools'" >&2
  echo "    hermes: grep 'registered .* tool' \$HERMES_HOME/logs/agent.log | tail -1" >&2
  echo "  A host that lists the tools but still fails here is a prompting/model problem;" >&2
  echo "  a host that lists none has a wiring problem, not a recall problem." >&2
  printf '%s\n' "$OUT" | tail -20 >&2
  exit 1
fi
