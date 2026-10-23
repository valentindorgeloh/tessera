# As-built map: the engine

State described: the working tree after fix round 5, 2026-10-23 (HEAD `66c02f8` plus uncommitted lane work; migration 0013 is committed). Round 5 changed only `work-items/create.ts` (209 lines) and `intake.ts` (421): initial assignees now go through `syncAssignees` (section 7). Line counts are tree counts. The domain modules of P4 to P11 are mapped in the newer as-built files (section 2.2 points to them); this file covers the foundations, the tool registry and its adapters, the scripts, the actions and the API routes. Written for a reworking agent: read this first, then open only the contract section you need (section 8).

## 1. Purpose and boundaries

The engine is Tessera's whole domain layer: a TypeScript service over one SQLite file (better-sqlite3 13, WAL, Drizzle) that holds projects, states, labels, work items, cycles, modules, views and the activity log. Every operation is a service function that validates its zod input, runs in one `BEGIN IMMEDIATE` transaction, writes activity and FTS rows in that transaction, and returns a fresh view model. One tool registry (192 tools: 137 mutating, 37 in the `core` set, 9 `userOnly`) is the only list of operations. Three adapters call it: Server Actions (UI), MCP over HTTP and stdio (agents) and the Anthropic adapter (the assistant, ai.md). All callers pass the same `TesseraContext` (db, sqlite, actor, now, today).

In scope: `src/lib/tessera/**`, `drizzle/`, `scripts/**`, `src/app/actions/**`, `src/app/api/**`.

Lives elsewhere:
- UI (`src/components/**`, `src/app/(tessera)/**`, `src/themes/**`): `docs/contracts/ui.md`. Components never import the engine, except `types`, `schemas` and `core/{keys,time,group}`.
- Editor and description CAS client: `docs/contracts/editor.md`. The AI layer (`src/lib/tessera/ai/`, `tools/anthropic.ts`): ai.md.
- The legacy handbook (`src/lib/workspace`, `(handbook)/`, the `list_items`/`get_item` MCP tools) is removed; `api/mcp/route.ts` is Tessera-only. `scripts/import-handbook.ts` still reads handbook markdown into wiki pages.
- Everything the older version of this file listed as not built exists now: pages, relations, comments, reactions, mentions, notifications (pages-collaboration.md), drafts, intake, estimates, bulk (planning-extras.md), favourites, stickies, home, analytics, quick links, workspace settings (workspace.md), automations, exports, webhooks (operations.md), maintenance, backups, paging (hardening.md). Recents are client-side only (shell-detail.md); there is no server recents service.

## 2. File map

