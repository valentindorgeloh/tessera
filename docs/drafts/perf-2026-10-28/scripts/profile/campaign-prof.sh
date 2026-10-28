#!/bin/bash
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH
echo "== react"; ./campaign-mode.sh react prof 3
echo "== cpu"; ./campaign-mode.sh cpu prof 2
echo "== plain prof (overhead check)"; node run.mjs plain large d list 5 plain-prof-large-d-list prof | tail -1 | cut -c1-200; node run.mjs plain small d list 5 plain-prof-small-d-list prof | tail -1 | cut -c1-200
echo "== trace-stack prof"; for set in small large; do KEEP_TRACES=1 TRACE_STACK=1 node run.mjs trace $set d list 2 tracestack-prof-$set-d-list prof | tail -1 | cut -c1-120; done
echo ALLDONE
