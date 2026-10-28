#!/bin/bash
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH
run() { vp=$1; sc=$2; echo "== first $sc $vp $(uptime | sed 's/.*load/load/')"; node run.mjs plain small $vp $sc 5 m3-first-small-$vp-$sc prod 2>&1 | tail -1 | cut -c1-200
  echo "== revisit $sc $vp"; REVISIT=1 node run.mjs plain small $vp $sc 5 m3-revisit-small-$vp-$sc prod 2>&1 | tail -1 | cut -c1-200
  echo "== trace first $sc $vp"; node run.mjs trace small $vp $sc 3 m3-trace-first-small-$vp-$sc prod 2>&1 | tail -1 | cut -c1-120; }
run d light-cycles
run m light-cycles; run m light-inbox; run m light-analytics
echo ALLDONE
