# As-built map: operations (P10): calendar, gantt, rich filters, automations, history, exports, webhooks

State described: the working tree after the fix-all round (2026-10-21) and the visual alignment round (2026-10-22, on HEAD 5f0cc7c: gantt connectors measured in pixels, 25% state-colour bars, touch targets for the timeline layouts, calendar layout fixes). Line counts are tree counts. Fix round 3 (2026-10-23) refreshed only the calendar chips and the phone week view. Fix round 5 (2026-10-23) changed only the webhooks row (create-time assignees emit an event). Fix round 6 (2026-10-23) added only the webhooks row's ruling and a test. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Plan: docs/drafts/p10-plan.md. Work item and page version history is mapped in pages-collaboration.md; this file covers the rest.

## 1. Purpose and boundaries

P10 added two more layouts for the work items list (calendar and gantt), a rich filter tree (the "Advanced" button), a background scheduler (automations, maintenance and the webhook dispatcher), CSV and JSON exports, and signed outbound webhooks. The scheduler runs inside the Next server process; every engine entry point also works from a script or the MCP stdio server.

Lives elsewhere (this area only calls it):
- The screen that hosts every layout (`WorkItemsScreen`, `FilterBar`, `DisplayMenu`, url state, paging helpers): work-items.md; page sizes and "Show more": hardening.md.
- Version history dialog and its API: pages-collaboration.md.
- The maintenance job, backups and retention that the same scheduler runs: hardening.md.
- Automation settings tab is mapped here (it is the operations UI); the other project settings tabs: views-settings.md.
- Shared drag hooks `usePointerDrag`, `useTimelineDrag`: `src/components/dnd/**`.

## 2. File map

### Engine (`src/lib/tessera/`)

| File | Responsibility | Key exports |
|---|---|---|
| `rich-filters.ts` (381), `rich-filter-spec.ts` (89) | Validates a filter tree (depth 4, 50 conditions, 20 children per node; a bad node is VALIDATION with the JSON path) and compiles it to SQL. The list WHERE is `buildWhere(filters) AND buildRichWhere(rich)` for lists, counts, views, exports and MCP. The field and operator matrix lives in the spec file so the dialog shares it. | `validateRichFilters`, `buildRichWhere`, `RICH_FILTER_LIMITS`, `RICH_FILTER_OPS_BY_FIELD`, `countRichConditions` |
| `work-items/timeline.ts` (85) | Opt-in gantt extras of `listWorkItems`: `include_date_range` (dates of the whole filtered set whichever page is loaded) and `include_relations` (edges that touch the loaded rows). | `dateRangeOf`, `relationsOf`, `withTimeline` |
| `automations/index.ts` (169), `rules.ts` (96), `lease.ts` (41), `scheduler.ts` (96) | `runAutomations` closes inactive items then archives closed ones, each item in its own transaction as `system`; a held lease returns `lease_held: true` and writes nothing; `dry_run` only counts. Rules select by calendar months; at most 500 items per rule per run. The scheduler starts from `src/instrumentation.ts`. | `runAutomations`, `getAutomationStatus`, `acquireLease`, `releaseLease`, `startScheduler`, `dueForClose`, `dueForArchive` |
| `exports/index.ts` (124), `rows.ts` (184), `files.ts` (26); `core/csv.ts` (22) | `create_export` writes the file during the tool call into `<db directory>/exports/` and records an `export_job` (done or failed). Rows come through `listWorkItems`, so filters, rich filters, view order and `archived` match the screen; cap 50,000 rows. CSV has a UTF-8 BOM, CRLF, RFC 4180 quoting and a leading apostrophe on formula-like cells. | `createExport`, `listExports`, `deleteExport`, `exportRows`, `toCsv` |
| `webhooks/index.ts` (298), `dispatch.ts` (197), `events.ts` (89), `sign.ts` (11) | Outbound webhooks. Events are `*`, `<entity>.*` or `<entity>.<verb>`. The dispatcher turns new activity (seq above the webhook cursor) into deliveries, then sends due ones outside the writer's transaction. Signature `X-Tessera-Signature: sha256=` of HMAC over `<timestamp>.<body>`, plus `X-Tessera-Event`, `-Delivery`, `-Timestamp`. Since fix round 5 a create with assignees logs an `added` row on field `assignees` (`syncAssignees`), so a subscribed webhook also receives `work_item.added` for it (engine.md section 7). Webhooks are an activity stream with one delivery per activity row, so a create with assignees emits `work_item.created` and then one `work_item.added` per assignee, and a create without assignees emits only `work_item.created`; the round 6 ruling keeps this (decisions 50 and 51), pinned by `tests/webhooks.test.ts`. | `createWebhook`, `rotateWebhookSecret`, `testWebhook`, `redeliverWebhookDelivery`, `enqueueDeliveries`, `sendDueDeliveries`, `signPayload` |

