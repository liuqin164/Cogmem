#!/usr/bin/env bash
# End-to-end smoke test against the real CLI over Streamable HTTP.
set -u

PORT=${PORT:-7391}
DB=${DB:-/tmp/cogmem-e2e/memory.db}
mkdir -p "$(dirname "$DB")"
rm -f "$DB" "$DB"-wal "$DB"-shm

cd "$(dirname "$0")/../.." || exit 1
bun src/bin/mcp.ts --transport http --port "$PORT" --host claude --profile core --db "$DB" \
  > /tmp/cogmem-e2e/server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/mcp"; then break; fi
  sleep 0.25
done

post() {
  local body=$1 sid=${2:-}
  if [ -n "$sid" ]; then
    curl -s -D /tmp/cogmem-e2e/h.txt -H "content-type: application/json" \
      -H "accept: application/json, text/event-stream" -H "mcp-session-id: $sid" \
      -d "$body" "http://127.0.0.1:$PORT/mcp"
  else
    curl -s -D /tmp/cogmem-e2e/h.txt -H "content-type: application/json" \
      -H "accept: application/json, text/event-stream" \
      -d "$body" "http://127.0.0.1:$PORT/mcp"
  fi
}

# SSE -> last JSON payload
sse_json() { python3 -c "
import sys, json
lines=[l[5:].strip() for l in sys.stdin if l.startswith('data:')]
print(lines[-1] if lines else '{}')
"; }

echo "== 1. initialize =="
INIT=$(post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}')
SID=$(grep -i '^mcp-session-id:' /tmp/cogmem-e2e/h.txt | tr -d '\r' | awk '{print $2}')
echo "session: ${SID:-<none>}"
echo "$INIT" | sse_json | python3 -c "import sys,json; d=json.load(sys.stdin); print('server:', d['result']['serverInfo'])"

echo "== 2. tools/list =="
LIST=$(post '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$SID")
echo "$LIST" | sse_json | python3 -c "import sys,json; d=json.load(sys.stdin); print('tools:', [t['name'] for t in d['result']['tools']])"

echo "== 3. write a turn (cogmem_remember_turn) =="
WRITE=$(post '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cogmem_remember_turn","arguments":{"agentId":"claude","sessionId":"smoke-session-1","userText":"seekdb 的跨库事务在原型里验证通过了","projectId":"cogmem-e2e"}}}' "$SID")
echo "$WRITE" | sse_json | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('result',{})
print('isError:', r.get('isError', False))
print('text:', (r.get('content') or [{}])[0].get('text','')[:220])
"

echo "== 4. recall it back (cogmem_recall) =="
REC=$(post '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"cogmem_recall","arguments":{"query":"seekdb 跨库事务","agentId":"claude","projectId":"cogmem-e2e"}}}' "$SID")
echo "$REC" | sse_json | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('result',{})
t=(r.get('content') or [{}])[0].get('text','')
print('isError:', r.get('isError', False))
print('recallMode:', json.loads(t).get('recallMode') if t.startswith('{') else 'n/a')
hit = '跨库事务' in t
print('写入内容出现在召回结果中:', hit)
print('recall head:', t[:200].replace(chr(10),' '))
"

echo "== 5. profile guard =="
GUARD=$(post '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"cogmem_dream_tick","arguments":{}}}' "$SID")
echo "$GUARD" | sse_json | python3 -c "
import sys,json
r=json.load(sys.stdin).get('result',{})
print('isError:', r.get('isError'), '|', (r.get('content') or [{}])[0].get('text','')[:90])
"

echo "== 6. db file =="
ls -lh "$DB" | awk '{print $5, $9}'
echo "== server log =="
cat /tmp/cogmem-e2e/server.log
