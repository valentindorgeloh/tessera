# Tessera

Tessera is a local, single-user, AI-first work tracker: projects, work items, cycles, modules, views, pages, intake and analytics. It is built on Next.js 16, React 19, Astryx (with a Catppuccin theme, Latte and Frappé) and SQLite. Every operation is reachable three ways: from the UI, from the built-in MCP server (so coding agents can plan and update work), and from the in-app assistant (which proposes changes you apply with one click).

The feature set follows Plane Community Edition, minus accounts, invitations, admin, live cursors and attachments. The code is written from scratch; see `THIRD_PARTY_NOTICES.md` for the licence position.

**Status:** all planned work is built (last round: sidebar views, motion, virtual lists and calendar zoom, 2026-11-10). What is left is backlog, in [docs/improvements.md](docs/improvements.md). Build status and history: [docs/PLAN-STATUS.md](docs/PLAN-STATUS.md); the plan and its numbered decisions: [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Work items:** states, labels, priority, assignees, dates, estimates, sub-items, keys like `MOB-12`. Five layouts (list, board, table, calendar with week, month and quarter zoom, gantt) that stay fast on long lists through virtual scrolling, AND/OR filters, grouping and sub-groups, bulk edits, moves between projects. The detail opens as a peek, a modal or a full page, with relations, links, comments, reactions, @mentions, subscriptions and version history.
- **Planning:** cycles with burndown and burnup charts and transfer of unfinished work; modules with leads, members and a timeline; point estimates; archives with restore.
- **Views:** saved project and workspace views, lockable and reorderable, each with its own display settings.
- **Pages:** a workspace wiki and project pages in a Tiptap editor that saves Markdown, with a page tree, outline, locking, version history and backlinks.
- **Inbox and intake:** inbox with mentions, snooze and archive; per-project intake (accept, decline, duplicate, snooze); drafts.
- **Navigation:** a sidebar shown in full, as icons with labels or as icons only, docked or floating over the page (`mod+b`), with motion that honours reduced-motion settings.
- **Workspace:** Home with widgets (since your last visit, your work, recents, quick links, stickies), favourites with folders, Your work, analytics.
- **Agents:** agents are first-class actors with an access level (read, intake or write), a directory at `/agents` and profiles. Each agent gets a generated robot avatar, picked from its id and tinted in its colour, so bots read apart from people and from each other.
- **Assistant:** a side panel (`mod+j`) and Ask in Power K that stream answers and propose changes you approve with Apply (destructive ones ask again), with undo of the last batch. It appears only when an Anthropic credential resolves.
- **MCP:** 192 tools in one registry that the UI, the MCP server and the assistant share.
- **Operations:** auto-archive and auto-close automations, HMAC-signed outbound webhooks, CSV and JSON exports, rotated backups, full-text search, the Power K command palette and keyboard shortcuts, and live refresh when another process (an agent) changes data.

## Requirements

- Node 22.14 or newer (`.nvmrc` pins 22.23.3; `better-sqlite3` 13 needs Node-API 10). Run `nvm use` in the repo.
- macOS or Linux. On Windows, use WSL2: the dev script and the live app (`scripts/live.sh`) need a Unix shell. Inside WSL2 the steps below are the same, and the app opens in the Windows browser.
- No external services. The database is a SQLite file under `data/` (gitignored), created and migrated on first open.

## Setup

```bash
nvm use
```

```bash
npm install
```

```bash
cp .env.example .env.local
```

Every value in `.env.local` is optional:

| Variable | Default | What it does |
|---|---|---|
| `TESSERA_DB_PATH` | `data/tessera.db` | the database file; backups go to a `backups/` folder beside it |
| `ANTHROPIC_API_KEY` | none | turns on the assistant (or run `ant auth login` once instead) |
| `TESSERA_AI_MODEL` | `claude-opus-5-5` | the assistant's model |
| `TESSERA_AI_EFFORT` | `high` | `low`, `medium`, `high` or `xhigh` |
| `TESSERA_AUTOMATIONS`, `TESSERA_WEBHOOKS` | on | set to `off` to stop the scheduler or webhook delivery |

To try it with data, fill an empty database with the Orbit showcase (3 active projects and 1 archived, pages, agents, inbox and intake activity). It writes nothing when a project `MOB` already exists.

```bash
npm run db:demo
```

## Run

Daily use is the live app: a production build of the last commit on http://127.0.0.1:3000, against `data/tessera.db`. The first start builds it (one to two minutes); later starts take about a second. It keeps running when you close the terminal.

```bash
npm run live
```

After new commits, build and switch. The old version serves until the switch, which takes under a second:

```bash
npm run live:update
```

To see uncommitted work, run the dev server on http://127.0.0.1:3001. It uses its own database, `data/dev/tessera.db`, so its backups stay in `data/dev/`. `PORT` and `TESSERA_DB_PATH` override both.

```bash
npm run dev
```

The full runbook (status, rollback, stop, exit codes, migrations and settings): [docs/process/live.md](docs/process/live.md). The live app reads `.env.local` at start, so restart it (`npm run live:stop`, then `npm run live`) after changing it.

## Connect a coding agent (MCP)

Tessera serves MCP two ways:

- **HTTP** at `/api/mcp` on the running app, e.g. `http://127.0.0.1:3000/api/mcp` (`.cursor/mcp.json` uses this).
- **stdio**: `npm run mcp:stdio -- [--db <path>] [--migrate] [--toolset core|all]`. The repo's `.mcp.json` registers it for Claude Code. It holds absolute paths for `cwd` and `TESSERA_DB_PATH`, so a fresh clone must change them to its own. The stdio server refuses a database with pending migrations unless it gets `--migrate`, which backs up first.

Each MCP client becomes an agent named `mcp:<client name>` on first connect. Tool names start with `tessera_`. Destructive tools (deletes, bulk updates, moves between projects) need `confirm: true`. Errors come back as text starting with a code: `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RULE`, `ARCHIVED`, `LOCKED` or `BUSY`.

For a one-off call without a client, pass the registry name (without the `tessera_` prefix). It runs as the agent `mcp:p3-acceptance`:

```bash
TESSERA_DB_PATH=data/dev/tessera.db npx tsx scripts/mcp-call.ts list_projects '{}'
```

## Scripts

| Script | What it does |
|---|---|
| `npm run live` / `live:update` / `live:rollback` / `live:stop` / `live:status` | the live app on 127.0.0.1:3000 (`scripts/live.sh`, [docs/process/live.md](docs/process/live.md)) |
| `npm run dev` | dev server on 127.0.0.1:3001 with `data/dev/tessera.db` |
| `npm run build` / `start` | a plain `next build` / `next start`, without the live wrapper |
| `npm run check` | the merge gate: typecheck, lint, Vitest, convention gate, licence gate and theme check |
| `npm run typecheck` / `lint` / `test` / `test:watch` | the gate's parts on their own |
| `npm run test:e2e` / `check:e2e` | Playwright end-to-end tests (`check:e2e` builds first and checks the bundle budget) |
| `npm run db:migrate` / `db:seed` / `db:demo` | apply migrations (backup first) / add the small demo project `WEB` / add the Orbit showcase |
| `npm run db:backup` / `db:restore -- <file> --yes` | take a manual backup / restore one over the configured database |
| `npm run db:fts-rebuild` / `maintenance` | rebuild the search index / run retention and the optional auto backup |
| `npm run mcp:stdio` | stdio MCP server for coding agents |
| `npm run automations` | run auto-archive and auto-close once (`--dry-run` to preview) |
| `npm run import:handbook` | import `content/*.md` into wiki pages |
| `npm run perf:seed` / `perf:bench` | 10k-item performance seed and benchmark |
| `npm run astryx -- <cmd>` | the Astryx design-system CLI |

Migrations are hand-written SQL in `drizzle/`; do not run `db:generate` (drizzle-kit) in the checkout (see [docs/field-guide/index.md](docs/field-guide/index.md)).

## Repository map

```
src/lib/tessera/      engine: schema, service layer, tool registry, MCP and AI adapters
src/components/       UI by area (shell, work-items, detail, editor, planning, views, pages, ...)
src/app/(tessera)/    routes
src/themes/catppuccin theme, icons and the agent avatar glyphs
scripts/              gates, database scripts, the MCP stdio server and the live app (live.sh)
drizzle/              migrations
tests/                Vitest (tests/**/*.test.ts) and Playwright (tests/e2e)
docs/contracts/       what the code is built against: schema, service API, tools, AI, editor, UI, owners
docs/process/         how it is built (swarm.md) and run (live.md)
docs/field-guide/     short list of surprises for anyone working in the repo
content/              the old handbook's Markdown, the source of import:handbook
```

## How this is built

Coding agents build everything as a swarm with fixed roles: planners, workers, reviewers, refuters and a reconciler. Every change passes `npm run check`, then a build with browser acceptance in both themes at desktop and phone width, then review, before it is committed. Roles, models and rules: [docs/process/swarm.md](docs/process/swarm.md). Before starting any task, read [docs/field-guide/index.md](docs/field-guide/index.md). File ownership by area: [docs/contracts/OWNERS.md](docs/contracts/OWNERS.md). There is no CI; the gate runs locally.

## Licence policy

Dependencies must be MIT, MIT-0, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0 or Zlib. Copyleft (GPL, AGPL, LGPL, MPL, SSPL, ...) and attribution licences (CC-BY, ODC-By, ...) are rejected by `npm run check:licenses`; reviewed transitive exceptions are listed in `licenses.exceptions.json`.
