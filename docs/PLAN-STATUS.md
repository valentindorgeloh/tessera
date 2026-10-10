# Tessera build status

Source of truth for where the build stands. Lane Q updates this file at every phase exit; every lane appends its hand-off notes under the phase it worked on. Dates are absolute.

Plan: [docs/PLAN.md](PLAN.md). Ownership: [docs/contracts/OWNERS.md](contracts/OWNERS.md).

| Phase | Scope (short) | Status | Exit criteria | Notes |
|---|---|---|---|---|
| P0 Setup | rename, installs, configs, gates, contracts, stubs | **done 2026-10-10** | `npm run check` green on an empty suite; `next build` passes | Node moved to 22.23.3 (better-sqlite3 13 needs Node-API 10) |
| P1 Engine | schema, migrations, actors, projects, states, labels, work items, cycles, modules, views, counts, search, changes, registry, MCP route + stdio | not started | Vitest for every invariant in `docs/contracts/schema.md`; two-process interleave test; stdio write visible; `registry.test.ts` green | vertical slice first (days 1–3) so UI lanes start on day 4 |
| P2a Work items core | shell, sidebar, tab bar, projects, list + board + table, create dialog, quick-add, filter bar, display menu | not started | user acceptance: create → drag across board → priority + due date → reload survives | |
| P2b Detail, editor, Power K | peek/modal/full detail, property rail, MarkdownEditor with CAS, sub-items, `/browse/[key]`, Power K, shortcuts | not started | browser steps 1–6; markdown round-trip tests; no hydration warnings | |
| P3 Cycles, modules, archives | cycles, active cycle, burndown/burnup, transfer, modules, module links, archives with restore | not started | cycle rules Vitest; transfer keeps snapshot; restore works in browser | |
| P4 Views, settings, counts | project views, save/update/duplicate/lock, sidebar counts, project settings, multi-valued grouping, sub-groups | not started | views round-trip; counts match `getCounts`; identifier rename keeps `/browse` | |
| P5 AI | assistant panel, Power K Ask with proposals and Apply, view from prompt, digests, status route, http guard | not started | `propose_*` writes nothing until Apply; destructive Apply confirms; no key in client bundle | |
| P6 Pages and handbook retirement | pages in SQLite, wiki and project pages, `import:handbook`, remove handbook code and Milkdown, Home moves to `/` | not started | import test on the 12 files; page round-trip; `grep -r milkdown src` empty | |
| P7 Collaboration | relations, comments, reactions, links, subscriptions, mentions, inbox, inbox digest | not started | notification for an MCP state change on a subscribed item; relation on both items | |
| P8 Intake, drafts, estimates, bulk | intake with agent policy, drafts, estimates, bulk bar, copy and move across projects | not started | MCP create lands in triage when required; bulk archive refuses mixed groups | |
| P9 Workspace surfaces | home widgets, stickies, favourites, your work, agent profiles, workspace views, active cycles, analytics | not started | home renders from one `getHomeSummary`; analytics equals `getCounts` | |
| P10 Layouts and operations | calendar, gantt, rich filters, automations, version history, exports, webhooks | not started | gantt drag writes both dates; automation logs `system` activity; export opens in a spreadsheet | |
| P11 Hardening | `"use cache"` + tags, Playwright, backup rotation, 10k-item performance, undo, dark mode | not started | `next build` clean; Playwright green; p95 list render < 300 ms on 10k items | |

## Hand-off notes

### P0 (lane A, 2026-10-10)

- Repo renamed from `funland` to `tessera`; git initialised with baseline commit `afa996d` (handbook app) before any Tessera change.
- Removed unused `@milkdown/crepe`, `@heroicons/react`, `@stylexjs/stylex`, `lucide-react`, `@astryxdesign/theme-neutral` and `src/themes/neutral/`. `@milkdown/kit` and `@milkdown/react` stay until P6.
- Added the pinned engine, editor, AI and MCP dependencies listed in `docs/PLAN.md` §11. Recharts (P9) and Playwright (P11) are not installed yet.
- `better-sqlite3` 13 segfaults on Node 22.13 (Node-API 9). Node 22.23.3 is now the default; `.nvmrc` and `engines.node` pin it. Run `nvm use` if `node -p process.versions.napi` prints less than 10.
- Gates: `npm run check` = typecheck, lint, vitest (empty suite), `scripts/check-conventions.ts`, `scripts/check-licenses.ts`. Seven reviewed licence exceptions live in `licenses.exceptions.json`.
- Stubs: `src/lib/tessera/{schemas,types,index}.ts` hold the enums from the plan. Everything else in the engine is P1.
- Deferred to P1: `.mcp.json` (needs `scripts/mcp-stdio.ts`), `drizzle/0000_init.sql`, all `scripts/db-*.ts`.
