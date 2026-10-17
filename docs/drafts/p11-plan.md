## P11: Hardening (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `f966e3e`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md)
and the P5–P10 plans (docs/drafts/p5-plan.md … p10-plan.md) are delivered:
- `db/schema/` is a folder (P5 lane 0); migrations `0002_ai` … `0007_operations`
  exist, so P11's migration is `0008_hardening`;
- the registry is a folder (`tools/registry/<domain>.ts`, `TOOLS` in
  `registry/index.ts`); work items are a folder (`work-items/*.ts`);
- decisions 29–108 are in docs/PLAN.md;
- P5: `ai_proposal` (status `pending → applying → applied | failed | discarded`,
  `seq_from` / `seq_to` per applied proposal, decision 33), `applyProposals` as actor
  `assistant`, `AssistantPanel`, `ProposalList`, `ConfirmApplyDialog`, GET
  `/api/ai/proposals`, a fake model client used by Vitest;
- P7: `notification` rows; P8: `ToolDef.selfScoped`, access checks in
  `runToolWithContext`; P9: `/settings/general`, `/settings/ai`, `workspace_settings`
  helpers; P10: `src/instrumentation.ts` + `automations/scheduler.ts`
  (`startScheduler`, globalThis guard, unref()ed timers), `automation_lease` rows by
  id with `last_run_at` / `last_summary`, `ctx.activityNote`, `ToolDef.userOnly`
  (decision 104), `work-items/versions.ts`, exports under `<db dir>/exports`,
  `webhook_delivery` rows.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P11 contract right before the build. Items marked **refresh before build**
depend on code that P4–P10 have not written yet, or on numbers only the perf
database can give.

