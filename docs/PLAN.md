# Plan: Tessera, an AI-first local work tracker (complete Plane Community Edition rebuild) on Next 16 + TypeScript + SQLite

## Context

**Tessera** is the product. It rebuilds the Plane work tracker (github.com/makeplane/plane, AGPL-3.0) as a single-user, local, AI-first app in this repo, **without copying any Plane source** (facts and behaviours only; licence gate below). Scope is the **complete Plane Community Edition** minus the user's exclusions: accounts, invitations, admin, live cursors, attachments. Everything lives in one SQLite database behind one TypeScript service layer shared by the Next app, the MCP server and the in-app assistant.

The repo today is a small handbook app (markdown pages under `content/`, 4,172 lines under `src/app` and `src/lib`, Milkdown editor). The user does not work with it. Decision: Tessera gets its own shell, Pages become a first-class database entity like in Plane, the 12 existing `content/*.md` files are imported once, and the handbook code and Milkdown are removed in P6. Until then the old routes stay reachable and untouched.

**Build model (user decision, Oct 10, 2026): agents build everything.** The user's role is decisions, approvals, running `git init` and `ant auth login` (or placing an API key in `.env.local`), browser acceptance checks, and merges. Every library choice is weighted towards what coding agents know best and can verify locally (typings in `node_modules`, Vitest, the in-app browser). No commits unless the user asks.

**Hard facts from research**
- Rust is not installed on this Mac; the engine is TypeScript (ADR-001).
- Astryx 0.6 has no board, drag-and-drop, calendar grid, gantt or chart component. Those are ours to build (board DnD ported from the Astryx kanban template; charts via Recharts).
- Astryx ships the property controls we need: `Selector`, `MultiSelector`, `DateInput`, `DateRangeInput`, `Token`, `StatusDot`, `Badge`, `ProgressBar`, `Popover`, `DropdownMenu`, `Table` (+ plugins), `Toolbar`, `SegmentedControl`, `Resizable`, `Timestamp`, `MetadataList`, `PowerSearch`, `CommandPalette`, `AppShell`, `SideNav`, `TopNav`, `TabList`, `Chat*`, `Markdown`, `Banner`, `Toast`.
- `next.config.ts` has `cacheComponents: true`: uncached reads sit under `<Suspense>` with real fallbacks and `await io()` before the first synchronous SQLite call.

## Accelerators the user proposed (evaluated)

- **ProjectAtlas** (MIT, Rust CLI + MCP server indexing a repo into SQLite): a dev-time navigation tool for our coding agents (`projectatlas init` writes a project-local MCP config). Not product code.
- **no-mistakes** (MIT, Go): a local push gate that runs review, tests, lint and docs in a disposable worktree with an agent CLI before forwarding a branch. Needs git plus a remote. Becomes the merge gate for every lane branch once the user has created the repo.

## Stack decision (AI-first; user delegated the choice)

