#!/bin/zsh
# Integrator interleaved prod A/B (perf round 2026-10-28). A = BEFORE (BASE 6331186 build), B = AFTER (lanes B + C
# integrated). Ports: LARGE A 3834 / B 3832, SMALL A 3835 / B 3833. One fresh `next start` and one fresh, migrated copy
# of the data set per sample; the sample script runs once as a warm-up (unless WARM=0) and once measured.
# Usage: ab.sh <sample.mjs> <rounds> <out.jsonl> <large|small|grouped>   (extra sample args via ARGS env)
# Sample scripts get: <port> <projectId> <treeDir> <dbPath> [ARGS]
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=${BC:-/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc}
SC=$BC/scripts-fixer; DD=$BC/fixer-data/ab; MASTER=$BC/integ-data/master
mkdir -p $DD $BC/logs-fixer
sample=$1; rounds=$2; out=$3; kind=$4
case $kind in
  small) PROJECT=01a160df-642f-7102-859a-8c50a72e7f1e; SRC=$MASTER/small.db; PA=3838; PB=3839 ;;
  large|grouped) PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; SRC=$MASTER/p11-perf.db; PA=3838; PB=3839 ;;
esac
dirOf() { [ $1 = A ] && echo $BC/after-pre-fix || echo $BC/after; }
portOf() { [ $1 = A ] && echo $PA || echo $PB; }
stop() { local i; lsof -tiTCP:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$1 -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
start() { # dir port db
  local i
  (cd $1 && env TESSERA_DB_PATH=$3 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $2 > $BC/logs-fixer/$2.log 2>&1 &)
  for i in $(seq 1 150); do curl -s -o /dev/null http://127.0.0.1:$2/inbox && break; sleep 0.2; done
}
prep() { # variant round -> db path on stdout
  local db=$DD/$1-${sample%.mjs}-$kind-$2.db
  rm -f $db $db-wal $db-shm; cp $SRC $db
  if [ $kind = grouped ]; then
    node -e "const D=require('$BC/after/node_modules/better-sqlite3'); const d=new D('$db'); d.prepare('insert or replace into view_settings (scope_type,scope_id,filters,display,updated_at) values (?,?,?,?,?)').run('project','$PROJECT','{}',require('fs').readFileSync('$SC/grouped-display.json','utf8'),'2026-10-28T00:00:00.000Z')"
  fi
  echo $db
}
stop $PA; stop $PB
: > $out
for i in $(seq 1 $rounds); do
  for v in A B; do
    dir=$(dirOf $v); port=$(portOf $v)
    db=$(prep $v $i)
    start $dir $port $db
    curl -s -o /dev/null http://127.0.0.1:$port/projects/$PROJECT/work-items
    if [ "${WARM:-1}" = 1 ]; then
      node $SC/$sample $port $PROJECT $dir $db ${=ARGS} > /dev/null 2>&1
    fi
    load=$(uptime | sed 's/.*load averages: //')
    line=$(node $SC/$sample $port $PROJECT $dir $db ${=ARGS} 2>/dev/null | tail -1)
    [ -z "$line" ] && line=null
    echo "{\"round\":$i,\"variant\":\"$v\",\"load\":\"$load\",\"sample\":$line}" >> $out
    echo "$i $v $load ${line:0:300}"
    stop $port
    rm -f $db $db-wal $db-shm
  done
done
