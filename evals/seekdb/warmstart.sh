#!/usr/bin/env bash
set -u
ROOT=/home/ubuntu/.hermes/cache/scratch/seekdb-probe
N=$ROOT/node_modules/@oceanbase/seekdb-node-linux-arm64-gnu/native
DIR=$ROOT/sd-routeb

# 停掉现有实例
pkill -f "seekdb --nodaemon --port 2882" 2>/dev/null
sleep 4

START=$(date +%s%N)
LD_LIBRARY_PATH=$N "$N/seekdb" --nodaemon --port 2882 --base-dir "$DIR" \
  --data-dir "$DIR/store" --parameter datafile_size=2G --parameter log_disk_size=2G \
  > "$DIR/reboot.log" 2>&1 &
PID=$!

READY=""
for i in $(seq 1 240); do
  if (echo > /dev/tcp/127.0.0.1/2882) 2>/dev/null; then READY=$i; break; fi
  sleep 0.5
done
END=$(date +%s%N)
if [ -n "$READY" ]; then
  echo "热启动到端口可用: $(( (END-START)/1000000 )) ms"
else
  echo "热启动 120s 仍未就绪"
fi
sleep 5
RSS=$(ps -o rss= -p $PID | awk '{print int($1/1024)}')
echo "稳态 RSS: ${RSS} MB"
echo "线程数: $(ls /proc/$PID/task 2>/dev/null | wc -l)"
echo "子进程数: $(pgrep -P $PID | wc -l)"
echo "数据目录: $(du -sh "$DIR" 2>/dev/null | cut -f1)"
echo "PID=$PID"