**Principle.** The assistant and external agents are first-class operators. Every operation is defined once (zod schema + handler) and is reachable from the UI, from MCP and from the in-app assistant. Every mutation is attributed to an actor and logged, so AI can summarise, explain, notify and undo.

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16.4, React 19.3, Astryx 0.6.8 (pinned exactly; upgraded from 0.6.0 on 2026-10-11) | Keep what works; Cache Components rules below |
| Engine | TypeScript service layer `src/lib/tessera/` over SQLite via Drizzle ORM 0.45.4 + better-sqlite3 13.0.3, WAL, FTS5 | One language for UI, MCP and AI tools; sub-second in-memory tests; `node:sqlite` rejected (experimental on Node 22.13, no FTS5) |
| Editor | Tiptap 3.31.4 + official `@tiptap/markdown` | 40× Milkdown's usage, 66 MIT extensions, the editor Plane uses, best known to agents; markdown stays the storage format |
| AI | `@anthropic-ai/sdk` 0.133.0, `betaZodTool` + `client.beta.messages.toolRunner`, `claude-opus-5-5`, adaptive thinking, `client.messages.parse` + `zodOutputFormat` for structured output | Official SDK, zero-arg client resolves the key or the `ant auth login` profile |
| MCP | `mcp-handler` 2.3.0 route + stdio entry on `@modelcontextprotocol/server` 2.3.1 (already installed as the route's peer) | One `registerTools(server)` adapter for both transports; no second MCP SDK major |
| Charts | Recharts 3.10.1 (MIT, React 19 peer) | SVG, colours via CSS variables, the chart library agents know best |
| Tests | Vitest 5 + `:memory:` SQLite; in-app browser for acceptance; Playwright from P11 | Fast, local, no accounts |
| Gates | `npm run check` = tsc, eslint, vitest, convention script, licence script; no-mistakes once the remote exists | Agents merge only green branches |

**What AI-first adds beyond Plane parity**
- Actors are members. `actor` rows for the user, the assistant and every MCP client; work items can be assigned to agents; "Your work" exists for agents too (`/agents/[actorId]`).
- The notifications inbox is mostly "what agents did while you were away": assignments, mentions, comments and state changes by non-user actors, intake arrivals, automation actions.
- Intake policy per project: external agents can be required to submit through Intake (triage) instead of creating work items directly.
- Command bar and work-item assistant in propose-then-Apply mode; view from prompt; cycle, module and inbox digests; Home widget "Since you were last here".
- Append-only activity log with actor attribution feeds digests, analytics narratives and undo.
- Schema leaves room for `agent_run` (hand a work item to an agent, attach its run log) without shipping it now.

**Verified versions and facts (Oct 10, 2026)**
| Item | Fact |
|---|---|
| Node | 22.13.1. `node:sqlite` experimental, lacks FTS5, rejected. |
| better-sqlite3 | 13.0.3, Node ≥22, FTS5 compiled in, on Next's default `serverExternalPackages` list. |
| drizzle-orm / drizzle-kit / drizzle-zod | 0.45.4 / 0.31.11 / 0.8.3; partial unique indexes via `uniqueIndex().on().where(sql)` verified in `drizzle-orm/sqlite-core`. |
| uuid / fractional-indexing | 14.0.3 (`v7()`) / 4.0.0 (ESM-only; fine for Next, Vitest, tsx). |
| vitest / tsx / @types/better-sqlite3 | 5.0.3 / 4.23.15 / 9.6.0. |
| @anthropic-ai/sdk | 0.133.0; `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`, `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`; `tool_choice` forcing returns 400 on Opus 5.5, so steering is prompt-only. |
| @modelcontextprotocol/server | 2.3.1 installed; exports `.` (`McpServer`, `InMemoryTransport`) and `./stdio` (`StdioServerTransport`, `serveStdio`). Becomes a direct dependency; `@modelcontextprotocol/client` 2.3.1 as dev dependency for tests. zod 4.6.5 objects already work as `inputSchema` in `src/app/api/mcp/route.ts`. |
| @next/env | 16.4.0; `loadEnvConfig(repoRoot)` gives scripts the same `.env.local` as the server. |
| server-only | Not an installed package; Next aliases it and the alias throws under plain Node. Allowed only in Next-bundled files (`src/lib/tessera/server.ts`, actions, routes), never in code Vitest or tsx load. |
| Tiptap | `@tiptap/{core,react,pm,starter-kit,markdown,suggestion}` and `@tiptap/extension-{mention,task-list,table,drag-handle,placeholder,link,image,code-block-lowlight,bubble-menu}` all 3.31.4, MIT, React 19 peer. `@tiptap/markdown` depends only on `marked` ^17 (MIT) and exposes `Markdown`, `editor.getMarkdown()`, `setContent(md, { contentType: 'markdown' })`, per-extension `parseMarkdown` / `renderMarkdown`, `isTaskItem`; unknown HTML is kept as literal text. Nothing depends on Tiptap Pro or Cloud. |
| Licence audit | 628 installed packages: every direct dependency and every planned addition is MIT, ISC, Apache-2.0 or CC0. Acceptable flagged transitives: `@img/sharp-libvips-*` (LGPL-3.0, Next's optional image optimiser, dynamically linked, unused), `axe-core` (MPL-2.0, dev-only lint), `dompurify` (MPL-2.0 or Apache-2.0, we take Apache). BlockNote excluded (MPL core, GPL-or-proprietary XL packages). Plane (AGPL) contributes facts only. |
| Recharts | 3.10.1, MIT, peer `react ^16.8 || ^17 || ^18 || ^19`. Alternatives checked: `@visx/xychart` 4.0.0 (MIT), `d3` 7.9.0 (ISC). |
| Unused deps today | `@milkdown/crepe`, `@heroicons/react`, `@stylexjs/stylex` imported nowhere; `lucide-react` only by the unused `src/themes/neutral`. Removed in P0. `@milkdown/kit` and `@milkdown/react` removed in P6 with the handbook. |
| Next dev tooling | `next dev` exposes an MCP server at `/_next/mcp` (`get_compilation_issues`, `compile_route`); `next-dev-loop` skill pairs it with `agent-browser`. |

**Cache Components rules (bundled Next 16.4 docs)**
- Uncached I/O and request APIs sit under `<Suspense>` with a real fallback; synchronous drivers need `await io()` before the first query.
- `refresh()` and `updateTag()` are Server-Action-only. Route handlers may call `revalidatePath` or two-arg `revalidateTag(tag, 'max')`, which only mark paths for the next visit.
- Start uncached; `"use cache"` + `cacheTag` / `updateTag` per the Taskboard recipe (`node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md`) only in P11.
- Server Actions run one at a time per client, so autosave must never block board moves; client-side reads (search, typeahead) use GET route handlers.
- `error.tsx` does not wrap its own segment's layout; `middleware.ts` is `proxy.ts`; removed segment configs are not used.

**Astryx accelerators** (CLI templates under `node_modules/@astryxdesign/cli/assets/templates/pages/`): `kanban-board` (pointer DnD, ghost placeholder, drop index), `work-item-detail` (Plane-like issue page), `table-grouped` (collapsible groups, resizable inspector), `table-filter` (PowerSearch tokens, saved views). All use `xstyle` and heroicons, which the project rules forbid, so they are **ported** (className + `var(--spacing-*|--radius-*|--color-*)` tokens, Phosphor icons through `src/themes/catppuccin/icons.tsx`), never pasted. Table plugins available: `useTableSortable`, `useTableGroupedRows`, `useTableSelection`, `useTableFiltering`, `useTableColumnResize`, `useTableStickyColumns`, `useTableTreeData`, `useTableRowExpansion`. Inline edit = `renderCell` returning ghost `Selector` / `DateInput`.

## ADR-001: TypeScript engine instead of a Rust process

**Decision.** The engine is a TypeScript service layer (`src/lib/tessera/`) over SQLite via Drizzle + better-sqlite3, running inside the Next server and inside a stdio MCP entry that imports the same code.

**Why.** One definition per operation serves UI, MCP and the Anthropic tool runner; Rust would add a second type system, an HTTP contract and a mock engine for UI lanes. Rust is not installed and cold `cargo run` is 30–90 s per UI lane. Single-user loopback SQLite in-process is the simplest correct topology; WAL + `busy_timeout` + immediate transactions let the stdio process coexist. Drizzle types flow into components; Vitest + `:memory:` gives sub-second tests.

**Revisit triggers.** A standalone binary without Node; measured SQLite-in-Node limits; a Rust-native MCP requirement. The researched Rust design (axum 0.8 + rusqlite 0.40, loopback 127.0.0.1:4455) is recorded in the research transcript and fits behind the same service interface.

## Resolved design decisions

| # | Decision |
|---|---|
| 1 | **Workspace**: exactly one implicit workspace. No workspace slug in URLs. Workspace-level entities (workspace views, drafts, stickies, favourites, recents, notifications, wiki pages) have `project_id NULL` or no project column. |
| 2 | **IDs**: UUIDv7 TEXT (`uuid` `v7()`). Human key `<identifier>-<sequence_id>` computed, never stored; sequence allocated inside the insert transaction via `UPDATE project SET next_sequence = next_sequence + 1 … RETURNING`; numbers never reused. |
| 3 | **Project identifier** `^[A-Z][A-Z0-9]{1,11}$`, uppercased, unique among non-deleted projects, editable. Project URLs use the UUID; humans share `/browse/WEB-12`. |
| 4 | **Ordering**: `sort_order TEXT` fractional-index keys, one project-wide key per work item so the order holds under any grouping; new items append at the bottom; a drop rewrites one row. Same for states, labels, cycles, modules, views, pages, stickies, favourites. |
| 5 | **Enums** in zod, not CHECK constraints. State groups `backlog, unstarted, started, completed, cancelled, triage` (triage hidden, created when Intake is enabled). Priorities `urgent, high, medium, low, none`. Module status `backlog, planned (default), in_progress, paused, completed, cancelled`. Cycle status derived `current / upcoming / completed / draft`. Relation types canonical `blocked_by, relates_to, duplicate, start_before, finish_before, implemented_by` (inverses computed). Intake status `pending, declined, snoozed, accepted, duplicate`. Estimate type `points, categories, time`. |
| 6 | **Time**: timestamps ISO-8601 UTC text; dates `YYYY-MM-DD`; "today" = server local date. |
| 7 | **Soft delete** `deleted_at` on every entity table; partial unique indexes `WHERE deleted_at IS NULL`; case-insensitive uniqueness through a stored lowercased `name_key` column. Default state = `state.is_default` with a partial unique index per project. |
| 8 | **Actors are members**: `actor` table with `user` (the human), `assistant`, and one row per MCP client (`mcp:<name>`), plus `system` for automations. `created_by` / `updated_by` / `activity.actor_id` reference it. Assignees, subscribers, mentions, reactions and notifications all key on actors, so agents can be assigned work and the inbox can report what they did. |
| 9 | **Membership**: one cycle per work item (`cycle_id`), many modules (`work_item_module`), many labels (`work_item_label`, labels one level deep), many assignees (`work_item_assignee`). |
| 10 | **Description and page bodies** are markdown edited by the shared Tiptap `MarkdownEditor`; compare-and-set on a dedicated `description_version` column (property writes never bump it); every description save also writes a `*_version` snapshot row (collapsed per actor within 5 minutes) for version history and restore. Link schemes `work:WEB-12`, `page:<id>`, `cycle:<id>`, `module:<id>`; embeds are extracted on save into `page_embed` for back-links. |
| 11 | **Routes**: see §5. Peek = right `LayoutPanel` driven by `?peek=<id>`, drawn as an inset card (12px corners, 4px inside the 16px content panel; layout rework 2026-10-11); modal and full-screen modes share the same detail component. |
| 12 | **Caching**: start uncached; `await io()` before sync reads under `<Suspense>`; mutations = Server Actions → service → `refresh()`; no client `router.refresh()`. MCP route `afterWrite` calls `revalidatePath('/', 'layout')` (no-op until P11); external writes reach open tabs by polling `GET /api/changes?since=<seq>` (excludes actor `user`). |
| 13 | **Optimistic UI** with `useOptimistic` + `startTransition` for board, calendar and gantt drags; revert + Toast on failure; `ToastViewport` mounted in `providers.tsx`. |
| 14 | **DnD**: hand-written port of the Astryx kanban template's pointer DnD into `use-pointer-drag.ts`, reused by board, list reorder, calendar and gantt. Keyboard path = "Move to…" menus. `@dnd-kit` only if the port fails. |
| 15 | **Recents** (superseded the tab bar in the layout rework, 2026-10-11, which follows Plane's frame: no tab strip): every visited path, labelled by the same route registry (`recents.ts`, `resolveRoute`), goes into a newest-first list of 12 (`tessera.recents.v1`), shown on Home and as Power K's "Recent" group. The old path-based tab bar (`tessera.tabs.v1`, `alt+w`, middle-click, context menu) is gone. |
| 16 | **Cycles**: both dates or none; start ≤ end; no overlapping non-archived cycles (409); names not unique; archive only after end; completed cycles read-only except reorder, archive, transfer; joining replaces the previous cycle; transfer incomplete items; `progress_snapshot` frozen on first transfer out (or at archive if null) and served whenever non-null; burndown and burnup in issues or points mode. |
| 17 | **Env**: `TESSERA_DB_PATH` (default `data/tessera.db`, resolved against the repo root from the module location, never `cwd`), `ANTHROPIC_API_KEY` (or the `ant auth login` profile), `TESSERA_AI_MODEL`, `TESSERA_AI_EFFORT`. |
| 18 | **Layouts**: list, board, table first (P2a); calendar and gantt in P10; workspace views are table-only, as in Plane. |
| 19 | **Theme**: Catppuccin, Frappé (dark, the default) and Latte (light) with a Mauve accent, as the local Astryx theme `catppuccin` (`src/themes/catppuccin/`, built with `astryx theme build`, wired through `src/astryx-themes.ts`, which `astryx theme add catppuccin --import` generates). The colour scheme (Frappé, Latte or Match system) is the Astryx `<Theme mode>`, remembered in `localStorage` key `tessera.scheme.v1`; a hard reload in Latte briefly shows Frappé (accepted, no inline script). Corners: radius base 4, so chips 4, buttons and inputs 8, cards, menus and dialogs 12, page panels 16, pills only for avatars and badges, nested corners concentric. Headings use the body sans. All CSS token-only. |
| 20 | **Views**: Plane-shaped `filters` JSON + `display` JSON; `view.project_id NULL` = workspace view; four static workspace views (all, assigned, created, subscribed) are virtual; rich filter tree (AND/OR/NOT) in P10. |
| 21 | **Counts** from one `getCounts(scope)` shared by sidebar, headers, progress, analytics, MCP and AI. |
| 22 | **Colours** are palette keys (`red, orange, yellow, green, teal, cyan, blue, purple, pink, gray`), never hex; rendered with `Token`; state groups map to `StatusDot` variants backlog/unstarted → neutral, started → accent, completed → success, cancelled → error. Seed states use palette keys. Keys map to Catppuccin colours: red → Red, orange → Peach, yellow → Yellow, green → Green, teal → Teal, cyan → Sky, blue → Blue, purple → Mauve, pink → Pink, gray → Overlay 2 (`src/themes/catppuccin/palette.ts`). |
| 23 | **Remembered display settings**: `view_settings` rows per project, cycle, module, workspace and profile scope; URL params override. |
| 24 | **Activity** append-only, `seq INTEGER PRIMARY KEY AUTOINCREMENT` as the change cursor; read-time collapse of consecutive description edits; relations, cycle and module membership log on both sides. |
| 25 | **Search**: standalone FTS5 tables (`work_item_fts`, `page_fts`) written by the service in the same transaction; no triggers, no external-content tables. |
| 26 | **Tool registry is the single enumeration of operations**; Server Actions are generated wrappers; a Vitest asserts every mutating service export is bound by exactly one tool. |
| 27 | **Intake policy**: `project.agent_intake_required` (default off). When on, MCP clients' `create_work_item` lands in Intake (triage) and the inbox announces it; the user accepts, declines, snoozes or marks duplicate. |
| 28 | **Automations** (auto-archive closed after N months, auto-close inactive after N months) run from `instrumentation.ts` on server start and hourly, and from `scripts/automations.ts`; they act as actor `system` and log Plane-style system activities. |

**Confirmed by the user on Oct 10, 2026**
| # | Decision |
|---|---|
| U1 | **Engine is TypeScript**, not the Rust process named in the first brief. |
| U2 | **Assistant writes are propose-then-Apply.** The model only calls read tools and `propose_*` stubs; nothing is written until the user clicks Apply, which runs the real tools as actor `assistant`; destructive proposals get a confirm Dialog. |
| U3 | **Git**: the user runs `git init` and the baseline commit before P0. No commits by agents unless asked. |
| U4 | **Editor is Tiptap 3 + `@tiptap/markdown`**, one shared `MarkdownEditor` behind a small interface so the library is swappable in one file. |
| U5 | **Agents build everything**; lane prompts cite typings or docs in `node_modules` for every API used. |
| U6 | **Licence gate** rejects any dependency that would require publishing our source (GPL, AGPL, LGPL, MPL, SSPL, BUSL, EUPL and similar) or visible attribution in the product (CC-BY family), and any missing licence; reviewed exceptions in `licenses.exceptions.json`. |
| U7 | **Name is Tessera** (UI, `package.json`, DB file, env prefix, MCP tool prefix). The user renames the repo folder when creating the repo. |
| U8 | **Scope is the complete Plane Community Edition**, single-user, minus accounts, invitations, admin, live cursors, attachments. |
| U9 | **Pages**: the existing handbook is not a constraint ("build whatever you like"). Decision: Pages live in SQLite as markdown with Plane's behaviours (nesting, lock, archive, versions, labels, embeds, favourites); `content/*.md` imported once; handbook code and Milkdown removed in P6. |

## 1. Scope map: Plane Community Edition → Tessera

| Plane area | Tessera (single-user, AI-first adaptation) | Phase |
|---|---|---|
| Projects: list, create, identifier, description, logo, feature toggles, archive, settings | Same; logo = Phosphor icon + palette colour; features toggles for cycles, modules, views, pages, intake, estimates | P2a, P4 |
| Work items: properties, sub-items, peek/modal/full, quick-add, create-more, copy, archive, delete | Same, plus `#` mention and `work:` links | P2a, P2b, P8 |
| States, labels (grouped), default state, state rules | Same | P2a, P4 |
| List, board (sub-groups), table (inline edit) | Same | P2a, P4 |
| Calendar (month/week, weekends, drag), gantt (bars, drag edges, dependency connectors) | Same, built on Grid + pointer drag | P10 |
| Cycles: dates, status, overlap, transfer, snapshot, burndown/burnup, active cycle summary, archive | Same | P3 |
| Modules: status, dates, links, progress, archive | Same (lead and members become actors) | P3 |
| Views: project views all layouts, workspace views table-only, save/update/duplicate/lock, static views | Same | P4, P9 |
| Archives: work items, cycles, modules, projects | Same | P3 |
| Project settings: General, Features, States, Labels, Estimates, Automations, Members | Same; Members → **Agents** tab (which actors may write, intake policy) | P4, P8, P10 |
| Pages: nested, public/private, lock, archive (propagates), labels, versions, favourites, move, duplicate, embeds | Same, markdown in SQLite; wiki (workspace) pages and project pages; importer for `content/` | P6 |
| Relations (blocking, blocked by, relates, duplicate, start/finish before/after, implements) | Same, cross-project allowed | P7 |
| Comments (threaded), reactions on items and comments, links | Same; agents can comment; activity tab merges activity and comments | P7 |
| Subscriptions, mentions, notifications inbox (read, archive, snooze) | Same; auto-subscribe on assign and comment; inbox mostly reports agents | P7 |
| Assignees, Your work (Assigned, Created, Subscribed, Activity) | Actors as members; `/your-work` for the user, `/agents/[actorId]` for each agent | P1 (schema), P9 |
| Drafts (workspace-level, Move to project, "Save this draft?") | Same | P8 |
| Intake (triage state, accept/decline/snooze/duplicate, open/closed) | Same; sources `in_app`, `assistant`, `mcp`; agent intake policy | P8 |
| Estimates (points, categories, time; 2–6 values; templates; points-mode progress) | Same | P8 |
| Bulk operations (select, bulk edit, bulk archive, bulk delete) | Same | P8 |
| Copy and move across projects | Same | P8 |
| Favourites with folders, recents | Same | P9 |
| Home (quick links, recents, stickies, your work summary), stickies page | Same, plus "Since you were last here" digest widget | P9 |
| Workspace views, active cycles page | Same | P9 |
| Analytics (overview, work items, cycles, modules; charts) | Same with Recharts; AI narrative | P9 |
| Automations (auto-archive, auto-close) | Same, actor `system` | P10 |
| Version history (description and page versions, restore) | Same | P10 |
| Exports (CSV, JSON) | Same, files under `data/exports/` | P10 |
| Webhooks | Optional: outbound POST on activity with secret and retry table | P10 |
| Power K command palette, keyboard shortcuts, global search | Same, plus "Ask" (assistant) | P2b onward |
| Members, invitations, roles, workspace billing, publish to web, attachments, live cursors | **Excluded** | — |

## 2. Data model (`src/lib/tessera/db/schema.ts`, Drizzle)

**Conventions**
- `id TEXT PRIMARY KEY` UUIDv7 on every entity table. Exceptions: `activity.seq` and `notification.seq` are `INTEGER PRIMARY KEY AUTOINCREMENT` (append-only logs; cursors), with `uid TEXT UNIQUE`.
- `created_at`, `updated_at` ISO text, `created_by`, `updated_by` → `actor.id`, set by the service from `ctx`. `deleted_at` on entity tables.
- Enums in `schemas.ts` (zod); JSON columns `text({ mode: 'json' })` with zod schemas; no SQL keywords as column names (`state_group`, never `group`; no `key`).
- Partial unique indexes via Drizzle `uniqueIndex().on(...).where(sql\`deleted_at IS NULL\`)`.

**Core (P1–P4)**
| Table | Columns beyond id and audit | Constraints |
|---|---|---|
| `actor` | kind (`user, assistant, agent, system`), name, name_key, color, client_name (MCP), last_seen_at | unique name_key; seeded rows `user`, `assistant`, `system` |
| `project` | name, name_key, identifier, description_md, logo JSON, next_sequence, cycles_enabled, modules_enabled, views_enabled, pages_enabled, intake_enabled, estimates_enabled, agent_intake_required, estimate_id, default_assignee_id, archive_in_months, close_in_months, close_state_id, archived_at, sort_order | unique identifier, unique name_key (partial) |
| `state` | project_id, name, name_key, description, color, state_group, is_default, sort_order | unique (project_id, name_key); unique (project_id) where is_default and not deleted |
| `label` | project_id, parent_id, name, name_key, color, sort_order | unique (project_id, name_key); one level deep |
| `work_item` | project_id, sequence_id, name, description_md, description_version, state_id (RESTRICT), priority, parent_id (CASCADE), cycle_id (SET NULL), estimate_point_id, start_date, target_date, completed_at, archived_at, is_draft (legacy false), sort_order, external_source, external_id | unique (project_id, sequence_id) not partial; indexes (project_id, state_id), (project_id, cycle_id), (parent_id) |
| `work_item_label`, `work_item_module`, `work_item_assignee`, `work_item_subscriber` | junctions on (work_item_id, x_id) | primary key (both) |
| `cycle` | project_id, name, description_md, start_date, end_date, progress_snapshot JSON, archived_at, sort_order | rules in service |
| `module` | project_id, name, name_key, description_md, status, lead_actor_id, start_date, target_date, archived_at, sort_order | unique (project_id, name_key) |
| `module_member` | module_id, actor_id | primary key |
| `module_link`, `work_item_link` | parent id, title, url, metadata JSON, sort_order | |
| `view` | project_id NULL, name, name_key, description, filters JSON, rich_filters JSON, display JSON, is_locked, logo JSON, sort_order | unique (project_id, name_key) partial |
| `view_settings` | scope_type (`project, cycle, module, workspace, profile, archived, draft`), scope_id, filters JSON, display JSON | primary key (scope_type, scope_id) |
| `activity` | seq, uid, project_id, entity_type, entity_id, work_item_id, verb, field, old_value, new_value, old_identifier, new_identifier, comment, actor_id, created_at | indexes (project_id, seq), (work_item_id, seq) |
| `work_item_fts`, `page_fts` | FTS5 standalone, `*_id UNINDEXED, project_id UNINDEXED, name, body`; `tokenize = 'porter unicode61 remove_diacritics 2'` | maintained by `db/fts.ts` |

**Pages (P6)**: `page` (project_id NULL = wiki, parent_id, name, description_md, description_version, access `public|private`, is_locked, logo JSON, archived_at, sort_order), `page_label` (page_id, label_id), `page_version` (page_id, name, description_md, version, actor_id, created_at), `page_embed` (page_id, entity_type, entity_id).

**Collaboration (P7)**: `work_item_relation` (work_item_id, related_work_item_id, relation_type; unique unordered pair partial), `comment` (work_item_id, parent_comment_id, body_md, body_version, actor_id, edited_at), `comment_reaction` and `work_item_reaction` (target id, actor_id, reaction; unique triple), `mention` (entity_type, entity_id, actor_id), `notification` (seq, uid, recipient_actor_id, kind, entity_type, entity_id, work_item_id, project_id, title, snippet, actor_id, read_at, archived_at, snoozed_till, created_at; index (recipient_actor_id, read_at, seq)).

**Planning extras (P8)**: `draft_work_item` (project_id NULL, name, description_md, state_id, priority, parent_id, cycle_id, label_ids JSON, module_ids JSON, assignee_ids JSON, estimate_point_id, start_date, target_date), `intake` (project_id, name, is_default), `intake_item` (intake_id, work_item_id, status, snoozed_till, duplicate_to_id, source, created_by_actor_id), `estimate` (project_id, name, type, last_used, archived_at), `estimate_point` (estimate_id, position, value, description).

**Workspace (P9)**: `favorite` (entity_type `project|cycle|module|view|page`, entity_id, folder_id, sort_order; unique (entity_type, entity_id) partial), `favorite_folder` (name, sort_order), `recent_visit` (entity_type, entity_id, visited_at; primary key (entity_type, entity_id)), `sticky` (name, description_md, color, sort_order), `quick_link` (title, url, sort_order), `workspace_settings` (singleton: name, home_widgets JSON, ai JSON).

**Hardening (P10)**: `work_item_version` (work_item_id, name, description_md, version, actor_id, created_at), `export_job` (scope JSON, format, status, file_path, created_at), `webhook` (url, events JSON, secret, is_active), `webhook_delivery` (webhook_id, activity_seq, status, attempts, last_error).

**JSON shapes (zod, `schemas.ts`)**
- `FiltersSchema`: id lists for state, state_group, priority, labels, cycle, module, parent, assignees, created_by, subscriber, mentions, project (workspace views); `search`; date tokens for start, target, created, updated, completed (`{ op: before|after|between, from?, to?, relative?: today|1w|2w|1m }`); `type: null|active|backlog`; `sub_items`; `archived`; `start_target_date` (gantt).
- `RichFiltersSchema` (P10): condition tree `{ and: [...] } | { or: [...] } | { not: ... } | { field, op, value }`.
- `DisplaySchema`: `layout (list|board|table|calendar|gantt)`, `group_by`, `sub_group_by` (`null|state|state_group|priority|labels|cycle|module|assignees|created_by|created_at|target_date`), `order_by`, `type`, `show_empty_groups`, `sub_items`, `calendar: { layout: month|week, show_weekends }`, `properties` (key, state, priority, labels, cycle, modules, assignees, estimate, start_date, target_date, sub_items_count, links, created_at, updated_at).
- `CycleProgressSchema`: `{ total, completed, cancelled, started, unstarted, backlog, by_state, by_label, by_assignee, points?: {...}, completion_chart: Record<date, pending> }`.

**Invariants (service layer, each with a Vitest case)**
- Identifier regex and uniqueness; key computed at read time.
- `createProject` seeds Backlog (default, gray), Todo (blue), In Progress (yellow), Done (green), Cancelled (red); enabling Intake adds the hidden Triage state. Cannot delete the default state, a non-empty state, the triage state or the last state of a group; `deleteState` takes an optional move target.
- Labels one level deep; deleting a parent deletes children; deleting a label removes it from items and views.
- Work item: parent same project and acyclic; `completed_at` follows the state group; archive only in `completed` or `cancelled`; archived items read-only; missing state → project default; `start_date ≤ target_date`; labels, state, estimate point, parent, cycle, modules must belong to the project; assignee set replace semantics; adding an assignee auto-subscribes; copies clear cycle, modules, estimate, assignees and append " (Copy)" and do not copy children; move across projects allocates a new sequence and drops unmapped labels.
- Cycles per decision 16. Modules archive only in `completed|cancelled`; archived modules read-only.
- Relations: one row per unordered pair; creating an inverse type swaps ids; removal matches either direction; both items get activity.
- Views: locked views reject changes; duplicate = "Copy of …"; workspace views table-only.
- Pages: archive propagates to descendants; must be archived before delete; children of a deleted page become top-level; locked pages read-only; moving between project and wiki keeps the id.
- Intake: accept sets the project default (or chosen) state and status `accepted`; decline keeps the item in triage, hidden; snooze sets `snoozed_till`; duplicate sets `duplicate_to_id`; deleting a non-accepted intake item deletes the work item.
- Estimates: one active system per project, 2–6 points; changing type archives the old system and clears `estimate_point_id` on items.
- Drafts: "Move to project" creates the work item (with cycle, modules, labels) and deletes the draft in one transaction.
- Notifications are generated inside the same transaction as the triggering mutation, never for the actor who caused it.
- Description writes use CAS on `description_version` and write a version row; `updateWorkItem` is field-scoped.
- Soft-delete cascades run synchronously in the same transaction.

**Migrations**: `drizzle.config.ts`; `drizzle/0000_init.sql` generated plus hand-written FTS migrations. `getDb()` resolves the path against the repo root, creates `data/`, applies PRAGMAs (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`), then `migrateIfNeeded()` under a lock file with a `VACUUM INTO data/backups/tessera-<iso>.db` backup (keep 10) before any pending migration. The stdio entry refuses to start on pending migrations unless `--migrate` is passed and logs the absolute DB path. Rule in `docs/contracts/schema.md`: a migration that recreates `work_item` or `page` must be followed by `npm run db:fts-rebuild`; `fts.test.ts` guards it.

## 3. Engine module map (`src/lib/tessera/`)

```
types.ts  schemas.ts  core/{keys,time,group}.ts         client-safe (types, zod, pure helpers)
core/{errors,ids,order,context,tx}.ts                   TrackerError, uuid v7, fractional keys, TesseraContext, withTx(...).immediate()
db/{schema,client,fts}.ts
activity.ts  notifications.ts  versions.ts
actors.ts  projects.ts  states.ts  labels.ts  work-items.ts  assignees.ts  relations.ts  comments.ts  links.ts
cycles.ts  modules.ts  views.ts  view-settings.ts  pages.ts  drafts.ts  intake.ts  estimates.ts
favorites.ts  recents.ts  stickies.ts  home.ts  analytics.ts  automations.ts  exports.ts  webhooks.ts
filters.ts  counts.ts  search.ts  changes.ts  seed.ts  import-handbook.ts
index.ts                                                barrel of everything except db/client (NO server-only)
server.ts                                               import 'server-only'; export * from './index'; export { getDb }
tools/{registry,mcp,anthropic}.ts
ai/{client,assistant,view-from-prompt,digest,narrative,prompts}.ts
```

`TesseraContext = { db, actor, now(), today() }`. `TrackerErrorCode = NOT_FOUND | VALIDATION | CONFLICT | RULE | ARCHIVED | LOCKED | BUSY`.

**Import boundary** (ESLint `no-restricted-imports` + `scripts/check-conventions.ts`): `'use client'` files may import only `@/lib/tessera/types`, `@/lib/tessera/schemas`, `@/lib/tessera/core/{keys,time,group}`. Server Components, actions and routes import `@/lib/tessera/server`. Vitest and `scripts/*.ts` import `@/lib/tessera`. drizzle-zod only inside `db/schema.ts`.

**Signatures** (full list in `docs/contracts/service-api.md`): the P1 set is projects, states, labels, `listWorkItems(ctx, { project_id?, filters?, display?, scope })` with scope ∈ project, cycle, module, view, workspace, profile(actor), archived, draft; `createWorkItem`, field-scoped `updateWorkItem`, `updateWorkItemDescription(ctx, id, { description_md, expected_description_version })`, `moveWorkItem(ctx, id, { group_by, value, before_id?, after_id? })`, `bulkUpdateWorkItems`, `copyWorkItem`, `moveWorkItemToProject`, archive/unarchive/delete, `getWorkItemByKey`, `listChildren`, `setAssignees`, `setLabels`, `setModules`, cycles (incl. `transferCycleWorkItems`, `getCycleProgress`), modules, views, view settings, `getCounts`, `searchAll(q, { scope })`, `listChanges(sinceSeq, { excludeActors })`, `latestSeq`, `listActivity`. Later phases add the domain files above with the same shape.

## 4. Tool registry and adapters

`ToolDef = { name, title, description, input: z.ZodObject (strict), mutates, destructive?, core, run(ctx, input) }`. About 110 tools by P10; about 30 are `core` (the assistant's default set). MCP exposes all under the `tessera_` prefix.

| Domain | Tools (abbreviated) |
|---|---|
| Projects, states, labels, actors | list/get/create/update/archive/unarchive/delete project; list/create/update/reorder/set_default/delete state; list/create/update/reorder/delete label; list_actors, register_actor |
| Work items | list, get, get_by_key, create, update, update_description, move, bulk_update, copy, move_to_project, set_labels, set_modules, set_assignees, subscribe, unsubscribe, archive, unarchive, list_archived, delete, list_children, list_activity, list_versions, restore_version |
| Relations, comments, links | add_relation, remove_relation, list_relations; list/create/update/delete comment; add/remove reaction; add/remove link |
| Cycles, modules | CRUD, archive/unarchive, add/remove items, transfer, progress; module members and links |
| Views, settings | CRUD, duplicate, lock/unlock; get/save view_settings; get/update project_settings; get/update automations |
| Pages | list, get, create, update, update_body, move, lock/unlock, archive/unarchive, delete, duplicate, list_versions, restore_version, list_embeds |
| Drafts, intake, estimates | drafts CRUD + move_to_project; list_intake, accept, decline, snooze, mark_duplicate; estimates CRUD, set_estimate_point |
| Workspace | favorites and folders, recents, stickies, quick_links, notifications (list, mark_read, archive, snooze), home_summary, analytics(scope, tab), export_csv, webhooks CRUD |
| Meta | get_counts, search_all, list_changes, describe_filters |

Destructive: every `delete_*`, `transfer_cycle_work_items`, `bulk_update_work_items`, `move_work_item_to_project`, `restore_version`, `accept`/`decline` intake.

**Adapters**
- **MCP** (`tools/mcp.ts`): `registerTesseraTools(server: McpServer, { toolset, actorResolver, afterWrite })`; `inputSchema: def.input`; actor resolved from client info (`mcp:<name>`, registered in `actor` on first contact); errors → `isError: true`; honours `agent_intake_required`.
- **HTTP route** `src/app/api/mcp/route.ts`: rebuilt to register only Tessera tools (the handbook tools go with the handbook in P6; until then both sets coexist with distinct prefixes).
- **stdio** `scripts/mcp-stdio.ts`: `loadEnvConfig(REPO_ROOT)`; flags `--db`, `--migrate`, `--init`; `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/server`; logs the DB path to stderr.
- **Server Actions** `src/app/actions/_run.ts`: `runTool(name, input, actor = 'user')` validates, runs, `refresh()`, returns `{ ok, data, cursor }`; per-domain files export `toolAction('move_work_item')` wrappers; `registry.test.ts` enforces one-to-one coverage.
- **Anthropic** `tools/anthropic.ts`: read tools as `betaZodTool`; every mutating tool gets a `propose_<name>` stub returning `{ proposal_id, preview }`; Apply runs the real tool as `assistant`; destructive proposals need a confirm Dialog; `TrackerError` → `tool_result` with `is_error: true`.

## 5. Routes, screens, components

**Routes** (`src/app/`, no workspace slug)
```
(tessera)/layout.tsx                      AppShell (wash): TopNav, SideNav, content panel, ToastViewport, ChangesPoller, RecentsTracker
/                                          Home (widgets)
/your-work/(assigned|created|subscribed|activity)      actor = user
/agents, /agents/[actorId]/(…same tabs…)   AI-first agent profiles
/inbox                                     notifications
/drafts
/workspace-views, /workspace-views/[viewId]
/active-cycles
/analytics/[tab]
/stickies
/projects, /projects/archives
/projects/[projectId]/layout.tsx          ProjectFrame + ProjectProvider (states, labels, cycles, modules, estimates, actors)
/projects/[projectId]/work-items(/[workItemId])
/projects/[projectId]/cycles(/[cycleId])  /modules(/[moduleId])  /views(/[viewId]|/new)
/projects/[projectId]/pages(/[pageId])    /intake   /archives/(work-items|cycles|modules)
/projects/[projectId]/settings/(general|features|states|labels|estimates|automations|agents)
/wiki, /pages/[pageId]                     workspace pages
/work-items/[workItemId]                   global full-screen detail (loads its own project bundle)
/browse/[key]                              Suspense → parseKey → lookup → redirect
/settings/(general|ai|agents|exports|webhooks)
projects/error.tsx  projects/[projectId]/not-found.tsx  (tessera)/error.tsx  not-found.tsx
actions/{_run,projects,states-labels,work-items,relations-comments,cycles,modules,views,pages,drafts-intake,estimates,workspace,settings,ai}.ts
api/changes/route.ts                       GET ?since=<seq>
api/search/route.ts                        GET ?q=&scope=
api/work-items/[id]/description/route.ts   POST (sendBeacon flush, CAS)
api/pages/[id]/body/route.ts               POST (same)
api/ai/assist/route.ts  api/ai/status/route.ts
api/exports/[id]/route.ts                  GET file
api/mcp/route.ts
```

**Components** (`src/components/`): `shell/` (TopBar, Sidebar, FavoritesSection, PanelHeader, RecentsTracker, RecentsList, CommandBar, CommandBarAsk, QuickCreate), `work-items/` (WorkItemsScreen, FilterBar, DisplayMenu, ListLayout, BoardLayout, TableLayout, CalendarLayout, GanttLayout, CreateWorkItemDialog, QuickAdd, BulkBar), `detail/` (WorkItemDetail, PeekPanel, PropertyRail, DescriptionEditor, SubItems, Relations, Links, Comments, ActivityFeed, VersionHistory), `planning/` (Cycles*, Modules*, TransferDialog, BurndownChart, Archives*), `views/`, `pages/` (PagesList, PageTree, PageEditor, PageSidebar), `intake/`, `drafts/`, `estimates/`, `home/` (widgets), `inbox/`, `analytics/` (Recharts wrappers), `settings/`, `ai/` (AssistantPanel, ProposalList, DigestCard, Narrative), `editor/` (MarkdownEditor + extensions), `dnd/use-pointer-drag.ts`, `styles/*.css` (one per area, imported once from `globals.css`).

**Editor** (`src/components/editor/`): `MarkdownEditor.tsx` on `@tiptap/react` `useEditor` with `StarterKit`, `Markdown`, `TaskList`, `Table`, `Link`, `Placeholder`, `DragHandle`, `CodeBlockLowlight`, `Mention` + `Suggestion` (`#` work items via `/api/search`, `@` actors, `[[` pages), slash menu, `BubbleMenu`, source toggle (plain `textarea` bound to the same markdown). Custom nodes declare `renderMarkdown` / `parseMarkdown`. Interface: `{ value, onChange(md), onFlush, readOnly, compact, placeholder, linkSchemes }`.

**Astryx mapping** (verified against 0.6.0 typings; *check* items re-verified on first use): `TabList` + `Tab href` for section and workspace tabs; `StatusDot variant` by state group and `Token color` for chips; priority via Phosphor `CellSignalHigh/Medium/Low`, `Warning`, `Prohibit`; `Selector`, `MultiSelector`, `DateInput`, `DateRangeInput`, `Tokenizer`; `List`/`ListItem`, `Card` + pointer drag, `Table` + plugins; `LayoutPanel` + `useResizable` + `ResizeHandle` for the peek (*check* `resizable` prop type); `PowerSearch`, `DropdownMenu`, `SegmentedControl`; `Toast`/`ToastViewport` (*check* position values), `Banner`, `EmptyState`, `Skeleton`, `Spinner`; `ProgressBar`, `MetadataList`, `Timestamp`; `CommandPalette`, `Chat*`, `Markdown`, `Kbd`; `useHotkeys` (*check* call form), `useAnnounce`, `useClipboard`, `useGridFocus`, `useListFocus`, `useTreeFocus`.

**Template port**: `use-pointer-drag.ts` ports the Astryx kanban template's pointer DnD (MIT, Meta copyright; notice in `THIRD_PARTY_NOTICES.md`), tokens and Phosphor only.

## 6. Shell, recents, navigation

- New `(tessera)` route group with Astryx `AppShell variant="wash"` (layout rework, 2026-10-11; docs/contracts/ui.md "Shell"): the top bar and the sidebar sit on the wash and the content sits in one rounded panel 8px in from it. Top bar: collapse button, brand, the search field (opens Power K, `mod+k`), help (`mod+/`) and the account menu (colour scheme). Left `SideNav` = "Work" heading, a quiet "New work item" button, workspace items (Home, Your work, Inbox with unread `Badge`, Drafts, Workspace views, Active cycles, Analytics, Projects, Archives — each when it exists), Favorites (folders, drag to reorder), Projects as flat rows (logo, name, count; a "+" creates one; `…` menu Settings, Archives, Copy link, Favorite, Draft work item). A project's pages (Work items, Cycles, Modules, Views, Pages, Intake per feature toggles) are tabs in its panel header (`ProjectFrame.TABS`), not sidebar children. Resizable 236–350px; `mod+b` collapses it. The app rail (Work / Wiki / AI) arrives with P6.
- Screens open with slim panel headers: a 52px header (title, tabs, page actions), a 44px sub-header (view name and count, layout switch, display, the primary action) and a 44px filters row.
- Recents (decision 15) instead of a tab bar: `recents.ts` resolves label and icon from the path for every route above.
- Power K (`CommandPalette`): search work items, cycles, modules, pages (toggle all projects); contextual actions on an open item (state, priority, assignee, copy link); create actions (`n` then `i/c/m/v/d/p`); navigate (`g` then `h/i/c/m/v/d/k/r/s/j/a/p/x/y`); settings; shortcut list (`mod+/`); "Ask" tab for the assistant.
- Work item shortcuts: `s` state, `p` priority, `a` assign, `i` assign me, `l` labels, `shift+e` estimate, `shift+c` cycle, `shift+m` modules, `shift+s` subscribe, `mod+delete` delete, `mod+.` copy ID, `mod+shift+'` copy title, `mod+shift+,` copy URL. Pages: `shift+l` lock, `shift+a` access, `shift+r` archive. `mod+f` favourite cycle or module.
- Error and not-found boundaries at the segment parents (`projects/error.tsx` wraps the project layout; `(tessera)/error.tsx` wraps everything else).
- Until P6 the handbook routes (`/items/*`, old `/`) keep working untouched; Tessera's Home lives at `/home` until the handbook is removed, then moves to `/`.

## 7. Data flow

- **Reads**: synchronous page shell → `<Suspense fallback={<Skeleton/>}>` → async child awaits `params` / `searchParams`, `await io()`, then `readTessera(fn)` from `@/lib/tessera/server`. Display: URL params win, else `view_settings`, else defaults. Every detail read writes `recent_visit`.
- **Mutations**: typed action → `runTool` → `refresh()`. Board, calendar and gantt drags use `useOptimistic` with a reducer + `startTransition`; failure reverts and toasts. Create dialog uses `useActionState` + key reset; "Create more" keeps it open; closing dirty offers "Save this draft?".
- **Editors** (descriptions, comments, pages): `editor.getMarkdown()` per transaction, 400 ms debounce → CAS action with the loaded version. On `CONFLICT`: keep the draft, `Banner` with "Keep mine" / "Load theirs". `pagehide` flush through `navigator.sendBeacon` to the POST route. Never remount a dirty or focused editor. On open, one parse → serialise cycle compares with the stored text; if they differ, a `Banner` offers the source view before anything is rewritten.
- **External writes**: `ChangesPoller` (5 s, paused when hidden, initial cursor from page props) polls `/api/changes?since=`; rows from non-`user` actors trigger `refreshAction()`, and the inbox badge updates from `notification.seq`.
- **Write serialisation**: every mutation in `withTx(...).immediate()`; reads outside transactions; `SQLITE_BUSY` → `BUSY` → Toast "Try again".
- **Automations and webhooks**: `instrumentation.ts` `register()` starts an hourly timer (guarded by a DB-level lease row so two processes never double-run); webhook deliveries are queued in `webhook_delivery` and sent after commit with retries.

## 8. AI features (`src/lib/tessera/ai/`)

- `client.ts`: `new Anthropic()` zero-arg; model `TESSERA_AI_MODEL ?? 'claude-opus-5-5'`; `thinking: { type: 'adaptive' }`; `output_config.effort` from `TESSERA_AI_EFFORT` (default `high`); `max_tokens` 16000 for digests, narratives and view generation, 32000 with `stream: true` for chat; `tool_choice` always `auto`.
- **Assistant** (`POST /api/ai/assist`, SSE): `client.beta.messages.toolRunner`, `max_iterations: 12`, read tools and `propose_*` stubs only; request `{ scope: { project_id?, work_item_id?, page_id?, cycle_id? }, messages }`; events `text_delta | tool_use | tool_result | proposal | done | error`; client owns transcript and proposals. `stop_reason` handling: `refusal` shows the explanation, `max_tokens` offers Continue, `pause_turn` resumes. `AuthenticationError` / `RateLimitError` → Toast. `GET /api/ai/status` hides the assistant when no credential resolves.
- **Apply** (U2): `ProposalList` with per-item and Apply-all; `applyProposalsAction` runs real tools as `assistant`, writes activity and notifications; destructive proposals confirm first.
- **View from prompt**: `client.messages.parse({ output_config: { format: zodOutputFormat(FiltersSchema.merge(DisplaySchema)) } })`.
- **Digests and narratives**: cycle, module and inbox digests from `listActivity`; analytics narrative per tab; Home widget "Since you were last here" (activity by non-user actors since `workspace_settings.last_seen_at`). Cached in memory per `latestSeq`.
- **Intake triage help**: for pending intake items the assistant proposes accept/decline/duplicate with a reason (proposals, never direct).
- **Key safety**: `next dev -H 127.0.0.1`; `src/lib/http-guard.ts` rejects non-loopback hosts and missing same-origin headers on AI routes; static check greps `.next/static` for `ANTHROPIC`.
- `docs/contracts/ai.md` holds the system prompt and the `describe_filters` payload. `eager_input_streaming` only if the installed `betaZodTool` type accepts it.

## 9. Phases (lane-weeks; about 27 in total, roughly 4 months wall-clock with 4–5 lanes in parallel)

| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **P0 Setup** | 0.5 | After the user's `git init`: rename to Tessera (`package.json`, title), installs, root configs, `.gitignore` (`data/`, `.env*`), `.env.example`, `.nvmrc`, `.mcp.json`, eslint boundary, licence and convention scripts, `docs/contracts/*`, stubs of `types.ts` / `schemas.ts` / `index.ts`, drop unused deps | `npm run check` green on an empty suite; `next build` passes |
| **P1 Engine** | 2.5 | Vertical slice days 1–3 (actors, schema, migrations, projects, states, create/list/move work items, seed) so UI lanes start day 4; then labels, assignees, activity, FTS, cycles, modules, views, view settings, counts, search, changes, registry, MCP route + stdio | Vitest for every invariant listed; two-process interleave test; stdio write visible; `registry.test.ts` green |
| **P2a Work items core** | 2 | Tessera shell and sidebar, tab bar (replaced by recents in the layout rework), projects list and frame, list + board + table, create dialog, quick-add, filter bar, display menu | **User acceptance**: create → drag across board → set priority and due date → reload survives |
| **P2b Detail, editor, Power K** | 3 | Peek / modal / full detail, property rail, `MarkdownEditor` with CAS and Banner, sub-items, `/browse/[key]`, Power K search and actions, shortcuts, hydration-clean tab bar | Browser steps 1–6; markdown round-trip tests; no hydration warnings |
| **P3 Cycles, modules, archives** | 2 | Cycles list and detail, active cycle summary, burndown/burnup, transfer, modules list and detail, module links, archives with restore | Cycle rules Vitest; transfer keeps the snapshot; restore works in the browser |
| **P4 Views, settings, counts** | 1.5 | Project views, save/update/duplicate/lock, sidebar counts, project settings (general, features, states, labels, agents tab), multi-valued grouping, sub-groups | Views round-trip; counts match `getCounts`; identifier rename keeps `/browse` |
| **P5 AI** | 2 | Assistant panel, Power K Ask with proposals and Apply, view from prompt, cycle and module digests, status route, http guard | `propose_*` writes nothing until Apply; destructive Apply confirms; no key in the client bundle |
| **P6 Pages and handbook retirement** | 2 | Pages in SQLite (tree, lock, access, archive, labels, versions, embeds, favourites hook), wiki and project pages, `scripts/import-handbook.ts` for `content/*.md`, remove handbook code, Milkdown and its MCP tools; Home moves to `/` | Import test on the 12 files; page round-trip; `grep -r milkdown src` empty |
| **P7 Collaboration** | 2 | Relations with inverse display, comments (threaded) and reactions, links, subscriptions, mentions, notifications inbox (read, archive, snooze), inbox digest | Notification generated for an MCP state change on a subscribed item; relation shown on both items |
| **P8 Intake, drafts, estimates, bulk** | 2 | Intake two-pane with accept/decline/snooze/duplicate and agent intake policy, drafts with Move to project, estimates (systems, templates, points-mode progress), bulk bar, copy and move across projects | Intake policy test: MCP create lands in triage when required; bulk archive refuses mixed groups |
| **P9 Workspace surfaces** | 2.5 | Home widgets (quick links, recents, stickies, your work summary, "Since you were last here"), stickies page, favourites with folders, Your work, agent profiles, workspace views and static views, active cycles, analytics with Recharts and narrative | Home renders from one `getHomeSummary`; analytics numbers equal `getCounts` |
| **P10 Layouts and operations** | 2.5 | Calendar and gantt (dependency connectors from relations), rich filter tree, automations, version history with restore, CSV and JSON export, webhooks, remaining settings | Gantt date drag writes both dates; automation run logs `system` activity; export opens in a spreadsheet |
| **P11 Hardening** | 2 | `"use cache"` + tags, Playwright acceptance suite, backup rotation, performance pass on 10k items, undo last assistant action | `next build` with no blocking-route insight; Playwright green; p95 list render < 300 ms on 10k items |

MCP tools ship in P1, so external agents operate Tessera from week 2. AI lands in P5 and grows in P7–P10 (digests, triage proposals, narratives).

## 10. Build lanes for parallel agents

One owner per file, recorded in `docs/contracts/OWNERS.md`; each lane in its own `git worktree` (`../tessera-<lane>`) and branch after P0.

| Lane | Owns | Starts |
|---|---|---|
| A Engine | `src/lib/tessera/**` (incl. all ToolDefs), `drizzle/`, `scripts/**`, root configs, `package.json`, `docs/contracts/*` | P0 alone, then P1 |
| B Shell and workspace | `(tessera)/layout.tsx`, `components/shell/**`, `providers.tsx`, `globals.css`, `src/themes/catppuccin/**`, `src/astryx-themes.ts`, `components/{home,inbox,settings}/**`, routes `/`, `/your-work`, `/agents`, `/inbox`, `/stickies`, `/settings/**` | P1 day 4 |
| C Work items UI | `components/work-items/**`, `components/dnd/**`, `projects/page.tsx`, `projects/[projectId]/{layout,work-items}/**`, `actions/{projects,states-labels,work-items}.ts` | P1 day 4 |
| D Detail, editor, pages | `components/editor/**`, `components/detail/**`, `components/pages/**`, `work-items/[workItemId]/**`, `browse/**`, `pages/**`, `wiki/**`, `projects/[projectId]/pages/**`, `api/{work-items,pages,search}/**`, `actions/{relations-comments,pages}.ts` | P2a |
| E Planning | `components/{planning,intake,drafts,estimates}/**`, `projects/[projectId]/{cycles,modules,archives,intake}/**`, `/drafts`, `/active-cycles`, `actions/{cycles,modules,drafts-intake,estimates}.ts` | P3 |
| F Views, analytics, settings | `components/{views,analytics}/**`, `projects/[projectId]/{views,settings}/**`, `/workspace-views/**`, `/analytics/**`, `actions/{views,settings,workspace}.ts` | P4 |
| G Integrations and AI | `tools/{mcp,anthropic}.ts`, `ai/**`, `api/{mcp,ai,exports}/**`, `components/ai/**`, `CommandBarAsk`, `actions/ai.ts`, `.mcp.json`, `instrumentation.ts` | P1 week 2 (MCP), P5 |
| Q QA | `tests/**`, `scripts/check-*.ts`, `THIRD_PARTY_NOTICES.md`, `docs/PLAN-STATUS.md` | P1 |

Merge gate per branch: `npm run check` (tsc, eslint, vitest, `check-conventions.ts`, `check-licenses.ts`), then no-mistakes once the remote exists. Convention script: no `'use client'` import outside the allowed tessera entry points, no hex colours or `xstyle` in our CSS/TSX, no `server-only` under `src/lib/tessera/**`, no Plane-specific identifiers or strings. Status lives in `docs/PLAN-STATUS.md`. Agents navigate the repo with ProjectAtlas.

## 11. Setup steps (P0, Lane A, one branch)

0. **User action**: `git init` and commit the current tree (rename the folder to `tessera` first if wanted). P0 starts when `.git` exists.
1. `package.json` name `tessera`; `.gitignore`: `data/`, `.env*`, `.next/`, `node_modules/`, `.projectatlas/`; `.env.example` with `TESSERA_DB_PATH`, `ANTHROPIC_API_KEY`, `TESSERA_AI_MODEL`, `TESSERA_AI_EFFORT`; `.nvmrc` = `22`.
2. Install: `drizzle-orm@0.45.4 better-sqlite3@13.0.3 drizzle-zod@0.8.3 uuid@14.0.3 fractional-indexing@4.0.0 @anthropic-ai/sdk@0.133.0 @modelcontextprotocol/server@2.3.1 @next/env@16.4.0` and the Tiptap set (`@tiptap/core @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/markdown @tiptap/suggestion @tiptap/extension-mention @tiptap/extension-task-list @tiptap/extension-table @tiptap/extension-drag-handle @tiptap/extension-placeholder @tiptap/extension-link @tiptap/extension-bubble-menu @tiptap/extension-code-block-lowlight lowlight`, all 3.31.4 except lowlight); dev: `drizzle-kit@0.31.11 vitest@5.0.3 tsx@4.23.15 @types/better-sqlite3@9.6.0 @modelcontextprotocol/client@2.3.1`. Recharts and Playwright are added at P9 and P11 with pinned versions. Remove `@milkdown/crepe`, `@heroicons/react`, `@stylexjs/stylex`, `lucide-react`, `src/themes/neutral/`; `@milkdown/kit` and `@milkdown/react` go in P6.
3. `drizzle.config.ts`, `vitest.config.ts` (node environment, `@/` alias), eslint `no-restricted-imports` boundary rule.
4. `scripts/check-licenses.ts` + `licenses.exceptions.json` (U6): allowlist `MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0, Zlib`; anything else or missing fails unless listed with a reason.
5. npm scripts: `check`, `test`, `db:generate`, `db:migrate`, `db:seed`, `db:fts-rebuild`, `db:backup`, `mcp:stdio`, `automations`, `import:handbook`, `dev` = `next dev -H 127.0.0.1`.
6. `.mcp.json`: `tessera` stdio entry with `cwd` = repo root and an absolute `TESSERA_DB_PATH`.
7. `docs/contracts/{schema,service-api,tools,ai,OWNERS}.md`, `docs/PLAN-STATUS.md`, `THIRD_PARTY_NOTICES.md`.

## 12. Verification

**Unit (Vitest, in-memory SQLite with all migrations)**: one file per domain module covering every invariant in §2; `registry` (one-to-one tool coverage), `changes` (monotonic cursor, actor exclusion), `search` (FTS after all migrations), `concurrency` (two handles on a temp file), `notifications` (never to the causing actor), `intake-policy`, `automations` (idempotent hourly run), `editor/markdown-roundtrip` (AI-written corpus: headings, nested and task lists, tables, code fences, `work:` / `page:` links, raw HTML; idempotent after one cycle, never drops content), `import-handbook` (the 12 files become a page tree with intact links).

**Integration**: MCP through `InMemoryTransport` + `@modelcontextprotocol/client`; stdio process against a temp DB asserting both processes report the same `PRAGMA database_list` file; AI adapter: `propose_*` never writes, `applyProposals` writes as `assistant`; webhook delivery retry.

**Browser (in-app browser through P10; Playwright suite in P11)**
1. Create project `WEB` → sidebar shows it with counts.
2. Create work item → bottom of Backlog, key `WEB-1`.
3. Drag to In Progress → counts update; reload keeps it.
4. Set priority High and a due date in the peek → reload keeps both.
5. Type in the description, reload within 200 ms → text persisted.
6. From the stdio MCP, change the item's state → open tab refreshes within 5 s; a dirty editor shows the Banner instead.
7. (P6) Create a wiki page, embed `WEB-1` with `#`, reload → embed resolves and the work item shows "Mentioned in".
8. (P7) Subscribe to `WEB-1`, let an MCP client comment → inbox badge increments; open inbox, mark read.
9. (P8) With agent intake required, MCP creates an item → it appears in Intake, not in the board; Accept moves it to Backlog.
10. (P10) Drag a gantt bar edge → both dates change; a `blocked_by` connector turns red when dates conflict.

**Static**: `next build` with no blocking-route insight; `check-conventions.ts` and `check-licenses.ts` clean; `grep -r ANTHROPIC .next/static` empty; from P6 `grep -r milkdown src` empty.

## 13. Deviations, risks, open items

**Deviations from Plane (reason)**
- Single implicit workspace, actors instead of members (single-user, AI-first).
- Many modules per work item kept as in Plane; the first brief's "one module" is dropped.
- Workspace views table-only, four static views virtual (as Plane).
- Attachments, publish-to-web, members, billing excluded (user decision).
- Known Plane quirks deliberately fixed: parent acyclicity enforced; completed-cycle edit guard applied; favourites deduplicated; `work_item_label` has a primary key.

**Risks**
| Risk | Mitigation |
|---|---|
| Two processes on one WAL file | `immediate()` transactions, `busy_timeout`, concurrency test, stdio refuses pending migrations, automations lease row |
| Agent-authored migration loses data | `VACUUM INTO` backup before any pending migration; lock file; only `db:migrate` and the Next server migrate |
| Scope size (27 lane-weeks) | Strict phase exits, vertical slice first, MCP from P1 so value is usable early, lanes in worktrees |
| Template port drifts into xstyle or heroicons | Convention script fails the merge |
| Astryx prop drift | *check* items verified against `dist/*.d.ts` on first use |
| AGPL contamination | Facts-only research; convention script flags Plane-specific identifiers; `THIRD_PARTY_NOTICES.md` lists the only third-party code (Astryx template, MIT) |
| Assistant spends money or acts wrongly | Loopback-only routes, status gate, proposals with Apply, confirm Dialog for destructive proposals, intake policy for agents |
| Tiptap normalises AI-written markdown | Round-trip corpus; Banner plus source view before any rewrite; custom nodes declare `renderMarkdown` |
| A future dependency brings a copyleft or attribution licence | `check-licenses.ts` in `npm run check` with an explicit exceptions file |
| Handbook import loses structure | Importer test on the 12 real files; old routes stay until the import is verified |

**Open items resolved by me (change if you disagree)**: filter state in the URL is one base64url JSON `q=` param; peek width 480 px, resizable 360–720 px, remembered per viewer; Home at `/home` until P6, then `/`; Recharts for charts; Playwright only from P11; webhooks optional and last in P10.
