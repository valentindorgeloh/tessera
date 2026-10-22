# Tessera: what needs improving (2026-10-18)

Reconciled on 2026-10-22 against the working tree after the fix-all round (HEAD e04b840 plus the round's uncommitted changes; nine lanes, two fix rounds, a browser verify pass on scratch copies, never :3000 or `data/tessera.db*`). Gates on that tree: the round's gate is green, and the reconciler re-ran `tsc --noEmit` (clean), `eslint .` (clean), `vitest run` (177 files / 2360 tests pass) and `scripts/check-conventions.ts` (passed). Playwright: 50 passed / 3 failed before fix round 2; after it the full suite passes, 54 of 54 on a scratch production build (2026-10-22). Re-check an item before working on it.

## Open

### Features from the plan
- Workspace views list has no drag (decision 105 names "Views"): `views/WorkspaceViewsScreen.tsx` is not wired, though `ViewRow` takes the same optional `drag` prop as the project list.
- Menu Move up/Move down in views, states, labels and the page tree are not optimistic (decision 13); only the drags are. Low.

### Accessibility, 375 px and visual
- Inbox header at 375 px: title clipped to "I…" and the Snoozed tab half faded (verify sweep). `inbox.css` now puts the tabs on their own row under 600 px, copied from the project frame header, but it is not browser-verified.
- Gantt per-row dates button and the Today button stay 28 px (size sm) at 375 px; only the rows are 44 px (timeline lane).
- PowerSearch field overlaps its "0 results" text at 375 px on a view page (seen by the list-screen lane, not fixed).
- `charts/SeriesCharts.tsx` data tables have no column floors at 375 px; the analytics, cycles and modules tables do (`analytics/table-widths.ts`).
- Not browser-verified this round: Latte for the calendar chips, the gantt and the page outline (checked from token values; the in-app browser's scheme emulation does not switch the app, set `tessera.scheme.v1` instead), a real touch drag on the page-tree grip, and a mid-drag 375 px board with scroll-snap.

### Docs and housekeeping
- `docs/contracts/ui.md`: the route-group lines near the top, the "Home at `/home`" bullet and the P2b table naming `TabBar.tsx` and `tab-registry.ts` are stale (Home is `/`, there are no tabs).
- `docs/as-built/pages-collaboration.md` describes the page outline as it was before the fix-all round (ui.md "Page screen: the outline" is current).
- Stale code text: the `[[` page trigger in `editor/mentions.tsx` still says "Pages arrive in P6" and inserts nothing; the ASSUMPTION header comments in `detail/CommentComposer.tsx` and `CommentItem.tsx` and the subscribe toast predate P7.
- Undo of an assistant apply has engine actions but no UI (no Undo on the "Applied N changes" toast, no history view); recorded in `docs/as-built/ai.md` known debt.

## Waiting for the user
- Live P5 acceptance with the real model: needs about $1–3 of API usage per run and your approval; never ran. The no-cost route (decision 124 fake client, `TESSERA_AI_FAKE`) is now built and `assistant.spec.ts` passes on it.

## Planned for P12 (docs/drafts/p12-plan.md)
- Dock/undock (floating) sidebar.
- Three sidebar modes: full, 48 px icons, 60 px icons with labels (persisted, on the existing collapse rail).
- Layout and content transitions (about 300 ms, ease-in-out, honouring `prefers-reduced-motion`).
- Virtual scrolling for long lists, boards, tables and gantt rows, working with paging (decisions 112–114).
- Calendar zoom Week / Month / Quarter, consistent with the gantt zoom (decision 90).

## Closed

### Fixed in the fix-all round (2026-10-21)
- Docs after the round (2026-10-22): `reorderLabel` takes `parent_id` in `service-api.md`; `ui.md` records the detail-route heading level, the below-600 px tab row and drawer search, the page outline layout, "Mentioned in" and the scope lookup order; `as-built/shell-detail.md`, `planning.md` and `ai.md` refreshed at 85140b6.
- Full Playwright suite end to end after fix round 2: 54 of 54 pass on a scratch production build; decisions 123 and 124 record it. `workspace.spec.ts` now polls the sidebar sum, which streams in after the analytics total.
- Page history Activity tab (decision 99): `tests/ui/version-history.test.ts`; browser PASS.
- Drag reorder, views list (decision 105): browser PASS (drag, reload keeps order); `tests/ui/view-reorder.test.ts`; e2e `drag-surfaces.spec.ts`. No grips while the search field has text, by design (a filtered list would compute neighbours against hidden rows).
- Drag reorder, states within a group: browser PASS; e2e pointer and menu variants pass.
- Drag reorder, labels with drop-to-reparent (`ReorderLabelInput.parent_id`): `tests/labels.test.ts` (5 new); browser PASS incl. the nest zone.
- Drag reorder, page tree (grip on movable rows, touch only from the grip): `tests/ui/pages-drag.test.ts`; e2e pointer variant passes.
- Drag reorder, stickies (`dropIndexForGrid`): `tests/ui/drag-math.test.ts`, `stickies-reorder.test.ts`; browser PASS in both themes and at 375 px.
- Drag reorder, quick links (touch scrolls, menu is the touch path): `quick-links-reorder.test.ts`, `home-touch-css.test.ts`; browser PASS.
- Drag reorder, Home widgets (44 px grip at coarse pointer / 480 px): `widgets-reorder.test.ts`, `home-touch-css.test.ts`; browser PASS, grip 44x44 at 375 px.
- Stickies Move earlier / quick links Move left placed nothing (neighbour sent as `before_id`): fixed; e2e specs un-fixme'd and pass.
- Gantt conflict tooltip naming the blocker (decision 92): `tests/ui/gantt-layout.test.ts`; browser PASS (tooltip keeps pointer capture).
- Analytics Download CSV on Top assignees, Projects, Cycles, Modules, with per-table accessible names and 44 px at 375 px: `analytics-csv.test.ts`, `analytics-touch-css.test.ts`; browser PASS.
- Automations in the command palette: `command-source.test.ts`, `shortcuts.test.ts`; browser PASS.
- Playwright suite (decision 123) and AI fake client (decision 124): 15 spec files on `next start` + `data/e2e.db`; console fixture limited to `tests/e2e/tolerated.ts` (`tests/e2e-tolerated.test.ts`); intake, collaboration and pages specs fixed after the run and pass on a scratch build.
- (high) Page header stacking: `tests/ui/page-screen.test.ts`; browser PASS.
- Outline empty until the first keystroke: `tests/editor/heading-ids-initial.test.ts`.
- Gantt Today / `t` / first open centre the today line in every zoom: `gantt-scroll` tests; browser PASS at 1024 and 375.
- Cycle and Snooze pickers follow "Week starts on": `week-start-store` and picker tests.
- Failed lock flashed "Unlocked": LockControl derives feedback from the server value; tests; browser PASS.
- Run now with `lease_held` (info toast, nothing refreshed): `tests/ui/automations-settings.test.ts`; browser PASS.
- First-open race (also WAL `SQLITE_BUSY` and concurrent migrations): `tests/first-open-race.test.ts`.
- Unknown cycle/module/view id recorded in recents: `scope-lookup` test; browser PASS (not found in every feature state).
- Filter matching nothing shows a no-results state with Clear filters: `tests/ui/no-results.test.ts`; browser PASS in list, board, table.
- Rich filter deep tree: "Advanced · N conditions" plus remove button; read-only dialog shows only Clear all and Close: `no-results.test.ts`; browser PASS.
- Burnup "Scope" label: replaced by a legend outside the `role=img` frame: `burndown-legend.test.ts`; browser PASS in both themes.
- Week start helper reads "Applies to calendars and date pickers.": test.
- Bulk Copy allows the source project, Move excludes every source project (recorded in decision 107): `bulk-transfer-dialog.test.ts`; browser PASS.
- Two level-1 headings on work item and project page detail: `project-frame.test.ts`, `panel-header` test; browser PASS (one h1).
- 375 px project tab strip (second row, 44 px tabs): browser PASS.
- 375 px board column `min(350px, 100cqw)`: browser PASS (325 px).
- 375 px drawer search full width: `top-bar-search` test; browser PASS.
- Calendar chip keys no longer wrap; chip 44 px wide at 375 px; move button clickable by mouse: `calendar-css.test.ts`; browser PASS; e2e Move-to-date passes.
- 375 px gantt and modules timeline label column `min(256px, 40vw)`: browser PASS.
- Calendar chip hover/pressed feedback and outside-month fill: browser PASS (Frappé; Latte from tokens).
- Table first column alignment: browser PASS (header, key, title at the same x).
- List row end inset 16 px: browser PASS (1415 = 1415).
- Detail heading spacing restored: `shell-detail-css` test; browser PASS.
- Page outline no longer narrows the 960 px column: side column from a 1136 px frame, stacked block above the column below it (`pages-outline-css.test.ts`; browser: 960 px at 1440, stacked at 900 and 375). ASSUMPTION: the verify wording "floats over the right margin" was stale; a floating card covered text.
- Workspace list bare scans: migration 0011 indexes, 0 allowed scans in `tests/perf/query-plans.test.ts`, decision 126 updated.
- Labels group projection over budget: 25-row first page for multi-valued groupings (decisions 113, 115); perf-bench labels p95 29.5 ms; browser PASS for labels, assignees, modules paging.
- Automation lease race: `tests/automations-lease-race.test.ts` (5 processes, 300 items, one winner).
- `perf:bench` prints the real project count.
- Field guide css-token line reworded; `css-token` rule strict for every name (`tests/convention-rules.test.ts`, 18 tests).
- `drizzle/meta/0011_snapshot.json`: `drizzle-kit generate` in a scratch copy says "No schema changes".
- `docs/as-built/`: six new files for P4 and P6–P11, README snapshot line, `work-items.md` and `engine.md` stale lines.
- `PLAN-STATUS.md`: P5 date and live acceptance, P10/P11 rows, P2a/P3 acceptance lines, stale rework list.
- Test gaps: AutomationsSettings, BulkTransferDialog, ModulesTimeline, `?layout=` (`layout-param.test.ts`), CSV button, `useWeekStart`, `weekStartsOn`, `dateRangeOf` (`tests/timeline.test.ts`, 10 tests).
- Stale worktree `.claude/worktrees/app-visual-rework-250c6c`: gone (`git worktree list` shows only main).

### Dropped by the user (2026-10-21)
- Cache lane, decisions 109–111: not built; `docs/PLAN.md` marks them dropped (P12 records it as decision 127).

### Verified 2026-10-21 at f3be717
- Automations settings tab: switches, months, Close to state, Run now, Due now, Last run all work (browser).
- Bulk Copy/Move to project (decision 107): copy made OPS-6..8, move shows the destructive confirm, `/browse/WEB-13` redirects to OPS-9 (browser; `tests/bulk-transfer.test.ts`).
- Rich filter dialog shows field/operator/value names; deep trees show the `describeRichFilters` sentence; views list counts rich conditions ("List · 4 filters").
- `?layout=` param: gantt and board switch and fold into `q`, bogus is ignored, saved view settings unchanged (browser).
- Scheduler start log (`automations/scheduler.ts:25`, once per process).
- "N pts" group totals on list, board and table (`GroupFooter.tsx:48`, `tests/paging.test.ts`).
- Gantt zoom Week/Month/Quarter: bands, day widths, bar widths and today line correct in all three (browser).
- Gantt dependency lines: blocker-end → blocked-start arrows, red conflict path and outlines, Show dependencies toggle, connector follows a drag (browser).
- Modules Timeline: drag by 3 days persists after reload, a side-panel date edit moves the bar (browser).
- Analytics chart data tables download CSV with BOM and matching rows (browser).
- `weekStartsOn` on DateControl, property rail, calendar move and module pickers (browser: Mo first).
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
- Text alignment audit: key, title and chip text midlines match in list and table; input placeholders sit correctly (browser).
- Latte and Frappé accent contrast pass WCAG for default placements (`tests/themes/catppuccin-contrast.test.ts`).
- Lock/unlock success path from the header, Shift+L, page-row and view-row menus, with one "Unlocked" fade (browser).
- Sidebar already collapses to an icon rail with tooltips (250 → 48 px, browser); the layout switcher is already central (`DisplayMenu.tsx:152`, `WorkItemsScreen.tsx:366`).
- `docs/PLAN.md` decision 29 (moved keys) and escaped pipes in row 33; `docs/as-built/ai.md` added.

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
