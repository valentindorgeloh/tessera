# Tessera: what needs improving (2026-10-18)

Reconciled on 2026-10-21 at HEAD f3be717 (after Cursor's 12 commits 07a59d1..f3be717). Sources: a four-area code audit (plan items, perf/engine, UI/a11y, state/docs) and two browser runs on scratch databases (ports 3300 and 3400, never :3000 or `data/tessera.db*`). Where audit and browser disagreed, the browser decided behaviour and the code decided structure. Gates at HEAD: `npm run check` green (tsc, eslint, vitest 139 files / 2093 tests, conventions, licences, theme); `next build` and `check:bundle` pass on a scratch copy. Re-check an item before working on it.

## Open

### Features from the plan
- Page history has no Activity tab (p10 step 15, decision 99): `src/components/history/VersionHistoryDialog.tsx` has no tabs and never reads `history.activity`, though `GET /api/history/page/<id>` already returns the newest 50 rows.
- Drag reorder, views list (p10 step 20, decision 105): no `usePointerDrag` in `views/ViewsScreen.tsx`, `ViewRow.tsx`, `ViewMenu.tsx`; only the menu Move up/down.
- Drag reorder, states within a group (decision 105): `project-settings/StatesSettings.tsx:75-85` menu Move up/down only.
- Drag reorder, labels with drop-to-reparent (decision 105): `LabelsSettings.tsx` has menu Move to / Move up/down only, and `ReorderLabelInput` (`labels.ts:214`) has no `parent_id`, so the engine part is missing too.
- Drag reorder, wiki/page tree: `pages/PagesScreen.tsx` and `PageRowMenu.tsx:130-139` have menu moves and `MovePageDialog` only.
- Drag reorder, stickies: `StickyCard.tsx:145-146` menu Move earlier/later only; the 2-D helper `dropIndexForGrid` does not exist in `dnd/drag-math.ts` (only `dropIndexFor`, l.52).
- Drag reorder, quick links: `home/QuickLinksWidget.tsx:75-76` menu Move left/right only.
- Drag reorder, Home widgets: `home/ManageWidgetsDialog.tsx:63-67` menu Move up/down only.
- Gantt conflict tooltip naming the blocker (decision 92): conflicts get the error path and outline (browser), but the bar only gains an aria-label suffix ", date conflict" (`GanttLayout.tsx:207-209`); no tooltip.
- Analytics "Download CSV per table" (p10 U2): chart data tables have it, but the plain tables (Top assignees, Projects in `analytics/OverviewPanel.tsx:128,154`; cycle and module tables in `PlanningPanels.tsx:95,157`) have none (browser confirmed).
- Automations tab is missing from the command palette: `shell/command-source.ts:192-199` `PROJECT_SETTINGS_TABS` stops at Agents.
- Playwright suite (decision 123) is a 5-test shell smoke (`tests/e2e/smoke.spec.ts`) on `next dev`, with no globalSetup, console-error fixture or feature specs; AI fake client for e2e (decision 124, `TESSERA_AI_FAKE`, `tests/e2e/fixtures/ai/`) is not built.

### Bugs
- (high) Page header stacks copies: `PageScreen.tsx:194-206` gives `PageTitle`, `PageMeta` and `PageBodyEditor` the same `key={page.id}` as siblings, so every lock/unlock (button or Shift+L) and every Outline toggle adds another title+meta block until reload (browser: titles 1 → 3 → 5).
- Page Outline says "No headings yet" on a page that already has H1–H3 until the first keystroke: `editor/heading-ids.ts` assigns ids only in `appendTransaction` on a doc change, and `useOutlineFromDOM` drops id-less headings (both browser runs on a wiki page; audit reproduced under jsdom).
- Gantt "Today" button and `t` do nothing in Month (the default) and Quarter zoom, and the gantt opens at scrollLeft 0: `todayRef` points at the sticky head-day cell (`GanttLayout.tsx:55,69,128`); `scrollIntoView` on `.tessera-gantt-today` works (browser).
- Cycle and Snooze pickers ignore "Week starts on": `planning/CycleDialog.tsx:134` `DateRangeInput` and `inbox/SnoozeDialog.tsx` `DateTimeInput` pass no `weekStartsOn` (browser: New cycle shows Su first with Monday set).
- Failed lock flashes "Unlocked" for about 0.8 s next to the error toast: rollback of the optimistic value in `use-optimistic-lock.ts:18-24` reads as an unlock to `nextLockFeedback` (`LockControl.tsx:38-40`, `lock-state.ts`) (browser confirmed).
- Automations "Run now" toasts "Automations completed: 0 closed, 0 archived." when another process holds the lease: `AutomationsSettings.tsx` (`runNow`, l.118) ignores `lease_held`; the button also stays enabled during a run (browser).
- First-open race: `ensureWorkspaceSettings` (`workspace/settings.ts:42-60`, called from `db/client.ts:51`) is check-then-insert; 1 of 6 simultaneous first opens of a fresh DB crashed with `UNIQUE constraint failed: workspace_settings.id` (audit ad-hoc run). Use `ON CONFLICT DO NOTHING`.
- Unknown cycle id is recorded in recents when cycles are off: `cycles/[cycleId]/page.tsx:67-70` renders FeatureOffState before looking up the id, so `RecentsTracker` stores the path (browser: present in `tessera.recents.v1`). Modules and views share the ordering.
- A filter matching nothing shows "No work items yet / Create the first one" (`ListLayout.tsx:418`) instead of a no-results state (browser: "Advanced · 3 conditions", 0 results, 38 items in project).
- Rich filter, deep tree: the view page's Advanced button reads plain "Advanced" (no count), and the read-only dialog still offers Add condition / Add group (`filters/RichFilterDialog.tsx`, browser).
- Burnup "Scope" label (`planning/BurndownChart.tsx:123`, `insideTopRight`) now clears its dotted line but the dashed Ideal line runs through the text (browser screenshot).
- Settings > General helper under "Week starts on" says "Applies to the calendar layout." (`WorkspaceSettingsScreen.tsx:71`), but it also drives the date pickers.
- Bulk "Copy to project…" lists the source project, so a same-project copy is allowed (`BulkTransferDialog.tsx`); decision 107 is silent. Decide and record.

### Accessibility, 375 px and visual
- Project-scope work item page has two level-1 headings: the frame title is `Heading level={4} accessibilityLevel={1}` (`ProjectFrame.tsx:67`, `PanelHeader.tsx:78`, renders `<h4 aria-level=1>`) plus the item title `h1` (`WorkItemDetail.tsx:105`). The browser's "one h1" count was on `/work-items/<id>` (no frame) and does not count aria-level.
- 375 px project tab strip: tabs get 118 px, only "Work items" shows, and Astryx's 32 px fade lands on that label, so nothing hints at six more tabs (`ProjectFrame.tsx:62-73`, `shell.css:99-114`; browser scrollWidth 632 vs 118).
- 375 px board column is 350 px in a 325 px content box (`board.css:36-45`, `BoardLayout.tsx:53`; browser).
- 375 px drawer search placeholder clips to "Search v…" in a 47 px input (`shell/TopBar.tsx:73-95`, `shell.css:19-22`; browser).
- Calendar chip keys wrap mid-id ("WEB-" / "35") at 375 and at 1440 with the peek open: the key `Text` has no nowrap (`CalendarLayout.tsx:262-267`, `calendar.css:55-63`; browser).
- 375 px gantt and module timeline give the label column 256 of 357 px, leaving about 100 px of timeline (browser).
- Calendar chips have no hover or pressed feedback in either scheme, and an outside-month chip has the same background as its muted cell (`calendar.css:33-35,44-69`; browser saw no change on hover/press). This is the open part of the user's "weird calendar" report.
- Table first column: header text sits 12 px left of the key text (browser: header 303, key 315, panel title 307 at 1440). `table.css:15-21` gives both `--spacing-3` and the key button adds its own 12 px; `docs/contracts/ui.md:68` promises 16 px alignment and the file comment contradicts itself.
- List rows: the key lines up with the header (307 = 307), but the last chip ends 13 px from the panel edge versus 17 px for the header actions (`work-items.css:28-35`, 12 px padding against the 16 px inset in `ui.md:66`); the comments are stale.
- Detail heading gained 20 px under the title (`detail.css:77-99`, `padding-bottom 0` → `--spacing-5` in 07a59d1, no decision; browser: 44 px title → main at 1280); the "symmetric padding" comments are wrong for main (20/40).
- Page screen: opening the Outline narrows the body (898 vs 926 px), and `PanelPage width="reading"` was replaced by a raw `Layout` + `tessera-reading` (`PageScreen.tsx:129,174`); check against ui.md's reading width.

### Perf and paging
- Workspace-scope list keeps 2 bare `SCAN work_item` allowed in `tests/perf/query-plans.test.ts`, while decision 126 (`docs/PLAN.md:209`) says such a scan fails. Add an index or write the exception into decision 126.
- Labels group projection sits on its 40 ms p95 budget: 34.4 ms then 40.5 ms (OVER) on a 12k-item scratch DB with `scripts/perf-bench.ts`. The p11-plan §10 fallback (smaller first page for multi-valued groupings or a GROUP BY path) is not applied (`components/work-items/paging.ts:35-36`).
- Automation lease has no true race test: `tests/automations.test.ts:151-196` holds the lease sequentially; a 6-process ad-hoc run gave 1 winner, 4 skips and 1 crash (the first-open race above).
- `npm run perf:bench` prints "500+ in PERF" because it counts a LIMIT 500 sample (`scripts/perf-bench.ts`); cosmetic.

### Docs and housekeeping
- Field guide `docs/field-guide/index.md:30` still says a token def anywhere silences every file. Since 6092055 `--tessera-*` names resolve only through the defining file or its css/ts counterpart (`scripts/convention-rules.ts` `visibleOurTokens`). Reword it (reconciler-owned).
- `css-token` rule remaining leniency: Astryx-family names (`--color-`, `--spacing-`, …) pass when defined anywhere in `src`, names outside the listed families are unchecked, and `--font-body`/`--font-code` are exempt (`convention-rules.ts:154`).
- `docs/as-built/`: P4 and P6–P11 are not mapped; `README.md` still says snapshot 257798c and omits `ai.md`; `work-items.md:98,153` (calendar/gantt EmptyState "until P10") and `engine.md` (MCP route "until P6") contradict the code.
- `PLAN-STATUS.md`: P5 row says done 2026-10-18 (commits are 2026-10-17) and does not say live acceptance never ran; P10 "done" hides unbuilt §9 items (Activity tab, drag reorder); P11 "zero open todos" though the cache lane was skipped and Playwright is a 5-test smoke; P2a/P2b/P3 still say "user acceptance still to come"; the rework list (lines 238-245) is stale (archived read-only is closed).
- `docs/PLAN.md` decisions 109–111 and 123–124 read as built; mark them skipped or partial once the user decides (see below).
- `drizzle/meta` holds snapshots 0000–0002 only; migrations 0003–0010 are hand-written, so `drizzle-kit generate` cannot diff them.
- Test gaps: no tests for `AutomationsSettings`, `BulkTransferDialog`, `ModulesTimeline`, the `?layout=` effect, the CSV download button, the `useWeekStart` store, `weekStartsOn` on any picker, or the engine `dateRangeOf`/`include_date_range` (`work-items/timeline.ts:34-48`).
- Stale worktree `.claude/worktrees/app-visual-rework-250c6c` (branch merged at ad30062). It no longer breaks lint (`eslint.config.mjs:88` ignores `.claude/**`); removing it is state-changing git for the root planner.

## Waiting for the user
- Cache lane, decisions 109–111: nothing built (no `'use cache'` in `src`, no `src/app/_cache/`, no `tests/cache-safety.test.ts`); `docs/PLAN.md:192-194` and the P11 scope lines still describe it. Decide: drop or rewrite the decisions, or schedule a loader split.
- Live P5 acceptance with the real model: needs about $1–3 of API usage per run and your approval; never ran. The no-cost route (decision 124 fake client) is not built.
- Playwright is no longer waiting: Chromium (build 1243 for 1.63.0) is installed and `npm run test:e2e` runs; 5/5 smoke tests passed again on 2026-10-21 on a scratch copy of f3be717 (run it outside the checkout while a `next dev` is running there, since both use `.next`).

## Future features (not bugs)
From the Plane comparison; not built and not in the plan.
- Dock/undock (floating) sidebar; Tessera has collapse, resize and the mobile drawer only.
- Per-user sidebar display preference (icon only vs icon with label); the collapse-to-icons rail already exists.
- 300 ms ease-in-out layout and content transitions (only `board.css:95` animates).
- Virtual scrolling for very long lists; paging (decision 112) covers the current load.
- Calendar zoom levels week/month/quarter (the calendar has month and week views; zoom was built for the gantt).

## Closed

### Verified 2026-10-21 at f3be717
- Automations settings tab: switches, months, Close to state, Run now, Due now, Last run all work (browser). Lease toast is open above.
- Bulk Copy/Move to project (decision 107): copy made OPS-6..8, move shows the destructive confirm, `/browse/WEB-13` redirects to OPS-9 (browser; `tests/bulk-transfer.test.ts`).
- Rich filter dialog shows field/operator/value names; deep trees show the `describeRichFilters` sentence; views list counts rich conditions ("List · 4 filters").
- `?layout=` param: gantt and board switch and fold into `q`, bogus is ignored, saved view settings unchanged (browser).
- Scheduler start log (`automations/scheduler.ts:25`, once per process).
- "N pts" group totals on list, board and table (`GroupFooter.tsx:48`, `tests/paging.test.ts`).
- Gantt zoom Week/Month/Quarter: bands, day widths, bar widths and today line correct in all three (browser). Today button is open above.
- Gantt dependency lines: blocker-end → blocked-start arrows, red conflict path and outlines, Show dependencies toggle, connector follows a drag (browser). Tooltip is open above.
- Modules Timeline: drag by 3 days persists after reload, a side-panel date edit moves the bar (browser).
- Analytics chart data tables download CSV with BOM and matching rows (browser). Plain tables are open above.
- `weekStartsOn` on DateControl, property rail, calendar move and module pickers (browser: Mo first). Cycle and Snooze are open above.
- Week start first paint: server HTML already carries the right first weekday (browser).
- Week start after a change: in-app navigation shows the new first weekday and boundary items with no reload (browser).
- Webhook echo walk (5442c6f; `tests/webhooks.test.ts` live server case).
- Gantt drag writes both dates in one update and export download has BOM + header (77fa428, read from `data/p10-dev.db`).
- Cycle-scope partial index `work_item_cycle_idx`: cycle list, detail, progress and counts plans use it with no bare SCAN (`tests/perf/query-plans.test.ts`).
- Migrations 0000–0010 apply on a temp DB, re-run applies 0, `integrity_check` ok.
- Table select-all note "200 loaded of 230" above the table and in the BulkBar (decision 114, browser).
- Gantt range comes from the whole filtered set: "Show 30 more" shifts nothing (browser).
- Table header sort sets server `order_by` (asc, desc, clear; browser).
- Set-dates popover calendar has exactly one tab stop when today is before min (browser).
- Switch inputs and the webhook secret input have accessible names via `label[for]`.
- Export Delete "double toast": one visible card; the extra node is the Astryx live-region mirror (both browsers).
- 375 px calendar Today label does not truncate (browser).
- Archived project work items are read-only in every layout (`tests/ui/work-items-screen.test.ts:264-282`).
- Text alignment audit: key, title and chip text midlines match in list and table; input placeholders sit correctly (browser). Inset mismatches are open above.
- Latte and Frappé accent contrast pass WCAG for default placements (`tests/themes/catppuccin-contrast.test.ts`).
- Lock/unlock success path from the header, Shift+L, page-row and view-row menus, with one "Unlocked" fade (browser). Failed-lock flash and header stacking are open above.
- Sidebar already collapses to an icon rail with tooltips (250 → 48 px, browser); the layout switcher is already central (`DisplayMenu.tsx:152`, `WorkItemsScreen.tsx:366`).
- `docs/PLAN.md` decision 29 (moved keys) and escaped pipes in row 33; field guide at 48 of 80 lines; `docs/as-built/ai.md` added.

### Earlier (2026-10-18 and 2026-10-19)
- `/agents/[actorId]` build failure fixed (aaa2b38); paging review round (0dab9d7); `--spacing-16` gantt/calendar offset fixed and backups use a bound `VACUUM INTO` parameter (408a624).
- Lock control with neutral/locked/unlocked feedback, motion in `src/components/styles/lock-control.css`.
- `week_start` setting (0–6) with a Selector, calendar math and the server calendar window (decision 112) follow it.
- Calendar math cleanup, migration test for 0009, `bulk.css` token fix, `css-token` convention rule.
- Old keys after a project move resolve in `get_work_item_by_key`, `/browse` and Power K (`work-items/moved-keys.ts`).
- Invalid rich filters return VALIDATION with the JSON path (decision 93).
- Bundle gate no longer ships ANTHROPIC to the client; version history shows each version's actor.
- Decision rows 42–108 copied into `docs/PLAN.md`; four eslint unused-variable warnings removed.
- P10 engine proofs: exports are spreadsheet-ready, webhooks sign, retry on 500, deactivate on 410; all AI routes use the loopback guard.
