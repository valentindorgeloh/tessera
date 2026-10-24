#!/bin/bash
# Tessera live app: a production server for daily use (decision proposed in docs/process/live.md).
#
# The repo's working tree and its .next are never touched. `update` exports a git ref to $ROOT/app, builds it into
# .next-build (the Turbopack build cache stays warm there), clones the finished build to .next-r-<sha> (APFS clone, no
# cache) and swaps the running server to that release. A failed build leaves the running server alone.
#
#   live.sh start             start the newest release; build HEAD first when there is none (use after a reboot)
#   live.sh update [ref]      build ref (default HEAD) and swap to it. Commit first: only committed work is built.
#   live.sh rollback          swap back to the previous release
#   live.sh stop | status
#
# Environment (all optional): TESSERA_REPO, TESSERA_LIVE_ROOT (~/.tessera-live), TESSERA_LIVE_PORT (3000),
# TESSERA_LIVE_DB (<repo>/data/tessera.db), TESSERA_LIVE_KEEP (3 releases).
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:$PATH
REPO=${TESSERA_REPO:-$(cd "$(dirname "$0")/.." && pwd)}
ROOT=${TESSERA_LIVE_ROOT:-$HOME/.tessera-live}
PORT=${TESSERA_LIVE_PORT:-3000}
DB=${TESSERA_LIVE_DB:-$REPO/data/tessera.db}   # must be absolute: the export has no data/ folder of its own
KEEP=${TESSERA_LIVE_KEEP:-3}
APP=$ROOT/app; STATE=$ROOT/state; LOGS=$ROOT/logs
case "$DB" in /*) ;; *) echo "TESSERA_LIVE_DB must be an absolute path" >&2; exit 2 ;; esac
mkdir -p "$APP" "$STATE" "$LOGS"
now() { python3 -c 'import time;print(round(time.time(),3))'; }
since() { python3 -c "print(round($(now)-$1,1))"; }
log() { echo "[live $(date +%H:%M:%S)] $*"; }
listener() { lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }
is_ours() { [ "$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$APP" ]; }

# one update at a time (two agents finishing together must not interleave exports and builds)
lock() { mkdir "$ROOT/lock" 2>/dev/null || { log "another live command is running ($ROOT/lock); wait for it"; exit 3; }; trap 'rmdir "$ROOT/lock" 2>/dev/null || true' EXIT; }

cmd_build() {
  local ref=${1:-HEAD} sha lock_hash t0 tmp rel e
  sha=$(git -C "$REPO" rev-parse --short=12 "$ref"); t0=$(now); rel="$APP/.next-r-$sha"
  [ -d "$rel" ] && { log "$sha is already built"; return 0; }
  tmp="$ROOT/export.$$"; mkdir -p "$tmp"
  git -C "$REPO" archive "$ref" | tar -x -C "$tmp"
  rsync -ac --delete --exclude=/node_modules --exclude='/.next*' --exclude=/.env.local "$tmp/" "$APP/"; rm -rf "$tmp"
  # the one config line the live app needs; patched into the export while the repo's next.config.ts does not carry it
  grep -q TESSERA_DIST_DIR "$APP/next.config.ts" || sed -i '' 's|^  partialPrefetching: true,|  partialPrefetching: true,\n  distDir: process.env.TESSERA_DIST_DIR \|\| ".next",|' "$APP/next.config.ts"
  lock_hash=$(shasum -a 256 "$APP/package-lock.json" | cut -c1-16)
  if [ ! -d "$APP/node_modules" ] || [ "$(cat "$STATE/lock-hash" 2>/dev/null || true)" != "$lock_hash" ]; then
    log "dependencies changed: cloning node_modules (about 11 s)"; rm -rf "$APP/node_modules"; cp -Rc "$REPO/node_modules" "$APP/node_modules"; echo "$lock_hash" > "$STATE/lock-hash"
  fi
  [ -f "$REPO/.env.local" ] && cp "$REPO/.env.local" "$APP/.env.local" || true
  # a fixed key keeps Server Action closures decryptable across builds (docs: self-hosting "Server Functions encryption key")
  [ -s "$STATE/actions.key" ] || openssl rand -base64 32 > "$STATE/actions.key"
  log "building $sha (export $(since "$t0") s)"
  ( cd "$APP" && TESSERA_DIST_DIR=.next-build NEXT_DEPLOYMENT_ID="$sha" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat "$STATE/actions.key")" \
      TESSERA_DB_PATH="$ROOT/build-scratch.db" TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off \
      nice -n 10 node node_modules/next/dist/bin/next build > "$LOGS/build-$sha.log" 2>&1 ) \
    || { log "BUILD FAILED, the running server is untouched. Tail of $LOGS/build-$sha.log:"; tail -25 "$LOGS/build-$sha.log"; exit 1; }
  mkdir -p "$rel"
  for e in $(ls -A "$APP/.next-build" | grep -v -E '^(cache|dev|diagnostics|trace|lock|logs)$'); do cp -Rc "$APP/.next-build/$e" "$rel/$e"; done
  # a release must sit directly under the app dir: the externals symlink inside it (better-sqlite3-<hash>) is relative
  ls -1dt "$APP"/.next-r-* | tail -n +$((KEEP + 1)) | while read -r old; do [ "$(basename "$old")" != ".next-r-$(cat "$STATE/live" 2>/dev/null || true)" ] && rm -rf "$old"; done
  log "built $sha in $(since "$t0") s"
}

cmd_stop() {
  local p x; p=$(listener); [ -z "$p" ] && return 0
  for x in $p; do is_ours "$x" || { log "port $PORT is held by another process (pid $x: $(ps -o command= -p "$x" | cut -c1-80)); stop it yourself, not touching it"; exit 4; }; done
  kill -TERM $p
  for _ in $(seq 1 200); do kill -0 $p 2>/dev/null || return 0; sleep 0.05; done   # kill -0, not lsof: every millisecond here is downtime
  kill -KILL $p || true
}

cmd_swap() {
  local sha=${1:-} t0 code=""; t0=$(now)
  [ -n "$sha" ] || sha=$(basename "$(ls -1dt "$APP"/.next-r-* | head -1)" | sed 's/^.next-r-//')
  [ -d "$APP/.next-r-$sha" ] || { log "no release $sha"; exit 1; }
  cmd_stop
  cd "$APP"
  TESSERA_DIST_DIR=".next-r-$sha" NEXT_DEPLOYMENT_ID="$sha" NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat "$STATE/actions.key")" TESSERA_DB_PATH="$DB" \
    nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT" > "$LOGS/server-$sha.log" 2>&1 < /dev/null &
  echo $! > "$STATE/pid"; disown
  for _ in $(seq 1 600); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/api/changes?since=0" || true)
    [ "$code" = 200 ] && break; sleep 0.05
  done
  [ "$code" = 200 ] || { log "the new server did not answer 200; see $LOGS/server-$sha.log (use: live.sh rollback)"; exit 1; }
  if [ -s "$STATE/live" ] && [ "$(cat "$STATE/live")" != "$sha" ]; then cp "$STATE/live" "$STATE/previous"; fi
  echo "$sha" > "$STATE/live"
  log "serving $sha on http://127.0.0.1:$PORT (swap took $(since "$t0") s). Reload the open tab."
}

case "${1:-status}" in
  update) lock; shift; ref=${1:-HEAD}; cmd_build "$ref"; cmd_swap "$(git -C "$REPO" rev-parse --short=12 "$ref")" ;;
  start) lock; if ls -d "$APP"/.next-r-* >/dev/null 2>&1; then cmd_swap "$(cat "$STATE/live" 2>/dev/null || true)"; else cmd_build HEAD; cmd_swap "$(git -C "$REPO" rev-parse --short=12 HEAD)"; fi ;;
  rollback) lock; [ -s "$STATE/previous" ] || { log "no previous release"; exit 1; }; cmd_swap "$(cat "$STATE/previous")" ;;
  stop) cmd_stop ;;
  status) echo "live=$(cat "$STATE/live" 2>/dev/null || echo none) previous=$(cat "$STATE/previous" 2>/dev/null || echo none) head=$(git -C "$REPO" rev-parse --short=12 HEAD) listener=$(listener) releases=$(ls -d "$APP"/.next-r-* 2>/dev/null | sed 's|.*/.next-r-||' | tr '\n' ' ')" ;;
  *) sed -n '2,15p' "$0" ;;
esac
