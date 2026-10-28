#!/bin/zsh
# FIXER: interleaved prod A/B on the 10k set with any one-line sample script (integ2-sample.mjs: list, peek, table,
# board, nav; fix-gantt-sample.mjs: gantt). BEFORE = perf/after2-pre (the integrated set before the fixer's changes,
# its own next build), AFTER = perf/after2 (with them, rebuilt). One `next start` per sample on its own port
# (before 3812, after 3817), one warm-up run of the sample script after each start, then the measured sample. Each arm has its own
# fresh, migrated copy of the 10k set (perf/fix-data/<arm>-large-<sample>.db). Writes {round, variant, load, sample} jsonl.
# Usage: fix-ab.sh <sample.mjs> <rounds> <out.jsonl> [cpuRate|-] (the sample script also runs once as the warm-up)
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
SP=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad
S=$SP/perf/scripts; D=$SP/perf/fix-data
sample=$1; rounds=$2; out=$3; rate=${4:--}
PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; PB=3812; PA=3817; SRC=$SP/perf/data/p11-perf.db
stop() { local i; lsof -tiTCP:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$1 -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
start() { # dir port db
  local i
  (cd $1 && env TESSERA_DB_PATH=$3 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $2 > $SP/perf/$2.log 2>&1 &)
  for i in $(seq 1 150); do curl -s -o /dev/null http://127.0.0.1:$2/inbox && break; sleep 0.2; done
}
stop $PB; stop $PA
for v in before after; do
  db=$D/$v-large-${sample%.mjs}.db; rm -f $db $db-wal $db-shm; cp $SRC $db
  if [ $v = before ]; then dir=$SP/perf/after2-pre; else dir=$SP/perf/after2; fi
  (cd $dir && TESSERA_DB_PATH=$db npx tsx scripts/migrate.ts) > /dev/null 2>&1 || echo "migrate failed $db"
done
: > $out
for i in $(seq 1 $rounds); do
  for v in before after; do
    if [ $v = before ]; then dir=$SP/perf/after2-pre; port=$PB; else dir=$SP/perf/after2; port=$PA; fi
    start $dir $port $D/$v-large-${sample%.mjs}.db
    node $S/$sample $port $PROJECT $rate > /dev/null 2>&1
    load=$(uptime | sed 's/.*load averages: //')
    line=$(node $S/$sample $port $PROJECT $rate)
    [ -z "$line" ] && line=null
    echo "{\"round\":$i,\"variant\":\"$v\",\"load\":\"$load\",\"sample\":$line}" >> $out
    echo "$i $v $load $line"
    stop $port
  done
done
