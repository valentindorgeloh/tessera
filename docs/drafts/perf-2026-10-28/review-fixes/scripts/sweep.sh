#!/bin/zsh
# Page-size sweep with the decision 115 harness (tests/e2e/perf.spec.ts, list + table, n=20 + 2 warm-up) on the 10k fixture.
# Usage: sweep.sh <grouped|ungrouped> <size>...   (grouped: rows per state group; ungrouped: ROW_PAGE). Port 3838, copy after-sweep.
export PATH=/opt/homebrew/bin:$PATH; unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc; S=$BC/after-sweep; PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; export NODE_PATH=$BC/after/node_modules
mode=$1; shift
for size in "$@"; do
  cd $S; rm -f data/p11-perf.db data/p11-perf.db-wal data/p11-perf.db-shm; cp $BC/integ-data/master/p11-perf.db data/p11-perf.db; rm -rf test-results/perf
  if [ $mode = grouped ]; then envs="TESSERA_GROUP_PAGE=$size"; gb=state; else envs="TESSERA_ROW_PAGE=$size"; gb=none; fi
  (env $envs TESSERA_DB_PATH=$S/data/p11-perf.db TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3838 > $BC/logs-fixer/sweep-3838.log 2>&1 &)
  for i in $(seq 1 100); do curl -s -o /dev/null http://127.0.0.1:3838/inbox && break; sleep 0.3; done
  rows=$(node $BC/scripts-fixer/rows-check.mjs 3838 $PROJECT $gb 2>/dev/null | tail -1)
  load=$(uptime | sed 's/.*averages: //')
  PERF_REUSE=1 PERF_PORT=3838 PERF_RUNS=${PERF_RUNS:-20} PERF_LAYOUTS=list,table PERF_GROUP_BY=$gb TESSERA_PERF=1 npx playwright test -c playwright.perf.config.ts > $BC/logs-fixer/sweep-$mode-$size.log 2>&1
  runs=$(find test-results/perf -name perf-runs.json | head -1)
  echo "{\"mode\":\"$mode\",\"size\":$size,\"load\":\"$load\",\"loadAfter\":\"$(uptime | sed 's/.*averages: //')\",\"rows\":${rows:-null},\"runs\":$(cat $runs 2>/dev/null || echo null)}" >> $BC/results/fixer-sweep.jsonl
  lsof -tiTCP:3838 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 2
done
echo done-$mode > $BC/logs-fixer/sweep-$mode.done
