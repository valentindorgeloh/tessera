# Tessera

Tessera is a local, single-user, AI-first work tracker: projects, work items, cycles, modules, views, pages, intake, analytics. It is built on Next.js 16, React 19, Astryx and SQLite, and every operation is reachable three ways: from the UI, from the built-in MCP server (so coding agents can plan and update work), and from the in-app assistant (which proposes changes you apply with one click).

The feature set follows the Plane Community Edition minus accounts, invitations, admin, live cursors and attachments. The code is written from scratch; see `THIRD_PARTY_NOTICES.md` for the licence position.

**Status:** P0 (setup) is done. The engine (P1) is next. Progress lives in [docs/PLAN-STATUS.md](docs/PLAN-STATUS.md); the full plan in [docs/PLAN.md](docs/PLAN.md).

## Requirements

- Node 22.14 or newer (`.nvmrc` pins 22.23.3; `better-sqlite3` 13 needs Node-API 10). Run `nvm use` in the repo.
- macOS or Linux. No external services; the database is a file under `data/`.

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

## Run

Daily use is the live app: a production build of the last commit on http://127.0.0.1:3000, against `data/tessera.db`. The first start builds it (one to two minutes); later starts take about a second. It keeps running when you close the terminal.

```bash
npm run live
```

After new commits, build and switch (the old version serves until the switch, which takes under a second):

```bash
npm run live:update
```

To see uncommitted work, run the dev server on http://127.0.0.1:3001. It uses its own database, `data/dev/tessera.db`, created on first use, so its backups stay in `data/dev/`.

```bash
npm run dev
```

The full runbook (status, rollback, stop, exit codes, migrations): [docs/process/live.md](docs/process/live.md). The assistant appears only when an Anthropic credential resolves (`ANTHROPIC_API_KEY` in `.env.local`, or `ant auth login` once).

## Scripts

| Script | What it does |
|---|---|
| `npm run live` / `live:update` / `live:rollback` / `live:stop` / `live:status` | the live app on 127.0.0.1:3000 (`scripts/live.sh`, docs/process/live.md) |
| `npm run dev` | Next dev server on 127.0.0.1:3001 with `data/dev/tessera.db`; `PORT` and `TESSERA_DB_PATH` override |
| `npm run check` | typecheck, lint, tests, convention gate, licence gate (the merge gate) |
| `npm run test` / `test:watch` | Vitest |
| `npm run db:generate` / `db:migrate` / `db:seed` / `db:backup` / `db:fts-rebuild` | database lifecycle (from P1) |
| `npm run db:demo` | fill the configured database with the Orbit showcase demo (4 projects, pages, agents, inbox, intake); writes nothing when a project MOB exists, so run `db:backup` first |
| `npm run mcp:stdio` | stdio MCP server for coding agents (from P1) |
| `npm run automations` | run auto-archive and auto-close once (from P10) |
| `npm run import:handbook` | import `content/*.md` into Pages (P6) |

## Repository map

```
src/lib/tessera/      engine: schema, service layer, tool registry, MCP and AI adapters
src/components/       UI by area (shell, work-items, detail, editor, planning, views, pages, ...)
src/app/(tessera)/    routes
scripts/              gates, database scripts and the live app (live.sh)
drizzle/              migrations
docs/contracts/       the contracts every lane codes against (schema, service API, tools, AI, owners)
docs/PLAN.md          the plan; docs/PLAN-STATUS.md the status
content/              legacy handbook pages, imported into Pages in P6 and then removed
```

## How this is built

Coding agents build everything, one lane per area, each in its own git worktree, merging only when `npm run check` is green. Ownership and hand-off rules: [docs/contracts/OWNERS.md](docs/contracts/OWNERS.md).

## Licence policy

Dependencies must be MIT, ISC, Apache-2.0, BSD, 0BSD, BlueOak, CC0, Unlicense, Python-2.0 or Zlib. Copyleft (GPL, AGPL, LGPL, MPL, ...) and attribution-in-product licences (CC-BY, ...) are rejected by `npm run check:licenses`; reviewed transitive exceptions are listed in `licenses.exceptions.json`.
