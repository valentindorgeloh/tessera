#!/bin/zsh
# MEASURE-CODE: interleaved prod A/B on port 3802: HEAD build (perf/code) vs trunc+date build (perf/code-exp),
# both on the same scratch large DB. Starts and stops `next start` per sample.
# Usage: code-ab-prod.sh <rounds> <out.jsonl> [cpuRate|-] [inline]
export PATH=/opt/homebrew/bin:$PATH
SP=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad
PORT=3802
PROJECT=${PROJECT:-01a16ad8-6ddd-7752-91fa-653ae8b8a394}
DB=${DB:-$SP/perf/code-exp/data/p11-perf.db}
rounds=$1; out=$2; rate=${3:--}; inline=$4
: > $out
stop() { local i; lsof -tiTCP:$PORT -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 1 50); do lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.2; done; }
start() {
  local i
  (cd $1 && env -u ANTHROPIC_API_KEY TESSERA_DB_PATH=$DB node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT > $SP/perf/3802-prod-$2.log 2>&1 &)
  for i in $(seq 1 150); do curl -s -o /dev/null http://127.0.0.1:$PORT/inbox && break; sleep 0.2; done
  curl -s -o /dev/null http://127.0.0.1:$PORT/projects/$PROJECT/work-items
}
stop
for i in $(seq 1 $rounds); do
  for v in head fix; do
    dir=$SP/perf/code; [ $v = fix ] && dir=$SP/perf/code-exp
    start $dir $v
    node $SP/perf/scripts/code-wi-sample.mjs $PORT $PROJECT > /dev/null 2>&1
    load=$(uptime | sed 's/.*load averages: //')
    if [ -n "$inline" ]; then
      line=$(node $SP/perf/scripts/code-inline-edit.mjs $PORT $PROJECT $rate $((i + 3)))
    else
      line=$(node $SP/perf/scripts/code-wi-sample2.mjs $PORT $PROJECT $rate)
    fi
    echo "{\"round\":$i,\"variant\":\"$v\",\"load\":\"$load\",\"sample\":$line}" >> $out
    echo "$i $v $load $line"
    stop
  done
done
