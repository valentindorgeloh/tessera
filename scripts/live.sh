#!/bin/bash
# Tessera live app (decision 140): the user's daily Tessera is a production server of the last committed HEAD.
# Runbook: docs/process/live.md. Runs under macOS /bin/bash 3.2 too (no arrays, no EPOCHREALTIME).
#
# Layout under $ROOT (mode 700): rel/<sha> is one release: the commit's tree from `git archive`, its build in .next-r
# and node_modules, a link to deps/<lock hash>/node_modules (an APFS clone of the repo's, made once per package-lock).
# The server runs with cwd rel/<sha> and reads drizzle/ from there, so no later build or export reaches it. Builds run
# in build/ (the commit's tree, its own node_modules clone, .next-build with the warm Turbopack cache). The repo's
# working tree and its .next are never touched: git archive reads committed objects only.
#
#   live.sh start [--force] [--repin]          start the live release (builds HEAD when there is none); no-op while it serves
#   live.sh update [ref] [--force] [--repin]   build ref (default HEAD) and swap to it. Only committed work is built.
#   live.sh rollback [--force] [--repin]       swap back to the previous release
#   live.sh stop | status | help
#
# Exit codes: 1 failed (build, start, unknown ref or release, no previous release, dependencies, disk, niced shell,
# usage), 2 TESSERA_LIVE_DB is not absolute, 3 another live command holds the lock, 4 the port is held by a process
# that is not ours, 5 the target knows fewer migrations than the database has applied, or that cannot be read
# (--force goes ahead anyway), 6 the root is pinned to another repo or database (--repin moves the pin; the user's
# call only), 129/130/143 a hang-up, Ctrl+C or TERM stopped it (a build is stopped, a swap finishes first).
#
# Environment (all optional): TESSERA_REPO, TESSERA_LIVE_ROOT (~/.tessera-live), TESSERA_LIVE_PORT (3000),
# TESSERA_LIVE_DB (the pinned one, else <repo>/data/tessera.db), TESSERA_LIVE_KEEP (3 releases), TESSERA_LIVE_NICE
# (10, the build's nice level), TESSERA_LIVE_MIN_FREE_MB (100 MB free a swap needs besides a copy of the database).
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
usage() { sed -n '2,24p' "$0"; }
CMD=${1:-status}; [ $# -gt 0 ] && shift
FORCE=0; REPIN=0; REF=HEAD; RETRY=""
for a in "$@"; do case "$a" in --force) FORCE=1 ;; --repin) REPIN=1 ;; -*) echo "unknown option $a" >&2; exit 1 ;; *) REF=$a ;; esac; done
case "$CMD" in help | -h | --help) usage; exit 0 ;; start | update | rollback | stop | status) ;; *) usage >&2; exit 1 ;; esac

