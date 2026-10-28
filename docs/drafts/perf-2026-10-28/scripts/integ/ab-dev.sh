#!/bin/zsh
# Integrator (from perf-run integ2-ab-dev.sh): interleaved dev A/B of BEFORE (bc/before, BASE 6331186) against AFTER
# (bc/after, lanes B + C), each on its own cold-started `next dev` (rm -rf .next/dev first) and its own fresh copy of the
# data set. Every route the samples visit is compiled once, then one warm-up code-wi-sample.mjs per arm. Per round and
# arm: code-wi-sample.mjs (full list load + sidebar /inbox -> list). Order per round: before, after.
# Ports: large before 3834 / after 3832; small before 3835 / after 3833.
# Usage: ab-dev.sh <large|small> <rounds> <out.jsonl>
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=${BC:-/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc}
S=$BC/scripts-integ; D=$BC/integ-data/dev; MASTER=$BC/integ-data/master
mkdir -p $D $BC/logs-integ
set=$1; rounds=$2; out=$3
case $set in
  large) PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; PB=3834; PA=3832; SRC=$MASTER/p11-perf.db ;;
  small) PROJECT=01a160df-642f-7102-859a-8c50a72e7f1e; PB=3835; PA=3833; SRC=$MASTER/small.db ;;
  *) echo "set must be large or small"; exit 1 ;;
esac
stop() { local i; lsof -tiTCP:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$1 -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
startdev() { # dir port db log
  local i
  rm -rf $1/.next/dev
  (cd $1 && env TESSERA_DB_PATH=$3 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p $2 > $4 2>&1 &)
  for i in $(seq 1 300); do curl -s -o /dev/null http://127.0.0.1:$2/inbox && break; sleep 0.3; done
  for p in / /inbox /projects /projects/$PROJECT/work-items /projects/$PROJECT/cycles /analytics/overview; do curl -s -o /dev/null http://127.0.0.1:$2$p; done
}
stop $PB; stop $PA
for v in before after; do rm -f $D/dev-$v-$set.db $D/dev-$v-$set.db-wal $D/dev-$v-$set.db-shm; cp $SRC $D/dev-$v-$set.db; done
LB=$BC/logs-integ/$PB-dev-$set.log; LA=$BC/logs-integ/$PA-dev-$set.log
startdev $BC/before $PB $D/dev-before-$set.db $LB
startdev $BC/after $PA $D/dev-after-$set.db $LA
node $S/code-wi-sample.mjs $PB $PROJECT > /dev/null 2>&1
node $S/code-wi-sample.mjs $PA $PROJECT > /dev/null 2>&1
: > $out
for i in $(seq 1 $rounds); do
  for v in before after; do
    if [ $v = before ]; then port=$PB; else port=$PA; fi
    curl -s -o /dev/null http://127.0.0.1:$port/projects/$PROJECT/work-items
    load=$(uptime | sed 's/.*load averages: //')
    line=$(node $S/code-wi-sample.mjs $port $PROJECT)
    [ -z "$line" ] && line=null
    echo "{\"round\":$i,\"variant\":\"$v\",\"load\":\"$load\",\"sample\":{\"wi\":$line}}" >> $out
    echo "$i $v $load $line"
  done
done
stop $PB; stop $PA
