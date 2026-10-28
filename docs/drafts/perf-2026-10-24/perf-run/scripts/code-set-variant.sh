#!/bin/zsh
# MEASURE-CODE: put the experiment copy into a variant: head | trunc | date | trunc+date (copies files, HMR picks them up).
SP=/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad
V=$SP/perf/variants; B2=$SP/perf/code-exp
cp -R $V/head/src/ $B2/src/
case $1 in
  trunc) cp -R $V/trunc/src/ $B2/src/ ;;
  date) cp -R $V/date/src/ $B2/src/ ;;
  trunc+date) cp -R $V/trunc/src/ $B2/src/; cp $V/date/src/components/work-items/properties/DateControl.tsx $B2/src/components/work-items/properties/DateControl.tsx ;;
esac
