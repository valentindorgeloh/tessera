# Tessera: what needs improving (2026-10-22)

Reconciled on 2026-10-23 against the working tree after the visual alignment round (tree = HEAD 5f0cc7c plus the round's uncommitted changes; nine lanes, three fix rounds, two browser verify passes on scratch copies, never :3000 or `data/tessera.db*`). Gates on that tree: the round's gate is green after fix 3, and the reconciler re-ran `tsc --noEmit` (clean), `eslint .` (clean), `vitest run` (218 files / 2759 tests pass) and `scripts/check-conventions.ts` (passed). Playwright: 56 of 56 (13 spec files, including `relations-reactions.spec.ts`) on a scratch production build of the final tree after fix 3 (2026-10-23, port 3600). Item statuses are in `docs/drafts/visual-audit-items.json` (`status` per item). Re-check an item before working on it.

## Open

### Features from the plan
- Notification grouping diverges from decisions 51 and 52: an unread row is updated in place (no 10-minute window, no actor match), `event_count` is always 1, no `updated` kind; the `+N` and "commented N times" wording is dead (`docs/as-built/pages-collaboration.md` §7).
- Decision 53: only comments sync mentions; a mention in a description or page body notifies nobody.
- Decision 59: `GET /api/changes` returns no `unread_notifications`, so the badge does not refresh on snooze wake-up.

### Accessibility, 375 px and visual
Work items
- L3 partial: the group name follows the dot (x 321 at 1440), not the title column (x 375), which would leave a 60 px gap. Design call.
- At 1440 a 707 px title ends in an ellipsis 4 px early, because the chip gap went from 4 to 8 px (L11). Gaining it back moves the key column. Low.
- Phone list rows are taller than before the round. Fix 3 put key and title back on one line at 480 px and narrower (title minimum `min(10rem, 100%)`; checked on the final build: 12 of 12 rows at 375 and 360 in both schemes, no page overflow, 44 px rows at 1440). But the same items measured at 375 against the audit baseline grew 8–12 px (93 → 105, 65 → 73; added row gap and end padding), and some rows now wrap their properties onto a second line (65 → 105; the 8 px chip gap). Low; a density call if it bothers.
- Archived work items: the lower hit area of the Advanced filter button is taken by the first row (`FilterBar.tsx`). Low.
- Theme: at phone width a hit-area `::before` can sit over an Astryx text input or tokenizer input (Playwright "intercepts pointer events"). Fixed only for the work-item filter (`position: relative`); a theme-wide rule would cover the rest. Low.
- Peek at 768: it now covers the list, but the covered list stays in the tab order (same as on phones). Low.
Timeline
- Calendar chips have no visible Move to date control on touch since fix 2 (a tap opens the peek; dates change there). Low.
- Archived (read-only) calendar chips show the pointer cursor, not the default one. Low.
Pages
- After a failed move is reverted, the moved parent is collapsed and its sub-pages are hidden. Low.
Workspace and settings
- Verify 2: a workspace tab strip shares the title row and is half hidden at rest (screen not named in the report; profile and analytics use `tabsBelow` only under 600 px). Low.
- Accepted limits: the backups table scrolls sideways on a phone (576 px in a 325 px region); the five workspace settings tabs scroll again below about 360 px.
- Latte not looked at for the Home Since rows and the Snooze dialog after their fixes (layout-only changes).
Shell
- S7 leftovers: `inbox.css` and `archives.css` keep their own tab-strip copies instead of the generic rules; the inbox first tab text sits 2 px right of the title at 375 (44 px minimum width of the All tab, by design).
- The intake filter bar is two rows (68 px) at 375 and 1440 since the intake rework; not judged.

### Coverage gaps (not checked this round)
- Real-device touch (Playwright emulation only), including a touch drag on the page-tree grip. Committed drops on board, gantt and calendar, and the workspace views drag, were not exercised in a browser (the views grip has a Vitest test).
- Transfer open items dialog (its menu entry is disabled for every fixture cycle), Mark duplicate at 375 and 768, the Save draft dialog, dialog focus walks at 375.
- Ctrl/Meta+K opening Power K (the probe did not open it; the click path works).
- Gantt connectors and today centring at 768, gantt with a Sunday week start, board and table at 768 and 1100 without a peek.
- Private and Archived wiki tabs at 375; the full `hit-area.mjs` harness stalled on `/drafts` (those routes were probed by hand).

### Docs and housekeeping
- `docs/contracts/ui.md`: the route-group lines near the top, the "Home at `/home`" bullet and the P2b table naming `TabBar.tsx` and `tab-registry.ts` are stale (Home is `/`, there are no tabs).
- `docs/as-built/` README: `ai.md`, `engine.md`, `hardening.md` and `planning-extras.md` still describe the 2026-10-21 tree.
- Stale code text: the `[[` page trigger in `editor/mentions.tsx` still says "Pages arrive in P6" and inserts nothing; the ASSUMPTION header comments in `detail/CommentComposer.tsx` and `CommentItem.tsx` and the subscribe toast predate P7.
- Undo of an assistant apply has engine actions but no UI (no Undo on the "Applied N changes" toast, no history view); recorded in `docs/as-built/ai.md` known debt.

## Waiting for the user
- Live P5 acceptance with the real model: needs about $1–3 of API usage per run and your approval; never ran. The no-cost route (decision 124 fake client, `TESSERA_AI_FAKE`) is now built and `assistant.spec.ts` passes on it.
- Calendar week view on phones: cells stretch to the panel height (493 px, baseline 256–306) because T11 follows Plane. Hugging the chips on phones reverses T11; the timeline lane left the recipe (a `max-width: 480px` rule on `.tessera-cal[data-view="week"]` and `.tessera-cal-week`, plus the test).
- Next.js 16.4.0: dev server logs reported it as affected by a known security advisory, and one `next build` exited with a SecurityFatalError before passing on retry. Upgrading is your call (no agent ran an upgrade).

## Planned for P12 (docs/drafts/p12-plan.md)
- Dock/undock (floating) sidebar.
- Three sidebar modes: full, 48 px icons, 60 px icons with labels (persisted, on the existing collapse rail).
- Layout and content transitions (about 300 ms, ease-in-out, honouring `prefers-reduced-motion`).
- Virtual scrolling for long lists, boards, tables and gantt rows, working with paging (decisions 112–114).
- Calendar zoom Week / Month / Quarter, consistent with the gantt zoom (decision 90).

## Closed

### Visual alignment round (2026-10-22)
- shell: S1–S6, S8–S15 PASS (browser measure at 1440 and 375 in Frappé and Latte; `touch-target-css`, `shell-visual-css`, `rail-parts`, `panel-header` tests); S7 PASS after fix 2 (phone strips pulled onto the 16 px inset).
- list: L1, L2, L4–L13 PASS (`list/measure.mjs`, screenshots; `list-touch-css`, `list-visual-fixes`); L3 partial (Open).
- board-table: B1–B15 PASS (measure with the real grip under touch emulation, both schemes; `board-table-css`, `board-table-fixes`).
- timeline: T1–T14 PASS (measure, `conn2.mjs`, six-load today check; `gantt-*`, `calendar-css`, `date-span` tests).
- detail: D1–D4, D6, D8, D9, D11–D14, D16 PASS (detail measure and probes, screenshots; detail tests).
- planning: P1–P11, P14, P-opt PASS; P12 PASS after fix 2 (`tessera-row-hit`) (planning measure, focus shots, row and dialog probes; `planning-*` tests).
- settings: St1–St13, St15, St-opt PASS; St14 PASS after fix 2 (profile tabs fit at 375) (settings probes, focus walk; settings tests).
- pages: Pg1–Pg3, Pg5–Pg8, Pg10, Pg11, Pg13–Pg17, Pg-comment, Pg-opt, Pg-bubble PASS (pages measure, tree-focus; `pages-*` tests).
- workspace: W1–W14 PASS (workspace measure, `recents.mjs`, `tables.mjs`, `hit-area.mjs`; `workspace-*`, `analytics-touch-css` tests).
- Relations and reactions UI on the work item detail: `RelationsList` (Add relation dialog, remove, focus back on Add relation) and `ReactionBar` on the description and on comments; `load-detail.ts` returns both. `relations-list`, `reaction-bar`, `relations-reactions-css` tests; e2e `relations-reactions.spec.ts` 2 of 2; verify 2 PASS (long titles on one line, 44 px rows and emoji picker at 375). No attachments (excluded scope).
- Shared patterns recorded in `ui.md` "Theme" and "Accepted trade-offs": touch option A (theme-wide coarse/480 px rule plus `tessera-hit` hit areas), the `tessera-fallback` focus layer in `base.css`, PanelBar `tabsBelow`, and the Latte yellow/peach/pink/green icon contrast trade-off.
- Leftovers closed: workspace views drag (P5; wired, Vitest grip test), optimistic menu Move up/Move down in views, states, labels and the page tree (P-opt, St-opt, Pg-opt; browser with delayed POSTs), inbox header at 375 (S7, W14), gantt 28 px buttons (T2), PowerSearch overlap (L1), SeriesCharts floors (W3), Latte for calendar chips, gantt and the page outline (T5, T7, T11, Pg1).
- Found by verify 1 and fixed in fix 2 (verify 2 PASS): the touch rework (Home rows, top bar back to 48 px, work-items header and filter stacks, priority chip, detail breadcrumb, tab-strip chevrons, Pages combobox and tokens), focus return for every Dialog and after a create-project conflict, intake detail on phone and tablet, digest Summarise 400, backups table column floor, emoji picker, Applied badge, relation and option rows, sub-item input width, assistant tool-call spinner, footer labels, planning dialog hit areas, module row bar at 375, calendar chip tap, `+N more`, gantt label column at 768, peek at 768, profile and agents link rows, StatusLabel, the estimates empty state, page move network error, version rows, link placeholder.
- Fixed in fix 3 (lane live checks, no second verify): list row key and title on one line at 480 px and narrower, filter input clickable at phone width, exports and webhook deliveries tables fold below their floors, event names break only at dots, Snooze date and time hit areas, editor start padding 16 px on phones, task-item checkbox pitch 46 px.
- Review findings closed in fix 1: Power K highlights the first row once per non-empty query, palette height in tokens, no `touch-action: none` on sidebar rows, gantt bars or calendar chips (fine pointer only), Pages bar without `canWrap`.


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