### 2.1 Foundations (`src/lib/tessera/`)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `types.ts` (581), `schemas.ts` (594) | Client-safe enums, zod schemas, row types. One source of truth for enums (decision 5), filters, display, progress shapes. | `StateGroupSchema`, `PrioritySchema`, `FiltersSchema`, `RichFiltersSchema`, `DisplaySchema`, `CycleProgressSchema`, `IdSchema`, `ProjectIdentifierSchema`, `NotificationKindSchema`, `NOTIFICATION_KIND_RANK`, `COALESCE_WINDOW_MS`, `TrackerErrorCode`, `*Row`/`*Insert` types |
| `core/keys.ts`, `core/time.ts`, `core/group.ts` | Client-safe pure helpers. | `formatKey`, `parseKey`, `normalizeIdentifier`, `nameKey`; `nowIso`, `todayLocal`, `addDays`, `daysBetween`, `compareDates`; `GROUPABLE_FIELDS`, `MULTI_VALUED_GROUP_FIELDS`, `parseOrderBy`, `PRIORITY_RANK` |
| `core/ids.ts`, `core/order.ts` | UUIDv7 ids; fractional-index sort keys (decisions 2, 4). | `newId`, `isId`; `firstSortOrder`, `sortOrderAfter`, `sortOrderBefore`, `sortOrderBetween`, `lastSortOrder`, `sortOrderForMove` |
| `core/errors.ts` | The seven error codes and zod/SQLite mapping. | `TrackerError`, `notFound`, `validation`, `conflict`, `rule`, `archived`, `locked`, `busy`, `validateInput`, `fromSqliteError`, `isTrackerError` |
| `core/context.ts`, `core/tx.ts` | Per-call context and transactions. | `createContext`, `withActor`, `TesseraContext`; `withTx`, `assertInTransaction` |
| `db/schema/` (`core` 350, `planning` 105, `pages` 75, `collaboration` 128, `workspace` 71, `ai` 70, `hardening` 90, plus `columns.ts` and `index.ts`; 45 `sqliteTable` calls; the old single `db/schema.ts` is gone) | The Drizzle tables, P1 to P11 (`notification` gained `event_count` and `sort_at` in 0012), plus `schema` and `TesseraSchema`. The only file that imports `drizzle-zod`. | `project`, `state`, `label`, `work_item`, `work_item_label`, `work_item_module`, `work_item_assignee`, `work_item_subscriber`, `cycle`, `moduleTable`, `module_member`, `module_link`, `work_item_link`, `view`, `view_settings`, `activity`, `actor`, `intake`, `intake_item`, `estimate`, `estimate_point`, `page*`, `comment*`, `notification`, ... |
| `db/client.ts` (114) | Opens the file, applies pragmas (`busy_timeout=5000` first, then `journal_mode=WAL` (`enableWal` retries SQLITE_BUSY for 5 s, because several processes can open a fresh file together), `synchronous=NORMAL`, `foreign_keys=ON`), runs migrate under the lock, FTS setup, system actors and `ensureWorkspaceSettings` (insert-or-ignore, so processes opening a fresh file together seed one row each). Resolves the path from the module location, never from `cwd` (decision 17). | `openDatabase`, `getDb` (process singleton), `closeDb`, `resolveDbPath`, `DEFAULT_DB_PATH`, `MEMORY_DB`, `DbHandles` |
| `db/migrate.ts` (150), `db/backups.ts` | Drizzle migrator with a lock file and a pre-migration backup (the backup code is in `db/backups.ts`, hardening.md). | `migrate`, `migrateIfNeeded`, `pendingMigrations`, `acquireLock`, `REPO_ROOT`, `MIGRATIONS_DIR` |
| `db/fts.ts` | Standalone FTS5 tables, written by the service, no triggers (decision 25). | `ensureFtsTables`, `upsertWorkItemFts`, `deleteWorkItemFts`, `upsertPageFts`, `deletePageFts`, `rebuildFts`, `buildMatchExpression`, `searchWorkItemIds`, `searchPageIds` |
| `drizzle/` | Fourteen migrations: `0000_init` (all tables), `0001_fts` (FTS5), `0002` (P5 `ai_proposal`, `ai_digest`), `0003` to `0007` (P8 `actor.access` and planning indexes, `last_seen_seq`, `automation_lease` run columns, export and version indexes, webhook columns), `0008_hardening`, `0009_week_start`, `0010_cycle_scope_idx`, `0011_workspace_list_idx`, `0012_notification_coalesce` (`event_count`, `sort_at`, `notification_inbox_idx`, `notification_coalesce_idx`), `0013_notification_kind_count` (`kind_count`, default 1, no backfill). Migrations are hand-written SQL plus a `meta/_journal.json` entry (read at runtime, must ship) and a snapshot; never run `drizzle-kit generate` in the checkout (field guide). | |

### 2.2 Domain modules (`src/lib/tessera/`)

