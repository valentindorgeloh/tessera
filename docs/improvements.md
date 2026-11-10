# Tessera: what needs improving (2026-10-29)

Reconciled on 2026-10-24 against the working tree after fix round 6 (tree = HEAD 157c687, which has fix round 5 committed as d3ffeb9 plus the demo seed, performance plan and live-app commits, plus this round's uncommitted changes: three lanes (shell-collapse, pins, e2e), two fix passes, two browser verify passes on scratch copies, never :3000 or `data/tessera.db*`). Gates on that tree: the round's gate is green after both fix passes; verify 2 ran `vitest run` from an un-niced shell (240 files / 3000 tests pass, including `live-build` and `live-script`, which refuse a niced shell), and the reconciler re-ran `tsc --noEmit` (clean), `eslint .` (clean), `scripts/check-conventions.ts` (passed) and the five round 6 Vitest files (23 tests pass). Playwright: 138 of 138 (24 spec files) on a scratch production build of the tree after fix 2 (port 3690, no fixme or skip), and `round6.spec.ts` 280 of 280 with `--repeat-each=10` (verify 1 had 279 of 280, a project-identifier collision in the spec helpers, fixed). The root then ran its own gate and two review passes over the tree; their fixes are the "Root close-out" entries under Closed, and the final gate on a fresh scratch copy of the tree after them was green: `next build`, `check:bundle`, `npm run check`, then two more `vitest run` (241 files / 3011 tests each time), Playwright 138 of 138 and `round6.spec.ts` 84 of 84 with `--repeat-each=3` (every early action landed in the gap on its first attempt), plus browser checks of the Power K seed and the drawer button. Contract for the round: `docs/drafts/fix-round-6-2026-10-23.md`. Re-check an item before working on it.

Updated on 2026-10-28 with the performance round (commit after 21f8ae3): its open follow-ups are under "Performance", "Operations" and "Waiting for the user", its results under "Closed".

Updated on 2026-10-29 with performance round 2 (roadmap lanes B and C, decisions 141 and 142, commit after 6331186): "Performance" is rewritten from its profile and review, its results are under "Closed".

Updated on 2026-11-09 with the Astryx 0.7.11 motion adoption: its open follow-ups are under "Astryx follow-ups"; the decisions are 143 to 148 in `docs/PLAN.md`.

## Open

### Accessibility, 375 px and visual
Shell
- Latent hydration case, never reproduced (round 6 investigation): `AiStatusProvider` keeps `status` in a `useState` that changes after mount, and `SinceLastVisit` (DigestCard), `ViewsScreen`, `WorkspaceSettingsScreen` and `useAssistant` (intake) read it through context, so a status that lands before a streamed boundary hydrates would hydrate it against different HTML (error 418). 0 of 9 faked runs and round6 (f), (g) pass; ui.md "Shell" names it as the exception to the streamed-subtree rule. If it reproduces, read `status` in the consumer through `useSyncExternalStore` with a null server snapshot. Low.
Work items
- On the board a long state name in a column header overlaps the column's Add button: the StateLabel HStack in `.tessera-board-column-title` has no `min-width: 0` (found by the performance round, 2026-10-28). Low.
- At 375 px the open Assignees MultiSelector cuts a very long actor name at the listbox edge with no ellipsis (same round). Low.

### Performance (after the speed batch, 2026-11-10)
Sources: docs/drafts/perf-report-2026-10-28.md (sections 1, 5 and 6) and the speed batch measurement under Closed (old head, batch and batch plus the navigation hold; production, n=5 interleaved).
- React 19.3 holds a revealed Suspense fallback for 300 ms (`FALLBACK_THROTTLE_MS`), so a first visit waits for it whenever a skeleton showed first. The speed batch moved that wait onto other first visits: inbox 157 → 421 ms, analytics 108 → 398 ms, a cycle's page 128 → 392 ms, the 10k wiki 147 → 352 ms, and a cold 10k analytics load is ready at 251 instead of 149 ms (cycles 392 → 111 ms and the list 480 → 393 ms lost it). The navigation hold under "Waiting for the user" brings the first visits of the list, cycles, analytics and inbox to 77–176 ms; a cycle's page and the wiki would need the same change. Medium.
- Decision 115's budget on 10k items: the cold list is ready in 684 ms and the cold table in 1,255 ms (1,260 and 1,785 before the speed batch; `tests/e2e/perf.spec.ts` p95 not rerun since 902 / 1,653 ms). A page-size sweep with that spec gave the list about 105 ms + 3.3 ms per row and the table about 90 ms + 6 ms per row before the batch, so the planned windowing has to start near 50 list rows, not at decision 135's 250. Medium.
- Rows no longer mount closed popovers: they show plain chips until the mouse reaches them or focus enters (speed batch). The list page still holds 1,790 DOM nodes of closed layers (target 200): the Advanced filters dialog (323 nodes) stays mounted while closed, plus 33 closed menus and popovers outside the rows (1,180 nodes) and 65 tooltips (130). Medium.
- The table's pinned key column (`stickyColumns`) costs 92.6 ms of its own on a cold 10k table and a column resize 189 ms; keep it or drop the pin (under "Waiting for the user"). Medium.
- Astryx `useLayer` reads `getComputedStyle` twice per layer (`readPortalWritingContext`) and then mounts a second render pass; stubbing it saved 133 ms on the 10k list, 259 ms on the 10k table and 1.3 s on the 10k list at CPU 4x. Upstream fix (lazy closed layers), already in the Astryx draft under "Waiting for the user". Medium.
- The board's p95 is bimodal (about 0.25 s, or 1.0 to 1.3 s): the first paint of the server HTML races a hydration task of about 1 s, and when the HTML arrives in several pieces nothing paints until hydration ends. Yielding before hydration would remove the slow tail. Low.
- Every peek open, switch or close refetches nearly the whole list's RSC payload: 247 KB on 10k and 62 KB on about 50 items after the speed batch slimmed list rows (284 and 72 KB before). Closing the peek after typing a description now also refills about 20 sidebar link prefetches, because the blur refresh clears the router cache (396 KB on demo data, 567 KB on 10k); the close itself got faster (86 → 65 ms). Low.
- The list's rows and, since the speed batch, the table's rows keep their identity across refreshes; board, calendar and gantt rows do not, and `RowProject` is rebuilt on every row render (docs/as-built/work-items.md). Low.
- The list routes' first-load JavaScript dropped by 27 to 30% (work-items 669 KB gzip) but missed the roadmap's 560 KB target; the 553 KB estimate could not be reproduced. Low.
- The ProjectFrame heading and the "Work items" Text in `WorkItemsScreen` still use `Text maxLines`: up to 64 ms at CPU 1x on a 10k list (about 300 ms at 4x, upper bound). Low.
- Per-row popovers were made lazy in the list, table, gantt and modules timeline only; other popovers with heavy closed content are not audited. Low.

### Astryx follow-ups (2026-11-09)
- Adopt Astryx `List` `animatedLayout` and `ListItem` `itemKey` for the inbox and proposal lists, and `LayoutPanel` slide-on-collapse, once they ship in an Astryx release (they are not in 0.7.11); they also close the gap below a removed row (decision 143) and give the inbox and proposal rows exit fades (decision 148). Low.
- Give `useDescriptionSave` and `use-work-item-search` an event callback (a handler that runs when a save settles or a search returns), so `DescriptionEditor` and the parent and relation pickers can announce through `useAnnounce` from it instead of keeping their `aria-live` status lines; announcing from an effect is not allowed (ui.md "Motion"). Low.

### Operations
- Backup file names do not name their database: every backup is `tessera-<kind>-<stamp>.db` in `backups/` next to the database file (`src/lib/tessera/db/backups.ts`), so two databases in one folder (`data/tessera.db` and a perf or acceptance copy in `data/`) share one folder whose list, rotation and restore mix their copies. Put the source file's base name in the backup name and filter by it. Medium.

### Coverage gaps (not checked this round)
- Real devices: all touch checks are Playwright emulation (the page-tree grip uses CDP touch events in `coverage-touch.spec.ts`). Playwright WebKit would add Safari-engine emulation, but installing it is a download and needs your approval.

### Found by the demo seed checks (2026-10-24)
The `npm run db:demo` run (about 70 routes at 1440 and 375 in both schemes on a seeded copy) found these app problems. The seed works around some of them (friendly agent names, editor-canonical markdown, mentions without "@"), so the demo data does not show them; agents writing through MCP still can. Re-check each before working on it.
- Mentions: the editor's mention tokenizer rewrites a link whose text starts with "@" (`[@Name](actor:<id>)`) to `@(actor:<id>)`, so a raw actor UUID shows in comments, page bodies and the Home/Inbox rows. Agents write mentions this way. High.
- The "This description uses Markdown the editor would rewrite" banner (decision 10) showed on 33 of 119 agent-written items in the first draft of the seed: for an AI-first app it may show on most agent-written descriptions. Plan question: when is the banner worth it?
- Agents registered without a display name show as raw `mcp:<client>` with an "M" avatar (Home Since, Inbox, Agents, intake, activity); on a phone it truncates to "mcp:do…". Medium.
- Home Since wording: rows such as "Claude Code added link (2 more changes)", "Assistant reacted reaction", "commented subscriber (1 more change)" repeat the kind word or use a detail name as a verb (`src/components/home/home-format.ts`). Medium.
- Agent profile activity rows (`/agents/<id>`) do not name the work item (key and title) they refer to. Medium.
- The board layout's default has no grouping (`DEFAULT_DISPLAY.group_by` is null), so a project board opens as one "All work items" column until the user picks Group by. Plane groups the board by state by default. Medium.
- Home stickies strip shows raw markdown (for example "- [x] Changelog drafted …"); `/stickies` renders it. Low.
- Intake: after switching to the Closed tab the right pane keeps the open item with Accept and Decline; an intake create writes two "create" activity rows. Low.
- 375 px: the top bar says "Tessera" while desktop shows the workspace name; the overflow check flagged the table and gantt headers, the analytics tiles and the Agents table. Low.
- Home quick links whose URL is an internal path show the raw path with the project UUID as their subtitle. Low.

## Waiting for the user
- Navigation hold (speed batch, built and measured, not merged): keep the old page on screen until the new one is ready instead of showing a skeleton first. First visits from the home page: list 393 → 141 ms, cycles 111 → 77 ms, analytics 398 → 115 ms, inbox 421 → 176 ms, with no blank or skeleton frame in a real browser. Cost: a full reload shows its content about 0.1 s later (cold list ready 399 → 520 ms on demo data, cold 10k table 1,255 → 1,351 ms). Recommended: yes; on a yes, a cycle's page and the wiki get the same change, `docs/contracts/ui.md` "Reads" changes for these routes, and a full gate runs.
- Pinned key column in the table: keep it, or drop the pin to save about 93 ms on a cold 10k table (see Performance).
- Astryx upstream (docs/drafts/astryx-upstream-2026-10-24.md): Astryx 0.7.11 is installed (2026-11-09). It fixed the ContextMenu `moveTo`/`start`/`cancel` warning (0.7.0, no issue needed), unmeasured `Text maxLines` with `hasTruncateTooltip={false}` (0.7.2) and deferred closed-layer `readPortalWritingContext` (0.7.5). Still open and worth filing: Popover, Selector and Tooltip content mounts while closed (no `lazyMount`). `OneLineText` goes back to `Text maxLines` only after a profile on 0.7.11.
- Live assistant acceptance with the real model: needs about $1–3 of API usage per run and your approval; never ran. The no-cost route (decision 124 fake client, `TESSERA_AI_FAKE`) is built and `assistant.spec.ts` and `round-features.spec.ts` pass on it.

## Planned next (docs/drafts/p12-plan.md)
- Dock/undock (floating) sidebar.
- Three sidebar modes: full, 48 px icons, 60 px icons with labels (persisted, on the existing collapse rail).
- Layout and content transitions (about 300 ms, honouring `prefers-reduced-motion`; what was built instead is in decisions 145 and 146).
- Virtual scrolling for long lists, boards, tables and gantt rows, working with paging (decisions 112–114).
- Calendar zoom Week / Month / Quarter, consistent with the gantt zoom (decision 90).

## Closed

### Search matches word starts (2026-11-10)
- A word lost its hits partway through typing it: the full-text index stored Porter stems, so "billing" was "bill" and the prefix "billi" matched nothing (on the 10k data "bil" found 1,032 items, "billi" and "billin" none, "billing" 1,032 again; "onboardi" and "settin" the same). Power K, `search_all`, the list filter's text search, `#` mentions and the pickers all showed it. Decision 154: the index keeps words as written (migration `0015_fts_word_starts` rebuilds both FTS tables), and each typed word matches words that start with it or with its Porter stem, so "invoices" still finds "invoice" and "queries" finds "query" (`src/lib/tessera/db/fts.ts`). Tests: `tests/fts-word-starts.test.ts` (7 tests; 6 fail on the old index) and the updated match-expression and migration cases in `tests/foundation.test.ts`. Production build on a fresh copy of the 10k data: the migration ran on start (backup taken, 12,000 rows re-indexed), Power K keeps its 20 work items at every letter of "billing", "onboarding" and "settings" (before: "No matches" at "billi", "billin", "onboardi" and "onboardin", and only commands from "sett" to "settin"), search requests take 5 to 16 ms, no console errors.

### Speed batch (2026-11-10)
Four lanes on 43298e6 (row arming, closed surfaces and lazy charts and palette, quiet saves and slim rows, and an experimental navigation hold kept apart), gated once on the merged result (3,764 unit tests, 179 Playwright tests) and live as d679da3. Then the old head, the batch and the batch plus the navigation hold were measured side by side: production builds, same machine and data, 5 interleaved rounds, medians.
- Rows wake on demand: list, table and board rows draw their state, priority, cycle, estimate and date controls as plain chips until the mouse reaches the row or focus enters it (`src/components/work-items/properties/arming.tsx`). Cold list 13,306 → 5,516 DOM nodes on about 50 items and 65,996 → 19,006 on 10k; cold list ready 441 → 399 ms (10k 1,260 → 684 ms); cold 10k table 1,785 → 1,255 ms; longest task on the cold list 227 → 129 ms.
- Closed dialogs and menus render nothing; charts and Power K load on demand with an idle preload. First-load JavaScript: `/` 768 → 689 KB gzip, analytics −14%, cycles −20%, active cycles −21%.
- A layout switch fetches the page once (its action 103 KB → 1 KB): to table 275 → 161 ms (10k 1,188 → 690), to board 132 → 84 ms (10k 434 → 192), to list 170 → 81 ms (10k 878 → 298).
- Descriptions, pages and stickies save without refreshing the page (107 KB → 1 KB per autosave) and refresh once on blur; list data no longer carries descriptions.
- Browser checks: no shift when a list row wakes (0.00 px, both schemes), keyboard, touch, fast mouse (54 of 54 presses hit the real control), quick-add under a resting mouse, charts, autosave, layout switch and the console all pass.
- Fixed after the checks, gated once more: the table's priority and date chips line up with the controls they turn into (they sat half a pixel off, one device pixel on a Retina screen); keys typed into Power K before its code arrives are kept, Option and AltGr characters included; a board card's Actions menu opened from the keyboard focuses "Open" again; the arrow keys in an open State, Priority or Cycle menu or date calendar in the list move through it instead of jumping to another row (an older bug).
- Left for a separate task: keyboard focus drops to the page when a picked state or "Move to" moves an item to another group.
- Not an app bug (checked 2026-11-10): "typing into Power K never settles on the 10k workspace" came from the measuring harness. Its query `platf` has no hits in the 10k data, so the palette settled on "No matches" with focus and value kept (one search request, answered in 6 ms, no long task), and Astryx then renders no listbox and sets the input's `aria-expanded` to false, which the harness's done check required. With a check for the settled state (`docs/field-guide/performance.md`, "Measuring") the step passes on 10k in 5 of 5 runs, settled 596 to 605 ms after the first key, and on demo data in 604 to 609 ms (production build of c975a5c).

### Performance round 2 (2026-10-29)
Roadmap lanes B (decision 141, render identity) and C (decision 142, load less up front), integrated, gated, reviewed twice and fixed on scratch copies of 6331186 (docs/drafts/perf-report-2026-10-28.md). List rows are memoised and read a lean `useProjectRow()` context; refreshed data, the display and the row handlers keep their identity while unchanged (`src/components/work-items/stable.ts`), so a click or an agent write redraws the rows it changed, not the list. The peek's detail and editor load as a separate chunk, preloaded when the browser is idle or the pointer reaches a row. The sidebar and Power K go straight to `/your-work/summary` and `/analytics/overview`. `npm run check:bundle` now also fails a route whose first-load JavaScript grows more than 5% over `scripts/bundle-baseline.json`. Measured interleaved, production, n=5 per side:
- 10k items: tick a row 265 → 94 ms (longest task 219 → 0), state pick 237 → 58 ms, peek open 697 → 472 ms and close 548 → 209 ms, agent write 40,720 → 2,787 components redrawn and browser CPU 1,484 → 792 ms, list 927 → 793 ms, table 1,552 → 1,403 ms, sidebar to list 945 → 842 ms.
- About 50 items: list 354 → 316 ms, table 522 → 481 ms, peek 250 → 186 ms; with 4× CPU throttling list 1,404 → 1,148 ms.
- First-load JavaScript of the work-items list 960 → 669 KB gzip (the editor left the five list routes); Analytics skeleton 94 → 56 ms.
- The review fixes: `shareStructure` compares with `Object.is` and copies on a missing key, the bundle gate runs through a symlinked path, the `g j` / `g a` chords skip the redirect too. A reviewer asked to revert the grouped scroller class; measuring showed `:has()` cost about 95 ms on the ungrouped list and table, so it stays.

### Performance round (2026-10-28)
The work-item views were slow in the browser, not on the server (a 10k list read takes 5 ms). Every row mounted closed Astryx date-picker calendars (61,892 of 113,464 DOM nodes on a 10k list page), and every row title and label ran Astryx `Text maxLines`, which forces a layout per Text on mount. Fixed: the date chips and the gantt and modules date popovers mount their pickers only while open; row text is cut by a CSS one-line class, and `OneLineText` keeps the overflow tooltip by measuring only on hover. Measured interleaved, production, n=5 (docs/drafts/perf-report-2026-10-24.md):
- 10k items: list 6,221 → 962 ms, table 14,485 → 1,630 ms, sidebar to list 6,372 → 971 ms, peek 1,493 → 703 ms, inline priority edit 1,086 → 430 ms, gantt hydrated 1,531 → 679 ms; board unchanged.
- About 50 items: list 791 → 373 ms, table 1,407 → 566 ms, peek 405 → 255 ms; with 4× CPU throttling list 3,151 → 1,380 ms.
- Dev, 10k: sidebar to list 9,661 → 1,914 ms.
Also added: the decision 115 perf spec (`tests/e2e/perf.spec.ts`, opt-in), a tripwire for the Astryx ContextMenu prop warning, and the upstream draft.

### Fix round 6 (2026-10-23)
- Hydration error 418 after an early sidebar toggle or `mod+b` (the round 5 item named the wrong cause: not Home or its Since rows). The collapse flag was `useState` in `TesseraShell` passed through `ShellContext`; the sidebar streams behind a Suspense boundary (`(tessera)/layout.tsx`) that hydrates after the top bar and `mod+b` are live, and React 19.3 never propagates a context change into a still-dehydrated boundary whose props come from the RSC payload, so it later hydrated collapsed against expanded server HTML (Astryx `SideNav` drops its resize wrapper). Reproduced on all 25 routes at 1440, both schemes. Fix: `nav-collapse-store.ts` (`useSyncExternalStore`, server snapshot false, no persistence), each `useShell()` consumer reads it, the context holds only stable callbacks; rule in ui.md "Shell": `nav-collapse-store.test.ts`, `shell-collapse-wiring.test.ts` (fails when the read moves back into the provider); browser PASS (verify 1: 33 of 33 production and dev matrix runs, 0 of 12 repeat runs against 12 of 12 before, 900-case sweep of 25 routes at 1440 and 375 with 0 errors, shell checks in both schemes, 375 drawer); e2e `round6.spec.ts` (a) to (g). `round5.spec.ts` no longer waits with `waitForHydrated`.
- Side effects of create-time assignees (decisions 50, 51): intended (root ruling), now pinned: a create with assignees emits `work_item.created` then `work_item.added`, without only `work_item.created` (`webhooks.test.ts`); an agent's create with an assignee reads "<agent> created <KEY> <title> (1 more change)" with "assignees · 2 changes", the twin "1 change" (`workspace/home.test.ts`); mutation proof (no `syncAssignees`: both assigned tests fail, twins pass); browser PASS on Home (verify 2).
- Power K dropped the first letter typed into the top-bar search field (found by verify 1, pre-existing): Astryx's palette ran its empty-query bootstrap after the seed; the seed now waits one task (`palette-parts.tsx`): `palette-initial-query.test.ts`; browser PASS at 1440 in both schemes and in the 375 drawer search (verify 2).
- Spec helper: `uniqueIdentifier` in `tests/e2e/fixtures.ts` draws again on a collision (the verify 1 CONFLICT); `round6.spec.ts` 280 of 280 with `--repeat-each=10` twice (verify 1 after the fix, verify 2).
- Root close-out 1 (2026-10-24): a key typed into the Power K dialog before the seed runs stays after the seeded letter (`palette-initial-query.test.ts`, case with held timers; fails when the seed overwrites); `round6.spec.ts` header no longer claims `test.fixme` and carries the round date; the unused `waitForHydrated` is removed from `helpers-d.ts`; `as-built/hardening.md` counts 24 spec files and names `round5`, `round6` and `helpers-d.ts`; ui.md P3 passages note decision 140's ports and databases.
- Root close-out 2 (2026-10-24, from the root's review; each finding confirmed by a second agent that tried to refute it):
  - Power K seeded a closed palette: Astryx's modal `Dialog` keeps the input mounted after a close and the palette context changes on close, so the seed effect re-armed its timer and searched the closed palette (a stray `/api/search` request, a late "N results" announcement). The seed now arms only while the palette is open (`palette-parts.tsx`): `palette-initial-query.test.ts` (4 tests; the new case fails without the guard); browser PASS (type then Escape at once: no search request, nothing announced, 10 runs).
  - The sidebar's top "New work item" followed the shell flag, so the mobile drawer (Astryx provides no collapse context there and the rows are always expanded) showed the icon-only button after a collapse at desktop width or `mod+b` on a phone; pre-existing. It is now `NewItemButton` in `RailParts.tsx` and reads Astryx's collapse context like the rows: `sidebar-top-content.test.ts` (7 tests, including hydration against expanded server HTML; fails with the old Sidebar logic); browser PASS at 1440 and 375 (the pre-fix build showed the icon button in both drawer cases).
  - `shell-collapse-wiring.test.ts` now collapses through the shell (`mod+b`, and `useShell().setNavCollapsed` from outside the boundary) instead of calling the store, adds the pre-fix shape as a negative control (it throws the hydration error), and both store test files unmount their roots before the store resets. The one failing gate run of this file was not a flake: a reviewer was mutating `TesseraShell.tsx` in the same scratch copy while the gate ran (field guide).
  - `round6.spec.ts`: every case with an early action must land it in the gap (up to 3 attempts in fresh contexts, else the test fails); against the pre-fix shell 15 of 15 (a) to (d) tests fail on their first attempt in the gap. (d) asserts the rendered light background, not the stored value. `helpers-d.ts`: `EarlyRecord.gaveUp`, no unused `modifier` parameter. `fixtures.ts`: both project helpers draw a new identifier on a CONFLICT, so a worker restarted after a failure cannot collide with an earlier worker's project. The draft records the pre-fix baseline counts (four runs: 45, 45, 45 and 44 of 45 failed). Comments in `round5.spec.ts` and `round6.spec.ts` corrected (an early Playwright click can land in the gap; the drawer starts below md, 768 px).
- Docs: ui.md "Shell" (Sidebar bullet, streamed-subtree rule, which now says a context provided inside the same boundary is safe); `as-built/` (README, shell-detail, operations, workspace, hardening); `service-api.md` createWorkItem; `p7-plan.md` decision 51 ruling note; `PLAN-STATUS.md` round 6 paragraph.

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
