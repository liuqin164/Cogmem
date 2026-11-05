#!/usr/bin/env bash
set -u
ROOT=/home/ubuntu/.hermes/cache/scratch/seekdb-probe
N=$ROOT/node_modules/@oceanbase/seekdb-node-linux-arm64-gnu/native
DIR=$ROOT/sd-cold
rm -rf "$DIR"; mkdir -p "$DIR"

START=$(date +%s%N)
LD_LIBRARY_PATH=$N "$N/seekdb" --nodaemon --port 2883 --base-dir "$DIR" \
  --data-dir "$DIR/store" --parameter datafile_size=1G --parameter log_disk_size=1G \
  > "$DIR/boot.log" 2>&1 &
PID=$!

READY=""
for i in $(seq 1 480); do
  if (echo > /dev/tcp/127.0.0.1/2883) 2>/dev/null; then READY=$i; break; fi
  sleep 0.5
done
END=$(date +%s%N)
echo "冷启动到端口可用: $(( (END-START)/1000000 )) ms (轮询 ${READY:-超时})"

sleep 3
RSS=$(ps -o rss= -p $PID | awk '{print int($1/1024)}')
echo "稳态 RSS: ${RSS} MB"
echo "子进程数: $(pgrep -P $PID | wc -l)"
echo "数据目录: $(du -sh "$DIR" | cut -f1)"

kill $PID 2>/dev/null
sleep 3
if kill -0 $PID 2>/dev/null; then echo "SIGTERM 后仍存活，强杀"; kill -9 $PID 2>/dev/null; else echo "SIGTERM 后正常退出"; fi
echo "残留 seekdb 进程: $(pgrep -c -f 'seekdb --nodaemon' || true)"