REPO=$(cd "${TESSERA_REPO:-$(dirname "$0")/..}" && pwd -P)
ROOT=${TESSERA_LIVE_ROOT:-$HOME/.tessera-live}
PORT=${TESSERA_LIVE_PORT:-3000}
PIN_DB=$(cat "$ROOT/state/db" 2>/dev/null || true)
DB=${TESSERA_LIVE_DB:-${PIN_DB:-$REPO/data/tessera.db}}   # must be absolute: a release has no data/ folder of its own
KEEP=${TESSERA_LIVE_KEEP:-3}; NICE=${TESSERA_LIVE_NICE:-10}; MIN_FREE_MB=${TESSERA_LIVE_MIN_FREE_MB:-100}
case "$DB" in /*) ;; *) echo "TESSERA_LIVE_DB must be an absolute path" >&2; exit 2 ;; esac
UMASK0=$(umask); umask 077   # the root is the user's only: every build embeds the Server Actions key
if [ "$CMD" != status ]; then mkdir -p "$ROOT"; chmod 700 "$ROOT"; fi   # status only reads
if [ -d "$ROOT" ]; then ROOT=$(cd "$ROOT" && pwd -P); fi   # real path: lsof reports a server's cwd that way
REL=$ROOT/rel; BUILD=$ROOT/build; DEPS=$ROOT/deps; STATE=$ROOT/state; LOGS=$ROOT/logs
if [ "$CMD" != status ]; then mkdir -p "$REL" "$BUILD" "$DEPS" "$STATE" "$LOGS"; fi
NODE_DIR=$(dirname "$(command -v node)")
USER_TMP=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo /tmp)

ms() { node -e 'console.log(Date.now())'; }
since() { node -e 'console.log(((Date.now() - Number(process.argv[1])) / 1000).toFixed(1))' -- "$1"; }
log() { echo "[live $(date +%H:%M:%S)] $*"; }
is_num() { case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }
listener() { lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }
is_ours() { case "$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" in "$REL"/*) return 0 ;; *) return 1 ;; esac; }
alive() { local x; for x in "$@"; do kill -0 "$x" 2>/dev/null && return 0; done; return 1; }
clone() { cp -Rc "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -R "$1" "$2"; }; }   # APFS clone, plain copy elsewhere
short() { git -C "$REPO" rev-parse --verify --quiet --short=12 "$1^{commit}"; }
journal_count() { node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).entries.length)' 2>/dev/null || echo unknown; }
release_migrations() { local n; n=$(cat "$REL/$1/.tessera-migrations" 2>/dev/null || true); if is_num "$n"; then echo "$n"; else echo unknown; fi; }
releases() { ls -1t "$REL"/*/.tessera-migrations 2>/dev/null | sed 's|/\.tessera-migrations$||' || true; }   # newest build first
free_kb() { df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'; }

# Migrations applied to $DB, read-only (a missing file has none); "unknown" when it cannot be read.
db_migrations() {
  local live
  [ -e "$DB" ] || { echo 0; return 0; }
  live=$(cat "$STATE/live" 2>/dev/null || true)
  node -e 'const [file, ...dirs] = process.argv.slice(1);
const Database = require(require.resolve("better-sqlite3", { paths: dirs }));
const db = new Database(file, { readonly: true, fileMustExist: true });
const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("table", "__drizzle_migrations");
console.log(table ? db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get().n : 0);' \
    -- "$DB" "$REL/${live:-none}" "$BUILD" "$REPO" 2>/dev/null || echo unknown
}

# The live app and its build get a clean environment: whatever the caller's shell holds (an agent's
# ANTHROPIC_BASE_URL, NODE_OPTIONS, NODE_ENV, proxies, TESSERA_*) never reaches them. Settings come from the
# release's .env.local; HOME keeps the `ant auth login` profile.
clean_env() {
  env -i HOME="$HOME" USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-$(id -un)}" SHELL="${SHELL:-/bin/sh}" \
    PATH="$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$USER_TMP" ${LANG:+LANG="$LANG"} ${LC_ALL:+LC_ALL="$LC_ALL"} "$@"
}

# A server started from a niced shell keeps that nice level, and a user cannot lower it again.
not_niced() {
  local n; n=$(ps -o nice= -p $$ | tr -d ' ')
  [ "$n" = 0 ] && return 0
  log "refused: this shell runs at nice $n, and the live server would keep it. Run it from a normal shell, without nice."
  exit 1
}

