#!/bin/bash
# interleaved A/B (A = prof build, B = prof build with Astryx readPortalWritingContext's getComputedStyle reads stubbed in the page): N rounds.
# usage: ab-$PT.sh <set> <vp> <scenario> [N]
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH
PT=${PT:-rpwc}; set=$1; vp=$2; sc=$3; N=${4:-6}
for i in $(seq 1 $N); do
  node run.mjs plain $set $vp $sc 1 ab-$PT-A-$set-$vp-$sc-$i prof > /dev/null 2>&1
  PATCH=$PT node run.mjs plain $set $vp $sc 1 ab-$PT-B-$set-$vp-$sc-$i prof > /dev/null 2>&1
done
node ab-sum.mjs ab-$PT $set-$vp-$sc
