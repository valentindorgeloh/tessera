## P10: Layouts and operations (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `b561c8d`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md)
and the P5–P9 plans (docs/drafts/p5-plan.md … p9-plan.md) are delivered:
- `db/schema/` is a folder (P5 lane 0); the P10 tables live in
  `db/schema/hardening.ts` (created by `0000_init`), the workspace singleton in
  `db/schema/workspace.ts`; migrations `0002_ai` … `0006_workspace` exist, so P10's
  migration is `0007_operations`;
- the registry is a folder (`tools/registry/<domain>.ts`, `TOOLS` in
  `registry/index.ts`), work items are a folder (`work-items/*.ts`);
- decisions 29–88 are in docs/PLAN.md;
- P6: pages engine (`pages/*.ts`, `page_version` rows collapsed per actor within
  5 minutes, `list_page_versions`, `restore_page_version`), `PagesScreen` (TreeList),
  `PageScreen`; P7: `relations.ts` (`listRelations`, `relationsFor`), `notify()`,
  `NotificationKindSchema` with `automation` reserved, `Timeline`; P8: `actor.access`
  enforced in `runToolWithContext`, `ToolDef.selfScoped`, `work-items/bulk.ts`,
  `BulkBar`, `selection.ts`; P9: `/settings/general` and `/settings/ai`,
  `workspace/settings.ts` (`getWorkspaceSettings`, `updateWorkspaceSettings`),
  `ProfileScreen`, `StickiesScreen`, `QuickLinksWidget`, `ManageWidgetsDialog`,
  `AnalyticsScreen` with a data `Table` under every chart, `components/charts/`.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P10 contract right before the build. Items marked **refresh before build**
depend on code that P4–P9 have not written yet, or on a line count only their
results can give.

Sources: docs/PLAN.md decisions 4, 6, 10, 13, 14, 18, 20, 23, 24, 28; §1 rows
"Calendar …, gantt …", "Project settings … Automations", "Automations", "Version
history", "Exports", "Webhooks"; §2 "Hardening (P10)" and `RichFiltersSchema`; §9 P10
row (exit: "Gantt date drag writes both dates; automation run logs `system`
activity; export opens in a spreadsheet"); §12 browser check 10 ("Drag a gantt bar
edge → both dates change; a `blocked_by` connector turns red when dates
conflict"). Deferrals inherited: p4-ui.md lines 58–72 (drag reorder of views,
states and labels; state group by drag; Automations tab; timezone; rich filter
evaluation; view export), p6-plan.md lines 71–76 (version history UI, page activity,
page tree drag, page outline), p7-plan.md lines 90–92 (`automation` notifications,
gantt connectors, relation filters and display property), p8-plan.md lines 101–107
(bulk copy/move, archives layout switch, intake rich filters, per-project access,
automations and snoozed intake), p9-plan.md lines 117–121 (drag for stickies, quick
links and Home widgets; estimate totals in group headers; analytics CSV; calendar
and gantt on profiles; rich filters on workspace views).

What already exists (verified on `b561c8d`):
- Tables `work_item_version` (id, work_item_id, name, description_md, version,
  actor_id, created_at; index `(work_item_id, version)`), `export_job` (scope JSON,
  format, status default `pending`, file_path, error, created_*, updated_at),
  `webhook` (url, events JSON default `[]`, secret default `""`, is_active, audit
  columns), `webhook_delivery` (webhook_id, activity_seq → `activity.seq`, status
  default `pending`, attempts, last_error, created_at, updated_at; index
  `(webhook_id, status)`), `automation_lease` (singleton id `automation`, holder,
  expires_at) in `db/schema.ts:743–815` (moves to `db/schema/hardening.ts` in P5).
  Nothing reads or writes them yet; `updateWorkItemDescription`
  (`work-items/update.ts:173`) does not write version rows.
- `project.archive_in_months`, `close_in_months` (`db/schema.ts:106–107`) and
  `close_state_id`, editable through `update_project` (`projects.ts:364–432`,
  `MONTHS = 1..12`). No engine reads them. `scripts/automations.ts` is a placeholder
  ("Automations arrive in P10"); there is no `src/instrumentation.ts`.
- `archiveWorkItem` refuses open items (`RULE archive_open_item`,
  `work-items/lifecycle.ts:17`); `nextCompletedAt` sets `completed_at` only for the
  completed group, so cancelled items have `completed_at = null`
  (`work-items/model.ts:294`).
- `RichFiltersSchema` (recursive `and | or | not | { field, op, value }`),
  `RichFilterFieldSchema` (19 fields), `RichFilterOpSchema` (10 ops) in
  `schemas.ts:116–169`; `view.rich_filters` is stored and round-tripped
  (`views.ts:58,155,202,232,293`) but `filters.ts` (`buildWhere`, 547 lines) and
  `counts.ts` never read it.
- `ExportScopeSchema` (`project_id` nullable, `cycle_id?`, `module_id?`, `filters?`),
  `ExportFormatSchema` (`csv | json`), `ExportStatusSchema`
  (`pending | running | done | failed`), `WebhookEventsSchema` (`string[]`) in
  `schemas.ts:281–292`; row types in `types.ts:95–98,181–186`.
- `LayoutSchema` already has `calendar` and `gantt`; `DisplaySchema.calendar`
  (`{ layout: month | week, show_weekends }`); `FiltersSchema.start_target_date`
  ("only items with both dates (gantt)"). `WorkItemsScreen.tsx:289` renders an
  `EmptyState` "Calendar arrives in P10" / "Gantt arrives in P10".
- `LayoutProps` (`work-items/types.ts:64`) with `onMove`, `onUpdate(id, patch)`,
  `onOpen`, `onQuickAdd`, `readOnly`; optimistic patching in `optimistic-list.ts`.
- `usePointerDrag` (`components/dnd/use-pointer-drag.ts`, 386 lines): containers +
  insertion index, `axis: "x" | "y"`, threshold, `ignoreSelector`, auto-scroll,
  overlay through CSS custom properties; pure maths in `drag-math.ts`
  (`dropIndexFor`, `neighboursAt`, `reorderIds`, …; tested in
  `tests/ui/drag-math.test.ts`). It has no notion of resizing or of a 2-D grid.
- `logActivity(ctx, entry)` with free-text verbs (`activity.ts:16–80`); `comment`
  carries an automation's explanation; `latestSeq()`.
- Astryx 0.6.8: `Grid` (`columns: number | {minWidth,max,repeat}`, `rowHeight`,
  `gap`), `GridSpan` (`columns: number | "full"`, `rows`; no start column), `Calendar`
  is a date picker only (not a month planner); `HoverCard`, `Popover`, `Outline`,
  `Timestamp`, `DateRangeInput`, `SegmentedControl`, `Switch`, `NumberInput`,
  `ToggleButton`, `Collapsible`, `TreeList`, `TabList` (props in §6).
