## P12: Sidebar modes, layout motion, virtual lists, calendar zoom (phase contract)

Draft by the phase planner on 2026-10-21. It is based on `main` at `e04b840` plus the uncommitted working tree of
another workflow (nine worker lanes), which is editing `src/**` while this was written. This is a full contract: every
design question is decided here, and no worker makes a design decision. Items marked **refresh before build** depend
on files that the other workflow is changing right now (listed at the end). Line numbers below are from the working
tree on 2026-10-21.

Revised on 2026-10-21 after the API review and the consistency review. Every point was checked against the code;
accepted points are folded into the sections below, and rejected ones are listed with a reason in the "Review log" at
the end. One question goes to the user before lane N starts (§13, Q1).

Scope comes from the user's decisions of 2026-10-21:
- the cache lane (decisions 109–111) is **dropped**;
- five Plane extras are built as P12:
  1. dock/undock (floating) sidebar;
  2. a persisted sidebar display preference (icons only, or icons with labels), built on the existing collapse rail;
  3. smooth layout transitions (about 300 ms, ease-in-out) that honour `prefers-reduced-motion`;
  4. virtual scrolling for very long lists, boards, tables and gantt rows, working with paging (decisions 112–114);
  5. calendar zoom levels Week / Month / Quarter, consistent with the gantt zoom (decision 90).

Plane (AGPL-3.0) is used only as a behaviour reference: `docs/plane-comparison.md` §4 (the left sidebar) and
the rows on transitions and virtual scrolling. No Plane code, identifiers or strings are copied. The Plane
display-mode and menu names are deliberately not reused; Tessera says "Icons only", "Icons and labels", "Undock
sidebar" and "Dock sidebar".

**Sources**
- docs/improvements.md "Future features" (the five items) and "Waiting for the user" (cache lane).
- docs/PLAN.md:
  - decisions 109–111 (lines 192–194), 112–115 and 126 (line 209);
  - §9 phases (line 444, P11 row line 460);
  - Cache Components rules (line 66).
- docs/drafts/p10-plan.md and p11-plan.md (format; P11 §8 "No virtual-list … library" is superseded here).
- docs/contracts/ui.md "Shell (lane B)" (line 78) and "Theme" (line 91).
- docs/process/swarm.md (roles, worker prompt = lane section + ownership row).
- docs/field-guide/index.md.
- Astryx 0.6.8 `.d.ts` and `.js` under `node_modules/@astryxdesign/core/dist` (§7).
- TanStack Virtual typings at `https://unpkg.com/@tanstack/virtual-core@3.17.11/dist/esm/index.d.ts` and
  `@tanstack/react-virtual@3.14.13/dist/esm/index.d.ts` (read 2026-10-21; §7).

**What already exists** (verified 2026-10-21)

Shell and sidebar
- `src/components/shell/TesseraShell.tsx` (92 lines):
  - `ShellContextValue` (`:15-24`) has `isNavCollapsed` and `setNavCollapsed`.
  - State is `useState(false)` (`:59`), so it is **not persisted**.
  - `mod+b` toggles it through `useHotkeys` with `allowInInputs` (`:62-68`).
  - `ShellFrame` renders `<AppShell height="fill" variant="wash" contentPadding={2} topNav={<TopBar/>} sideNav={sideNav}>` around the `tessera-panel` Card (`:36-45`).
- `src/components/shell/Sidebar.tsx` (293 lines):
  - `SIDEBAR_WIDTH = { defaultWidth: 250, minWidth: 236, maxWidth: 350 }` and `SIDEBAR_WIDTH_STORAGE_KEY = "tessera.sidebarWidth.v1"` (`:26-27`).
  - A prefs store is read after mount (`:37-118`); `useSidebarResize()` is at `:124-133`.
  - The SideNav is at `:194-200`: `key={resize.key}`, `aria-label="Work"`, `collapsible={{ isCollapsed, onCollapsedChange: setNavCollapsed, hasButton: false }}`, `resizable={resize.resizable}`.
  - `topContent` switches to an IconButton while collapsed (`:201`).
  - There are no `footerIcons`.
- `src/components/shell/SidebarSkeleton.tsx:13-16` renders the same SideNav shell from `useShell().isNavCollapsed`.
- `src/components/shell/TopBar.tsx:172-180` shows `SideNavCollapseButton` on desktop only (`useAppShellMobile().isMobile`). `AccountMenu` (`:128-161`) is the DropdownMenu precedent (`renderTrigger`, `DropdownMenuRadioGroup`).
- `src/app/(tessera)/layout.tsx:33-34` passes `sideNav={<Suspense fallback={<SidebarSkeleton/>}><SidebarData/></Suspense>}`.
- Astryx SideNav behaviour:
  - collapsed width is `var(--spacing-12)` (class `xhgvbfk`) and the default width is 260px (`x1hfn5x7`);
  - when `resizable` is set and the nav is not collapsed, the `<nav>` sits in a wrapper div together with the ResizeHandle (`SideNav.js:406-417`), so **collapsing remounts the nav**;
  - `className`, `style` and `...props` go onto the `<nav>` (`SideNav.js:329-335`);
  - in drawer mode it renders `footerIcons` inside the mobile drawer (`SideNav.js:258-290`);
  - the resize handle is shown only when resizable and not collapsed (`SideNav.js:223`), and `useResizable` collapses below `COLLAPSE_THRESHOLD = 160` (`:46`, `:195-205`). Tessera's `minWidth` is 236, so whether a drag can reach the threshold is checked in the `sidebar` spec (§8 Q);
  - a collapsed `SideNavItem` renders only its icon plus a Tooltip: the label `<span>` is rendered only when `!isCollapsed` (`SideNavItem.js:336-430, 437`). There is no labelled-rail mode in Astryx.
- Astryx AppShell behaviour:
  - the inline sidebar is a `LayoutPanel` with theme class `astryx-app-shell-sidenav` (`AppShell.js:408-416`). With `height="fill"` it is `isScrollable` (`overflow: auto`, class `xysyzu8`), and `LayoutPanel` renders its children directly;
  - that panel is present only above the `md` breakpoint (`:258-259`, `:323`); below it the drawer renders `sideNav` (`:522-527`). `md` is **768 px** in the Catppuccin theme (`catppuccin.js:381`; query `(width < 768px)`, `AppShell.js:240, 258`);
  - the main content is `LayoutContent role="main" id="astryx-app-shell-main" tabIndex={-1}` (`AppShell.js:63, 429-436`), the skip-link target.
- Astryx CSS is inside `@layer astryx-base` (`astryx.css:4`), so Tessera's unlayered CSS overrides it whatever the specificity. Inline styles still win.
- Precedents for a store: `src/components/shell/color-scheme.ts` (`tessera.scheme.v1`, `useSyncExternalStore`, server snapshot, `storage` event) and `src/components/detail/peek-prefs.ts`.
- Shortcuts and commands:
  - `src/components/shell/shortcuts.ts` holds `ShortcutId` (`:34-72`), `CommandId` (`:75`), `SHORTCUTS` (`:96`) and `SHELL_COMMAND_IDS` (`:147`). `mod+b` is **not** in the registry. The help dialog lists it anyway through a hand-written row: `ShortcutsDialog.tsx:44` `EXTRA_GLOBAL = [{ label: "Collapse the sidebar", keys: "mod+b" }]`, rendered at `:65`.
  - `useShortcuts.ts:120` has `DELEGATED`.
  - `command-source.ts` has the theme-command pattern (`:167-188`, `:294-299`) and `paletteSection` (`:147-159`); the Global group is not in the palette.

Motion
- Only `board.css:117` (card shadow) and the new `lock-control.css` animate. `lock-control.css:47` is the in-repo `prefers-reduced-motion` precedent.
- Astryx tokens:
  - durations: the Catppuccin theme sets `--duration-medium-min: 225ms`, `--duration-medium: 280ms`, `--duration-medium-max: 350ms` (`src/themes/catppuccin/catppuccin.css:239-241`, generator `catppuccin.js:112-114`). The theme is an `@scope ([data-astryx-theme="catppuccin"])` (`catppuccin.css:147`), and Astryx's root `Theme` sets that attribute on `<html>` (`Theme/Theme.js:223`), so these are the computed values. Astryx's own defaults (310/410/550 ms, `astryx.css:78`) never apply in Tessera;
  - `--ease-standard: cubic-bezier(0.24, 1, 0.4, 1)` (astryx.css);
  - shadows `--shadow-low|med|high`; radii `--radius-container|element|inner|page`;
  - backgrounds `--color-background-body|surface|muted`.
- Astryx components already honour reduced motion internally (astryx.css, `@media (prefers-reduced-motion: reduce)` blocks).
- `src/components/detail/PeekHost.tsx` (275 lines):
  - the side peek is the `end` slot `<ResizeHandle/><LayoutPanel resizable … className="tessera-peek-panel"><Card className="tessera-peek-card">` (`:235-240`), mounted only while open, at every viewport width;
  - `close()` goes Back or replaces (`:168-174`); Escape closes it (`:204`); the modal mode is a Dialog that already animates.