Registry tools: `automations.ts` (`run_automations`, `get_automation_status`), `exports.ts` (create, list, get, delete), `webhooks.ts` (list, create, update, delete, rotate secret, test, deliveries, redeliver; writes are user-only, decision 104). Wrappers: `actions/{automations,exports,webhooks}.ts`. Route: `api/exports/[exportId]` (GET, download).

### Routes (`src/app/(tessera)/`)

| Path | Responsibility |
|---|---|
| `projects/[projectId]/settings/automations/page.tsx` | Mounts `AutomationsSettings`. |
| `settings/exports/page.tsx`, `settings/webhooks/page.tsx`, `settings/webhooks/[webhookId]/page.tsx` | Export jobs list; webhook list and one webhook with its recent deliveries. |
| Work item list routes (project, cycle, module, view, profile) | Pass `exportScope` to `WorkItemsScreen`; the loaders add `calendar_window` and the gantt extras through `listPaging` and `ganttListExtras`. |

### Components

| Path | Responsibility | Key exports |
|---|---|---|
| `work-items/CalendarLayout.tsx` (383), `calendar-math.ts` (146, pure) | Month and week grid from `?cal=YYYY-MM-DD` (never saved); weeks start on the workspace week start; items sit on `target_date`, undated ones sit in an "N unscheduled" popover; a cell shows 4 items and "+N more"; a drop on another day sets the target and shifts the start by the same days; each chip has a "Move to date" control (the keyboard path; inert without hover, so on touch the chip opens the detail panel and the peek's Target date field moves it, verified with a tap at 375 px); a read-only chip (archived scope) has no Move control and no `data-draggable`, but still shows the pointer cursor and opens the peek (`.tessera-cal-open`); at 480 px and narrower the week view hugs its chips (`flex: none`, `grid-auto-rows: auto`, a 178 px cell for 3 chips on the fixture) instead of stretching, while 768 and 1440 keep the stretch; the today marker is a 20 px accent circle; a narrow cell opens its quick-add in a popover. | `CalendarLayout`, `calendarWeeks`, `itemsByDay` |
| `work-items/GanttLayout.tsx` (369), `gantt-scale.ts` (223), `gantt-scroll.ts` (144), `date-span.ts` (163) | One row per item; a bar runs start to target inclusive (one date draws a dashed open end). Body drag writes both dates in one update, an edge writes only its end, clamped. Zoom Week, Month, Quarter. Dependency connectors for `blocked_by`, `start_before`, `finish_before`; a conflicting edge and bar are drawn in the error colour and the bar gets a tooltip naming the blocker. "Today" and `t` centre the today line. Per-row "Set dates" popover is the keyboard path, and the move path on touch; it mounts its two date fields only while open (Astryx 0.6.8 `Popover` keeps closed content mounted: two calendars per row, 16,800 day cells on a 200-row page). Band labels, names and bar labels are `OneLineText` (one-line class in `gantt.css`, tooltip when cut, measured on hover), not `Text maxLines`. Bars are the state colour at 25% over the surface with a border in that colour and a primary-text label; the connector layer is drawn in CSS pixels from measured metrics (`gantt-metrics.ts`, 53), so arrowheads keep their shape at any zoom and on 44 px touch rows. | `GanttLayout`, `ganttEdges`, `connectorPaths`, `conflictNotes`, `todayScrollLeft`, `useTodayScroll`, `calendarDropPatch`, `applyDayDelta` |
| `planning/ModulesTimeline.tsx` (353) | The gantt chart over modules (`?layout=timeline` on the modules list); same drag rules, writes `update_module`; no connectors. Its Set-dates popover (`ModuleDates`) and labels follow the gantt's: date fields mounted only while open, `OneLineText` labels. | `ModulesTimeline` |
| `work-items/layout-param.ts` (29), `table-sort.ts` (38) | `?layout=` folds into `q` and is dropped (URL only); table header sort sets the server `order_by`. | `layoutFromParam`, `orderByFromSort` |
| `filters/RichFilterDialog.tsx` (321), `rich-filter-tree.ts` (203), `rich-filter-labels.ts` (206) | The builder: an All/Any group, condition rows, groups one level deep. A tree it cannot show (deeper, or a `not` around a group) opens read-only as text with Clear only. | `RichFilterDialog`, `toEditable`, `describeRichFilters` |
| `work-items/FilterBar.tsx` | "Advanced · N conditions" button with a remove icon button while a tree applies. | `FilterBar` |
| `project-settings/AutomationsSettings.tsx` (262) | Auto-archive and auto-close months, close state, status (Due now, Last run), Run now (an info toast when another process holds the lease). | `AutomationsSettings`, `LEASE_HELD_TEXT` |
| `exports/ExportDialog.tsx` (95), `ExportsScreen.tsx` (185) | Name, CSV or JSON, include archived; list with download and delete. | `ExportDialog`, `ExportsScreen` |
| `webhooks/*` | Create or edit, secret reveal and rotate, Test, delete, deliveries with status tokens; custom event patterns are validated client-side. | `WebhooksScreen`, `WebhookScreen`, `webhookEventError` |

## 3. Data and control flow

### Read path
1. A list loader merges saved settings and `q`, then calls `listWorkItems` with `listPaging` (the calendar sends `calendar_window` for the visible weeks plus unscheduled items, capped at 1000) and `ganttListExtras` (`include_date_range`, `include_relations` when the layout is gantt).
2. The gantt range comes from the whole filtered set, so "Show more" never shifts the bounds.
3. Automation status is read by the settings page action; exports list by `listExports`.

### Write path
1. Layouts write dates through `onUpdate` (an optimistic `update_work_item`); calendar and gantt drags go through `useTimelineDrag`/`usePointerDrag`, and the revert plus toast path is shared with the board.
2. `instrumentation.ts` starts the scheduler once per process (`globalThis` guard, not in the build phase or edge): automations 60 s after start then hourly, maintenance 5 minutes after start then hourly, webhooks every 10 s. `TESSERA_AUTOMATIONS=off` skips the first two, `TESSERA_WEBHOOKS=off` the third.
3. Each job takes a row in the lease table (`automation`, `maintenance`, `webhooks`; 15-minute expiry, one conditional UPDATE), so a second server or the CLI skips.
4. A failed webhook delivery never rolls back the work item change. Retries after 1 min, 5 min, 30 min, 2 h, 12 h, then `failed`; HTTP 410 deactivates the webhook; Redeliver resets a delivery.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| Calendar: target-date placement, unscheduled count, drop shifts start by the same delta, window follows the week start | 89, 101 | `calendar-math.ts`, `date-span.ts`, `paging.ts` | `tests/ui/{date-span,paging}.test.ts` (`calendar-css.test.ts` guards chip layout) |
| Gantt: inclusive bars, clamped edge drags, one update for a body drag | 90 | `date-span.ts`, `GanttLayout.tsx` | `tests/ui/{date-span,gantt-layout,gantt-scale,gantt-scroll}.test.ts` |
| Gantt options `zoom` and `show_relations` live in `display.gantt`; calendar and gantt ignore grouping | 91 | `view-settings.ts`, `DisplayMenu.tsx` | `tests/e2e/layouts.spec.ts` (no Vitest for the `gantt` display keys) |
| Connector conflicts: blocker ends after the start, or start/finish order broken | 92 | `gantt-scale.ts` `edgeConflict` | `tests/ui/gantt-scale.test.ts` |
| Rich filter limits, operator matrix, VALIDATION with the JSON path | 93, 94 | `rich-filters.ts` | `tests/rich-filters.test.ts` |
| Builder shows trees one level deep; the rest read-only | 95 | `rich-filter-tree.ts`, `RichFilterDialog.tsx` | `tests/ui/rich-filter-labels.test.ts` |
| Automation rules by calendar months; triage never touched; close state must be completed or cancelled | 96 | `automations/rules.ts`, `projects.ts` | `tests/automations.test.ts` |
| One runner at a time (lease); a second reports `lease_held` and writes nothing | 28, 97 | `automations/lease.ts` | `tests/automations.test.ts`, `tests/automations-lease-race.test.ts` |
| Exports: BOM, CRLF, formula guard, same rows as the screen | 100 | `exports/rows.ts`, `core/csv.ts` | `tests/exports.test.ts`, `tests/core-csv.test.ts` |
| Webhook events, signature, retry schedule, 410 deactivates, cursor starts at creation, `webhook.*` never enqueues | 102, 103 | `webhooks/*` | `tests/webhooks.test.ts` |
| Webhook writes are user-only; agents never see the secret | 104 | `tools/registry/access.ts` | `tests/webhooks.test.ts` |
| Module timeline writes `update_module` with the gantt drag rules | 108 | `ModulesTimeline.tsx` | `tests/ui/modules-timeline.test.ts` |
| Gantt range and relations from the whole filtered set | 90, 92, 112 | `work-items/timeline.ts` | `tests/timeline.test.ts` |
| Week start 0 to 6 on calendar, gantt headers and date pickers | 101 | `useWeekStart` | `tests/ui/week-start-store.test.ts`, `week-start-pickers.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/{rich-filters,automations,automations-lease-race,exports,core-csv,webhooks,timeline,work-item-versions}.test.ts`; `tests/helpers/automation-runner.ts` runs child processes for the race.
- UI: `tests/ui/{date-span,calendar-css,calendar-layout,gantt-layout,gantt-scale,gantt-scroll,gantt-css,gantt-connectors,gantt-metrics,gantt-dates-lazy,row-truncation,modules-timeline,layout-param,table-sort,rich-filter-labels,automations-settings,webhook-format,week-start-store,week-start-pickers}.test.ts` (`gantt-css` and `calendar-layout` read the stylesheets and the layout under jsdom).
- Playwright: `tests/e2e/layouts.spec.ts` (gantt body drag writes both dates and a blocked_by connector turns into a conflict; the end handle changes only the target; a calendar drag writes the target; an advanced filter narrows the list; an export downloads and appears under Settings, Exports; a webhook is created, deactivated and deleted), `tests/e2e/drag.spec.ts` (Move to date, Set dates).
- Scripts: `scripts/webhook-echo.ts` is the local echo server for a manual signed delivery walk (127.0.0.1:4010, `--secret`, `--status`).
- No Vitest: `CalendarLayout` render, `RichFilterDialog` interaction, `ExportDialog`, `ExportsScreen`, `WebhooksScreen`, `WebhookScreen`, `dispatch.ts` network error paths beyond the cases above.

## 6. Extension points

- New layout: a component taking `LayoutProps`, a branch in `WorkItemsScreen` where `display.layout` picks it, a member of `LayoutSchema`, and `listPaging` if it needs a window.
- New rich filter field: `RICH_FILTER_OPS_BY_FIELD` and `RICH_FILTER_FIELD_LABELS` in the spec file, a case in `buildRichWhere`, and a value control in the dialog.
- New automation rule: `rules.ts` selector, a branch in `projectSummary` (`automations/index.ts`), a project column and a row in `AutomationsSettings`.
- New scheduled job: a timer and a lease id in `scheduler.ts`, and an environment switch.
- New webhook event source: activity already feeds the dispatcher; add the event name to `COMMON_WEBHOOK_EVENTS` for the picker.
- New export column: `CSV_HEADER` and `csvRows` in `exports/rows.ts`.

## 7. Known debt and quirks

- Playwright `page.mouse` alone does not drive `useTimelineDrag`; the specs dispatch pointer events.
- `touch-action: none` sits on gantt bars and calendar chips only under `(pointer: fine)`: on touch a bar or chip scrolls, the resize handles stay grips, and the move paths are the Set-dates popover (gantt) and the open detail panel (calendar).
- Gantt, modules timeline and calendar controls are 44px at a coarse pointer or 480px and narrower (decision 14): the Astryx buttons through the theme's touch adaptations, and the rows, open button, bar height and calendar chips through `gantt.css` and `calendar.css`. The bar and row look at 1440 (32px rows, 28px buttons) is unchanged. The resize handles are 16px wide with a 44px hit area reaching out from the bar's edge, so a one-day bar is mostly handle on a phone; the keyboard path (the row's "Set dates") stays.
- Today scroll is instant, not smooth (a smooth scroll is dropped by an unfocused page).
- A gantt conflict from a relation whose other end is outside the loaded page has no bar to anchor, so no tooltip.
- In a narrow calendar (container under 33rem) a chip shows only the key; the chip's aria-label keeps key and title.
- Calendar zoom levels (week, month, quarter) exist for the gantt only; the calendar has month and week.
- The calendar loads the visible window only, capped at 1000 items with a Banner when cut.
- Exports run synchronously inside the tool call (decision 100), capped at 50,000 rows.
- Webhook delivery history older than the retention window is purged by the automation run and the maintenance job (hardening.md).
- The webhook echo walk and the gantt drag/export download were closed by manual runs on 2026-10-19, not by Playwright.

## 8. Where to read more

| Topic | Read |
|---|---|
| Layouts, filters | docs/drafts/p10-plan.md, docs/PLAN.md 88–95, 108 |
| Automations, webhooks, exports | docs/PLAN.md 28, 96–97, 100–104; `src/lib/tessera/automations/` |
| Acceptance walks | docs/PLAN-STATUS.md "P10 acceptance leftovers", "Webhook echo walk" |