# One live command at a time (two agents finishing together must not interleave builds and swaps). A lock whose
# holder is gone (a crash, a reboot, kill -9) is cleared.
LOCKED=0; BUILD_PID=""; CRITICAL=0; PENDING=""; REPINNED=0; PART=""
lock_is_stale() {
  local age
  if [ -z "$1" ]; then   # the holder writes its pid right after mkdir: an empty lock older than 10 s is stale
    age=$(( $(date +%s) - $(stat -f %m "$ROOT/lock" 2>/dev/null || date +%s) ))
    [ "$age" -gt 10 ]; return
  fi
  kill -0 "$1" 2>/dev/null || return 0
  case "$(ps -o command= -p "$1" 2>/dev/null)" in *live.sh*) return 1 ;; *) return 0 ;; esac
}
lock() {
  local pid
  if ! mkdir "$ROOT/lock" 2>/dev/null; then
    pid=$(cat "$ROOT/lock/pid" 2>/dev/null || true)
    if ! lock_is_stale "$pid"; then
      log "another live command is running (pid ${pid:-unknown}); wait for it. If none runs, remove $ROOT/lock"
      exit 3
    fi
    log "clearing a stale lock: pid ${pid:-none} runs no live command"
    mv "$ROOT/lock" "$ROOT/lock.stale.$$" 2>/dev/null && rm -rf "$ROOT/lock.stale.$$"
    mkdir "$ROOT/lock" 2>/dev/null || { log "another live command took the lock; wait for it"; exit 3; }
  fi
  echo $$ > "$ROOT/lock/pid"; LOCKED=1
}
cleanup() {   # an unfinished release folder goes too
  if [ -n "$PART" ]; then rm -rf "$PART"; fi
  if [ "$LOCKED" = 1 ] && [ "$(cat "$ROOT/lock/pid" 2>/dev/null || true)" = "$$" ]; then rm -rf "$ROOT/lock"; fi
}
# A signal stops a build (its whole process group) and exits; during a swap it waits until the swap is done, because
# half a swap leaves nothing serving.
on_signal() {
  if [ "$CRITICAL" = 1 ]; then PENDING=$1; return 0; fi
  if [ -n "$BUILD_PID" ]; then
    kill -TERM -- "-$BUILD_PID" 2>/dev/null || true
    for _ in $(seq 1 100); do kill -0 -- "-$BUILD_PID" 2>/dev/null || break; sleep 0.05; done
    kill -KILL -- "-$BUILD_PID" 2>/dev/null || true
    log "stopped by a signal: the build was stopped, the running server is untouched"
  else
    log "stopped by a signal"
  fi
  exit $((128 + $1))
}
after_swap() { CRITICAL=0; if [ -n "$PENDING" ]; then log "stopped by a signal that came during the swap"; exit $((128 + PENDING)); fi; }
trap cleanup EXIT; trap 'on_signal 1' HUP; trap 'on_signal 2' INT; trap 'on_signal 15' TERM

# The first start or update pins the root to its repo and database. Any other checkout, or a leftover
# TESSERA_LIVE_DB in a shell, is refused (exit 6) instead of replacing the user's app. --repin is the user's call.
pin() {
  local repo db
  repo=$(cat "$STATE/repo" 2>/dev/null || true); db=$(cat "$STATE/db" 2>/dev/null || true)
  if [ -n "$repo" ] && [ "$REPIN" = 0 ]; then
    if [ "$repo" = "$REPO" ] && [ "$db" = "$DB" ]; then return 0; fi
    log "refused: $ROOT serves the repo $repo with the database $db, and this run asks for $REPO with $DB."
    echo "Run live commands from $repo, without TESSERA_REPO or TESSERA_LIVE_DB. Only the user moves the pin (--repin)."
    exit 6
  fi
  if [ "$1" != write ] && [ "$REPIN" = 0 ]; then return 0; fi
  if [ -n "$repo" ] && { [ "$repo" != "$REPO" ] || [ "$db" != "$DB" ]; }; then
    log "--repin: the root moves from $repo with $db to $REPO with $DB"; REPINNED=1
  fi
  printf '%s\n' "$REPO" > "$STATE/repo"; printf '%s\n' "$DB" > "$STATE/db"
}

# a fixed key keeps Server Action closures decryptable across builds (Next docs: self-hosting "Server Functions encryption key")
ensure_key() {
  [ -s "$STATE/actions.key" ] || node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))' > "$STATE/actions.key"
  chmod 600 "$STATE/actions.key"
}

