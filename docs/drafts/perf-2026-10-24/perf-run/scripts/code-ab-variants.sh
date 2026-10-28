#!/bin/zsh
# MEASURE-CODE: interleaved A/B/C/D (head, trunc, date, trunc+date) on one dev server, toggled by copying files into the experiment copy (HMR).
# Usage: code-ab-variants.sh <port> <projectId> <rounds> <out.jsonl> [cpuRate]
export PATH=/opt/homebrew/bin:$PATH
SP=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad
port=$1; project=$2; rounds=$3; out=$4; rate=$5
: > $out
for i in $(seq 1 $rounds); do
  for v in head trunc date trunc+date; do
    $SP/perf/scripts/code-set-variant.sh $v
    sleep 5
    curl -s -o /dev/null http://127.0.0.1:$port/projects/$project/work-items
    node $SP/perf/scripts/code-wi-sample.mjs $port $project $rate > /dev/null 2>&1
    load=$(uptime | sed 's/.*load averages: //')
    line=$(node $SP/perf/scripts/code-wi-sample.mjs $port $project $rate)
    echo "{\"round\":$i,\"variant\":\"$v\",\"load\":\"$load\",\"sample\":$line}" >> $out
    echo "$i $v $load $line"
  done
done
$SP/perf/scripts/code-set-variant.sh head