- Next 16 `instrumentation.ts` `register()` runs once per server instance and must
  finish before the server is ready; `process.env.NEXT_RUNTIME` selects the runtime
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`).

### 1. Scope and deferrals

In P10:
- **Calendar layout** (month and week, weekends toggle, drag between days, quick add
  on a day, "Move to date…" menu) and **gantt layout** (rows per item, bars from
  `start_date` to `target_date`, drag the bar to move both dates, drag either edge
  to move one, click an empty row to schedule, week/month/quarter zoom, today line,
  dependency connectors from `blocked_by`, `start_before` and `finish_before`
  relations, red when the dates conflict). Both on the project work items, cycle,
  module, project view and profile lists (decision 18; workspace views stay
  table-only). A **module timeline** on the modules list (the same chart over
  modules, P3 ui.md row 623).
- **Rich filter tree** evaluated everywhere `filters` are (lists, counts, views,
  exports, MCP), a builder UI on the FilterBar ("Advanced"), stored in the URL `q`
  and in views (project and workspace). Two relation fields join the tree (P7
  deferral).
- **Automations** (decision 28): auto-close inactive and auto-archive closed items,
  hourly from `src/instrumentation.ts` and from `npm run automations`, lease-guarded,
  as actor `system`, with `automation` notifications; the project settings
  **Automations** tab.
- **Version history** for work item descriptions and page bodies: version rows for
  work items (decision 10), a history dialog with a line diff and restore, page
  activity in the same dialog, a page outline.
- **Exports**: CSV and JSON of any work item list (project, cycle, module, view,
  workspace), files under `<db dir>/exports/`, a download route, an Exports page in
  workspace settings, "Export…" in list headers and on views, analytics table CSV.
- **Webhooks** (last in the phase): outbound signed POSTs per activity row with a
  retry table, a Webhooks page in workspace settings, user-only management.
- **Remaining operations and settings**: pointer drag to reorder views, states,
  labels, the page tree, stickies, quick links and Home widgets; bulk copy and move
  to another project; estimate totals in list and board group headers; the week
  start setting.

Deferred out of P10:

| Deferred | Phase | Note |
|---|---|---|
| Workspace timezone setting (P4 deferral) | P11 | Changes every `todayLocal()` call site (decision 6); the single-user local install already runs in the user's zone. P10 ships the week-start setting only (decision 101) |
| Changing a state's group by drag (P4 deferral) | not planned | Moving a state across groups would rewrite `completed_at` on every item in it. Drag reorders within a group; a different group means a new state plus delete-and-move (P4 flow). Open question 2 |
| Per-project access overrides (P8 deferral) | not planned | `actor.access` stays workspace-wide (decision 63). Open question 3 |
| Rich filters on Intake (P8 deferral) | P11 | Intake keeps tab, search and source filters |
| Layout switch and display menu on Archives › Work items (P8 deferral) | P11 | List with the P8 bulk bar stays |
| Relations display property in list/table (P7 deferral) | P11 | P10 adds relation filters and gantt connectors |
| Calendar and gantt on workspace views | not planned | Decision 18 (Plane: workspace views are spreadsheets) |
| Gantt sub-item nesting and gantt grouping | not planned | Plane's gantt is flat and ignores grouping; P10 matches (decision 91) |
| Cycle timeline (gantt over cycles) | P11 | The modules list gets the timeline because Plane has it; cycles use their list |
| Drag-to-create a bar spanning several days | P11 | P10 schedules a one-day bar by click, then edge-drag (decision 90) |
| Scheduled exports, export of pages | not planned | Exports cover work items |
| Webhook payload templates, per-project webhook filters | not planned | Event patterns only (decision 102) |
| Incoming webhooks (GitHub sync and similar) | not planned | Out of scope (PLAN §1) |
| A Playwright suite for drag | P11 | P10 proves drag maths in Vitest and drags by hand in acceptance |

### 2. New decisions (lane A writes them into docs/PLAN.md after row 88)

| # | Decision |
|---|---|
| 89 | **Calendar.** Items sit on their `target_date`; no target date = "unscheduled", counted in the header ("N unscheduled", a `Popover` lists them, a click opens the peek). Month view = whole weeks covering the month (5 or 6 rows), week view = one row. `show_weekends: false` drops Saturday and Sunday columns. The first column follows the workspace week start (decision 101). The shown period is URL state `?cal=YYYY-MM-DD` (any day inside it; default today), never saved in display settings. A month cell shows at most 4 items and "+N more" (a `Popover` listing the day). Items in a day follow `display.order_by`. A drop on another day sets `target_date` to that day and, when the item has a `start_date`, moves it by the same number of days (the span is kept), in one `update_work_item` call; a drop on the same day is a no-op. Keyboard path: the item menu "Move to date…" (`DateInput`). Quick add on a day creates the item with that `target_date`. |
| 90 | **Gantt.** One row per loaded item in `display.order_by` order; the left column shows key and name, the right side a day grid. A bar runs from `start_date` to `target_date` inclusive; an item with one date shows a one-day bar on it with the missing end drawn open (dashed). Dragging the bar body moves both dates by the same day delta in **one** `update_work_item { start_date, target_date }` call (PLAN §9 exit); dragging the start edge changes `start_date` only (clamped to ≤ `target_date`), the end edge `target_date` only (clamped to ≥ `start_date`). The day delta is `round(dx / dayWidth)` with `dayWidth` measured from the rendered grid. A click on an empty cell of an undated row sets both dates to that day. Keyboard path: row menu "Set dates…" (`DateRangeInput` in a `Popover`) and "Clear dates". Optimistic through `onUpdate` with revert and Toast (decision 13). The visible range spans the loaded dates padded by 2 weeks, at least 3 months around today; "Today" scrolls to the today line. Zoom `week` (a wide day column, day headers), `month` (narrow days, week headers), `quarter` (narrowest, month headers); widths are tokens in `gantt.css`. |
| 91 | **Layout options.** `DisplaySchema` gains `gantt: { zoom: "week" | "month" | "quarter" (default "month"), show_relations: boolean (default true) }`. Calendar and gantt ignore `group_by` and `sub_group_by` (Plane does the same); the DisplayMenu hides grouping for them and shows the calendar or gantt options instead. Saved display JSON without `gantt` reads the defaults. Calendar and gantt are offered on project, cycle, module, project-view and profile lists; workspace views stay table-only (decision 18). |
| 92 | **Gantt connectors.** Drawn when `display.gantt.show_relations` is on and both items have bars: `A blocked_by B` → arrow from B's end to A's start; `A start_before B` → A's start to B's start; `A finish_before B` → A's end to B's end. A connector is in conflict (error colour, and the row's bar gets a conflict outline with a tooltip naming the blocker) when B's `target_date` is after A's `start_date` (blocked_by; finishing on the same day is fine), A's `start_date` is after B's (start_before), or A's `target_date` is after B's (finish_before). Edges come from `listWorkItems` with `include_relations: true`, which returns `relations: { from_id, to_id, type }[]` (canonical types only) for pairs inside the result. |
| 93 | **Rich filter evaluation.** The list WHERE is `buildWhere(filters) AND buildRichWhere(rich_filters)` for lists, counts, views, exports and MCP. Limits: depth ≤ 4, ≤ 50 conditions, `and`/`or` arrays of 1–20 nodes; anything else is `VALIDATION` with the JSON path. Field/op matrix: single-valued ids (`state`, `cycle`, `parent`, `created_by`, `project`) and enums (`state_group`, `priority`) take `eq, neq, in, not_in, is_null, is_not_null`; multi-valued (`labels`, `module`, `assignees`, `subscriber`, `mentions`) take `in` (has any), `not_in` (has none), `eq` (has this one), `neq` (lacks this one), `is_null` (has none at all), `is_not_null`; `name` takes `contains` (case-insensitive, `%`/`_` escaped), `eq`, `neq`; dates take `before`, `after`, `between` (a `DateFilter` value, relative values resolved with today), `is_null`, `is_not_null`; `estimate_point` takes `eq, neq, in, not_in, is_null, is_not_null` over point values as strings. A wrong op or value shape is `VALIDATION`; unknown ids simply match nothing (as flat filters). `create_view`/`update_view` validate the tree; `describe_filters` documents it. |
| 94 | **Relation fields.** `RichFilterFieldSchema` gains `blocked` (`eq` with `true`/`false`: the item has a `blocked_by` relation to an item that is not completed or cancelled) and `relation_type` (`in, not_in, is_null, is_not_null` over the P7 display types, inverses included: `blocking`, `blocked_by`, `relates_to`, `duplicate`, `start_before`, `start_after`, `finish_before`, `finish_after`, `implemented_by`, `implements`; **refresh before build** against P7's `RelationDisplayTypeSchema`). |
| 95 | **Rich filter UI.** The FilterBar keeps the flat chips; an "Advanced" button opens `RichFilterDialog`: a top-level All/Any switch, condition rows (field, operator, value control, a Not toggle) and groups one level deep with their own All/Any. A tree the builder cannot show (depth > 2, or a `not` around a group) opens read-only as text from `describeRichFilters` with "Clear". An active tree shows one chip "Advanced · N conditions" (clear button) in the FilterBar. The tree lives in the URL `q` blob next to `filters` and is saved with views; view dirtiness compares it. |
| 96 | **Automation rules** (decision 28 made precise). Per project, in this order: **auto-close** when `close_in_months` is set: items in `backlog`, `unstarted` or `started` (never `triage`, so intake items, pending or snoozed, are untouched), not archived, whose `updated_at` is at least N calendar months ago move to `close_state_id`, or the first `cancelled` state by `sort_order` when it is null; `close_state_id` must be a completed or cancelled state (`update_project` refuses others with `RULE close_state_group`). **Auto-archive** when `archive_in_months` is set: completed or cancelled items, not archived, whose `completed_at` (completed) or `updated_at` (cancelled, which has no `completed_at`) is at least N months ago are archived. Each item is its own transaction through the normal service functions as actor `system`, with activity `comment` "Closed automatically after N months without activity" / "Archived automatically N months after closing"; a refusal (`RULE`, `LOCKED`, `ARCHIVED`) skips the item and is counted. At most 500 items per project per rule per run. Recipients get an `automation` notification (P7 `notify`, subscribers and assignees, coalesced). |
| 97 | **Automation runs.** `src/instrumentation.ts` `register()` starts the scheduler only when `NEXT_RUNTIME === "nodejs"` and `NEXT_PHASE !== "phase-production-build"`; `TESSERA_AUTOMATIONS=off` skips the hourly automation timer and `TESSERA_WEBHOOKS=off` the webhook dispatcher (decision 103), independently; a `globalThis` symbol prevents a second scheduler after a dev reload; the first run is 60 s after start, then hourly; timers are `unref()`ed. A run takes the `automation_lease` row (`holder = <pid>:<uuid>`, 15-minute expiry, one conditional UPDATE), so a second server or the CLI skips. `automation_lease` gains `last_run_at` and `last_summary` (JSON: per project closed, archived, skipped, error). Manual runs: tool `run_automations { project_id?, dry_run? }`, `npm run automations [--dry-run] [--project <id>]` and "Run now" on the Automations tab. A dry run returns the counts without writing. The run also prunes `webhook_delivery` rows older than 30 days. |
| 98 | **Work item versions.** Decision 10 now holds for work items as it does for pages (P6): every description write (`create_work_item` with a non-empty description, `update_work_item_description`, `restore_work_item_version`) writes a `work_item_version { name, description_md, version }` row, and when the newest row has the same actor and is under 5 minutes old it is updated in place. Restore is a CAS description write of the stored text (the name is not restored), writes its own row and logs verb `restored`, field `description`, `new_value` = the restored version number. Copies do not copy versions; moves keep them. No pruning. |
| 99 | **History dialog.** One `VersionHistoryDialog` serves work items and pages: versions newest first on the left, on the right a line diff against the previous version (or against the current text, `SegmentedControl`) with word-level marks inside changed lines, using `diff@9.0.0` client-side; "Restore this version" (AlertDialog) calls the restore action with the current `description_version`. Data comes from `GET /api/history/[entityType]/[entityId]` (same-origin guard, `entityType` = `work_item | page`): the newest 100 versions with bodies, and for pages the page's activity (newest 50), shown in a second tab. Opened from the work item detail `MoreMenu` ("Version history", shortcut `shift+h`) and the page menu. |
| 100 | **Exports.** `create_export` runs synchronously inside the tool call and records an `export_job` (status `done` or `failed`). Files go to `<directory of TESSERA_DB_PATH>/exports/<yyyymmdd-hhmmss>-<slug>-<6 id chars>.<csv|json>`. Scope = `ExportScopeSchema` plus `view_id`, `rich_filters` and `archived` (include archived items, default false); a `view_id` applies the view's saved filters, rich filters and order. CSV: UTF-8 with BOM, CRLF, RFC 4180 quoting, cells starting with `=`, `+`, `-`, `@`, tab or CR prefixed with `'` (formula injection); fixed columns `Key, Project, Name, State, State group, Priority, Assignees, Labels, Cycle, Modules, Estimate, Start date, Target date, Parent, Created at, Created by, Updated at, Completed at, Archived at, Description`. JSON: `{ exported_at, scope, count, items }` with ids and resolved names. Cap 50 000 rows (`RULE export_too_large`). `delete_export` removes the file and the row (an export job is a log entry, not an entity; decision 7's soft delete does not apply). Download: `GET /api/exports/[exportId]` with `Content-Disposition: attachment`. Analytics tables export client-side through the same `toCsv`. |
| 101 | **Week start.** `workspace_settings.week_starts_on` (`0` Sunday or `1` Monday, default `1`) drives the calendar columns and the gantt week headers; edited on `/settings/general`. |
| 102 | **Webhook model.** A webhook has `name`, `url` (http or https), `events` (patterns `*`, `<entity_type>.*` or `<entity_type>.<verb>`, e.g. `work_item.updated`, `comment.created`; `WebhookEventSchema`), `is_active`, a server-generated `secret` (32 random bytes, hex) shown in settings and rotatable, and a cursor `last_seq` set to `latestSeq()` at creation (no backfill). Each matching activity row becomes one POST with JSON `{ id: <delivery id>, event: "<entity_type>.<verb>", seq, created_at, actor: { id, name, kind }, project: { id, identifier } | null, entity_type, entity_id, work_item_id, field, old_value, new_value, old_identifier, new_identifier, comment }` and headers `X-Tessera-Event`, `X-Tessera-Delivery`, `X-Tessera-Timestamp`, `X-Tessera-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the secret>`. A test sends `event: "ping"`. |
| 103 | **Webhook delivery.** A dispatcher runs every 10 s in the server (same scheduler and guards as decision 97, lease row id `webhooks`): it turns new activity rows (seq > `last_seq`) into `webhook_delivery` rows for every active matching webhook and advances the cursor, then sends up to 100 due deliveries (`status = pending AND next_attempt_at <= now`) in seq order with a 10 s timeout. 2xx → `delivered`; 410 → the webhook is deactivated; anything else → `attempts + 1`, `last_error`, `response_status`, next attempt after 1 min, 5 min, 30 min, 2 h, 12 h, then `failed`. Redeliver resets a delivery to pending with 0 attempts. Activity written by the MCP stdio server is delivered too (the cursor reads the shared database). |
| 104 | **User-only tools.** `ToolDef` gains `userOnly?: true`; `runToolWithContext` refuses actors other than `user` with `RULE user_only` (before the P8 access check). Webhook writes (`create_webhook`, `update_webhook`, `delete_webhook`, `rotate_webhook_secret`, `test_webhook`, `redeliver_webhook_delivery`) are user-only, so an agent cannot send workspace data to a URL of its choosing; `list_webhooks` and `list_webhook_deliveries` omit the secret for other actors. |
| 105 | **Drag reorder pass.** Views, states, labels, the page tree, stickies, quick links and the Home widget list (ManageWidgetsDialog) reorder by pointer drag through `usePointerDrag`; every "Move up/Move down" menu stays as the keyboard path (decision 14). States drag within their group only (each group is a container; a drop in another group snaps back). Labels: containers are the top level and each parent's children; a drop into another container reparents and reorders in one call (`reorder_label` gains `parent_id`), refused for a label that has children. Page tree: a drop reorders among siblings of the target container (`move_page` with `parent_id` and a neighbour; **refresh before build** against P6's input). Stickies and quick links wrap in a grid, so `drag-math.ts` gains a 2-D `dropIndexForGrid` (row-major, nearest rect). |
| 106 | **Estimate totals in group headers.** List and board group headers show "N pts" next to the count when the project has a `points` estimate and the estimate property is visible: the sum over the group's loaded items, computed client-side (`groupPoints`). Categories and time estimates show no total (decision 66). |
| 107 | **Bulk copy and move.** `bulk_transfer_work_items { work_item_ids (1–100), project_id, mode: "copy" | "move", confirm }` applies P8's single-item transfer rules to every item in one transaction, all or nothing, and returns `{ id, key }[]`; `move` needs `confirm: true`. The P8 `BulkBar` gains "Copy to project…" and "Move to project…" (`ProjectTransferDialog` in bulk mode). |
| 108 | **Module timeline.** The modules list gets a `List`/`Timeline` switch in the URL (`?layout=list|timeline`, decision 88 list controls). The timeline is the gantt chart over modules (`start_date`..`target_date`), with the same drag rules writing `update_module`; no connectors. |

