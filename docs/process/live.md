# The live app

Status: in use from decision 140 (performance round, 2026-10-24).

Your daily Tessera is the **live app**. It is a production build of the last commit, served on http://127.0.0.1:3000 from your database `data/tessera.db`.

It is faster than the dev server. Pages are prefetched, so a sidebar click shows the next page's skeleton at once. Nothing compiles while you click.

## What changes for you

- Port 3000 shows only **committed** work. Changes that are not committed yet are not in it.
- After each merged batch, the reconciler updates the live app and tells you in chat.
- After an update, your open tab reloads itself on its next click. Text you have not sent in a dialog is lost. That is why agents announce each update.
- To look at uncommitted work, use the dev server on http://127.0.0.1:3001. It uses its own database, `data/dev/tessera.db`, never yours.
- The live app keeps running when you close the terminal or the app that started it. It does not start by itself after a reboot.

## One-time switch

Today the old dev server holds port 3000. Stop it first.

If it runs in the Claude app's preview pane, stop it there. If it runs in a terminal, press Ctrl+C in that terminal.

If you cannot find it, run:

```bash
kill $(lsof -tiTCP:3000 -sTCP:LISTEN)
```

Check that port 3000 is free. This prints nothing when it is free:

```bash
lsof -iTCP:3000 -sTCP:LISTEN
```

Go to the repo:

```bash
cd ~/Documents/Github/tessera
```

Start the live app. The first start builds the last commit. That takes about one to two minutes.

```bash
npm run live
```

## Every day

After a reboot, go to the repo:

```bash
cd ~/Documents/Github/tessera
```

Then start the live app. With a release already built, this takes about a second.

```bash
npm run live
```

If it already runs, `npm run live` only says so.

## Commands

Build the last commit and switch to it. The old version keeps serving during the build. The switch itself takes under a second.

```bash
npm run live:update
```

Build and switch to one commit instead of the last one:

```bash
npm run live:update -- <commit>
```

See what runs:

```bash
npm run live:status
```

The first line lists `live` (what serves now), `previous`, `head` (the last commit), `live_is_head` (yes or no), `listener` (the program on the port), the server `pid` and the kept releases. The second line says in words whether the live app serves the last commit.

Each release keeps its own dependencies, so a rollback works after `npm install` too. Building an older commit whose dependencies are no longer kept needs the repo's `node_modules` to match that commit; otherwise it stops with exit code 1.

Go back to the version before:

```bash
npm run live:rollback
```

Stop the live app:

```bash
npm run live:stop
```

Look at uncommitted work on http://127.0.0.1:3001 (stop it with Ctrl+C):

```bash
npm run dev
```

## When a command stops with an error

| Exit code | What happened | What to do |
|---|---|---|
| 1 | The build failed, the new server did not start, the commit is unknown, there is no previous release, the dependencies do not match, the disk is too full, the shell runs under `nice`, or the command is mistyped. | A failed build leaves the old version serving. A new server that does not start is stopped, and the old version starts again. Read the message and the log it names. |
| 2 | `TESSERA_LIVE_DB` is not an absolute path. | Give the full path. |
| 3 | Another live command is running. | Wait for it. A lock left behind by a crash is cleared by itself. |
| 4 | Another program holds the port, often the old dev server. | Stop that program yourself. The live app never stops a program it did not start. |
| 5 | The version would run on a database that is newer than it. | See "Migrations and rollback" below. |
| 6 | The command came from another copy of the repo, or asked for another database. | Run it from `~/Documents/Github/tessera`, without `TESSERA_LIVE_DB`. |
| 129, 130, 143 | A closed terminal, Ctrl+C or a stop signal ended it. | A build stops and the old version keeps serving. A switch that had begun finishes first. |

If a lock ever stays behind and blocks every command, remove it:

```bash
rm -r ~/.tessera-live/lock
```

The live app only takes commands from the repo and the database of its first start. If you move the repo, start it once from the new place with `--repin`:

```bash
npm run live -- --repin
```

Agents never use `--repin`.

## Logs

The logs are in `~/.tessera-live/logs`:
- `build-<commit>.log` is the build of that commit.
- `server-<commit>.log` is what the server printed while it ran that commit.

Logs are removed together with their release.

## Migrations and rollback

A new version may change the database layout (a migration). When it first opens `data/tessera.db`, the app saves a copy first, in `data/backups/tessera-migration-<time>.db`. Then it migrates.

Old code must not run on a newer database layout. So before every switch, the live app counts the migrations your database already has. If the version knows fewer, it refuses and stops with exit code 5. This covers `live:rollback`, `npm run live:update -- <older commit>`, and a new version that fails to start after it migrated: then the old version is not started again, and nothing serves until you decide.

