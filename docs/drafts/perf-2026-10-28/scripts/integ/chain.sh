#!/bin/zsh
# Integrator campaign (perf round 2026-10-28): every production A/B, then the dev ones. Sequential, one probe at a time.
# A = BEFORE (BASE 6331186), B = AFTER (lanes B + C). Results in results-integ/. Usage: chain.sh [step...]
export PATH=/opt/homebrew/bin:$PATH
BC=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc
S=$BC/scripts-integ; R=$BC/results-integ; cd $S
if [ $# -gt 0 ]; then steps=("$@"); else steps=(integ-large integ-small integ-small-cpu4 select inter refresh has prio assets peek prefetch dev-large dev-counts); fi
for st in $steps; do
  echo "=== $(date +%T) $st | load $(uptime | sed 's/.*load averages: //')" >> $R/chain.log
  case $st in
    integ-large) WARM=1 ./ab.sh integ-sample.mjs 5 $R/integ-large.jsonl large > $R/integ-large.log 2>&1 ;;
    integ-small) WARM=1 ./ab.sh integ-sample.mjs 5 $R/integ-small.jsonl small > $R/integ-small.log 2>&1 ;;
    integ-small-cpu4) RATE=4 WARM=1 ./ab.sh integ-sample.mjs 5 $R/integ-small-cpu4.jsonl small > $R/integ-small-cpu4.log 2>&1 ;;
    integ-large-cpu4) RATE=4 WARM=0 ./ab.sh integ-sample.mjs 5 $R/integ-large-cpu4.jsonl large > $R/integ-large-cpu4.log 2>&1 ;;
    select) WARM=1 ./ab.sh select-sample.mjs 5 $R/select-large.jsonl large > $R/select-large.log 2>&1 ;;
    inter) WARM=0 ./ab.sh inter-sample.mjs 5 $R/inter-large.jsonl large > $R/inter-large.log 2>&1 ;;
    refresh) WARM=0 ./ab.sh refresh-sample.mjs 5 $R/refresh-large.jsonl large > $R/refresh-large.log 2>&1 ;;
    has) WARM=1 ./ab.sh has-sample.mjs 5 $R/has-grouped.jsonl grouped > $R/has-grouped.log 2>&1 ;;
    prio) WARM=0 ./ab.sh prio-sample.mjs 5 $R/prio-large.jsonl large > $R/prio-large.log 2>&1 ;;
    assets)
      ./pair.sh small "node $S/ab-assets.mjs \$PA \$PB small 4 8 wi-list,wi-peek,cycle $R/assets-small-cpu4.json" > $R/assets-small-cpu4.log 2>&1
      ./pair.sh small "node $S/ab-assets.mjs \$PA \$PB small 1 8 wi-list,wi-peek,cycle $R/assets-small-cpu1.json" > $R/assets-small-cpu1.log 2>&1
      ./pair.sh large "node $S/ab-assets.mjs \$PA \$PB large 1 8 wi-list $R/assets-large-cpu1.json" > $R/assets-large-cpu1.log 2>&1 ;;
    peek)
      ./pair.sh small "node $S/ab-peek.mjs \$PA \$PB small 2000 5 $R/peek-small-2000.json; node $S/ab-peek.mjs \$PA \$PB small 300 5 $R/peek-small-300.json" > $R/peek-small.log 2>&1
      ./pair.sh large "node $S/ab-peek.mjs \$PA \$PB large 2000 5 $R/peek-large-2000.json; node $S/ab-peek.mjs \$PA \$PB large 300 5 $R/peek-large-300.json" > $R/peek-large.log 2>&1 ;;
    prefetch)
      ./pair.sh small "for i in 1 2 3 4 5; do ANALYTICS_HREF=/analytics node $S/prefetch-probe.mjs \$PA \$PROJECT $R/prefetch-A-\$i.json > /dev/null 2>&1; ANALYTICS_HREF=/analytics/overview node $S/prefetch-probe.mjs \$PB \$PROJECT $R/prefetch-B-\$i.json > /dev/null 2>&1; done" > $R/prefetch.log 2>&1 ;;
    dev-large) ./ab-dev.sh large 5 $R/dev-large.jsonl > $R/dev-large.log 2>&1 ;;
    dev-counts) ./dev-counts.sh $R/devcounts > $R/dev-counts.log 2>&1 ;;
  esac
  echo "    $(date +%T) done $st rc=$? | load $(uptime | sed 's/.*load averages: //')" >> $R/chain.log
done
echo "CHAIN DONE $(date +%T)" >> $R/chain.log
