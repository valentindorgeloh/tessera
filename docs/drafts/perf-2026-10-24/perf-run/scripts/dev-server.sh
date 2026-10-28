#!/bin/bash
# MEASURE-DEV: start/stop a next dev or next start server from a copy and time "Ready".
# Usage: dev-server.sh start <copyDir> <port> <db file name in copy/data> <dev|prod> <logfile> [cold]
#        dev-server.sh stop <port>
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY
cmd=$1
stop_port() {
  local port=$1
  local pids=$(lsof -tiTCP:$port -sTCP:LISTEN)
  [ -z "$pids" ] && return 0
  local all="$pids"
  for p in $pids; do
    pp=$(ps -o ppid= -p $p | tr -d ' ')
    if [ -n "$pp" ] && ps -o command= -p $pp | grep -q "next/dist/bin/next"; then all="$all $pp"; fi
    all="$all $(pgrep -P $p)"
  done
  kill $all 2>/dev/null
  for i in $(seq 1 100); do
    alive=0; for p in $all; do kill -0 $p 2>/dev/null && alive=1; done
    [ $alive = 0 ] && return 0
    sleep 0.1
  done
  kill -9 $all 2>/dev/null; sleep 0.5
}
if [ "$cmd" = stop ]; then stop_port $2; exit 0; fi
B=$2; PORT=$3; DB=$4; MODE=$5; LOG=$6; COLD=$7
case $PORT in 3800|3801) ;; *) echo "port $PORT not allowed"; exit 1;; esac
cd "$B" || exit 1
if [ "$COLD" = cold ]; then
  for i in 1 2 3 4 5; do rm -rf "$B/.next/dev" 2>/dev/null; [ -e "$B/.next/dev" ] || break; sleep 1; done
  [ -e "$B/.next/dev" ] && { echo "could not remove .next/dev"; exit 1; }
fi
t0=$(python3 -c 'import time;print(time.time())')
if [ "$MODE" = dev ]; then
  TESSERA_DB_PATH="$B/data/$DB" TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p $PORT > "$LOG" 2>&1 &
else
  TESSERA_DB_PATH="$B/data/$DB" TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT > "$LOG" 2>&1 &
fi
for i in $(seq 1 1200); do
  if grep -q "Ready in" "$LOG" 2>/dev/null; then break; fi
  sleep 0.05
done
t1=$(python3 -c 'import time;print(time.time())')
python3 -c "print('wall_to_ready_ms', round(($t1-$t0)*1000))"
grep -m1 "Ready in" "$LOG"
