# Tessera: what needs improving (2026-10-23)

Reconciled on 2026-10-23 against the working tree after fix round 5 (tree = HEAD 66c02f8, which is fix round 4 committed, plus this round's uncommitted changes: four lanes (engine-create, home-since, touch-shell, e2e), two fix passes, two browser verify passes on scratch copies, never :3000 or `data/tessera.db*`). Gates on that tree: the round's gate is green after both fix passes, and the reconciler re-ran `tsc --noEmit` (clean), `eslint .` (clean), `vitest run` (232 files / 2944 tests pass) and `scripts/check-conventions.ts` (passed). Playwright: 109 of 109 (23 spec files) on a scratch production build of the tree after fix 2 (port 3820, no fixme or skip; verify 1 had 108 of 109, a spec mistake in `round5.spec.ts`, fixed), plus round4 then round5 21 of 21 on a fresh DB and `round5.spec.ts` 45 of 45 repeated runs. Contract for the round: `docs/drafts/fix-round-5-2026-10-23.md`. Re-check an item before working on it.

## Open

### Features from the plan
- Side effects of logging create-time assignees (round 5, reported by the engine lane, not changed): a subscribed webhook now receives `work_item.added` for a create with assignees (`operations.md` webhooks row), and the Home Since row counts the assignment as "(1 more change)". Low; plan question (decisions 50, 51): confirm both are intended.

### Accessibility, 375 px and visual
Shell
- Hydration error 418 when the top-bar sidebar toggle is clicked before Home has hydrated while it shows Since rows: the toggle changes the shell context under still-dehydrated Home content, React recovers by client-rendering that part. Pre-existing at HEAD 66c02f8; `round5.spec.ts` waits with `waitForHydrated` (helpers-d). Low.

### Coverage gaps (not checked this round)
- Real devices: all touch checks are Playwright emulation (the page-tree grip uses CDP touch events in `coverage-touch.spec.ts`).

## Waiting for the user
- Live P5 acceptance with the real model: needs about $1–3 of API usage per run and your approval; never ran. The no-cost route (decision 124 fake client, `TESSERA_AI_FAKE`) is built and `assistant.spec.ts` and `round-features.spec.ts` pass on it.

## Planned for P12 (docs/drafts/p12-plan.md)
- Dock/undock (floating) sidebar.
- Three sidebar modes: full, 48 px icons, 60 px icons with labels (persisted, on the existing collapse rail).
- Layout and content transitions (about 300 ms, ease-in-out, honouring `prefers-reduced-motion`).
- Virtual scrolling for long lists, boards, tables and gantt rows, working with paging (decisions 112–114).
- Calendar zoom Week / Month / Quarter, consistent with the gantt zoom (decision 90).

## Closed

### Fix round 5 (2026-10-23)
- Create-time assignees (decisions 50, 51): `createWorkItem` and `createIntakeItem` insert with no assignees, then run `syncAssignees`, so an agent's item assigned to the user gives one "assigned you" row, the user's own and the assistant's creates notify nobody, the activity shows "created" and one assignment, no duplicate subscribers; an agent intake submission assigned to the user reads "assigned you · +1 more"; a create with an assignee and a mention of the same actor now reads "mentioned you · +1 more" (supersedes the round 4 single "mentioned you" row): `notifications.test.ts` (6 new), `intake.test.ts` (3 new), `mentions.test.ts`, `work-items.test.ts`; browser PASS (UI dialog at 390 touch, MCP, intake, long client at 375/1440, both schemes); e2e `round5.spec.ts` (a).
- Home Since rows at 375 with a long actor: the actor is its own run (`tessera-home-since-actor`, `sinceRowParts`), inline-block and ellipsized at 480 px and narrower (`min(40%, 16ch)`), full name in the DOM and the link's name (no aria-label); a row holding the create-time assignment leads with "created" (fix 1, `sinceVerbPhrase`): `home-touch-css.test.ts`, `home-widgets.test.ts`, `home-since-row.test.ts`; browser PASS at 375, 480, 481, 1440 in both schemes; e2e `round5.spec.ts` (b).
- Root follow-ups after the reconcile:
  - The item key in a Since row is its own `Text textWrap="nowrap"` run (`sinceKeyParts`), so "SVRF-1" no longer breaks at its hyphen at 375 (the verify 2 FAIL). Covered by `home-widgets.test.ts`, `home-since-row.test.ts` and the one-line key assertion in `round5.spec.ts` (b).
  - The fix-2 `title` on the actor went through a spread around Astryx's Text types. That is glue, against the "follow Astryx docs" rule, so it was removed: the shortened name has no native tooltip, which a touch screen could not show anyway.
  - The `as-built/README.md` parenthesis on which files rounds 4 and 5 touched is corrected.
- Coarse labelled project tabs at 1280 px and wider: each `::before` reaches half the 2px strip gap toward a neighbour only and runs from 16px above the tab to its bottom edge (ui.md touch-target exceptions): `touch-target-css.test.ts`; browser PASS (1280 and 1440, docked and collapsed, DPR 1 and 2, both schemes: gaps within 0.001 px, 0 misses with the area's own probe, no strip scroll; 768/1024 and fine pointer unchanged); e2e `round5.spec.ts` (c).
- Top-bar search field under a coarse pointer (600 px and wider): block-axis-only 44px area on the field, so the ⌘K chip is covered: `top-bar-search.test.ts`, `touch-target-css.test.ts`; browser PASS at 1440 and 768 (probes above and below the chip land on the field; taps open Power K); e2e `round5.spec.ts` (c).
- 768 px Collapse sidebar and brand sub-pixel overlap: does not reproduce; `collapse.hitRight - brand.hitLeft` is exactly 0 at 768, 1024, 1100, 1279, 1280, 1440, DPR 1 and 2, docked and collapsed, both schemes (pinned in `touch-target-css.test.ts`, note in ui.md); e2e `round5.spec.ts` (d).
- Project bar Add to favorites and Project actions hit areas overlapping by 12x44 px under a coarse pointer (found by review, not a regression): `tessera-project-bar-actions` 16px gap in `ProjectFrame.tsx` and `shell.css`: `touch-target-css.test.ts`; browser PASS at 375 to 1440, DPR 1 and 2 (areas tile at a 44px pitch, pairwise check of 16 header controls: 0 overlaps, 0 strict misses).
- Touch-rule citations stay "decision 14" (root planner): kept, documented in ui.md Theme ("Touch targets (option A of decision 14)").
- `round4.spec.ts` header comment no longer mentions fixme lines; `round5.spec.ts` has none either.
- Spec mistakes found and fixed: `title` assertion before the actor had one (fix 1, then the title landed in fix 2); `hitAreaRects` read the right edge from the rounded computed `width` (fake 5e-5 px overlaps; now host rect minus resolved insets, -0.005 px tolerance); tab areas use `hitAreaMisses` (own rectangle), not the centred 44 box; the Assignees control is a button with an inline popup above 8 actors; the 768 toggle test waits for hydration.
- Docs: `service-api.md` createWorkItem line, ui.md touch-target exceptions and header icon buttons bullet; `as-built/` (README, engine, operations, pages-collaboration, planning-extras, shell-detail, work-items, workspace); `PLAN-STATUS.md` round 5 paragraph.

### Fix round 4 (2026-10-23)
- Decision 51 wording: migration 0013 `kind_count` (default 1, no backfill); a state change plus a comment reads "commented · +1 more", two comments "commented 2 times", no separate "+N" text (`notificationPhrase(kind, kindCount, eventCount)`): `notifications.test.ts`, `inbox-format.test.ts`, `inbox-row-label.test.ts`; fresh scratch copy prints "No schema changes"; browser PASS at 375 and 1280/1440 in both schemes; e2e `round4.spec.ts` (a).
- Create with an assignee and a mention of the same actor (root decision: decision 51 as intended): create logs no assignment, so it gives one "mentioned you" row; `setAssignees` then a description mention gives "mentioned you · +1 more": `mentions.test.ts`.
- Inbox rows at 375 with a long agent name: the whole phrase is painted (Range over the last character inside label and row, no sideways scroll): browser PASS in both schemes; e2e `round4.spec.ts` (a).
- `[[` page search no longer lists the page being edited (decision 10; `pageId` in the suggestion context, limit=9 when set): `tests/editor/suggestions.test.ts`; browser PASS on a wiki and a project page; e2e `round4.spec.ts` (e).
- Project sections (decision 14, three bands): labels from 1280; folded icons with a name Tooltip at 600–1279 (closed again once the tab is current, fix 1), 44px hit areas at a 44px pitch under touch (tiling removed); a `SectionMenu` below 600: `section-menu.test.ts`, `project-tabs-css.test.ts`, `project-frame.test.ts`; browser PASS at 1440 down to 360, both schemes, fine and coarse; e2e `round4.spec.ts` (b).
- Project settings: seven tabs fit with no strip scroll from 600 (the scroll was only at 768 with the sidebar docked), a "Project settings" section menu below 600, the skeleton mirrors both (fix 1): `settings-phone-css.test.ts`; browser PASS at 600, 768, 1024, 1280, 1440 and 375; e2e `round4.spec.ts` (c).
- App header at 375 and 360: Open navigation, Assistant, Help and Account each own a 44x44 hit box (`tessera-topbar-end` 16px apart, `tessera-topbar-heading` 8px): `touch-target-css.test.ts`; browser PASS (strict check, both schemes, fine and coarse); e2e `round4.spec.ts` (d).
- Home Since rows: one line with an ellipsis on desktop, at most two lines at 480 px and narrower (`tessera-home-since-label`): `home-touch-css.test.ts`; browser PASS at 375, 480, 481, 1440 in both schemes; e2e `round4.spec.ts` (f).
- Peek focus return when a click does not focus the button (Safari): `useCoverFocus` records the opener on pointerdown: `peek-opener.test.ts`; Chromium with mousedown default-prevented PASS at 375 and 768. Checked in jsdom only for WebKit, which is not installed (installing it is a download; root decision).
- Nested-dialog focus fallback in `shell/dialogs.tsx` has a Vitest (`dialog-focus-fallback.test.ts`, fails when the fallback is removed).
- Browser re-measure of the round 3 fix 3 changes: the project tab tiling was replaced by the round 4 bands (measured above); the inbox label wrap passed at 375.
- L3 group name follows the dot (root decision; `ui.md` l.84). At 360 px a few rows wrap one more chip line (accepted trade-off, `ui.md`). Home "Mark as seen" tint-only edge (accepted trade-off, `ui.md`).
- Docs: `ui.md` project frame bands, sidebar "Work" heading (→ `/`), header spacing sentence, settings strip; `as-built/` (engine, hardening E2E lines, pages-collaboration, shell-detail, work-items, views-settings, workspace, planning-extras, README); `PLAN.md` decision 51, `p7-plan.md`, `schema.md`, `service-api.md`, `editor.md`; `PLAN-STATUS.md` round 4 paragraph.
- Spec mistake found by the full run: the long client name in `round4.spec.ts` contained "name" and broke `getByLabel("Name")` in `work-items.spec.ts`; renamed, 100 of 100 pass.

### Fix round 3 (2026-10-23)
- Decision 51 coalescing (migration 0012 `event_count`, `sort_at`; 10-minute window per recipient, item and actor; `updated` kind; decision 50 recipients): `tests/notifications.test.ts`; browser PASS (one row per agent, a second agent gets its own row, layout at 1440/768/375 both schemes); e2e `round-features.spec.ts`.
- Decision 52 snooze, unsnooze and archive (`sort_at`, unread on wake): engine tests; browser PASS (snooze wake-up at 1440 and 375 in Frappé, once in Latte; badge within 1 s).
- Decision 53 mentions in descriptions, page bodies and comments (`syncMentions`, page mentions open `/pages/<id>`; a page copy writes its rows silently; a description save gives one `mentioned` row): `tests/mentions.test.ts`; browser PASS; e2e `round-features.spec.ts`.
- Decision 59 `unread_notifications` in `GET /api/changes` and the poller (`nextPollState`): `tests/changes-route.test.ts`, `tests/ui/poll-loop.test.ts`; browser PASS; e2e `round-features.spec.ts` (count rises by one).
- Assistant Undo on the Applied toast and as a Power K row: `assistant-undo*.test.ts`; browser PASS at 1440, 768 and 375 in both schemes (44x44 hit at 375); e2e `round-features.spec.ts` (`undo-priority.json`).
- `[[` page trigger (project hits first, then wiki, max 8; inserts `[Name](page:<id>)`): `tests/editor/suggestions.test.ts`; browser PASS (two requests, backlinks); e2e `round-features.spec.ts`.
- Phone list rows (chip gap 4 px below 481 px; key and title on one line at 480, 375, 360): `list-touch-css.test.ts`; browser PASS (both schemes; at 375 every row within baseline + 4 px); e2e `round-features.spec.ts`.
- 1440 title ending 4 px early (title slot `margin-inline-end: -4px`): browser PASS (no clipped title, key column unchanged).
- Archived work items Advanced button hit area (filter `z-index: 1` under touch): `list-touch-css.test.ts`; browser PASS at 375 and 1024 coarse, also with sticky group bands.
- Theme input stacking (text-like inputs `position: relative` under coarse/480 px; sentence in `ui.md` "Theme"): `input-stacking-css.test.ts`; browser PASS on eight inputs in both schemes.
- Peek at 768 and 375: covered list is `inert`, focus moves into the peek and back to the row key; a resize never pulls focus out of the detail; closing a side panel at 1440 refocuses the row: `peek-inert.test.ts`; browser PASS (verify 1, re-check verify 2 after fix 2).
- Calendar on touch: a tap opens the peek and the Target date field moves the chip without a reload (ui.md calendar bullet): browser PASS; e2e `coverage-touch.spec.ts`.
- Archived calendar chips keep the pointer cursor on purpose (they open the peek), with no Move control: `calendar-css`, `calendar-layout` tests; browser PASS.
- Calendar week view on phones (your decision: fix it): the week hugs its chips at 480 px and narrower, 768 and 1440 keep the T11 stretch: `calendar-css.test.ts`; browser PASS (cell 178 px, block 306 px at 375 on the fixture).
- Pages: a failed move keeps the parent expanded; a moved leaf is never pinned closed: `pages-move-expansion.test.ts`; browser PASS (blocked POST, toast, tree restored).
- Wiki Private and Archived tabs at 375 (square row and chevron clips, grip lead shift): `pages-visual-css.test.ts`; browser PASS (re-check verify 2).
- Verify 2 half-hidden strips: tablet two-row header for profile, agent profile, analytics and inbox; wiki and project Pages strip on its own row up to 1099 px; strips reach the bar edge (`max-width: none`): `touch-target-css.test.ts`; browser PASS at 1440, 1099, 768, 600, 375, 360 in both schemes.
- Workspace settings five tabs fit at 360 and 375; profile and analytics fit at 360: `settings-phone-css.test.ts`; browser PASS.
- Backups table folds below 576 px (size, check and age under the name): `backups-fold.test.ts`; browser PASS at 1440, 768, 375 in both schemes.
- Latte for the Home Since rows and the Snooze dialog: browser PASS (lowest text ratio 4.93); `+N more` link 44x44 at 375 (`home-touch-css.test.ts`; re-check PASS).
- S7 leftovers: inbox and archives use the generic tab rules; the inbox first tab label sits on the 16 px inset at 375 and 360: `touch-target-css.test.ts`; browser PASS (re-check verify 2).
- Intake filter bar: one row at 1440, 768, 375, 360; Triage is an icon button; button hit areas clear the first row: `touch-target-css.test.ts`; browser PASS (re-check verify 2).
- Project tab strip fully visible at rest at 360, 375, 768 and 1440 on 12 project routes: `project-tabs-css.test.ts`, `project-frame.test.ts`; browser PASS (re-check verify 2). Hit area width is Open.
- Focus after "Save this draft?" > Save draft returns to the "New work item" opener (fallback in `shell/dialogs.tsx`): e2e `coverage-dialogs.spec.ts` (was `test.fail`).
- Coverage gaps from the last round, now e2e: committed drops on board, gantt body and edges, calendar, workspace views, states, stickies (`coverage-drops.spec.ts`); Transfer open items, gantt connector and Today at 768, Sunday week start, board and table at 768/1100 (`coverage-timeline.spec.ts`, 60 of 60 with `--repeat-each=4`); Mark duplicate at 375/768, Save draft, focus walks at 375, Power K by keyboard (`coverage-dialogs.spec.ts`); calendar tap, page-tree touch drag, `/drafts` at 375 (`coverage-touch.spec.ts`, drafts 12 of 12).
- Flaky specs: gantt connector (role locators) and `/drafts` (`:visible`, one match) are stable.
- Docs: `ui.md` route group, Home bullet and P2b table; `docs/as-built/` refreshed (README, ai, engine, hardening, planning-extras, pages-collaboration, work-items, shell-detail, operations and others); stale code text (`[[` trigger, CommentComposer header, subscribe toast).
- Next.js 16.4.0 → 16.4.3 (root, d0dc0c4): gate, production build and Playwright green; `npm audit --omit=dev` clean; one moderate esbuild advisory remains inside drizzle-kit (dev only, never serves).

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