- Hidden routes: Next keeps a left route mounted under `<Activity mode="hidden">` (field guide). Its DOM stays (with `display: none`), its layout-effect cleanups run at hide time, and a WAAPI `Animation` started on it keeps running unless it is cancelled.
- The assistant panel (`mod+j`, the content Layout's `end` slot in `TesseraShell.tsx:41`) and the cycle and module side panels (`tessera-planning-side-panel`) open and close without animation today.

Lists and paging
- The scroller is `src/components/work-items/WorkItemsScreen.tsx:392-405`, `<LayoutContent padding={0} isScrollable … className="tessera-wi-scroller">`, which switches the five layouts and holds the BulkBar. It is the only host of the layouts.
- Paging lives in `src/components/work-items/paging.ts`:
  - page sizes: `ROW_PAGE = 200` (`:15`), `BOARD_GROUP_PAGE = 30` (`:17`), `LIST_GROUP_PAGE = 50` (`:19`), `CALENDAR_CAP = 1000` (`:28`);
  - `calendarWindow` (`:61-67`) calls `calendarWeeks(anchor, display.calendar.layout, …)`.
  - `use-paged-list.ts` and `GroupFooter.tsx` hold Show more (decisions 112–114).
- `ListLayout.tsx` (472 lines):
  - rows: `WorkItemRow` (`:242-299`) is a `ListItem` whose key `Button.tessera-wi-open` is the row's only tab stop;
  - groups: `GroupSection` (`:321-364`); `body` = `List density="compact" hasDividers` + GroupFooter + QuickAdd (`:338-350`);
  - dividers: Astryx gives each divided `ListItem` `border-bottom-width: var(--border-width)` and removes it from the last one with `.x1t1lzn6:last-child { border-bottom-width: 0 }` (`ListItem.js:51-57`, astryx.css). A windowed list's last *rendered* row is not the true last row;
  - the key `Button` renders no `tabindex` attribute of its own (`Button.js`), so a freshly mounted row is tabbable until a roving stamp sets it to `-1`;
  - the sticky band is the Collapsible trigger (`work-items.css:109-117`);
  - focus: `useListFocus({ itemSelector: ".tessera-wi-open", orientation: "vertical", wrap: false, hasRovingTabIndex: true, hasCaretGuard: true })` (`:386-392`);
  - the root carries `data-list-ready` (`:415`).
- `BoardLayout.tsx` (429 lines):
  - drag: `usePointerDrag` (`:161`);
  - cards: `renderCards` (`:209-250`) hides the dragged copy and splices the placeholder at `drag.target.index` (`:235`);
  - each column body is a scrolling `LayoutContent ref={registerContainer(…)} className="tessera-board-column-body"` (`:293-295`). `LayoutContent` is scrollable by default (`LayoutContent.js:132`).
  - Swimlane cells are not scroll containers (`:348`).
  - Cards are `BoardCard` (`BoardCards.tsx:23-81`, a `ClickableCard` with `cardRef`).
- `TableLayout.tsx` (462 lines):
  - an Astryx `Table` with plugins selection / open / sticky / resize / sort / grouped (`:416-423`);
  - `data={grouped ? groupedRows.data : rows}`, `idKey={grouped ? groupedRows.idKey : "id"}`, `rowCount={result.total}` (`:437-448`);
  - grouped header rows are **Proxy objects** built by Astryx (`Table/plugins/groupedRows/useTableGroupedRows.js:24-55`, `makeHeader`, `HEADER_PROXY_HANDLER`): every unknown field, `id` included, reads `""`, and they are recognised by a private Symbol. Only `groupedRows.idKey(row)` (`:202-210`, `__group_<key>`) gives them a key, and only the original objects keep the Symbol;
  - `TableRow` is `{ id, item, groupKey }` and `isDataRow` (`:59-61`) is false for any row without an `item` object;
  - the Table's scroll wrapper is `overflow-x: auto` (`Table.js:59-64`), so the header is not sticky vertically today.
- `GanttLayout.tsx` (334 lines):
  - every row is rendered (`:155-170`); rows have a fixed height: `gantt.css:107-110` sets both `min-height` and `height` to `var(--tessera-gantt-row)`, which is `--size-element-md` (32 px), or 44 px under `(pointer: coarse)` (`gantt.css:22-26`);
  - the connectors are one SVG over the body with `viewBox 0 0 days rows` (`:149-153`);
  - the head and the label column are sticky;
  - a private `cssVars(vars): CSSProperties` (`:38`; the same copy is in `planning/ModulesTimeline.tsx:45`) passes custom properties to `style`.
- Bar drags: `src/components/dnd/use-timeline-drag.ts:101` calls `setPointerCapture` on the bar; the preview is `{ id, mode, delta }` (`:15-19`).
- Board and list drags: `src/components/dnd/use-pointer-drag.ts` listens on `window`, renders a separate overlay clone and reads rects live (`:193-207`), so it does not need the source element to stay mounted.
- Drag: `src/components/dnd/use-pointer-drag.ts:199-207` maps the drop slot over **rendered** items only. When `slot` is past the last rendered item, the index is `ids.length` (the container's true end), which is wrong once a container renders a window.

Calendar
- `CalendarLayoutSchema = z.enum(["month", "week"])` (`src/lib/tessera/schemas.ts:224`); `CalendarDisplaySchema.layout` defaults to `"month"` (`:245-248`). It is also used by:
  - `url-state.ts:38`;
  - `view-settings.ts:54` ("Month or week grid.");
  - `tools/describe-filters.ts:169`;
  - `DisplayMenu.tsx:98-99,193-201` (SegmentedControl "Calendar view", Month/Week).
- `calendar-math.ts` (138 lines):
  - type `CalendarView = "month" | "week"`;
  - functions `shiftPeriod`, `periodLabel`, `calendarWeeks`, `isOutsideMonth`.
- `CalendarLayout.tsx` (346 lines):
  - `MAX_IN_CELL = 4` for both views (`:43`);
  - hotkeys `t`, `[`, `]`;
  - `?cal=` anchor; "Previous/Next month|week".
- The gantt zoom Week/Month/Quarter exists (decision 90; `DisplayMenu.tsx:205-214`).

Tests and tooling
- The tooling versions:
  - Vitest is configured to pick up `tests/**/*.test.ts` and `src/**/*.test.ts`;
  - jsdom render tests exist, for example `tests/ui/detail-smoke.test.ts`;
  - Playwright is 1.63.0, set up in `playwright.config.ts`: `next start` on :3100, `data/e2e.db`, one worker;
  - shared helpers live in `tests/e2e/fixtures.ts` (new, written by the other workflow): `test`, `expect`, `mcp`, `e2eDbPath`, `uniqueIdentifier`, `openWorkItems`, `workItemsUrl`, `openLayout`, `boardColumn`, `listRows`, `dragByPointer`;
  - Next keeps left routes in the DOM, so a document-wide query (`$$`, `document.querySelector`, an unscoped locator) can hit a hidden copy after an in-app navigation.
- Perf seeding: `scripts/perf-seed.ts` (`--db --items --projects --project`, idempotent per project, refuses `data/tessera.db` and `TESSERA_DB_PATH`). `npm run perf:bench` (`scripts/perf-bench.ts`) times the engine budgets of decision 115; no Playwright spec measures the UI `[data-list-ready]` budget today.
- Cache lane remnants: P11 built the partial index `activity_workspace_seq_idx` (`src/lib/tessera/db/schema/core.ts:347-348`, comment "Decision 109 workspaceRev"; `drizzle/0008_hardening.sql:19`) and the revision-probe cases of `tests/perf/query-plans.test.ts:134, 172` (decision 126). Nothing else of decisions 109–111 exists.
- Configuration facts:
  - React Compiler is **off**: there is no `reactCompiler` in `next.config.ts`.
  - The `react-hooks/incompatible-library` lint rule flags TanStack Virtual's `useVirtualizer` (`eslint-plugin-react-hooks` development build, `:31575-31580`).
  - `THIRD_PARTY_NOTICES.md` lists adapted code and reviewed exceptions only. Plain npm dependencies are covered by `package.json` and the licence gate.

---

### 1. Scope and deferrals

**In scope**
- **Sidebar display preference.** Icons only / Icons and labels, persisted per browser. "Icons only" is the existing Astryx collapse rail and "Icons and labels" is the full sidebar, with no second rail (decision 128). Whether the user meant Plane's narrower labelled rail instead is Q1 (§13); §6.1.1 specifies that variant so the swap needs no replan.
- **Docked / floating sidebar.**
  - Floating takes the sidebar out of the layout, so the content panel gets the full width.
  - The sidebar opens as an overlay from a top-bar button, `mod+b` or an 8 px hover edge.
- **Layout motion.**
  - A width transition on sidebar collapse/expand, dock/undock and side-peek open/close.
  - A slide for the floating sidebar and a fade on layout and zoom switches.
  - Duration `--duration-medium` (280 ms in the Catppuccin theme, the token closest to the requested 300 ms), easing `ease-in-out`; none at all under `prefers-reduced-motion: reduce`.
- **Virtual scrolling.**
  - Covers list (flat and grouped), table (flat and grouped), board columns and gantt rows, above fixed thresholds.
  - Paging, Show more, group counts, optimistic moves, keyboard focus, drag and drop, selection and sticky headers keep working.
  - It comes with a perf budget and a Playwright perf spec on 10 000 items.
- **Calendar zoom.** Week / Month / Quarter (calendar quarters) in the display menu, `[`/`]` by period, and compact quarter cells.
- **Docs.**
  - Decisions 109–111 are marked dropped and decisions 127–139 are added.
  - Updates go to §9, PLAN-STATUS.md, improvements.md and a P12 section in ui.md.

**Deferred** (with the reason; each goes to docs/improvements.md "Future features" in lane 0)

| Item | Why not now |
|---|---|
| Virtualising board swimlane cells | Cells are not scroll containers and page at 30 per cell (decision 112). Lanes collapse. Revisit if a cell needs more than 200 cards. |
| Virtualising calendar cells, the pages tree, inbox, activity, comments | Bounded by period, cap or page size today. |
| Infinite scroll (auto "Show more" at the end) | Decision 112's explicit Show more stays; the footer is never virtualised. |
| Server-side (per-user, cross-device) sidebar preferences | Tessera is single-user and local. The preference is a device UI preference like the width (`tessera.sidebarWidth.v1`) and the scheme. |
| A right-click context menu on the sidebar | Replaced by a visible "Sidebar options" button and Power K commands (decision 131), which are discoverable by keyboard. |
| View Transitions API (`<ViewTransition>`) | Decision 132: it snapshots the whole document and runs only inside transitions. Sidebar and peek toggles are sync updates, and the hidden `<Activity>` routes make snapshots unpredictable. |
| Fiscal quarters or a workspace quarter start | Calendar quarters only (decision 139). |
| Quarter zoom for the modules timeline, cycle timeline | Out of the five requested items. |
| A labelled rail (an icon with a small label under it, Plane's wider rail mode) | Astryx's collapsed `SideNavItem` renders no label (`SideNavItem.js:437`), so it needs Tessera's own rail items. Built only if the user answers Q1 with "B" (§6.1.1); otherwise it stays here. |
| Motion for the assistant panel (`mod+j`) and the cycle and module side panels (`tessera-planning-side-panel`) | Not among the requested surfaces. They keep opening instantly, so the inconsistency with the animated peek is deliberate; the same `animateWidth` helper fits them later. |
| Find-in-page over off-window rows | A trade-off of windowing (decision 137); the filter field and Power K search find any item. |

### 2. New decisions (lane 0 writes them into docs/PLAN.md after row 126)

| # | Decision |
|---|---|
| 127 | **Cache lane dropped.** The user dropped the `"use cache"` lane on 2026-10-21. Decisions 109–111 stay in the table marked "Dropped 2026-10-21 (decision 127)" with their text kept for history. Reads stay dynamic (`await io()` + `readTessera`) and own writes use `refresh()`. External writes keep `ChangesPoller` → `refreshAction`. No `src/app/_cache/`, `cacheTag`, `updateTag` or `tests/cache-safety.test.ts` will be written. Only the workspace revision index `activity_workspace_seq_idx` (`schema/core.ts:347-348`, migration 0008) and its query-plan probes (decision 126) were built in P11; they stay, because they are harmless and decision 126 tests them. Their "Decision 109" comment stays valid, since decision 109 keeps its row. The P11 exit criterion "no blocking-route insight" stays. |
| 128 | **Sidebar display preference.** `display: "labels" \| "icons"`, default `"labels"`. "Icons only" is the Astryx collapsed rail: SideNav `collapsible.isCollapsed = true`, width `var(--spacing-12)`, item labels as tooltips, `topContent` as the IconButton (`Sidebar.tsx:201`). "Icons and labels" is the full sidebar at the stored width (236–350 px, default 250). This is the reading of the user's item 2 that builds on the existing rail without a second one: Astryx's collapsed items render no label (`SideNavItem.js:437`), so Plane's narrow labelled rail would need Tessera's own rail items. That reading is Q1 (§13), specified in §6.1.1, and deferred unless the user picks it. The preference is set from: the top-bar `SideNavCollapseButton` (docked only); `mod+b` (docked); the "Sidebar options" menu; Power K; and a drag of the resize handle below Astryx's collapse threshold (160 px, below Tessera's 236 px minimum; persists `"icons"`, no animation). The `sidebar` spec records whether that drag can reach the threshold; no code depends on it. Every change persists (decision 130). **Focus:** the nav remounts when it gains or loses the resize wrapper (`SideNav.js:223, 406-417`). So after any display or dock change, the shell checks two animation frames later; if focus fell to `<body>`, it focuses the "Sidebar options" button `#tessera-nav-options` (or `#tessera-nav-toggle` when that button is inert). The preference applies only while docked and at or above the AppShell `md` breakpoint (768 px); the mobile drawer always shows labels. |
| 129 | **Docked and floating sidebar.** `dock: "docked" \| "floating"`, default `"docked"`. **Floating:** the AppShell sidenav panel takes no width. The SideNav becomes an absolutely positioned overlay inside that panel: 8 px (`--spacing-2`) from the top-bar edge, the window bottom and the left edge; the width is the stored sidebar width; it always shows labels (the display preference is kept but not applied); `--color-background-body`, `--color-border` hairline, `--radius-container`, `--shadow-high`; z-index 300. It is closed by default. **Opens on:** the top-bar "Show sidebar" button; `mod+b`; Power K; the pointer resting 120 ms on an 8 px edge strip at the window's left edge below the top bar (only for `(hover: hover)` pointers). Opening by button, `mod+b` or Power K moves focus, one frame later, to the first of: `[data-nav-autofocus]` (the enabled "New work item" button), the `[aria-current="page"]` item, the first `a[href]` or enabled button in `#tessera-sidebar`. Hover does not move focus. **Closes on:** the pointer leaving the panel for 300 ms; Escape inside the panel; a pointer press outside the panel, the edge and the toggle; focus leaving the panel (checked one animation frame after `focusout`, against the live DOM); a pathname change; `mod+b` or the toggle again. **Stays open while:** focus is inside it; a control inside has `aria-expanded="true"` (an open menu); `body.tessera-dragging` is set (project reorder); or a modal `dialog[open]` is in the document (for example Create project opened from the Projects "+"), so the dialog's focus return lands inside the open panel. **The toggle:** a `pointerdown` on `#tessera-nav-toggle` marks a pending toggle press for 500 ms or until its click. The focusout and outside-press closes ignore a pending press and a `relatedTarget` inside the toggle, so a click on "Hide sidebar" closes the panel once and never re-opens it, Safari (no focus on click) included. **Focus after a close:** Escape → the toggle; toggle or `mod+b` → the toggle if focus was inside, else unchanged; a pathname change with focus inside → the main content `#astryx-app-shell-main` (AppShell's skip target); any other reason → unchanged. While closed, the panel is `inert`, `visibility: hidden` after the slide, and translated out. It is never resizable while floating. Below the `md` breakpoint the dock preference is ignored (drawer as today), and the open state resets to closed whenever the breakpoint flips. Switching to docked closes the overlay and restores the stored display preference. |
| 130 | **Navigation preference storage.** `localStorage["tessera.nav.v1"]` holds JSON `{"display":"labels"\|"icons","dock":"docked"\|"floating"}`. `parseNavPrefs` validates each field on its own: unknown or missing fields fall back to their defaults and extra keys are ignored. Read through `useSyncExternalStore`, whose server snapshot is the defaults, so hydration renders labels/docked and then switches to the stored value **without animation**. This is the same first-paint trade-off as `tessera.scheme.v1` and the stored width; acceptance step 4 makes it visible. Other tabs follow through the `storage` event, without animation. Writes are wrapped in try/catch (private mode): the change still applies to this page. The floating open state is session state in `TesseraShell` and is never stored. There is no database column, no migration and no legacy key to read: today's collapse is not persisted. |
| 131 | **Sidebar shortcut and commands.** `mod+b` stays the only key. It becomes the registry entry `"sidebar.toggle"` ("Show or hide the sidebar", group Global): the help dialog lists it exactly once, because the hand-written `EXTRA_GLOBAL` row in `ShortcutsDialog.tsx:44` ("Collapse the sidebar") is removed. The palette does not list it (Global), and `useShortcuts` leaves it to `TesseraShell` (`DELEGATED`). Docked: it toggles icons and labels. Floating: it opens or closes the overlay. Below `md` it does nothing (the drawer has its own toggle, and the stored preferences stay untouched). Power K gains four palette-only commands in "Settings", labelled like the menu: "Sidebar: Icons and labels" (`sidebar.labels`), "Sidebar: Icons only" (`sidebar.icons`), "Sidebar: Undock (float over the page)" (`sidebar.float`), "Sidebar: Dock" (`sidebar.dock`). Their keywords are `sidebar, navigation, rail, collapse, expand, dock, float, icons, labels`. The command for the current state is not listed, and none is listed below `md`. The "Sidebar options" footer button (`footerIcons`, desktop only, id `tessera-nav-options`) opens a DropdownMenu. Docked, it shows a radio group "Show" with "Icons and labels" / "Icons only", a divider, then "Undock sidebar" (description "Show it over the page when you need it"). Floating, it shows only "Dock sidebar". |
| 132 | **Layout motion.** Exactly these animate: (1) docked collapse/expand: WAAPI `width` on the `.astryx-app-shell-sidenav` panel from its old to its new width, while the docked panel clips horizontally (`overflow-x: hidden`, so no scrollbar flashes as the nav is wider than the growing panel); (2) dock/undock: the same panel animation (to or from 0) while the floating panel slides; (3) floating open/close: CSS `transform` slide plus delayed `visibility`; (4) side peek open/close: WAAPI `width` on the `tessera-peek-panel` LayoutPanel from 0 to w, or w to 0, with the peek card held at its final width during the animation so the detail does not reflow. The close runs the animation first and then navigates. A second close during it does nothing. The animation is cancelled, never navigating, when the route is hidden or unmounted. On finish it navigates only if the URL still equals the one captured at close, and it decides Back or replace at that moment; (5) layout switches: an opacity 0 → 1 fade of the work-items scroller when `display.layout`, `display.calendar.layout` or `display.gantt.zoom` changes after the first render. Duration: the computed `--duration-medium` (280 ms in the Catppuccin theme, `catppuccin.css:240`; the token closest to the requested 300 ms; fallback 300 ms if unreadable). Easing: `ease-in-out`. Nothing animates on: hydration, the stored value arriving, `storage` events, drag-resizing (any `[data-resizing]` element), the browser Back button, a peek mode switch (side ↔ modal), a peek switching items, or the first render. Below `md` there is no sidebar panel, so sidebar changes apply without animation; the peek and the fade animate at every width. No View Transitions API. |
| 133 | **Reduced motion.** `prefers-reduced-motion: reduce` is read through `matchMedia` at the moment of each change, never cached. When it matches, every decision 132 animation is skipped: the state applies in the same frame and the peek close navigates at once. Every P12 CSS transition has a `@media (prefers-reduced-motion: reduce) { transition: none; }` override in the same stylesheet. Astryx components keep their own handling. Playwright checks both modes with `page.emulateMedia({ reducedMotion })`. |
| 134 | **Virtual scrolling library.** `@tanstack/react-virtual` **3.14.13** (exact), MIT, peers `react` and `react-dom` ^16.8–^19, published 2026-09-14. Its only dependency is `@tanstack/virtual-core` 3.17.11 (MIT, no dependencies). It is imported only by `src/components/virtual/use-virtual-rows.ts`, which disables `react-hooks/incompatible-library` on one line with the reason (React Compiler is off; the instance never leaves the hook). It was chosen because it is headless, so it keeps Astryx `List`/`Table`/`Card` markup and Tessera's own scroller. It supports a shared scroll container via `scrollMargin`, dynamic measurement via `measureElement`, extra rendered indexes via `rangeExtractor`, and the `enabled`, `getItemKey` and `initialRect` options; and it is the most agent-familiar option. Rejected: react-window (owns its scroll container per list, which breaks the shared scroller and sticky group bands); react-virtuoso (owns the scroller and renders its own sticky group headers); a hand-written windower (more code to verify than the library); CSS `content-visibility: auto` (each row still mounts its Astryx controls and keeps its DOM, so 10 000 rows still cost the React mount time and the memory). |
| 135 | **Virtual windows.** Thresholds (strictly more than): list 250 loaded rows across all groups; table 250 loaded rows (including grouped header rows); gantt 250 rows; board 60 loaded cards **per column**. Below a threshold the DOM is exactly today's. Overscan: list 10, table 10, gantt 12, board 5. Estimates in CSS px (JS numbers, corrected by measurement): list row 45, table row 41, board card 104; gantt row = the first rendered row's measured height, which is fixed (`gantt.css:107-110` sets `height`; 32 px, or 44 px under a coarse pointer), so gantt rows are not measured one by one. The scroll element is `.tessera-wi-scroller` (from `VirtualScrollerProvider` in WorkItemsScreen) for list, table and gantt, and the column's `.tessera-board-column-body` for board columns. Each virtual container (a list group's `List`, the table `tbody`, the gantt body, a column's cards stack) is an **anchor**. `scrollMargin` is the anchor's offset inside the scroller, re-measured after each commit of the virtual component (a layout effect, which also runs when a hidden route is shown again) and whenever the provider's `layoutVersion` changes (a ResizeObserver on the scroller's first element child, throttled to one bump per animation frame). Rows stay in normal flow and the window is padded by `--tessera-virtual-before` / `--tessera-virtual-after` on the anchor; the table uses spacer rows instead. `initialRect` is `{ width: 1024, height: 900 }`, so server and first client render agree. **Kept rows:** a `rangeExtractor` adds the kept indexes to TanStack's default range, so they are rendered and measured: the last-focused row of each container, and in the gantt the row of the bar being dragged (its pointer capture would be lost if it unmounted). List, board and gantt place a kept row outside the window absolutely at its measured offset (`.tessera-virtual-kept`), before or after the window in DOM order. The table keeps it in normal flow between split spacer rows. **Measurement guard:** a measured size of 0 on an element without an `offsetParent` (a hidden route, a collapsed ancestor) keeps the cached size for that index (else the estimate). **Print:** windowing is off while printing (`beforeprint`/`afterprint`, applied with `flushSync`, and while `matchMedia("print")` matches), so a print shows every loaded row. **Dividers:** when the last rendered row is not the container's last row, `virtual.css` restores the bottom divider that Astryx removes from `:last-child`. Row `data-index` values are strings (Astryx `BaseProps` types `data-*` as `string`). |
| 136 | **What virtualisation keeps working.** **Paging:** footers ("Show N more") and quick-add rows sit after the virtual body and are never virtualised; counts, `has_more` and the loaded/total notes are unchanged (decisions 112–114). **Sticky:** list group bands stay sticky because the group container keeps its full height. The gantt head and label column are unchanged; the table header is not sticky today and stays so; board column headers are outside the column scroller. **Drag and drop:** `computeTarget` uses `indexForSlot`, so a drop below the last *rendered* card lands right after it, not at the column's true end (extends decision 114). The board placeholder is a virtual item keyed `"placeholder"` with its own `data-index`, sized to the dragged card. Auto-scroll moves the window. Board and list drags need no kept source element (window listeners, a separate overlay clone); the gantt bar drag keeps its row (decision 135). **Keyboard:** list arrows keep `useListFocus`; after each virtual commit `stampTabStops` keeps exactly one `.tessera-wi-open[tabindex="0"]` (freshly mounted rows carry no `tabindex`, so a kept row keeps the stop). In a virtual list, Home and End scroll the scroller to the top or bottom and focus the first or last rendered row after two animation frames. When ArrowUp, ArrowDown, Home, End, PageUp or PageDown is pressed on a kept (off-window) focused row, the row is first scrolled into view (`scrollToIndex`) and nothing else happens. Every other key (Tab, Enter, Space, Escape, the global shortcuts) behaves as usual. Tab order elsewhere follows the rendered DOM. **Selection:** works on ids; group and header checkboxes act on loaded ids. **Optimistic rows:** quick-add placeholders and moved items are ordinary items of the window. |
| 137 | **Virtualisation trade-offs.** Find-in-page (Cmd/Ctrl+F) finds only rendered rows of a virtual list; the filter field and Power K search find any item; small lists (below decision 135's thresholds) are unaffected. Printing is not a trade-off (decision 135 turns windowing off). A11y: virtual list rows carry `aria-posinset` (1-based position among the loaded rows of their group) and `aria-setsize` = the group's total, `max(group.count, loaded)` (flat: `max(result.total, loaded)`), the same number as the group badge and the table's `aria-rowcount`. The virtual table keeps `aria-rowcount = result.total` and sets each rendered row's `aria-rowindex` to its 1-based position in the loaded rows. Spacer rows are `aria-hidden="true"` and `role="presentation"`. Board and gantt expose rendered items only. |
| 138 | **Virtual scrolling performance budget.** On a production build (`next start`), Chromium new headless (`channel: "chromium"`), no CPU throttling, project `VIRT` with 10 000 items (perf seed), all rows loaded. Scroll scenarios: list flat, table flat and gantt flat (10 000 rows each), and one board column with at least 1 000 cards. Each is scrolled for 5 s by +120 px per animation frame, top to bottom and back. Budget per scroll scenario: **zero** `longtask` entries (no task over 50 ms); median frame interval ≤ 17.5 ms (60 fps target); 95th percentile ≤ 34 ms; rendered rows ≤ 90 (list, table, gantt) or ≤ 40 cards in the column. The final "Show more" that brings the list from 9 800 to 10 000 rows causes no long task. First render: decision 115's UI budget still holds for a list that is virtual from its first paint (grouped by labels, more than 250 loaded rows), with p95 ≤ 300 ms over 20 navigations from navigation start to `[data-list-ready]`. Measured by `tests/e2e/virtual-perf.spec.ts` (§10), which runs only with `E2E_PERF=1`, on the visible route's scroller only. |
| 139 | **Calendar zoom.** `CalendarLayoutSchema` becomes `z.enum(["week", "month", "quarter"])`. The stored field stays `display.calendar.layout`, so no migration is needed: old JSON is valid. The default stays `"month"`. The display menu control becomes "Zoom" with Week / Month / Quarter, in the gantt's order. **Quarter** = the calendar quarter containing the anchor (Q1 Jan–Mar …), shown as one grid of the whole weeks that touch it (13 or 14 rows: 90–92 days plus a 0–6 day offset), weeks starting on the workspace week start. Days outside the quarter are muted (`data-outside`). The first day of each month shows "Nov 1", other days the number. `[`/`]` and Previous/Next move one quarter; `t` and Today go to today. The heading reads "Q4 2026 (Oct – Dec)". Items per cell before "+N more": week 8, month 4, quarter 2. When the calendar itself is narrower than 600 px (its root measured with a ResizeObserver, so an open side peek counts too), quarter cells show no item rows, only a "+N" button (accessible name "N work items on <date>"). Week cells are taller (min-height 8 × `--spacing-8`), quarter cells shorter (2 × `--spacing-8`). The data window is `calendarWindow` (unchanged code, now covering the quarter's weeks) with the existing 1 000 cap and Banner. MCP: `describe_filters`, `save_view_settings` and `get_view_settings` accept and describe `quarter` ("Week, month or quarter grid."). |

### 3. Data model changes

None. Nothing changes in SQLite. The only stored shapes that change are:

| Where | Change | Migration |
|---|---|---|
| `display.calendar.layout` (view settings JSON, URL state `q`) | Accepts `"quarter"` | None; existing `"month"` and `"week"` stay valid |
| `localStorage["tessera.nav.v1"]` (new) | `{ display, dock }` | None; absent key = defaults |

### 4. Engine and schema edits (lane 0)

- `src/lib/tessera/schemas.ts:224`: `CalendarLayoutSchema = z.enum(["week", "month", "quarter"])`; `:246` describe text "Week, month or quarter grid.".
- `src/lib/tessera/view-settings.ts:54`: describe text "Week, month or quarter grid.".
- `tools/describe-filters.ts:169` lists `CalendarLayoutSchema.options`, so it needs no change. `url-state.ts:38` needs none either.
- `docs/contracts/ai.md:76` (the `describe_filters` payload): `calendar: { layout: ("week" | "month" | "quarter")[], … }`.
- Tests (lane 0): extend `tests/view-settings.test.ts` with a `save_view_settings` round trip of `display.calendar.layout = "quarter"`. Extend `tests/ui/url-state.test.ts` so that a `q` carrying quarter parses and `"year"` is rejected.

### 5. Shared modules written by lane 0 (exact API; other lanes import them)

**5.1 `src/components/shell/nav-prefs.ts`** ("use client"-safe, no React import except the hook)
```ts
export type NavDisplay = "labels" | "icons";
export type NavDock = "docked" | "floating";
export type NavPrefs = { display: NavDisplay; dock: NavDock };
export const NAV_PREFS_STORAGE_KEY = "tessera.nav.v1";
export const DEFAULT_NAV_PREFS: NavPrefs = { display: "labels", dock: "docked" };
export function parseNavPrefs(raw: string | null): NavPrefs;           // decision 130 field-by-field fallback
export function serializeNavPrefs(prefs: NavPrefs): string;            // JSON with exactly the two keys
export function isRailCollapsed(prefs: NavPrefs): boolean;             // dock === "docked" && display === "icons"
export function useNavPrefs(): NavPrefs;                               // useSyncExternalStore; server snapshot DEFAULT_NAV_PREFS
export function setNavPrefs(patch: Partial<NavPrefs>): void;           // merge, write (try/catch), emit; no-op when unchanged
export const SIDEBAR_COMMAND_PREFIX = "sidebar.";
export type SidebarCommandId = "sidebar.labels" | "sidebar.icons" | "sidebar.float" | "sidebar.dock";
export function sidebarCommandPatch(id: string): Partial<NavPrefs> | null; // labels→{display}, icons→{display}, float→{dock:"floating"}, dock→{dock:"docked"}
```
The snapshot is cached and re-parsed only on `setNavPrefs` and on the `storage` event for this key, so
`getSnapshot` is referentially stable.

**5.2 `src/components/shell/layout-motion.ts`** (decisions 132–133)
```ts
export const LAYOUT_MOTION_EASING = "ease-in-out";
export const LAYOUT_MOTION_FALLBACK_MS = 300;
export const LAYOUT_MOTION_TOKEN = "--duration-medium";                          // 280ms in the Catppuccin theme (catppuccin.css:240)
export const SIDENAV_DRAWER_QUERY = "(width < 768px)";                           // AppShell's md breakpoint in the Catppuccin theme (catppuccin.js:381)
export function parseDurationMs(value: string, fallback?: number): number;      // "280ms"→280, "0.28s"→280, else fallback
export function layoutMotionMs(): number;                                        // computed LAYOUT_MOTION_TOKEN on <html>, else LAYOUT_MOTION_FALLBACK_MS
export function prefersReducedMotion(): boolean;                                 // false without window
export function isResizing(): boolean;                                           // document has [data-resizing]
export type WidthPlan = { from: number; to: number } | null;
export function widthMotionPlan(input: { from: number; to: number; reduced: boolean; resizing: boolean }): WidthPlan; // null if reduced, resizing or |from−to| < 1
export function animateWidth(el: HTMLElement, plan: { from: number; to: number }, pin?: { el: HTMLElement; width: number }): Animation | null;
export function withWidthMotion(el: HTMLElement | null, change: () => void): void; // from = el width; flushSync(change); to = el width; animate
export function fadeIn(el: HTMLElement | null): Animation | null;               // opacity 0→1, skipped under reduced motion
export function useFadeOnChange(el: HTMLElement | null, key: string): void;     // useLayoutEffect; skips the first key
export function sideNavPanel(): HTMLElement | null;                             // document.querySelector(".astryx-app-shell-sidenav")
```
- `animateWidth` uses `el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: layoutMotionMs(), easing: LAYOUT_MOTION_EASING })`.
- With `pin`, it runs a second animation on `pin.el` with constant `{ width: `${pin.width}px` }` keyframes and the same timing. Cancelling the returned animation also cancels the pin animation (`animation.addEventListener("cancel", …)`).
- `animateWidth` returns null when `el.animate` is missing (jsdom); callers check reduced motion and resizing first (`widthMotionPlan`, or the peek predicates of §6.2.1).
- `withWidthMotion` must be called only from event handlers, because it uses `flushSync`. When `el` is null (below `md` there is no sidebar panel), it runs `change` without animation.
- Nothing in this module checks the viewport width: decision 132 animates the peek and the fade at every width, and the sidebar panel simply does not exist below `md`. `SIDENAV_DRAWER_QUERY` is for lane N (decisions 129 and 131).

**5.3 Stylesheets and the style helper.**
- Lane 0 creates `src/components/styles/nav.css` and `virtual.css`, each with a header comment only, and imports them in `src/app/globals.css` after `paging.css`. Lanes N and V1 fill them.
- Lane 0 creates `src/components/shared/css-vars.ts`: `export function cssVars(vars: Record<string, string | number>): CSSProperties` (the same body as the private copy in `GanttLayout.tsx:38`; `import type { CSSProperties } from "react"`). Custom-property keys are not valid `CSSProperties` keys, so every P12 style object that sets a `--tessera-*` name goes through it, with the name as a literal quoted key (`cssVars({ "--tessera-virtual-before": cssPx(before) })`). The convention scanner sees the key inside the call (`scripts/convention-rules.ts:171-176`, `definedTokens`). The two existing private copies stay as they are.

**5.4 Icons** (`src/themes/catppuccin/icons.tsx`): `PinIcon = duotoneIcon(PushPin)` and
`UnpinIcon = duotoneIcon(PushPinSlash)` (both exist in `@phosphor-icons/react`). The options trigger reuses `SidebarIcon`.

### 6. Screens and components

**6.1 Sidebar and shell (lane N)**

`TesseraShell.tsx`:
- **Context.** `ShellContextValue` becomes:
  ```ts
  type ShellContextValue = {
    navPrefs: NavPrefs;
    isNavCollapsed: boolean;                                     // isRailCollapsed(navPrefs)
    isNavDrawer: boolean;                                        // useMediaQuery(SIDENAV_DRAWER_QUERY, false): below md
    setNavCollapsed: (collapsed: boolean) => void;               // = setNavDisplay(collapsed ? "icons" : "labels")
    setNavDisplay: (display: NavDisplay, options?: { animate?: boolean }) => void;
    setNavDock: (dock: NavDock) => void;
    isNavOpen: boolean;                                          // floating overlay, session only
    setNavOpen: (open: boolean, options?: { focus?: "panel" | "toggle" | "main" | "none" }) => void;
    openCommandBar: (initialQuery?: string) => void;
    openShortcuts: () => void;
    openCreateProject: () => void;
  };
  ```
- **`setNavDisplay`:** `withWidthMotion(sideNavPanel(), () => setNavPrefs({ display }))`, then `refocusNav()`. With `animate: false` it calls `setNavPrefs` directly (then `refocusNav()`).
- **`setNavDock`:** `withWidthMotion(sideNavPanel(), () => { setNavPrefs({ dock }); setOpen(false) })`, then `refocusNav()`.
- **`refocusNav()`** (decision 128, local to `TesseraShell`): two `requestAnimationFrame`s later, if `document.activeElement` is `null` or `document.body`, focus `#tessera-nav-options` when it exists and has no `[inert]` ancestor, else `#tessera-nav-toggle` when it exists. It does nothing when focus is anywhere else, so a change made from the top bar or the content keeps its focus. This covers the menu ("Icons only", "Icons and labels", "Dock sidebar", "Undock sidebar") and Power K, whose dialog returns focus to an element that the nav remount removed.
- **`setNavOpen` focus**, one animation frame later:
  - `"panel"`: the first of `#tessera-sidebar [data-nav-autofocus]:not([disabled])`, `#tessera-sidebar [aria-current="page"]`, `#tessera-sidebar :is(a[href], button:not([disabled]))`;
  - `"toggle"`: `#tessera-nav-toggle`;
  - `"main"`: `#astryx-app-shell-main` (AppShell's skip target, `tabIndex={-1}`);
  - `"none"`: nothing.
- **`mod+b`:** below `md` (`isNavDrawer`) it does nothing. Floating → `setNavOpen(!isNavOpen, { focus: isNavOpen ? (focus inside #tessera-sidebar ? "toggle" : "none") : "panel" })`. Docked → `setNavDisplay(display === "icons" ? "labels" : "icons")`.
- **Breakpoint flip:** a `useEffect` on `isNavDrawer` sets `isNavOpen` to false, so an overlay opened before the window narrowed never pops open when it widens again.

`side-nav-chrome.ts`:
- Pure, exported for the test:
  ```ts
  export type SideNavChromeInput = {
    prefs: NavPrefs; isOpen: boolean; isMobile: boolean; width: number;
    resizable: SideNavResizable;                                // resize.resizable from useSidebarResize()
    onCollapsedChange: (collapsed: boolean) => void;            // (c) => setNavDisplay(c ? "icons" : "labels", { animate: false })
  };
  export type SideNavChrome = {
    collapsible: SideNavCollapsibleConfig; resizable: SideNavResizable | undefined;
    id: "tessera-sidebar"; className: "tessera-sidebar";
    "data-dock": "floating" | undefined; "data-open": "" | undefined; inert: boolean; style: CSSProperties | undefined;
  };
  export function sideNavChrome(input: SideNavChromeInput): SideNavChrome;
  export function useSideNavChrome(): SideNavChrome;            // reads useShell(), useSidebarResize(), useAppShellMobile()
  ```
  `SideNavCollapsibleConfig` is exported by name from `@astryxdesign/core/SideNav` (`SideNavCollapseContext.d.ts:10-14`, `SideNav/index.d.ts`). The resizable config type is not exported by name, so `side-nav-chrome.ts` declares `type SideNavResizable = Exclude<SideNavProps["resizable"], boolean | undefined>` (`SideNav.d.ts:102`).
- `useSideNavChrome()` is used by **both** `Sidebar` and `SidebarSkeleton`, so they render the same frame.
- Docked or mobile: `collapsible = { isCollapsed: isNavCollapsed, onCollapsedChange, hasButton: false }`; `resizable = input.resizable`; no `data-dock`; `inert` false; no `style`.
- Floating and not mobile: `collapsible = { isCollapsed: false, hasButton: false }`, `resizable` undefined, `data-dock="floating"`, `data-open={isOpen ? "" : undefined}`, `inert={!isOpen}`, `style={cssVars({ "--tessera-nav-float-width": `${width}px` })}` (§5.3). `width` is `resizable.defaultWidth`.
- `isMobile` comes from `useAppShellMobile()` (Sidebar and skeleton render inside AppShell).

`Sidebar.tsx`:
- It spreads the chrome onto `SideNav` (the `key` stays `resize.key`).
- It adds `footerIcons={isMobile ? undefined : <SidebarOptionsMenu />}`.
- Both "New work item" controls in `topContent` (the full `Button` and the collapsed `IconButton`) get `data-nav-autofocus=""`.
- When floating, not mobile, closed and `useMediaQuery("(hover: hover)", false)`, it renders before the SideNav `<VStack className="tessera-nav-edge" aria-hidden {...edgeHandlers} />`.
- It calls `useFloatingNav({ panelId: "tessera-sidebar" })` (new `use-floating-nav.ts`), which returns `panelHandlers` (spread on SideNav: `onPointerEnter`, `onPointerLeave`, `onBlur`, `onKeyDown`) and `edgeHandlers` (`onPointerEnter`, `onPointerLeave`). While floating and open, the hook:
  - **pointer leave:** starts a `FLOAT_CLOSE_DELAY_MS` timer that a pointer enter cancels. When it fires, it closes with reason `"pointer"` unless `floatingStaysOpen(liveState())`;
  - **blur** (React `onBlur` bubbles like `focusout`): one animation frame later, it closes with reason `"blur"` when `shouldCloseOnFocusOut(...)` is true. The inputs are: focus is not inside the panel; `event.relatedTarget` is not inside `#tessera-nav-toggle`; `isTogglePressPending(performance.now())` is false; and `floatingStaysOpen(liveState())` is false;
  - **Escape** (`onKeyDown`, not when an inner menu handled it, i.e. `!event.defaultPrevented`): closes with reason `"escape"`;
  - **outside press:** a document `pointerdown` listener (capture). A press outside the panel, the edge strip and `#tessera-nav-toggle` closes with reason `"outside"`, unless a toggle press is pending or `floatingStaysOpen(liveState())`;
  - **route:** a `usePathname()` change closes with reason `"route"`.
  - `liveState()` reads the DOM at that moment: `focusInside` (`panel.contains(document.activeElement)`), `menuOpen` (`panel.querySelector('[aria-expanded="true"]') !== null`), `dragging` (`document.body.classList.contains("tessera-dragging")`) and `modalOpen` (`document.querySelector("dialog[open]") !== null`).
  - Every close calls `setNavOpen(false, { focus: closeFocusTarget(reason, focusWasInside) })`.
  - While closed, the edge strip's pointer enter starts a `FLOAT_OPEN_DELAY_MS` timer that its pointer leave cancels. When it fires, it opens with `{ focus: "none" }`.

`floating-nav.ts` (pure, tested; the toggle-press flag is module state with an explicit clock):
```ts
export const FLOAT_OPEN_DELAY_MS = 120;
export const FLOAT_CLOSE_DELAY_MS = 300;
export const TOGGLE_PRESS_MS = 500;
export type FloatState = { focusInside: boolean; menuOpen: boolean; dragging: boolean; modalOpen: boolean };
export function floatingStaysOpen(state: FloatState): boolean;                       // any field true
export type CloseReason = "escape" | "toggle" | "shortcut" | "pointer" | "outside" | "route" | "blur";
export function closeFocusTarget(reason: CloseReason, focusWasInside: boolean): "toggle" | "main" | "none";
// escape → toggle; toggle → toggle; shortcut → toggle if focusWasInside, else none; route → main if focusWasInside, else none; others → none
export function markTogglePress(now: number): void;                                   // TopBar toggle onPointerDown
export function clearTogglePress(): void;                                             // TopBar toggle onClick (first line)
export function isTogglePressPending(now: number): boolean;                           // marked, not cleared, and now − mark < TOGGLE_PRESS_MS
export function shouldCloseOnFocusOut(input: { focusInside: boolean; relatedInToggle: boolean; togglePending: boolean; staysOpen: boolean }): boolean; // true only if all four are false
```

`SidebarOptionsMenu.tsx`: `DropdownMenu alignment="start" hasChevron={false} menuWidth={240} renderTrigger` with `IconButton id="tessera-nav-options" label="Sidebar options" variant="ghost" size="sm" tooltip="Sidebar options" icon={<Icon icon={SidebarIcon} />}`.
- **Docked:**
  - `DropdownMenuRadioGroup label="Show" value={display}` with items `labels` "Icons and labels" and `icons` "Icons only";
  - `DropdownMenuDivider`;
  - `DropdownMenuItem label="Undock sidebar" description="Show it over the page when you need it" icon={UnpinIcon}`, which calls `setNavDock("floating")`. `refocusNav()` then lands on `#tessera-nav-toggle`, because the options button is now inside the inert closed panel.
- **Floating:** only `DropdownMenuItem label="Dock sidebar" icon={PinIcon}`, which calls `setNavDock("docked")`. `refocusNav()` lands on the remounted options button.

`TopBar.tsx`:
- Desktop and docked: `SideNavCollapseButton` as today.
- Desktop and floating: `IconButton id="tessera-nav-toggle" label={isNavOpen ? "Hide sidebar" : "Show sidebar"} variant="ghost" size="sm" tooltip="… (mod+b)" icon={<Icon icon={SidebarIcon} />} aria-expanded={isNavOpen} aria-controls="tessera-sidebar"`.
  - `onPointerDown`: `markTogglePress(performance.now())`.
  - `onClick`: `clearTogglePress()`, then `setNavOpen(!isNavOpen, { focus: isNavOpen ? "toggle" : "panel" })`.
- Mobile: unchanged (the AppShell drawer toggle).

`ShortcutsDialog.tsx`: remove `EXTRA_GLOBAL` (`:44`) and its render branch (`:65`); the registry entry (below) is now the only `mod+b` row. Fix `tests/ui/top-bar-search.test.ts` if the TopBar change breaks its render (it renders `TopBar`).

`nav.css` (lane N; all values tokens). The selectors reach the Astryx panel class `astryx-app-shell-sidenav` only through our own class (`:has(.tessera-sidebar…)`), the same rule `work-items.css` follows for `astryx-collapsible-trigger` (ui.md "Work items screen"). This is a per-instance layout rule, not a component restyle, so it stays out of `catppuccinTheme.ts`. Lane 0 records this in the ui.md P12 section.
```css
/* Decision 132 (1): the docked panel clips while its width animates, so the wider nav never shows a scrollbar. */
.astryx-app-shell-sidenav:has(.tessera-sidebar:not([data-dock])) { overflow-x: hidden; }
.astryx-app-shell-sidenav:has(.tessera-sidebar[data-dock="floating"]) {
  width: 0; min-width: 0; overflow: visible; position: relative; z-index: 300; border-inline-end: 0;
}
.tessera-sidebar[data-dock="floating"] {
  position: absolute; inset-block: var(--spacing-2); inset-inline-start: var(--spacing-2);
  width: var(--tessera-nav-float-width); height: auto;
  background-color: var(--color-background-body); border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-container); box-shadow: var(--shadow-high); overflow: hidden;
  transform: translateX(calc(-100% - var(--spacing-4))); visibility: hidden;
  transition: transform var(--duration-medium) ease-in-out, visibility 0s linear var(--duration-medium);
}
.tessera-sidebar[data-dock="floating"][data-open] {
  transform: none; visibility: visible;
  transition: transform var(--duration-medium) ease-in-out, visibility 0s;
}
.tessera-nav-edge { position: absolute; inset-block: 0; inset-inline-start: 0; width: var(--spacing-2); z-index: 1; }
@media (prefers-reduced-motion: reduce) {
  .tessera-sidebar[data-dock="floating"], .tessera-sidebar[data-dock="floating"][data-open] { transition: none; }
}
```

Shortcuts and commands (lane N):
- `shortcuts.ts`:
  - `"sidebar.toggle"` joins `ShortcutId`, and `{ id: "sidebar.toggle", label: "Show or hide the sidebar", keys: "mod+b", group: "Global" }` goes after `assistant.toggle`;
  - `CommandId` gains `SidebarCommandId`.
- `useShortcuts.ts:120`: `DELEGATED` gains `"sidebar.toggle"`.
- `command-source.ts`: `buildSidebarCommands(prefs: NavPrefs, isDrawer: boolean): CommandSearchItem[]` returns the decision 131 commands (group "Settings") minus the current state, and `[]` when `isDrawer`.
- `CommandBar.tsx`: it passes `useShell().navPrefs` and `useShell().isNavDrawer` to the builder. On select it runs `sidebarCommandPatch(id)`:
  - `display` → `setNavDisplay`;
  - `dock` → `setNavDock`;
  - `sidebar.float` additionally leaves the overlay closed.

**6.1.1 Labelled rail (only if the user answers Q1 with "B"; otherwise not built)**

This replaces decision 128's display model with Plane's reading. Everything else in §6.1 stays.
- **State.** `NavPrefs` gains `rail: "icons" | "labels"`, default `"icons"`. `tessera.nav.v1` stores `{"display","dock","rail"}`, and `parseNavPrefs` falls back per field as before. `rail` applies only while the rail is shown (`isRailCollapsed`).
- **Docked states:** the full sidebar (`display: "labels"`); the icon rail (`display: "icons", rail: "icons"`, Astryx's collapsed SideNav, 48 px); the labelled rail (`display: "icons", rail: "labels"`, 60 px = `calc(var(--spacing-12) + var(--spacing-3))`). `mod+b` and the top-bar collapse button switch between the full sidebar and the stored rail kind.
- **Menu.** The docked radio group "Show" has three items: "Full sidebar" (`full`), "Icons and labels" (`rail-labels`), "Icons only" (`rail-icons`). Power K gains `sidebar.railLabels` "Sidebar: Icons and labels", while `sidebar.labels` is relabelled "Sidebar: Full sidebar" (`sidebarCommandPatch`: `sidebar.icons` → `{ display: "icons", rail: "icons" }`, `sidebar.railLabels` → `{ display: "icons", rail: "labels" }`).
- **Rendering.** While the labelled rail is shown, `Sidebar` keeps the collapsed SideNav (same chrome, `data-rail="labels"` added by `sideNavChrome`). Instead of the `SideNavSection`s, it renders new `shell/NavRail.tsx`: a `VStack gap={1} className="tessera-rail"` of rail items. They are the same destinations as the icon rail, in the same order, projects included; favourites are not repeated. Each item is a `VStack gap={0} className="tessera-rail-item"` holding:
  - `IconButton href label tooltip={label} variant={isSelected ? "secondary" : "ghost"} size="sm" icon={…} aria-current={isSelected ? "page" : undefined}` (`IconButtonProps` extends `ButtonProps`, which has `href`, `Button.d.ts:143`);
  - `Text type="supporting" maxLines={1} aria-hidden className="tessera-rail-label"` with the label, so the button's accessible name is not read twice.
- **CSS** (`nav.css`): `.tessera-sidebar[data-rail="labels"] { width: calc(var(--spacing-12) + var(--spacing-3)); }`, and `.tessera-rail-item { align-items: center; }` plus a `text-align: center` label.
- **Motion.** Rail ↔ full sidebar animates as in decision 132 (1). Icon rail ↔ labelled rail animates the same panel width (48 ↔ 60 px).
- **Tests.** `nav-prefs.test.ts` gains the `rail` cases; `side-nav-chrome.test.ts` gains labelled-rail cases; a jsdom `tests/ui/nav-rail.test.ts` checks `aria-current`, the hidden labels and the item order.
- **Acceptance.** Steps 3–5 are run for all three states, and the `sidebar` spec checks the 60 px rail width.

**6.2 Motion surfaces**

- Sidebar: covered by 6.1 (`withWidthMotion` on `sideNavPanel()`).
- Peek (lane M): see 6.2.1.
- Layout fade (lane V1, in `WorkItemsScreen`): `useFadeOnChange(scroller, `${display.layout}|${display.calendar.layout}|${display.gantt.zoom}`)`.

6.2.1 Peek motion (lane M):
- **`peek-motion.ts` (pure):**
  - `peekOpenAnimates({ wasOpen, isOpen, isModal, modeChanged, reduced })` is true only for `!wasOpen && isOpen && !isModal && !modeChanged && !reduced`;
  - `peekCloseAnimates({ isModal, reduced })` is true for `!isModal && !reduced`;
  - `closeOutcome({ ended: "finished" | "cancel", hrefAtClose, hrefNow }): "navigate" | "stay"` is `"navigate"` only for `ended === "finished" && hrefNow === hrefAtClose`.
- **`PeekHost.tsx`:** it gets `panelRef` / `cardRef` on the LayoutPanel / Card and `wasOpen` / `prevModal` refs updated in a layout effect. A `closingRef` (`{ animation, hrefAtClose } | null`) mirrors the `isClosing` state.
- **Open:** on open, a `useLayoutEffect` measures the panel width `w` and the card width `c`, then calls `animateWidth(panel, { from: 0, to: w }, { el: card, width: c })`.
- **Close** (`close()`):
  1. if `closingRef.current` is set, return (a second Escape or Close click does nothing);
  2. if `!peekCloseAnimates(...)`, navigate at once with today's code;
  3. otherwise capture `hrefAtClose = here`, start `animateWidth(panel, { from: w, to: 0 }, { el: card, width: c })`. If that returns null, navigate at once. Else set `closingRef` and `isClosing` (the panel gets `inert` and `data-closing`, and the Escape hotkey is disabled);
  4. `animation.finished` resolves → `closeOutcome({ ended: "finished", hrefAtClose, hrefNow: currentHref(window.location.pathname, window.location.search) })`. On `"navigate"` it runs today's navigation, computing `peekHref`, `readPeekPush` and `closesWithBack(...)` at that moment (not at click time). Either way it clears `closingRef` and `isClosing`;
  5. `animation.finished` rejects (cancel) → never navigate; clear `closingRef` and `isClosing`.
- **Hide and unmount:** a `useLayoutEffect` cleanup cancels a running close or open animation. Layout-effect cleanups run both when Next hides the route (`<Activity>`) and on unmount, so a close started just before the user clicked a sidebar link can never pull them back.
- **Browser Back** closes without animation, because no handler runs.

**6.3 Virtual scrolling (lanes V1, V2)**

`src/components/virtual/` (V1):
- `virtual-config.ts`:
  - thresholds: `VIRTUAL_LIST_MIN = 250`, `VIRTUAL_TABLE_MIN = 250`, `VIRTUAL_GANTT_MIN = 250`, `VIRTUAL_BOARD_MIN = 60`;
  - overscan: `OVERSCAN = { list: 10, table: 10, gantt: 12, board: 5 }`;
  - estimates: `ESTIMATE = { list: 45, table: 41, board: 104, gantt: 32 }`;
  - `INITIAL_RECT = { width: 1024, height: 900 }`.
- `virtual-math.ts` (pure, tested). TanStack item `start`/`end` **include** `scrollMargin`, while `getTotalSize()` already **excludes** it (last `end` − `scrollMargin` + `paddingEnd`). The helpers below subtract it exactly once:
  - `shouldVirtualize(count, min)` (`count > min`);
  - `offsetWithin(anchorTop, scrollerTop, scrollTop, scrollerClientTop)` = `anchorTop − scrollerTop + scrollTop − scrollerClientTop` (the anchor's offset in the scroller's content, from two `getBoundingClientRect()` reads);
  - `withKept(base: readonly number[], keep: readonly number[], count: number): number[]`: the sorted, de-duplicated union, limited to `0 … count − 1` (the `rangeExtractor` result);
  - `partitionKept(indexes: readonly number[], first: number, last: number): { before: number[]; window: number[]; after: number[] }`: `first`/`last` are the bounds of TanStack's default range;
  - `paddings(window: readonly { start: number; end: number }[], totalSize: number, scrollMargin: number): { before: number; after: number }`: `before = window[0].start − scrollMargin`, `after = totalSize − (window.at(-1).end − scrollMargin)`, both clamped at 0. An empty window gives `{ before: 0, after: 0 }`;
  - `tableSegments(rows: readonly { index: number; start: number; end: number }[], totalSize: number, scrollMargin: number): ({ kind: "row"; index: number } | { kind: "spacer"; id: string; height: number })[]`. The input is every rendered row (window and kept) in index order. The output inserts a spacer before the first row (`virtual:top`), between rows whose indexes are not adjacent (`virtual:gap-<n>`, numbered in order) and after the last row (`virtual:bottom`). A spacer's height is the uncovered distance, and spacers under 0.5 px are left out;
  - `isOpenEnd(lastRenderedIndex: number, count: number)`: `lastRenderedIndex < count − 1`;
  - `NAV_KEYS = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]` and `isNavKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean })` (a listed key, no modifier);
  - `cssPx(n)` (`"${Math.max(0, Math.round(n))}px"`).
- `roving.ts`: `stampTabStops(root: HTMLElement, selector: string)`. It keeps the first item that has `tabindex="0"` and sets every other item to `-1`. If none has it, the first item gets `0`. This is Astryx's rule (`useListFocus.js:294-313`), applied after a virtual commit (tested under jsdom). Freshly mounted rows have no `tabindex` attribute, so a kept row that holds `"0"` keeps the stop wherever it sits in DOM order.
- `VirtualScrollerProvider.tsx`: `VirtualScrollerProvider({ scroller, children })` and `useVirtualScroller(): { scroller: HTMLElement | null; layoutVersion: number }`. The ResizeObserver watches `scroller.firstElementChild`, and changes are coalesced per animation frame.
- `use-virtual-rows.ts`: the only `@tanstack/react-virtual` import.
  ```ts
  export type UseVirtualRowsOptions = {
    count: number;
    getKey: (index: number) => string;
    estimateSize: number;
    overscan: number;
    isEnabled: boolean;
    isFixedSize?: boolean;                                         // gantt: no per-row measuring; estimateSize is exact
    keepIndexes?: readonly number[];                               // always rendered (gantt: the dragged bar's row)
    getScroller?: (anchor: HTMLElement) => HTMLElement | null;      // default: useVirtualScroller().scroller
  };
  export type VirtualRow = { index: number; key: string; start: number; size: number }; // start relative to the anchor (item.start − scrollMargin)
  export type VirtualRowProps = { "data-index": string; ref?: (el: Element | null) => void; className?: string; style?: CSSProperties };
  export type VirtualRowsResult = {
    isEnabled: boolean;                                            // false below the threshold and while printing
    anchorRef: (el: HTMLElement | null) => void;
    anchorClassName: string | undefined;                           // "tessera-virtual" when enabled
    anchorStyle: CSSProperties | undefined;                        // cssVars({ "--tessera-virtual-before": …, "--tessera-virtual-after": … })
    anchorOpenEnd: "" | undefined;                                 // for data-virtual-open-end: the last rendered row is not the last row
    before: number;
    after: number;
    totalSize: number;                                             // getTotalSize()
    keptBefore: readonly VirtualRow[];
    window: readonly VirtualRow[];                                 // all rows when disabled
    keptAfter: readonly VirtualRow[];
    rendered: readonly VirtualRow[];                               // keptBefore + window + keptAfter, in index order (the table)
    rowProps: (row: VirtualRow) => VirtualRowProps;               // data-index always; ref = guarded measureElement unless isFixedSize; kept rows add "tessera-virtual-kept" + --tessera-virtual-top
    onFocusCapture: (event: FocusEvent<HTMLElement>) => void;     // records the kept key from closest("[data-index]")
    isKept: (index: number) => boolean;                            // rendered outside the default range
    scrollToIndex: (index: number) => void;                        // align "auto"
  };
  export function useVirtualRows(options: UseVirtualRowsOptions): VirtualRowsResult;
  ```
  - `useVirtualizer` is called with `count: isEnabled ? count : 0`, `enabled: isEnabled`, `getScrollElement`, `estimateSize: () => estimateSize`, `overscan`, `getItemKey: (i) => getKey(i)`, `scrollMargin`, `gap`, `initialRect: INITIAL_RECT`, `rangeExtractor` and `measureElement` (below). Here `isEnabled` is the option and-ed with `!isPrinting`.
  - **`rangeExtractor`:** `(range) => { const base = defaultRangeExtractor(range); bounds.current = { first: base[0] ?? 0, last: base.at(-1) ?? −1 }; return withKept(base, [...keepIndexes, keptIndex].filter(isIndex), count); }`. `defaultRangeExtractor` is exported by `@tanstack/virtual-core` and re-exported by `@tanstack/react-virtual`. `getVirtualItems()` then includes the kept rows, and `partitionKept` splits them using `bounds.current`.
  - **Kept index:** `onFocusCapture` stores the focused row's key (from `closest("[data-index]")`) until focus enters another row of this anchor. Each render resolves the key to an index by checking the remembered index first, and scans `0 … count − 1` only when the key moved. When the key is gone, the hook keeps nothing.
  - **Measurement guard:** `measureElement: (el, entry, instance) => { const size = measureElement(el, entry, instance); if (size > 0 || (el as HTMLElement).offsetParent !== null) return size; return instance.measurementsCache[instance.indexFromElement(el)]?.size ?? estimateSize; }`, using virtual-core's exported default `measureElement`. It keeps cached sizes when a hidden route or a collapsed ancestor reports 0. Every rendered row, kept rows and the board placeholder included, carries `data-index`, because TanStack warns and returns −1 without it.
  - **Print:** `isPrinting` is state. `beforeprint` sets it with `flushSync`, `afterprint` clears it, and a `matchMedia("print")` change listener does the same. While printing, the hook is disabled and returns every loaded row.
  - `gap` is the anchor's computed `row-gap` in px (0 for `normal`), read when the anchor attaches.
  - `scrollMargin` and `gap` are state, set from a layout effect after every commit (which also runs when a hidden route is shown again) and on every `layoutVersion` change.
  - TanStack's `useFlushSync` stays at its default.

Token gate: every `--tessera-*` name that `nav.css` or `virtual.css` reads (`--tessera-nav-float-width`,
`--tessera-virtual-before`, `--tessera-virtual-after`, `--tessera-virtual-top`, `--tessera-virtual-spacer`) is set in
TS as a **literal quoted key** inside `cssVars({ … })` (§5.3), never through a computed key or a template name. That
way `scripts/convention-rules.ts` `definedTokens` sees it, and TypeScript accepts the custom-property key.

`virtual.css` (V1):
```css
.tessera-virtual {
  position: relative; overflow-anchor: none;
  padding-block-start: var(--tessera-virtual-before, 0);
  padding-block-end: var(--tessera-virtual-after, 0);
}
.tessera-virtual-kept { position: absolute; inset-inline: 0; top: var(--tessera-virtual-top, 0); }
/* Astryx drops the divider of the last list row (:last-child); in an open-ended window that row is not the last one. */
.tessera-virtual[data-virtual-open-end] > li:last-child { border-bottom-width: var(--border-width); }
.tessera-table-spacer, .tessera-table-spacer > td { height: var(--tessera-virtual-spacer, 0); padding: 0; border: 0; background: none; }
```

Per layout:
- **List (V1).**
  - **New `work-items/ListGroupRows.tsx`.** It exports `ListGroupRows({ items, setSize, isVirtual, isOpen, renderRow })`. When `!isOpen` it renders no rows. It calls `useVirtualRows({ count: items.length, getKey: (i) => items[i].id, estimateSize: ESTIMATE.list, overscan: OVERSCAN.list, isEnabled: isVirtual && isOpen })`.
    - It renders `<List ref={anchorRef} className={anchorClassName} style={anchorStyle} data-virtual-open-end={anchorOpenEnd} density="compact" hasDividers onFocusCapture onKeyDownCapture>`.
    - The rows of `keptBefore`, `window` and `keptAfter` come from `renderRow(item, { ...rowProps(row), "aria-setsize": setSize, "aria-posinset": row.index + 1 })`. The aria attributes are added only when virtual.
    - `setSize` (decision 137) is `Math.max(group.count, items.length)`, or `Math.max(result.total, items.length)` when flat.
    - **Kept-row keys** (`onKeyDownCapture`): when `isNavKey(event)` and the event target's row (`closest("[data-index]")`) `isKept`, it calls `scrollToIndex(index)`, `preventDefault()` and `stopPropagation()`, so `useListFocus` at the root does not move. Every other key passes through.
  - **After each commit**, `useLayoutEffect` (no deps) runs `stampTabStops(listRoot, ".tessera-wi-open")`, where `listRoot` is the closest `.tessera-wi-list`.
  - **`WorkItemRow`** gains `virtual?: VirtualRowProps & { "aria-setsize"?: number; "aria-posinset"?: number }`, spread onto `ListItem`. The classNames are merged.
  - **`ListLayout` changes:**
    - `isVirtual = shouldVirtualize(loadedRows, VIRTUAL_LIST_MIN)`, where `loadedRows` is the sum of `group.item_ids.length` (or `result.items.length` when flat);
    - `GroupSection` renders `ListGroupRows` in place of the List;
    - the root `onKeyDown` handles Home/End first when `isVirtual`, without modifiers and outside a typing target. It does `scroller.scrollTo({ top: 0 | scrollHeight })`, then `requestAnimationFrame ×2` → focus the first or last `.tessera-wi-open` in the list root. Otherwise it delegates to `handleKeyDown`.
- **Board (V2).**
  - **New `work-items/BoardVirtualCards.tsx`:** `BoardVirtualCards({ nodes, keys, isVirtual })`.
    - `nodes` and `keys` are the arrays `renderCards` builds today, including the placeholder.
    - It calls `useVirtualRows({ …, estimateSize: ESTIMATE.board, overscan: OVERSCAN.board, getScroller: (a) => a.closest(".tessera-board-column-body") })`.
    - It renders `<VStack gap={2} ref={anchorRef} className={cx("tessera-board-cards", anchorClassName)} style={anchorStyle}>`.
  - **`renderCards`:**
    - `isVirtual = lanes === null && shouldVirtualize(visible.length, VIRTUAL_BOARD_MIN)`;
    - every card element gets `virtual` props: `BoardCard` gains `virtual?: VirtualRowProps` merged into `ClickableCard` (`ref` merged with `cardRef`);
    - the pending card and the placeholder `Card` take them directly, so the placeholder carries its `data-index` too.
  - **Drags need no change here:** `use-pointer-drag.ts` uses window listeners and an overlay clone and reads rects live (`:193-207`), so a card that scrolls out of the window mid-drag does not break it. V2 does not add a kept index for board drags.
  - **The EmptyState path** is unchanged.
- **Table (V2).**
  - **New `work-items/VirtualTable.tsx`.** It renders the `Table` element that TableLayout renders today. Its props are the Table props plus `allRows: TableRow[]`, `idOf: (row: TableRow) => string` and `isVirtual`.
    - `idOf` is `groupedRows.idKey` when grouped (the only key source for the header Proxies; `row.id` reads `""` on them), else `(row) => row.id`.
    - It calls the hook with `count: allRows.length` and `getKey: (i) => idOf(allRows[i])`.
    - It builds `data` from `tableSegments(rendered.map(({ index, start, size }) => ({ index, start: start + scrollMargin, end: start + size + scrollMargin })), totalSize, scrollMargin)`. A row segment is `allRows[index]` itself, the **same object** (never spread or copied, because the grouped header Proxies carry a private Symbol). A spacer segment is `spacerRow(id, height)`. A kept row therefore stays in normal flow between split spacers, keeping its column widths; table rows never get `.tessera-virtual-kept`.
    - It adds the plugin from `table-virtual.ts`, last in the plugin order.
    - It anchors on `tbody`, found through `transformScrollWrapper`'s `ref` with `querySelector("tbody")` in a layout effect.
  - **`table-virtual.ts`** (pure plus a plugin factory):
    - `spacerRow<R extends object>(id: string, height: number): R` returns `{ id, groupKey: "", [SPACER]: height }` (a module `Symbol`) cast to `R` in this one place, with a comment that it is a synthetic row like Astryx's group headers. `TableLayout`'s `getRowKey` (`row.id`) and `isDataRow` (no `item` object → false) already handle it;
    - `spacerHeight(row: object): number | null`;
    - `dataIndexAttr(index: number): HTMLAttributes<HTMLTableRowElement>` returns `{ "data-index": String(index) }` with the one cast that `htmlProps` needs, because `HTMLAttributes` declares no `data-*` keys (`Table/types.d.ts:246`);
    - `virtualTablePlugin({ indexOf, rowProps })`:
      - `transformBodyRow`: for a spacer row it replaces `htmlProps` with `{ className: "tessera-table-spacer", "aria-hidden": true, role: "presentation", style: cssVars({ "--tessera-virtual-spacer": cssPx(h) }) }`. For a data or group-header row it adds `dataIndexAttr(i)` and `aria-rowindex = i + 1` (`i` = the row's index in `allRows`, which overrides the seeded value) and composes `ref` with the previous plugin's;
      - `transformBodyCell`: `isContentSuppressed: true` for spacer rows.
  - **`TableLayout`** computes `isVirtual = shouldVirtualize(tableRows.length, VIRTUAL_TABLE_MIN)`, where `tableRows = grouped ? groupedRows.data : rows`. It renders `<VirtualTable …>`. TableLayout does not re-render on scroll; only VirtualTable does.
- **Gantt (V2).**
  - **New `work-items/GanttRows.tsx`.** It holds the body (today line, connectors, rows), moved out of `GanttLayout.tsx:146-170`.
    - It calls `useVirtualRows({ count: items.length, getKey, estimateSize: rowHeight, isFixedSize: true, overscan: OVERSCAN.gantt, keepIndexes, isEnabled: shouldVirtualize(items.length, VIRTUAL_GANTT_MIN) })`.
    - `keepIndexes` is `[rowIndex.get(preview.id)]` while `useTimelineDrag().preview` is set, else `[]`. The bar holds pointer capture (`use-timeline-drag.ts:101`), so its row must not unmount mid-drag. A pointer press also focuses the bar, which makes it the focus-kept row from the first moment.
    - `rowHeight` is state measured (`offsetHeight`) from the first rendered `.tessera-gantt-row` after mount, on `zoom` change and on `layoutVersion` change. Before that it is `ESTIMATE.gantt`. Rows are fixed (`gantt.css:107-110`), so one measurement holds; the coarse-pointer 44 px variant is picked up by the same measurement.
    - Kept gantt rows sit absolutely at `index × rowHeight` (`.tessera-virtual-kept`).
    - It renders connectors from `pathsInRows(paths, rowIndex, first − OVERSCAN.gantt, last + OVERSCAN.gantt)`.
  - **New `pathsInRows`** (`gantt-scale.ts`) keeps a path when `min(fromRow, toRow) ≤ last && max(fromRow, toRow) ≥ first`.
  - **The SVG viewBox** keeps `rows = items.length`. The body's total height is `count × rowHeight` (padding plus rendered rows), so connector coordinates still match.
  - `GanttRows` imports `cssVars` from `@/components/shared/css-vars`; the private copy in `GanttLayout.tsx` stays for the head.
- **Drag (V1).**
  - New `drag-math.ts`: `indexForSlot(ids, rendered, slot)`:
    - `slot < rendered.length` → `ids.indexOf(rendered[slot])`;
    - empty → `ids.length`;
    - else → `ids.indexOf(rendered.at(-1)) + 1`.
  - `use-pointer-drag.ts:207` uses it. Behaviour is identical when every item is rendered.

**6.4 Calendar zoom (lane C)**

- `calendar-math.ts`:
  - `export type CalendarView = "week" | "month" | "quarter"`;
  - `quarterStart(date)` (`YYYY-01|04|07|10-01`) and `quarterEnd(date)`;
  - `shiftPeriod` moves a quarter by ±3 months and lands on the quarter start;
  - `periodLabel` for a quarter gives `Q4 2026 (Oct – Dec)`, using `formatUtc` for the month names;
  - `calendarWeeks(anchor, "quarter", …)`: start = `startOfWeek(quarterStart)`, end = `startOfWeek(quarterEnd) + 6`;
  - `isOutsidePeriod(date, anchor, view)`: week → false, month → month differs, quarter → quarter differs;
  - `dayLabel(date, view)`: quarter and day 01 → "Nov 1", else the day number;
  - `CELL_ITEM_LIMIT = { week: 8, month: 4, quarter: 2 }` and `cellItemLimit(view, isNarrow)` (0 for a narrow quarter);
  - `QUARTER_NARROW_PX = 600` and `isNarrowCalendar(width)` (`width < QUARTER_NARROW_PX`);
  - `isOutsideMonth` stays exported.
- `CalendarLayout.tsx`:
  - `view = display.calendar.layout`; the root gets `data-zoom={view}`;
  - period noun `{ week: "week", month: "month", quarter: "quarter" }`;
  - `isNarrow` is state (initially false, so server and first client render agree). It is set from a `ResizeObserver` on the root `VStack className="tessera-cal"` (`CalendarLayout.tsx:101`, `ref` per `Stack.d.ts:29`), created in a layout effect: `setNarrow(isNarrowCalendar(entry.contentRect.width))`. It measures the calendar itself, so a side peek that narrows the calendar counts, not only the viewport;
  - `DayCell` uses `isOutsidePeriod`, `dayLabel` and `cellItemLimit`;
  - with limit 0 the more-button label is `+N` and its `aria-label` is "N work items on <date>".
- `calendar.css`: `.tessera-cal[data-zoom="week"] .tessera-cal-day { min-height: calc(var(--spacing-8) * 8); }` and `.tessera-cal[data-zoom="quarter"] .tessera-cal-day { min-height: calc(var(--spacing-8) * 2); }`.
- `DisplayMenu.tsx:193-201`: label "Zoom", items `week` Week, `month` Month, `quarter` Quarter. `isCalendarView` narrows to `CalendarView`.

**Astryx props check** (all in §7):
- SideNav: `footerIcons`, `className`, `style`, `id`, `inert` through `...props`, `collapsible`, `resizable`;
- DropdownMenu: `renderTrigger`, `DropdownMenuRadioGroup label`, `DropdownMenuRadioItem`, `DropdownMenuItem description icon`;
- refs: `LayoutPanel ref`, `LayoutContent ref`, `List ref` + `style`, `ListItem ref` + rest props, `VStack ref`, `Card ref`;
- Table plugin hooks `transformBodyRow` (`ref`, `htmlProps`), `transformBodyCell` (`isContentSuppressed`), `transformScrollWrapper` (`htmlProps.ref`); `rowCount`;
- hooks: `useMediaQuery(query, serverDefault)`, `useAppShellMobile().isMobile`, `useHotkeys`;
- `IconButton href` (only under Q1 = B), `Text maxLines`.

No raw div/span: the edge strip is a `VStack`; spacers are padding on Astryx elements or Table rows.

### 7. API verification

| API | Where verified | Used by |
|---|---|---|
| `SideNav` props `footerIcons` `:56`, `className` `:72`, `style` `:77`, `resizable` `:102`, `collapsible` `:117`; `...props` to `<nav>` | `node_modules/@astryxdesign/core/dist/SideNav/SideNav.d.ts:56-137`; `SideNav.js:155-169, 324-335` | N |
| Resizable SideNav wraps the nav with the ResizeHandle (remount on collapse); not resizable → `style` used as given | `SideNav.js:223, 324-328, 406-417` | N (why the panel, not the nav, animates) |
| SideNav drawer mode renders `footerIcons`; inline mode renders them collapsed and expanded | `SideNav.js:258-290` | N (no options menu on mobile) |
| `useResizable` inside SideNav collapses below `COLLAPSE_THRESHOLD = 160`; handle only when resizable and not collapsed | `SideNav.js:46, 195-205, 223` | N (decision 128 drag path; the `sidebar` spec records whether it is reachable with `minWidth` 236) |
| Collapsed `SideNavItem` renders icon + Tooltip, no label | `SideNav/SideNavItem.js:336-430, 437` | N (decision 128 reading; §6.1.1) |
| `SideNavCollapsibleConfig { defaultIsCollapsed, isCollapsed, onCollapsedChange, hasButton }`, exported by name from `@astryxdesign/core/SideNav`; `resizable?: boolean \| ResizableConfig` (that type is not exported by name) | `SideNav/SideNavCollapseContext.d.ts:10-14`; `SideNav/index.d.ts`; `SideNav.d.ts:102` | N (`side-nav-chrome.ts`) |
| Collapsed width `var(--spacing-12)`; default 260px | `astryx.css` classes `xhgvbfk`, `x1hfn5x7` | N |
| AppShell sidenav `LayoutPanel` with theme class `astryx-app-shell-sidenav` (prefix `astryx`, `naming.js:39`), `isScrollable: isFill` (`overflow: auto`, class `xysyzu8`), children rendered directly; inline only above breakpoint; drawer below | `AppShell/AppShell.js:258-259, 323, 408-416, 522-527` | N, motion |
| AppShell breakpoint `md` = 768 px in the theme; query `(width < 768px)` | `catppuccin.js:379-386`; `AppShell.js:240, 258`; `theme/themeAdaptations.js:41-47` | lane 0 (`SIDENAV_DRAWER_QUERY`), N |
| AppShell main `id="astryx-app-shell-main"`, `tabIndex={-1}` (skip target) | `AppShell.js:63, 429-436` | N (focus after a route close) |
| `useAppShellMobile().isMobile` | `AppShell/AppShellMobileContext.d.ts:3` | N |
| Astryx CSS in `@layer astryx-base` (unlayered Tessera CSS wins) | `astryx.css:4` | N, V1 |
| `LayoutPanel ref` `:18`, signature `:107` | `Layout/LayoutPanel.d.ts` | M |
| `LayoutContent ref` `:17`; `isScrollable = true` default | `Layout/LayoutContent.d.ts:17,81`; `LayoutContent.js:132` | V1, V2 |
| `List ref` + `style` `:21,96`; `ListItem ref` + `...restProps` `:24,116`; dividers are per-item styles of width `var(--border-width)`, and the last `li` loses its divider (`.x1t1lzn6:last-child { border-bottom-width: 0 }`) | `List/List.d.ts`, `List/ListItem.d.ts`, `ListItem.js:51-57, 212`; astryx.css | V1 (`data-virtual-open-end` rule) |
| `BaseProps` types every `data-*` prop as `string \| undefined` | `BaseProps.d.ts:31-33` | V1, V2 (`"data-index": string`) |
| The key `Button` sets no `tabIndex` by default | `Button/Button.js` | V1 (`stampTabStops`) |
| `VStack`/`Stack ref` (`Ref<HTMLElement>`) | `Stack/Stack.d.ts:29,185` | V1, V2, N, C |
| `Card ref` | `Card/Card.d.ts:35` | M, V2 |
| `DropdownMenuRadioGroup` `:61`; `DropdownMenuRadioItem isDisabled/description` `:35,47,67`; `DropdownMenuItem description isDisabled` `:29-58`; `renderTrigger` | `DropdownMenu/*.d.ts`; precedent `TopBar.tsx:132-157` | N |
| `useMediaQuery(query, serverDefault)` | `hooks/useMediaQuery.d.ts:15` | N, C |
| `useHotkeys(hotkeys)` | `hooks/useHotkeys.d.ts:59` | N |
| `useListFocus` defaults `hasHomeEnd = true`, `hasPaging = false`, `hasRovingTabIndex` opt-in; queries rendered items; re-stamps tab stops after the calling component's commits only | `hooks/useListFocus.js:186-188, 210, 294-313, 514-517` | V1 (`stampTabStops`, Home/End override) |
| `ResizeHandle` sets `data-resizing` while dragging | `Resizable/ResizeHandle.js:501` | lane 0 (`isResizing`) |
| Table `BodyRowRenderProps { htmlProps, ref, afterRow }` | `Table/types.d.ts:245-256` | V2 |
| `BodyCellRenderProps.isContentSuppressed` | `Table/types.d.ts:294` | V2 |
| `ScrollWrapperRenderProps { htmlProps & ref }`; `transformScrollWrapper` | `Table/types.d.ts:299-324, 423` | V2 |
| `transformBodyRow(props, item, index)` `:409`; `transformBodyCell` `:416` | `Table/types.d.ts` | V2 |
| `rowIndexStart` `:501`, `rowCount` `:513`; `aria-rowindex` seeded into row `htmlProps` before plugins (plugins may override); `htmlProps` is `HTMLAttributes<HTMLTableRowElement>` (no `data-*` keys, hence `dataIndexAttr`) | `Table/types.d.ts:246, 501, 513`; `BaseTable.js:155-159, 281-283, 441` | V2 |
| Grouped header rows are Proxies (`""` for unknown fields, `id` included; private Symbol marker); keys only through `idKey(row)` (`__group_<key>`); the plugin passes other rows through untouched; `plugins` is a `Record` (insertion order) | `Table/plugins/groupedRows/useTableGroupedRows.js:24-55, 202-235`; `Table.d.ts:68` | V2 (`idOf`, same-object rows) |
| Table scroll wrapper is `overflow-x: auto` (not a vertical scroller) | `Table/Table.js:59-64` | V2 (scroller = `.tessera-wi-scroller`) |
| `--duration-medium` = 280 ms in the theme (`-min` 225, `-max` 350), scoped to `[data-astryx-theme="catppuccin"]`, which the root `Theme` sets on `<html>`; Astryx's defaults (310/410/550 ms) do not apply | `src/themes/catppuccin/catppuccin.css:147, 239-241`; `catppuccin.js:112-114`; `Theme/Theme.js:223`; `astryx.css:78` | lane 0, N |
| Tokens `--shadow-high`, `--radius-container`, `--border-width`, `--color-border`, `--color-background-body`, `--spacing-2/3/4/8/12` (8/12/16/32/48 px) | `astryx.css:87` and the theme | N, V1, C |
| The `cssVars(vars): CSSProperties` pattern; `definedTokens` reads a quoted `"--x":` key anywhere in a TS file | `GanttLayout.tsx:38`, `ModulesTimeline.tsx:45`; `scripts/convention-rules.ts:170-180` | lane 0 (`shared/css-vars.ts`), N, V1, V2 |
| `@tanstack/react-virtual` `useVirtualizer<TScrollElement, TItemElement>(options: PartialKeys<ReactVirtualizerOptions, 'observeElementRect' \| 'observeElementOffset' \| 'scrollToFn'>): ReactVirtualizer`; `useFlushSync?: boolean` | unpkg `@tanstack/react-virtual@3.14.13/dist/esm/index.d.ts` (read 2026-10-21) | V1 |
| `VirtualizerOptions`: `count`, `getScrollElement`, `estimateSize(index)`, `overscan`, `getItemKey`, `scrollMargin`, `gap`, `initialRect`, `indexAttribute` (default `data-index`), `enabled`, `rangeExtractor` (`:74`), `measureElement(el, entry, instance)` (`:65`). `Virtualizer`: `getVirtualItems()`, `getTotalSize()` (already minus `scrollMargin`), `measureElement(node)`, `indexFromElement(node)`, `scrollToIndex(index, { align })` (returns void), `measurementsCache`, `range`. Exported `defaultRangeExtractor` (`:36`) and default `measureElement` (`:42`; it warns and returns −1 without `data-index`). `VirtualItem { key, index, start, end, size, lane }` (`:23-30`). `@tanstack/react-virtual` re-exports all of it (`export * from '@tanstack/virtual-core'`) | unpkg `@tanstack/virtual-core@3.17.11/dist/esm/index.d.ts` (193 lines) and `@tanstack/react-virtual@3.14.13/dist/esm/index.d.ts:2` (read 2026-10-21) | V1 |
| `react-hooks/incompatible-library` flags `useVirtualizer` | `node_modules/eslint-plugin-react-hooks/cjs/eslint-plugin-react-hooks.development.js:18326, 31575-31580` | V1 |
| React `inert?: boolean` | `node_modules/@types/react/index.d.ts:2948` | N, M |
| `IconButtonProps extends ButtonProps` (`href` at `Button.d.ts:143`) | `IconButton/IconButton.d.ts:22`; `Button/Button.d.ts:143` | N (§6.1.1 only) |
| `use-timeline-drag.ts`: `setPointerCapture` on the bar; `preview { id, mode, delta }` | `src/components/dnd/use-timeline-drag.ts:15-19, 101` | V2 (`keepIndexes`) |
| `useListFocus` stamps tab stops after the calling component's commits only | `hooks/useListFocus.js:294-313` | V1 |
| `flushSync` | `node_modules/@types/react-dom/index.d.ts:61` | lane 0, V1 (print) |
| Playwright `reducedMotion`, `channel: "chromium"` = new headless | `node_modules/playwright-core/types/types.d.ts:2812, 17549-17554` | Q |
| `PushPin`, `PushPinSlash` icons | `node_modules/@phosphor-icons/react/dist/csr/PushPin*.d.ts` | lane 0 |

**Refresh before build:** lane V1's first step installs the package and confirms each TanStack row against
`node_modules/@tanstack/virtual-core/dist/esm/index.d.ts`, recording the line numbers in its report. A mismatch goes to
the reconciler before any layout work.

### 8. Lane split, leaf tasks and per-lane checks

| Lane | Starts | Owns (one owner per file) |
|---|---|---|
| **0 prep and docs** (alone) | first | `docs/PLAN.md`, `docs/PLAN-STATUS.md`, `docs/improvements.md`, `docs/contracts/ui.md`, `docs/contracts/ai.md`; `package.json` + `package-lock.json`; `src/lib/tessera/{schemas,view-settings}.ts`; `src/themes/catppuccin/icons.tsx`; `src/app/globals.css`; new `src/components/styles/{nav,virtual}.css` (header only); new `src/components/shell/{nav-prefs,layout-motion}.ts`; new `src/components/shared/css-vars.ts`; tests `tests/ui/{nav-prefs,layout-motion}.test.ts`, `tests/view-settings.test.ts`, `tests/ui/url-state.test.ts` |
| **N nav** | after 0 and after the root planner records the Q1 answer | `shell/{TesseraShell,Sidebar,SidebarSkeleton,TopBar,CommandBar,ShortcutsDialog}.tsx`, new `shell/{SidebarOptionsMenu.tsx,side-nav-chrome.ts,floating-nav.ts,use-floating-nav.ts}` (and new `shell/NavRail.tsx` only under Q1 = B), `shell/{shortcuts,useShortcuts,command-source}.ts`, `styles/nav.css`, tests `tests/ui/{floating-nav,sidebar-commands,side-nav-chrome}.test.ts` (and `tests/ui/nav-rail.test.ts` under B), edits to `tests/ui/{shortcuts,command-source,top-bar-search}.test.ts` |
| **M motion** | after 0 | `detail/PeekHost.tsx`, new `detail/peek-motion.ts`, test `tests/ui/peek-motion.test.ts` |
| **V1 virtual core and list** | after 0 | new `src/components/virtual/**`, `styles/virtual.css`, `work-items/{WorkItemsScreen,ListLayout}.tsx`, new `work-items/ListGroupRows.tsx`, `dnd/{drag-math,use-pointer-drag}.ts`, tests `tests/ui/{virtual-math,virtual-roving,list-virtual}.test.ts`, edits to `tests/ui/drag-math.test.ts` |
| **V2 virtual board, table, gantt** | after V1's task V1.1 is merged | `work-items/{BoardLayout,BoardCards,TableLayout,GanttLayout}.tsx`, `work-items/gantt-scale.ts`, new `work-items/{BoardVirtualCards,VirtualTable,GanttRows}.tsx`, new `work-items/table-virtual.ts`, tests `tests/ui/{table-virtual,board-virtual}.test.ts`, edits to `tests/ui/{gantt-scale,gantt-layout}.test.ts` |
| **C calendar** | after 0 | `work-items/{calendar-math.ts,CalendarLayout.tsx,DisplayMenu.tsx}`, `work-items/paging.ts` (the `calendarWindow` doc comment at `:56-58` only), `styles/calendar.css`, new `tests/ui/calendar-math.test.ts`, edits to `tests/ui/{paging,display-options}.test.ts` |
| **Q Playwright** | after 0 (writes specs from day 1) | `tests/e2e/{sidebar,motion,virtual-scroll,virtual-perf,calendar-zoom}.spec.ts`, `tests/e2e/fixtures.ts` (helpers `seedPerfProject`, `visibleScroller`); fixes, only where P12 breaks them, to the existing `tests/e2e/{layouts,drag,drag-surfaces,work-items,workspace,mobile,schemes,smoke}.spec.ts` (several use `navigation "Work"` and the sidebar) |

**Prompt makeup per lane** (`docs/process/swarm.md`: a worker sees the common rules, the field guide, its lane section and its ownership row). For P12, a lane's "lane section" is the following parts of this plan, pasted in this order. The worker sees nothing else:

| Lane | Parts of this plan in its prompt |
|---|---|
| 0 | "What already exists" (all); §1; §2 (all rows, to copy); §3; §4; §5; §6.1 `nav.css` lead paragraph (the ui.md note); §9; §8 "Lane 0" |
| N | "What already exists": Shell and sidebar, Motion; §2 rows 128–133; §5.1, §5.2, §5.3, §5.4; §6.1 (plus §6.1.1 only under Q1 = B); the §7 rows whose "Used by" names N; §8 "Lane N" |
| M | "What already exists": Motion (PeekHost, hidden routes); §2 rows 132–133; §5.2; §6.2.1; the §7 rows naming M; §8 "Lane M" |
| V1 | "What already exists": Lists and paging, the drag bullets, Tests and tooling; §2 rows 132 (item 5 only), 134–137; §5.2 (`useFadeOnChange`), §5.3; §6.2 (layout fade line); §6.3 (all); the §7 rows naming V1; §9; §8 "Lane V1" |
| V2 | "What already exists": Lists and paging, the drag bullets; §2 rows 135–137; §5.3; §6.3 (all; V1's merged exports are the contract and win over this text if they differ, reported as `ASSUMPTION:`); the §7 rows naming V2; §8 "Lane V2" |
| C | "What already exists": Calendar; §2 row 139; §4; §6.4; the §7 rows naming C; §8 "Lane C" |
| Q | "What already exists": Tests and tooling; §2 rows 128–139; §6 (for the ids, classes and data attributes); §8 "Lane Q"; §10; §11 |

Cross-lane contracts fixed here:
- `nav-prefs.ts` and `layout-motion.ts` (§5, lane 0);
- `ShellContextValue` (§6.1, N; M and V1 do not use it);
- `useVirtualRows`, `VirtualRowProps`, `VirtualScrollerProvider` and `virtual-config.ts` (§6.3, V1 → V2);
- `indexForSlot` (V1);
- `WorkItemRow.virtual` (V1); `BoardCard.virtual` (V2);
- `cssVars` (`shared/css-vars.ts`, lane 0 → N, V1, V2);
- DOM ids `tessera-sidebar` / `tessera-nav-toggle` / `tessera-nav-options` and the attribute `data-nav-autofocus` (N → Q);
- class names and data attributes listed in §6 (all lanes → Q).

**Merge order:** 0 alone → the root planner records the Q1 answer → N, M, V1, C in parallel → V2 → Q. M, V1 and C do
not depend on Q1 and may start right after 0. Run `npm run check` after each merge and `npm run check:e2e` after Q.

**File budget** (600):
- most files stay well under it: `ListLayout` about 500, `TableLayout` about 470, `BoardLayout` about 445, `WorkItemsScreen` about 440, `CalendarLayout` about 390, `Sidebar` about 340 (about 360 under Q1 = B), `TesseraShell` about 230, `PeekHost` about 330;
- `GanttLayout` shrinks.
- No splits are needed. **Refresh before build:** re-run `wc -l` after the other workflow lands and split verbatim any file that P12 edits and that is then within 40 lines of 600.

#### Lane 0: prep and docs (leaf tasks in order)
1. **Docs, first** (the convention gate needs the decision numbers before code cites them):
   - **a.** In `docs/PLAN.md` decisions table rows 109, 110 and 111: after the bold title insert " **Dropped 2026-10-21 (decision 127); only the workspace revision index of decision 126 was built.** Original text:", keeping the rest.
   - **b.** Add rows 127–139 from §2 after row 126.
   - **c.** Line 66 (Cache Components rules): replace the "Start uncached … only in P11" bullet with "Reads stay uncached: the `"use cache"` lane (decisions 109–111) was dropped on 2026-10-21 (decision 127)."
   - **d.** §9 P11 row: scope `"use cache"` + tags → `~~"use cache" + tags~~ (dropped, decision 127)`.
   - **e.** §9: add the row `| **P12 Shell and list polish** | 1.5 | Sidebar display preference and floating sidebar, layout motion with the reduced-motion rule, virtual scrolling for list/table/board/gantt, calendar zoom week/month/quarter | Playwright sidebar, motion, virtual-scroll and calendar-zoom specs green; decision 138 budget met on 10 000 items |`.
   - **f.** `docs/PLAN-STATUS.md`: P11 row "Cache tags: skipped" → "Cache tags: skipped, then dropped 2026-10-21 (decision 127)"; add a P12 row "planned (docs/drafts/p12-plan.md)".
   - **g.** `docs/improvements.md`:
     - move the cache-lane bullet (`improvements.md:66`) from "Waiting for the user" to "Closed" as "Cache lane dropped by the user 2026-10-21; decisions 109–111 marked dropped (decision 127). Only the `activity_workspace_seq_idx` index and its query-plan probes (decision 126) exist, and they stay";
     - in the housekeeping bullet "decisions 109–111 and 123–124 read as built", keep only 123–124;
     - in "Future features", mark the five items "scheduled as P12";
     - add the §1 deferrals.
   - **h.** `docs/contracts/ui.md`:
     - update the "Shell (lane B)" sidebar and top bar bullets (display preference, floating, options button, `tessera.nav.v1`);
     - append "## P12: sidebar modes, motion, virtual lists, calendar zoom", at most 40 lines summarising §6 with links to decisions 128–139. It must say: the motion token is `--duration-medium` (280 ms in the theme); `nav.css` reaches `astryx-app-shell-sidenav` only through `:has(.tessera-sidebar…)`, our own class, like `astryx-collapsible-trigger` under `.tessera-wi-group`, so it is a per-instance layout rule, not a theme restyle; every `--tessera-*` style key goes through `cssVars`; virtual rows carry string `data-index`; and Playwright locators for lists are scoped to the visible route.
   - **i.** `docs/contracts/ai.md:76`: the `describe_filters` payload lists `calendar: { layout: ("week" | "month" | "quarter")[], … }` (§4).
2. **Dependency:** `npm install @tanstack/react-virtual@3.14.13 --save-exact`, then `npm run check:licenses` (both packages MIT). `THIRD_PARTY_NOTICES.md` needs no row (plain dependency, not adapted code).
3. **Schema:** §4 edits and their tests.
4. **Icons:** `PinIcon` and `UnpinIcon` (§5.4).
5. **Stylesheets and helper:** empty `nav.css` and `virtual.css` with header comments, imported in `globals.css`; `src/components/shared/css-vars.ts` (§5.3).
6. **`nav-prefs.ts`** with `tests/ui/nav-prefs.test.ts`:
   - parse: null, invalid JSON, partial, wrong types, extra keys;
   - the serialize round trip;
   - `isRailCollapsed`, all four combinations;
   - under Q1 = B only: the `rail` field (default, invalid, round trip) and the two extra command patches (§6.1.1);
   - `sidebarCommandPatch` for each id and for an unknown id;
   - store: `setNavPrefs` emits once and not when unchanged, and a `storage` event for the key updates the snapshot (mock `window` in Node like `tests/ui/color-scheme.test.ts`).
7. **`layout-motion.ts`** with `tests/ui/layout-motion.test.ts`:
   - `parseDurationMs` ("280ms", "0.28s", "", "auto");
   - `layoutMotionMs` reads `--duration-medium` from `getComputedStyle(document.documentElement)` and falls back to 300 when it is empty (jsdom);
   - `widthMotionPlan` (reduced, resizing, equal widths, normal);
   - jsdom checks: `withWidthMotion` calls `change` exactly once even when `el` is null, and `animateWidth` returns null when `Element.prototype.animate` is missing.

Gate: `npm run check` green and no behaviour change in the app.

#### Lane N: sidebar modes, shortcut and commands
Decisions 128–131 and 133. Leaf tasks:
1. **`floating-nav.ts`** and its tests.
2. **`side-nav-chrome.ts`** (pure `sideNavChrome` plus `useSideNavChrome`). Make `SidebarSkeleton` use it, so the skeleton and the sidebar render the same frame.
3. **`TesseraShell` context, `isNavDrawer`, `mod+b`, `setNavDisplay` / `setNavDock` / `setNavOpen`, `refocusNav`, the breakpoint reset** (§6.1).
4. **`Sidebar` integration:** the chrome, `useFloatingNav` (`use-floating-nav.ts`), the edge strip, `footerIcons`, `data-nav-autofocus`.
5. **`SidebarOptionsMenu`** (`id="tessera-nav-options"`).
6. **`TopBar` floating toggle** with the toggle-press flag.
7. **`nav.css`** (including the docked `overflow-x: hidden` rule).
8. **Shortcut registry entry, `DELEGATED`, palette commands (hidden below `md`), `CommandBar` dispatch, and removing `EXTRA_GLOBAL` from `ShortcutsDialog.tsx`.**
9. **Only under Q1 = B:** `NavRail.tsx`, the third radio item, the extra command and the `data-rail` CSS (§6.1.1).

Keyboard paths:
- `mod+b` in both modes (also inside inputs); below `md` it does nothing;
- Tab to the top-bar toggle, then Enter/Space opens the panel with focus on "New work item" (`[data-nav-autofocus]`);
- Escape closes and returns focus to the toggle;
- Tab past the last panel control closes it (focus left);
- Tab to "Sidebar options", Enter opens the menu, arrows move and Enter picks; after "Icons only" or "Icons and labels" focus is on `#tessera-nav-options` again (`refocusNav`);
- after "Undock sidebar" focus lands on `#tessera-nav-toggle`;
- after "Dock sidebar" focus lands on the remounted options button;
- Enter on a project link in the floating panel navigates, closes the panel and puts focus on `#astryx-app-shell-main`;
- Projects "+" in the floating panel opens Create project; Escape returns focus to "+" inside the still-open panel;
- Power K "Sidebar: …".

A11y:
- the floating panel is the same `nav[aria-label="Work"]` landmark;
- `inert` while closed;
- the toggle has `aria-expanded` and `aria-controls="tessera-sidebar"`;
- the edge strip is `aria-hidden` and not focusable;
- the help dialog lists `mod+b` exactly once ("Show or hide the sidebar").

375 px:
- AppShell drawer as today;
- no options button, no edge strip, no floating rules (no `data-dock` when `isMobile`);
- `mod+b` and the `sidebar.*` commands do nothing or are hidden; the preferences stay stored and apply again at ≥ `md`;
- an overlay left open at desktop width is closed after the breakpoint flips both ways.

Both schemes: the floating surface, hairline and `--shadow-high` must read in Latte and Frappé (screenshots in the report). No new colour pairs, so no contrast-test change.

Vitest:
- `floating-nav.test.ts`: every branch of `floatingStaysOpen` (including `modalOpen`), `closeFocusTarget` (including `"route"` → `"main"`), `shouldCloseOnFocusOut`, and the toggle-press flag (`markTogglePress`, `isTogglePressPending` at 0, 499 and 500 ms, `clearTogglePress`);
- `side-nav-chrome.test.ts`: `sideNavChrome(input)` for docked/labels, docked/icons, floating closed, floating open and mobile, with a stub `onCollapsedChange` (it is called with the right display, without animation);
- `sidebar-commands.test.ts`: `buildSidebarCommands` hides the current state's command and returns `[]` when `isDrawer`; each id maps to its patch;
- `shortcuts.test.ts`: `sidebar.toggle` resolves `mod+b`, `SHORTCUTS` holds exactly one `mod+b` entry, and it is absent from the palette;
- `command-source.test.ts`: section "Settings" and the keywords;
- `top-bar-search.test.ts`: stays green (update its shell-context mock for the new `ShellContextValue` fields).

#### Lane M: peek motion
Decisions 132–133. Leaf tasks:
1. `peek-motion.ts` and its tests (every input combination of both predicates, and `closeOutcome` for finished/cancel × same/changed URL).
2. `PeekHost` refs, open animation and the guarded animated close (§6.2.1): the `closingRef` guard, navigation decided at finish, cancel never navigates, the layout-effect cleanup cancels.

Keyboard:
- Escape and the detail's close button both run `close()`;
- a second Escape or Close click during the closing animation does nothing;
- focus behaviour after close is unchanged.

A11y: the panel is `inert` while closing.

375 px: the side peek animates at this width too (decision 132); reduced motion → instant.

Both schemes: no colour change.

Vitest: `tests/ui/peek-motion.test.ts`. Do not touch `detail-smoke.test.ts`. jsdom has no `Element.animate`, so `animateWidth` returns null and close navigates at once; the existing tests must stay green.

#### Lane V1: virtual core, list, scroller, drag fix
Decisions 134–137. Leaf tasks:
1. **V1.1** `src/components/virtual/**` (§6.3: the helpers, `rangeExtractor` with kept indexes, the measurement guard, print, `data-virtual-open-end`) with tests; `virtual.css`. V2 starts when this is merged.
2. **V1.2** `VirtualScrollerProvider` in `WorkItemsScreen`:
   - `const [scroller, setScroller] = useState<HTMLElement | null>(null)` on the `LayoutContent` ref;
   - the provider wraps the five layouts and the BulkBar;
   - `useFadeOnChange(scroller, …)` (decision 132 item 5).
3. **V1.3** `ListGroupRows` (with `setSize` and the `onKeyDownCapture` kept-row rule), `WorkItemRow.virtual`, the `ListLayout` threshold and Home/End (§6.3).
4. **V1.4** `indexForSlot` in `drag-math.ts` and `use-pointer-drag.ts:207`.

Keyboard paths:
- the list arrows, Home/End, Tab and kept-row rule of decision 136 (navigation keys only; Enter, Space, Escape and Tab on a kept row act as usual);
- Enter opens;
- the group header checkbox and the Collapsible trigger stay in the tab order before their rows.

A11y: decision 137 attributes; `[data-list-ready]` stays on the list root.

375 px:
- rows wrap to two lines and are measured, so no overlap;
- overscan covers the taller rows.

Both schemes: no colour change.

Vitest:
- **`virtual-math.test.ts`:**
  - thresholds at 250/251 and 60/61;
  - `offsetWithin` with scrolled scrollers;
  - `paddings` for the first, middle and last windows with `scrollMargin` 0 and 400: `scrollMargin` is subtracted exactly once (items include it, `totalSize` does not);
  - `withKept` (duplicates, out-of-range, empty keep) and `partitionKept` before, inside and after the window;
  - `tableSegments`: top only, bottom only, both, a kept row before and after the window (split spacers), adjacent rows (no spacer), sub-pixel gaps dropped;
  - `isOpenEnd` and `isNavKey` (modifiers excluded);
  - `cssPx` rounding and clamping.
- **`virtual-roving.test.ts`** (jsdom): `stampTabStops` with none, one and two `tabindex="0"`, and with the `"0"` row placed after unstamped rows (it keeps the stop).
- **`list-virtual.test.ts`** (jsdom, `renderToString` plus a client render with a mocked scroller):
  - a flat list with 300 loaded rows of 1 500 renders `tessera-virtual` with at most `window + overscan` rows, `aria-setsize="1500"` and `data-virtual-open-end`;
  - a 200-row list renders all 200 rows with no `tessera-virtual` class (identical markup to before);
  - ArrowDown on a kept row calls `scrollToIndex` and does not move focus; Enter on it is not intercepted;
  - a `matchMedia("print")` change to matching renders every loaded row.
- **`drag-math.test.ts`:** `indexForSlot` when all are rendered (old behaviour), for a windowed middle, for past the last rendered row, and for an empty container.

#### Lane V2: board, table, gantt windows
Decisions 135–137. Leaf tasks:
1. `BoardVirtualCards` + `BoardCard.virtual` + `renderCards` threshold.
2. `table-virtual.ts`, `VirtualTable` (with `idOf` and same-object rows) and the `TableLayout` switch.
3. `GanttRows` with the measured fixed row height, the dragged row kept (`keepIndexes`), `pathsInRows`, and moving the body out of `GanttLayout`.

Keyboard paths:
- board: Tab through cards, the "…" menu → Move to; the kept focused card;
- table: Tab through the key buttons and editable cells; the sort header; a focused row scrolled far away stays in flow (no column misalignment) and comes back on the next arrow key;
- gantt: Tab to `.tessera-gantt-open`, Enter opens; `t` centres today (`useTodayScroll` unchanged); a bar drag survives a wheel scroll that moves its row out of the window.

A11y:
- table `aria-rowcount` / `aria-rowindex`; spacer rows hidden from assistive technology;
- the board column body keeps its LayoutContent role.

375 px: board columns are `100cqw` and scroll vertically inside the column; the gantt label column is `min(256px, 40vw)` (unchanged).

Both schemes: no colour change. The spacer rows must show no hover background or divider in either scheme (screenshot).

Vitest:
- **`table-virtual.test.ts`:**
  - `spacerRow`, `spacerHeight` and `dataIndexAttr`;
  - plugin output for spacer and data rows (classes, aria, `aria-rowindex` from `allRows`, `isContentSuppressed`, ref composition);
  - data assembly for windows at the top, in the middle and at the end, in grouped and flat mode, and with a kept row before or after the window. Row segments are the **same objects** as `allRows` (`toBe`), checked with a `Proxy` stand-in for a group header; keys come from `idOf`.
- **`board-virtual.test.ts`:** with the placeholder at index 0, in the middle and at the end, the keys and `nodes` stay aligned.
- **`gantt-scale.test.ts`:** `pathsInRows`. Keep a path that is inside the rows, one that crosses them in either direction and one that only touches the edge. Drop a path that is entirely outside them.
- **`gantt-layout.test.ts`:** stays green.

#### Lane C: calendar zoom
Decision 139. Leaf tasks:
1. `calendar-math.ts` additions and their tests.
2. `CalendarLayout` zoom wiring and the narrow quarter cells.
3. `calendar.css` rules.
4. The `DisplayMenu` "Zoom" control.
5. The `paging.ts:56-58` doc comment: "the whole weeks of a week, a month or a quarter".

Keyboard paths:
- `[` and `]` by the current zoom; `t` today;
- the Display menu SegmentedControl with the arrow keys;
- the "+N" button opens the popover list;
- the item move DateInput as today.

A11y:
- Previous/Next names say "quarter";
- the heading reads the quarter;
- "+N" buttons carry the full `aria-label`.

375 px: quarter cells show counts only; week and month as today. The same happens at desktop width when a side peek narrows the calendar below 600 px.

Both schemes: muted outside days and the today marker in Latte and Frappé (screenshots).

Vitest (`tests/ui/calendar-math.test.ts`):
- `quarterStart` and `quarterEnd` for each quarter and for leap February;
- `shiftPeriod` across a year boundary in both directions;
- `periodLabel` for each zoom;
- `calendarWeeks` for a quarter with `weekStartsOn` 0, 1 and 6 and with `showWeekends` false: first and last day, and row count 13 or 14 (never 15);
- `isOutsidePeriod`;
- `dayLabel`;
- `cellItemLimit` and `isNarrowCalendar` (599 / 600).

Other test edits:
- `tests/ui/paging.test.ts`: `calendarWindow` for a quarter spans the quarter's whole weeks.
- `tests/ui/display-options.test.ts`: the Zoom control offers three values.

#### Lane Q: Playwright specs
All specs import `test`/`expect` and the helpers from `tests/e2e/fixtures.ts`.

**Helpers** (added to `fixtures.ts`):
- `seedPerfProject(identifier, items)` runs `npx tsx scripts/perf-seed.ts --db <e2eDbPath()> --items <n> --projects 0 --project <identifier>` with `TESSERA_DB_PATH` deleted from the child's env (perf-seed refuses it otherwise). It returns the project id through `mcp("list_projects")`. The perf seed is idempotent per identifier.
- `visibleScroller(page)` returns `page.locator(".tessera-wi-scroller:visible")`. Next keeps left routes in the DOM, so **every** row count and row locator in P12 specs is scoped inside it, never `page.locator(".tessera-wi-row")` on the whole page. In `page.evaluate`, the scroller is `[...document.querySelectorAll(".tessera-wi-scroller")].find((el) => el.offsetParent !== null)`.

**Isolation** (decision 123): each `test.describe` block of `virtual-scroll.spec.ts` seeds its own project with `seedPerfProject(uniqueIdentifier("VL"), 1500)` in `beforeAll`: one for the list blocks, one for the board, one for table and gantt. Blocks that mutate data (board drags) use `test.describe.serial` and document their order in a comment. `virtual-perf.spec.ts` keeps the fixed identifier `VIRT`, because it only reads (Show more does not write).

**Existing specs.** Q also fixes, without changing what they test, any existing spec that P12 breaks (`layouts`, `drag`, `drag-surfaces`, `work-items`, `workspace`, `mobile`, `schemes`, `smoke`), typically by scoping row locators with `visibleScroller`.

**`sidebar.spec.ts`**
- The default is labels.
- The top-bar collapse button collapses the sidebar to icons; after a reload it is still icons (`localStorage["tessera.nav.v1"]`).
- `mod+b` toggles it.
- The options menu radio works, and after picking "Icons only" focus is on `#tessera-nav-options`.
- Dragging the resize handle 150 px to the left: the spec accepts either outcome and records it in a `testInfo.annotations` entry for the reconciler (decision 128). Either the sidebar becomes the rail and `tessera.nav.v1` says `icons`, or it stops at ≥ 236 px and stays labels.
- Undock:
  - the panel width is 0;
  - `#tessera-sidebar` is `inert`;
  - "Show sidebar" opens it, focus is on "New work item", Escape closes it and focus is on the toggle.
- With the panel open and focus inside, a click on "Hide sidebar" closes it, and 600 ms later it is still closed (`inert`).
- Hover: hovering the edge at (4, 200) opens the panel after 120 ms, and moving the pointer to the content centre closes it after about 300 ms.
- Clicking a project in the floating panel navigates and closes it. Enter on a project link puts focus on `#astryx-app-shell-main`.
- Opening the project "…" menu keeps the panel open.
- Projects "+" in the open panel opens Create project. Escape closes the dialog, the panel is still open, and focus is on the "+" button.
- Dock restores icons when icons was stored, and focus is on `#tessera-nav-options`.
- Power K runs the four commands.
- The help dialog shows exactly one "Show or hide the sidebar" row with `mod+b`, and no "Collapse the sidebar" row.
- At 375 × 812: there is no "Sidebar options" button; `mod+b` leaves `localStorage["tessera.nav.v1"]` unchanged; Power K lists no "Sidebar:" command.
- Floating panel open at 1280 px, viewport to 375 px and back to 1280 px: the panel is closed.
- With a second page in the same context, the change propagates without a reload.

**`motion.spec.ts`**
- `getComputedStyle(document.documentElement).getPropertyValue("--duration-medium")` is `280ms`.
- Right after the collapse click, `document.getAnimations().length > 0` on `.astryx-app-shell-sidenav`, and after 600 ms its width equals the rail width. About 100 ms into the collapse and into the expand, the panel's `scrollWidth <= clientWidth` (no horizontal overflow).
- With `emulateMedia({ reducedMotion: "reduce" })` the count is 0 and the final width applies in the same frame.
- Peek:
  - open WEB-1, and the panel has an animation;
  - Escape: the URL keeps `peek` until the animation finishes (≤ 600 ms), then it drops;
  - Escape twice within 50 ms: the URL drops `peek` once, and the page is still the work-items list (no second Back);
  - Escape, then click the sidebar "Inbox" link within 100 ms: 800 ms later the URL is still `/inbox`;
  - under reduced motion the URL drops at once.
- A layout switch puts an opacity animation on the visible `.tessera-wi-scroller`.
- The floating panel has a `transition` under normal motion and `transition: none` under reduced motion (`getComputedStyle`).

**`virtual-scroll.spec.ts`** (1 500 items per project; every locator inside `visibleScroller(page)`)
- Flat list:
  - 200 rows, no `.tessera-virtual`;
  - Show more gives 400 rows, `.tessera-virtual` is present and `.tessera-wi-row` count is ≤ 90;
  - scrolling to the bottom shows the footer text "Show 200 more (1100 hidden)";
  - halfway down, the last rendered row has a non-zero `border-bottom-width` (decision 135 divider rule);
  - `page.emulateMedia({ media: "print" })`: all 400 loaded rows are rendered; back to `screen`: ≤ 90 again;
  - navigate to Inbox through the sidebar and back: no two rendered rows overlap (each row's top ≥ the previous row's bottom − 1 px), and the rows at the scroll position are rendered.
- Grouped by state:
  - expand groups until more than 250 rows are loaded;
  - while scrolling, the sticky band of the group under the top edge is the one whose rows are visible;
  - collapsing the first group moves the next band up with no gap: the first `.tessera-wi-row` sits within 100 px of its band.
- Keyboard:
  - focus the first key and press ArrowDown 60 times: the focused key text equals the 61st loaded item, and it is in view;
  - End focuses the last loaded row;
  - Home focuses the first row;
  - wheel 3 000 px away, then ArrowDown: the focused row is back in view and focus did not move;
  - wheel 3 000 px away, then Enter: the peek opens for the focused row (Enter is not intercepted).
- Selection: select 3 rows, scroll away and back; they are still checked; BulkBar says 3.
- Board (`test.describe.serial`):
  - Backlog column loaded to more than 60 cards, then scrolled;
  - `dragByPointer` a card from the middle of the window to the bottom slot of another column: after reload it sits after that column's last loaded card, not at the end of its unloaded rows (decision 114).
- Table: 400 rows; `table[aria-rowcount="1500"]`; row `aria-rowindex` equals its position; spacer rows are `aria-hidden`. Focus a row's key, wheel 3 000 px away: the focused `tr` is in normal flow (`position: static`), and ArrowDown or Tab works from it.
- Gantt:
  - 400 rows; `.tessera-gantt-row` count is ≤ 90;
  - the connectors present belong to rendered rows;
  - `t` centres today;
  - press on a bar, wheel 1 500 px, move 3 day widths, release: after reload the item's start date moved by 3 days.

**`calendar-zoom.spec.ts`**
- Zoom Quarter shows the heading `Q4 2026 (Oct – Dec)` when `cal=2026-11-10`, and 13 or 14 week rows.
- `]` goes to Q1 2027.
- `t` returns to today.
- Dragging an item from Oct 5 to Nov 2 updates its target.
- "+N more" opens.
- Weekends off gives 5 columns.
- At 375 px, quarter cells have no `.tessera-cal-item`, only "+N" buttons.
- At 1280 px with a side peek open that leaves the calendar under 600 px wide, quarter cells show only "+N" buttons; closing the peek brings the item rows back.
- A saved view keeps quarter after a reload.
- `describe_filters` via `mcp()` lists `quarter`.

**`virtual-perf.spec.ts`:** decision 138, §10.

### 9. New dependencies

| Package | Version | Licence | Why | Notes |
|---|---|---|---|---|
| `@tanstack/react-virtual` | `3.14.13` exact (published 2026-09-14) | MIT | Headless row virtualisation over Tessera's own scroller (decision 134) | Peers `react` and `react-dom` ^16.8 – ^19 (both 19.3.0 installed). 60.9 kB unpacked. Newer: 3.14.14 (2026-10-09) and 3.14.21 (2026-10-16, pulls virtual-core 3.19.6), both under two weeks old on 2026-10-21. **Refresh before build:** take the newest patch that is at least 14 days old and update §7 and decision 134 if it changes. |
| `@tanstack/virtual-core` (transitive) | `3.17.11` | MIT | Engine of the above | No dependencies. |

Nothing else. Motion is WAAPI plus CSS, the floating sidebar is CSS on Astryx elements, and the calendar is
`Grid`/`Stack`.

### 10. Performance budget: how it is measured

`tests/e2e/virtual-perf.spec.ts` (decision 138):
- **When it runs.** `test.skip(!process.env.E2E_PERF, …)`, `test.use({ channel: "chromium" })` and `test.setTimeout(20 * 60_000)`.
- **Setup.** `seedPerfProject("VIRT", 10_000)` runs once in `beforeAll`.
- **Fresh document per scenario.** Each scenario starts with `page.goto(workItemsUrl(...))`, never an in-app navigation, so no hidden route copy is in the DOM. Every query still selects the visible element (`offsetParent !== null`).
- **Load all rows.** For each scroll scenario, open the work items with a `q` URL state (`{ display: { layout, group_by: null } }`; board: `{ layout: "board", group_by: "state" }`). Then click the "Show … more" button of the target (flat footer, or the first board column's footer) until it disappears, or until the column holds ≥ 1 000 cards. The last click is wrapped in the long-task observer below; it must record none.
- **First-render scenario** (decision 138, decision 115's UI budget): 20 times, `page.goto(workItemsUrl(id, { layout: "list", group_by: "labels" }))`, wait for `[data-list-ready]`, then read `performance.now()` in the page (milliseconds since navigation start). Before timing, the spec asserts that this view is virtual on its first paint (`.tessera-virtual` present, more than 250 loaded rows). If it is not, the spec fails with "fixture: grouped-by-labels view has ≤ 250 rows". p95 ≤ 300 ms.
- **Instrument the page.** Wait for `[aria-busy="true"]` to disappear, then run in the page:
  ```js
  const longTasks = []; const frames = [];
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
  po.observe({ type: "longtask" });
  const visible = (sel) => [...document.querySelectorAll(sel)].find((el) => el.offsetParent !== null);
  const scroller = visible(selector);                          // .tessera-wi-scroller, or the column's .tessera-board-column-body
  let dir = 1; const end = performance.now() + 5000;
  await new Promise((done) => { const step = (t) => { frames.push(t);
    scroller.scrollTop += 120 * dir;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) dir = -1;
    if (scroller.scrollTop <= 0) dir = 1;
    if (t < end) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
  po.disconnect();
  ```
- **Compute** the frame intervals (`frames[i] − frames[i−1]`), their median and 95th percentile, `longTasks.length`, `Math.max(...longTasks, 0)`, and the rendered row count at the end, counted inside the visible scroller (`.tessera-wi-row`, `tbody tr:not(.tessera-table-spacer)`, `.tessera-gantt-row`, or `.tessera-board-card` in the column).
- **Assert** decision 138: `longTasks.length === 0`, median ≤ 17.5, p95 ≤ 34, rows ≤ 90 (≤ 40 cards); first render p95 ≤ 300 ms.
- **Report.** Attach `virtual-perf.json` with every number per scenario through `testInfo.attach`.
- **Run it with** `E2E_PERF=1 npx playwright test virtual-perf` (on `data/e2e.db`, :3100, after `next build`). For a closer look, the same run with `--headed` and the Chrome DevTools Performance panel shows the frames; the spec is the gate.

### 11. Acceptance (on a fresh `data/p12-acceptance.db` after `next build`)

Setup:
- Never use `data/tessera.db*` or port 3000.
- If a `next dev` is running in this checkout, run the build and acceptance from a scratch copy, because other lanes edit the checkout.
- Move any `data/p12-acceptance.db*` to the scratchpad.
- Run `npm run build`.
- Start the server: `TESSERA_DB_PATH=data/p12-acceptance.db npx next start -H 127.0.0.1 -p 3300 > <scratchpad>/p12.log 2>&1 &`.
- Create project WEB with three items in the UI.
- Seed the big projects: `npm run perf:seed -- --db data/p12-acceptance.db --items 1500 --projects 0 --project VLST`, then the same with `--items 10000 --project VIRT`.

1. `npm run check` is green, with zero new lint warnings (the one `incompatible-library` line is disabled with its reason) and the licence gate passing with `@tanstack/*`.
2. `npm run check:bundle` is clean, and the build log has no new warnings.
3. The sidebar starts as Icons and labels, docked. The top-bar collapse button shrinks it to the icon rail: the content panel widens over about 0.3 s (280 ms), and no horizontal scrollbar flashes in the sidebar, neither here nor on the way back. After a reload it is still icons. (Under Q1 = B, steps 3–6 run for all three states of §6.1.1.)
4. First paint (decision 130 trade-off): with icons stored, a reload shows the labelled sidebar for about a frame, then the rail, **without** an animation. With floating stored, the docked sidebar shows for about a frame, then the panel is gone without a slide.
5. `mod+b` → labels (animated); `mod+b` → icons. A reload keeps the last choice.
6. "Sidebar options" (bottom of the sidebar) shows the "Show" radio. Both values apply, and after each pick focus is back on the "Sidebar options" button. "Undock sidebar":
   - the sidebar slides away and the panel takes the full width;
   - the top bar shows "Show sidebar", and focus is on it.
7. Rest the pointer at the left window edge below the top bar → the sidebar slides in over the content with a shadow. Move into the list → after a 300 ms pause it slides out over about 0.3 s.
8. Keyboard:
   - Tab to "Show sidebar", Enter → the panel opens with focus on "New work item";
   - Tab through it; Escape → it closes and focus is on "Show sidebar";
   - `mod+b` opens it, `mod+b` closes it;
   - open it, Tab into it, then click "Hide sidebar" with the mouse: it closes and stays closed.
9. With the floating panel open:
   - open a project's "…" menu: the panel stays open;
   - Projects "+" opens Create project; Escape closes the dialog, the panel is still open, and focus is on "+";
   - click a project: it navigates and the panel closes;
   - Tab to a project link and press Enter: it navigates, the panel closes, and the next Tab lands in the page content (focus was on the main area, not lost);
   - drag-reorder two projects inside the open panel: it stays open until the drop.
10. In the floating panel's "Sidebar options", "Dock sidebar" re-docks it with the width animation and the previous Icons/Labels choice, and focus is on "Sidebar options".
11. With two tabs: undock in tab A, and tab B follows within a second, without an animation.
12. Power K shows "Sidebar: Icons only", "Sidebar: Undock (float over the page)", "Sidebar: Dock" and "Sidebar: Icons and labels" (only the ones that change something), and each works. The help dialog (`mod+/`) lists `mod+b` once, as "Show or hide the sidebar".
13. At 375 px wide (device emulation):
    - the drawer works as before, with no options button and no edge hover;
    - `mod+b` does nothing, and Power K lists no "Sidebar:" command;
    - back at desktop width the preferences are unchanged;
    - floating: open the panel, narrow the window to 375 px and widen it again: the panel is closed.
14. Peek:
    - open WEB-1 → the side panel grows over about 0.3 s, and the detail text does not reflow during it;
    - Escape → the panel shrinks, then the URL drops `peek`;
    - Escape twice quickly → it closes once (the list stays; no extra Back);
    - open WEB-1, press Escape and at once click "Inbox" in the sidebar → Inbox stays open (the closing peek does not pull you back);
    - opening WEB-2 from WEB-1 → no animation;
    - modal mode → the Dialog animates as before.
15. Switch the layout List → Board → Table → Calendar → Gantt: each fades in. Calendar zoom and gantt zoom changes fade too.
16. Turn on reduced motion (macOS Accessibility → Reduce motion, or DevTools Rendering emulation): steps 3, 6, 7, 14 and 15 apply instantly, with no animation, and the Escape close drops `peek` at once.
17. VLST list, flat:
    - 200 rows; Show more gives 400, and the DOM holds at most about 90 rows (DevTools console: `[...document.querySelectorAll('.tessera-wi-scroller')].find((e) => e.offsetParent).querySelectorAll('.tessera-wi-row').length`);
    - halfway down, every rendered row down to the last one shows its divider;
    - scroll to the bottom: the footer reads "Show 200 more (1100 hidden)"; click it and the rows append;
    - Cmd+F for a title far below the window finds nothing, while the filter field finds it (decision 137).
18. Print preview (Cmd+P) of that 400-row list shows all 400 loaded rows. After it closes, the DOM is back to about 90 rows.
19. From the VLST list, go to Inbox through the sidebar and come back: the rows at the scroll position are drawn, with no overlap and no blank gap.
20. VLST grouped by state: load more than 250 rows across groups. While scrolling:
    - the sticky group bands hand over correctly;
    - collapsing a group leaves no blank gap;
    - "Show more" in a middle group appends in place.
21. Keyboard in the virtual list:
    - ArrowDown 60 times moves focus row by row and the list follows;
    - End goes to the last loaded row and Home to the first;
    - scroll away with the wheel, then ArrowDown: the first press brings the focused row back into view, and the next press moves;
    - scroll away again, then Enter: the focused row's peek opens (Enter is not held back).
22. Selection: check three rows, scroll away and back: they are still checked, and the BulkBar counts 3. The group checkbox picks the loaded rows of its group.
23. Board grouped by state, Backlog loaded to more than 60 cards:
    - drag a card from the middle to In Progress: the counts move by one;
    - a reload keeps the move;
    - scrolling smoothness is not judged by eye here: step 29's board scenario measures it.
24. Table, flat, 400 rows loaded:
    - the accessibility tree shows the table with row count 1500;
    - rows carry `aria-rowindex`; spacer rows are hidden;
    - header sort and the "Select all picks the loaded rows only" note work;
    - focus a row's key, scroll far away and back with the wheel: the focused row's cells still line up with the columns.
25. Gantt, 400 rows loaded:
    - rows virtualise;
    - dependency lines draw for rows in view and follow a bar drag;
    - press on a bar, scroll with the wheel while holding it, then move and release: the move commits;
    - `t` centres today;
    - the head and label column stay sticky.
26. Calendar:
    - Display → Zoom → Quarter shows "Q4 2026 (Oct – Dec)" with 13 or 14 week rows, and "Nov 1" / "Dec 1" labels;
    - `]` → Q1 2027; `t` → today;
    - drag an item across a month boundary;
    - "+N more" opens; weekends off gives 5 columns;
    - at 375 px, quarter cells show "+N" only;
    - at desktop width, open a side peek so the calendar is under 600 px wide: quarter cells show "+N" only; close the peek and the item rows return;
    - save the view, reload: still quarter;
    - `TESSERA_DB_PATH=data/p12-acceptance.db npx tsx scripts/mcp-call.ts describe_filters '{}'` lists `quarter`.
27. Repeat 7, 14, 17 and 26 in Latte and in Frappé: the floating surface, shadow and hairline read in both, and so do the spacer-free table rows and the muted calendar days.
28. `npm run perf:bench -- --db data/p12-acceptance.db --project VIRT` exits 0: decision 115's engine budgets are unchanged.
29. `E2E_PERF=1 npx playwright test virtual-perf` passes: the four scroll scenarios and the grouped first render (p95 ≤ 300 ms, decision 138). The report numbers go into the reconciler's notes.
30. `npm run test:e2e` (whole suite, new specs included) is green.
31. The console on every screen above shows only the tolerated Astryx Table warnings.

Afterwards: stop the server and leave `data/p12-*.db` for the reconciler.

### 12. Risks

| Risk | Mitigation |
|---|---|
| Astryx changes the SideNav or AppShell structure, so the panel class or the nav remount moves | The class is a documented theme target. The `motion` and `sidebar` specs assert the animation and the widths; §7 rows are re-verified on every Astryx upgrade (`astryx upgrade`). |
| `:has()` or absolute positioning inside a 0-width panel misbehaves | Chromium, Safari and Firefox support `:has()`. The panel keeps `overflow: visible` only in floating mode. The `sidebar` spec checks the panel's bounding box and that it covers content. |
| The nav remount on a display or dock change drops focus | `refocusNav()` (decision 128) re-focuses the options button or the toggle two frames later; the `sidebar` spec checks focus after the menu picks and after Dock. |
| The floating panel's close paths fight each other (toggle click, focusout, outside press, dialogs, menus) | One live-DOM `floatingStaysOpen` check, the toggle-press flag and the one-frame deferred focusout (decision 129); `floating-nav.test.ts` covers every branch, and the `sidebar` spec covers the toggle click, the "+" dialog and the "…" menu. |
| The width animation reflows the content each frame, which is heavy for a non-virtual list near 250 rows | The animation is short (280 ms), and lists above 250 rows are virtual. If it stutters in the `motion` spec trace, the reconciler records it. A redesign is out of scope. |
| The floating panel opens by accident while aiming at content | The edge is only 8 px of wash, needs 120 ms of hover intent and only reacts to hover-capable pointers. |
| `scrollMargin` drifts for many group virtualizers, leaving blank gaps | Re-measured after every commit and on every `layoutVersion` bump (ResizeObserver). `overflow-anchor: none`. The `virtual-scroll` spec checks band and row adjacency after a collapse. |
| A focused row is unmounted by scrolling and focus drops to `<body>` | The kept-row rule through `rangeExtractor` (decision 135) and the navigation-key rule (decision 136); the spec covers it. |
| A kept row in the table loses its column widths | Table kept rows stay in normal flow between split spacers (`tableSegments`); the spec checks `position: static` and the manual step checks alignment. |
| A gantt bar drag loses pointer capture when its row leaves the window | The dragged row is in `keepIndexes`, and the pressed bar is also the focus-kept row (decision 135); a spec step drags across a wheel scroll. |
| TanStack's flush-sync scroll updates log a React warning in dev ("flushSync was called from inside a lifecycle method") | If seen, V1 sets `useFlushSync: false` in the hook (the only allowed change). The overscan keeps blank rows out of the perf spec. |
| Hidden `<Activity>` routes: a measurement of 0 px, or a stale window, when the route shows again | Layout-effect cleanups run at hide time and TanStack re-attaches on show. The measurement guard keeps cached sizes for elements without an `offsetParent`, and `scrollMargin` is re-measured in a layout effect on reveal. The spec navigates away and back and checks that rows do not overlap. |
| A closing peek navigates after the user has already left the route | The close is cancelled in a layout-effect cleanup (hide or unmount), a cancel never navigates, and a finish navigates only if the URL is unchanged (decision 132); spec and acceptance step 14 cover it. |
| Playwright hits hidden route copies | All P12 locators go through `visibleScroller`, the perf spec uses a fresh document per scenario, and DevTools commands select the visible scroller. |
| Find-in-page no longer finds off-screen rows | Decision 137: thresholds, filter field, Power K. Recorded in ui.md. |
| Headless frame timing is noisy and the perf spec flakes | `channel: "chromium"` (full new headless), no other load, medians and p95, and zero long tasks as the hard gate. A flaky run is re-run once before it counts as failed. |
| A virtual first render costs more than today's full render, or less than the threshold suggests | Decision 138's first-render scenario holds decision 115's 300 ms p95, and step 28 re-runs the engine bench. |
| Quarter view hits the 1 000-item cap more often | The existing Banner explains it; filters narrow it (decision 112). |
| The peek close delays navigation by 280 ms | It is skipped under reduced motion, and a second close is ignored. Browser Back stays instant. |
| The user meant Plane's labelled rail (Q1) | §6.1.1 specifies it, so the answer only switches lane N's task 9 and lane 0's `rail` field on, with no replan. |
| Another workflow is editing many of these files now | The "Refresh before build" list below. Lanes re-read every owned file before the first edit (field guide: the Edit tool refuses stale reads). |

### 13. Open questions

**Q1 (for the user, asked by the root planner before lane N starts).** For the "icon only vs icon with label" preference
(user item 2), which do you mean?
- **A (this contract's default, decision 128):** "Icons only" is today's collapsed rail and "Icons and labels" is the full sidebar. The choice is remembered, and nothing else changes.
- **B (Plane's model, §6.1.1):** besides the full sidebar there are two narrow rails, one with icons only (48 px) and one with a small label under each icon (60 px). The choice is remembered.

**Answered 2026-10-21 by the user: B (Plane's three modes).** Full sidebar, a 48 px icons-only rail and a 60 px rail with a small label under each icon; the choice is remembered. Before lane 0 writes the decisions, merge §6.1.1 into decision 128 (refresh checklist below).

Lanes 0, M, V1, V2, C and Q do not depend on the answer. Lane N starts after it (§8). Every other choice in this
contract is made. The defaults the user may want to revisit later:
- the thresholds (250 rows, 60 cards);
- the floating hover edge (8 px, 120 ms);
- week cells with 8 items.

All three are constants in `virtual-config.ts`, `floating-nav.ts` and `calendar-math.ts`.

### Refresh before build (checklist for the contract planner)

- **The other workflow's edits.** Wait for it to land, then re-read and re-cite the lines of:
  - shell: `TopBar.tsx`, `PanelHeader.tsx`, `shell.css`, `command-source.ts` (and its test), `shortcuts.test.ts`;
  - work items: `ListLayout.tsx`, `BoardLayout.tsx`, `TableLayout.tsx`, `GanttLayout.tsx` (334 lines now; the body is at `:146-170`), `CalendarLayout.tsx`, `WorkItemsScreen.tsx`, `gantt-scale.ts`, the new `gantt-scroll.ts`, `paging.ts`, `types.ts`, `BulkBar.tsx`, `FilterBar.tsx`, `ProjectFrame.tsx`, the new `NoResults.tsx` and `clear-filters.ts`;
  - drag: `dnd/{drag-math,use-pointer-drag}.ts` (line 207 may move);
  - styles: `calendar.css`, `board.css`, `table.css`, `gantt.css`, `work-items.css`, `detail.css`;
  - tests: `drag-math`, `gantt-layout`, `gantt-scale`, `gantt-scroll`, `paging`, `command-source`, `shortcuts`, `top-bar-search` and `shell-detail-css` under `tests/ui/`;
  - e2e: `playwright.config.ts`, the new `tests/e2e/fixtures.ts` and `tests/e2e/prepare-db.ts` (`helpers.ts` was deleted), and the 12 new specs (`layouts`, `drag`, `drag-surfaces`, `work-items`, `workspace`, `mobile`, `schemes`, `assistant`, `collaboration`, `detail-editor`, `external-writes`, `intake-drafts-bulk`, `pages`, `views-settings`), so that lane Q's helper names and its "existing specs" list match;
  - `docs/PLAN.md` (the last decision may no longer be 126; renumber §2 if it moved) and `docs/contracts/ui.md`.
- **File budget.** `wc -l` on every file in §8 and `scripts/file-budget.json`; split verbatim any file within 40 lines of 600 before lanes start.
- **npm.** The newest `@tanstack/react-virtual` patch at least 14 days old and its `virtual-core` version (§9); re-read their `.d.ts` (§7).
- **Estimates.** Measure the real list, table, board card and gantt row heights at 1280 px in both schemes and update `ESTIMATE` in `virtual-config.ts`.
- **Playwright.** Confirm that 1.63.0's `channel: "chromium"` launches the installed full Chromium build (not only the headless shell) on this machine; otherwise use `headless: false` for the perf spec only.
- **Perf seed.** Time `perf:seed --items 10000 --projects 0`; if it exceeds 10 minutes, raise the spec timeout. Each `virtual-scroll` describe block seeds 1 500 items; time that too.
- **Q1.** Record the user's answer in this file's §13 and, under B, merge §6.1.1 into decision 128 before lane 0 writes the decisions into `docs/PLAN.md`.

### Review log (2026-10-21)

Two reviews of the first draft: an API review (7 points) and a consistency review (30 points: H1–H3, M1–M15, L1–L12).
Each point was checked against the code. Accepted points are folded into the sections named; rejected or partly
rejected points carry a one-line reason.

**API review**
- 1 `--duration-medium-min` is 225 ms in the theme: **accepted**. P12 uses `--duration-medium` (280 ms, `catppuccin.css:240`), the closest to 300 ms (decision 132, §5.2, `nav.css`, §7, §12, `motion` spec).
- 2 `data-index` must be a string: **accepted** (`BaseProps.d.ts:33`). `VirtualRowProps["data-index"]: string`; the table uses `dataIndexAttr` with its one cast (§6.3).
- 3 custom-property keys need `cssVars`: **accepted**. A shared `src/components/shared/css-vars.ts` is added (lane 0, §5.3), and the token-gate paragraph is updated.
- 4 grouped header rows are Proxies: **accepted**. `VirtualTable` gets `idOf = groupedRows.idKey` and passes the same row objects (§6.3, V2 tests).
- 5 `:last-child` drops the last divider: **accepted**. `data-virtual-open-end` plus a `virtual.css` rule (decision 135, §6.3).
- 6 gantt row height is only a minimum: **rejected**. `gantt.css:107-110` sets both `min-height` and `height` to `--tessera-gantt-row`, so rows are fixed. The coarse-pointer 44 px variant (`gantt.css:22-26`) is now named, and the single measurement picks it up.
- 7 citation fixes (`rowIndexStart :501`, `rowCount :513`, PeekHost `:235-240`, `react-dom` peer): **accepted** (§7, §9, "What already exists").

**Consistency review**
- H1 decision 128 vs Plane's labelled rail: **accepted** as Q1 (§13), with §6.1.1 specifying reading B; decision 128 states its reading and reason, and §1 defers the labelled rail.
- H2 the peek close can navigate after leaving: **accepted**. `closingRef` guard, cancel never navigates, URL check at finish, `closesWithBack` at finish, cleanup cancels, null animation navigates at once, acceptance step 14 and the `motion` spec (decision 132, §6.2.1).
- H3 `mod+b` is already in the help dialog: **accepted**. `ShortcutsDialog.tsx` goes to lane N, which removes `EXTRA_GLOBAL`; `shortcuts.test.ts` checks a single entry ("What already exists", decision 131, §8).
- M1 horizontal scrollbar during the width animation: **accepted**. The docked panel gets `overflow-x: hidden` in `nav.css` (`overflow-x: clip` would compute to hidden beside `overflow-y: auto` anyway), and the `motion` spec checks `scrollWidth`.
- M2 focus lost on nav remount: **accepted**. `#tessera-nav-options` plus `refocusNav()` (decision 128, §6.1).
- M3 the first focus target is the "Work" heading link: **accepted**. `[data-nav-autofocus]` → `aria-current` → first control (decision 129).
- M4 the toggle click re-opens the panel: **accepted**. Toggle-press flag and `relatedTarget` check (decision 129, `floating-nav.ts`).
- M5 dialogs opened from the panel lose their focus return: **accepted**. `modalOpen` keeps the panel open (decision 129).
- M6 "below md nothing animates" had no implementation: **accepted** by dropping the clause (the sidebar has no panel below `md`, while the peek and the fade animate at every width). Below `md`, `mod+b` is a no-op, the commands are hidden and the open state resets on a breakpoint flip.
- M7 0 px measurements on hidden routes: **accepted**. The measurement guard plus the layout-effect re-measure (decision 135).
- M8 Playwright hits hidden routes: **accepted**. `visibleScroller`, a fresh document per perf scenario, and the visible-scroller DevTools command.
- M9 the kept-row rule blocked every key: **accepted**. Navigation keys only (decision 136).
- M10 absolutely positioned kept `<tr>`: **accepted**. `rangeExtractor` plus in-flow split spacers (`tableSegments`).
- M11 gantt drag capture lost when its row leaves the window: **accepted**. `keepIndexes` for the dragged row; board drags explicitly left alone.
- M12 decision 127 said nothing was built: **accepted**. The P11 index and probes are named and kept.
- M13 ownership gaps: **accepted**. `ShortcutsDialog.tsx` and `top-bar-search.test.ts` → N, `ai.md` → 0, the `paging.ts` comment → C, and existing e2e fixes → Q.
- M14 incomplete refresh list: **accepted** (extended).
- M15 lane prompts not self-contained: **accepted**. "Prompt makeup per lane" table in §8.
- L1 print shows the window: **accepted**. Windowing is off while printing; `content-visibility` is recorded as rejected in decision 134.
- L2 the kept row loses its roving tab stop after the window: **rejected**. `stampTabStops` keeps whichever item holds `tabindex="0"`, and freshly mounted key buttons carry no `tabindex` (Astryx `Button` sets none), so the kept row stays the only `"0"`. A jsdom case now pins this.
- L3 `aria-setsize` vs the badge: **accepted**. `max(group.count, loaded)` (decision 137).
- L4 quarter rows are 13–14: **accepted** (decision 139, tests, specs, acceptance).
- L5 narrow quarter cells keyed on the viewport: **accepted**. The calendar root is measured with a ResizeObserver (decision 139, §6.4).
- L6 the unreachable manual drag step: **accepted**. Dropped; the Vitest case and the decision 114 spec drag remain.
- L7 subjective or missing steps: **accepted**. Steps 4, 7, 18, 19, 23, 28 and 29 were rewritten or added.
- L8 spec isolation: **accepted**. Per-describe `uniqueIdentifier("VL")` projects; `VIRT` stays fixed because the perf spec only reads.
- L9 `sideNavChrome` and `spacerRow` signatures: **accepted** (§6.1, §6.3).
- L10 assistant and planning panels do not animate: **accepted** as a §1 deferral.
- L11 focus after a route close: **accepted**. `#astryx-app-shell-main` (decision 129).
- L12 `nav.css` selecting an Astryx class: **accepted**. Explained in §6.1 and required in the ui.md P12 section (lane 0 task 1h).