It prints the newest backup and the exact commands to go back anyway:

```bash
npm run live:stop
```

```bash
TESSERA_DB_PATH=<your database> npm run db:restore -- <the backup it printed> --yes
```

```bash
npm run live:rollback -- --force
```

The restore loses everything written after that backup. Only do it when the new version is broken.

If `data/` also holds other databases, their backups share `data/backups`. Then it prints no restore command, because the newest backup may not be yours. Pick a backup of `tessera.db` by its time.

## Settings

- The live app reads its settings from `.env.local` in the repo, for example your Anthropic key. It copies the file at every start and update.
- It ignores the settings of the shell that starts it, such as `TESSERA_DB_PATH` or a proxy. So an agent's shell cannot change your app.
- After you change `.env.local`, stop the app:

```bash
npm run live:stop
```

Then start it again:

```bash
npm run live
```

- Automations and webhooks are on, as in your app. To turn them off, put `TESSERA_AUTOMATIONS=off` or `TESSERA_WEBHOOKS=off` in `.env.local`.

## Disk use

The live app keeps three releases in `~/.tessera-live`. That is about 0.9 GB:
- three releases of about 120 MB each,
- the build folder: the build cache (about 230 MB) and the current build (about 120 MB),
- copies of `node_modules`: one for the build and one per set of dependencies the releases use. They take no extra space until the dependencies change (APFS clones).

## How it works

- `live:update` takes the commit from git. It never touches your working tree or the repo's `.next`.
- It builds in `~/.tessera-live/build` while the old server keeps serving. A build checks the types of `src` only; `npm run check` already checked the tests.
- Each release has its own folder, `~/.tessera-live/rel/<commit>`, with its own files and build. A build never changes the folder that serves.
- The switch stops the old server and starts the new one. Each build carries its commit, so your open tab notices the new version and reloads.
- The live app runs on its own: closing a terminal does not stop it. `docs/as-built/engine.md` has the technical details.
- `~/.tessera-live` is readable by you only. Every build holds the key that keeps your open tab's buttons working across updates.

## Rules for agents

- Never start, stop or kill anything on port 3000.
- Only the reconciler, or the agent the user asks, runs `npm run live:update`. It does so after a green gate, once per merged batch, and says so in chat.
- Run it without `nice`, outside the sandbox, with a timeout of 600 s or `run_in_background`. A niced shell is refused, and so is a zsh `&` job (zsh runs those at nice 5). A killed command stops its build and changes nothing.
- Batch edits to `next.config.ts` and announce them: they change the live build.
- Run a dev server on your own port with your own database: `PORT=<n> TESSERA_DB_PATH=<db> npm run dev`. Without them it uses 3001 and `data/dev/tessera.db`. In a swarm run, do it from a scratch copy: Next allows one `next dev` per folder (`.next/dev/lock`), and other lanes edit the checkout.
- Put a database of your own in its own folder, never next to `data/tessera.db`: backups go to the `backups` folder beside the database.
- Probe builds go in a scratch copy, never in the checkout: eslint would lint the build output. In the copy, `TESSERA_DIST_DIR=.next-probe` keeps the build apart from a dev server's `.next`.
- To test `scripts/live.sh`, set `TESSERA_REPO`, `TESSERA_LIVE_ROOT`, `TESSERA_LIVE_PORT` and `TESSERA_LIVE_DB` to your own scratch values. Never use `~/.tessera-live`, port 3000 or `data/tessera.db`.

| Variable | Default | Meaning |
|---|---|---|
| `TESSERA_REPO` | the repo that holds the script | where commits come from |
| `TESSERA_LIVE_ROOT` | `~/.tessera-live` | releases, builds, state and logs |
| `TESSERA_LIVE_PORT` | 3000 | the port |
| `TESSERA_LIVE_DB` | the pinned one, else `<repo>/data/tessera.db` | the database (absolute path) |
| `TESSERA_LIVE_KEEP` | 3 | releases kept |
| `TESSERA_LIVE_NICE` | 10 | the build's nice level |
| `TESSERA_LIVE_MIN_FREE_MB` | 100 | free disk a switch needs, besides room for a copy of the database |

Sources: Next docs in `node_modules/next/dist/docs/01-app/`: `02-guides/self-hosting.md` ("Server Functions encryption key", "Version Skew"), `03-api-reference/05-config/01-next-config-js/deploymentId.md`, `distDir.md`, `turbopack.md` ("Root directory": no links out of the root), `typescript.md`, `03-api-reference/05-config/02-typescript.md` ("Custom tsconfig path") and `02-guides/ai-agents.md` (`.next/dev/lock`). Node: `child_process.spawn` option `detached`.
