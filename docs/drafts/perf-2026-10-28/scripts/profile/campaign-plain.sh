#!/bin/bash
# interleave small/large is not needed (different ports); each cell is n samples with load recorded per sample.
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH
V=${1:-prod}; N=${2:-7}
for vp in d m; do
 for sc in list table nav-list; do
  for set in small large; do
   node run.mjs plain $set $vp $sc $N plain2-$V-$set-$vp-$sc $V 2>&1 | tail -1 | cut -c1-300
  done
 done
done
