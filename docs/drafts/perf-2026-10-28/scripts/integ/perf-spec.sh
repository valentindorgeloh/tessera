#!/bin/zsh
# Integrator: decision 115 perf spec (tests/e2e/perf.spec.ts via playwright.perf.config.ts, n=20 + 2 warm-up) on one copy,
# PERF_PORT 3831, against a fresh copy of the migrated LARGE set at <dir>/data/p11-perf.db. Usage: perf-spec.sh <dir> <tag>
export PATH=/opt/homebrew/bin:$PATH
unset ANTHROPIC_API_KEY TESSERA_DB_PATH
BC=${BC:-/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc}
R=$BC/results-integ; dir=$1; tag=$2
cd $dir || exit 2
rm -f data/p11-perf.db data/p11-perf.db-wal data/p11-perf.db-shm; cp $BC/integ-data/master/p11-perf.db data/p11-perf.db
rm -rf test-results/perf
log=$R/perf-spec-$tag.log
echo "START $(date) load $(uptime | sed 's/.*load averages: //')" > $log
s=$(date +%s)
PERF_PORT=3831 npx playwright test -c playwright.perf.config.ts >> $log 2>&1
rc=$?
echo "EXIT $rc after $(( $(date +%s) - s )) s; END $(date) load $(uptime | sed 's/.*load averages: //')" >> $log
cp test-results/perf/results.json $R/perf-spec-$tag.results.json 2>/dev/null
find test-results/perf -name perf-runs.json -exec cp {} $R/perf-spec-$tag.runs.json \;
lsof -tiTCP:3831 -sTCP:LISTEN | xargs kill 2>/dev/null
grep -E "decision 115|EXIT|START" $log