| Path (lines) | Responsibility | Key exports |
|---|---|---|
| `activity.ts` | Append-only log; `seq` is the global change cursor (decision 24). | `logActivity`, `diffFields`, `latestSeq`, `ActivityEntrySchema`, `ACTIVITY_VERBS` |
| `changes.ts` | Cursor feed and per-item/project history with read-time collapse of description edits. | `listChanges`, `listActivity`, `collapseDescriptionEdits`, `ListChangesInput`, `ListActivityInput` |
| `actors.ts`, `assignees.ts` | Actors (`user`, `assistant`, `system`, `mcp:<name>`), assignee replace and subscriptions (decision 8). | `USER_ACTOR_ID`, `ASSISTANT_ACTOR_ID`, `SYSTEM_ACTOR_ID`, `ensureSystemActors`, `registerActor`, `updateActor`, `touchActor`, `listActors`; `setAssignees`, `subscribe`, `unsubscribe` |
| `projects.ts` (600) | Projects, features toggles, archive, cascading soft delete, default Intake. | `createProject`, `updateProject`, `updateProjectFeatures`, `archiveProject`, `unarchiveProject`, `deleteProject`, `listProjects`, `getProject`, `getProjectRow` |
| `states.ts`, `labels.ts` | State groups, default and triage states; labels one level deep, with view-filter stripping on delete. | `seedProjectStates`, `ensureTriageState`, `createState`, `setDefaultState`, `deleteState`, `reorderState`; `createLabel`, `deleteLabel`, `reorderLabel` |
| `work-items/` | The biggest domain, a folder to stay under the budget. `index.ts` re-exports; `model.ts` (329) holds loaders, resolvers and guards; `create.ts` (sequence, intake, initial assignees through `syncAssignees`, mention sync; fix round 5, decisions 50 and 51), `read.ts` (get, list, children), `paging.ts` (hardening.md), `hydrate.ts` (row to `WorkItem`), `update.ts` (patch, description CAS and mention sync), `membership.ts` (labels, modules, subscribers sync), `lifecycle.ts` (archive, unarchive, delete), `move.ts` (drag/group move), `moved-keys.ts`, `transfer.ts`, `bulk.ts`, `bulk-transfer.ts` (planning-extras.md), `timeline.ts` (operations.md), `versions.ts` (pages-collaboration.md), `undo.ts` (hardening.md). | `createWorkItem`, `updateWorkItem`, `bulkUpdateWorkItems`, `updateWorkItemDescription`, `moveWorkItem`, `copyWorkItem`, `moveWorkItemToProject`, `setLabels`, `setModules`, `archiveWorkItem`, `deleteWorkItem`, `getWorkItem`, `getWorkItemByKey`, `listWorkItems`, `listChildren`, `loadWritableWorkItem`, `loadWritableProject`, `WorkItem`, `WorkItemDetail`, `ListResult` |
| `links.ts`, `module-links.ts` | One link table for work items and modules (http(s) only). | `addLink`, `updateLink`, `removeLink`, `listLinks`, `countLinks`, `isHttpUrl`; `addModuleLink`, `updateModuleLink`, `removeModuleLink` |
| `cycles.ts` (871, ratcheted), `cycle-dates.ts` | Cycles, derived status, overlap rule, progress, snapshots, transfer (decision 16). | `deriveCycleStatus`, `createCycle`, `updateCycle`, `archiveCycle`, `unarchiveCycle`, `deleteCycle`, `addWorkItemsToCycle`, `removeWorkItemsFromCycle`, `transferCycleWorkItems`, `getCycleProgress`, `getActiveCycles`, `listCycles`, `getCycle`; `checkDates`, `assertNoOverlap` |
| `modules.ts` (694, ratcheted) | Modules, members, membership, progress. | `createModule`, `updateModule`, `archiveModule`, `unarchiveModule`, `deleteModule`, `addWorkItemsToModule`, `removeWorkItemsFromModule`, `setModuleMembers`, `getModuleProgress`, `listModules`, `getModule`, `ARCHIVABLE_MODULE_STATUSES` |
| `views.ts`, `view-settings.ts` | Saved views (project and workspace) and remembered display settings (decisions 20, 23). | `createView`, `updateView`, `duplicateView`, `lockView`, `unlockView`, `deleteView`, `listViews`, `getView`; `getViewSettings`, `saveViewSettings`, `resetViewSettings`, `mergeDisplay`, `mergeFilters`, `DisplayPatchSchema`, `WORKSPACE_SCOPE_ID` |
| `filters.ts` (545), `rich-filters.ts`, `rich-filter-spec.ts` | Turns `Filters`/`RichFilters`/`Display` into Drizzle `where`, `order by` and groups. | `buildWhere`, `buildOrder`, `groupItems`, `resolveDateFilter`, `relativeDate`, `NONE_GROUP_ID` |
| `counts.ts` (383) | The one counting function (decision 21). | `getCounts`, `GetCountsInput`, `CountsScopeSchema`, `Counts` |
| `search.ts` | Cross-entity search: FTS for items/pages, `LIKE` on name for projects, cycles, modules. | `searchAll`, `SearchAllInput`, `SEARCH_TYPES`, `SearchHit` |
| `seed.ts` (387) | Demo project WEB, idempotent, built only from service calls. | `seedDemo`, `DEMO_PROJECT` |
| Later domains | Pages (`pages/`), `comments.ts`, `relations.ts`, `reactions.ts`, `mentions.ts`, `notifications.ts`, `history.ts`: pages-collaboration.md. `intake*.ts`, `drafts.ts`, `estimates*.ts`: planning-extras.md. `workspace/`, `analytics/`, `projects-order.ts`, `static-views.ts`: workspace.md and views-settings.md. `automations/`, `exports/`, `webhooks/`: operations.md. `maintenance/`, `db/backups.ts`, `seed-perf.ts`: hardening.md. `ai/`: ai.md. | |
| `index.ts` | Barrel for actions, routes, scripts and tests. Leaves out `db/client`, `db/migrate`, `tools/mcp`, and `ai/` (decision 34). | |
| `server.ts` | `import "server-only"`; the entry for Server Components. | `readTessera`, `writeTessera`, `getDb`, `closeDb`, plus the barrel |

### 2.3 Tools (`src/lib/tessera/tools/`)

