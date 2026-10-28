#!/bin/bash
# usage: campaign-mode.sh <mode> <variant> <n> [sets] [vps] [scenarios]
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH
M=$1; V=$2; N=$3; SETS=${4:-"small large"}; VPS=${5:-"d m"}; SCS=${6:-"list table nav-list"}
for vp in $VPS; do for sc in $SCS; do for set in $SETS; do
  echo "== $M $V $set $vp $sc  $(uptime | sed 's/.*load/load/')"
  node run.mjs $M $set $vp $sc $N $M-$V-$set-$vp-$sc $V 2>&1 | tail -1 | cut -c1-240
done; done; done
