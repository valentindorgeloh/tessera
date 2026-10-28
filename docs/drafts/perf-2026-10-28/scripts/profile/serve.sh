#!/bin/bash
# usage: serve.sh <port> <db file name> <dist: .next|.next-prof>
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY
B=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc/profile
S=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf
cd $B
[ "$1" = 3824 -o "$1" = 3825 ] || { echo bad port; exit 1; }
if [ "$3" = ".next-prof" ]; then export TESSERA_DIST_DIR=.next-prof; fi
TESSERA_DB_PATH=$B/data/$2 TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $1 > $S/bc/$1.log 2>&1 &
