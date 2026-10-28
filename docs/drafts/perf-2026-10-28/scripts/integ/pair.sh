#!/bin/zsh
# Integrator: start BEFORE and AFTER `next start` side by side on fresh, migrated copies of one data set, run one probe
# command that takes both ports (it interleaves A/B itself: ab-assets.mjs, ab-peek.mjs), then stop both.
# Ports: large A(before) 3834 / B(after) 3832; small A 3835 / B 3833. The command sees $PA $PB $PROJECT.
# Usage: pair.sh <large|small> '<command using $PA $PB>'
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=${BC:-/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc}
DD=$BC/integ-data/pair; MASTER=$BC/integ-data/master; mkdir -p $DD $BC/logs-integ
kind=$1; cmd=$2
case $kind in
  small) export PROJECT=01a160df-642f-7102-859a-8c50a72e7f1e; SRC=$MASTER/small.db; export PA=3835 PB=3833 ;;
  large) export PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; SRC=$MASTER/p11-perf.db; export PA=3834 PB=3832 ;;
esac
stop() { local i; lsof -tiTCP:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$1 -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
start() { local i; (cd $1 && env TESSERA_DB_PATH=$3 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $2 > $BC/logs-integ/$2.log 2>&1 &); for i in $(seq 1 150); do curl -s -o /dev/null http://127.0.0.1:$2/inbox && break; sleep 0.2; done; }
stop $PA; stop $PB
for v in A B; do db=$DD/$v-$kind.db; rm -f $db $db-wal $db-shm; cp $SRC $db; done
start $BC/before $PA $DD/A-$kind.db
start $BC/after $PB $DD/B-$kind.db
echo "load $(uptime | sed 's/.*load averages: //')"
eval "$cmd"
rc=$?
echo "load $(uptime | sed 's/.*load averages: //')"
stop $PA; stop $PB
exit $rc
