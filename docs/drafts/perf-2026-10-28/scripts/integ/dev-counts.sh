#!/bin/zsh
# Integrator: deterministic dev component counts on SMALL (48 rows) for BEFORE and AFTER, n=1 per variant (the counts do
# not depend on load). Each variant gets a cold `next dev` (rm -rf .next/dev) on a fresh SMALL copy per probe, because
# devcount.mjs (state pick) and refresh-dev.mjs (MCP write) write to the database.
# Ports: before 3835, after 3833. Outputs land as out-<tag>.json next to the probe scripts and in <outDir>.
# Usage: dev-counts.sh <outDir>
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=${BC:-/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc}
S=$BC/scripts-integ; D=$BC/integ-data/devcount; MASTER=$BC/integ-data/master; out=$1
mkdir -p $D $out $BC/logs-integ
PID=01a160df-642f-7102-859a-8c50a72e7f1e; ITEM=01a160df-6440-736b-a03e-3ac1380b7a52
stop() { local i; lsof -tiTCP:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$1 -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
startdev() { # dir port db
  local i
  rm -rf $1/.next/dev
  (cd $1 && env TESSERA_DB_PATH=$3 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p $2 > $BC/logs-integ/$2-devcount.log 2>&1 &)
  for i in $(seq 1 300); do curl -s -o /dev/null http://127.0.0.1:$2/inbox && break; sleep 0.3; done
  for p in / /inbox /projects/$PID/work-items "/projects/$PID/work-items?peek=$ITEM"; do curl -s -o /dev/null "http://127.0.0.1:$2$p"; done
}
for v in before after; do
  if [ $v = before ]; then port=3835; else port=3833; fi
  for probe in devcount loadcommits refresh; do
    stop $port
    db=$D/$v-$probe.db; rm -f $db $db-wal $db-shm; cp $MASTER/small.db $db
    startdev $BC/$v $port $db
    echo "== $v $probe load $(uptime | sed 's/.*load averages: //')"
    case $probe in
      devcount) node $S/devcount.mjs $port $PID integ-$v-dev > $out/devcount-$v.txt 2>&1; cp $S/out-integ-$v-dev.json $out/ ;;
      loadcommits) node $S/loadcommits.mjs $port $PID integ-$v-loadcommits > $out/loadcommits-$v.txt 2>&1 ;;
      refresh) PID=$PID TREE=$BC/$v DBP=$db N=3 node $S/refresh-dev.mjs $port integ-$v-refresh-dev $ITEM > $out/refresh-dev-$v.txt 2>&1; cp $S/out-integ-$v-refresh-dev.json $out/ ;;
    esac
    stop $port
  done
done