Sources: docs/PLAN.md §9 P11 row (scope: `"use cache"` + tags, Playwright acceptance
suite, backup rotation, performance pass on 10k items, undo last assistant action;
also group counts beyond the loaded page and list paging; exit: "`next build` with no
blocking-route insight; Playwright green; p95 list render < 300 ms on 10k items"),
§11 step 2 ("Playwright is added at P11 with a pinned version"), §12 (browser checks
1–10 become the Playwright suite; static checks), §13 risks (VACUUM INTO backup,
two processes on one WAL file). Next 16 guide
`node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md` Step 8 (cache
reusable reads with `'use cache'` + `cacheLife` + `cacheTag`; replace `refresh()` with
`updateTag` for the tags a write touched; dynamic reads keep `refresh()`), and
`03-api-reference/01-directives/use-cache.md` (in-memory LRU per server process,
`cacheMaxMemorySize`, client router minimum 30 s stale time). Deferrals inherited:
p4-ui.md line 68 (group counts beyond the loaded page, list paging), p5-plan.md lines
59–69 (undo, proposal history and purge, token usage, Playwright AI tests, static
bundle check), p7-plan.md lines 96, 100, 516 (comment FTS, undo of an assistant
comment, notification retention), p8-plan.md line 108 (keyboard range selection),
p9-plan.md line 126 (Home "Your work" charts), p10-plan.md lines 131–144 (timezone,
intake rich filters, archives layout switch, relations display property, cycle
timeline, drag-to-create, Playwright drag suite) and line 819 (gantt virtualisation).

What already exists (verified on `f966e3e`):
- `next.config.ts`: `cacheComponents: true`, `partialPrefetching: true`; no
  `cacheLife` profiles, no `cacheMaxMemorySize`. No `'use cache'` anywhere in `src/`.
- Reads: `readTessera(fn)` in `src/lib/tessera/server.ts` (user context, no
  transaction); pages call `await io()` (from `next/cache`) before reading, e.g.
  `projects/[projectId]/work-items/scoped-list.tsx:88`.
- Writes: `runTool` in `src/app/actions/_run.ts` runs a registry tool, returns
  `{ ok, data, cursor }` and calls `refresh()` after a mutating tool. External
  writes: `ChangesPoller` polls `GET /api/changes?since=` (`listChanges` without the
  user's rows) and calls `refreshAction()` (`src/app/actions/shell.ts`).
- `activity` (`seq` autoincrement = global cursor, `project_id`, `entity_type`,
  `entity_id`, `work_item_id`, `verb`, `field`, `old_value`, `new_value`,
  `comment`, `actor_id`; indexes `(project_id, seq)`, `(work_item_id, seq)`,
  `(actor_id, seq)`); `latestSeq(ctx)` in `activity.ts`.
- `listWorkItems` (`work-items/read.ts:214`): `limit` (1–5000) and `offset`;
  `total` is a full `count()`; `groups` come from `groupItems(ctx, items, display)`
  (`filters.ts`) over the loaded items only, so `Group.count` counts loaded rows
  (`Group = { field, id, name, color, count, item_ids, sub_groups? }`). The UI loads
  2000 rows (P4 cap). `hydrate.ts` batches label/assignee/module lists with chunked
  `IN` queries.
- Backups: `db/migrate.ts` has `backupDir` (`<db dir>/backups`), `backupDatabase`
  (`VACUUM INTO tessera-<ISO stamp>.db` on a second connection), `pruneBackups`
  (keeps the newest `BACKUP_KEEP` = 10 `tessera-*.db`), `migrateIfNeeded` (lock file,
  backup before pending migrations). `scripts/db-backup.ts` (`npm run db:backup`)
  backs up and prunes. Nothing schedules backups; there is no restore script.
- Dark mode is done: the Catppuccin theme ships Frappé (dark, default) and Latte
  (light) with a "Match system" option (`src/components/shell/color-scheme.ts`,
  `COLOR_SCHEME_STORAGE_KEY = "tessera.scheme.v1"`). P11 only adds a Playwright
  smoke check for both schemes.
- `vitest.config.mts` includes `tests/**/*.test.ts` and `src/**/*.test.ts`, so
  Playwright files named `*.spec.ts` under `tests/e2e/` are not picked up by Vitest.
- `~/Library/Caches/ms-playwright` already holds Chromium builds 1217, 1243 and 1248
  from other projects; the build needs the one matching the pinned version.
- Astryx 0.6.8: `Pagination` (`page`, `onChange`, `hasMore`, `totalItems`,
  `pageSize`), `useToast()` with `ToastOptions.endContent` (trailing slot for an
  Undo button), `isAutoHide`, `autoHideDuration`, `uniqueID`; `Banner` with
  `endContent`; `Button` `variant` / `size` / `isLoading` / `clickAction`; `Table`
  (no built-in virtualisation; `transformScrollWrapper` only). No virtual list
  component.
- `scripts/file-budget.json` lists `cycles.ts` (882), `db/schema.ts` (857; split by
  P5 lane 0) and `modules.ts` (694). P11 does not edit `cycles.ts` or `modules.ts`.

### 1. Scope and deferrals

In scope:
- **Cache Components with tags**: cached, revision-keyed reads for the project
  bundle, work item list pages, work item detail, cycles and modules (lists and
  detail), the sidebar, the page tree and analytics; `updateTag` after in-process
  writes; a `tessera` `cacheLife` profile; a cache-safety Vitest that proves every
  cached read is keyed on a revision every relevant write moves.
- **List paging and group counts beyond the loaded page**: per-group pages for list
  and board, row pages for ungrouped lists, table and gantt, "Show more" in every
  group, exact group counts from a narrow projection of the whole filtered set.
- **Performance pass on 10k items**: a deterministic perf seed, an engine bench,
  index additions proven by `EXPLAIN QUERY PLAN` tests, a Playwright perf spec
  (p95 list render < 300 ms).
- **Playwright acceptance suite** (`@playwright/test` pinned): §12 browser checks
  1–10 plus one spec per phase P4–P10, the drag suite (P10 deferral), AI specs on a
  recorded fake model (P5 deferral), a console-clean fixture, a two-scheme smoke
  spec.
- **Backup rotation**: scheduled daily backups with a 7 daily / 4 weekly / 12
  monthly rotation, kinds (auto, manual, migration, pre-restore), integrity check of
  each copy, a Backups settings page with "Back up now", `npm run db:restore`.
- **Undo last assistant action**: undo the latest applied assistant batch, with
  conflict detection, from a toast after Apply, from the assistant panel's History
  and from Power K.
- **Retention**: a daily maintenance job that purges old proposals (P5 deferral),
  old archived notifications (P7 deferral), delivered webhook deliveries and old
  export files.
- **Static bundle gate** (P5 deferral): `scripts/check-bundle.ts` after
  `next build`.
- **Dark mode**: done (Catppuccin theme). Covered by one Playwright smoke spec.

| Deferred | Phase | Note |
|---|---|---|
| Workspace timezone setting (P10 deferral) | Backlog after P11 | Touches every `todayLocal()` call site and every cache key that depends on "today"; the local install runs in the user's zone. Open question 9 |
| Comment search in Power K and comment FTS (P7 deferral) | Backlog after P11 | The perf pass measures FTS on items and pages only |
| Token usage and cost display (P5 deferral) | Backlog after P11 | `usage` stays a server log line |
| Rich filters on Intake; layout switch on Archives › Work items; relations display property; cycle timeline; drag-to-create bars (P10 deferrals) | Backlog after P11 | Features, not hardening |
| Keyboard range selection beyond shift+click (P8 deferral) | Backlog after P11 | |
| Home "Your work" charts beyond counts (P9 deferral) | Backlog after P11 | |
| Gantt row virtualisation (P10 risk) | not planned | Paging (decision 112) caps rendered rows at 200 per page; `content-visibility: auto` stays |
| A virtual-list dependency | not planned | Paging keeps every rendered list under 200 rows per page; no new dependency |
| Undo of any agent's MCP writes | not planned | Decision 116: only assistant batches have a clear boundary (one Apply). Open question 3 |
| Undo of deletes and project moves | not planned | Decision 117 lists them as not undoable; Apply already confirms destructive proposals. Open question 2 |
| Restore from the UI | not planned | Decision 120: restore needs the server stopped |
| Cross-browser Playwright projects (WebKit, Firefox) | not planned | Chromium only; the app is a local tool opened in one browser |
| `'use cache: remote'` or a custom cache handler | not planned | One local server process; the default in-memory LRU fits |

"Backlog after P11" means a row in `docs/PLAN-STATUS.md` under a new "Backlog"
heading (PLAN.md has no phase after P11); the root planner schedules it with the user.

### 2. New decisions (lane A writes them into docs/PLAN.md after row 108)

| # | Decision |
|---|---|
| 109 | **Revision-keyed cache.** Cached reads are `'use cache'` functions in `src/app/_cache/reads.ts` that take a revision argument, so a write by any process (Next server, MCP stdio, the scheduler) changes the cache key and the next read misses. Revisions are activity cursors read dynamically after `await io()`: `projectRev(project_id)` = `MAX(activity.seq) WHERE project_id = ?` (index `activity_project_seq_idx`), `workspaceRev()` = `MAX(seq) WHERE project_id IS NULL` (new partial index), `globalRev()` = `latestSeq`. Project-scoped reads key on `{ p: projectRev, w: workspaceRev }` (actors and workspace settings live outside projects); workspace reads (sidebar, page tree of the wiki, analytics) key on `globalRev`. The revision reads are uncached and cost one index probe each. |
| 110 | **Tags and invalidation.** Every cached read also calls `cacheTag` with `tessera`, `p:<project_id>` (project-scoped), `wi:<id>` (work item detail), `cy:<id>` / `mo:<id>` (cycle and module detail), `ws` (workspace reads). `runTool` (`actions/_run.ts`) remembers the cursor before a mutating tool, reads the changes after it (`listChanges(before)`), maps them with `tagsForChanges` and calls `updateTag` for each tag, then `refresh()` for the dynamic parts (the Taskboard shape). `refreshAction` (external writes seen by `ChangesPoller`) takes the poller's change list and does the same. Tags make own writes purge promptly; revisions (decision 109) make correctness independent of tags. |
| 111 | **What is cached.** Cached: project bundle (project, states, labels, actors, estimate, features), work item list pages (after the view settings and URL state are merged, so the merged input is the key), work item detail, cycles and modules lists and detail, the sidebar (projects, favourites, counts), the page tree, analytics results. Not cached: search, changes, inbox and notifications (read state is written without activity), view settings, drafts, Home "since last visit", stickies, AI routes, settings screens, exports and webhooks. Rule: a read may be cached only if every write that can change its result logs an activity row in the revision's scope; `tests/cache-safety.test.ts` enforces it (§4.2). |
| 112 | **List paging.** `list_work_items` gains `per_group_limit` (1–500), `group_value` and `sub_group_value` (page inside one group, requires `display.group_by`), alongside `limit` / `offset`. UI page sizes: list grouped 50 per group, board 30 per column (and per sub-group cell), ungrouped list, table and gantt 200 rows, spreadsheet workspace views 200. Calendar loads only the visible period (P10 `?cal=`), capped at 1000 items with a Banner when cut. "Show more" in a group footer fetches the next page through the read Server Action `listWorkItemsAction` (a `toolAction("list_work_items")`; read tools never `refresh()`). Expanded groups are client state; after a refresh the hook re-requests each expanded group up to its loaded length in one call (`group_limits`). |
| 113 | **Exact group counts.** Group counts, `total` and `has_more` come from the whole filtered set, not the loaded page: the engine runs a narrow projection (ids plus the group-by and sub-group-by keys, multi-valued keys through the existing chunked list reads) in display order, groups it with the existing `groupItems` logic, takes each group's page of ids and hydrates only the union. `Group` gains `has_more: boolean`; `count` is the full count; `item_ids` lists the loaded ids. Estimate totals in group headers (decision 106) sum over the full group too. MCP callers that omit the paging keys get today's behaviour (all items). |
| 114 | **Moves on a paged list.** A drop places the item between its loaded neighbours (fractional keys, decision 4); a drop at the end of a group with `has_more` places it after the last loaded item, not after the group's true last item. Optimistic counts move by one between groups; the server result after `refresh()` replaces them. Bulk selection (P8) covers loaded rows only; "Select all" says "N loaded of M". |
| 115 | **Performance budgets.** Measured on `data/p11-perf.db` (10 000 work items in one project plus 2 000 spread over 4 others, 40 labels, 8 actors, 12 cycles, 20 modules, 3 000 relations, 5 000 comments, 30 000 activity rows), on `next start`: p95 of 20 runs ≤ 300 ms from navigation start to the first rendered group of the list (`[data-list-ready]` marker) for list, board and table; engine p95 ≤ 40 ms for the first list page, ≤ 25 ms for `getCounts` (sidebar), ≤ 60 ms for analytics overview, ≤ 30 ms for search. `npm run perf:bench` prints p50/p95 and exits 1 above budget; the Playwright perf spec fails above 300 ms. |
| 116 | **Undo scope.** "Undo last assistant action" undoes the latest applied assistant batch (all proposals applied by one Apply call, `ai_proposal.apply_batch_id`) across all conversations, if it has not been undone and was applied less than 24 hours ago. Only one batch is undoable at a time; there is no redo. Undo runs as actor `user` with `ctx.activityNote` "Undid assistant change" and records `undone_at` and the undo's activity range on each proposal of the batch, in one immediate transaction. |
| 117 | **Undo inverses and conflicts.** Each mutating tool has an entry in `UNDO_INVERSES` (inverse tool call built from the stored proposal input and the batch's activity rows: create → `delete_*`, field update → `update_*` with the old values, set lists → set the old list, add/remove membership → the opposite, archive ↔ unarchive, lock ↔ unlock, description → the previous body, comment create → `delete_comment`, relation add ↔ remove, `move_work_item` → move back to the old group value and sort key) or in `NOT_UNDOABLE` (delete of anything, project moves and transfers, intake accept/decline, `bulk_transfer_work_items` move, exports, webhooks); a registry test keeps the two lists exhaustive. Undo is all-or-nothing: a step blocks when a later activity row (any actor, `seq > seq_to`) touched the same entity and field or deleted the entity, or when its tool is not undoable; a blocked undo is refused with `CONFLICT undo_blocked` and the list of blocked items. Inverses run in reverse seq order through `runToolWithContext`. |
| 118 | **Undo surfaces.** After Apply, a toast says "Applied N changes" with an Undo button (`endContent`, `autoHideDuration` 10 s). The assistant panel gains a History view: applied batches newest first (50), each with its proposals and status (applied, undone, failed), and Undo on the latest undoable batch. Power K gains "Undo last assistant action" when one exists. Every undo opens `UndoConfirmDialog` (AlertDialog from `@/components/shell/dialogs`) listing the inverse steps; inverses that delete created items are marked destructive. No keyboard shortcut (mod+z belongs to the editor). |
| 119 | **Backup kinds and rotation.** Backups live in `<db dir>/backups/` as `tessera-<kind>-<ISO stamp>.db` with kind `auto`, `manual`, `migration` or `pre-restore`; existing `tessera-<stamp>.db` files count as `migration`. Rotation per kind: `auto` keeps the newest per day for 7 days, per ISO week for 4 weeks and per month for 12 months; `manual` keeps 20; `migration` keeps 10 (today's `BACKUP_KEEP`); `pre-restore` keeps 5. Each copy is `VACUUM INTO` on a second connection, then `PRAGMA quick_check` on the copy; a failed check deletes the copy and reports the error. A failed backup never blocks a migration that has a verified backup from the last 10 minutes; otherwise the migration stops (today's rule). |
| 120 | **Scheduled backups and restore.** The P10 scheduler gains a daily maintenance job (lease row id `maintenance`, first run 5 minutes after start, then every hour; it acts when the last `auto` backup is ≥ 24 h old or missing). `workspace_settings.auto_backup` (default on) switches it off. Restore is a script only, never a tool or a UI action: `npm run db:restore -- <file> [--yes]` refuses while the migrate lock exists or the database file's `-wal` has a live writer (`BEGIN IMMEDIATE` fails), takes a `pre-restore` backup, copies the file over the database and removes stale `-wal` / `-shm`; it prints "stop the server first" and exits 1 without `--yes`. |
| 121 | **Backup tools.** `list_backups` (read) and `create_backup { confirm }` (`userOnly`, decision 104) are registry tools so the UI and the CLI share one path; MCP agents cannot create backups. The Backups settings page lists kind, time, size and check result, with "Back up now" and the rotation rule as text. |
| 122 | **Retention.** The maintenance job also purges, as `system`, without activity rows (derived or delivery state, decision 34 style): `ai_proposal` rows that are `discarded`, `failed` or expired-pending older than 30 days, and `applied` older than 90 days (never the latest undoable batch); `notification` rows archived more than 90 days ago, and read ones older than 180 days; `webhook_delivery` rows `delivered` older than 30 days; `export_job` files and rows older than 30 days. `npm run maintenance -- --dry-run [--now <ISO>]` prints what it would do. |
| 123 | **Playwright suite.** `@playwright/test` pinned (§8), specs in `tests/e2e/*.spec.ts`, Chromium only, `workers: 1`, `fullyParallel: false`. `webServer` runs `next start -H 127.0.0.1 -p 3100` against `TESSERA_DB_PATH=data/e2e.db`, which `globalSetup` moves to the scratchpad if present (never deletes), migrates and seeds with the deterministic e2e fixture. Specs isolate by creating their own projects with unique identifiers. Every page goes through a fixture that fails the test on console errors other than the field-guide tolerated list. `npm run test:e2e` is not part of `npm run check` (it needs a build); the reconciler runs `npm run check:e2e` (build, bundle check, Playwright) before merging a phase from P11 on. |
| 124 | **AI in Playwright.** With `TESSERA_AI_FAKE=<dir>` the AI client is the P5 fake client replaying recorded turns from `tests/e2e/fixtures/ai/*.json`; `/api/ai/status` reports available. The server refuses `TESSERA_AI_FAKE` when `NODE_ENV === "production"` and `TESSERA_DB_PATH` is the default `data/tessera.db`, so it can never answer the user's real workspace. |
| 125 | **Static bundle gate.** `scripts/check-bundle.ts` (`npm run check:bundle`, run after `next build` and inside `check:e2e`) fails when `.next/static` contains `ANTHROPIC`, `sk-ant-`, `better-sqlite3`, `drizzle-orm/better-sqlite3`, `TESSERA_DB_PATH` or the engine's `server-only` marker. |
| 126 | **Query plans are tested.** `tests/perf/query-plans.test.ts` runs `EXPLAIN QUERY PLAN` for the list page, group projection, counts, search and the revision probes on a 2 000-item fixture and fails on `SCAN work_item` / `SCAN activity` without an index. Migration `0008_hardening` adds the indexes the perf pass proves (§3). |

### 3. Data model changes

Migration `0008_hardening` (lane A; drizzle-kit generate from `db/schema/*.ts`, then
hand-check the SQL):

| Table | Change | Why |
|---|---|---|
| `ai_proposal` (`db/schema/ai.ts`) | `apply_batch_id TEXT NULL`, `undone_at TEXT NULL`, `undo_seq_from INTEGER NULL`, `undo_seq_to INTEGER NULL`; index `ai_proposal_batch_idx (apply_batch_id)`; index `ai_proposal_applied_idx (status, applied_at)` | Decisions 116–118. **Refresh before build**: P5 may already store a batch id or `applied_at` |
| `workspace_settings` (`db/schema/workspace.ts`) | `auto_backup INTEGER NOT NULL DEFAULT 1` (boolean) | Decision 120 |
| `automation_lease` | a row id `maintenance` (no column change; P10 added `last_run_at`, `last_summary`) | Decision 120; seeded lazily by `acquireLease` |
| `activity` | partial index `activity_workspace_seq_idx ON activity(seq) WHERE project_id IS NULL` | Decision 109 `workspaceRev` |
| `work_item` | candidate indexes, kept only when the perf pass shows the plan uses them: `(project_id, deleted_at, archived_at, sort_order)`, `(project_id, state_id)`, `(project_id, target_date)`, `(cycle_id)` if P3 stores it on the row | Decisions 115, 126. **Refresh before build** with `EXPLAIN QUERY PLAN` on `data/p11-perf.db` |
| `work_item_label`, `work_item_assignee`, `work_item_module` | reverse index `(label_id, work_item_id)` etc. where missing | Group projection for multi-valued keys, `labelsAny` filters |
| `notification` | index `(archived_at)` if P7 has none | Retention purge (decision 122) |

No new tables. No data migration. The backup file naming change is code only;
old `tessera-<stamp>.db` files are classified as `migration` by `parseBackupName`.

### 4. Engine additions (lane A)

#### 4.1 Paging and group counts (`work-items/read.ts`, `work-items/paging.ts` new)

```ts
// read.ts — ListWorkItemsInput gains (zod, strict):
per_group_limit: z.number().int().min(1).max(500).optional()   // decision 112
group_value: z.string().min(1).optional()                       // page inside one group (requires group_by)
sub_group_value: z.string().min(1).optional()
group_limits: z.record(z.string(), z.number().int().min(1).max(2000)).max(100).optional() // re-fetch expanded groups
// WorkItemListResult: total (full), items (loaded union), groups (full counts), cursor
// Group gains has_more: boolean (decision 113)

// paging.ts
export function groupKeyRows(ctx, where: SQL, display: Display, opts): GroupableItem[];     // narrow projection
export function pageGroups(groups: Group[], perGroup: number, limits?: Record<string, number>, offset?: number): { groups: Group[]; ids: string[] };
```
- `listWorkItems` branches: no paging keys → today's path; paging keys → projection,
  grouping, paging, `hydrate(ids)` in display order.
- `groupItems` stays in `filters.ts` (or `work-items/grouping.ts` after a lane 0
  split, §7). **Refresh before build**: the exact `GroupableItem` fields after P7–P10
  (relations, estimates, `blocked`).
- Rich filters (P10, decision 93) and cross-project bundles (P9) apply unchanged:
  the projection takes the same `where`.

#### 4.2 Revisions and cache safety (`activity.ts`, `tests/cache-safety.test.ts`)

```ts
export function projectSeq(ctx: TesseraContext, projectId: string): number;   // MAX(seq) WHERE project_id = ?, 0 when none
export function workspaceSeq(ctx: TesseraContext): number;                     // MAX(seq) WHERE project_id IS NULL
export function workItemSeq(ctx: TesseraContext, id: string): number;         // MAX(seq) WHERE work_item_id = ?
export function tagsForChanges(changes: Change[]): string[];                   // decision 110, in changes.ts, pure
```
- `tests/cache-safety.test.ts`: for each cached reader (§5 table, as engine calls:
  `getProjectBundle`, `listWorkItems` page, `getWorkItem`, `listCycles`,
  `getCycle`, `listModules`, `getModule`, `getSidebar`, `getPageTree`,
  `getAnalytics`), run every mutating tool once on a fixture (inputs from the
  registry test's fixture table) and assert: output changed ⇒ the reader's revision
  changed. A failure names the tool and the reader. **Refresh before build**: reuse
  the registry test's per-tool fixtures if P4–P10 kept one table; else lane A builds it.

#### 4.3 Undo (`src/lib/tessera/ai/undo.ts`, `ai/undo-inverses.ts`, new)

```ts
export type UndoStep = { tool: ToolName; input: unknown; summary: string; destructive: boolean };
export type UndoBlock = { proposal_id: string; entity_type: string; entity_id: string; label: string; reason: "changed_later" | "deleted" | "not_undoable" };
export type UndoPlan = { batch_id: string; applied_at: string; proposals: number; steps: UndoStep[]; blocked: UndoBlock[] };

export function latestUndoableBatch(ctx): { batch_id: string; applied_at: string; summary: string } | null; // decision 116
export function planUndo(ctx, batchId: string): UndoPlan;                    // read; no writes
export function undoBatch(ctx, input: { batch_id: string; confirmed: boolean }): { undone: number; seq_from: number; seq_to: number }; // decision 117
export function listAppliedBatches(ctx, input: { limit?: number }): AppliedBatch[];  // History view
// undo-inverses.ts
export const UNDO_INVERSES: Partial<Record<ToolName, InverseFn>>;
export const NOT_UNDOABLE: readonly ToolName[];
```
- `applyProposals` (P5) sets one `apply_batch_id` (UUIDv7) per Apply call.
- `undoBatch` runs inside `withTx` as `user` with `ctx.activityNote`; it re-plans
  inside the transaction (the plan shown in the dialog may be stale) and refuses
  with `CONFLICT undo_blocked` when anything is blocked, or `RULE undo_expired` past
  24 h, or `RULE undo_superseded` when a newer batch exists, or `RULE confirm_required`
  when a step is destructive and `confirmed` is false.
- Not a registry tool (decision 34 extended): assistant bookkeeping. The writes it
  makes go through `runToolWithContext`, so activity, notifications, webhooks and
  revisions behave as for any user write.
- Tests `tests/ai/undo.test.ts`: create/update/labels/cycle/description/comment
  batches round-trip to the prior state; a later user edit blocks; deleted entity
  blocks; not-undoable tool blocks; double undo refused; expiry with a fixed clock;
  exhaustiveness (every mutating `TOOLS` entry is in exactly one list).

#### 4.4 Backups and maintenance (`db/backups.ts` new, `maintenance/` new)

```ts
// db/backups.ts (moved out of db/migrate.ts: backupDir, backupDatabase, pruneBackups; migrate.ts imports them)
export type BackupKind = "auto" | "manual" | "migration" | "pre-restore";
export type BackupFile = { path: string; name: string; kind: BackupKind; created_at: string; size: number };
export function backupDatabase(filePath: string, kind: BackupKind, now?: Date): { path: string; check: "ok" | string };
export function listBackups(filePath: string): BackupFile[];
export function parseBackupName(name: string): { kind: BackupKind; created_at: string } | null;
export function planRotation(files: BackupFile[], now: Date): { keep: BackupFile[]; remove: BackupFile[] }; // decision 119, pure
export function rotateBackups(filePath: string, now?: Date): string[];
export function restoreDatabase(filePath: string, from: string): { preRestore: string };          // decision 120

// maintenance/index.ts
export function runMaintenance(ctx, input: { now?: string; dry_run?: boolean }): MaintenanceSummary; // backups + retention
// maintenance/retention.ts
export function planRetention(ctx, now: string): RetentionPlan;   // decision 122
export function applyRetention(ctx, plan: RetentionPlan): RetentionSummary;
```
- Scheduler (`automations/scheduler.ts`, P10): add the maintenance job with the
  `maintenance` lease; it calls `runMaintenance` with a `system` context.
  **Refresh before build**: measure `VACUUM INTO` on `data/p11-perf.db`; above 500 ms
  of event-loop block, move the scheduled backup into `child_process.fork` of a
  built script.
- Tools in `tools/registry/maintenance.ts` (new): `list_backups {}` →
  `BackupFile[]` with `check`; `create_backup { confirm: true }` (`userOnly`,
  `mutates: true` so the runner refreshes the page; it writes files only and no
  activity row, so no revision moves). The tool count goes up by 2.
- Scripts: `db-backup.ts` gains `--kind manual` (default) and `--plan` (print
  `planRotation` without deleting); `db-restore.ts` (new); `maintenance.ts` (new,
  `--dry-run`, `--now`); npm scripts `db:restore`, `maintenance`.
- Tests: `tests/backups.test.ts` (name parsing incl. legacy names, rotation table
  for 400 synthetic days, quick_check failure path, restore with a pre-restore copy
  on temp files), `tests/maintenance.test.ts` (retention windows, latest undoable
  batch kept, dry run writes nothing).

#### 4.5 Perf tooling (`scripts/perf-seed.ts`, `scripts/perf-bench.ts`, `seed.ts`)

- `seedPerf(ctx, { items, projects, seed })` in `seed.ts` (or `seed-perf.ts` if
  `seed.ts` would pass 600 lines): deterministic (mulberry32 from `seed`, fixed
  base date), writes through engine functions inside batched transactions of 500,
  with the shape in decision 115. `npm run perf:seed -- --db data/p11-perf.db
  --items 10000` refuses the default database path.
- `npm run perf:bench -- --db data/p11-perf.db --runs 50` times the decision 115
  engine reads and exits 1 above budget.
- `tests/perf/query-plans.test.ts` (decision 126) on a 2 000-item in-memory seed.

#### 4.6 Smaller engine edits

- `ai/client.ts` (P5): `TESSERA_AI_FAKE` path (decision 124) loading recorded turns.
- `changes.ts`: export `Change` already; add `tagsForChanges`.
- `schemas.ts` / `types.ts` (lane 0): `Group.has_more`, `WorkItemListResult` docs,
  `BackupKindSchema`, `BackupFile`, `UndoPlan`, `UndoStep`, `UndoBlock`,
  `AppliedBatch`, `MaintenanceSummary` (client-safe shapes only).
- `docs/contracts/{schema,service-api,tools,ai}.md` updated by lane A.

### 5. Routes and data loading

Pattern for every cached page (lane C):

```tsx
// page.tsx (unchanged outer shape: Suspense + io())
await io();
const rev = await readTessera((ctx) => ({ p: projectSeq(ctx, projectId), w: workspaceSeq(ctx) }));
const bundle = await cachedProjectBundle(projectId, rev);   // src/app/_cache/reads.ts

// src/app/_cache/reads.ts
export async function cachedProjectBundle(projectId: string, rev: ProjectRev) {
  "use cache";
  cacheLife("tessera");
  cacheTag("tessera", `p:${projectId}`);
  return readTessera((ctx) => getProjectBundle(ctx, projectId));
}
```
- `next.config.ts` (lane A): `cacheLife: { tessera: { stale: 30, revalidate: 3600,
  expire: 86400 } }` (stale at the router minimum), `cacheMaxMemorySize: 64 * 1024 * 1024`.
  Both keys are documented in Next 16.4.0
  (`03-api-reference/05-config/01-next-config-js/{cacheLife,cacheMaxMemorySize}.md`;
  the memory default is 50 MB). `updateTag` works only inside Server Actions, which
  is why `runTool` and `refreshAction` apply tags and route handlers never do.
- Errors: cached functions never catch; `NOT_FOUND` / `VALIDATION` still map to
  `notFound()` outside the cached call (field guide: `notFound()` outside try).
  A thrown error is not cached.
- Cached readers (`src/app/_cache/reads.ts`) and their callers:

| Reader | Key | Tags | Caller (edited by lane C) |
|---|---|---|---|
| `cachedSidebar(rev)` | `globalRev` | `tessera`, `ws` | `(tessera)/layout.tsx` |
| `cachedProjectBundle(projectId, rev)` | project rev | `p:<id>` | `projects/[projectId]/layout.tsx`, `work-items/load-detail.ts` |
| `cachedWorkItemsPage(input, rev)` | merged list input + project rev (workspace views: `globalRev`) | `p:<id>` or `ws` | `projects/[projectId]/work-items/scoped-list.tsx`, views `[viewId]/view-list.tsx`, workspace views page |
| `cachedWorkItemDetail(id, rev)` | `workItemSeq` + project rev | `wi:<id>`, `p:<id>` | `work-items/load-detail.ts` (peek, modal, full page, `/browse/[key]`) |
| `cachedCycles(projectId, rev)`, `cachedCycle(id, rev)` | project rev | `p:<id>`, `cy:<id>` | `cycles/page.tsx`, `cycles/[cycleId]/page.tsx`, `cycle-data.ts`, alias `/cycles/[cycleId]` |
| `cachedModules(projectId, rev)`, `cachedModule(id, rev)` | project rev | `p:<id>`, `mo:<id>` | `modules/page.tsx`, `modules/[moduleId]/page.tsx`, alias `/modules/[moduleId]` |
| `cachedPageTree(scope, rev)` | `globalRev` (wiki) or project rev | `ws` / `p:<id>` | `/wiki`, `projects/[projectId]/pages` (P6) |
| `cachedAnalytics(input, rev)` | `globalRev` | `ws` | `/analytics/[tab]` (P9) |

- `src/app/_cache/revs.ts`: `readProjectRev(projectId)`, `readGlobalRev()`,
  `readWorkItemRev(id)` (dynamic, after `io()`); `src/app/_cache/tags.ts`:
  `applyTags(changes)` calls `updateTag` for `tagsForChanges(changes)`.
- `actions/_run.ts`: `const before = latestSeq(ctx)` before the run; after a
  mutating tool `applyTags(listChanges(ctx, before).changes)` then `refresh()`.
- `actions/shell.ts`: `refreshAction(changes?: Change[])` applies their tags before
  `refresh()`. `ChangesPoller` passes the change list it received.
- New route: `/settings/backups` (`src/app/(tessera)/settings/backups/page.tsx`):
  `<Suspense fallback={<SettingsSkeleton />}>` → `await io()` →
  `readTessera(list_backups)` + workspace settings. Not cached (files change outside
  activity).
- Assistant History: GET `/api/ai/proposals?view=history&limit=50` (P5 route gains
  the `view` param; guarded by `guardAiRequest`).
- Paging: no route; `listWorkItemsAction` in `actions/work-items.ts` (read tool,
  no refresh).
- Recents (`components/shell/recents.ts`, `entity-labels.ts`, `shell-icons.ts`):
  `/settings/backups` → label "Backups", icon `BackupIcon`. No other new routes.
- Exit "no blocking-route insight": `next build` output is captured by
  `check:e2e` and fails on the blocking-route warning text. **Refresh before
  build**: the exact wording in Next 16.4.0's build output.

### 6. Screens and components

Astryx imports from `@astryxdesign/core/<Name>`; Dialog and AlertDialog only from
`@/components/shell/dialogs`. Icons only from `src/themes/catppuccin/icons.tsx`
(new in lane 0: `UndoIcon` = Phosphor `ArrowCounterClockwise`, `BackupIcon` =
`Database`, `HistoryListIcon` reuses P10 `History` if present). Layout classes in
`src/components/styles/{paging,assistant-history,backups}.css` with tokens only.

#### U1 Paging (`src/components/work-items/`)
- `paging.ts` (new, pure, tested in `tests/ui/paging.test.ts`): merge server
  groups with extra pages, `hasMore`, loaded-of-total text, optimistic count moves
  (decision 114).
- `use-paged-list.ts` (new): holds expanded groups `{ [groupId]: loadedCount }`,
  calls `listWorkItemsAction({ ...input, group_value, offset, limit })`, re-fetches
  expanded groups with `group_limits` when the server props change; returns
  `{ groups, items, loadMore(groupId), isLoading(groupId) }`.
- `GroupFooter.tsx` (new): `Button variant="ghost" size="sm"` "Show 50 more
  (120 hidden)" with `isLoading`; in `ListLayout` group bodies, `BoardLayout`
  columns and lane cells, `TableLayout` (ungrouped: footer row "Load 200 more", or
  `Pagination` with `hasMore` — use the footer button; `Pagination` is for page
  jumps we do not need), `GanttLayout` (P10) footer.
- Group header `Badge` shows the full `count` (decision 113); estimate totals over
  the full group.
- `WorkItemsScreen` wires `use-paged-list` between the server result and
  `optimistic-list`. `BulkBar` "Select all" text per decision 114.
- `[data-list-ready]` attribute on the first rendered group container (perf spec
  marker).
- **Refresh before build**: `optimistic-list.ts` API after P8/P10, `LayoutProps`
  after P10, the board sub-group lane component.

#### U2 Undo, assistant History, backups and shell
- `components/ai/UndoConfirmDialog.tsx` (AlertDialog): title "Undo assistant
  change", the plan's steps as an Astryx `List` / `Item` with destructive steps
  marked by a `Token`; blocked items in a `Banner status="error"` with links; buttons
  Cancel / Undo (`variant="destructive"` when any step is destructive).
- `components/ai/AssistantHistory.tsx`: the panel's second view (P5 panel header
  gets a `SegmentedControl` Chat / History): applied batches as `List` rows
  (`RelativeTime`, proposal count, status `Token`), expandable with `Collapsible` to
  the proposal summaries; Undo `Button` on the latest undoable batch.
- `components/ai/use-undo.ts`: `planUndoAction`, `undoBatchAction` (Server Actions in
  `actions/ai.ts`; `undoBatchAction` calls `applyTags` + `refresh()`), toast after
  Apply via `useToast()` with `endContent={<Button label="Undo" variant="ghost"
  size="sm" />}`, `uniqueID: "assistant-undo"`, `autoHideDuration: 10000`.
- `components/settings/BackupsScreen.tsx`: `Table` (kind `Token`, created
  `Timestamp`/`RelativeTime`, size, check), `Switch` "Daily backups" (auto_backup),
  `Button` "Back up now" (`clickAction` → `createBackupAction`), rotation rule as
  `Text`; `Banner` when the last auto backup is older than 48 h or failed. Settings
  nav entry (P9 settings layout; **refresh before build**: the nav component).
- Power K (`command-source.ts`): "Undo last assistant action" (shown when
  `latestUndoableBatch` is non-null; read through the existing command context
  load) and "Back up now". **Refresh before build**: CommandBar file after P10 and
  its budget.

#### C Cache and loaders (`src/app/_cache/`, route loaders, actions runner)
- Server-only modules; no client component. Owns the files in the §5 table plus
  `actions/_run.ts`, `actions/shell.ts`, `ChangesPoller.tsx` (passes changes).
- `scoped-list.tsx` passes the paging keys (`per_group_limit` by layout, decision
  112) and the `[data-list-ready]` contract to `WorkItemsScreen` props.

#### Q Playwright suite (`tests/e2e/`, `playwright.config.ts`)
- `playwright.config.ts` (root): `testDir: "tests/e2e"`, `use.baseURL`
  `http://127.0.0.1:3100`, `trace: "retain-on-failure"`, `outputDir` and the HTML
  report under `test-results/` and `playwright-report/` (gitignored by lane A),
  `webServer` per decision 123, `globalSetup: "tests/e2e/global-setup.ts"`.
- `fixtures.ts`: `test` extended with `page` that records console messages and
  fails on non-tolerated errors; helpers `createProject`, `openPeek`, `mcp(tool,
  input)` (runs `scripts/mcp-call.ts` against `data/e2e.db`), `waitForDialog`
  (2–3 s animation rule), `dragByPointer` (P4/P10 pointer drag).
- Specs (one per area, §12 checks noted): `shell-projects` (1), `work-items` (2–4),
  `detail-editor` (5), `external-writes` (6), `views-settings` (P4),
  `assistant` (P5 with fake model, + undo), `pages` (7), `collaboration` (8),
  `intake-drafts-bulk` (9), `workspace` (P9 Home, favourites, analytics equals
  counts), `layouts` (10, calendar, gantt edge drag), `operations` (rich filters,
  export download, history restore, automations Run now), `drag` (board, views,
  states, page tree), `paging` (Show more, counts), `cache` (MCP write visible after
  navigation; own write instant), `backups` (Back up now), `schemes` (Frappé and
  Latte render with no console errors), `perf` (decision 115, runs only with
  `E2E_PERF_DB`).

### 7. Lane split for swarm workers

| Lane | Owns | Depends on |
|---|---|---|
| 0 prep (alone, mechanical) | File-budget splits first: re-run `wc -l` on every file in this plan after P10; split verbatim any file within 40 lines of 600 that P11 edits (likely `filters.ts` → move `groupItems` and helpers into `work-items/grouping.ts`; check `read.ts`, `ListLayout.tsx`, `BoardLayout.tsx`, `TableLayout.tsx`, `WorkItemsScreen.tsx`, `AssistantPanel.tsx`, `CommandBar.tsx`, `command-source.ts`, `scheduler.ts`, `seed.ts`) and lower `scripts/file-budget.json` where a file shrinks. Then: client-safe shapes in `schemas.ts`/`types.ts` (§4.6), 2 icons, the three stylesheets with their `globals.css` imports, `.gitignore` entries (`test-results/`, `playwright-report/`, `data/e2e.db*`). | — |
| A engine | `src/lib/tessera/**` (paging, revisions, `tagsForChanges`, undo, backups, maintenance, retention, AI fake, maintenance tools), `drizzle/0008_hardening`, `scripts/**` (perf-seed, perf-bench, db-backup, db-restore, maintenance, check-bundle), `next.config.ts`, `package.json` (deps and scripts `test:e2e`, `check:e2e`, `check:bundle`, `perf:*`, `db:restore`, `maintenance`), `vitest.config.mts` (exclude `tests/e2e`), Vitest under `tests/{ai,perf}/` and `tests/{cache-safety,backups,maintenance}.test.ts`, contracts, decisions 109–126 into PLAN.md | 0 |
| C cache and loaders | `src/app/_cache/**`, `actions/_run.ts`, `actions/shell.ts`, `components/shell/ChangesPoller.tsx`, every loader in the §5 table, `/settings/backups/page.tsx`, `actions/work-items.ts` (`listWorkItemsAction`), `actions/maintenance.ts` | A's revision functions and `list_work_items` paging keys (signatures fixed in lane 0's types) |
| U1 paging | `components/work-items/{paging.ts,use-paged-list.ts,GroupFooter.tsx}`, `ListLayout`, `BoardLayout` (+ board lane files), `TableLayout`, `WorkItemsScreen`, `optimistic-list.ts`, P10 `GanttLayout`, `BulkBar` text, `styles/paging.css`, `tests/ui/paging.test.ts` | 0; A for live data (builds against the types first) |
| U2 undo, history, backups, shell | `components/ai/{UndoConfirmDialog,AssistantHistory,use-undo}.tsx`, the P5 panel header and Apply flow files, `actions/ai.ts`, P5 `/api/ai/proposals` route, `components/settings/BackupsScreen.tsx`, the settings nav, `command-source.ts`, `recents.ts`, `entity-labels.ts`, `shell-icons.ts`, `styles/{assistant-history,backups}.css` | 0; A's undo and backup functions |
| Q Playwright | `playwright.config.ts`, `tests/e2e/**` (specs, fixtures, global setup, recorded AI turns), `docs/PLAN-STATUS.md` rows, the field guide note on running e2e | A (`package.json` deps, fake AI), then C/U1/U2 for their specs; Q writes specs for existing P2–P10 behaviour from day 1 |

Order: lane 0 merges alone. A, C, U1, U2 and Q start together; C and U1 build
against lane 0's types and A's stubbed signatures. Q's suite is the phase gate: the
reconciler merges A → C → U1 → U2 → Q, running `npm run check` after each and
`npm run check:e2e` after Q.

### 8. New dependencies

| Package | Version | Licence | Kind | Note |
|---|---|---|---|---|
| `@playwright/test` | `1.63.0` (exact, released 2026-09-04) | Apache-2.0 | dev | Pulls `playwright@1.63.0` (Apache-2.0) and `playwright-core@1.63.0` (Apache-2.0); no other dependencies. All three are on the licence allowlist. 1.64.x is newer but under three weeks old; **refresh before build**: take the newest patch release that is at least two weeks old |

- Browser binary: `npx playwright install chromium` downloads the Chromium build
  matching 1.63.0 into `~/Library/Caches/ms-playwright` (about 150 MB, once). It is a
  download, so it needs the user's approval in chat (open question 6). It is not an
  npm package and is outside the licence gate.
- No virtual-list, cache or backup library (decisions 112, 109, 119).

### 9. Acceptance (on a fresh `data/p11-acceptance.db` after `next build`)

Setup: stop any dev server; move an existing `data/p11-acceptance.db*` to the
scratchpad; `npm run build`; start `TESSERA_DB_PATH=data/p11-acceptance.db
NEXT_PRIVATE_DEBUG_CACHE=1 npx next start -H 127.0.0.1 -p 3000` with output to a log.

1. `npm run check` is green (tsc, eslint, Vitest including cache-safety, undo,
   backups, maintenance, query plans, paging; conventions; licences; theme).
2. The build log has no blocking-route insight; `npm run check:bundle` is clean.
3. Open `/`, create project `WEB` and three work items; navigate Projects → WEB →
   Cycles → WEB twice: the second visit paints without a Suspense fallback and the
   log shows cache hits for the project bundle and the list.
4. From a terminal, `TESSERA_DB_PATH=data/p11-acceptance.db npx tsx
   scripts/mcp-call.ts update_work_item '{…priority:"urgent"}'` on WEB-1: the open
   list updates within 5 s; navigate to WEB-1's full page and back: both show
   Urgent (revision miss, not a stale entry).
5. With no browser tab open, run another MCP write, then open the project: the new
   value shows on first paint.
6. In a second project, run `npm run perf:seed -- --db data/p11-acceptance.db
   --items 300 --project PERF` (allowed: not the default path): the list grouped by
   state shows 50 rows in Backlog with the header count 300-ish exact and "Show 50
   more"; clicking it twice shows 150 rows; the board column shows 30 with its full
   count; the table loads 200 then "Load 100 more".
7. Drag a loaded card from Backlog to In Progress on the board: both counts move by
   one at once and stay right after reload.
8. With an expanded group, trigger an MCP write: after the refresh the group still
   shows its expanded rows.
9. Perf: `npm run perf:seed -- --db data/p11-perf.db --items 10000`, then
   `npm run perf:bench -- --db data/p11-perf.db` reports every p95 under decision
   115's budgets; `E2E_PERF_DB=data/p11-perf.db npx playwright test perf` reports
   list, board and table p95 ≤ 300 ms.
10. `npm run test:e2e` (the whole suite) is green; the HTML report lists every spec
    in §6 Q.
11. Assistant (real key, or `TESSERA_AI_FAKE` with the recorded fixture): ask it to
    create an item, set WEB-2 to High and add label `bug` to WEB-3; Apply → a toast
    offers Undo; Undo → the dialog lists 3 steps (the delete marked destructive) →
    confirm → the item is gone, WEB-2 back to its old priority, WEB-3 without the
    label; WEB-2's activity says "Undid assistant change" by You.
12. Apply another batch that sets WEB-2 to Low, then set WEB-2 to Medium by hand;
    History → Undo: refused, the Banner names WEB-2 ("changed later"); nothing
    changed.
13. Power K shows "Undo last assistant action" only while an undoable batch exists.
14. `/settings/backups`: "Back up now" adds a `manual` row with size and check "ok";
    `npm run db:backup -- --plan` prints the keep/remove split; the Daily backups
    switch persists after reload.
15. `npm run maintenance -- --dry-run --now <now + 2 days>` reports an `auto` backup
    due and the retention counts; without `--dry-run` it writes
    `tessera-auto-*.db` and the Backups page shows it.
16. Stop the server; `npm run db:restore -- <the manual backup>` refuses without
    `--yes`; with `--yes` it reports the `pre-restore` copy; start the server: the
    project matches the backup's state (the item created after it is absent).
17. Switch the scheme to Latte and back to Frappé in the shell: both render with no
    console errors (also covered by the `schemes` spec).
18. Console on every screen visited above shows only the tolerated Astryx Table
    warnings.

Afterwards: stop the server, leave `data/p11-*.db` in place for the reconciler, and
point the dev server back to `data/tessera.db` only when the user asks (memory: P3
test databases).

### 10. Risks

| Risk | Mitigation |
|---|---|
| A write that logs no activity leaves a cached read stale for the rest of the process | Decision 111 rule plus `tests/cache-safety.test.ts` over every mutating tool; reads with unlogged writes (inbox, view settings, AI, drafts) stay dynamic |
| Client router cache shows data up to 30 s old after an external write on another route | `stale: 30` (minimum); `ChangesPoller` → `refreshAction` applies the external changes' tags and refreshes; **refresh before build**: confirm `updateTag` from a Server Action clears the client cache entries with that tag |
| Cache memory grows with revision-keyed entries (each write leaves dead keys) | LRU with `cacheMaxMemorySize` 64 MB; dead keys are evicted first because they are never read again |
| `'use cache'` behaves differently in `next dev` | Acceptance and Playwright run on `next start`; the field guide gets a line |
| Paged lists break optimistic drag, bulk selection or keyboard navigation across unloaded rows | Decision 114 rules, `paging.test.ts`, the Playwright `paging` and `drag` specs |
| Group projection is slower than budget for multi-valued groupings on 10k items | Bench per grouping; fallback to SQL `GROUP BY` per field inside `paging.ts` behind the same signature |
| Undo reverses a change the user wanted to keep, or partially applies | All-or-nothing in one transaction, re-planned inside it; conflict rule on entity+field; confirmation dialog listing every step |
| Inverse table drifts as tools are added after P11 | Exhaustiveness test fails when a mutating tool is in neither list |
| `VACUUM INTO` blocks the event loop for long on a large database | Measured in the perf pass; fork a process above 500 ms (§4.4) |
| Restore while the server runs corrupts or loses writes | Script only, `--yes`, lock and `BEGIN IMMEDIATE` probe, pre-restore copy |
| Playwright flakiness (dialog animations, hidden routes under `<Activity>`, the 5 s poller) | One worker, explicit waits on roles and `data-*` markers, `expect.poll` for poller checks, traces on failure, the dialogs wrapper |
| A real AI key leaks into e2e or the fake answers the real workspace | Decision 124 guard; e2e uses `data/e2e.db`; bundle gate |
| Playwright 1.63.0's Chromium download is blocked or slow | Open question 6 alternative: `channel: "chrome"` (installed Google Chrome) |

### 11. Open questions for the user (each with the default the plan uses)

1. **Undo when something changed later**: refuse the whole undo and name the items
   (default), or undo everything that is still safe and report the rest?
2. **Undo of deletes**: not undoable (default; Apply already asks before deleting),
   or add an engine "restore deleted" path so undo can bring items back?
3. **Undo reach**: only the in-app assistant's last Apply (default), or also the last
   write of any MCP agent?
4. **Backup rotation**: daily backups kept 7 days, weekly 4 weeks, monthly 12 months,
   in `data/backups/` (default), or other numbers or a folder you pick (for example
   a synced drive)?
5. **Retention**: purge discarded/failed proposals after 30 days, applied ones after
   90, archived notifications after 90 and read ones after 180, webhook deliveries
   and exports after 30 (default), or keep everything?
6. **Playwright browser**: download Playwright's own Chromium once, about 150 MB
   (default; needs your OK when the build gets there), or use your installed Google
   Chrome?
7. **E2E gate**: run the Playwright suite at phase merges only via
   `npm run check:e2e` (default; it needs a build and takes minutes), or on every
   `npm run check`?
8. **Page sizes**: 50 per list group, 30 per board column, 200 rows ungrouped
   (default), or other numbers?
9. **Deferred features** (timezone setting, comment search, token usage display,
   intake rich filters, archives layout switch, relations column, cycle timeline,
   drag-to-create, keyboard range selection, Home charts) move to a Backlog after
   P11 (default), or should any of them be part of P11?

### Refresh before build (checklist for the contract planner)

- Line counts and `scripts/file-budget.json` after P10; lane 0's split list (§7).
- P5: `ai_proposal` columns (batch id, `applied_at`), `applyProposals` signature,
  the fake client module, the panel header and Apply flow files, GET
  `/api/ai/proposals` params.
- P6–P10: every mutating tool's activity rows (old values present for the inverses
  in decision 117; `move_work_item` sort key in `old_value`), the registry test's
  fixture table for cache-safety.
- P7: whether notification read/archive writes log activity (decides caching of
  inbox-adjacent reads), notification indexes.
- P9: settings layout and nav component, `getSidebar`/favourites read, analytics
  entry point, workspace views list loader.
- P10: scheduler file and lease API, `ctx.activityNote`, `GanttLayout` footer, P10
  export file paths for retention, `ToolDef.userOnly`.
- Next 16.4.0: `cacheLife` / `cacheMaxMemorySize` config docs, `updateTag` effect on
  the client router cache, the blocking-route insight wording, `io()` placement
  before a cached call.
- Perf DB: `EXPLAIN QUERY PLAN` results decide the `0008` indexes; `VACUUM INTO`
  timing decides in-process vs forked backups.
- npm: the newest `@playwright/test` patch at least two weeks old and its Chromium
  revision.
