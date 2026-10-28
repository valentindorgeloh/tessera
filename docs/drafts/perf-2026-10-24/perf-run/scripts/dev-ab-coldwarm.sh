#!/bin/bash
# MEASURE-DEV (a)+(b): cycles of cold start (rm .next/dev) -> first visits -> restart warm -> first visits.
# Usage: dev-ab-coldwarm.sh <first cycle> <last cycle> <set> <db>
export PATH=/opt/homebrew/bin:$PATH
S=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf
B=$S/dev; SET=$3; DB=$4
cd $S/scripts
for i in $(seq $1 $2); do
  for kind in cold warm; do
    ./dev-server.sh stop 3800
    LOG=$S/3800-$SET-$kind$i.log
    echo "== $kind $i $(uptime | sed 's/.*load averages: //')"
    if [ $kind = cold ]; then ./dev-server.sh start $B 3800 $DB dev $LOG cold; else ./dev-server.sh start $B 3800 $DB dev $LOG; fi
    node dev-firstvisits.mjs 3800 $LOG $SET $S/results/dev-ab-$kind-$SET-$i.json 1 $kind-$i | tail -3
    grep -m1 "Running next.config" $LOG
  done
done
./dev-server.sh stop 3800