| Path | Responsibility | Key exports |
|---|---|---|
| `define.ts` | The `ToolDef` shape. | `defineTool`, `TOOL_PHASES` (`P1,P3,P4..P11`; `core` is the assistant's default set, 37 tools), `ToolDef`, `Toolset` |
| `registry/index.ts` | Concatenates the per-domain arrays, builds the map (duplicate name throws), validates and runs. | `registry`, `getTool`, `listTools`, `runToolWithContext`, `ToolName`, `ToolInput<N>`, `ToolOutput<N>` |
| `registry/*.ts` (27 files) | The 192 tools, per domain: projects 10, states 6, labels 5, actors 3, work items 25 (also `list_children`, `list_activity`, `list_archived_work_items`, bulk, copy and move), links 3, cycles 13, modules 15, views 12, meta 4, pages 15, comments 6, relations 3, notifications 7, history 3, intake 9, drafts 6, estimates 5, workspace 22, analytics 1, automations 2, exports 4, webhooks 8, maintenance 5. `access.ts` holds `assertToolAllowed` (per-agent access and `userOnly`). | `projectTools`, `stateTools`, ... `maintenanceTools` |
| `registry/shared.ts` | Shared id inputs and result helpers. | `GetProjectInput` (the one string-or-id input), `EmptyInput`, `deleted`, `removed`, `toListResult` |
| `describe-filters.ts` | The self-describing filter/display payload for agents. | `describeFilters` |
| `mcp.ts` | MCP adapter. | `registerTesseraTools`, `createMcpActorResolver`, `mcpToolName`, `mcpInputSchema`, `MCP_TOOL_PREFIX` (`tessera_`), `CONFIRM_FIELD` |

### 2.4 Scripts, actions, API

| Path | Responsibility |
|---|---|
| `scripts/mcp-stdio.ts` | `npm run mcp:stdio -- [--db] [--migrate] [--init] [--toolset core\|all]`. Refuses pending migrations without `--migrate` (exit 2); usage errors exit 1; always logs the absolute DB path to stderr. Backs `.mcp.json`. |
| `scripts/mcp-call.ts` | `npx tsx scripts/mcp-call.ts <tool> '<json>'`: spawns the stdio server (no `--db`, no `--migrate`) as client `p3-acceptance` (actor `mcp:p3-acceptance`) and prints one result. |
| `scripts/check-conventions.ts`, `convention-rules.ts`, `file-budget.json` | The convention gate and its pure rules (section 4). `file-budget.json` now lists only `cycles.ts` (871) and `modules.ts` (694). |
| `scripts/check-licenses.ts` + `licenses.exceptions.json` | Licence gate, decision U6; 7 reviewed exceptions. |
| `scripts/migrate.ts`, `db-seed.ts`, `db-backup.ts`, `db-restore.ts`, `fts-rebuild.ts` | `db:migrate`, `db:seed` (idempotent WEB demo), `db:backup` (kinded `VACUUM INTO`, rotated), `db:restore` (script only), `db:fts-rebuild` (refuses on pending migrations). |
| `scripts/automations.ts`, `import-handbook.ts`, `webhook-echo.ts` | `npm run automations` runs `runAutomations` once (`--dry-run`, `--project`, `--now`); `npm run import:handbook` reads handbook markdown into wiki pages as the user actor; `webhook-echo.ts` is a local receiver for webhook tries. `maintenance`, `perf-*` and `check-bundle` are in hardening.md. The hourly automation timer and the daily maintenance run start from `src/instrumentation.ts` (operations.md). |
| `src/app/actions/_run.ts` | `runTool` (the one Server Action: validate, open db, run as actor, then `refresh()` outside the try for mutating tools) and `toolAction(name)` (typed wrapper factory; wrong name fails at import). Result is `{ok,data,cursor}` or `{ok:false,code,message,details}`; unknown errors become `INTERNAL`. |
| `src/app/actions/*.ts` (26 files besides `_run.ts`) | File-level `"use server"` wrappers, one `toolAction` line each, one file per domain: projects, work-items, detail, cycles, modules, states-labels, views, pages, relations-comments, inbox, intake, drafts, estimates, home, favorites, stickies, quick-links, workspace-settings, settings, history, exports, webhooks, automations, maintenance, ai. `shell.ts` exports `refreshAction` (plain `refresh()`, also called by the poller). |
| `src/app/api/changes/route.ts` | `GET ?since=<seq>`: `listChanges` excluding the `user` actor plus `unread_notifications` (`getUnreadCount`, decision 59), so a snooze wake-up moves the badge without new activity; 400 on a bad cursor; `no-store`. Returns `{ changes, cursor, unread_notifications }`; `tests/changes-route.test.ts`. |
| `src/app/api/search/route.ts` | `GET ?q&scope&types&limit`: `searchAll`; 400 on bad input; `no-store`. |
| `src/app/api/mcp/route.ts` (32) | HTTP MCP via `mcp-handler`: `registerTesseraTools` only, with one actor resolver per process and `afterWrite: revalidatePath("/", "layout")`. |
| `src/app/api/{ai,exports,history,home}/**` | The AI routes (ai.md), export download, history read, `home/seen`; each guarded as its as-built file says. |
| `src/app/api/work-items/[workItemId]/description/route.ts` | POST beacon for `pagehide`: runs `update_work_item_description` as the user; same-origin and JSON-only; `if_current_md` rebase of an in-flight save; maps error codes to HTTP statuses. |
| `src/app/api/request-guards.ts` | `isSameOriginRequest`, `isJsonContentType`. |

## 3. Data and control flow

Read (UI): a page or layout under `<Suspense>` awaits `io()`, then `readTessera(ctx => listWorkItems(ctx, ...))`. `readTessera` (server.ts) builds a user context from `getDb()` and runs outside any transaction. List results carry `cursor = latestSeq(ctx)`; the client poller (`ChangesPoller`, UI area) then calls `GET /api/changes?since=cursor`.

Write (UI): client calls a wrapper such as `moveWorkItemAction(input)` (`actions/work-items.ts`) which is `runTool("move_work_item", input)`. `runTool`: `getTool` (NOT_FOUND) then `validateInput(def.input)` then `getDb()` then `createContext({actorId})` then `runToolWithContext` (validates again, runs `def.run`, adds `cursor`) then, for `mutates` tools, `refresh()`. The tool's `run` calls the service function, which: validates with its own `*Input` zod schema, `withTx(ctx, ...)` opens `BEGIN IMMEDIATE`, `loadWritableProject`/`loadWritableWorkItem` check archived state, rules throw `rule(...)`, the row is written, `logActivity` per changed field, FTS is updated, and the fresh view model is returned. `fromSqliteError` turns busy and unique errors into `BUSY` and `CONFLICT`.

Write (agent): MCP client calls `tessera_<tool>`. `callTool` (tools/mcp.ts) resolves the client name from the handshake, `createMcpActorResolver` registers/touches `mcp:<name>`, a destructive tool without `confirm: true` returns `VALIDATION` and writes nothing, then the same `runToolWithContext` runs as that actor. `afterWrite` fires after every successful mutating tool (HTTP: `revalidatePath`). A `create_work_item` that lands in Intake (decision 27) gets a note prefixed to the result text (`hasPendingIntake`).

Notifications and mentions: `logActivity` calls `notifyFromActivity` inside the same transaction, so a row and its notifications commit together (decisions 50, 51; details in pages-collaboration.md). A body save (work item description, comment, page) also runs `syncMentions` (`mentions.ts`, decision 53), which logs a `mention` activity row per added actor.

Description autosave: Server Action path (`updateWorkItemDescriptionAction`) or, on `pagehide`, the beacon route. Both run `update_work_item_description` with compare-and-set on `description_version` (decision 10).

Cross-process: the Next server and the stdio server are separate processes on one file; `busy_timeout=5000` serialises writers, longer waits give `BUSY`. External writes reach open pages only through `/api/changes` (activity rows from non-user actors), which also carries the unread count.

Boot: `getDb()` -> `migrateIfNeeded(file)` (lock file `<db>.migrate.lock`, waits 30 s; `VACUUM INTO data/backups/tessera-<iso>.db` first when migrations are pending, keep 10) -> `openDatabase` (pragmas, `migrate`, `ensureFtsTables`, `ensureSystemActors`).

## 4. Invariants and rules the code enforces

Decision numbers are from `docs/PLAN.md` "Resolved design decisions" (U1 to U9 are the user-confirmed rows). All `RULE` names are asserted by tests. Full rule lists: `docs/contracts/schema.md` "Invariants".

| Rule | Decision | Enforcer |
|---|---|---|
| Ids are UUIDv7; keys `<IDENT>-<n>` computed, never stored; sequence allocated in the insert transaction, never reused | 2, 3 | `core/ids.newId`; `work-items/create.allocateSequence`; `core/keys`; `tests/work-items.test.ts`, `tests/projects.test.ts` |
| Identifier `^[A-Z][A-Z0-9]{1,11}$`, unique among live projects | 3 | `ProjectIdentifierSchema`; `projects.createProject`/`updateProject`; unique index (partial) |
| Fractional-index `sort_order`; a drop rewrites one row; reorder neighbours must be adjacent and live | 4 | `core/order.sortOrderForMove`; `reorder*`; `work-items/move.moveWorkItem` |
| Enums live in zod, not SQL CHECK | 5 | `schemas.ts`; `tests/foundation.test.ts` |
| Soft delete + partial unique indexes + `name_key` for case-insensitive names | 7 | `db/schema.ts` indexes; `core/keys.nameKey`; each `delete*` function |
| Actors are members; MCP clients become `mcp:<name>` | 8 | `actors.ensureSystemActors`, `tools/mcp.createMcpActorResolver`; `tests/mcp.test.ts` |
| One cycle per item, many modules/labels/assignees | 9 | `work-items/membership.syncModules`/`syncLabels`/`syncAssignees`; `cycle_id` column |
| Description CAS on `description_version`; property writes never bump it | 10 | `work-items/update.updateWorkItemDescription`; `tests/work-items.test.ts`; `tests/editor/description-route.test.ts` |
| Paths resolve from the module location, never `process.cwd()`; env vars `TESSERA_DB_PATH` etc. | 17 | `db/client.resolveDbPath`; gate rule `no-cwd-in-engine` |
| Cycles: both dates or none, start <= end, no overlap among non-archived, archive only after end, completed = read-only (`LOCKED`), transfer freezes `progress_snapshot` | 16 | `cycle-dates.checkDates`, `assertNoOverlap`; `cycles.deriveCycleStatus`, `assertNotCompleted`, `archiveCycle` (`cycle_not_ended`), `transferCycleWorkItems` (`cycle_not_completed`, `cycle_project_mismatch`), `freezeSnapshot`; `tests/cycles.test.ts` |
| Workspace views are table-only; views are `filters` + `display` JSON; locked views reject all but unlock | 20 | `views.createView`/`updateView`/`lockView`; rule `not_locked`; `tests/views.test.ts` |
| All counts come from `getCounts`; population excludes deleted, archived and triage | 21 | `counts.getCounts`; `tests/counts.test.ts` |
| Colours are palette keys, never hex | 22 | `PaletteColorSchema`; gate rule `hex-colour` |
| View settings per scope, merged key by key; reset deletes the row | 23 | `view-settings.saveViewSettings`/`resetViewSettings`/`mergeFilters`; `tests/view-settings.test.ts` |
| Every mutation writes activity inside its transaction; `seq` is the cursor; description edits collapse at read time (5 min per actor) | 24 | `activity.logActivity`; `changes.collapseDescriptionEdits`; `tests/changes.test.ts` |
| FTS rows written in the same transaction, no triggers; `filters.search` capped at 100 000 ids | 25 | `db/fts.upsertWorkItemFts`; `tests/fts.test.ts` |
| Registry is the single list of operations; a Vitest binds every mutating export to exactly one tool | 26 | `tools/registry/index.ts`; `tests/registry.test.ts` ("service coverage") |
| Agent creates/copies/moves land in Intake (triage) when `intake_enabled` and `agent_intake_required`; pending items cannot leave triage or move projects | 27 | `work-items/create.intakeRequired`, `recordIntakeItem`; `update.ts`/`transfer.ts` rule `intake_pending`; `tests/work-items.test.ts` ("intake policy") |
| Engine is TypeScript; one process per host; second process serialised by `busy_timeout` | U1 | `db/client.openDatabase`; `tests/concurrency.test.ts` |
| Licences: no copyleft or attribution-in-product | U6 | `scripts/check-licenses.ts` |
| Archived project: every mutation of its states, labels, cycles, modules, views, items is `ARCHIVED`; only unarchive and delete pass | schema.md | `loadWritableProject` (work-items/model.ts, cycles.ts); per-module tests "archived project" |
| Triage state is reserved: no direct create/update into it, never default, never deletable | schema.md | `model.assertNotTriage`; `states.setDefaultState`/`deleteState` (`triage_default`, `triage_state`) |
| Parent in same project, not self, acyclic | schema.md | `model.resolveParent` (`parent_project`, `parent_self`, `parent_cycle`) |
| Archive an item only when completed or cancelled; `completed_at` follows the group | schema.md | `lifecycle.archiveWorkItem` (`archive_open_item`); `model.nextCompletedAt` |
| Labels one level deep; delete strips ids from view filters and `view_settings` | schema.md | `labels.ts` (`label_depth`, `label_has_children`, `stripLabelsFromFilters`) |
| Destructive MCP tools need `confirm: true` | tools.md | `tools/mcp.callTool`; `tests/mcp.test.ts` |
| Convention gate: client-boundary, component-boundary, ai-boundary, server-only, forbidden-package, hex-colour, drizzle-zod, plane-marker, no-router-refresh, no-cwd-in-engine, decision-ref, file-budget, css-token | plan 10 | `scripts/check-conventions.ts`, `convention-rules.ts`; `tests/convention-rules.test.ts` |
| A notification merges into the recipient's newest unread row for the same item and actor within 10 minutes; snooze and archive rules; mentions are links synced on every body save | 51, 52, 53 | `notifications.ts`, `mentions.ts`; `tests/notifications.test.ts`, `tests/mentions.test.ts` (pages-collaboration.md) |
| `/api/changes` returns the unread count | 59 | `api/changes/route.ts`; `tests/changes-route.test.ts` |

Import boundary (eslint regex patterns in `eslint.config.mjs` plus the gate): `'use client'` files import `types`, `schemas`, `core/{keys,time,group}` only. Server Components import `@/lib/tessera/server` and never `db*`, `better-sqlite3`, `drizzle-orm`. Actions and route handlers may import engine modules directly. Only `server.ts` imports `server-only`. Scripts and tests use the barrel plus `db/client`, `db/migrate`, `tools/mcp`.

## 5. Tests that guard this area (`tests/`, Vitest, `:memory:` databases)

| File | Covers |
|---|---|
| `helpers/db.ts` | `createTestDb`, `createTestContext`, `withTempFileDb`; applies every migration through `migrate()` |
| `helpers/second-writer.ts`, `concurrency.test.ts` | Two handles and a second process on one file; `BUSY` |
| `foundation.test.ts` | Migrations, pragmas, system actors, context, `withTx`, errors, sort order, keys |
| `projects.test.ts`, `states.test.ts`, `labels.test.ts` | Project identifier/name rules, features, archive, cascade delete; state default/triage/delete rules; label depth and delete |
| `work-items.test.ts` (1519 lines) | Create, intake policy, get/list, update, description CAS, move, bulk, copy, move to project, archive, delete |
| `cycles.test.ts`, `modules.test.ts` | Cycle dates, status, overlap, lock, transfer, snapshot, progress; module status, membership, progress |
| `links.test.ts`, `views.test.ts`, `view-settings.test.ts` | Links and archived parents; view CRUD, lock, duplicate; settings merge/reset |
| `filters.test.ts`, `counts.test.ts`, `search.test.ts`, `fts.test.ts` | Where/order/group builders; count population; `searchAll`; FTS after migration, rebuild and hostile queries |
| `changes.test.ts`, `seed.test.ts` | Cursor feed and activity collapse; demo seed |
| `registry.test.ts` | Service coverage, strict inputs, names, flags, phases, `describe_filters`, `runToolWithContext`, action runner |
| `mcp.test.ts`, `mcp-stdio.test.ts` | Adapter listing, `confirm`, error mapping, actor registration; stdio flags and exit codes |
| `convention-rules.test.ts` | Decision-ref parsing and the file-budget ratchet |
| `editor/description-route.test.ts` | Beacon route, same-origin and JSON guards |
| `changes-route.test.ts`, `first-open-race.test.ts` | The `/api/changes` payload; several processes opening one fresh file |

The tests of later domains are listed in the as-built file of their area (about 67 entries under `tests/`, plus `tests/ui/` and `tests/e2e/`).

Gate: `npm run check` = typecheck, lint, vitest, `check:conventions`, `check:licenses`, `check:theme`. `check:bundle` and the Playwright suite (`check:e2e`) are separate (hardening.md). Vitest fails fast on Node-API < 10.

## 6. Extension points for later phases

- New tool: add a `defineTool` in the domain's `tools/registry/<domain>.ts`, append the array in `registry/index.ts` `TOOLS`, set `phase` from `TOOL_PHASES`, then add `export const xAction = toolAction("x")` in `src/app/actions/<domain>.ts`. `registry.test.ts` then demands one tool per mutating service export, strict inputs with descriptions, and the destructive/core flags.
- New service module: add to `src/lib/tessera/index.ts`; keep each file under 600 lines (split like `work-items/`).
- New table or column: edit the file under `db/schema/`, hand-write `drizzle/NNNN_name.sql` and its `_journal.json` entry, generate the snapshot in a scratch copy only (field guide; the re-run must say "No schema changes"), then `db:fts-rebuild` if `work_item` or `page` is recreated.
- Anthropic adapter (P5, built; see ai.md): `tools/anthropic.ts` with `previewTool`, `propose_*` stubs and `applyProposals` as actor `ASSISTANT_ACTOR_ID`; read tools come from `listTools({ toolset: "core" })` (the `core` flag marks the 37 default tools).
- P4 hooks: project settings go through `update_project` / `update_project_features` (no separate settings tools); `getCounts` scopes `workspace|project|cycle|module|view|profile`; `groupItems` plus `MULTI_VALUED_GROUP_FIELDS` for multi-valued and sub-grouping; `saveViewSettings`/`resetViewSettings`; stripping of deleted state, label, cycle and module ids from view filters (`saved-filters.ts`, built); refusing cycle/module tools while the feature toggle is off (ui.md row 23).
- Later domains (pages, relations, comments, notifications, drafts, intake, estimates, home, analytics, versions, automations, exports, webhooks) are built; signatures are in `service-api.md` "Later phases" and the map of each is in its own as-built file.
- `registerTesseraTools({ handles, toolset, actorResolver, afterWrite, fallbackClientName })` is how any new transport reuses the registry.

## 7. Known debt and quirks

File budget (`scripts/file-budget.json`): only `cycles.ts` (871) and `modules.ts` (694) are ratcheted; both may only shrink. `db/schema.ts` and `work-items.ts` were split into folders and left the list. `projects.ts` is exactly 600 lines and `schemas.ts` 594, so the next addition to either needs a split first.

From the contracts and `docs/PLAN-STATUS.md` (P1 open items, P3 notes):
- Deleting a state, label, cycle or module strips its id from saved views (`saved-filters.ts`). `filters.ts` still tolerates unknown ids.
- Intake, drafts, estimates and bulk are built (planning-extras.md).
- Notification wording (decision 51): `event_count` is every merged event, `kind_count` those of the row's current kind (migration 0013, no backfill, so an older merged row reads "+M more"). The row reads "commented 2 times · +1 more" (pages-collaboration.md).
- Initial assignees (fix round 5, decisions 50 and 51): `createWorkItem` and `createIntakeItem` call `insertWorkItem` with `assignee_ids: []` and then `syncAssignees(ctx, { item, project }, assigneeIds)`, so the assignment is logged like a later `setAssignees` and notified (`assigned`, one row per recipient; a self-assignment, the assistant as actor and the user creating an item for an agent notify nobody, per decision 50). This covers explicit `assignee_ids` and the project `default_assignee_id` for every caller of `createWorkItem` (create dialog, quick add, MCP, assistant Apply, drafts Move to project). The call runs before `recordIntakeItem` / `syncMentions`, so a row coalesced with a mention keeps the mention's snippet. Side effects: webhooks now emit `work_item.added` for create-time assignees, and a Home Since row for an agent create with assignees reads "created … (1 more change)". `transfer.ts` copy and move-to-project still call `insertWorkItem` with assignees and stay silent (`copied` is a silent verb); intake Accept sets a state through `applyPatch` and creates nothing. `createIntakeItem` still does not call `syncMentions`. `seedDemo` runs as the user, so the seeded inbox stays empty; `seed-perf` writes rows for agents. Tests: `tests/notifications.test.ts` ("assignees set at create time", 6), `tests/intake.test.ts` ("createIntakeItem assignees", 3), `tests/mentions.test.ts`, `tests/work-items.test.ts`.
- FTS inside list queries is capped at 100 000 ids (P11).
- A migration lock file left by a crash is not detected; remove `<db>.migrate.lock` by hand (P11).
- `ModuleProgress` has no zod schema (type only). `WorkItemDetail.relations` exists since P7.
- Cycles, modules and projects are searched with `LIKE` on name (projects also on identifier).
- `get_project.project_id` and the view-settings `scope_id` are plain strings, not UUIDs; their descriptions must keep saying so (decision D20, registry test allowlist).
- `Cycle`/`CycleDetail` spread the whole `CycleRow`, so the raw `progress_snapshot` (including `completion_chart_points`) is visible in `list_cycles`, `get_cycle` and the project bundle. Clients treat a cycle as frozen when `progress_snapshot !== null`.
- Cycle progress counts archived items; `getCounts` and module progress do not (intentional). No scope-per-day series for burnup (P9 analytics).
- `work_item_version` rows and the 5-minute collapse exist since P10 (`history.ts`; see pages-collaboration.md); the `draft` list scope reads drafts since P8.
- The cycle/module feature toggle hides UI only; the engine still accepts cycle and module tools while a toggle is off.
- `server-only` is not an installed package on purpose (Next aliases it; tsc does not check it).
- `api/mcp/route.ts` (33 lines) registers Tessera's tools only, through `registerTesseraTools` with an actor resolver per client name; the legacy handbook tools are gone.
- `src/app/actions/_run.ts` puts `"use server"` inside `runTool`, not at file level; client code must never import `_run.ts`.
- Stdio server refuses pending migrations unless `--migrate`; `mcp-call.ts` never migrates and always names the client `p3-acceptance`.
- Tolerated gate noise: `astryx doctor` always shows one `theme-fonts` warning. The three lint warnings that used to come from `src/app/page-body.tsx` are gone with that file.
- Module map in `service-api.md` still lists `work-items.ts`; the code is the folder `work-items/` (barrel `work-items/index.ts`).

## 8. Where to read more

| Topic | File and heading |
|---|---|
| Decisions 1 to 28, U1 to U9 | `docs/PLAN.md` "Resolved design decisions"; engine map "3. Engine module map"; ADR-001 |
| Conventions, tables by phase, all invariants, migrations, env | `docs/contracts/schema.md`: "Conventions", "Tables", "Invariants (service layer...)", "Migrations and database file", "Environment" |
| Context, errors, transactions, module map, import boundary, signatures | `docs/contracts/service-api.md`: "Context, errors, transactions", "Module map", "Import boundary", "Common shapes", "Signatures" |
| Activity, counts, filters | `service-api.md`: "Activity, notifications, versions", "Counts", "Filters and display" |
| P3 progress, points and snapshot rules | `service-api.md` "P3 additions (lane A)"; `tools.md` "P3 changes" |
| ToolDef, tool list by domain, adapters, registry test | `docs/contracts/tools.md`: "ToolDef", "Tools by domain", "Adapters" (MCP, Server Actions, Anthropic), "Registry test" |
| Later phases | The as-built file of the area (README.md); `docs/PLAN-STATUS.md` hand-off notes |
| Process and gates | `docs/process/swarm.md`; `docs/field-guide/index.md`; `docs/contracts/OWNERS.md` |
| Status and open items | `docs/PLAN-STATUS.md` hand-off notes "P1" and "P3" |