### 3. Data model changes

Migration `drizzle/0007_operations.sql`, generated by `drizzle-kit generate` from
`db/schema/{hardening,workspace}.ts` (lane A). The P10 tables already exist from
`0000_init`; P10 only adds columns and indexes.

| Change | Detail |
|---|---|
| Index `work_item_version_item_created_idx` | `(work_item_id, created_at)`, for the newest-first read and the 5-minute collapse check. |
| `export_job.row_count` | `integer("row_count")`, nullable; set when `done`. |
| `export_job.name` | `text("name").notNull().default("")`: the human title ("WEB · Sprint 4 view"), shown in the Exports list. |
| Index `export_job_created_idx` | `(created_at)`. |
| `webhook.name` | `text("name").notNull().default("")`. |
| `webhook.last_seq` | `integer("last_seq").notNull().default(0)`: the delivery cursor (decision 102). |
| `webhook_delivery.next_attempt_at` | `text("next_attempt_at")`, nullable; null once delivered or failed. |
| `webhook_delivery.response_status` | `integer("response_status")`, nullable. |
| `webhook_delivery.event` | `text("event").notNull().default("")`: the `<entity_type>.<verb>` string (or `ping`), so the list shows it without a join. |
| `webhook_delivery.activity_seq` | Becomes nullable (a `ping` has no activity row). SQLite needs a table rebuild; drizzle-kit generates it. **Refresh before build**: confirm the generated SQL copies the rows. |
| Index `webhook_delivery_due_idx` | `(status, next_attempt_at)`, for the dispatcher. |
| `automation_lease.last_run_at`, `last_summary` | `text("last_run_at")` nullable; `text("last_summary", { mode: "json" }).$type<AutomationSummary>()` nullable (decision 97). The webhook dispatcher uses a second row, id `webhooks`. |
| `workspace_settings.week_starts_on` | `integer("week_starts_on").notNull().default(1)` (decision 101). |

No new tables. No change to `work_item` or `project` (the automation fields exist).
`work_item_version` keeps the exact shape of `page_version` (no `updated_at`): the
5-minute collapse rewrites the newest row in place with P6's rule, whatever P6
chose for `created_at` (**refresh before build**: read `pages/body.ts`). `webhook`
already has `deleted_at` through `auditColumns()` (decision 7).
`db/schema/hardening.ts` must stay under 600 lines (it is about 75 today).

Zod and type additions (lane 0 unless marked A; all client-safe in
`schemas.ts`/`types.ts`):
- `GanttZoomSchema` (`week | month | quarter`), `GanttDisplaySchema`
  (`zoom`, `show_relations`), `DisplaySchema.gantt` with its default and the
  matching key in `DisplayPatchSchema` (**refresh before build**: P4 owns the patch
  schema shape).
- `RichFilterFieldSchema` gains `blocked` and `relation_type` (decision 94);
  `RICH_FILTER_OPS_BY_FIELD: Record<RichFilterField, RichFilterOp[]>` (the decision
  93 matrix, shared by the engine validator and the builder UI);
  `RICH_FILTER_LIMITS = { depth: 4, conditions: 50, children: 20 }`.
- `ExportScopeSchema` gains `view_id: IdSchema.optional()`, `rich_filters:
  RichFiltersSchema.nullable().optional()`, `archived: z.boolean().default(false)`;
  `ExportJobView` (`id, name, format, status, row_count, error, file_name,
  created_at, created_by`).
- `WebhookEventSchema` (regex `^(\*|[a-z_]+\.(\*|[a-z_]+)|ping)$`),
  `WebhookEventsSchema` becomes `z.array(WebhookEventSchema).min(1).max(30)`
  (**refresh before build**: existing rows hold `[]`, so the column type keeps the
  loose array and only the tool inputs use the strict one),
  `WebhookDeliveryStatusSchema` (`pending | delivered | failed`), `WebhookView`
  (`id, name, url, events, is_active, secret?, last_seq, created_at, counts: {
  pending, failed }`), `WebhookDeliveryView`.
- `AutomationSummarySchema` (`{ ran_at, dry_run, projects: { project_id, closed,
  archived, skipped, error: string | null }[] }`), `AutomationStatus` (`last_run_at`,
  `last_summary`, `next_run_at`, per project `{ archive_in_months, close_in_months,
  close_state_id, due_close, due_archive }`).
- `VersionInfo` (`id, version, name, actor_id, created_at, length,
  description_md?`) shared by work items and pages (P6's `PageVersionInfo` becomes an
  alias; **refresh before build**), `HistoryResponse` (`versions`, `activity?`).
- `RelationEdge` (`from_id, to_id, type`) and `WorkItemListResult.relations?`
  (A, in `work-items/model.ts`).
- `WorkspaceSettingsView.week_starts_on` (P9 type).

### 4. Engine additions (lane A)

All new modules export through `index.ts`/`server.ts` like their neighbours; every
mutating export is bound by exactly one tool (decision 26). Clock reads go through
`ctx.now()`; no new module reads `Date.now()`.

#### 4.1 Rich filters (`src/lib/tessera/rich-filters.ts`, new)

```ts
export function validateRichFilters(tree: RichFilters): void;          // VALIDATION { path, reason } on limits or a bad op/value (decision 93)
export function buildRichWhere(ctx: TesseraContext, tree: RichFilters, options: { today: string }): SQL;
export function countRichConditions(tree: RichFilters): number;
```
- Leaves reuse the private helpers of `filters.ts` (`stateIdsInGroups`,
  `hasAnyLabel`, `hasAnyModule`, `hasAnyAssignee`, `hasAnySubscriber`, `mentionsAny`,
  `resolveDateFilter`, `dateCondition`): lane A exports them from `filters.ts`
  without growing it (547 lines; a pure `export` keyword change). Relation leaves
  (`blocked`, `relation_type`) are `EXISTS` sub-queries over `work_item_relation`
  in both directions, mapping display types to canonical type + direction with P7's
  inverse map.
