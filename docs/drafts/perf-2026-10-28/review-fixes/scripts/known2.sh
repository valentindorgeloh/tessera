#!/bin/zsh
export PATH=/opt/homebrew/bin:$PATH; unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc; PROJECT=01a16ad8-6ddd-7752-91fa-653ae8b8a394; export NODE_PATH=$BC/after/node_modules
: > $BC/results/fixer-first-write-known-actor.jsonl
for client in react-probe react-probe react-probe; do
  db=$BC/fixer-data/fw.db; rm -f $db $db-wal $db-shm; cp $BC/integ-data/master/p11-perf.db $db
  (cd $BC/after && env TESSERA_DB_PATH=$db TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3838 > $BC/logs-fixer/3838.log 2>&1 &)
  for i in $(seq 1 100); do curl -s -o /dev/null http://127.0.0.1:3838/inbox && break; sleep 0.3; done
  curl -s -o /dev/null http://127.0.0.1:3838/projects/$PROJECT/work-items
  load=$(uptime | sed 's/.*averages: //')
  line=$(PREWRITE=1 CLIENT=$client node refresh-known.mjs 3838 $PROJECT $BC/after $db 2>/dev/null | tail -1)
  echo "{\"client\":\"$client\",\"load\":\"$load\",\"r\":${line:-null}}" >> $BC/results/fixer-first-write-known-actor.jsonl
  lsof -tiTCP:3838 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 2
done
echo done > $BC/logs-fixer/known.done
