# As-built map: hardening (P11): paging, backups, retention, undo, performance gates, e2e

State described: the working tree after fix round 4, 2026-10-23 (HEAD `8575fcd` plus uncommitted lane work, including migration 0013). Line counts are tree counts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Plan: docs/drafts/p11-plan.md. Decisions 109 to 111 were dropped by the user on 2026-10-21 and are not built (P12 records the drop as decision 127). Round 3 added the Undo surfaces for assistant batches (the Applied toast and Power K), a folded Backups table for narrow containers and twenty-odd Playwright specs; the paging, backup and retention code is unchanged.

## 1. Purpose and boundaries

P11 made the app safe to run on a real, large workspace: list paging with exact group counts, kinded and rotated backups, a daily maintenance job with retention, an undo for assistant batches, a performance fixture with budgets and query-plan tests, a Playwright suite on a production build, and a static bundle gate.

Lives elsewhere (this area only calls it):
- The scheduler timers and leases (`automations/scheduler.ts`, `lease.ts`): operations.md. The `maintenance` lease row is taken here; the timers are there.
- The screen that hosts paging (`WorkItemsScreen`, url state, layouts): work-items.md.
- The assistant panel, proposals and Apply: ai.md. Undo here reads `ai_proposal.apply_batch_id`, `seq_from`, `seq_to` that Apply writes. The UI entry points to undo (the Applied toast's Undo button and the Power K row "Undo last assistant change", both through `components/ai/assistant-undo.ts`) are described in ai.md.
- Migration mechanics (lock file, `migrate()`): engine.md; this file covers only the backup step inside `migrateIfNeeded`.

## 2. File map

### Engine (`src/lib/tessera/`)

| File | Responsibility | Key exports |
|---|---|---|
| `work-items/paging.ts` (290) | Group paging for `listWorkItems`. Reads a narrow projection of the whole filtered set (ids plus group-by keys) in display order, groups it with `groupItems`, takes each group's page of ids and hydrates only their union. Group counts, `total` and `has_more` therefore cover the whole set. | `planGroupPaging`, `groupKeyRows`, `pageGroups`, `listGroupPage`, `DEFAULT_PER_GROUP` (50) |
| `db/backups.ts` | Backup files `<db dir>/backups/tessera-<kind>-<stamp>.db`. `VACUUM INTO ?` (bound parameter) on a second connection, then `PRAGMA quick_check` on the copy; a failed check deletes the copy and throws. Pure `planRotation`; `rotateBackups` deletes the remove set. Legacy `tessera-<stamp>.db` parses as kind `migration`. | `backupDatabase`, `listBackups`, `parseBackupName`, `planRotation`, `rotateBackups`, `pruneBackups` (legacy), `BACKUP_KEEP` |
| `db/migrate.ts` (150) | `migrateIfNeeded` takes the lock, and when migrations are pending and the file already existed writes a `migration` backup, rotates, then migrates. | `migrateIfNeeded`, `pendingMigrations` |
| `maintenance/index.ts` (130) | `runMaintenance`: takes the `maintenance` lease (15 min TTL), writes an `auto` backup when `workspace_settings.auto_backup` is on and the last `auto` file is 24 h or older (or missing), applies retention, rotates backups, stores `last_run_at` and `last_summary` on the lease row. `dry_run` reports and writes nothing. A held lease returns `lease_held: true`. | `runMaintenance`, `RunMaintenanceInput`, `MaintenanceSummary` |
| `maintenance/retention.ts` (117) | Plans and applies the purge as derived and delivery state only, no activity rows. | `planRetention`, `applyRetention`, `emptyRetention` |
| `ai/undo.ts` (180), `ai/undo-note.ts` | Undo of the latest applied assistant batch: finds it (status `applied`, has `apply_batch_id`, not undone, `decided_at` within 24 h), refuses when a later activity row touched the same entity and field (or deleted the entity), then inverts the batch's assistant activity rows newest first in one transaction and stamps `undone_at`, `undo_seq_from`, `undo_seq_to` on the batch's proposals. | `findLatestUndoableBatch`, `findLatestUndoableBatchId`, `undoLastAssistantBatch`, `UNDO_BATCH_TTL_MS`, `ASSISTANT_UNDO_NOTE` |
| `work-items/undo.ts` (89) | Separate, older helper: reverses the newest activity row of one work item when it is a stored field update or an archive. Exported from `work-items/index.ts`; no registry tool calls it. | `undoLastWorkItemChange`, `UNDO_NOTE` |
| `seed-perf.ts` (345) | Deterministic perf fixture (seeded `mulberry32`): one big project plus small ones with labels, actors, cycles, modules, relations, comments and activity. | `seedPerf`, `PERF_BASE_DATE`, `mulberry32` |
| `tools/registry/maintenance.ts` | Registry tools `list_backups` (read), `create_backup {confirm}` (manual kind, `userOnly`), `run_maintenance` (`userOnly`), `get_undoable_assistant_batch` (read), `undo_last_assistant_batch {confirm}` (`userOnly`, destructive). Wrappers in `src/app/actions/maintenance.ts`. | `maintenanceTools` |

`notification` also got `notification_archived_idx` in `0008`, which retention uses. The index migrations of this phase: `0008_hardening` (indexes the perf pass proved) and `0011_workspace_list_idx` (partial indexes `work_item_live_sort_idx (sort_order, sequence_id)` and `work_item_live_state_idx (state_id, project_id, deleted_at, archived_at)` on live rows).

### Client paging (`src/components/work-items/`)

| File | Responsibility |
|---|---|
| `paging.ts` (274) | Pure helpers. Page sizes `ROW_PAGE` 200, `LIST_GROUP_PAGE` 50, `BOARD_GROUP_PAGE` 30, `MULTI_LIST_GROUP_PAGE` 25, `MULTI_BOARD_GROUP_PAGE` 20, `CALENDAR_CAP` 1000. `pageSizeFor(display)` picks by layout and by whether the grouping is multi-valued; `listPaging` builds the first-page input the loaders use; `mergeGroupPage` and `mergeRowsPage` append a fetched page, `refetchPlan` and `keepLoaded` rebuild the loaded length after a refresh, plus `showMoreLabel`, `hasUnloaded`, `loadedOfTotal`, `loadMoreSize`. |
| `use-paged-list.ts` (137) | `usePagedList`: holds the loaded result, "Show more" calls `listWorkItemsAction` (a `toolAction("list_work_items")`, a read, so no `refresh()`), and after a server refresh re-requests each expanded group up to its loaded length in one call with `group_limits`. |

### UI and scripts

| Path | Responsibility |
|---|---|
| `src/app/(tessera)/settings/backups/page.tsx` (47), `components/backups/BackupsScreen.tsx` (183), `backup-format.ts` (23) | Workspace settings tab "Backups" (listed in `workspace-settings/settings-format.ts`). Lists backups (a table of File, Kind, Size, Created, Check; below `BACKUPS_FULL_WIDTH` = 576 px of container, measured by `useNarrowContainer`, it folds to File and Kind with size, check and age stacked under the file name, because no hidden sideways swipe is allowed on a phone, decision 14; `table-widths.ts`, `tests/ui/backups-fold.test.ts`; the table has no actions column), "Back up now" through `createBackupAction({ confirm: true })`, the daily switch through `updateWorkspaceSettingsAction({ auto_backup })`, the rotation rule as text, and a stale-auto hint (`autoBackupStale`). |
| `scripts/db-backup.ts` | `npm run db:backup`, default kind manual; `--plan` prints the keep/remove split without deleting. |
| `scripts/db-restore.ts` | `npm run db:restore -- <file> [--yes]`. Restore is a script only, never a tool or UI action (decision 120). Header: refuses while a migrate lock exists or another process holds a write lock, prints "stop the server first" and exits 1 without `--yes`, takes a `pre-restore` backup first. |
| `scripts/maintenance.ts` | `npm run maintenance [-- --dry-run] [--now <ISO>]` runs retention and the optional auto backup on the configured database. |
| `scripts/perf-seed.ts`, `perf-bench.ts`, `perf-db.ts` | `npm run perf:seed` builds the fixture (default `data/p11-perf.db`); `perf:bench` times engine reads and exits 1 above budget; `perf-db.ts` refuses `:memory:`, `data/tessera.db` and whatever `TESSERA_DB_PATH` resolves to. |
| `scripts/check-bundle.ts`, `bundle-rules.ts` | `npm run check:bundle [-- <dir>]` scans `.next/static` (never builds). Exit 0 clean, 1 findings, 2 missing directory. |
| `playwright.config.ts` (56), `tests/e2e/{prepare-db,fixtures,tolerated}.ts` | Chromium suite on `next start -H 127.0.0.1 -p $E2E_PORT` (default 3100). |

## 3. Data and control flow

Paging read. A loader calls `listPaging(display)`, which adds `per_group_limit` (grouped) or `limit` 200 (flat) to the `list_work_items` input. The engine projects the filtered set, groups it, pages each group and returns `groups[]` with the full `count`, `item_ids` of the loaded page and `has_more`. "Show more" sends `group_value` (and `sub_group_value`) with `limit`/`offset`; the merge helpers append to the loaded group. MCP callers that omit all paging keys get all items.

Backup write. `backupDatabase(file, kind)` opens a second connection, runs `VACUUM INTO` the kinded path, runs `quick_check` on the copy, deletes it on failure and throws. Callers: `create_backup` (manual), `runMaintenance` (auto), `migrateIfNeeded` (migration), `scripts/db-backup.ts`, `scripts/db-restore.ts` (pre-restore). Rotation per kind (`planRotation`): manual newest 20, migration 10, pre-restore 5; auto keeps the newest per day for 7 days, per ISO week for 4 weeks and per month for 12 months (the union of the three sets).

Maintenance. Scheduler (or `run_maintenance`, or the script) calls `runMaintenance`. Order: lease, optional auto backup, `planRetention` then `applyRetention`, `rotateBackups`. If the backup throws, the run stops before retention and the lease is released in `finally`.

Retention rules (`retention.ts`): `ai_proposal` rows `discarded` or `failed` older than 30 days (by `decided_at`), `pending` older than 30 days (by `created_at`), and `applied` older than 90 days, except the latest undoable batch; `notification` rows archived over 90 days ago and read-but-not-archived ones read over 180 days ago; `webhook_delivery` rows `delivered` older than 30 days; `export_job` rows (any status) and their files older than 30 days.

Undo. `get_undoable_assistant_batch` returns the batch or null. `undo_last_assistant_batch { confirm: true }` runs `undoLastAssistantBatch` as the caller (user only): `blockedByLater` scans activity after `seq_to`; a later row on the same entity and field, or a delete of a batch entity, throws `CONFLICT undo_blocked` with the list. Rows with the undo note are skipped. Inversion handles only work-item rows: verb `archived` becomes `unarchiveWorkItem`, verb `updated` on `name`, `state_id`, `priority`, `parent_id`, `cycle_id`, `estimate_point_id`, `start_date`, `target_date` becomes `updateWorkItem` with the stored old value. Any other activity row in the batch refuses the whole undo with `undo_blocked`. Inverses carry `ctx.activityNote = "Undid assistant change"`.

E2E run. `webServer.command` is `npx tsx tests/e2e/prepare-db.ts && npx next start ...`. `prepare-db.ts` moves an existing `data/e2e.db` (and `-wal`, `-shm`, `-lock`) to a backup folder, migrates and seeds. It runs in the command, not in `globalSetup`, because Playwright probes the server URL first. Env: `TESSERA_AUTOMATIONS=off`, `TESSERA_WEBHOOKS=off`, `TESSERA_AI_FAKE=tests/e2e/fixtures/ai`. `getAnthropic()` replays the recorded turns when `TESSERA_AI_FAKE` is set and calls `assertFakeAiAllowed()` first (refuses in production on the default database). Specs create their own projects with unique identifiers; the `page` fixture fails a test on a page error or a console error outside `tolerated.ts`. `npm run check:e2e` is `next build && check:bundle && playwright test`; it is not part of `npm run check`.

## 4. Invariants

| Rule | Where enforced | Decision | Guarding test |
|---|---|---|---|
| Group counts, `total` and `has_more` cover the whole filtered set, not the loaded page | `work-items/paging.ts` | 113 | `tests/paging.test.ts`, `tests/ui/paging.test.ts` |
| Multi-valued groupings (labels, assignees, modules) use smaller first pages (25 list, 20 board) | `components/work-items/paging.ts` `pageSizeFor` | 113 | `tests/ui/paging.test.ts` |
| "Show more" is a read action and expanded groups re-request up to their loaded length after a refresh | `use-paged-list.ts` | 112 | `tests/ui/use-paged-list.test.ts` |
| Backup names carry the kind; legacy names count as `migration`; paths with quotes, spaces and non-ASCII work | `db/backups.ts` | 119 | `tests/backups.test.ts` |
| Every copy is integrity-checked and a failing copy is deleted | `backupDatabase` | 119 | `tests/backups.test.ts` ("writes a kinded VACUUM INTO copy") |
| Rotation keeps 20 manual, 10 migration, 5 pre-restore; auto by day, week, month | `planRotation` | 119 | `tests/backups.test.ts` |
| Backup creation by an agent is refused; restore is not a tool | `userOnly` on `create_backup`; `scripts/db-restore.ts` | 120, 121, 104 | registry tests (see engine.md) |
| One maintenance run at a time across processes | `acquireLease(..., "maintenance")` | 120 | `tests/maintenance.test.ts` (retention only; see debt) |
| Retention never deletes the latest undoable batch and never touches activity rows | `retention.ts` | 122 | `tests/maintenance.test.ts` |
| Perf scripts only open a scratch database | `scripts/perf-db.ts` | 115 | `tests/perf-db.test.ts` |
| The fixture is deterministic | `seed-perf.ts` | 115 | `tests/seed-perf.test.ts` |
| No full table scan on `work_item` or `activity` in the hot reads; both 0011 index names appear in the workspace plan | `drizzle/0008`, `0011` | 126 | `tests/perf/query-plans.test.ts`, `tests/perf/list-page.test.ts` |
| Server-only strings never reach the browser bundle | `scripts/bundle-rules.ts` `FORBIDDEN` (`ANTHROPIC`, `sk-ant-`, `better-sqlite3`, `drizzle-orm/better-sqlite3`, `TESSERA_DB_PATH`, `server-only`); no phrase is exempt | 125 | `tests/check-bundle.test.ts` |
| The fake AI client cannot answer the real workspace | `assertFakeAiAllowed` | 124 | `tests/ai/fake-client.test.ts` |
| Console noise in e2e is limited to the field-guide list | `tests/e2e/tolerated.ts`, `fixtures.ts` | 123 | `tests/e2e-tolerated.test.ts` |
| A later write blocks assistant undo; nothing is half-undone | `ai/undo.ts` | 116, 117 | `tests/ai/assistant-undo.test.ts` |
| Several processes opening one fresh database file do not crash and seed one row each | `db/client.ts` | improvements.md | `tests/first-open-race.test.ts` (children: `tests/helpers/first-open.ts`) |
| Only one process applies an automation run | `automations/lease.ts` | 28 | `tests/automations-lease-race.test.ts` |

## 5. Tests

- Vitest (in `npm run check`): `tests/{backups,maintenance,paging,undo,perf-db,seed-perf,check-bundle,first-open-race,automations-lease-race,e2e-tolerated}.test.ts`, `tests/perf/{list-page,query-plans}.test.ts`, `tests/ai/{assistant-undo,fake-client}.test.ts`, `tests/ui/{paging,use-paged-list}.test.ts`.
- Playwright (`npm run test:e2e`, Chromium, one worker, 90 s test timeout, no retries, `forbidOnly`): twenty-four spec files under `tests/e2e/`: the fifteen of the 2026-10-22 run (assistant, collaboration, detail-editor, drag, drag-surfaces, external-writes, intake-drafts-bulk, layouts, mobile, pages, schemes, smoke, views-settings, work-items, workspace), `relations-reactions`, and the round-3 files `coverage-drops` (board, gantt body and edges, calendar, workspace views, states and stickies drops persist across a reload; transfer open items), `coverage-timeline` (gantt connector and Today at 768, week start, overflow at 768 and 1100), `coverage-dialogs`, `coverage-touch` (hasTouch at 375) and `round-features` (coalesced inbox row, mention row, `unread_notifications`, the `[[` page link, assistant Apply then Undo with `fixtures/ai/undo-priority.json`, phone list rows on one line) and the round-4 file `round4` (12 tests: the inbox wording "commented · +1 more" in both orders and a long agent name at 375 px; the project `SectionMenu` at 375 with its keyboard path, the folded-tab tooltips at 768 and the full labels at 1440; the project settings strip at 768 and 1024 and its menu at 375; strict hit boxes of the top bar buttons at 375 and 360; the `[[` picker not offering the page being edited; the two-line Since labels at 375), and the fix-round files `round5` (fix round 5) and `round6` (fix round 6, below). Helpers: `helpers-a.ts`, `helpers-b.ts`, `helpers-c.ts` (`strictHitBoxMisses`, `lastCharVisible`), `helpers-d.ts` (round 5 layout probes and the round 6 early-interaction drivers). The suite has no `test.fixme` or `test.fail`.
- E2E result of 2026-10-22 on a scratch copy of the tree (decisions 123 and 124): the full suite passed except `collaboration.spec.ts` (comment shown in the peek timeline after reload and the Comments filter) and `pages.spec.ts` (the embedded work item does not show Mentioned in). Round 3 added 32 tests (`coverage-*.spec.ts`, `round-features.spec.ts`; the drops and timeline specs also ran four times over with `--repeat-each=4`), and the full suite then passed 88 of 88 twice on scratch copies, `collaboration.spec.ts` and `pages.spec.ts` included.
- E2E result of round 4 (2026-10-23): 100 tests, all passing, none skipped or `fixme`, on a scratch copy of the working tree built with `next build` and served with `next start` on `E2E_PORT=3810`, one worker. The first full run gave 97 passed, 1 failed and 2 not run (serial skips after the failure); the failure was a spec mistake, not an app bug: the long agent client name in the `round4` inbox test contained "name", so its avatar label matched `getByLabel("Name")` in the "New work item" dialog of `work-items.spec.ts` (a strict-mode violation). The client was renamed (`e2e-r4-a-deliberately-long-agent-client-label-for-the-phone-inbox`, still long, no assertion weakened) and `round4`, `work-items`, `views-settings`, `schemes`, `smoke` and `workspace` re-ran green (26 tests). The browser verifier also ran `round4` in a second copy on port 3734 with its `fixme` lines removed, reusing the existing production build because `npm run test:e2e` does not build. Notes for the next run: the header Assistant button stays hidden until `/api/ai/status` says available, so a hand-started server needs `TESSERA_AI_FAKE=tests/e2e/fixtures/ai` (replay only, no API call; the e2e config sets it); and every visit to `/` moves the "last visit" marker, so Since rows must be re-seeded with fresh MCP writes before each measurement.
- Playwright's Desktop Chrome descriptor sends a Windows user agent, so Astryx's `mod` key means Control in the suite even on macOS; the Power K spec presses the page's own modifier (`modifierKey` in `helpers-b.ts`).
- E2E result of round 6 (2026-10-23): `round6.spec.ts` (28 tests, helpers in `helpers-d.ts`, see shell-detail.md section 5) plus the existing files, 138 tests, all passing, none skipped or `fixme`, on a scratch production build of the working tree (the full suite twice, 10.6 and 10.7 min). `round6.spec.ts` with `--repeat-each=10` passed 280 of 280 twice (verify 1's second run and verify 2's run); verify 1's first run had one failure that was a spec-helper mistake, not an app bug: `uniqueIdentifier()` in `fixtures.ts` drew two equal random tails and the second `create_project` answered CONFLICT, so it now draws again when an identifier was already issued in the process, and since the root close-out both project helpers also draw a new identifier when `create_project` answers CONFLICT, which covers a worker that Playwright restarts after a failure. Every round6 case with an early action must land it in the gap (up to 3 attempts in fresh contexts). Final gate of the round on a fresh scratch build: 138 of 138, and `round6.spec.ts` 84 of 84 with `--repeat-each=3`. The e2e lane first ran the new specs against the pre-fix shell in a scratch copy as a baseline proof (docs/drafts/fix-round-6-2026-10-23.md). `round5.spec.ts` no longer waits for hydration before its early toggle (that wait only hid the error), and the helper is removed.
- Perf: `npm run perf:bench` (engine budgets: first list page 40 ms p95 for flat, grouped, workspace, board and the four group projections; `getCounts` 25 ms; analytics overview 60 ms; search 30 ms; detail read 25 ms, which has no budget in decision 115). It runs 3 rounds of 50 calls and reports the round with the lowest p95. Not part of `npm run check`.

## 6. Extension points

- A new backup kind: extend `BackupKind` in `types`, `KIND_KEEP` and the name regex in `db/backups.ts`, then `BACKUP_KIND_LABEL` in `backup-format.ts`.
- A new retention rule: add a query to `planRetention`, its ids to `RetentionPlan` and the delete to `applyRetention`; add the count to `RetentionCounts`, `emptyRetention` and the dry-run summary.
- A new undoable verb: add a branch to `invertRow` in `ai/undo.ts`; until then the whole batch is refused.
- A new forbidden bundle string: append to `FORBIDDEN` in `bundle-rules.ts`.
- A new paged layout: add its size to `pageSizeFor` and its first-page input to `listPaging`; the screen then needs a "Show more" footer wired to `usePagedList`.
- A new e2e spec: import `test` and `expect` from `tests/e2e/fixtures.ts`, create a project with a unique identifier, and use `waitForSaved`, `dragByPointer`, `listRows` from the same file.

## 7. Known debt

- Decision 118 (undo surfaces) is built in part, on purpose. The Applied toast has an Undo button and Power K has "Undo last assistant change"; both name the proposal ids they would undo, and the UI refuses when the newest batch no longer holds them. There is no History view in the assistant panel and no `UndoConfirmDialog` (ai.md section 7).
- Decision 117 differs from the code. The code has no `UNDO_INVERSES` and no `NOT_UNDOABLE` list; it inverts only work-item field updates and archives and refuses any batch holding other activity.
- `undoLastWorkItemChange` (`work-items/undo.ts`) is exported but no registry tool or UI uses it.
- Decision 119's "a failed backup never blocks a migration that has a verified backup from the last 10 minutes" is not in `migrateIfNeeded`: a failing `backupDatabase` throws and the migration stops (the pre-P11 rule). ASSUMPTION: no other file implements the 10-minute exception; the grep for it found none.
- `list_backups` returns `check: null` for every file (`listBackups` never runs `quick_check`), so the Backups screen check column shows a dash. The check runs only when a copy is written.
- Decision 115's Playwright perf spec (p95 of 20 runs to `[data-list-ready]` at most 300 ms) is `tests/e2e/perf.spec.ts` with its own config, `playwright.perf.config.ts`. It is opt-in and not part of `check:e2e`: the spec skips itself unless `TESSERA_PERF=1`, which only that config sets, so the normal suite reports it as 1 skipped. Run it after `next build` with `npx playwright test -c playwright.perf.config.ts`. The config seeds the 10k fixture through `scripts/perf-seed.ts` (`PERF_DB`, default `data/p11-perf.db`; it refuses a file named `tessera.db`) and serves `next start` on `PERF_PORT` (default 3110). `PERF_RUNS`, `PERF_WARMUP` and `PERF_TIMEOUT_MIN` override 20 runs, 2 warm-up rounds and 60 minutes. Results land in `test-results/perf/` (`results.json`, and `perf-runs.json` as each run lands). On HEAD `d26461b` (n=20, 1-minute load 4.2 → 15.8) list and table miss the budget: list p50 11,660 / p95 13,272 ms, board 303 / 344 ms, table 27,543 / 35,717 ms (docs/drafts/perf-2026-10-24/perf-run/baseline/perf-spec.json). After the performance round of 2026-10-28 (lazy date pickers, CSS one-line row text; n=20, load 2.8 → 3.5) the budget is still missed: list p95 1,121 ms, table p95 1,996 ms, board p50 1,028 / p95 1,204 ms (docs/drafts/perf-report-2026-10-24.md §2.6). The board time is bimodal: its marker is in the DOM by about 0.2 s and turns visible either at about 0.3 s or only after the page's 1.0 to 1.2 s of start-up long tasks (1 of 20 runs in that baseline, 12 of 20 in later runs of the same build on a busier machine), so compare the board median as well as its p95. `perf:bench` enforces the engine budgets.
- `tests/maintenance.test.ts` has one test, for retention (latest undoable batch kept, old discarded proposals purged). `runMaintenance` itself (lease, due check, auto backup, dry run) and the scheduler wiring have no direct test.
- The `maintenance` lease is exercised by the same lease code as automations but has no race test of its own.
- Decisions 109 to 111 were dropped by the user and are not built; do not look for them here.
- `pruneBackups` and `BACKUP_KEEP` remain as the legacy prune; only `tests/foundation.test.ts` and `tests/backups.test.ts` call `pruneBackups`, nothing in `src/` or `scripts/`.

## 8. Where to read more

- docs/PLAN.md decisions 112 to 126, and the status lines under 123 and 124.
- docs/drafts/p11-plan.md (design), docs/improvements.md (backlog, first-open race).
- docs/contracts/schema.md "Migrations and database file".
- docs/field-guide/index.md for the tolerated console noise and the dev-server hang.
- operations.md for the scheduler; ai.md for Apply batches; engine.md for the tool registry and `userOnly`.