# The restore hint, unless other databases share the backups folder (their backups have the same names).
restore_hint() {
  local dir others backup
  dir=$(dirname "$DB")
  others=$(ls -1 "$dir"/*.db 2>/dev/null | grep -v -x -F "$DB" | sed 's|.*/||' | tr '\n' ' ' || true)
  if [ -n "$others" ]; then
    echo "Warning: $dir also holds other databases ($others). They share $dir/backups, so the newest backup there may"
    echo "be a copy of another database. Pick a backup of $(basename "$DB") by hand; no restore command is printed."
    return 0
  fi
  backup=$(ls -1 "$dir/backups"/tessera-migration-*.db 2>/dev/null | sort | tail -1 || true)
  echo "Newest backup taken before a migration: ${backup:-none in $dir/backups}"
  echo "To go back anyway, stop the app, restore that backup (writes made since then are lost), then force it:"
  echo "  npm run live:stop"
  echo "  TESSERA_DB_PATH=$DB npm run db:restore -- ${backup:-<backup.db>} --yes"
  if [ -n "$RETRY" ]; then echo "  $RETRY"; fi
}

# Exit 5 unless --force when $1 (which knows $2 migrations) is older than the database, or either count is unknown.
guard_migrations() {
  local have reason
  have=$(db_migrations)
  if is_num "$2" && is_num "$have"; then
    [ "$2" -lt "$have" ] || return 0
    reason="$1 knows $2 migrations, but $DB has $have applied. Its code would run on a newer schema."
  else
    reason="cannot tell whether $1 (knows $2 migrations) fits $DB ($have applied)."
  fi
  if [ "$FORCE" = 1 ]; then log "--force: $reason"; return 0; fi
  log "refused: $reason"; restore_hint; exit 5
}

# The repo's node_modules is cloned only when it matches the commit: the same package-lock.json as the checkout, and
# npm's record of what is installed (node_modules/.package-lock.json) agrees with it.
deps_match() {
  if ! cmp -s "$1/package-lock.json" "$REPO/package-lock.json"; then
    log "refused: the commit's package-lock.json differs from $REPO/package-lock.json, so $REPO/node_modules is not its dependencies."
    return 1
  fi
  node -e 'const fs = require("fs"); const [lockFile, installedFile] = process.argv.slice(1);
const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")).packages || {};
const installed = JSON.parse(fs.readFileSync(installedFile, "utf8")).packages || {};
const same = (a, b) => a.version === b.version && a.resolved === b.resolved && a.integrity === b.integrity;
const bad = Object.keys(installed).filter((k) => !lock[k] || !same(lock[k], installed[k]))
  .concat(Object.keys(lock).filter((k) => k !== "" && !installed[k] && !lock[k].optional && !lock[k].devOptional));
if (bad.length > 0) { console.log(bad.slice(0, 3).join(", ")); process.exit(1); }' \
    -- "$1/package-lock.json" "$REPO/node_modules/.package-lock.json" > "$STATE/deps-check" 2>&1 && return 0
  log "refused: $REPO/node_modules does not match package-lock.json ($(head -c 200 "$STATE/deps-check")). Run npm ci in $REPO first."
  return 1
}
# Sets DEPS_HASH for the tree $1, cloning the repo's node_modules into deps/<hash> once per package-lock.
ensure_deps() {
  DEPS_HASH=$(cksum < "$1/package-lock.json" | awk '{ print $1 "-" $2 }')
  if [ -d "$DEPS/$DEPS_HASH/node_modules" ]; then return 0; fi
  deps_match "$1" || exit 1
  log "dependencies changed: cloning node_modules twice, for the release and the build (about 20 s)"
  rm -rf "$DEPS"/.p-*; mkdir -p "$DEPS/.p-$DEPS_HASH"   # also leftovers of an interrupted clone
  clone "$REPO/node_modules" "$DEPS/.p-$DEPS_HASH/node_modules"
  mv "$DEPS/.p-$DEPS_HASH" "$DEPS/$DEPS_HASH"
}

cmd_build() {
  local sha=$1 t0 part e rc
  if [ -d "$REL/$sha/.next-r" ]; then log "$sha is already built"; return 0; fi
  t0=$(ms); part="$REL/.p-$sha"; PART=$part
  git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null || { log "commit $sha is not in $REPO"; exit 1; }
  rm -rf "$REL"/.p-* "${REL:?}/$sha"; mkdir -p "$part"   # leftovers of an interrupted build
  git -C "$REPO" archive "$sha" | tar -x -C "$part"
  ensure_deps "$part"; ln -s "../../deps/$DEPS_HASH/node_modules" "$part/node_modules"
  # build/ gets the same tree; unchanged files keep their mtimes (rsync -c), so the Turbopack cache stays warm
  rsync -ac --delete --exclude=/node_modules --exclude=/.next-build --exclude='/*.tsbuildinfo' "$part/" "$BUILD/"
  if [ "$(cat "$STATE/build-deps" 2>/dev/null || true)" != "$DEPS_HASH" ] || [ ! -d "$BUILD/node_modules" ]; then
    rm -f "$STATE/build-deps"; rm -rf "$BUILD/node_modules"   # an interrupted clone is never taken for a whole one
    clone "$DEPS/$DEPS_HASH/node_modules" "$BUILD/node_modules"; echo "$DEPS_HASH" > "$STATE/build-deps"
  fi
  ensure_key
  log "building $sha (export $(since "$t0") s)"
  set -m   # the build gets its own process group, so a signal can stop all of it
  ( cd "$BUILD" && clean_env TESSERA_LIVE_BUILD=1 TESSERA_DIST_DIR=.next-build NEXT_DEPLOYMENT_ID="$sha" \
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat "$STATE/actions.key")" TESSERA_DB_PATH="$ROOT/build-scratch.db" \
      TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off nice -n "$NICE" node node_modules/next/dist/bin/next build ) \
    > "$LOGS/build-$sha.log" 2>&1 < /dev/null &
  BUILD_PID=$!
  set +m
  rc=0; wait "$BUILD_PID" || rc=$?
  BUILD_PID=""
  if [ "$rc" != 0 ]; then
    log "BUILD FAILED, the running server is untouched. Tail of $LOGS/build-$sha.log:"; tail -25 "$LOGS/build-$sha.log"; exit 1
  fi
  # .next-r must sit directly in the release: the externals link inside it (better-sqlite3-<hash>) is ../../node_modules
  mkdir "$part/.next-r"
  for e in $(ls -A "$BUILD/.next-build" | grep -v -E '^(cache|dev|diagnostics|trace|lock|logs)$'); do clone "$BUILD/.next-build/$e" "$part/.next-r/$e"; done
  chmod -R go-rwx "$part/.next-r"
  journal_count < "$part/drizzle/meta/_journal.json" > "$part/.tessera-migrations"
  mv "$part" "$REL/$sha"; PART=""
  prune "$sha"
  log "built $sha in $(since "$t0") s"
}

# Keeps KEEP releases: the new one ($1), the live and the previous one always, then the newest others. Then removes
# the dependency folders and logs that no kept release uses.
prune() {
  local cur prev slots e old refs
  cur=$(cat "$STATE/live" 2>/dev/null || true); prev=$(cat "$STATE/previous" 2>/dev/null || true); slots=$KEEP
  for e in $(printf '%s\n' "$1" "$cur" "$prev" | sort -u); do if [ -d "$REL/$e/.next-r" ]; then slots=$((slots - 1)); fi; done
  releases | while read -r old; do
    e=$(basename "$old")
    case "$e" in "$1" | "$cur" | "$prev") continue ;; esac
    if [ "$slots" -gt 0 ]; then slots=$((slots - 1)); continue; fi
    rm -rf "$old"
  done
  for old in "$REL"/*; do   # a release folder without its marker is a leftover
    e=$(basename "$old")
    case "$e" in "$1" | "$cur" | "$prev" | "*") continue ;; esac
    if [ ! -f "$old/.tessera-migrations" ]; then rm -rf "$old"; fi
  done
  refs=$(for e in "$REL"/*/node_modules; do readlink "$e" 2>/dev/null || true; done)
  for old in "$DEPS"/*; do
    [ -d "$old" ] || continue
    case "$refs" in *"deps/$(basename "$old")/node_modules"*) ;; *) rm -rf "$old" ;; esac
  done
  for old in "$LOGS"/build-*.log "$LOGS"/server-*.log; do   # also the logs of failed builds, once a build succeeds
    [ -e "$old" ] || continue
    e=$(basename "$old" .log); e=${e#*-}
    [ -d "$REL/$e" ] || rm -f "$old"
  done
}

cmd_stop() {
  local p x own pids
  p=$(listener)
  for x in $p; do is_ours "$x" || { log "port $PORT is held by another process (pid $x: $(ps -o command= -p "$x" | cut -c1-80)); stop it yourself, not touching it"; exit 4; }; done
  own=$(cat "$STATE/pid" 2>/dev/null || true)
  if [ -n "$own" ] && alive "$own" && is_ours "$own"; then pids="$p $own"; else pids="$p"; fi
  pids=$(echo $pids)   # trims and joins the words
  if [ -n "$pids" ]; then
    kill -TERM $pids 2>/dev/null || true
    for _ in $(seq 1 200); do alive $pids || break; sleep 0.05; done   # kill -0, not lsof: every millisecond here is downtime
    if alive $pids; then kill -KILL $pids 2>/dev/null || true; fi
  fi
  rm -f "$STATE/pid"
}

# Starts the server of release $1 in its own session: Node's spawn({ detached: true }) calls setsid(), so closing the
# terminal or app that ran this sends it no SIGHUP and kills no process group it belongs to. (nohup would not help:
# Node resets an ignored SIGHUP to the default at startup.) The launcher prints the server pid and exits.
DETACH='const [log, ...args] = process.argv.slice(1);
const out = require("node:fs").openSync(log, "a");
const child = require("node:child_process").spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out] });
console.log(child.pid);
child.unref();'
launch() {
  ( cd "$REL/$1" && umask "$UMASK0" && clean_env TESSERA_DIST_DIR=.next-r NEXT_DEPLOYMENT_ID="$1" \
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat "$STATE/actions.key")" TESSERA_DB_PATH="$DB" \
      node -e "$DETACH" -- "$LOGS/server-$1.log" node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT" ) > "$STATE/pid"
}
# $1 tries 50 ms apart; stops early when the server process has exited
healthy() {
  local code="" i pid
  pid=$(cat "$STATE/pid" 2>/dev/null || true)
  for i in $(seq 1 "$1"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/api/changes?since=0" || true)
    [ "$code" = 200 ] && return 0
    if ! is_num "$pid" || ! alive "$pid"; then return 1; fi
    [ "$i" = "$1" ] || sleep 0.05
  done
  return 1
}

# Free disk for the server's logs and for the backup a migration takes first.
disk_ok() {
  local dir need kb root_kb
  dir=$(dirname "$DB"); [ -d "$dir" ] || dir=$ROOT
  need=$(( $(stat -f %z "$DB" 2>/dev/null || echo 0) / 1024 + MIN_FREE_MB * 1024 ))
  kb=$(free_kb "$dir"); root_kb=$(free_kb "$ROOT")
  if ! is_num "$kb" || ! is_num "$root_kb"; then return 0; fi
  if [ "$kb" -ge "$need" ] && [ "$root_kb" -ge $((MIN_FREE_MB * 1024)) ]; then return 0; fi
  log "refused: too little free disk ($((kb / 1024)) MB by the database, $((root_kb / 1024)) MB in $ROOT; a swap needs $((need / 1024)) MB). The running server is untouched."
  exit 1
}

# After a failed start of $2: restart $1 only when the database has no migration that $1 does not know.
fallback() {
  local old=$1 sha=$2 have know
  if [ -z "$old" ] || [ "$old" = "$sha" ] || [ ! -d "$REL/$old/.next-r" ]; then
    log "nothing serves on port $PORT now: there is no other release to go back to"; return 0
  fi
  have=$(db_migrations); know=$(release_migrations "$old")
  if ! is_num "$have" || ! is_num "$know" || [ "$have" -gt "$know" ]; then
    log "not restarting $old: $DB has $have migrations applied and $old knows $know. Nothing serves on port $PORT now."
    restore_hint; return 0
  fi
  if launch "$old" && healthy 600; then log "the live release $old serves again"; return 0; fi
  log "$old did not start either; see $LOGS/server-$old.log. Nothing serves on port $PORT now."
}

cmd_swap() {
  local sha=$1 old t0
  [ -d "$REL/$sha/.next-r" ] || { log "no release $sha"; exit 1; }
  old=$(cat "$STATE/live" 2>/dev/null || true)
  guard_migrations "$sha" "$(release_migrations "$sha")"
  ensure_key; disk_ok
  if [ -f "$REPO/.env.local" ]; then cp "$REPO/.env.local" "$REL/$sha/.env.local"; else rm -f "$REL/$sha/.env.local"; fi
  t0=$(ms); CRITICAL=1
  cmd_stop
  if launch "$sha" && healthy 600; then
    if [ -n "$old" ] && [ "$old" != "$sha" ]; then echo "$old" > "$STATE/previous"; fi
    echo "$sha" > "$STATE/live"
    log "serving $sha on http://127.0.0.1:$PORT (swap took $(since "$t0") s). Open tabs reload on their next click."
    after_swap; return 0
  fi
  log "the new server did not answer 200. Tail of $LOGS/server-$sha.log:"; tail -15 "$LOGS/server-$sha.log" 2>/dev/null || true
  cmd_stop
  fallback "$old" "$sha"
  after_swap; exit 1
}

cmd_start() {
  local live sha p x n ours=1
  live=$(cat "$STATE/live" 2>/dev/null || true)
  if [ -n "$live" ] && [ -d "$REL/$live/.next-r" ]; then
    p=$(listener)
    for x in $p; do is_ours "$x" || ours=0; done
    if [ -n "$p" ] && [ "$ours" = 1 ] && [ "$REPINNED" = 0 ] && healthy 1; then log "already serving $live on http://127.0.0.1:$PORT"; return 0; fi
    cmd_swap "$live"
  elif [ -n "$(releases)" ]; then
    sha=$(basename "$(releases | head -1)"); cmd_swap "$sha"
  else
    sha=$(short HEAD) || { log "no commit at HEAD in $REPO"; exit 1; }
    n=$(git -C "$REPO" show "$sha:drizzle/meta/_journal.json" 2>/dev/null | journal_count) || n=unknown
    guard_migrations "$sha" "$n"
    cmd_build "$sha"; cmd_swap "$sha"
  fi
}

cmd_status() {
  local live head same
  live=$(cat "$STATE/live" 2>/dev/null || echo none)
  head=$(short HEAD 2>/dev/null || echo unknown)
  if [ "$live" = "$head" ]; then same=yes; else same=no; fi
  echo "live=$live previous=$(cat "$STATE/previous" 2>/dev/null || echo none) head=$head live_is_head=$same" \
    "listener=$(echo $(listener)) pid=$(cat "$STATE/pid" 2>/dev/null || echo none) releases=$(echo $(releases | sed 's|.*/||'))"
  if [ "$same" = yes ]; then echo "The live app serves HEAD."; else echo "The live app does not serve HEAD ($head); npm run live:update builds it."; fi
}

case "$CMD" in
  update)
    not_niced; lock; pin write
    sha=$(short "$REF") || { log "unknown ref $REF in $REPO"; exit 1; }
    RETRY="npm run live:update -- $REF --force"
    n=$(git -C "$REPO" show "$sha:drizzle/meta/_journal.json" 2>/dev/null | journal_count) || n=unknown
    guard_migrations "$sha" "$n"   # before the build: a refused update costs nothing
    cmd_build "$sha"; cmd_swap "$sha" ;;
  start) not_niced; lock; pin write; RETRY="npm run live -- --force"; cmd_start ;;
  rollback)
    not_niced; lock; pin check
    [ -s "$STATE/previous" ] || { log "no previous release"; exit 1; }
    RETRY="npm run live:rollback -- --force"; cmd_swap "$(cat "$STATE/previous")" ;;
  stop) lock; pin check; cmd_stop ;;
  status) cmd_status ;;
esac