- `work-items/read.ts`: `ListWorkItemsInput` gains `rich_filters:
  RichFiltersSchema.nullable().optional()` ("replaces a view's saved tree; null
  clears it") and `include_relations: z.boolean().optional()`; `resolveScope` picks
  the input tree, else the view's, and ANDs `buildRichWhere` into `where`. With
  `include_relations`, the result carries `relations: RelationEdge[]` from
  `relationEdgesAmong(ctx, ids)` (new export in P7's `relations.ts`: canonical rows
  whose two ends are both in `ids`, not deleted).
- `counts.ts`: the `view` scope (and `countsPopulation`) applies the view's tree, so
  sidebar and view counts keep matching the list (decision 21).
- `views.ts`: `create_view`, `update_view` and `duplicate_view` call
  `validateRichFilters`. The P5 `view-from-prompt` output may now carry
  `rich_filters` (**refresh before build**: P5's `ViewDraftSchema` comment says
  "stored-only until P10"; lane A lifts it).
- `tools/describe-filters.ts`: a "Rich filters" section generated from
  `RICH_FILTER_OPS_BY_FIELD` and `RICH_FILTER_LIMITS` with two examples.

#### 4.2 Versions (`src/lib/tessera/work-items/versions.ts`, new; `history.ts`, new)

```ts
export function writeWorkItemVersion(ctx, item: { id; name; description_md; description_version }): void; // collapse rule of decision 98
export function listWorkItemVersions(ctx, workItemId: string, options?: { limit?: number; include_body?: boolean }): VersionInfo[];
export function getWorkItemVersion(ctx, versionId: string): VersionInfo & { work_item_id: string; description_md: string };
export const RestoreWorkItemVersionInput: z.object({ work_item_id: IdSchema, version_id: IdSchema, expected_description_version: z.int().min(0) }).strict();
export function restoreWorkItemVersion(ctx, input): WorkItem;   // CAS; NOT_FOUND for a version of another item
export function getHistory(ctx, input: { entity_type: "work_item" | "page"; entity_id: string }): HistoryResponse; // history.ts
```
- `work-items/create.ts` (non-empty description) and `work-items/update.ts`
  (`updateWorkItemDescription`) call `writeWorkItemVersion` inside their transaction.
  Both files must stay under 600 (**refresh before build**).
- Pages: `getPageVersion(ctx, versionId)` next to P6's `listPageVersions`
  (**refresh before build** for the file, `pages/body.ts` or `pages/read.ts`).
- `changes.ts` `listActivity` gains the scope `{ entity_type, entity_id }` (page
  activity for the history dialog).

#### 4.3 Automations (`src/lib/tessera/automations/`, new)

```ts
// index.ts
export function runAutomations(ctx: TesseraContext, input: { project_id?: string; dry_run?: boolean }): AutomationSummary; // decision 96
export function getAutomationStatus(ctx: TesseraContext): AutomationStatus;
// rules.ts
export function dueForClose(ctx, project: ProjectRow, now: string, limit: number): string[];   // item ids
export function dueForArchive(ctx, project: ProjectRow, now: string, limit: number): string[];
export function closeTargetState(ctx, project: ProjectRow): StateRow | null;
// lease.ts
export function acquireLease(db: Database, id: "automation" | "webhooks", holder: string, now: string, ttlMs: number): boolean;
export function releaseLease(db: Database, id: string, holder: string): void;
// scheduler.ts (server-only; imported by src/instrumentation.ts)
export function startScheduler(): void; // decision 97: globalThis guard, 60 s then hourly automations, 10 s webhook dispatch, unref()ed timers
```
- The run builds a `system` context (`ctx.actor` = the `system` actor from
  `ensureSystemActors`) with `ctx.activityNote` set per rule; `logActivity` copies
  `ctx.activityNote` into `comment` when the entry has none (`core/context.ts` gains
  the optional field). Closing calls `updateWorkItem(ctx, id, { state_id })`,
  archiving calls `archiveWorkItem(ctx, id)`, each in its own transaction.
- Notifications: `notify(ctx, { kind: "automation", … })` per item, recipients the
  subscribers and assignees (P7 coalescing applies).
- `projects.ts` `updateProject`: `close_state_id` must be a completed or cancelled
  state (`RULE close_state_group`).
- `addMonthsIso(date, n)` moves from `filters.ts` (private `addMonths`) to
  `core/time.ts` (client-safe, tested); `filters.ts` imports it (the file shrinks).
- `scripts/automations.ts` becomes real: `--dry-run`, `--project <id>` and
  `--now <ISO timestamp>` (a testing aid: the run uses that clock; refused unless
  `--dry-run` or `TESSERA_DB_PATH` is not the default `data/tessera.db`), prints the
  summary, exits 0, or 1 when any project reports an error.
- `scripts/webhook-echo.ts` (new dev aid): an HTTP listener on `127.0.0.1:4010`
  that verifies `X-Tessera-Signature` with `--secret <hex>`, logs each delivery and
  answers `--status <code>` (default 200), for acceptance and manual checks.
- `src/instrumentation.ts` (new): `export async function register()` with the
  decision 97 guards and a dynamic `import("@/lib/tessera/automations/scheduler")`.
  **Refresh before build**: re-read the Next 16 instrumentation guide and confirm
  `register` does not run in `next build` workers when `NEXT_PHASE` is set.

#### 4.4 Exports (`src/lib/tessera/exports/`, new; `core/csv.ts`, new)

```ts
// core/csv.ts (client-safe, pure; added to the "use client" allowlist in eslint.config.mjs and check-conventions)
export function csvCell(value: string | number | null): string;      // RFC 4180 quoting + formula guard (decision 100)
export function toCsv(header: string[], rows: (string | number | null)[][]): string; // BOM + CRLF
// exports/index.ts
export const CreateExportInput = z.object({ format: ExportFormatSchema, scope: ExportScopeSchema, name: z.string().max(120).optional() }).strict();
export function createExport(ctx, input): ExportJobView;   // sync; writes the file; status done | failed
export function listExports(ctx, input: { limit?: number }): ExportJobView[];
export function getExport(ctx, id: string): ExportJobView & { file_path: string | null };
export function deleteExport(ctx, id: string): void;       // removes file + row
// exports/rows.ts
export function exportRows(ctx, scope: ExportScope): ExportItem[];  // via listWorkItems (scope → ListScope) so filters, rich filters, view order and archived match the UI
// exports/files.ts
export function exportsDir(): string;   // <dirname(resolveDbPath())>/exports, created on demand
export function exportFileName(job: { created_at; name; id }, format: ExportFormat): string;
```
Activity: `created` / `deleted` on entity `export` (no project unless the scope has
one).

#### 4.5 Webhooks (`src/lib/tessera/webhooks/`, new)

```ts
// index.ts
export function listWebhooks(ctx): WebhookView[];                      // secret only for the user actor
export function createWebhook(ctx, input: { name; url; events; is_active? }): WebhookView; // secret generated, last_seq = latestSeq
export function updateWebhook(ctx, id, patch): WebhookView;
export function deleteWebhook(ctx, id): void;                          // soft delete; pending deliveries -> failed "webhook deleted"
export function rotateWebhookSecret(ctx, id): WebhookView;
export function testWebhook(ctx, id): WebhookDeliveryView;             // enqueues a ping due now
export function listWebhookDeliveries(ctx, input: { webhook_id; status?; limit? }): WebhookDeliveryView[];
export function redeliverWebhookDelivery(ctx, id): WebhookDeliveryView;
// events.ts
export function activityEvent(row: ActivityRow): string;               // "<entity_type>.<verb>"
export function matchesEvent(patterns: string[], event: string): boolean;
export function buildPayload(ctx, row: ActivityRow, deliveryId: string): WebhookPayload;
// sign.ts
export function signPayload(secret: string, timestamp: string, body: string): string; // "sha256=<hex>"
// dispatch.ts
export function enqueueDeliveries(ctx, now: string): number;            // cursor advance, decision 103
export async function sendDueDeliveries(ctx, now: string, fetchImpl: typeof fetch, limit?: number): Promise<{ sent; delivered; failed }>;
export function nextAttemptAt(attempts: number, now: string): string | null; // 1m, 5m, 30m, 2h, 12h, then null
```
- `tools/define.ts`: `ToolDef.userOnly?: true`; the tool runner refuses other actors
  with `RULE user_only` (decision 104), tested over MCP.
- Webhook writes log `created` / `updated` / `deleted` activity on entity `webhook`;
  the dispatcher never delivers `webhook.*` events (no loops).

#### 4.6 Smaller engine edits

- `labels.ts` `ReorderLabelInput` gains `parent_id: IdSchema.nullable().optional()`
  (decision 105): reparent and reorder in one transaction; `RULE label_has_children`
  when a parent would nest.
- `work-items/bulk.ts` (P8): `bulkTransferWorkItems(ctx, input)` (decision 107),
  reusing `transfer.ts` per item.
- `workspace/settings.ts` (P9): `week_starts_on` in the update input and the view.

#### 4.7 Tools (19 new; `tools/registry/{history,automations,exports,webhooks}.ts`, new)

| Tool | Mutates | Destructive | User-only | Input | Returns |
|---|---|---|---|---|---|
| `list_work_item_versions` | no | | | `{ work_item_id, limit?: 1–100 }` | `VersionInfo[]` newest first, no bodies |
| `get_work_item_version` | no | | | `{ version_id }` | `VersionInfo` with `description_md` |
| `restore_work_item_version` | yes | | | `{ work_item_id, version_id, expected_description_version }` | `{ id, description_version }` |
| `get_page_version` | no | | | `{ version_id }` | `VersionInfo` with `description_md` |
| `run_automations` | yes | | | `{ project_id?, dry_run?: boolean }` | `AutomationSummary` |
| `get_automation_status` | no | | | `{}` | `AutomationStatus` |
| `create_export` | yes | | | `CreateExportInput` | `ExportJobView` |
| `list_exports` | no | | | `{ limit?: 1–200 }` | `ExportJobView[]` |
| `get_export` | no | | | `{ export_id }` | `ExportJobView` + `file_path` |
| `delete_export` | yes | yes | | `{ export_id, confirm: true }` | `{ deleted: true }` |
| `list_webhooks` | no | | | `{}` | `WebhookView[]` |
| `create_webhook` | yes | | yes | `{ name, url, events, is_active? }` | `WebhookView` with secret |
| `update_webhook` | yes | | yes | `{ webhook_id, name?, url?, events?, is_active? }` | `WebhookView` |
| `delete_webhook` | yes | yes | yes | `{ webhook_id, confirm: true }` | `{ deleted: true }` |
| `rotate_webhook_secret` | yes | | yes | `{ webhook_id }` | `WebhookView` with secret |
| `test_webhook` | yes | | yes | `{ webhook_id }` | `WebhookDeliveryView` (pending, due now) |
| `list_webhook_deliveries` | no | | | `{ webhook_id, status?, limit?: 1–200 }` | `WebhookDeliveryView[]` |
| `redeliver_webhook_delivery` | yes | | yes | `{ delivery_id }` | `WebhookDeliveryView` |
| `bulk_transfer_work_items` | yes | move only | | `{ work_item_ids: 1–100, project_id, mode: "copy" \| "move", confirm? }` | `{ id, key }[]` |

Changed tools: `list_work_items` (`rich_filters`, `include_relations`), `create_view` /
`update_view` / `duplicate_view` (validation), `describe_filters`, `update_project`
(`RULE close_state_group`), `reorder_label` (`parent_id`),
`update_workspace_settings` (`week_starts_on`), `create_work_item` and
`update_work_item_description` (version rows). None of the new tools is `core`
except `list_work_item_versions` and `restore_work_item_version` (the assistant
restores descriptions on request). P8 access: every new mutating tool is a write.

#### 4.8 Tests (Vitest, lane A)

`tests/rich-filters.test.ts` (each field × op row of decision 93, nesting, limits
with paths, relation fields, list total = `getCounts({ type: "view" })` for a view
with a tree), `tests/work-item-versions.test.ts` (create writes a row, collapse
within 5 min per actor, a second actor starts a row, restore CAS and activity),
`tests/automations.test.ts` (fake clock: close after N months, archive after N
months by `completed_at` and by `updated_at` for cancelled, triage untouched, the 500
cap, dry run writes nothing, activity actor `system` with the note, `automation`
notifications, lease contention between two holders, `RULE close_state_group`),
`tests/exports.test.ts` (CSV quoting, BOM, CRLF, formula guard, view scope and order,
archived flag, JSON shape, the file lands under a temp db's `exports/`, delete
removes it), `tests/webhooks.test.ts` (pattern matching, a fixed HMAC vector, cursor
starts at creation, enqueue per matching webhook, retry schedule and `failed`, 410
deactivation, `webhook.*` never delivered, `RULE user_only` for an MCP actor, secret
hidden from agents), `tests/bulk-transfer.test.ts`, `tests/labels.test.ts` reparent
case, `tests/migration-0007.test.ts` (0006 database with deliveries migrates; rows
kept), `tests/core-csv.test.ts`, and the registry binding test picks up the new tools.

### 5. Routes and data loading

Every read is inside `<Suspense>` with `await io()` before `readTessera` (field guide
"Next 16"); mutations are `toolAction("<tool>")` wrappers; `redirect()`/`notFound()`
outside `try`; no `router.refresh()`.

| Route | File (owner) | Loads |
|---|---|---|
| Existing list routes (project work items, cycle, module, project view, profile tabs) | their `page.tsx` and the shared list loader (U1) | Unchanged, except: the loader passes `include_relations: true` when the resolved display is `gantt` with `show_relations`, and `rich_filters` from the URL `q` blob. The calendar period (`?cal=`) is client state read with `useSearchParams`; the list is already fully loaded (2000-row cap, P4), so no server change. **Refresh before build**: the loader's file after P9's cross-project bundles. |
| `/projects/[projectId]/modules?layout=timeline` | P9's modules list page (U1) | `listModules` as today; the layout param picks `ModulesTimeline`. |
| `/projects/[projectId]/settings/automations` | `settings/automations/page.tsx` (U2) | `getProject`, `listStates` (completed and cancelled), `getAutomationStatus` filtered to the project. The P4 `SettingsTabs` gains the tab between Estimates and Agents. |
| `/settings/exports` | `src/app/(tessera)/settings/exports/page.tsx` (U2) | `listExports({ limit: 100 })`. |
| `/settings/webhooks` | `settings/webhooks/page.tsx` (U2) | `listWebhooks`. |
| `/settings/webhooks/[webhookId]` | `settings/webhooks/[webhookId]/page.tsx` (U2) | `listWebhooks` row (404 → `notFound()`), `listWebhookDeliveries({ limit: 50 })`. |
| `GET /api/exports/[exportId]` | `src/app/api/exports/[exportId]/route.ts` (U2) | Same-origin guard (`request-guards.ts`); streams the file with `Content-Type` `text/csv; charset=utf-8` or `application/json` and `Content-Disposition: attachment; filename="<file name>"`; 404 when the job is missing, failed or the file is gone. |
| `GET /api/history/[entityType]/[entityId]` | `src/app/api/history/[entityType]/[entityId]/route.ts` (U3) | Same-origin guard; `getHistory` (decision 99); `Cache-Control: no-store`. |

Server Actions (new files): `actions/history.ts` (`restoreWorkItemVersionAction`,
`restorePageVersionAction` reusing P6's tool), `actions/automations.ts`
(`runAutomationsAction`, `updateAutomationSettingsAction` → `update_project`),
`actions/exports.ts` (`createExportAction`, `deleteExportAction`),
`actions/webhooks.ts` (the six user-only webhook tools; the Server Action actor is
the user). Additions: `bulkTransferWorkItemsAction` in P8's `actions/work-items.ts`
bulk file, `reorderLabelAction` gains `parent_id` (P4 file), the P9 workspace
settings action gains `week_starts_on`.

The workspace settings pages share P9's settings layout; its tab list gains
"Exports" and "Webhooks" after "AI" (**refresh before build**: P9's
`settings/layout.tsx`).

Recents (`shell/recents.ts` `resolveRoute`, `shell-icons.ts`, U2):

| Path | Label | Icon key → glyph |
|---|---|---|
| `/settings/exports` | "Exports" | `exports` → `ExportIcon` |
| `/settings/webhooks` | "Webhooks" | `webhooks` → `WebhookIcon` |
| `/settings/webhooks/<id>` | `lookup.entityLabel(id) ?? "Webhook"` | `webhooks` |
| `/projects/<id>/settings/automations` | "<project> · Settings" (P4 rule for settings tabs) | P4's settings key |

Query strings (`?cal=`, `?layout=`) never make separate recents entries (P4 rule:
recents key on the path).

Shortcuts (`shortcuts.ts`, U2 registers; U1/U3 bind): `shift+h` Version history on a
work item or page; on the calendar `t` today, `[`/`]` previous/next period; on the
gantt `t` scrolls to today. Power K: "Export this list…", "Open version history",
"Run automations now" (project scope), "Layout: Calendar", "Layout: Gantt".

### 6. Screens and components

Astryx props checked in `node_modules/@astryxdesign/core/dist/*/*.d.ts` 0.6.8:
`Grid` (`columns: number | { minWidth, max?, repeat? }`, `gap`, `rowGap`,
`columnGap`, `rowHeight`, `align`, `justify`), `GridSpan` (`columns: number | "full"`,
`rows`; no start column, so gantt bars place themselves through a className and
custom properties), `HStack`/`VStack` (`ref`, every HTML attribute through
`BaseProps`: `role`, `tabIndex`, `aria-*`, `style`, `onPointerDown`), `Popover`
(`content`, `isOpen`, `onOpenChange`, `placement`, `alignment`, `width`, `label`,
`hasAutoFocus`, `hasLightDismiss`), `HoverCard` (`content`, `placement`, `delay`,
`isEnabled`), `SegmentedControl` (`value`, `onChange`, `label`, `size`, `layout`),
`Switch` (`label`, `value`, `onChange(checked)`, `description`, `isDisabled`),
`NumberInput` (`label`, `value`, `isOptional`, `width`), `DateRangeInput` (`label`,
`value: DateRange | null`, `onChange`, `min`, `max`), `ToggleButton` (`label`,
`isPressed`, `onPressedChange`, `icon`, `isIconOnly`, `size`), `Outline` (`items`,
`activeId`, `scrollContainerRef`, `density`, `hasScrollOnClick`), `Timestamp`
(`value`, `format`, `hasTooltip`), `TabList` (`value`, `onChange`, `size`,
`hasDivider`), `TreeList` (`items`, `density`), `Item` (`label`, `startContent`,
`endContent`, `description`, `onActivate`), `Collapsible` (`trigger`, `isOpen`,
`onOpenChange`). `Calendar` is a date picker and is not used for the layout.
Dialogs and alert dialogs come from `@/components/shell/dialogs` (lint-enforced).
Icons only from `src/themes/catppuccin/icons.tsx`; layout through className + tokens
in `src/components/styles/<area>.css`; no `<div>`/`<span>`, hex or px.

New icons (lane 0): `CaretLeftIcon` = CaretLeft, `HistoryIcon` =
ClockCounterClockwise, `ExportIcon` = Export, `DownloadIcon` = DownloadSimple,
`WebhookIcon` = WebhooksLogo, `AutomationIcon` = ArrowsClockwise,
`AdvancedFilterIcon` = FunnelSimple, `TodayIcon` = CalendarCheck, `OutlineIcon` =
ListDashes, `DependencyIcon` = FlowArrow (all present in `@phosphor-icons/react`).
`CalendarIcon` and `GanttIcon` already exist.

#### U1 Layouts (`src/components/work-items/{calendar,gantt}/`, `src/components/timeline/`, `src/components/dnd/`)

- **LayoutSwitch / DisplayMenu** (`DisplayMenu.tsx`, the comment at line 140 says
  "Calendar and Gantt join it in P10"): two more icon segments (`CalendarIcon`,
  `GanttIcon`) wherever the switch is shown, except workspace views. For calendar
  the menu shows `SegmentedControl label="Calendar view"` Month/Week and `Switch
  label="Show weekends"`; for gantt `SegmentedControl label="Zoom"`
  Week/Month/Quarter and `Switch label="Show dependencies"`; grouping and
  sub-grouping hidden for both (decision 91). Writes go through the existing URL
  state and remembered-settings path.
- **`CalendarLayout`** (`calendar/CalendarLayout.tsx`, `LayoutProps` +
  `weekStartsOn`): header `PanelBar` row inside the content: `IconButton`
  `CaretLeftIcon`/`CaretRightIcon` ("Previous month"/"Next month" or week), a
  `Button` "Today" (`TodayIcon`), the period as `Heading level={3}`, and "N
  unscheduled" as a ghost `Button` opening a `Popover` with an `Item` per item. The
  grid: weekday header `Grid columns={7|5}` of `Text type="supporting"`, then one
  `Grid columns={7|5}` per week; a day cell is a `VStack` (`ref` =
  `registerContainer(date)`, className `tessera-cal-day`, `data-today`,
  `data-outside` for days of another month) with the day number, up to 4
  `CalendarItem`s, "+N more" (`Popover`), and a hover-only ghost `IconButton`
  `PlusIcon` that opens the inline quick add (`onQuickAdd` with the
  `target_date` default; **refresh before build**: `QuickAddGroup` shape).
- **`CalendarItem`**: `HStack` (`ref` = `registerItem(id)`, `itemHandlers`,
  `role="button"`, `tabIndex={0}`, Enter opens) with the state `Icon`, the key
  (`Text type="supporting" hasTabularNumbers`) and the name (`maxLines={1}`), and a
  `MoreMenu` "Open", "Move to date…" (`Popover` + `DateInput`), "Clear target date".
  Pointer drag through `usePointerDrag({ axis: "y", itemsOf })`; `onDrop` →
  `calendarDropPatch(item, toDate)` → `onUpdate(id, patch)`.
- **`calendar-math.ts`** (pure, tested): `calendarWeeks(anchor, view,
  weekStartsOn, showWeekends): string[][]`, `periodLabel`, `shiftPeriod(anchor,
  view, ±1)`, `itemsByDay(items, order)`, `calendarDropPatch(item, toDate):
  { target_date, start_date? } | null` (decision 89).
- **`TimelineChart`** (`src/components/timeline/TimelineChart.tsx`, generic, used by
  gantt and the module timeline): props `{ rows: TimelineRow[]; range: { start;
  end }; zoom; today; weekStartsOn; edges?: TimelineEdge[]; readOnly?; renderLabel(row);
  renderMenu?(row); onCommit(rowId, { start_date, target_date }); onOpen(rowId);
  label }` with `TimelineRow = { id; start_date: string | null; target_date: string |
  null; tone?: "default" | "done" }`. Structure: a scrolling `VStack`
  (`tessera-timeline`) holding a sticky header (`TimelineHeader`: month row and
  day or week row from `timelineScale(range, zoom, weekStartsOn)`) and one `HStack`
  per row: a sticky label cell (`tessera-timeline-label`, `renderLabel` +
  `renderMenu`) and a track (`tessera-timeline-track`, a CSS grid of
  `--tessera-tl-days` columns of `--tessera-tl-day` width, weekend columns shaded,
  the today line). A bar is an `HStack role="button" tabIndex={0}
  aria-label="<label>, <start> to <target>"` with className `tessera-timeline-bar`
  (`data-open-start`/`data-open-end` for one-date items, `data-conflict`), placed by
  `style={{ "--tessera-tl-start": n, "--tessera-tl-span": m }}`, holding two edge
  handles (`HStack` className `tessera-timeline-handle`, `aria-hidden`). A
  `HoverCard` on the bar shows the dates and the conflict text. An undated row's
  track shows a hover cell under the pointer ("Click to schedule").
- **`TimelineConnectors`**: one absolutely placed `<svg>` over the tracks with a
  `<path>` per edge from `connectorPath(fromRect, toRect)`; classNames
  `tessera-timeline-edge` and `[data-conflict]` (stroke tokens in `gantt.css`).
  `aria-hidden`; conflicts are also announced on the bar's label.
- **`use-timeline-drag.ts`** (`components/dnd/`, new hook beside `usePointerDrag`,
  same conventions: threshold, Escape and `pointercancel` cancel, body class,
  click guard): `useTimelineDrag({ dayWidth: () => number; onCommit(id, mode,
  dayDelta) })` → `{ preview: { id; mode: "move" | "start" | "end"; delta } | null;
  barHandlers(id, mode) }`; the preview re-renders only when the day delta changes.
- **`timeline-math.ts`** (pure, tested): `timelineRange(rows, today)`,
  `timelineScale(range, zoom, weekStartsOn)`, `dateToColumn`, `columnToDate`,
  `applyDayDelta(row, mode, delta): { start_date; target_date }` (clamps per decision
  90), `scheduleOnClick(date)`, `connectorPath`, `edgeConflict(edge, rowsById)`
  (decision 92).
- **`GanttLayout`** (`gantt/GanttLayout.tsx`, `LayoutProps` + `relations` +
  `weekStartsOn`): maps items to rows (label = key + name + assignee `Avatar`; menu
  = "Open", "Set dates…" (`Popover` + `DateRangeInput`), "Clear dates"), edges from
  `result.relations`, `onCommit` → `onUpdate(id, { start_date, target_date })`
  with only the changed keys for edge drags and both for a move. A `PanelBar` above
  the chart: "Today" `Button`, the zoom `SegmentedControl`, a `ToggleButton`
  `DependencyIcon` "Show dependencies".
- **`ModulesTimeline`** (`components/planning/ModulesTimeline.tsx`): rows from the
  modules list (label: module logo + name + status `Token`), `onCommit` →
  `updateModuleAction`, no edges; the modules list header gets a `SegmentedControl
  label="Layout"` List/Timeline writing `?layout=` (P9's list controls file;
  **refresh before build**).
- **Group point totals**: `group-points.ts` (pure, tested) `groupPoints(items,
  estimate): number | null`; ListLayout and BoardLayout group headers show `Text
  type="supporting" hasTabularNumbers` "N pts" (decision 106).
- **`WorkItemsScreen.tsx`**: the `EmptyState` branch at line 289 becomes
  `CalendarLayout` / `GanttLayout`; it passes `weekStartsOn` (from the shell's
  workspace settings context, **refresh before build** for P9's provider) and
  `result.relations`.
- Styles: `styles/calendar.css` (`tessera-cal-*`), `styles/gantt.css`
  (`tessera-timeline-*`, zoom widths as `calc()` over spacing tokens, weekend and
  today tokens, connector strokes, `touch-action: none` on bars and handles).

#### U2 Filters, exports, automations, webhooks, settings (`src/components/{filters,exports,automations,webhooks}/`)

- **`RichFilterDialog`** (`filters/RichFilterDialog.tsx`; `Dialog purpose="form"
  width={720}` from `@/components/shell/dialogs`): a `SegmentedControl
  label="Match"` All/Any; one `RichFilterRow` per condition: field `Selector`
  (labels from `RICH_FILTER_FIELD_LABELS`), operator `Selector`
  (`RICH_FILTER_OPS_BY_FIELD[field]`), a value control by kind (`MultiSelector` over
  bundle states, labels, modules, cycles, actors, projects; `Selector` for
  enums; `TextInput` for name; the P4 date filter control for dates; `Switch` for
  `blocked`), a `ToggleButton label="Not" size="sm"` and a remove `IconButton`;
  `RichFilterGroup` (one level) inside a `Card` with its own All/Any; footer
  buttons "Add condition", "Add group", "Clear all", Cancel, Apply. Pure helpers in
  `filters/rich-filter-tree.ts` (tested): `toEditable(tree) | null` (null when the
  builder cannot show it, decision 95), `fromEditable`, `conditionCount`,
  `describeRichFilters(tree, vocab)`.
- **FilterBar** (P4, plus P8/P9 edits): an "Advanced" ghost `Button`
  (`AdvancedFilterIcon`) and, when a tree is active, a `Token` "Advanced · N
  conditions" with a remove button. `url-state.ts`/`filter-state.ts`: `UrlState`
  gains `rich_filters`; views' save and dirty checks include it (P4 views files).
- **Exports**: `ExportDialog` (`exports/ExportDialog.tsx`, `Dialog purpose="form"
  width={480}`): `SegmentedControl label="Format"` CSV/JSON, `Switch label="Include
  archived work items"`, `TextInput label="Name"` prefilled with the list title;
  submit → `createExportAction` with the current scope, filters, rich filters and
  view id; on success a `Toast` with a "Download" action linking to
  `/api/exports/<id>`. Opened from "Export…" in the list header `MoreMenu`
  (WorkItemsScreen's `PanelBar end`; **refresh before build**: P8/P9 may already put
  a `MoreMenu` there), from the view header and from Power K. `ExportsScreen`
  (`/settings/exports`): a `Table` (Name, Format `Token`, Rows, Status `StatusDot`,
  Created `Timestamp`, actions: Download `IconButton`, Delete → `AlertDialog`).
  Analytics (P9 `AnalyticsScreen` data tables): a "Download CSV" `IconButton`
  per table building a `Blob` with `toCsv` (decision 100).
- **Automations tab** (`automations/AutomationsSettings.tsx`): two `Card`s like
  Plane: "Auto-archive closed work items" (`Switch` + `Selector label="Archive
  after"` 1, 3, 6, 9, 12 months) and "Auto-close inactive work items" (`Switch` +
  `Selector` months + `Selector label="Close to state"` over completed and
  cancelled states, default "first cancelled state"); each change →
  `updateAutomationSettingsAction`. Below: "Last run" `Timestamp` with the summary
  line for this project, "Due now: N to close, M to archive", and a secondary
  `Button` "Run now" (`AutomationIcon`) → `runAutomationsAction({ project_id })` →
  Toast "Closed N, archived M".
- **Webhooks**: `WebhooksScreen` (`/settings/webhooks`): a `List` of webhooks
  (`ListItem` name, URL `Text type="code"`, events summary, `Switch` active, counts
  "N failed" as `Badge`), "New webhook" → `WebhookDialog` (`Dialog purpose="form"
  width={560}`: `TextInput` Name, `TextInput` URL (http/https), events as a
  `CheckboxList` of common patterns (`*`, `work_item.*`, `work_item.created`,
  `work_item.updated`, `work_item.archived`, `comment.*`, `page.*`, `cycle.*`,
  `module.*`, `project.*`) plus a `TextInput` for custom patterns). `WebhookScreen`
  (`/settings/webhooks/[webhookId]`): the secret in a read-only `TextInput` with a
  copy `IconButton` and "Rotate secret" (`AlertDialog`), "Send test", "Delete"
  (`AlertDialog`), and a deliveries `Table` (Event, Seq, Status `StatusDot`,
  Attempts, Response, Next attempt `Timestamp`, Redeliver `IconButton`).
- **Workspace settings**: the P9 general form gains `Selector label="Week starts
  on"` Monday/Sunday; the settings tabs gain Exports and Webhooks.
- **Bulk bar** (P8 `BulkBar`): "Copy to project…" and "Move to project…" → P8's
  `ProjectTransferDialog` in a bulk mode (`ids` prop) → `bulkTransferWorkItemsAction`;
  the move asks for confirmation inside the dialog.
- **Shell**: recents rows of §5, Power K commands, shortcut registrations.
- Styles: `styles/{filters,operations}.css` (rich filter rows, exports, webhooks,
  automations).

#### U3 History, pages and the drag pass (`src/components/history/`, P6 `pages/`, P4 `project-settings/`, P9 `home/` and `stickies/`)

- **`VersionHistoryDialog`** (`history/VersionHistoryDialog.tsx`; `Dialog
  purpose="info" width={960} maxHeight="85vh"`) props `{ isOpen; onOpenChange; entity: { type: "work_item" |
  "page"; id; title; descriptionVersion: number; readOnly? } }`: fetches
  `/api/history/...` on open (Spinner, then Banner on error); a `TabList`
  Versions/Activity (Activity for pages only); Versions: a start `List` of rows
  (`Avatar` actor, "Version N", `Timestamp`, length) and the diff pane:
  `SegmentedControl` "Changes"/"Compare with current"/"Full text", the diff as a
  `VStack` of lines (`Text type="code"`, className `tessera-diff-line` with
  `data-change="added|removed"` and word marks inside), "Restore this version"
  primary `Button` → `AlertDialog` → restore action; `CONFLICT` → Banner "This
  text changed since you opened the history" + "Reload". Pure helpers
  `history/diff-lines.ts` (wrapping `diffLines` and `diffWordsWithSpace` from
  `diff`; tested). Page activity rows reuse P7's activity text helpers.
- **Entry points**: work item detail `MoreMenu` "Version history" (`HistoryIcon`,
  `shift+h`) in P7's `DetailHeader`; page `MoreMenu` and `shift+h` in P6's
  `PageScreen`/`PageRowMenu`.
- **Page outline**: `PageScreen` gets a `ToggleButton` `OutlineIcon` "Outline" that
  shows an end `LayoutPanel` with `Outline` (`items` from the editor's headings,
  `scrollContainerRef` = the page scroller). **Refresh before build**: heading ids
  from P6's Tiptap setup (a `headingIds` extension or an `onUpdate` pass in
  `MarkdownEditor`); if the editor gives none, U3 adds a small Tiptap extension in
  `components/editor/heading-ids.ts`.
- **Drag pass** (decision 105), each with `usePointerDrag` and the existing
  Move up/down menus kept: `ViewsScreen` rows (P4) → `reorderViewAction`;
  `StatesSettings` (container per group) → `reorderStateAction`;
  `LabelsSettings` (root + parents) → `reorderLabelAction({ parent_id })`;
  `PagesScreen` `TreeList` (**refresh before build**: whether `TreeList` items
  accept a `ref` and pointer handlers; fall back to a `List` per expanded level) →
  `movePageAction`; `StickiesScreen` and Home `QuickLinksWidget` (grid, the new
  `dropIndexForGrid`) → P9's reorder actions; `ManageWidgetsDialog` list → P9's
  widget order. A `DragHandleIcon` handle shows on row hover where rows have
  `href`s, so a click still navigates (the P4 GAP 19 note).
- `drag-math.ts` gains `dropIndexForGrid(point, rects)` (tested in
  `tests/ui/drag-math.test.ts`); `use-pointer-drag.ts` gains `axis: "grid"`.
- Styles: `styles/history.css` (diff lines and marks via success/error tokens),
  additions to `pages.css` for the outline panel.

### 7. Lane split for swarm workers

| Lane | Starts | Owns (one owner per file) |
|---|---|---|
| **0 prep** (alone, mechanical) | first | `schemas.ts`/`types.ts` additions of §3 (client-safe zod, `RICH_FILTER_OPS_BY_FIELD`, `RICH_FILTER_LIMITS`, `RICH_FILTER_FIELD_LABELS`, view types); the 10 icons of §6 in `icons.tsx`; `core/csv.ts` (`csvCell`, `toCsv`) with `tests/core-csv.test.ts` and its entry in the "use client" allowlist (`eslint.config.mjs`, `scripts/convention-rules.ts`); `addMonthsIso` moved from `filters.ts` into `core/time.ts` verbatim (tested); empty stylesheets `calendar, gantt, filters, operations, history` (header comment only) and their `globals.css` imports. **File-budget splits first**: P10 does not touch `cycles.ts` (925) or `modules.ts` (735), both on the ratchet; `db/schema.ts` is already split (P5). **Refresh before build**: re-read `scripts/file-budget.json` and the line counts after P9; split verbatim at section comments any file P10 edits that is listed or within 40 lines of 600, likely candidates `BoardLayout.tsx` (544 today, before P8/P9: move the column and card into `work-items/board/{BoardColumn,BoardCard}.tsx`), `filters.ts` (547), `WorkItemsScreen.tsx`, `ListLayout.tsx`, `DisplayMenu.tsx`, `FilterBar.tsx`, `work-items/read.ts`, `counts.ts`, `views.ts`, `CommandBar.tsx`, `Sidebar.tsx`. Gate: `npm run check` green, no behaviour change. |
| **A engine** | after 0 | `src/lib/tessera/{rich-filters,history}.ts`, `automations/**`, `exports/**`, `webhooks/**`, `work-items/{read,create,update,versions,bulk}.ts`, `filters.ts` (export keywords only), `counts.ts`, `views.ts`, `changes.ts`, `activity.ts`, `core/context.ts`, `projects.ts`, `labels.ts`, `relations.ts` (P7), the P6 pages version file, `workspace/settings.ts` (P9), `ai/view-from-prompt.ts` (P5), `tools/{define,mcp,describe-filters}.ts` and the tool runner, `tools/registry/{history,automations,exports,webhooks}.ts` + the `TOOLS` index + the `labels`/`work-items` registry entries, `index.ts`, `server.ts`, `db/schema/{hardening,workspace}.ts`, `drizzle/0007_*` + `meta`, `src/instrumentation.ts`, `scripts/{automations,webhook-echo}.ts`, every `tests/**` of §4.8, `docs/contracts/{schema,service-api,tools,ai}.md`, decisions 89–108 into `docs/PLAN.md` (and its §1 rows marked done). Hands off tool names, inputs and `ListWorkItemsInput` additions on day 1 (fixed here). |
| **U1 layouts** | after 0 | `work-items/{calendar,gantt}/**`, `src/components/timeline/**`, `components/dnd/use-timeline-drag.ts`, `work-items/{WorkItemsScreen,DisplayMenu,ListLayout,BoardLayout,types}.tsx?` (+ `board/**` if lane 0 split it), `work-items/group-points.ts`, the shared list loader and the list `page.tsx` files of §5 (include_relations, rich filters read from `q`), `planning/ModulesTimeline.tsx` and P9's modules list screen/page, `styles/{calendar,gantt}.css`, `tests/ui/{calendar-math,timeline-math,group-points}.test.ts`. Places U2's `ExportMenuItem` in the list header. |
| **U2 operations** | after 0 | `src/components/{filters,exports,automations,webhooks}/**`, `work-items/{FilterBar,url-state,filter-state}.ts(x)`, the P4 view header / save files (not `ViewsScreen.tsx`), the P8 `BulkBar` and `ProjectTransferDialog`, `(tessera)/settings/{exports,webhooks}/**` and the P9 settings layout and general form, `projects/[projectId]/settings/automations/**` and P4's `SettingsTabs`, `src/app/api/exports/**`, `actions/{automations,exports,webhooks}.ts`, the bulk actions file (P8) and the workspace settings action (P9), P9 `AnalyticsScreen` table CSV buttons, `shell/{recents,shell-icons,shortcuts,command-source}.ts`, `styles/{filters,operations}.css`, `tests/ui/{rich-filter-tree,recents}.test.ts`. |
| **U3 history and drag** | after 0 | `src/components/history/**`, `src/app/api/history/**`, `actions/history.ts`, P7 `detail/DetailHeader.tsx`, P6 `pages/{PageScreen,PageRowMenu,PagesScreen}.tsx` and `pages.css`, `components/editor/heading-ids.ts` (if needed), P4 `project-settings/{StatesSettings,LabelsSettings}.tsx`, P4 `views/ViewsScreen.tsx`, P9 `stickies/StickiesScreen.tsx`, `home/{QuickLinksWidget,ManageWidgetsDialog}.tsx`, `components/dnd/{drag-math,use-pointer-drag}.ts`, `actions/labels` file (`parent_id`), `styles/history.css`, `tests/ui/{diff-lines,drag-math}.test.ts`, `package.json`/lockfile for `diff`. |

Cross-lane contracts fixed here: the tool names and inputs (§4.7);
`ListWorkItemsInput.rich_filters` and `include_relations`, `WorkItemListResult.relations`;
`DisplaySchema.gantt`; `TimelineChart` props (U1, also used by nobody else in P10);
`ExportMenuItem({ scope, title })` (U2 component, U1 places it) and
`ExportDialog` props `{ isOpen; onOpenChange; scope: ExportScope; title: string }`;
`VersionHistoryDialog` props (U3 component; U3 also places it); `weekStartsOn`
source (P9 workspace settings context). Order inside the phase: lane A's webhooks
land last (decision 102–104), after automations, exports and versions are green.

### 8. New dependencies

| Package | Version | Licence | Why | Notes |
|---|---|---|---|---|
| `diff` (jsdiff) | `9.0.0` (published 2026-04-13) | BSD-3-Clause (allowlisted) | Line and word diffs in the history dialog (`diffLines`, `diffWordsWithSpace`) | No runtime dependencies; ships its own types. Add to `THIRD_PARTY_NOTICES.md`. Install by U3 with `npm install diff@9.0.0 --save-exact`, then `npm run check` (licence gate). |

Nothing else: CSV is `core/csv.ts`, HMAC is `node:crypto`, scheduling is
`setInterval` in `instrumentation.ts`, HTTP is the global `fetch`, the calendar and
gantt are Astryx `Grid`/`Stack` plus CSS.

### 9. Acceptance (on a fresh `data/p10-acceptance.db` after `next build`)

Stop the dev server, `next build`, move any old `data/p10-acceptance.db*` and
`data/exports/` to the scratchpad, `TESSERA_DB_PATH=data/p10-acceptance.db npm run
db:migrate`, then start `TESSERA_AUTOMATIONS=off TESSERA_DB_PATH=data/p10-acceptance.db
next start -H 127.0.0.1 -p 3000` (automations off so step 13 controls the clock; the
webhook dispatcher keeps running, decision 97). MCP:
`TESSERA_DB_PATH=data/p10-acceptance.db npx tsx scripts/mcp-call.ts --client <name>
<tool> '<json>'`. Console clean on every screen (only the known Astryx Table
warnings); Frappé and Latte at 1440 and 375.

1. Create project `WEB` (points estimate on) and 12 items over MCP: 8 with dates
   spread over this month and next, 2 with only a target date, 2 undated. Item
   `WEB-1` "Design", `WEB-2` "Build" with `WEB-2 blocked_by WEB-1`; `WEB-3`
   `start_before` `WEB-4`.
2. Work items › layout switch › Calendar: month grid starts on Monday; the items sit
   on their target dates; "2 unscheduled" lists the undated ones; Previous/Next/Today
   and `[`/`]`/`t` page the month; `?cal=` follows.
3. Drag `WEB-5` (start 3rd, target 5th) to the 12th: `get_work_item` shows target
   12th and start 10th (span kept), two activity rows by the user; reload keeps it.
   "Move to date…" moves another item by keyboard only.
4. Display: Week view, hide weekends (5 columns); `/settings/general` › Week starts
   on Sunday → the calendar's first column is Sunday. Quick add on a day creates an
   item with that target date.
5. Layout switch › Gantt: one row per item, bars span their dates, the one-date items
   show open-ended bars, the today line is visible, Zoom Week/Month/Quarter changes
   the headers.
6. Drag the body of `WEB-1`'s bar 3 days right: `get_work_item WEB-1` shows **both**
   dates moved by 3 in one update (activity rows share one request; PLAN §9 exit).
7. Drag `WEB-1`'s end edge past `WEB-2`'s start: the `blocked_by` connector and
   `WEB-2`'s bar turn red, the hover card names `WEB-1` (PLAN §12 check 10). Drag it
   back: the connector returns to normal. "Show dependencies" off hides connectors.
8. Click an empty day on an undated row: both dates become that day; "Set dates…"
   with the keyboard sets a range on the other undated row; "Clear dates" clears it.
9. A cycle and a module list and the "Assigned" profile tab offer Calendar and
   Gantt; a workspace view offers table only.
10. Modules list › Timeline: modules with dates show bars; dragging an edge changes
    the module's date (`get_module`).
11. Filters › Advanced: Any of (priority is Urgent, label is Bug) AND NOT state group
    is Completed → the list and the header count agree; the `q` URL round-trips on
    reload. Save as a view; the sidebar/view count equals `get_counts { scope: {
    type: "view", view_id } }`; `list_work_items` over MCP with the same tree returns
    the same total. A tree of depth 4 set over MCP opens read-only with "Clear".
12. Rich filter `blocked` is true → only `WEB-2`; complete `WEB-1` → `WEB-2` drops out.
13. Settings › Automations for WEB: auto-close after 1 month to "Cancelled",
    auto-archive after 1 month. "Due now" shows 0. Run `npm run automations --
    --dry-run --now <today + 2 months>`: it reports N to close and M to archive and
    writes nothing (activity unchanged). Run it again without `--dry-run`: open items
    move to Cancelled with activity by **System** and the note "Closed automatically
    after 1 month without activity" (PLAN §9 exit), completed items are archived, an
    intake item in triage is untouched, the Inbox shows `automation` notifications,
    the tab's "Last run" shows the summary. A second concurrent run reports the lease
    held.
14. Edit `WEB-6`'s description twice within a minute (one version row), then as MCP
    `bot-a` (a second row). Version history (`shift+h`): three rows with actors; the
    diff marks the changed words; restore the first version → the description
    returns, a `restored` activity row appears, the history shows a new version.
    `list_work_item_versions` over MCP agrees.
15. A wiki page: edit, then Version history shows versions and the Activity tab; the
    Outline lists the headings and scrolls to them.
16. Rename an item to `=SUM(1,2)`; from the saved view, Export… CSV: a Toast offers
    Download; the file in `data/exports/` opens in Numbers (or LibreOffice) with the
    20 columns, accents intact, and `=SUM(1,2)` shown as text (PLAN §9 exit). JSON
    export has `count` = the view's total. `/settings/exports` lists both; Delete
    removes the file. An analytics table downloads as CSV.
17. Start `npx tsx scripts/webhook-echo.ts --secret <secret>` after creating a
    webhook on `/settings/webhooks` (URL `http://127.0.0.1:4010`, events
    `work_item.*`); "Send test" logs a `ping` with a valid signature; update an item
    → one `work_item.updated` delivery, signature valid, status Delivered.
18. Restart the echo with `--status 500`; update an item: the delivery shows attempt
    1 failed with the next attempt in about 1 minute, then attempt 2. Restart with
    200 and Redeliver → Delivered. `--status 410` deactivates the webhook.
19. Over MCP as `bot-a`: `create_webhook` → `RULE user_only`; `list_webhooks` shows
    no secret.
20. Drag reorder: a view in the views list, a state within its group (a drop in
    another group snaps back), a label into another parent, a page in the wiki tree,
    a sticky, a quick link and a Home widget; each order survives reload; every Move
    up/down menu still works.
21. Select 3 items › Copy to project `OPS` → 3 new OPS items; select 2 › Move to
    project (confirm) → they leave WEB with new keys; old keys redirect.
22. List and board group headers show "N pts" for the points estimate.
23. Start the server once without `TESSERA_AUTOMATIONS=off`: the log shows one
    scheduler start and no second one after a page reload; `next build` with the
    variable unset still exits (no hanging timers).
24. `npm run check` (types, lint, convention gate, licence gate, Vitest) green.

### 10. Risks

| Risk | Mitigation |
|---|---|
| `instrumentation.ts` timers run in `next build` workers or twice after a dev reload, keeping processes alive or doubling runs | Decision 97 guards (`NEXT_PHASE`, `globalThis` symbol, `unref()`); the lease makes a double run harmless; acceptance step 23 |
| SQLite contention: the 10 s dispatcher and an hourly run write while requests write | Short transactions per item and per delivery batch; the existing busy timeout; network I/O happens outside transactions (enqueue, then send, then record) |
| Gantt with 2000 rows (the P4 list cap) renders slowly: every row is a full-width track | `content-visibility: auto` on rows in `gantt.css`; drag previews re-render one row; virtualisation goes to P11 with the 10k-item pass |
| Pixel-to-day rounding feels jumpy at Quarter zoom | `dayWidth` measured from the DOM; the hover card shows the dates being set during a drag; keyboard "Set dates…" for exact values |
| Calendar and gantt date maths drift across time zones | Only `YYYY-MM-DD` strings and `core/time` helpers; no `Date` in render (field guide); pure maths tested |
| Rich filter trees produce slow SQL (`EXISTS` per leaf) | Limits of decision 93; indexes on the join tables already exist; a Vitest builds the largest allowed tree over 2000 items and asserts it runs under a time bound |
| Webhooks leak data to an agent-chosen URL | Decision 104 (user-only writes); secrets hidden from agents; `webhook.*` events never delivered |
| A failing receiver piles up deliveries | Six attempts then `failed`; 410 deactivates; deliveries pruned after 30 days |
| Automations surprise the user by closing or archiving | Both are off until set per project (fields null); dry run and "Due now" counts on the tab; activity names System with the reason; archive is reversible (`unarchive_work_item`) |
| Migration rebuilds `webhook_delivery` to make `activity_seq` nullable | The table is empty before P10 in practice; `tests/migration-0007.test.ts` copies rows anyway |
| `TreeList` may not expose refs or pointer handlers for drag | Fallback in §6 U3 (a `List` per expanded level); **refresh before build** |
| P4–P9 files the lanes edit have grown past the budget | Lane 0 splits first (§7) |
| `diff` adds client bundle weight | About 30 KB unminified, loaded only by the history dialog (dynamic `import()` inside it) |

### 11. Open questions for the user (each with the default the plan uses)

1. **Calendar drop with a start date**: move the start date too, keeping the span
   (default), or move only the target date (Plane) and refuse drops before the start?
2. **State group by drag** (Plane allows it): not planned (default), because items
   would change completed status in bulk; or build it in P11 with a confirmation that
   counts the affected items?
3. **Per-project agent access** (an agent writes in one project only): not planned
   (default); or P11?
4. **Timezone setting**: deferred to P11 (default; the server's local date stays
   "today"), or needed now?
5. **Webhook secret display**: always visible on the webhook page (default; local
   single-user install), or shown once at creation like GitHub?
6. **Export location**: next to the database, so `data/exports/` for the default path
   (default), or a folder you pick?
7. **Automation defaults for new projects**: off (default, as Plane), or auto-archive
   after 3 months by default?
8. **Gantt rows for undated items**: shown with click-to-schedule (default), or hidden
   unless "Show undated" is on?
9. **Diff library**: add `diff@9.0.0` (default), or hand-write a line diff to avoid a
   dependency?

### Refresh before build (checklist for the contract planner)

- Line counts and `scripts/file-budget.json` after P9; lane 0's split list (§7).
- P6: the page version file, its collapse rule for `created_at`, `move_page` input,
  heading ids in `MarkdownEditor`, `PageVersionInfo` → `VersionInfo` alias.
- P7: `RelationDisplayTypeSchema` values (decision 94), `relations.ts` exports,
  `notify()` signature, `DetailHeader` menu, activity text helpers.
- P8: `BulkBar`, `ProjectTransferDialog`, `bulk.ts`, the access check location in the
  tool runner (decision 104 goes before it).
- P9: settings layout and general form, workspace settings context for
  `weekStartsOn`, the modules list controls file, reorder actions for stickies,
  quick links and widgets, `AnalyticsScreen` table component, the list loader after
  cross-project bundles.
- P4: `DisplayPatchSchema` shape for `gantt`, `QuickAddGroup` for calendar quick add,
  the view header/save files, `SettingsTabs`.
- P5: `ViewDraftSchema` (rich filters allowed now).
- Next 16: the instrumentation guide (build-time behaviour of `register`).
- `TreeList` ref and pointer-handler support (U3 page tree drag).
