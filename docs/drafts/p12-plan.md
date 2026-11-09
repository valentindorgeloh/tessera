## P12: Sidebar modes, layout motion, virtual lists, calendar zoom (phase contract)

Draft by the phase planner on 2026-10-21 against `e04b840`. **Refreshed on 2026-10-29 against `afe589c`** (branch
`claude/p6-p11-and-fix-rounds`) by three contract planners (shell; virtual; calendar, tests and docs) and one
integrator, who resolved their conflicts. This is a full contract: every design question is decided here, and no
worker makes a design decision. Every `file:line` is at `afe589c` unless it says otherwise.

What the refresh changed, and why:
- **The user answered Q1 with B** (2026-10-21): three docked sidebar views, Full, Icons and labels (a 60 px rail with
  the name under each icon) and Icons only (48 px); the choice is remembered. The old §6.1.1 is merged into decision
  128 and §6.1 and removed. The labelled rail is CSS on Astryx's collapsed rail, not a second component tree.
- **Fix rounds 3 to 6, the visual rework and two performance rounds landed.** Every citation was re-read. Round 6's
  streamed-subtree rule (`docs/contracts/ui.md:93`, field guide `index.md:25`) now governs the nav preferences:
  module stores read with `useSyncExternalStore` in each consumer. Decision 142 made the peek detail a lazy chunk,
  so the peek no longer animates its width; its card slides.
- **The perf data changed the virtual design** (`docs/drafts/perf-report-2026-10-28.md` §1, §5, §6, §9; data in
  `docs/drafts/perf-2026-10-28/`; `docs/drafts/perf-roadmap-2026-10-24.md` "With P12" and §7). Decision 115 asks for
  p95 ≤ 300 ms to `[data-list-ready]` on 10 000 items. At `afe589c` the list p95 is 902/915 ms and the table
  1,653/1,643 ms at `perf.spec.ts`'s grouped page (5 × 50 = 250 rows, `perf.spec.ts:39-43`; `docs/improvements.md:20`);
  the flat 200-row page is 754 / 1,265 ms (perf-report-2026-10-28.md §1 sweep). 300 ms holds only about 58–60 list rows
  and 34–35 table rows, the per-row cost is mostly closed Astryx layers, and the old threshold (windowing above 250
  rows) would never window the default page. So windowing now starts above 30 rows, the server renders a small
  first window, and windowed rows are memoised with per-row props (extends decision 141). A row-cap probe met
  300 ms for list, board and table (decision 138).
- **Housekeeping.** Decisions 127–139 keep their numbers and go between rows 126 and 140 of `docs/PLAN.md`
  (140–142 already exist, `docs/PLAN.md:210-212`). `schemas.ts` is 594 lines, so lane 0 splits it first. The
  calendar schema edit moves to lane C. The perf gates reuse decision 115's harness (`playwright.perf.config.ts`,
  `data/p11-perf.db`). `@tanstack/react-virtual` is not installed: the user approves the download (§13 Q2), and
  V1.1 re-checks its typings after the install ("Still open before build" at the end).

Scope comes from the user's decisions of 2026-10-21:
- the cache lane (decisions 109–111) is **dropped**;
- five Plane extras are built as P12:
  1. dock/undock (floating) sidebar;
  2. a persisted sidebar view: Full, Icons and labels, or Icons only (Q1 = B), built on the existing collapse rail;
  3. smooth layout transitions (about 300 ms, ease-in-out) that honour `prefers-reduced-motion`;
  4. virtual scrolling for very long lists, boards, tables and gantt rows, working with paging (decisions 112–114);
  5. calendar zoom levels Week / Month / Quarter, consistent with the gantt zoom (decision 90).

Plane (AGPL-3.0) is used only as a behaviour reference: `docs/plane-comparison.md` §4 (the left sidebar) and
the rows on transitions and virtual scrolling. No Plane code, identifiers or strings are copied. The Plane
display-mode and menu names are deliberately not reused; Tessera says "Full sidebar", "Icons only", "Icons and
labels", "Undock sidebar" and "Dock sidebar".

**Sources**
- docs/improvements.md "Planned for P12" (`improvements.md:54-59`, the five items) and "Dropped by the user" (`improvements.md:221-222`, the cache lane).
- docs/PLAN.md:
  - decisions 109–111 (lines 192–194), 112–115, 126 (line 209) and 140–142 (lines 210–212; numbers kept, P12 does not renumber them);
  - §9 phases (line 447, P11 row line 463);
  - the verified-versions table (lines 45–61; Recharts row line 59);
  - Cache Components rules (line 66).
- docs/drafts/p10-plan.md and p11-plan.md (format; P11 §8 "No virtual-list … library" is superseded here).
- docs/drafts/perf-report-2026-10-28.md (§1 "What this means for P12's thresholds", §5, §6, §9) and docs/drafts/perf-roadmap-2026-10-24.md ("With P12" table, §7).
- docs/contracts/ui.md "Shell (lane B)" (line 88) and "Theme" (line 114); docs/contracts/ai.md (line 76); docs/contracts/schema.md (line 102, the Display shape).
- docs/process/swarm.md: roles and models (lines 12–25), "The spec is the unit of work" (lines 27–31: a worker sees the common rules, the field guide, its lane section and its ownership row), file budget and split tasks (lines 44–48), verification per phase (lines 57–69), live update after each green merge (line 71, decision 140).
- docs/process/live.md (the live app on port 3000; only the reconciler runs `npm run live:update`).
- docs/field-guide/index.md and docs/field-guide/performance.md.
- docs/as-built/README.md and the area files P12 changes: shell-detail.md, work-items.md, operations.md, hardening.md (lane 0 close-out, §8).
- Astryx 0.6.8 `.d.ts` and `.js` under `node_modules/@astryxdesign/core/dist` (§7).
- TanStack Virtual: npm metadata for `@tanstack/react-virtual@3.14.19` and `@tanstack/virtual-core@3.19.4` (read 2026-10-29 with `npm view`; §9). The typings were last read on 2026-10-21 for 3.14.13 / 3.17.11 (`https://unpkg.com/@tanstack/virtual-core@3.17.11/dist/esm/index.d.ts`); they are re-read from `node_modules` after the install (V1.1, §7).

**What already exists** (verified at `afe589c`, 2026-10-29)

Shell and sidebar
- `src/components/shell/TesseraShell.tsx` (104 lines):
  - `ShellContextValue` (`:16-25`) has `isNavCollapsed`, `setNavCollapsed`, `openCommandBar`, `openShortcuts` and `openCreateProject`. The context value itself is `ShellContextActions` (`:28`): stable callbacks only, built once (`:87-90`).
  - `useShell()` (`:41-46`) reads the collapse flag in the calling component from `nav-collapse-store.ts` and merges it with the actions.
  - `mod+b` is a `useHotkeys` entry with `onPress: toggleNavCollapsed` and `allowInInputs` (`:74-80`).
  - `ShellFrame` (`:49-58`) renders `<AppShell height="fill" variant="wash" contentPadding={2} topNav={<TopBar/>} sideNav={sideNav}>` (`:52`) around the `tessera-panel` Card. The assistant panel is the content Layout's `end` slot (`:54`).
- `src/components/shell/nav-collapse-store.ts` (55 lines, fix round 6): module state behind `useSyncExternalStore` (`:53-55`). The server snapshot is always false (`:37-39`), and `setNavCollapsed` notifies only on a change (`:42-46`). It is **not persisted**: a reload starts expanded.
- **Streamed-subtree rule** (`docs/contracts/ui.md:93`, field guide `index.md:25`): the sidebar streams in behind a Suspense boundary and hydrates after the top bar and `mod+b` are live. State that can change before it hydrates is read in each consumer through `useSyncExternalStore` with a server snapshot, never through a context value provided from outside the boundary, or React 19.3 throws error 418. A context provided inside the boundary (Astryx's `SideNavCollapseContext`) is safe. Guards: `tests/ui/nav-collapse-store.test.ts`, `tests/ui/shell-collapse-wiring.test.ts`, `tests/e2e/round6.spec.ts`.
- `src/components/shell/Sidebar.tsx` (275 lines):
  - `SIDEBAR_WIDTH = { defaultWidth: 250, minWidth: 236, maxWidth: 350 }` and `SIDEBAR_WIDTH_STORAGE_KEY = "tessera.sidebarWidth.v1"` (`:26-27`).
  - A prefs store (last project, width) is read after mount (`:44-117`). `useSidebarResize()` (`:124-133`) returns a `key` and the `resizable` config.
  - The SideNav is at `:196-203`: `key={resize.key}`, `aria-label="Work"`, `collapsible={{ isCollapsed: isNavCollapsed, onCollapsedChange: setNavCollapsed, hasButton: false }}` (`:199`), `resizable={resize.resizable}` (`:200`), `header` (`:201`) and `topContent={<NewItemButton …/>}` (`:202`). There are no `footerIcons`, no `id` and no `className`.
  - Every destination is a `RailItem` (`:205-271`). The Projects "+" is wrapped in `ExpandedOnly` (`:228-230`).
- `src/components/shell/RailParts.tsx` (99 lines). The parts read Astryx's collapse context (`useSideNavCollapse`), so they render expanded in the mobile drawer, which has no collapse context:
  - `NewItemButton` (`:28-45`) is an `IconButton` in the rail (`:31`) and the full `Button` otherwise;
  - `ExpandedOnly` (`:53-56`) renders nothing in the rail;
  - `RailItem` (`:67-76`) wraps a collapsed `SideNavItem` in `Tooltip placement="end" focusTrigger="always"` (`:72`), because Astryx's own sibling tooltip never attaches in 0.6.8; **since the Astryx 0.7.11 upgrade (2026-11-09) `RailItem` renders the bare `SideNavItem`: Astryx 0.7.5+ names the collapsed link itself, so P12's "RailItem unchanged / keeps its tooltip" lines below mean the built-in tooltip;**
  - `RowActions` (`:88-98`).
- `src/components/shell/FavoritesSection.tsx`: favourites are `RailItem`s (`:228`); a folder is a plain `SideNavItem` with children (`:134`), which shows a flyout in the rail.
- `src/components/shell/SidebarSkeleton.tsx` (24 lines) renders the same SideNav frame (`:16`) from `useShell().isNavCollapsed` (`:13`) and `useSidebarResize()`.
- `src/components/shell/TopBar.tsx` (194 lines; not inside the streamed boundary):
  - `SideNavCollapseButton size="sm" collapsible={{ isCollapsed, onCollapsedChange }}` on desktop only (`:180`; `useAppShellMobile().isMobile` at `:173`). Its names are Astryx's "Collapse sidebar" / "Expand sidebar" (relied on by `tests/e2e/round5.spec.ts:185-210` and `round6.spec.ts:195-201`).
  - `AccountMenu` (`:129-162`) is the DropdownMenu precedent: `renderTrigger` (`:136-145`) and `DropdownMenuRadioGroup` (`:147-157`).
- `src/app/(tessera)/layout.tsx:31-36` passes `sideNav={<Suspense fallback={<SidebarSkeleton/>}><SidebarData/></Suspense>}` (`:33-35`). The comment at `:20-28` keeps the shell in the static prerender.
- Astryx SideNav (0.6.8):
  - the collapsed width is `var(--spacing-12)` (class `xhgvbfk`, `astryx.css:1974`); the default width is 260 px (`x1hfn5x7`, `:1946`);
  - when `resizable` is set and the nav is not collapsed, the `<nav>` sits in a wrapper div with the ResizeHandle (`SideNav.js:406-427`), so **Full ↔ rail remounts the nav**; a change that keeps it collapsed does not;
  - with `resizable` set, the nav's inline `width` is the hook's size, or unset while collapsed, written after `style` is spread (`SideNav.js:325-328`): `style.width` cannot size a collapsed resizable nav, a class can;
  - `className`, `style` and then `...props` go onto the `<nav>` (`SideNav.js:329-335`), so `id`, `inert` and `data-*` reach it;
  - Tessera has a TopNav, so below `md` AppShell renders `sideNav` in **`drawer-content`** mode inside the TopNav's drawer (`AppShell.js:366-372, 527-533`). SideNav then renders only `topContent`, the children and `footerIcons`: no `<nav>`, no props, no collapse context (`SideNav.js:295-312`). `useSideNavRenderMode()` returns that mode (`SideNav/index.d.ts:21`; modes in `SideNavRenderContext.d.ts:1`); it is `"default"` in the inline panel;
  - during a resize drag, `useResizable` collapses when the raw width (start width plus delta, before the `minWidth` clamp) drops below `COLLAPSE_THRESHOLD = 160` (`SideNav.js:46, 195-206`; `Resizable/useResizable.js:629-637`). With Tessera's 236 px minimum, a drag of about 90 px to the left from 250 px collapses the nav and calls `onCollapsedChange(true)`;
  - a collapsed `SideNavItem` without children renders an icon-only link with `...rest` spread on it (`SideNavItem.js:405-420`) and a sibling Tooltip (`:422-430`); with children it renders a `<button>` with `...rest` (`:368-379`). The label `<span>` exists only when expanded (`:437`). A `data-*` prop therefore lands on the collapsed `<a>` or `<button>`. Both carry the theme class `astryx-side-nav-item` (`:357`); sections carry `astryx-side-nav-section` (`SideNavSection.js:108`).
- Astryx AppShell:
  - the inline sidebar is a `LayoutPanel` with theme class `astryx-app-shell-sidenav` and `isScrollable: isFill` (`AppShell.js:408-417`; computed `overflow: auto`, measured). `LayoutPanel` spreads `...props` onto its div (`Layout/LayoutPanel.js:176`);
  - the panel exists only at or above the breakpoint (`AppShell.js:325`, `showSideNavInline`; query `:240, 258-259`). `md` is **768 px** in the theme (`src/themes/catppuccin/catppuccin.js:394-400`, `catppuccinTheme.ts:188`);
  - the main area is `LayoutContent role="main" id="astryx-app-shell-main" tabIndex={-1}` (`AppShell.js:63, 429-439`), the skip-link target.
- Astryx CSS is inside `@layer astryx-base` (`astryx.css:4`), so Tessera's unlayered CSS wins whatever the specificity. Inline styles and running animations still win over it.
- Precedents for a stored preference: `src/components/shell/color-scheme.ts:26-72` (lazy read in `getSnapshot`, a `storage` listener while subscribed, the default as server snapshot) and `src/components/detail/peek-prefs.ts` (read after mount).
- Shortcuts and commands:
  - `shortcuts.ts`: `ShortcutId` (`:34-72`), `CommandId` (`:75`), `SHORTCUTS` (`:96`; the `assistant.toggle` row is `:100`), `SHELL_COMMAND_IDS` (`:147-158`), `ALLOWED_WHILE_TYPING` (`:268`). `mod+b` is **not** in the registry.
  - The help dialog lists it through a hand-written row: `ShortcutsDialog.tsx:44` `EXTRA_GLOBAL = [{ label: "Collapse the sidebar", keys: "mod+b" }]`, rendered at `:64-66`.
  - `useShortcuts.ts:120` has `DELEGATED`; the keydown path returns early for it (`:352`).
  - `command-source.ts` (548 lines): theme commands (`:167-188`), `themeCommandScheme` (`:313-317`), `paletteSection` (`:147-160`; the Global group is not in the palette), `buildCommands` (`:342-377`). It is 52 lines under the file budget, so new builders go in a new file.
  - `CommandBar.tsx`: the command getter (`:222-232`), the theme branch of `onSelect` (`:351-355`), shortcut ids run after the palette closed (`:358`), `commandIcon` (`:406-415`).
- Measured at HEAD (production build, 1280 × 800, both schemes; measured in the 2026-10-29 refresh): top bar 48 px; Full sidebar 250 px with 32 px rows at a 34 px pitch; Icons only rail 48 px with 32 × 32 rows 8 px from each edge.

Motion
- What animates today: transitions in `board.css:182, 226`, `home.css:42` and `collaboration.css:42`; keyframe animations in `lock-control.css:32-44`. `lock-control.css:58-65` is the in-repo `prefers-reduced-motion` precedent.
- Astryx tokens:
  - durations: the Catppuccin theme sets `--duration-medium-min: 225ms`, `--duration-medium: 280ms`, `--duration-medium-max: 350ms` (`src/themes/catppuccin/catppuccin.css:239-241`, generator `catppuccin.js:112-114`) inside `@scope ([data-astryx-theme="catppuccin"])` (`catppuccin.css:146`); Astryx's root `Theme` sets that attribute on `<html>` (`theme/Theme.js:222`). Astryx's own defaults (`astryx.css:78`, 410 ms medium) never apply;
  - **the production build serves the token as `.28s`**: the CSS minifier rewrites `280ms`, and `getComputedStyle(document.documentElement).getPropertyValue("--duration-medium")` returns `".28s"` (measured). Code and specs parse it; they never compare it with `"280ms"`;
  - `--ease-standard: cubic-bezier(0.24, 1, 0.4, 1)` (`astryx.css:79`); shadows `--shadow-low|med|high` (`:85`); radii (`:84`); spacing `--spacing-0` … `--spacing-12`, including `--spacing-0-5` (2 px) and `--spacing-1-5` (6 px) (`:87`); font sizes, `--font-size-xs` = 10 px (`:82`); weights (`:83`); text leading, `--text-heading-6-leading` = 1.6 (`:88`).
- Astryx components honour reduced motion internally (`@media (prefers-reduced-motion: reduce)` blocks in astryx.css).
- `src/components/detail/PeekHost.tsx` (328 lines):
  - the side peek is the content Layout's `end` slot (`:285-295`): `<ResizeHandle/>` (`:288`, left out when capped or covering), `<LayoutPanel resizable … padding={1} isScrollable={false} className="tessera-peek-panel[ tessera-peek-panel--cover]">` (`:289`), `<Card ref={watchPanelAndCover} … className="tessera-peek-card">` (`:290`) and `<PeekSlot node={slotNode}/>` (`:291`). It is mounted only while a peek is open in side mode, at every width;
  - one mount point: the detail renders once, through a portal (`:325`), into a DOM node the host creates once (`:160-165`); `PeekSlot` adopts that node (`:104-113`) and shows `PeekSkeleton` before the node exists (hydration);
  - `close()` (`:198-204`) goes Back or replaces, decided at call time; the Escape hotkey serves the side panel (`:234`); the modal mode is a Dialog that already animates;
  - decision 11's covered list: `isListCovered = isOpen && !isModal && isPanelCover` (`:271`) puts `inert` on the list's `LayoutContent` (`:302`) in the same commit as the close; `useCoverFocus` (`:275`) moves focus into the detail once it has controls (`hasFocusTarget`, `:273-274`) and returns it to the list's opener on close;
  - the detail is `PeekDetail key={peek.id} … onMountedChange={setDetailMounted}` (`:279`).
- `src/components/detail/peek-detail-lazy.tsx` (decision 142): `PeekDetail` (`:69-72`) picks, once per mount, the loaded component (chunk already there) or the `next/dynamic` one (`:60`), which shows `PeekSkeleton` (`:30-38`) until the chunk arrives; React 19.3 holds a revealed fallback for at least 300 ms. `MountedDetail` reports `onMountedChange(true)` from a layout effect after its DOM is attached (`:49-56`). The choice is kept so the detail is never remounted under the user's editor.
- `src/components/detail/peek-cover.ts`: `useCoverFocus` (`:75-114`) runs a layout effect (`:83-105`) after the commit that sets or removes `inert`; it focuses the first control in the detail when the cover starts and the detail node exists, and on close it focuses the remembered opener only when focus is free (`document.body`).
- `src/components/styles/detail.css`: `.tessera-detail` is an inline-size container (`:8-13`); `.tessera-peek-card` scrolls (`:27-31`); `.tessera-peek-panel { max-width: 100% }` (`:38-40`); **`.tessera-peek-panel--cover { min-width: 100% }`** (`:48-50`), which beats any width animation.
- Hidden routes: Next keeps a left route mounted under `<Activity mode="hidden">` (field guide `index.md:20`). Its DOM stays (`display: none`), its layout-effect cleanups run at hide time, and a WAAPI `Animation` started on it keeps running unless it is cancelled.
- The assistant panel (`mod+j`, `TesseraShell.tsx:54`) and the cycle and module side panels (`tessera-planning-side-panel`) open and close without animation today.
- Measured layout cost of one width step (forced layout, production, CPU 1x): sidebar panel 20.3 ms median and 34.9 ms max, peek panel 20 ms median, on the 200-row list of the decision 115 fixture (53 066 elements); 5.4 ms and 8.2 ms on a 48-row list. A width animation therefore re-lays out the whole content area on every frame.

Lists and paging (verified at `afe589c`, 2026-10-29)
- The scroller is `src/components/work-items/WorkItemsScreen.tsx:405-418` (438 lines), `<LayoutContent padding={0} isScrollable label=… className={scrollerClass}>`. It switches the five layouts and holds the BulkBar (`:417`), and it is the only host of the layouts. `scrollerClass` (`:337`) adds `tessera-wi-scroller--grouped` when the list draws group bands (`work-items.css:271-273`).
- Handlers that reach the layouts (`layoutProps`, `:338-355`):
  - `onUpdate` (`:224-231`) and `onOpen` (`:309-320`) use `useStableCallback` (`stable.ts:19-25`);
  - `onMove` (`:233-256`) and `onQuickAdd` (`:258-307`) are plain functions, new on each render;
  - `canQuickAdd` (`:346`) and `onOrderChange` (`:353`) are inline arrows;
  - `display` is structurally shared through `useShared` (`:157`, `stable.ts:91-96`).
- Paging lives in `src/components/work-items/paging.ts` (274 lines):
  - page sizes `ROW_PAGE = 200` (`:15`), `BOARD_GROUP_PAGE = 30` (`:17`), `LIST_GROUP_PAGE = 50` (`:19`), `MULTI_LIST_GROUP_PAGE = 25` and `MULTI_BOARD_GROUP_PAGE = 20` (`:24-25`, multi-project views), `CALENDAR_CAP = 1000` (`:28`); `groupPageSize` (`:42`), `pageSizeFor` (`:49`);
  - `calendarWindow` is at `:61-67`, with its doc comment at `:55-60`;
  - merges are `mergeGroupPage` (`:166`) and `mergeRowsPage` (`:191`), both linear in the loaded rows; `refetchPlan` (`:212`), `keepLoaded` (`:237`).
- `use-paged-list.ts` (139 lines) shares the server result's structure (`:50`, `shareStructure` in `stable.ts:69-84`) and holds Show more (`loadMore` `:110-129`, `loadMoreUngrouped` `:131-134`; decisions 112–114). `GroupFooter.tsx` draws the footer.
- `list-groups.ts`: `visibleGroups` (`:8-10`), `nothingMatches` (`:16-18`), `listShowsGroups` (`:25-28`).
- `ListLayout.tsx` (512 lines):
  - `RowProps` (`:125-136`); `RowProperties` (`:138-247`) reads the lean `useProjectRow()` (`project-provider.tsx:167`, value `:66-72`); the title is `OneLineText` (`:256-262`), which measures only on hover (`OneLineText.tsx`);
  - rows: `WorkItemRow` is `memo` (`:269-327`, decision 141). The quick-add placeholder path is at `:272-290` and the `ListItem` at `:292-325`. The key `Button.tessera-wi-open` is the row's only tab stop. Its props are `item`, `display`, `onUpdate`, `onOpen`, `readOnly`, `selected` and `onToggle`;
  - groups: `GroupSectionProps` (`:333-347`), `GroupSection` (`:349-401`). Its `body` (`:366-387`) is `List density="compact" hasDividers` (`:369-382`), then `GroupFooter` (`:384`) and `QuickAdd` (`:385`), inside a `Collapsible` (`:391-398`). Astryx `Collapsible` keeps closed content mounted and only hides it (`Collapsible/Collapsible.js:306-313`), so a collapsed group still mounts all its rows today;
  - dividers: Astryx gives each divided `ListItem` `border-bottom-width: var(--border-width)` and removes it from the last one with `.x1t1lzn6:last-child { border-bottom-width: 0 }` (`ListItem.js:51-57`, astryx.css). A windowed list's last *rendered* row is not the true last row;
  - the key `Button` renders no `tabindex` attribute of its own (`Button.js`), so a freshly mounted row is tabbable until a roving stamp sets it to `-1`;
  - the row box is `.tessera-wi-row` (`work-items.css:104-112`, `min-height` `--size-element-md` plus `--spacing-3`); the sticky band is the Collapsible trigger (`work-items.css:243-251`);
  - focus: `useListFocus({ itemSelector: ".tessera-wi-open", orientation: "vertical", wrap: false, hasRovingTabIndex: true, hasCaretGuard: true })` (`:423-429`);
  - the root `VStack` (`:447-455`, `gap={groups ? 2 : 0}`, `paddingBlock={2}`) carries `data-list-ready` (`:454`). Groups are mapped at `:465-489` and the flat `GroupSection` is at `:491-508`.
- `BoardLayout.tsx` (448 lines):
  - `itemsOf` (`:101-105`), `handleDrop` (`:133-176`), drag through `usePointerDrag` (`:178`). `moveToColumn` (`:181-191`) lists `onMove` in its deps, so it changes on every screen render today;
  - `renderCards` (`:226-270`) hides the dragged copy and splices the placeholder `Card` at `drag.target.index` (`:252-254`) into a `VStack gap={2} className="tessera-board-cards"` (`:266-268`). `moveTargetsFrom(column)` builds a fresh array per card per render, and `itemHandlers(...)` a fresh object per card per render (`use-pointer-drag.ts:379-385`);
  - each column body is a scrolling `LayoutContent ref={registerContainer(…)} padding={2} className="tessera-board-column-body"` (`:311-313`; `board.css:103-105`). `LayoutContent` is scrollable by default (`LayoutContent.js:132`);
  - swimlane cells are not scroll containers (`:366`); the drag overlay is at `:386-394`;
  - cards are `BoardCard` (`BoardCards.tsx:46-117`, not memoised, a `ClickableCard` with `ref={cardRef}` at `:104-113`). `BoardCardBody` (`:120-138`, `Text maxLines={3}` at `:132`) and `CardProperties` (`:141-207`) read the full `bundle` prop.
- `TableLayout.tsx` (497 lines):
  - `TableRow` is `{ id, item, groupKey }` (`:54-58`); `isDataRow` (`:70-72`) is false for any row without an `item` object; `buildColumns` (`:91-267`) renders the cells inline; `GroupHeading` (`:282-300`);
  - rows (`:307-316`); the `columns` memo (`:321-324`) depends on `bundle` and on `onOrderChange`, an inline arrow from the screen, so the columns are rebuilt on every screen render;
  - `groupedRows` (`:380-388`); `openPlugin` (`:402-448`); the `plugins` record (`:451-458`) is a fresh object on each render;
  - an Astryx `Table` (`:472-491`) with `data={grouped ? groupedRows.data : rows}` (`:475`), `idKey` (`:477`), `rowCount={result.total}` (`:483`), and the footer at `:492-494`;
  - Astryx `MemoizedTableRow` (`Table/BaseTable.js:243`, compare `:192-240`) skips a row only when `rowKey`, `rowIndex`, `ariaRowIndex`, `columns`, `plugins`, `textOverflow`, `RowComponent`, `CellComponent` and the item (shallow) are equal. So fresh `columns` or `plugins` re-render every row;
  - grouped header rows are **Proxy objects** built by Astryx (`Table/plugins/groupedRows/useTableGroupedRows.js:24-55`, `makeHeader`, `HEADER_PROXY_HANDLER`). Every unknown field, `id` included, reads `""`, and they are recognised by a private Symbol. Only `groupedRows.idKey(row)` (`:202-210`, `__group_<key>`) gives them a key, and only the original objects keep the Symbol;
  - **the header is already sticky.** Astryx's scroll wrapper is `overflow-x: auto` (`Table.js:59-64`), but `table.css:38-56` sets `.astryx-table-scroll-wrapper:has(.tessera-table) { overflow: visible }` and makes `.tessera-table .astryx-table-header-cell` `position: sticky; inset-block-start: 0`, so the header sticks to `.tessera-wi-scroller`. `tests/ui/board-table-css.test.ts:121-128` asserts it.
- Scroll padding: `.tessera-wi-scroller--grouped` sets `scroll-padding-block-start: calc(var(--size-element-md) + var(--spacing-4))` (`work-items.css:271-273`), and `calc(var(--spacing-11) + var(--spacing-4))` under the touch rule (`:429-431`), so native focus scrolling keeps a row clear of the sticky band. The table sets no scroll padding for its sticky header.
- `GanttLayout.tsx` (369 lines):
  - every row is rendered (`:173-187`) inside the body (`:154-188`). `GanttRow` (`:205-333`) is not memoised; its `onSchedule` is `schedule` (`:76-83`), a new function on each render. Dates edit through the lazy `GanttDates` popover (`:336-369`);
  - rows have a fixed height: `gantt.css:181-184` sets both `min-height` and `height` to `var(--tessera-gantt-row)` (`:21`), which is `--size-element-md` (32 px), or 44 px under `(pointer: coarse)` or a phone-width window (`gantt.css:40-43`);
  - the connectors are one SVG in CSS pixels, `viewBox="0 0 days×day rows×row"` (`:156-172`), whose height is `--tessera-gantt-rows` × the row (`gantt.css:198`; set on the root at `:109-114`);
  - `useGanttMetrics(rootRef, active)` (`gantt-metrics.ts:39-52`, used at `:93`) measures the day column, the row height (`readGanttMetrics` reads the first `.tessera-gantt-row`, `:25-31`) and the bar inset with a ResizeObserver. It is lint-safe: the observer's first callback sets state, not the effect body. Today it is active only when there are edges (`:93`);
  - the head and the label column are sticky;
  - a private `cssVars(vars): CSSProperties` (`:40-42`; the same copy is in `planning/ModulesTimeline.tsx:47`) passes custom properties to `style`.
- Bar drags: `src/components/dnd/use-timeline-drag.ts` (112 lines) calls `setPointerCapture` on the bar (`:101`); the preview is `{ id, mode, delta }` (`:15-19`).
- Board drags: `src/components/dnd/use-pointer-drag.ts` (394 lines) listens on `window`, renders a separate overlay clone and reads rects live in `computeTarget` (`:195-210`), so it does not need the source element to stay mounted. `registerItem` caches one ref callback per id (`:160-170`); `itemHandlers(id, container)` returns a **new object** on each call (`:379-385`). The list has no drag: in work items only `BoardLayout` (`:178`) and `CalendarLayout` (`:88`) use `usePointerDrag`.
- Drag slot: `computeTarget` maps the drop slot over **rendered** items only (`rendered` at `:200`). When `slot` is past the last rendered item, the index is `ids.length` (`:208`), the container's true end. That is wrong once a column renders a window.

Calendar
- `CalendarLayoutSchema = z.enum(["month", "week"])` (`src/lib/tessera/schemas.ts:228`); `CalendarDisplaySchema` (`:249-252`) defaults `layout` to `"month"` (`:250`, describe "Month or week grid."). It is also used by:
  - `url-state.ts:38`;
  - `view-settings.ts:54` ("Month or week grid.");
  - `tools/describe-filters.ts:63, 169` (lists `CalendarLayoutSchema.options`);
  - `DisplayMenu.tsx:98-100` (`isCalendarView`, typed `"month" | "week"`) and `:193-201` (SegmentedControl "Calendar view", Month/Week);
  - `docs/contracts/ai.md:76` and `docs/contracts/schema.md:102` spell the two values out.
- Typed consumers of the view: `paging.ts:63` and `CalendarLayout.tsx:71` pass `display.calendar.layout` to `calendarWeeks(…, view: CalendarView)`. A third schema value therefore does not type-check until `CalendarView` gains it.
- `calendar-math.ts` (146 lines):
  - type `CalendarView = "month" | "week"` (`:7`);
  - `monthStart` (`:47-49`), private `monthEnd` (`:51-55`), private `formatUtc` (`:65-68`);
  - `shiftPeriod` (`:57-63`), `periodLabel` (`:70-77`), `monthLabel` (`:79-81`), `weekBandLabel` (`:83-86`), `calendarWeeks` (`:98-118`), `isOutsideMonth` (`:120-122`), `itemsByDay` (`:124-138`), `NARROW_CELL_PX` / `opensQuickAddInPopover` (`:140-146`);
  - `monthLabel`, `weekBandLabel`, `isWeekend` and `weekendShift` are also imported by `GanttLayout.tsx:25` and `planning/ModulesTimeline.tsx:22`.
- `CalendarLayout.tsx` (383 lines):
  - `MAX_IN_CELL = 4` for both views (`:46`); `dayNumber` (`:54-56`);
  - hotkeys `t`, `[`, `]` (`:82-86`); `?cal=` anchor (`:65-66`); `period` noun (`:100`); "Previous/Next month|week" (`:117-118`); heading (`:120`); the cap Banner (`:104-110`);
  - the root is `VStack gap={2} className="tessera-cal" data-view={view}` (`:103`); `calendar.css` already keys the week layout on `data-view` (`:51`, `:60`, `:65`);
  - `DayCell` (`:182-295`): `data-outside` from `isOutsideMonth` for both views (`:228`), the number (`:254-256`), `items.slice(0, MAX_IN_CELL)` (`:216`), the "+N more" Popover (`:271-290`, Button `label` "+N more" at `:284`, the word hidden in a narrow container);
  - four Popovers pass their content even while closed: Unscheduled (`:125-140`), quick add (`:234-252`), "+N more" (`:271-290`) and Move to date with a `DateInput` per chip (`:350-379`). The field guide (performance.md, "Astryx 0.6.8") says closed Popover content stays mounted; the precedent fix is `content={isOpen ? … : null}` (`properties/DateControl.tsx:75`).
- `calendar.css` (346 lines): `.tessera-cal` is a size container `tessera-cal` (`:14`); the week grid stretches to the panel height (`:51-62`) and hugs its chips at 480 px and narrower (`:64-75`, fix round 2026-10-23); `.tessera-cal-day` has `min-height: calc(var(--spacing-8) * 4)` (`:83-90`); a narrow container (`max-width: 33rem`) drops the chip dot, the title and the " more" word (`:304-336`).
- `useNarrowContainer(minWidth)` (`src/components/workspace-settings/use-narrow-container.ts:14-27`): a ResizeObserver on the element's content box, `false` on the server and the first paint. `CalendarLayout.tsx:28` already imports from that folder (`useWeekStart`).
- The data window: `calendarWindow` (`paging.ts:61-67`, doc comment `:55-60`), cap `CALENDAR_CAP = 1000` (`:28`). The engine accepts any `calendar_window` with `from <= to` (`work-items/read.ts:117-122`), so a longer window needs no engine change.
- The gantt zoom Week/Month/Quarter exists (decision 90; `DisplayMenu.tsx:207-216`, `GanttZoom` in `gantt-scale.ts:10`).
- Tests today: `tests/ui/calendar-layout.test.ts` (jsdom render, 195 lines), `tests/ui/calendar-css.test.ts` (155 lines), `tests/ui/date-span.test.ts:94-106` (`calendarWeeks`, `shiftPeriod`), `tests/ui/paging.test.ts:103-126` (`calendarWindow`). There is no `tests/ui/calendar-math.test.ts`. `tests/ui/display-options.test.ts` covers `display-options.ts` only, not the DisplayMenu calendar control.

Tests and tooling
- Vitest picks up `tests/**/*.test.ts` and `src/**/*.test.ts` (`vitest.config.mts:17`); jsdom render tests exist, for example `tests/ui/detail-smoke.test.ts` and `tests/ui/calendar-layout.test.ts`.
- Playwright 1.63.0 (`package.json:77`), `playwright.config.ts`: `next start -H 127.0.0.1` on `E2E_PORT` (default 3100, `:20`), `TESSERA_DB_PATH=data/e2e.db` (`:22`), one worker, no retries, 90 s test timeout (`:30`), `Desktop Chrome` with the default browser (`:39`). The webServer command runs `tests/e2e/prepare-db.ts` first (`:42`): it moves an old `data/e2e.db` aside and seeds the deterministic fixture with the demo WEB project.
- 25 spec files under `tests/e2e/` (138 tests at round 6): assistant, collaboration, coverage-dialogs, coverage-drops, coverage-timeline, coverage-touch, detail-editor, drag-surfaces, drag, external-writes, intake-drafts-bulk, layouts, mobile, pages, perf, relations-reactions, round-features, round4, round5, round6, schemes, smoke, views-settings, work-items, workspace.
- Shared helpers:
  - `tests/e2e/fixtures.ts` (270 lines): `test` and `expect` (`:21-38`; the `page` fixture fails a test on a page error or an untolerated console error, list in `tolerated.ts:16`), `e2eDbPath` `:41`, `mcp` `:51`, `uniqueIdentifier` `:74`, `projectIdOf` `:95`, `createProjectViaUi` `:105`, `createProjectViaMcp` `:134`, `waitForDialog` `:150`, `openWorkItems` `:158`, `dragByPointer` `:168`, `openWebWorkItems` `:191`, `workItemsUrl` `:200`, `openLayout` `:208`, `boardColumn` `:216`, `quickAddItems` `:221`, `listRows` `:233` (page-wide), `nextServerAction` `:238`, `waitForSaved` `:243`, `dragBy` `:249`, `isoDay` `:265`;
  - `helpers-a.ts` (items, dates, week start: `createItem` `:28`, `getItem` `:23`, `getWeekStart` `:62`, `setWeekStart` `:68`), `helpers-b.ts` (`modifierKey` `:77`, `horizontalOverflow` `:204`, touch helpers), `helpers-c.ts` (strict hit boxes), `helpers-d.ts` (hit areas, early actions `armEarlyAction` `:251` with the toggle selector `button[aria-label$="sidebar"]` at `:260`, `throttleCpu` `:337`, `waitForAppHydrated` `:355`). Each helper file imports from `fixtures.ts` only and changes no other helper file (`helpers-d.ts:1-6`).
  - Next keeps left routes in the DOM, so a document-wide query can hit a hidden copy after an in-app navigation.
- Decision 115's browser budget has a spec: `tests/e2e/perf.spec.ts` (p95 of 20 hard navigations to `[data-list-ready]` ≤ 300 ms for list, board and table grouped by state, `:31-52`). It runs only under `playwright.perf.config.ts`, which sets `TESSERA_PERF=1` (`:28`), matches `/perf\.spec\.ts$/` (`:32`), serves `data/p11-perf.db` (`:26`, `PERF_DB`) on `PERF_PORT` (default 3110, `:24`) and seeds the 10 000-item `PERF` project in its webServer command when it is missing (`:49`). In the normal suite the spec skips itself (`perf.spec.ts:38`). At HEAD it measures list p95 902 / 915 ms and table p95 1,653 / 1,643 ms on its grouped page (5 × 50 = 250 rows, `:39-43`; two runs; perf-report-2026-10-28.md §1, improvements.md:20); the flat 200-row page is 754 / 1,265 ms (sweep) or 770 / 1,278 ms (refresh A3).
- Browsers: Playwright 1.63.0 pins Chromium revision 1243, version 153.0.8010.12 (`node_modules/playwright-core/browsers.json`). Both `~/Library/Caches/ms-playwright/chromium-1243` and `chromium_headless_shell-1243` are installed and complete (`INSTALLATION_COMPLETE`). `channel: "chromium"` launches the full Chrome for Testing build in new headless mode; the default launches the headless shell (checked 2026-10-29 with `chromium.launchServer`, no download).
- Perf seeding: `scripts/perf-seed.ts` (`--db --items --projects --other-items --seed --project`, idempotent per identifier). It refuses `data/tessera.db` and whatever `TESSERA_DB_PATH` resolves to (`scripts/perf-db.ts`), so callers unset the variable and pass `--db`. The big project is always named "Performance" (`src/lib/tessera/seed-perf.ts:311`), so a second perf-seeded project in one database fails with CONFLICT. `npm run perf:bench` (`scripts/perf-bench.ts`, `--db --runs --rounds --project`) times decision 115's engine budgets.
- Cache lane remnants: P11 built the partial index `activity_workspace_seq_idx` (`src/lib/tessera/db/schema/core.ts:347-348`, comment "Decision 109 workspaceRev"; `drizzle/0008_hardening.sql:19`) and the revision-probe cases of `tests/perf/query-plans.test.ts:134, 172` (decision 126). Nothing else of decisions 109–111 exists.
- Configuration facts:
  - React Compiler is **off**: there is no `reactCompiler` in `next.config.ts`.
  - The `react-hooks/incompatible-library` lint rule flags TanStack Virtual's `useVirtualizer` (`eslint-plugin-react-hooks` development build, `:18326`, `:31575-31580`).
  - `THIRD_PARTY_NOTICES.md` lists adapted code and reviewed exceptions only. Plain npm dependencies are covered by `package.json` and the licence gate (`npm run check:licenses`).
- File budget: 600 lines for `.ts`/`.tsx` under `src/` and `scripts/` (`scripts/convention-rules.ts:8`, `scripts/check-conventions.ts:25-26, 129`); tests and CSS are not counted; `scripts/file-budget.json` pins only `cycles.ts` (871) and `modules.ts` (694).

---

### 1. Scope and deferrals

**In scope**
- **Sidebar views (decision 128).** Three docked views, as in Plane: Full sidebar; Icons and labels (a 60 px rail with the name under each icon); Icons only (a 48 px rail). The choice is remembered per browser (decision 130). The user picked this on 2026-10-21 (§13, Q1 = B).
- **Docked / floating sidebar.**
  - Floating takes the sidebar out of the layout, so the content panel gets the full width.
  - The sidebar opens as an overlay from a top-bar button, `mod+b` or an 8 px hover edge.
- **Layout motion.**
  - A width transition on sidebar view changes (Full ↔ rail, rail ↔ rail) and dock/undock, with a jank guard.
  - A slide for the floating sidebar and for the side peek's card, and a fade on layout and zoom switches.
  - Duration `--duration-medium` (280 ms in the Catppuccin theme, the token closest to the requested 300 ms), easing `ease-in-out`; none at all under `prefers-reduced-motion: reduce`.
- **Virtual scrolling.**
  - Covers list (flat and grouped), table (flat and grouped), board columns and gantt rows, above small fixed thresholds (decision 135: more than 30 list or table rows, 40 gantt rows, 8 cards in a column).
  - The server renders only an initial window that the first client render matches (no hydration mismatch). That is what brings decision 115's 10k list, board and table under 300 ms p95 (decision 138).
  - Rows, cards, table cells and gantt rows are memoised with per-row props, so a range change draws only the rows that enter (extends decision 141). Collapsed list groups mount no rows.
  - Paging, Show more, group counts, optimistic moves, keyboard focus, drag and drop, selection and sticky headers keep working.
  - It comes with a scroll budget and Playwright perf specs on the 10 000-item fixture.
- **Calendar zoom.** Week / Month / Quarter (calendar quarters) in the display menu, `[`/`]` by period, compact quarter cells (13 or 14 week rows), and count-only quarter cells when the calendar is narrower than 600 px.
- **Docs.**
  - Decisions 109–111 are marked dropped. Decisions 127–139 go between rows 126 and 140 of docs/PLAN.md; 140–142 keep their numbers.
  - Updates go to docs/PLAN.md (§9 and the verified-versions table), PLAN-STATUS.md, improvements.md, docs/contracts/{ui,ai,schema}.md, docs/process/swarm.md (the decision range) and, when P12 lands, docs/as-built/{README,shell-detail,work-items,operations,hardening}.md.

**Deferred** (with the reason; each goes to docs/improvements.md under "Deferred from P12" in lane 0)

| Item | Why not now |
|---|---|
| Virtualising board swimlane cells | Cells are not scroll containers and page at 30 per cell (decision 112). Lanes collapse. Revisit if a cell needs more than 200 cards. |
| Virtualising calendar cells, the pages tree, inbox, activity, comments | Bounded by period, cap or page size today. |
| Infinite scroll (auto "Show more" at the end) | Decision 112's explicit Show more stays; the footer is never virtualised. |
| Server-side (per-user, cross-device) sidebar preferences | Tessera is single-user and local. The preference is a device UI preference like the width (`tessera.sidebarWidth.v1`) and the scheme. A cookie would let the server render the stored view, but reading it would take the shell (top bar, skeleton) out of the static prerender (`(tessera)/layout.tsx:20-28`). |
| A right-click context menu on the sidebar | Replaced by a visible "Sidebar options" button and Power K commands (decision 131), which are discoverable by keyboard. |
| View Transitions API (`<ViewTransition>`) | Decision 132: it snapshots the whole document and runs only inside transitions. Sidebar and peek toggles are sync updates, and the hidden `<Activity>` routes make snapshots unpredictable. |
| Animating the peek panel's width | Decision 132 (4): measured 20 ms of layout per step on the 200-row list, and the cover mode's `min-width: 100%` (`detail.css:48-50`) defeats it. The card slides instead; the list takes its new width in one step. |
| Fiscal quarters or a workspace quarter start | Calendar quarters only (decision 139). |
| Quarter zoom for the modules timeline, cycle timeline | Out of the five requested items. |
| Motion for the assistant panel (`mod+j`) and the cycle and module side panels (`tessera-planning-side-panel`) | Not among the requested surfaces. They keep opening instantly, so the inconsistency with the animated peek is deliberate; the same `animateSlide` helper fits them later. |
| Find-in-page over off-window rows | A trade-off of windowing (decision 137). It now applies to most lists, because windowing starts above 30 rows. The filter field and Power K search find any item. |
| Lazy per-row listbox and popover content (Selector options, tooltips, date dialogs mounted only when opened) | Windowing alone meets decision 115 at CPU 1x (decision 138). The change touches the shared `properties/*` controls used by detail and peek, which no P12 lane owns. It needs its own keyboard and ARIA tests and its own A/B. Astryx's upstream lazy closed layers may make part of it unnecessary (`docs/improvements.md:22`, `:51`). It goes to a follow-up performance lane; its targets are table scrolling at 60 fps and the first render at CPU 4x. |
| Windowing board columns horizontally | P12 windows the cards inside a column only. A board with many columns (grouped by labels: one column per label) still mounts up to 5 cards per column on first paint, about 80 + 4.4 ms × cards, so 40 columns miss decision 115. Revisit with the follow-up lane. |
| Meeting decision 115 under 4× CPU throttling | Not measured. A ~50-item list already takes about 1.1 s at 4x (`docs/improvements.md` "Performance round 2"), so windowing alone will not reach 300 ms there. Lazy listbox content and Astryx's lazy layers are the levers (follow-up lane). |

### 2. New decisions (lane 0 inserts them in docs/PLAN.md between row 126, line 209, and row 140, line 210; rows 140–142 keep their numbers)

| # | Decision |
|---|---|
| 127 | **Cache lane dropped.** The user dropped the `"use cache"` lane on 2026-10-21. Decisions 109–111 stay in the table marked "Dropped 2026-10-21 (decision 127)" with their text kept for history. Reads stay dynamic (`await io()` + `readTessera`) and own writes use `refresh()`. External writes keep `ChangesPoller` → `refreshAction`. No `src/app/_cache/`, `cacheTag`, `updateTag` or `tests/cache-safety.test.ts` will be written. Only the workspace revision index `activity_workspace_seq_idx` (`schema/core.ts:347-348`, migration 0008) and its query-plan probes (decision 126) were built in P11; they stay, because they are harmless and decision 126 tests them. Their "Decision 109" comment stays valid, since decision 109 keeps its row. The P11 exit criterion "no blocking-route insight" stays. |
| 128 | **Sidebar views.** Three docked views, as in Plane (user answer B, 2026-10-21): **Full** (the labelled sidebar at the stored width, 236–350 px, default 250); **Icons and labels** (a 60 px rail, `calc(var(--spacing-12) + var(--spacing-3))`, with each destination's name under its icon); **Icons only** (Astryx's collapsed rail, `var(--spacing-12)` = 48 px, names as tooltips). Both rails are Astryx's collapsed SideNav (`collapsible.isCollapsed = true`). The labelled rail adds `data-rail="labels"` on the nav and CSS in `nav.css`: the name is the link's `::after` with `content: attr(data-rail-label)`, so the whole tile is the link, its hover and focus ring cover icon and name, and the accessible name stays the link's `aria-label` (no second reading). `RailItem` and the favourites folder item pass `data-rail-label={label}`; Astryx spreads it onto the collapsed `<a>` or `<button>` (`SideNavItem.js:368-379, 405-420`). Names use `--font-size-xs` (10 px), line height `--text-heading-6-leading` (16 px), weight `--font-weight-medium`, centred, at most two lines; a tile is 52 px wide and at least 44 px high (`--spacing-11`). The tooltips stay in both rails, because long names clamp. **Switching:** `mod+b` and the top-bar `SideNavCollapseButton` switch between Full and the stored rail kind (default Icons only), so the button keeps Astryx's "Collapse sidebar" / "Expand sidebar" names and a first collapse still lands on the 48 px rail (`round6.spec.ts:195-201`). A drag of the resize handle below Astryx's threshold (raw width under 160 px, reachable: `useResizable.js:629-637`) also switches to the stored rail kind, without animation. The "Sidebar options" menu and Power K set any of the three (decision 131). Every change persists (decision 130). The views apply only while docked at or above `md` (768 px); the floating panel and the mobile drawer always show the Full view. **Focus:** Full ↔ rail remounts the nav (it gains or loses the resize wrapper, `SideNav.js:406-427`); rail ↔ rail and a dock change of the Icons rail kind do not. After any view or dock change the shell checks two animation frames later; if focus fell to `<body>`, it focuses "Sidebar options" (`#tessera-nav-options`), or `#tessera-nav-toggle` when that button is inside an inert panel. |
| 129 | **Docked and floating sidebar.** `dock: "docked" \| "floating"`, default `"docked"`. **Floating:** the AppShell sidenav panel takes no width. The SideNav becomes an absolutely positioned overlay inside that panel: 8 px (`--spacing-2`) from the top bar, the window bottom and the left edge; the width is the stored sidebar width; it always shows the Full view (the stored view is kept but not applied); `--color-background-body`, `--color-border` hairline, `--radius-container`, `--shadow-high`; z-index 300. It is closed by default. **Opens on:** the top-bar "Show sidebar" button; `mod+b`; the pointer resting 120 ms on an 8 px edge strip at the window's left edge below the top bar (only for `(hover: hover)` pointers). No Power K command opens the overlay: while floating, the palette lists only "Sidebar: Dock" (decision 131). Opening by button or `mod+b` moves focus, one frame later, to the first of: `[data-nav-autofocus]` (the enabled "New work item" button), the `[aria-current="page"]` item, the first `a[href]` or enabled button in `#tessera-sidebar`. Hover does not move focus. **Closes on:** the pointer leaving the panel for 300 ms; Escape inside the panel; a pointer press outside the panel, the edge and the toggle; focus leaving the panel (checked one animation frame after `focusout`, against the live DOM); a pathname change; `mod+b` or the toggle again. **Stays open while:** focus is inside it; a popup trigger inside has `aria-expanded="true"` (an open menu: the selector is `[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]`, because an expanded favourites folder, `FavoritesSection.tsx:144` `collapsible={{ defaultIsCollapsed: false }}`, carries a plain `aria-expanded="true"` (`SideNavItem.js:500, 527, 551`) while Astryx menu triggers also carry `aria-haspopup`, `DropdownMenu.js:884-885, 924-925`); `body.tessera-dragging` is set (project reorder); or a modal `dialog[open]` is in the document (for example Create project opened from the Projects "+"), so the dialog's focus return lands inside the open panel. **The toggle:** a `pointerdown` on `#tessera-nav-toggle` marks a pending toggle press for 500 ms or until its click. The focusout and outside-press closes ignore a pending press and a `relatedTarget` inside the toggle, so a click on "Hide sidebar" closes the panel once and never re-opens it, Safari (no focus on click) included. **Focus after a close:** Escape → the toggle; toggle or `mod+b` → the toggle if focus was inside, else unchanged; a pathname change with focus inside → the main content `#astryx-app-shell-main` (AppShell's skip target); any other reason → unchanged. While closed, the panel is `inert`, `visibility: hidden` after the slide, and translated out. It is never resizable while floating. **The open flag** is session state in a module store (`nav-prefs.ts`, never stored), read with `useSyncExternalStore` in each consumer with server snapshot `false`, like the view (decision 130), because `mod+b` can open the overlay before the streamed sidebar hydrates. Below the `md` breakpoint the dock preference is ignored (drawer as today), and the open flag resets to closed whenever the breakpoint flips. Switching to docked closes the overlay and restores the stored view. |
| 130 | **Navigation preference storage.** `localStorage["tessera.nav.v1"]` holds JSON `{"display":"full"\|"rail","rail":"icons"\|"labels","dock":"docked"\|"floating"}`; the defaults are `full`, `icons`, `docked`. `parseNavPrefs` validates each field on its own: an unknown or missing field falls back to its default and extra keys are ignored. There is no compatibility branch for the two-field shape of the 2026-10-21 draft, which never shipped: its `display: "labels"` or `"icons"` is an unknown value and falls back to `full`. Every consumer (sidebar, skeleton, top bar, shell, command bar) reads the preferences through `useSyncExternalStore` in its own component, whose server snapshot is the defaults; the shell context carries callbacks only (the streamed-subtree rule, `docs/contracts/ui.md:93`, which `nav-prefs.ts` takes over from `nav-collapse-store.ts`). So hydration renders Full/docked and then switches to the stored value **without animation**: the same first-paint trade-off as `tessera.scheme.v1` and the stored width; acceptance step 4 makes it visible. Other tabs follow through the `storage` event, without animation. Writes are wrapped in try/catch (private mode): the change still applies to this page. The floating open flag is session state (decision 129) and is never stored. There is no database column, no migration and no legacy key to read: today's collapse flag (`nav-collapse-store.ts`) was never persisted. |
| 131 | **Sidebar shortcut and commands.** `mod+b` stays the only key. It becomes the registry entry `"sidebar.toggle"` ("Collapse or expand the sidebar", note "Shows or hides it while undocked", group Global): the help dialog lists it exactly once, because the hand-written `EXTRA_GLOBAL` row in `ShortcutsDialog.tsx:44` ("Collapse the sidebar") is removed. The palette does not list it (Global), and `useShortcuts` leaves it to `TesseraShell` (`DELEGATED`). Docked: it switches between Full and the stored rail kind. Floating: it opens or closes the overlay. Below `md` it does nothing (the drawer has its own toggle, and the stored preferences stay untouched); the shell reads `isSidenavDrawer()` (§5.2: `matchMedia(SIDENAV_DRAWER_QUERY)`, false when `window.matchMedia` is missing, as in jsdom) at the key press. Power K gains five palette-only commands in "Settings", labelled like the menu: "Sidebar: Full sidebar" (`sidebar.full`), "Sidebar: Icons and labels" (`sidebar.labels`), "Sidebar: Icons only" (`sidebar.icons`), "Sidebar: Undock (float over the page)" (`sidebar.float`), "Sidebar: Dock" (`sidebar.dock`). Their keywords are `sidebar, navigation, rail, collapse, expand, dock, float, icons, labels, full`. Docked, the palette lists the two views that are not current plus `sidebar.float`; floating, it lists only `sidebar.dock`; below `md` it lists none. **In overlay (floating) mode the three view commands are hidden**, so no Power K command opens or switches the overlay; "Sidebar: Dock" docks and restores the stored view. If the preferences change between listing and selecting (another tab), a view command still runs `setNavView`, which only stores the view while floating (it applies once docked). They run after the palette has closed (`window.setTimeout(…, 0)`, as shortcut ids do, `CommandBar.tsx:358`). The "Sidebar options" footer button (`footerIcons`, desktop only, id `tessera-nav-options`) opens a DropdownMenu. Docked, it shows a radio group "Show" with "Full sidebar", "Icons and labels" and "Icons only", a divider, then "Undock sidebar" (description "Show it over the page when you need it"). Floating, it shows only "Dock sidebar". |
| 132 | **Layout motion.** Exactly these animate: (1) **docked view changes** (Full ↔ rail, Icons only ↔ Icons and labels): WAAPI `width` on the `.astryx-app-shell-sidenav` panel from its old to its new width. While docked, the panel clips horizontally (`overflow-x: hidden`) and the nav keeps its own width (`flex-shrink: 0`), so a growing panel reveals a nav that is already at its final width instead of squeezing it every frame (measured); (2) **dock/undock:** the same panel animation (to or from 0) while the floating panel slides; (3) **floating open/close:** a CSS `transform` slide plus delayed `visibility`; (4) **side peek open/close:** the panel takes its final width at once (the list re-lays out once) and the peek card (`.tessera-peek-card`) slides: WAAPI `transform` from `translateX(calc(100% + <panel padding>))` to `none` on open, and back on close. The detail is never remounted for it: motion only changes props on the existing LayoutPanel (`inert`, `data-motion`), so the skeleton-then-detail swap of decision 142 lands in the same card, after or during the slide (on the lazy path React holds the revealed skeleton at least 300 ms, longer than the 280 ms slide, so the swap usually lands just after it ends). The close runs the slide first and then navigates. A second close during it does nothing. The slide is cancelled, never navigating, when the route is hidden or unmounted. On finish it navigates only if the URL still equals the one captured at close, and it decides Back or replace at that moment; the card stays out (`fill: "forwards"`) until the URL has changed; (5) **layout switches:** an opacity 0 → 1 fade of the work-items scroller when `display.layout`, `display.calendar.layout` or `display.gantt.zoom` changes after the first render. **Duration:** the computed `--duration-medium` (280 ms in the Catppuccin theme, `catppuccin.css:240`, served as `.28s` by the production build; fallback 300 ms if unreadable). **Easing:** `ease-in-out`. **Jank guard:** a width animation, (1) and (2), is finished at once (`animation.finish()`) when two of its first three frame intervals exceed 34 ms; a re-layout of the content costs 20 ms per step on the 200-row list (measured), and a jump is better than a stutter. Transform and opacity animations need no guard. Nothing animates on: hydration, the stored value arriving, `storage` events, drag-resizing (any `[data-resizing]` element), the browser Back button, a peek mode switch (side ↔ modal), a peek switching items, the stored peek width arriving, or the first render (including a reload with `?peek=` in the URL). Below `md` there is no sidebar panel, so sidebar changes apply without animation; the peek and the fade animate at every width. No View Transitions API. |
| 133 | **Reduced motion.** `prefers-reduced-motion: reduce` is read through `matchMedia` at the moment of each change, never cached. When it matches, every decision 132 animation is skipped: the state applies in the same frame and the peek close navigates at once. Every P12 CSS transition has a `@media (prefers-reduced-motion: reduce) { transition: none; }` override in the same stylesheet. The jank guard (decision 132) is not a substitute: it only shortens an animation that has started. Astryx components keep their own handling. Playwright checks both modes with `page.emulateMedia({ reducedMotion })`. |
| 134 | **Virtual scrolling library.** `@tanstack/react-virtual` **3.14.19** (exact; published 2026-10-13, the newest patch at least 14 days old on 2026-10-29), MIT, peers `react` and `react-dom` `^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` (19.3.0 installed), 63.7 kB unpacked. Its only dependency is `@tanstack/virtual-core` **3.19.4** (pinned exactly by its manifest; MIT, no dependencies). It is installed only after the user approves the download (§13 Q2). The §7 API names were read on 3.14.13 / virtual-core 3.17.11 (2026-10-21); the core has since released 3.18.0 and 3.19.0, so V1.1 re-verifies every point marked **re-verify** (§7) against the installed `.d.ts` before any layout work, and a mismatch goes to the reconciler. It is imported only by `src/components/virtual/use-virtual-rows.ts`, which disables `react-hooks/incompatible-library` on one line with the reason (React Compiler is off: no `reactCompiler` in `next.config.ts`; the instance never leaves the hook). The roadmap's React Compiler trial (`docs/drafts/perf-roadmap-2026-10-24.md`, "With P12", `react-compiler`) must revisit that line. No P12 code sets state in an effect body: `react-hooks/set-state-in-effect` also covers `useLayoutEffect` (`eslint-plugin-react-hooks.development.js:46370-46372`). No P12 code reads or writes a ref's `.current` during render: `react-hooks/refs` is in the recommended preset (`eslint-plugin-react-hooks.development.js:18232-18238`, `eslint-plugin-react-hooks` 7.1.1). So the kept row is state and the range bounds are derived from `virtualizer.range` (§6.3), never a ref, and the React Compiler revisit only concerns the one `incompatible-library` line. Measurements reach React through external stores (`useSyncExternalStore`) written from ResizeObserver and rAF callbacks, like `gantt-metrics.ts:39-52`. It was chosen because it is headless, so it keeps Astryx `List`/`Table`/`Card` markup and Tessera's own scroller. It supports a shared scroll container (`scrollMargin`), dynamic measurement (`measureElement`), extra rendered indexes (`rangeExtractor`) and the `enabled`, `getItemKey`, `gap` and `initialRect` options, and it is the most agent-familiar option. Rejected: react-window (owns its scroll container per list, which breaks the shared scroller and sticky group bands); react-virtuoso (owns the scroller and renders its own sticky group headers); a hand-written windower (more code to verify than the library); CSS `content-visibility: auto` (each row still mounts its Astryx controls, so the React mount cost stays, and that cost is what misses decision 115). |
| 135 | **Virtual windows.** **Thresholds** (strictly more than): list 30 loaded rows across all groups; table 30 rows (data rows plus grouped header rows); gantt 40 rows; board 8 loaded cards **per column** (swimlane cells are never windowed). Below a threshold every loaded row is rendered, as today, except that a collapsed list group mounts no rows (Astryx `Collapsible` keeps closed content mounted, `Collapsible.js:306-313`). The thresholds keep a full render inside decision 115 by the measured costs: 30 list rows about 204 ms (105 ms + 3.3 ms per row); 30 table entries measured 257 ms p95 (perf-report-2026-10-28.md §1 sweep: 25 rows plus 5 group headers), and the fit at small row counts (25–100 rows: 117–121 ms + 5.3–5.6 ms per row) predicts 279–284 ms, so the table's margin at its threshold is about 15–45 ms, not more; board 80 ms + 4.4 ms per card (§10 and the refresh measurements). **Estimates** (CSS px as JS numbers; measured at 1280 px in Latte and Frappé on the small and the 10k fixture): list row 44, table row 37, board card 136 plus the stack gap 8, gantt row 32. Fixed parts for the first window: list block padding 8, group band 40, gap between groups 8, list footer 44, quick-add row 36, table head 30, board column body padding 8. **Initial window (server and hydration).** Until the scroller has been measured, each anchor renders a deterministic window computed from the estimates (`initialRange`, `estimateStarts`). It assumes a scroller of `INITIAL_VIEWPORT = 768` px (a board column body 528) at scroll top 0 and adds the initial overscan (list 2, table 2, board 1, gantt 4). The server and the first client render therefore draw the same rows: 19 rows for the 10k list grouped by state, 20 flat; 22 table entries; 5 cards per board column; 28 gantt rows. An anchor that starts below the initial viewport renders no rows. **Live window.** After the first measurement TanStack's range applies, with overscan list 4, table 4, board 2, gantt 6. A **near-viewport gate** renders no rows (except kept rows) for an anchor that lies wholly outside `[scrollTop − margin, scrollTop + viewport + margin]` (margin = live overscan × estimate), so off-screen groups do not draw their first rows. "Near" is a per-anchor boolean in the scroller store, recomputed by a rAF-coalesced `scroll` listener and emitted only when it flips (§6.3), because TanStack re-renders its host only when `isScrolling` or the range indexes change, and the range of an anchor outside the viewport stays clamped to its first or last rows. **No provider.** Without a `VirtualScrollerProvider` above it (a layout rendered on its own, as in jsdom tests), the hook uses a default store that never virtualises: every loaded row renders, as today. A nested board-column provider inherits that: it virtualises only under a virtualising screen provider. **Scrollers and anchors.** The scroll element is `.tessera-wi-scroller` for list, table and gantt (from `VirtualScrollerProvider` in WorkItemsScreen) and each column's `.tessera-board-column-body` for board columns (a nested provider per column). Each virtual container (a list group's `List`, the table `tbody`, the gantt body, a column's cards stack) is an **anchor** registered with its provider's store. The store measures every registered anchor's offset inside the scroller (`scrollMargin`), its computed `row-gap`, and the scroller's `clientHeight`. It does this in one rAF-coalesced pass after an anchor registers and whenever a ResizeObserver on the scroller or its first element child fires. It ignores passes while the scroller has no layout (a hidden `<Activity>` route), so a hidden route keeps its last values and re-measures when shown. Rows stay in normal flow and the window is padded by `--tessera-virtual-before` / `--tessera-virtual-after` on the anchor; the table uses spacer rows instead. **Kept rows:** a `rangeExtractor` adds the kept indexes to TanStack's default range, so they are rendered and measured: the last-focused row of each container (React state set from `onFocusCapture`, never a ref read in render, decision 134), and in the gantt the row of the bar being dragged (its pointer capture would be lost if it unmounted). List, board and gantt place a kept row outside the window absolutely at its measured offset (`.tessera-virtual-kept`), before or after the window in DOM order. The table keeps it in normal flow between split spacer rows. **Measurement guard:** a measured size of 0 on an element without an `offsetParent` (a hidden route, a collapsed ancestor) keeps the cached size for that index (else the estimate). The gantt is not measured per row: its row height is `useGanttMetrics` (`gantt-metrics.ts:39-52`), active whenever the gantt is windowed or has edges. **Print:** windowing is off while printing (a print store read through `useSyncExternalStore`; `beforeprint` emits inside `flushSync`, `afterprint` and a `matchMedia("print")` listener emit too), so a print shows every loaded row. **Dividers:** when the last rendered row is not the container's last row, `virtual.css` restores the bottom divider that Astryx removes from `:last-child`. Row `data-index` values are strings (Astryx `BaseProps` types `data-*` as `string`). |
| 136 | **What virtualisation keeps working.** **Paging:** footers ("Show N more") and quick-add rows sit after the virtual body and are never virtualised; counts, `has_more` and the loaded/total notes are unchanged (decisions 112–114). **Sticky:** list group bands stay sticky because the group container keeps its full height. The gantt head and label column are unchanged. The table header is **already sticky** (`table.css:38-56`, asserted by `board-table-css.test.ts:121-128`) against `.tessera-wi-scroller`; windowing keeps the `thead` in the same scroller, so P12 adds no sticky rule and that test stays green unchanged. Board column headers are outside the column scroller. **Scroll offsets:** TanStack's `scrollToIndex` ignores CSS `scroll-padding`, so the hook passes `scrollPaddingStart` = the scroller's computed `scroll-padding-block-start` (the list band offset of `work-items.css:271-273, 429-431`, 0 when not grouped) plus, for the table, the measured `thead` height; a target row lands fully below the sticky band or header. **Drag and drop (board):** `computeTarget` uses `indexForSlot`, so a drop below the last *rendered* card lands right after it, not at the column's true end (extends decision 114). The board placeholder is a virtual item keyed `"placeholder"` with its own `data-index`, sized to the dragged card. Auto-scroll moves the window. Board drags need no kept source element (window listeners, a separate overlay clone); the gantt bar drag keeps its row (decision 135). The list has no drag. **Render identity (extends decision 141):** a range change re-renders only the hook's host, and the rows it passes on keep their props. Rows, board cards, table cells and gantt rows are `memo` components whose per-row props are primitives (`dataIndex`, `setSize`, `keptTop`, `selected`, `isPeeked`) or stable references (the item, a stable `measureRef`, handlers made stable in WorkItemsScreen and cached per id in `use-pointer-drag`). The board keeps the drag state per column, so a drag publish re-renders only the source and the target column. **Keyboard:** list arrows keep `useListFocus`; after each virtual commit `stampTabStops` keeps exactly one `.tessera-wi-open[tabindex="0"]` (freshly mounted rows carry no `tabindex`, so a kept row keeps the stop). In a virtual list, Home and End scroll the scroller to the top or bottom, then re-check once per animation frame: while the target row (the first or last loaded row) is not mounted, or its top moved by more than 1 px since the last frame (estimates being replaced by measured sizes), they re-issue the scroll; once it is mounted and still for two frames, they focus it. At most 20 frames; then they focus the nearest rendered row. When ArrowUp, ArrowDown, Home, End, PageUp or PageDown is pressed on a kept (off-window) focused row, the row is first scrolled into view (`scrollToIndex`) and nothing else happens. Every other key (Tab, Enter, Space, Escape, the global shortcuts) behaves as usual. Tab order elsewhere follows the rendered DOM. **Selection:** works on ids; group and header checkboxes act on loaded ids. **Optimistic rows:** quick-add placeholders and moved items are ordinary items of the window. |
| 137 | **Virtualisation trade-offs.** Find-in-page (Cmd/Ctrl+F) finds only rendered rows of a virtual list. With the thresholds of decision 135 that is any list above 30 rows, so most lists. The filter field and Power K search find any item. Printing is not a trade-off (decision 135 turns windowing off). A11y: virtual list rows carry `aria-posinset` (1-based position among the loaded rows of their group) and `aria-setsize` = the group's total, `max(group.count, loaded)` (flat: `max(result.total, loaded)`), the same number as the group badge and the table's `aria-rowcount`. The virtual table keeps `aria-rowcount = result.total` and sets each rendered row's `aria-rowindex` to its 1-based position in the loaded rows. Spacer rows are `aria-hidden="true"` and `role="presentation"`. Board and gantt expose rendered items only. |
| 138 | **Performance budget for windowing.** Production build (`next start`) under `playwright.perf.config.ts`: `TESSERA_PERF=1`, the 10 000-item `PERF` project of `data/p11-perf.db` (seeded by the config when missing), Playwright's Desktop Chrome device at 1280×720, no CPU throttling. **First render (gate):** decision 115's p95 ≤ 300 ms over 20 hard navigations to `[data-list-ready]`, measured by `tests/e2e/perf.spec.ts` with its default browser (its baseline), holds for list, board and table grouped by state (today's scenarios) and for list and table flat (added by lane Q). List grouped by labels is reported, not gated. Expected from the row-cap probe: list about 195 ms, board about 190–210 ms, table about 250 ms (the smallest margin). Decision 115 itself is not loosened. **Scroll (gate):** `tests/e2e/virtual-perf.spec.ts` on Chromium new headless (`channel: "chromium"`, the full Chrome for Testing build that Playwright 1.63 installs as `chromium-1243`). Scenarios: list, table and gantt flat, and the first column of the board grouped by state. Each loads at least 2 000 rows (the board column: 300 cards), then scrolls the visible scroller for 5 s by +120 px per animation frame, top to bottom and back. Budget: **zero** `longtask` entries; list and gantt median frame interval ≤ 17.5 ms and p95 ≤ 34 ms; table and board median ≤ 34 ms and p95 ≤ 50 ms (60 fps for those two is the follow-up lane's target, §1); rendered rows at the end ≤ 40 (list, table), ≤ 56 (gantt), ≤ 12 cards in the column. **The frame numbers (17.5 / 34 / 50 ms) are estimates until measured**: they come from first-load per-row costs (refresh A5: about 3 rows × 3.4 ms per frame), while a client mount during scrolling also pays each new row's Astryx layers (`readPortalWritingContext` and a second render pass) and, in the table, a re-render of every rendered row per range change (`rowIndex` in `areRowPropsEqual`, `Table/BaseTable.js:196`). **Baseline runs:** V1.3 runs the list scenario of `virtual-perf.spec.ts` on the V1 branch before V2 starts, and V2 runs the table, board and gantt scenarios before Q; each reports median, p95, long-task count and longest task. **Fallback, in this order** (the reconciler decides, records the new number in this row and in `docs/field-guide/performance.md`, and says so in its notes; no worker invents another): 0. a median or p95 that misses by 20% or less moves to the measured value rounded up to the next ms; 1. the spec's per-frame step drops below 120 px only if real wheel deltas, measured in the same browser, are smaller; 2. the table and board medians and p95 move to report-only (then list and gantt, if they still miss), keeping zero long tasks and the rendered-row caps; 3. the shortfall goes to the lazy-listbox follow-up lane (§1) with its numbers. Zero long tasks is never relaxed by the reconciler: if it still fails after step 1, the root planner asks the user. **Reported, not gated:** each Show more click's longest task (the merges are linear in the loaded rows, `paging.ts:166, 191`, `stable.ts:69-84`); one End-key jump in the list and the table (about window × per-row cost: list about 70 ms, table about 150 ms); the server HTML size of the 10k grouped list (4.4 MB today, about 0.95 MB with the initial window). **Known gaps, recorded, not gated:** CPU 4x; boards with many columns, such as grouped by labels (§1); the gantt first render (gantt is not in decision 115). Every query runs on the visible route's scroller only (§10). |
| 139 | **Calendar zoom.** `CalendarLayoutSchema` becomes `z.enum(["week", "month", "quarter"])`. The stored field stays `display.calendar.layout`, so old JSON stays valid and no migration is needed; the default stays `"month"`. The display menu's calendar control becomes "Zoom" with Week / Month / Quarter, in the gantt's order. **Quarter** = the calendar quarter containing the anchor (`?cal=`, any day in it; Q1 is Jan–Mar, and so on), drawn as one grid of the whole weeks that touch it: 13 or 14 rows, never 15 (checked for 2000–2100, every week start, weekends on and off), weeks starting on the workspace week start (decision 101). Days outside the quarter carry `data-outside` (muted). Week and month keep today's rule: days outside the anchor's month are muted. In the quarter the first day of each month reads "Nov 1"; other days show the number. `[`/`]` and Previous/Next quarter move one quarter and land on its first day; `t` and Today go to today. The heading reads "Q4 2026 (Oct – Dec)". Items per cell before "+N more": week 4 and month 4 (today's `MAX_IN_CELL`, unchanged, so the week and month views behave as before), quarter 2. When the calendar root's content box is narrower than 600 px (measured on the root, so a side peek counts as well as the viewport), quarter cells show no item rows, only a "+N" button named "1 work item on YYYY-MM-DD" or "N work items on YYYY-MM-DD" (singular for one), which opens the same popover list. The root keeps `data-view`, which now also takes `quarter`. Quarter cells have a floor of 2 × `--spacing-8`. The week grid keeps its stretch-to-panel rule, so there is no new week rule. The calendar's popovers mount their content only while open. The data window is `calendarWindow` (unchanged code, now up to 98 days) with the existing 1 000 cap and Banner. MCP: `describe_filters` lists `quarter`; `save_view_settings` and `get_view_settings` accept it ("Week, month or quarter grid."). |

### 3. Data model changes

None. Nothing changes in SQLite. The only stored shapes that change are:

| Where | Change | Migration |
|---|---|---|
| `display.calendar.layout` (view settings JSON, URL state `q`) | Accepts `"quarter"` | None; existing `"month"` and `"week"` stay valid |
| `localStorage["tessera.nav.v1"]` (new) | `{ display: "full" \| "rail", rail: "icons" \| "labels", dock: "docked" \| "floating" }` | None; an absent key means the defaults; an unknown or missing field falls back to its default (decision 130) |

### 4. Engine and schema edits (lane C, task 1; one commit with the `calendar-math.ts` type change)

The schema change and the `CalendarView` type change land together. `paging.ts:63` and `CalendarLayout.tsx:71` pass `display.calendar.layout` to `calendarWeeks(…, view: CalendarView)`, so a three-value schema with a two-value `CalendarView` fails `tsc`.
- `src/lib/tessera/schemas.ts`: `CalendarLayoutSchema = z.enum(["week", "month", "quarter"])` and the `CalendarDisplaySchema.layout` describe text "Week, month or quarter grid.". These are `:228` and `:250` at `afe589c`, and `:137` and `:159` after lane 0's verbatim split (§8, lane 0 task 0). Re-grep before editing.
- `src/lib/tessera/view-settings.ts:54`: describe text "Week, month or quarter grid.".
- `tools/describe-filters.ts:169` lists `CalendarLayoutSchema.options` and `:63` derives its type, so it needs no change. `url-state.ts:38` needs none either.
- `docs/contracts/ai.md:76` (the `describe_filters` payload): `calendar: { layout: ("week" | "month" | "quarter")[], … }`.
- `docs/contracts/schema.md:102` (the Display shape): `calendar: { layout: "week" | "month" | "quarter" (default "month"), … }`.
- Tests: extend `tests/view-settings.test.ts` with a `save_view_settings` round trip of `display.calendar.layout = "quarter"`, beside the existing `"year"` rejection (`:163`). Extend `tests/ui/url-state.test.ts` (cases at `:78-79`, `:124`) so that a `q` carrying quarter decodes and `"year"` is rejected.
- No engine change: `calendar_window` accepts any `from <= to` span (`src/lib/tessera/work-items/read.ts:117-122`).

### 5. Shared modules written by lane 0 (exact API; other lanes import them)

**5.1 `src/components/shell/nav-prefs.ts`** ("use client"; the only React import is `useSyncExternalStore`). It replaces `nav-collapse-store.ts`, which lane N deletes once no file imports it (§8).
```ts
export type NavDisplay = "full" | "rail";
export type NavRail = "icons" | "labels";
export type NavDock = "docked" | "floating";
export type NavPrefs = { display: NavDisplay; rail: NavRail; dock: NavDock };
export type NavView = "full" | NavRail;                                   // what the menu radio and Power K pick
export const NAV_PREFS_STORAGE_KEY = "tessera.nav.v1";
export const DEFAULT_NAV_PREFS: NavPrefs;                                  // frozen { display: "full", rail: "icons", dock: "docked" }
export function parseNavPrefs(raw: string | null): NavPrefs;              // decision 130: field-by-field fallback; no draft-shape branch
export function serializeNavPrefs(prefs: NavPrefs): string;               // JSON with exactly the three keys
export function navView(prefs: NavPrefs): NavView;                         // display === "full" ? "full" : rail
export function navViewPatch(view: NavView): Partial<NavPrefs>;            // "full" → { display: "full" }; "icons" | "labels" → { display: "rail", rail: view }
export function isRailShown(prefs: NavPrefs): boolean;                     // dock === "docked" && display === "rail"
export const navPrefsStore: { subscribe(listener: () => void): () => void; getSnapshot(): NavPrefs; getServerSnapshot(): NavPrefs }; // for tests, like colorSchemeStore (color-scheme.ts:68)
export function getNavPrefs(): NavPrefs;                                   // = navPrefsStore.getSnapshot(); for event handlers
export function useNavPrefs(): NavPrefs;                                   // useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
export function setNavPrefs(patch: Partial<NavPrefs>): void;               // merge, write (try/catch), emit; no-op when unchanged
export function getNavOpen(): boolean;                                     // floating overlay, session only
export function useNavOpen(): boolean;                                     // useSyncExternalStore; server snapshot false
export function setNavOpenFlag(open: boolean): void;                       // emits only on change; never stored
export const SIDEBAR_COMMAND_PREFIX = "sidebar.";
export type SidebarCommandId = "sidebar.full" | "sidebar.labels" | "sidebar.icons" | "sidebar.float" | "sidebar.dock";
export function sidebarCommandPatch(id: string): Partial<NavPrefs> | null; // full/labels/icons → navViewPatch; float → { dock: "floating" }; dock → { dock: "docked" }; else null
```
- The store follows `color-scheme.ts:26-72`: `getSnapshot` reads storage lazily on its first client call and caches the parsed object, so it is referentially stable; it is re-parsed only on `setNavPrefs` and on a `storage` event for this key (listener attached while there are subscribers). `getServerSnapshot` returns `DEFAULT_NAV_PREFS` (the same object every time).
- The open flag has its own listeners and its own snapshot (a boolean), so opening the overlay does not re-render components that read only the preferences.
- Neither value is passed through a React context; every consumer calls `useNavPrefs()` or `useNavOpen()` itself (decision 130).

**5.2 `src/components/shell/layout-motion.ts`** (decisions 132–133)
```ts
export const LAYOUT_MOTION_EASING = "ease-in-out";
export const LAYOUT_MOTION_FALLBACK_MS = 300;
export const LAYOUT_MOTION_TOKEN = "--duration-medium";                          // 280ms in catppuccin.css:240; the production build serves ".28s"
export const SIDENAV_DRAWER_QUERY = "(width < 768px)";                           // AppShell's md breakpoint in the Catppuccin theme (catppuccin.js:394-400)
export const JANK_FRAME_MS = 34;                                                 // two 60 Hz frames
export function parseDurationMs(value: string, fallback?: number): number;      // "280ms"→280, ".28s"→280, "0.28s"→280, " .28s "→280; "", "auto", "-1s"→fallback
export function layoutMotionMs(): number;                                        // computed LAYOUT_MOTION_TOKEN on <html>, else LAYOUT_MOTION_FALLBACK_MS
export function prefersReducedMotion(): boolean;                                 // false without window or window.matchMedia
export function isSidenavDrawer(): boolean;                                      // matchMedia(SIDENAV_DRAWER_QUERY).matches; false without window or window.matchMedia (jsdom)
export function isResizing(): boolean;                                           // document has [data-resizing]
export type WidthPlan = { from: number; to: number } | null;
export function widthMotionPlan(input: { from: number; to: number; reduced: boolean; resizing: boolean }): WidthPlan; // null if reduced, resizing or |from−to| < 1
export function isJanky(intervals: readonly number[]): boolean;                  // true when at least two of the first three intervals exceed JANK_FRAME_MS
export function guardJank(animation: Animation, win?: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">): () => void; // samples rAF times until three intervals or the animation ends; finish() when isJanky; returns a stop function
export function animateWidth(el: HTMLElement, plan: { from: number; to: number }): Animation | null;
export function withWidthMotion(el: HTMLElement | null, change: () => void): Animation | null; // from = el width; flushSync(change); to = el width; plan; animateWidth; guardJank
export function animateSlide(el: HTMLElement, from: string, to: string, options?: { fill?: FillMode }): Animation | null; // transform keyframes, same timing; null without el.animate
export function fadeIn(el: HTMLElement | null): Animation | null;               // opacity 0→1, skipped under reduced motion
export function useFadeOnChange(el: HTMLElement | null, key: string): void;     // useLayoutEffect; skips the first key
export function sideNavPanel(): HTMLElement | null;                             // document.querySelector(".astryx-app-shell-sidenav")
```
- `animateWidth` uses `el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: layoutMotionMs(), easing: LAYOUT_MOTION_EASING })`. There is no `pin` argument any more: the nav keeps its width through `nav.css` (`flex-shrink: 0`), and the peek no longer animates a width.
- `animateWidth` and `animateSlide` return null when `el.animate` is missing (jsdom). Callers check reduced motion and resizing first (`widthMotionPlan`, or the peek predicates of §6.2.1).
- `withWidthMotion` must be called only from event handlers or a `setTimeout` callback, because it uses `flushSync`. When `el` is null (below `md` there is no sidebar panel) it runs `change` without animation and returns null. It attaches `guardJank` to the animation it starts.
- `guardJank` is the only frame sampler. It stops on `finish`, `cancel` or after three intervals, so it never outlives the animation.
- Nothing in this module checks the viewport width: decision 132 animates the peek and the fade at every width, and the sidebar panel simply does not exist below `md`. `SIDENAV_DRAWER_QUERY` and `isSidenavDrawer()` are for lane N (decisions 129 and 131). Every `matchMedia` call in P12 shell code goes through `isSidenavDrawer()` or `prefersReducedMotion()`, which check `typeof window.matchMedia === "function"` first, so a jsdom test without a `matchMedia` shim still renders.

**5.3 Stylesheets and the style helper.**
- Lane 0 creates `src/components/styles/nav.css` and `virtual.css`, each with a header comment only, and imports them in `src/app/globals.css` after `paging.css`. Lanes N and V1 fill them.
- Lane 0 creates `src/components/shared/css-vars.ts`: `export function cssVars(vars: Record<string, string | number>): CSSProperties` (the same body as the private copy in `GanttLayout.tsx:40-42`; `import type { CSSProperties } from "react"`). Custom-property keys are not valid `CSSProperties` keys, so every P12 style object that sets a `--tessera-*` name goes through it, with the name as a literal quoted key (`cssVars({ "--tessera-virtual-before": cssPx(before) })`). The convention scanner sees the key inside the call (`scripts/convention-rules.ts:171-180`, `definedTokens`). The two existing private copies (`GanttLayout.tsx:40-42`, `planning/ModulesTimeline.tsx:47`) stay as they are.

**5.4 Icons** (`src/themes/catppuccin/icons.tsx`): `PinIcon = duotoneIcon(PushPin)` and `UnpinIcon = duotoneIcon(PushPinSlash)` (both in `@phosphor-icons/react/dist/csr/`). The options trigger and the sidebar commands reuse `SidebarIcon` (`icons.tsx:262`). The labelled rail needs no icon: it reuses each destination's icon.

### 6. Screens and components

**6.1 Sidebar and shell (lane N)**

`TesseraShell.tsx`:
- **Context.** `ShellContextValue` becomes:
  ```ts
  export type ShellContextValue = {
    navPrefs: NavPrefs;                                          // useNavPrefs(), read inside useShell() by the calling component
    isNavCollapsed: boolean;                                     // isRailShown(navPrefs)
    isNavOpen: boolean;                                          // useNavOpen(), the floating overlay (session only)
    setNavCollapsed: (collapsed: boolean, options?: { animate?: boolean }) => void; // Full ↔ the stored rail kind
    setNavView: (view: NavView, options?: { animate?: boolean }) => void;
    setNavDock: (dock: NavDock) => void;
    setNavOpen: (open: boolean, options?: { focus?: "panel" | "toggle" | "main" | "none" }) => void;
    openCommandBar: (initialQuery?: string) => void;
    openShortcuts: () => void;
    openCreateProject: () => void;
  };
  type ShellContextActions = Omit<ShellContextValue, "navPrefs" | "isNavCollapsed" | "isNavOpen">;
  ```
  The provider's value is `ShellContextActions`, built once with stable callbacks (as `TesseraShell.tsx:87-90` does today). `useShell()` calls `useNavPrefs()` and `useNavOpen()` itself and merges them with the actions (as `:41-46` does today with the collapse flag). No preference or open flag travels through the context value (decision 130, `docs/contracts/ui.md:93`).
- **Callbacks** read the current values from the stores at call time (`getNavPrefs()`, `getNavOpen()`), never from a render closure:
  - `setNavView(view, { animate = true })`: `withWidthMotion(sideNavPanel(), () => setNavPrefs(navViewPatch(view)))`; with `animate: false`, `setNavPrefs(navViewPatch(view))`. Then `refocusNav()`.
  - `setNavCollapsed(collapsed, options)` = `setNavView(collapsed ? getNavPrefs().rail : "full", options)`.
  - `setNavDock(dock)`: `withWidthMotion(sideNavPanel(), () => { setNavPrefs({ dock }); setNavOpenFlag(false) })`, then `refocusNav()`.
  - `setNavOpen(open, { focus })`: `setNavOpenFlag(open)`, then the focus rule below.
- **`refocusNav()`** (decision 128, local to `TesseraShell`): two `requestAnimationFrame`s later, if `document.activeElement` is `null` or `document.body`, focus `#tessera-nav-options` when it exists and has no `[inert]` ancestor, else `#tessera-nav-toggle` when it exists. It does nothing when focus is anywhere else, so a change made from the top bar or the content keeps its focus. This covers the menu, Power K (whose dialog returns focus to an element the nav remount removed) and the drag collapse (the resize handle unmounts).
- **`setNavOpen` focus**, one animation frame later:
  - `"panel"`: the first of `#tessera-sidebar [data-nav-autofocus]:not([disabled])`, `#tessera-sidebar [aria-current="page"]`, `#tessera-sidebar :is(a[href], button:not([disabled]))`;
  - `"toggle"`: `#tessera-nav-toggle`;
  - `"main"`: `#astryx-app-shell-main` (AppShell's skip target, `tabIndex={-1}`);
  - `"none"`: nothing.
- **`mod+b`** (the existing `useHotkeys` entry, `TesseraShell.tsx:74-80`, `allowInInputs` kept): when `isSidenavDrawer()` (§5.2) is true it does nothing. Floating → `setNavOpen(!getNavOpen(), { focus: getNavOpen() ? (focus inside #tessera-sidebar ? "toggle" : "none") : "panel" })`. Docked → `setNavCollapsed(getNavPrefs().display === "full")`.
- **Breakpoint flip:** `const isDrawer = useMediaQuery(SIDENAV_DRAWER_QUERY, false)` (Astryx's hook is `useSyncExternalStore` with a server value, `hooks/useMediaQuery.js:44`), and a `useEffect` on `isDrawer` calls `setNavOpenFlag(false)`, so an overlay opened before the window narrowed never pops open when it widens again. `TesseraShell` is not inside the streamed boundary.

`side-nav-chrome.ts`:
- Pure, exported for the test:
  ```ts
  export type SideNavChromeInput = {
    prefs: NavPrefs; isOpen: boolean; isDrawer: boolean; width: number;
    resizable: SideNavResizable;                                // resize.resizable from useSidebarResize()
    onCollapsedChange: (collapsed: boolean) => void;            // (c) => setNavCollapsed(c, { animate: false }), the drag path
  };
  export type SideNavChrome = {
    collapsible: SideNavCollapsibleConfig; resizable: SideNavResizable | undefined;
    id: "tessera-sidebar"; className: "tessera-sidebar";
    "data-dock": "floating" | undefined; "data-open": "" | undefined; "data-rail": NavRail | undefined;
    inert: boolean; style: CSSProperties | undefined;
  };
  export function sideNavChrome(input: SideNavChromeInput): SideNavChrome;
  export function useSideNavChrome(): SideNavChrome;            // useNavPrefs(), useNavOpen(), useSidebarResize(), useSideNavRenderMode(), useShell() actions
  ```
  `SideNavCollapsibleConfig` is exported by name from `@astryxdesign/core/SideNav` (`SideNavCollapseContext.d.ts:10-16`, `SideNav/index.d.ts:20`). The resizable config type is exported as `ResizableConfig` from `@astryxdesign/core/Resizable` (`Resizable/index.d.ts:10`, `useResizable.d.ts:51`); `side-nav-chrome.ts` declares `type SideNavResizable = Exclude<SideNavProps["resizable"], boolean | undefined>` (`SideNav.d.ts:102`), which is that type, so the chrome stays tied to SideNav's own prop.
- `isDrawer` is `useSideNavRenderMode() !== "default"` (`"drawer-content"` in Tessera's drawer, `AppShell.js:366-372`). It is a context provided by AppShell around each SideNav mount and fixed for that mount, so it is safe inside the streamed boundary. `useAppShellMobile()` is not used here: it is a context from outside the boundary whose value changes after hydration.
- `useSideNavChrome()` is used by **both** `Sidebar` and `SidebarSkeleton`, so they render the same frame.
- Docked (or drawer): `collapsible = { isCollapsed: isRailShown(prefs), onCollapsedChange, hasButton: false }`; `resizable = input.resizable`; `data-rail = isRailShown(prefs) ? prefs.rail : undefined`; no `data-dock`; `inert` false; no `style`. (In the drawer, SideNav renders no `<nav>`, so only `topContent`, children and `footerIcons` matter, `SideNav.js:295-312`.)
- Floating and not drawer: `collapsible = { isCollapsed: false, hasButton: false }`, `resizable` undefined, no `data-rail`, `data-dock="floating"`, `data-open={isOpen ? "" : undefined}`, `inert={!isOpen}`, `style={cssVars({ "--tessera-nav-float-width": `${width}px` })}` (§5.3). `width` is `resizable.defaultWidth`. A non-resizable SideNav uses `style` as given (`SideNav.js:325-328`).

`Sidebar.tsx`:
- It spreads the chrome onto `SideNav` (the `key` stays `resize.key`, `aria-label="Work"` stays).
- It adds `footerIcons={isDrawer ? undefined : <SidebarOptionsMenu />}`.
- Both "New work item" controls (`NewItemButton` in `RailParts.tsx:28-45`: the full `Button` and the rail `IconButton`) get `data-nav-autofocus=""`.
- When floating, not drawer, closed and `useMediaQuery("(hover: hover)", false)`, it renders before the SideNav `<VStack className="tessera-nav-edge" aria-hidden {...edgeHandlers} />`.
- It calls `useFloatingNav({ panelId: "tessera-sidebar" })` (new `use-floating-nav.ts`), which returns `panelHandlers` (spread on SideNav: `onPointerEnter`, `onPointerLeave`, `onBlur`, `onKeyDown`) and `edgeHandlers` (`onPointerEnter`, `onPointerLeave`). While floating and open, the hook:
  - **pointer leave:** starts a `FLOAT_CLOSE_DELAY_MS` timer that a pointer enter cancels. When it fires, it closes with reason `"pointer"` unless `floatingStaysOpen(liveState())`;
  - **blur** (React `onBlur` bubbles like `focusout`): one animation frame later, it closes with reason `"blur"` when `shouldCloseOnFocusOut(...)` is true. The inputs are: focus is not inside the panel; `event.relatedTarget` is not inside `#tessera-nav-toggle`; `isTogglePressPending(performance.now())` is false; and `floatingStaysOpen(liveState())` is false;
  - **Escape** (`onKeyDown`, not when an inner menu handled it, i.e. `!event.defaultPrevented`): closes with reason `"escape"`;
  - **outside press:** a document `pointerdown` listener (capture). A press outside the panel, the edge strip and `#tessera-nav-toggle` closes with reason `"outside"`, unless a toggle press is pending or `floatingStaysOpen(liveState())`;
  - **route:** a `usePathname()` change closes with reason `"route"`.
  - `liveState()` reads the DOM at that moment: `focusInside` (`panel.contains(document.activeElement)`), `menuOpen` (`panel.querySelector(MENU_OPEN_SELECTOR) !== null`: a popup trigger only, so an expanded favourites folder, which carries a plain `aria-expanded="true"`, does not hold the panel open; decision 129), `dragging` (`document.body.classList.contains("tessera-dragging")`) and `modalOpen` (`document.querySelector("dialog[open]") !== null`).
  - Every close calls `setNavOpen(false, { focus: closeFocusTarget(reason, focusWasInside) })`.
  - While closed, the edge strip's pointer enter starts a `FLOAT_OPEN_DELAY_MS` timer that its pointer leave cancels. When it fires, it opens with `{ focus: "none" }`.

`RailParts.tsx` and `FavoritesSection.tsx` (the labelled rail, decision 128):
- `RailItem` (`RailParts.tsx:67-76`) passes `data-rail-label={props.label}` to its `SideNavItem` in every state. It reads no preference: whether the name shows is CSS on the nav's `data-rail`, so switching between the two rails re-renders nothing in the rows.
- The folder `SideNavItem` in `FavoritesSection.tsx:134` passes `data-rail-label={folder label}` the same way.
- Project rows keep `aria-label={`${project.name} ${count}`}` (`Sidebar.tsx:248`); their `data-rail-label` is the name only (`label`), so the count is never shown under the icon.
- `NewItemButton`, `ExpandedOnly` and `RowActions` are unchanged. The rail tooltips stay.

`floating-nav.ts` (pure, tested; the toggle-press flag is module state with an explicit clock):
```ts
export const FLOAT_OPEN_DELAY_MS = 120;
export const FLOAT_CLOSE_DELAY_MS = 300;
export const TOGGLE_PRESS_MS = 500;
export const MENU_OPEN_SELECTOR = '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]'; // liveState().menuOpen (decision 129)
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

`SidebarOptionsMenu.tsx`: `DropdownMenu alignment="start" hasChevron={false} menuWidth={240} renderTrigger` (`DropdownMenu.d.ts:132, 140, 148, 162`) with `IconButton {...triggerProps} id="tessera-nav-options" label="Sidebar options" variant="ghost" size="sm" tooltip="Sidebar options" icon={<Icon icon={SidebarIcon} />}`. It reads `useShell()`.
- **Docked:**
  - `DropdownMenuRadioGroup label="Show" value={navView(navPrefs)} onChange={(v) => setNavView(v)}` (`DropdownMenuRadioGroup.d.ts:19-31`) with `DropdownMenuRadioItem`s `full` "Full sidebar", `labels` "Icons and labels" and `icons` "Icons only" (`DropdownMenuRadioItem.d.ts:27-31`); `onChange` narrows the string with a guard before calling `setNavView`;
  - `DropdownMenuDivider`;
  - `DropdownMenuItem label="Undock sidebar" description="Show it over the page when you need it" icon={UnpinIcon}` (`DropdownMenuItem.d.ts:31-35`), which calls `setNavDock("floating")`. `refocusNav()` then lands on `#tessera-nav-toggle`, because the options button is now inside the inert closed panel.
- **Floating:** only `DropdownMenuItem label="Dock sidebar" icon={PinIcon}`, which calls `setNavDock("docked")`. `refocusNav()` lands on the remounted options button.
- In the rails the button sits centred in the footer (Astryx's collapsed footer row, `SideNav.js:378-389`).

`TopBar.tsx`:
- Desktop and docked: `SideNavCollapseButton` as today (`:180`), fed by `useShell()`: `collapsible={{ isCollapsed: isNavCollapsed, onCollapsedChange: (c) => setNavCollapsed(c) }}`.
- Desktop and floating: `IconButton id="tessera-nav-toggle" label={isNavOpen ? "Hide sidebar" : "Show sidebar"} variant="ghost" size="sm" tooltip={`${isNavOpen ? "Hide" : "Show"} sidebar (mod+b)`} icon={<Icon icon={SidebarIcon} />} aria-expanded={isNavOpen} aria-controls="tessera-sidebar"`, in the same place and size (28 × 28 at (8, 10), measured), so `round5.spec.ts:185-210`'s hit-area rule holds for it too.
  - `onPointerDown`: `markTogglePress(performance.now())`.
  - `onClick`: `clearTogglePress()`, then `setNavOpen(!isNavOpen, { focus: isNavOpen ? "toggle" : "panel" })`.
- Mobile (`useAppShellMobile().isMobile`, `:173`; the top bar is outside the streamed boundary): unchanged (the AppShell drawer toggle).

`SidebarSkeleton.tsx`: renders `SideNav {...useSideNavChrome()} key={resize.key} aria-label="Work"`, so a stored rail shows as the rail (60 or 48 px) while the sidebar streams. It renders no `footerIcons`.

`ShortcutsDialog.tsx`: remove `EXTRA_GLOBAL` (`:44`) and its render branch (`:64-66`); the registry entry (below) is now the only `mod+b` row. Its `description` shows the note through `shortcutHint` (`command-source.ts:163-165`).

`nav.css` (lane N; all values tokens). The selectors reach Astryx theme classes (`astryx-app-shell-sidenav`, `astryx-side-nav-item`, `astryx-side-nav-section`) only through our own class `tessera-sidebar` (directly or inside `:has()`), the same rule `work-items.css` follows for `astryx-collapsible-trigger` (ui.md "Work items screen"). These are per-instance layout rules, not component restyles, so they stay out of `catppuccinTheme.ts`. Lane 0 records this in the ui.md P12 section. The `:has()` rules match inside the sidebar panel only (about 100 elements), not a list scroller (field guide `performance.md:16`).
```css
/* Decision 132 (1): while docked, the panel clips its width animation and the nav keeps its own width
   (without flex-shrink: 0 the nav is squeezed to the panel's width on every frame). */
.astryx-app-shell-sidenav:has(.tessera-sidebar:not([data-dock])) { overflow-x: hidden; }
.tessera-sidebar:not([data-dock]) { flex-shrink: 0; }

/* Decision 128: the Icons and labels rail (60px): the collapsed rail, wider, with the name under each icon. */
.tessera-sidebar[data-rail="labels"] { width: calc(var(--spacing-12) + var(--spacing-3)); }
.tessera-sidebar[data-rail="labels"] > * { padding-inline: var(--spacing-1); }
.tessera-sidebar[data-rail="labels"] .astryx-side-nav-section { align-self: stretch; }
.tessera-sidebar[data-rail="labels"] .astryx-side-nav-item[data-rail-label] {
  width: 100%; height: auto; min-height: var(--spacing-11);
  flex-direction: column; justify-content: center; gap: var(--spacing-0-5);
  padding-block: var(--spacing-1); padding-inline: var(--spacing-0-5);
}
.tessera-sidebar[data-rail="labels"] .astryx-side-nav-item[data-rail-label]::after {
  content: attr(data-rail-label);
  max-width: 100%;
  font-size: var(--font-size-xs); line-height: var(--text-heading-6-leading); font-weight: var(--font-weight-medium);
  text-align: center; overflow-wrap: break-word;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}

/* Decision 129: the floating panel. */
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
The labelled-rail rules were measured in the production build (2026-10-29 refresh): 60 px rail, 52 px tiles at x = 4, 44 px one-line and 58 px two-line tiles, the "New work item" button still centred, identical in Latte and Frappé.

Shortcuts and commands (lane N):
- `shortcuts.ts`:
  - `"sidebar.toggle"` joins `ShortcutId` (`:34-72`), and `{ id: "sidebar.toggle", label: "Collapse or expand the sidebar", note: "Shows or hides it while undocked", keys: "mod+b", group: "Global" }` goes after `assistant.toggle` (`:100`);
  - `CommandId` (`:75`) gains `SidebarCommandId`.
- `useShortcuts.ts:120`: `DELEGATED` gains `"sidebar.toggle"` (the keydown path returns early for it, `:352`).
- New `shell/sidebar-commands.ts` (not `command-source.ts`, which is 548 lines): `buildSidebarCommands(prefs: NavPrefs, isDrawer: boolean): CommandSearchItem[]` returns the decision 131 commands (group "Settings", the keywords of decision 131) for the current state, and `[]` when `isDrawer`.
- `CommandBar.tsx`:
  - the command getter (`:222-232`) appends `...buildSidebarCommands(getNavPrefs(), isSidenavDrawer())`, read when the palette asks, like `readProjectFeatures`;
  - `onSelect` (next to the theme branch, `:351-355`): when `sidebarCommandPatch(id)` is not null, `window.setTimeout(() => …, 0)` runs `setNavView` for `sidebar.full|labels|icons` and `setNavDock` for `sidebar.float|dock` (from `useShell()`); `sidebar.float` leaves the overlay closed. `CommandBar` does not call `useShell()` today, and `useShell()` throws outside `TesseraShell` (`TesseraShell.tsx:41-46`), so `tests/ui/assistant-undo-palette.test.ts`, which renders `CommandBar` on its own (`:32`, `:102`), gains a `vi.mock("@/components/shell/TesseraShell", …)` stub of `useShell` with the new fields, as `tests/ui/sidebar-links.test.ts:20` does (lane N);
  - `commandIcon` (`:406-415`) returns `SidebarIcon` for ids starting with `SIDEBAR_COMMAND_PREFIX`.

Tests moved from the collapse store (lane N): `tests/ui/nav-collapse-store.test.ts` becomes `tests/ui/nav-prefs-store.test.ts` with the same four cases on `navPrefsStore` (server snapshot stays the defaults after a set; no notification for an unchanged set; a consumer hydrates against the server value after the value changed; the negative control with a context value). `tests/ui/shell-collapse-wiring.test.ts` keeps its three cases, resetting with `setNavPrefs(DEFAULT_NAV_PREFS)` and `localStorage.clear()` instead of `setNavCollapsed(false)`, and gains one case: `useShell().isNavOpen` after an early `mod+b` while floating. Then `nav-collapse-store.ts` is deleted.

**6.2 Motion surfaces**

- Sidebar: covered by 6.1 (`withWidthMotion` on `sideNavPanel()`, with the jank guard).
- Peek (lane M): see 6.2.1.
- Layout fade (lane V1, in `WorkItemsScreen`): `useFadeOnChange(scroller, `${display.layout}|${display.calendar.layout}|${display.gantt.zoom}`)`.

6.2.1 Peek motion (lane M):
- **What moves.** Only the card. The `LayoutPanel` (`PeekHost.tsx:289`) mounts at its final width, as today, so the list re-lays out once; the `Card` (`:290`) slides with `animateSlide(card, from, to)` (§5.2). Slide offset: `translateX(calc(100% + ${pad}px))`, where `pad` is the panel's computed `padding-inline-end` in px (4 px, `padding={1}`, measured), so the card starts and ends fully outside the panel; the panel's computed `overflow-x` is `clip` (`isScrollable={false}`, measured), so the card is clipped and the panel cannot be scrolled by a focus call. The percentage is relative to the card's own width, so it stays right when the cover check (below) widens the panel in the next commit.
- **`peek-motion.ts` (pure):**
  - `peekOpenAnimates({ wasOpen, isOpen, isModal, modeChanged, reduced })` is true only for `!wasOpen && isOpen && !isModal && !modeChanged && !reduced`;
  - `peekCloseAnimates({ isModal, reduced, isHidden })` is true for `!isModal && !reduced && !isHidden`;
  - `closeOutcome({ ended: "finished" | "cancel", hrefAtClose, hrefNow }): "navigate" | "stay"` is `"navigate"` only for `ended === "finished" && hrefNow === hrefAtClose`;
  - `slideOffset(padPx: number): string` returns `translateX(calc(100% + ${Math.max(0, Math.round(padPx))}px))`.
- **`PeekHost.tsx` state:** a `cardRef` on the Card, merged with `watchPanelAndCover` (the Card's only ref today); `wasOpen` and `prevModal` refs, initialised from the **first render's** `isOpen` and `isModal` and updated in a layout effect, so a reload or deep link with `?peek=` never animates; `motionRef` (`{ animation, kind: "open" | "close", hrefAtClose? } | null`); and `closingHref` state (`string | null`), set in `close()` and cleared only in the animation's promise callbacks, never in an effect body (`react-hooks/set-state-in-effect` also covers layout effects, decision 134). `isClosing` is derived during render, `closingHref !== null && closingHref === here`, so it turns false by itself once the URL changes. `isClosing` puts `inert` and `data-motion="closing"` on the existing LayoutPanel (`LayoutPanel.js:176` spreads both) and disables the Escape hotkey (`isDisabled: !isOpen || isModal || isClosing`, `:234`).
- **Never remount the detail.** Motion changes only props on the existing LayoutPanel and the WAAPI animations on the Card. Lane M does not add a `key` to the LayoutPanel, the Card or `PeekSlot`, does not wrap or reorder them, and does not render the side panel conditionally on motion state: it stays mounted until `peek` is null, as today (`:285-286`). The portal target (`:160-165`, `:325`) and `PeekDetail key={peek.id}` (`:279`) are unchanged, so `PeekDetail`'s once-per-mount choice (`peek-detail-lazy.tsx:69-72`) holds.
- **Open** (a `useLayoutEffect` on `[isOpen, isModal]`, declared **after** `useCoverFocus` at `:275`): when `peekOpenAnimates(...)` is true and `cardRef.current` exists, start `animateSlide(card, slideOffset(pad), "none")` and store it in `motionRef` (kind `"open"`). Nothing else changes:
  - **skeleton then detail:** if the chunk is not loaded yet, the card first holds `PeekSkeleton` (from `next/dynamic`, `peek-detail-lazy.tsx:60`) and the detail replaces it inside the same portal node when the chunk arrives (at least 300 ms later, React's fallback hold, against a 280 ms slide). So the swap lands in the card after or during the slide, usually just after it ends; the slide does not restart, because `isDetailMounted` (`:273`) is not a dependency of this effect. If the chunk is loaded, the detail is there from the first frame;
  - **focus (decision 11):** `useCoverFocus` keeps its own timing. In cover mode the list is inert in the same commit as `isPanelCover` turns true (`:271`, `:302`), and focus moves into the detail once `onMountedChange(true)` has run (`:273-275`), which may be during the slide; the clipped panel and the card's vertical-only scroller (`detail.css:27-31`) mean that focus call cannot shift anything. Beside the list (no cover) focus stays where it was, as today.
- **Close** (`close()`, `:198-204`):
  1. if `motionRef.current?.kind === "close"`, return (a second Escape or Close click does nothing);
  2. if an open slide is running, cancel it first (the card returns to rest);
  3. with `const card = cardRef.current` (in `PeekHost`, `panel` is the `useResizable` result, `PeekHost.tsx:236`, not an element): if `!peekCloseAnimates({ isModal, reduced: prefersReducedMotion(), isHidden: card === null || !card.isConnected || card.offsetParent === null })`, navigate at once with today's code. Lane M adds no other new variable named `panel`;
  4. otherwise capture `hrefAtClose = here`, start `animateSlide(card, "none", slideOffset(pad), { fill: "forwards" })`. If that returns null (jsdom), navigate at once. Else set `motionRef` (kind `"close"`, `hrefAtClose`) and `setClosingHref(hrefAtClose)`. The panel becomes `inert`, so focus inside it falls to `<body>`;
  5. `animation.finished` resolves → `closeOutcome({ ended: "finished", hrefAtClose, hrefNow: currentHref(window.location.pathname, window.location.search) })`. On `"navigate"` it runs today's navigation, computing `peekHref`, `readPeekPush` and `closesWithBack(...)` at that moment (not at click time). It keeps `motionRef` and `closingHref` set: the card stays out (`fill: "forwards"`) and Escape stays off until the URL has changed (the router's replace or Back can take a server round trip; clearing earlier would let a second Escape navigate twice). On `"stay"` it cancels the animation (the card returns) and clears `motionRef` and `closingHref`;
  6. `animation.finished` rejects (cancel) → never navigate; clear `motionRef` and `setClosingHref(null)` (a promise callback, not an effect body).
  - **When the URL changes** (a layout effect on `here`): if `motionRef` holds a close whose `hrefAtClose` differs from `here`, it is done: when the peek is now closed the panel has unmounted with the card; when a peek is still open (the URL moved to another item by other means), cancel the animation so the card returns, and clear `motionRef`. The effect touches only `motionRef` and `animation.cancel()`; it sets no state. `isClosing` is already false, because `here` no longer equals `closingHref`, and the cancel's rejection callback clears `closingHref`.
  - **Focus after the close (decision 11):** unchanged. The commit that drops `peek` removes the list's `inert` (`:271`, `:302`) and the panel together, and `useCoverFocus`'s layout effect then sees `closes` with focus on `<body>` and returns focus to the list's opener (`peek-cover.ts:83-105`). This holds beside the list too, because the inert closing panel had already released focus to `<body>`.
- **Hide and unmount:** the layout effect's cleanup cancels a running open or close animation and clears `motionRef`; it sets no state (the cancel's rejection callback clears `closingHref`). Layout-effect cleanups run both when Next hides the route (`<Activity>`) and on unmount, so a close started just before the user clicked a sidebar link can never pull them back. A cancelled `fill: "forwards"` animation leaves no transform behind.
- **No animation:** browser Back (no handler runs; the panel unmounts with the URL), a mode switch (side ↔ modal; `prevModal` differs), the stored mode or width arriving after hydration (`loadPeekPrefs`, `resize(width)` at `:244-252`), and a peek switching items (`openItem`, `:205-209`; `isOpen` stays true, the detail remounts by its `key` as today).

**6.3 Virtual scrolling (lanes V1, V2)**

Points marked **re-verify** depend on `@tanstack/react-virtual` behaviour that was read from its published typings, not from installed code. V1.1 checks each against `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts` (and the `.js` where it says behaviour) after the install, and reports line numbers (§7).

`src/components/virtual/` (V1):
- `virtual-config.ts`:
  - thresholds: `VIRTUAL_LIST_MIN = 30`, `VIRTUAL_TABLE_MIN = 30`, `VIRTUAL_GANTT_MIN = 40`, `VIRTUAL_BOARD_MIN = 8`;
  - `type VirtualKind = "list" | "table" | "board" | "gantt"`;
  - `OVERSCAN: Record<VirtualKind, number> = { list: 4, table: 4, board: 2, gantt: 6 }` (live);
  - `INITIAL_OVERSCAN: Record<VirtualKind, number> = { list: 2, table: 2, board: 1, gantt: 4 }` (first paint);
  - `ESTIMATE: Record<VirtualKind, number> = { list: 44, table: 37, board: 136, gantt: 32 }`; `BOARD_GAP_ESTIMATE = 8` (the cards stack is `VStack gap={2}`);
  - `INITIAL_VIEWPORT = 768`; `INITIAL_BOARD_BODY = 528`;
  - `START = { listPadding: 8, groupBand: 40, groupGap: 8, listFooter: 44, quickAdd: 36, tableHead: 30, boardBodyPadding: 8, ganttBody: 0 }`.
  The comment above `ESTIMATE` and `START` names the refresh measurement (1280 px, Latte and Frappé, small and 10k fixture) and says they are corrected by measurement after the first paint.
- `virtual-math.ts` (pure, tested). TanStack item `start`/`end` **include** `scrollMargin`, while `getTotalSize()` already **excludes** it (last `end` − `scrollMargin` + `paddingEnd`) (**re-verify** both). The helpers below subtract it exactly once:
  - `shouldVirtualize(count, min)` (`count > min`);
  - `offsetWithin(anchorTop, scrollerTop, scrollTop, scrollerClientTop)` = `anchorTop − scrollerTop + scrollTop − scrollerClientTop` (the anchor's offset in the scroller's content, from two `getBoundingClientRect()` reads);
  - `estimateStarts(sections: readonly { rows: number; isOpen: boolean; hasBand: boolean; hasFooter: boolean; hasQuickAdd: boolean }[], kind: "list" | "table"): number[]`: each section's row-list start in the scroller content, from `START` and `ESTIMATE`. List: `listPadding`, then per section `groupBand` (when `hasBand`), the rows when open, `listFooter`, `quickAdd`, and `groupGap` between sections. Table: one section starting at `tableHead`;
  - `initialRange(input: { start: number; count: number; size: number; gap: number; viewport: number; overscan: number }): { first: number; last: number } | null`: the rows of `[0, viewport)` at scroll top 0, plus `overscan` after them. It is `null` when `start ≥ viewport` or `count = 0`; otherwise `first = 0` and `last = min(count − 1, ceil((viewport − start) / (size + gap)) − 1 + overscan)`;
  - `isNearViewport(input: { start: number; size: number; scrollTop: number; viewport: number; margin: number }): boolean`: the anchor `[start, start + size]` intersects `[scrollTop − margin, scrollTop + viewport + margin]`;
  - `withKept(base: readonly number[], keep: readonly number[], count: number): number[]`: the sorted, de-duplicated union, limited to `0 … count − 1` (the `rangeExtractor` result);
  - `partitionKept(indexes: readonly number[], first: number, last: number): { before: number[]; window: number[]; after: number[] }`: `first`/`last` are the bounds of TanStack's default range;
  - `paddings(window: readonly { start: number; end: number }[], totalSize: number, scrollMargin: number): { before: number; after: number }`: `before = window[0].start − scrollMargin`, `after = totalSize − (window.at(-1).end − scrollMargin)`, both clamped at 0. An empty window gives `{ before: 0, after: totalSize }`;
  - `tableSegments(rows: readonly { index: number; start: number; end: number }[], totalSize: number, scrollMargin: number): ({ kind: "row"; index: number } | { kind: "spacer"; id: string; height: number })[]`. The input is every rendered row (window and kept) in index order. The output inserts a spacer before the first row (`virtual:top`), between rows whose indexes are not adjacent (`virtual:gap-<n>`, numbered in order) and after the last row (`virtual:bottom`). A spacer's height is the uncovered distance, and spacers under 0.5 px are left out;
  - `isOpenEnd(lastRenderedIndex: number, count: number)`: `lastRenderedIndex < count − 1`;
  - `NAV_KEYS = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]` and `isNavKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean })` (a listed key, no modifier);
  - `cssPx(n)` (`"${Math.max(0, Math.round(n))}px"`).
- `roving.ts`: `stampTabStops(root: HTMLElement, selector: string)`. It keeps the first item that has `tabindex="0"` and sets every other item to `-1`. If none has it, the first item gets `0`. This is Astryx's rule (`useListFocus.js:294-313`), applied after a virtual commit (tested under jsdom). Freshly mounted rows have no `tabindex` attribute, so a kept row that holds `"0"` keeps the stop wherever it sits in DOM order.
- `print-store.ts`: `usePrinting(): boolean` through `useSyncExternalStore` (server snapshot `false`). `beforeprint` emits inside `flushSync`; `afterprint` and a `matchMedia("print")` change listener emit too. The listeners are attached on the first subscribe and detached on the last unsubscribe.
- `VirtualScrollerProvider.tsx` (the scroller store; no state set in an effect body):
  ```ts
  export type ScrollerStore = {
    subscribe: (listener: () => void) => () => void;
    viewport: () => number;                                     // scroller clientHeight; the provider's initialViewport until measured
    isMeasured: () => boolean;
    offsetOf: (anchorId: string) => number | undefined;         // offsetWithin(...) of the anchor
    gapOf: (anchorId: string) => number;                        // computed row-gap in px, 0 for "normal"
    scrollTop: () => number;                                    // read live, not a subscription source
    scrollPaddingStart: () => number;                           // computed scroll-padding-block-start of the scroller in px (0 for "auto")
    isNear: (anchorId: string) => boolean;                      // near-viewport gate (decision 135); true until measured
    virtualizes: boolean;                                       // false for the default store (no provider) and for a nested provider under it
    register: (anchorId: string, el: HTMLElement, marginPx: number) => () => void; // from the anchor's ref callback; schedules a measure
  };
  export function VirtualScrollerProvider(props: { scroller: HTMLElement | null; initialViewport?: number; children: ReactNode }): ReactNode;
  export function useScrollerStore(): ScrollerStore;            // the nearest provider, else DEFAULT_SCROLLER_STORE (virtualizes false)
  export function useScrollerViewport(): number;                // useSyncExternalStore; server snapshot = initialViewport
  export function useScrollerMeasured(): boolean;               // server snapshot false
  export function useAnchorOffset(anchorId: string, estimate: number): number; // server snapshot and unmeasured = estimate
  export function useAnchorGap(anchorId: string, estimate: number): number;
  export function useAnchorNear(anchorId: string): boolean;     // useSyncExternalStore; server snapshot true
  export function useScrollPaddingStart(): number;              // useSyncExternalStore; server snapshot 0
  ```
  - **No provider.** `useScrollerStore()` without a provider returns a module constant `DEFAULT_SCROLLER_STORE` whose `virtualizes` is false and which never measures. `useVirtualRows` then returns every row as `window`, exactly as below its threshold. `VirtualScrollerProvider` reads the store above it and sets `virtualizes` to that store's value when it is nested (the board column provider), and to true at the top (the screen). So `board-table-fixes`, `list-visual-fixes`, `no-results`, `gantt-layout` and `gantt-connectors`, which render a layout without the screen (`tests/ui/*.test.ts`), render every row and keep passing unchanged.
  - **Near.** The provider's `useEffect` also adds a passive `scroll` listener on `scroller` (subscribe only, no state). It is coalesced to one rAF. It recomputes, for every registered anchor, `isNearViewport({ start: offset, size: height, scrollTop, viewport: clientHeight, margin: marginPx })` from the anchor's offset and border-box height of the last measure pass and the live `scrollTop`, and emits only when some anchor's boolean flipped. A measure pass recomputes it too. So a group entering from below renders its first rows in the frame it comes near, and a group scrolled past drops its rows, whether or not TanStack's range changed.
  - The store lives in a `useState(() => createScrollerStore(initialViewport))` initialiser. A ResizeObserver on `scroller` and `scroller.firstElementChild` is attached in a `useEffect`, whose body only subscribes (it sets no state).
  - `measure()` is coalesced to one rAF. It reads the scroller's rect, `scrollTop`, `clientTop`, `clientHeight` and computed `scroll-padding-block-start` (the same token-based value as `work-items.css:271-273, 429-431`, so the virtualizer and native focus scrolling use one number), plus each registered anchor's rect and computed `row-gap`. It returns without a change when `scroller.clientHeight === 0` or `scroller.offsetParent === null` (a hidden route). It emits only when some value changed, and every selector returns a primitive, so a subscriber re-renders only when its own number changes.
  - The store's first snapshot on the client equals the server snapshot (`isMeasured` false, `viewport` = `initialViewport`), so hydration matches; the first `measure()` after hydration switches to measured values.
- `use-virtual-rows.ts`: the only `@tanstack/react-virtual` import.
  ```ts
  export type UseVirtualRowsOptions = {
    anchorId: string;                                              // unique in its provider: "list:<groupKey>", "table", "gantt", "board:<container>"
    kind: VirtualKind;                                             // picks ESTIMATE, OVERSCAN, INITIAL_OVERSCAN
    count: number;
    getKey: (index: number) => string;                             // stable: the caller's useCallback over its items array; passed to TanStack unchanged
    isEnabled: boolean;                                            // the caller's threshold result
    estimateStart: number;                                         // from estimateStarts(); used until measured
    fixedSize?: number;                                            // gantt: the measured row height; no per-row measuring
    keepIndexes?: readonly number[];                               // always rendered (gantt: the dragged bar's row)
  };
  export type VirtualRow = { index: number; key: string; start: number; size: number; keptTop?: number }; // start relative to the anchor; keptTop only on kept rows
  export type VirtualRowsResult = {
    isEnabled: boolean;                                            // false below the threshold and while printing
    anchorRef: (el: HTMLElement | null) => void;                   // stable; registers the anchor with the store
    anchorClassName: string | undefined;                           // "tessera-virtual" when enabled
    anchorStyle: CSSProperties | undefined;                        // cssVars({ "--tessera-virtual-before": …, "--tessera-virtual-after": … })
    anchorOpenEnd: "" | undefined;                                 // for data-virtual-open-end
    totalSize: number;
    scrollMargin: number;
    keptBefore: readonly VirtualRow[];
    window: readonly VirtualRow[];                                 // all rows when disabled
    keptAfter: readonly VirtualRow[];
    rendered: readonly VirtualRow[];                               // keptBefore + window + keptAfter, in index order (the table)
    measureRef: ((el: Element | null) => void) | undefined;        // stable identity; undefined until isOn && isMeasured, and always with fixedSize
    onFocusCapture: (event: FocusEvent<HTMLElement>) => void;      // sets the kept-row state from closest("[data-index]")
    isKept: (index: number) => boolean;
    scrollToIndex: (index: number) => void;                        // align "auto"
  };
  export function useVirtualRows(options: UseVirtualRowsOptions): VirtualRowsResult;
  ```
  - **Phases.** Let `isOn = isEnabled && !usePrinting()` and `isMeasured = useScrollerMeasured()`. With `isOn` false the hook returns every row as `window` (no class, no style, no padding). With `isOn` and not `isMeasured` (server, hydration, the first client frames), it returns `initialRange({ start: estimateStart, count, size: fixedSize ?? ESTIMATE[kind], gap, viewport: useScrollerViewport(), overscan: INITIAL_OVERSCAN[kind] })`. Starts are `i × (size + gap)`, `before` is 0 and `after` is the estimated rest. With `isOn` and `isMeasured` it returns TanStack's items, subject to the near-viewport gate.
  - `useVirtualizer` is called with `count: isOn ? count : 0`, `enabled: isOn && isMeasured`, `getScrollElement: () => scroller`, `estimateSize: () => fixedSize ?? ESTIMATE[kind]`, `overscan: OVERSCAN[kind]`, `getItemKey: getKey` (the caller's stable function itself, never a new arrow: virtual-core memoises its measurements on `getItemKey` (3.13.23 `index.js:408-415`), so a new function per render rebuilds all of them, O(loaded rows), on every range change), `scrollMargin: useAnchorOffset(anchorId, estimateStart)`, `gap: useAnchorGap(anchorId, kind === "board" ? BOARD_GAP_ESTIMATE : 0)`, `initialRect: { width: 0, height: useScrollerViewport() }`, **`initialOffset: () => scroller?.scrollTop ?? 0`**, `scrollPaddingStart: useScrollPaddingStart() + (kind === "table" ? theadHeight : 0)` (decision 136; `theadHeight` is the anchor's `tbody.previousElementSibling` height read in the anchor's ref callback and in each measure pass, 0 until measured), `rangeExtractor` and `measureElement` (below). **Why `initialOffset`:** when an instance becomes enabled, virtual-core attaches its observers and calls `_scrollToOffset(this.getScrollOffset())`, and `getScrollOffset()` falls back to `options.initialOffset` (default 0) while its `scrollOffset` is null, which a disabled instance resets (read in virtual-core 3.13.23, `dist/esm/index.js:322-362, 373-379`). Every anchor shares `.tessera-wi-scroller`, so without it, expanding a collapsed group, crossing the threshold through quick-add or Show more, or the end of printing would jump the whole list to the top. A disabled instance also clears its size cache (`:437-445` there), so rows re-measure from the estimates after printing. **Re-verify:** the option names and types; that changing `scrollMargin` or `gap` re-computes the measurements; that `enabled` flipping from false to true attaches the observers, computes a range and keeps `scrollTop` (§7 points 8, 9, 12).
  - **Near-viewport gate.** When measured, the window is empty (kept rows still render) unless `useAnchorNear(anchorId)` is true. The anchor registers with `marginPx = OVERSCAN[kind] × (fixedSize ?? ESTIMATE[kind])`. The gate is a store value, not a render-time reading of the virtualizer's offset, because TanStack re-renders its host only when `isScrolling`, `range.startIndex` or `range.endIndex` changes (`maybeNotify`, virtual-core 3.13.23 `index.js:283-304`), and it clamps the range of an anchor wholly above or below the viewport to its first or last indexes (**re-verify** in `calculateRange`). A render-time check would go stale: a group entering from below would show a blank first row until the range moved, and a group scrolled past would keep its last rows mounted.
  - **No ref is read or written during render** (`react-hooks/refs`, decision 134). The approach: the kept row is React state, and the range bounds are derived from the instance's public `range`.
  - **Kept index (state):** `const [kept, setKept] = useState<{ key: string; index: number } | null>(null)`. `onFocusCapture` (an event handler) reads the row from `closest("[data-index]")` and calls `setKept` only when the key differs, so focus moving inside one row renders nothing. Focus leaving the list does not clear it: the last-focused row is also the opener the peek returns focus to (`useCoverFocus`). During render a `useMemo` over `[kept, count, getKey]` resolves the index: `getKey(kept.index) === kept.key` keeps it, else it scans `0 … count − 1` once; when the key is gone, nothing is kept.
  - **`rangeExtractor`:** a `useCallback` over `[keepList, count]`, where `keepList = [...keepIndexes, keptIndex].filter(isIndex)` is a `useMemo`: `(range) => withKept(defaultRangeExtractor(range), keepList, count)`. It writes nothing. `defaultRangeExtractor` is exported by `@tanstack/virtual-core` and re-exported by `@tanstack/react-virtual` (**re-verify**). `getVirtualItems()` then includes the kept rows.
  - **Bounds (derived):** `const r = virtualizer.range` (public, **re-verify** point 6); `first = r ? Math.max(0, r.startIndex − OVERSCAN[kind]) : 0` and `last = r ? Math.min(count − 1, r.endIndex + OVERSCAN[kind]) : −1`, the same bounds `defaultRangeExtractor` uses. `partitionKept(indexes, first, last)` splits the items with them. Kept rows get `keptTop = item.start − scrollMargin`.
  - **Measurement guard:** `measureElement: (el, entry, instance) => { const size = measureElement(el, entry, instance); if (size > 0 || (el as HTMLElement).offsetParent !== null) return size; return instance.measurementsCache[instance.indexFromElement(el)]?.size ?? ESTIMATE[kind]; }`, using virtual-core's exported default `measureElement` (**re-verify** the signature, `indexFromElement` and `measurementsCache`). Every rendered row, kept rows and the board placeholder included, carries `data-index`, because TanStack warns and returns −1 without it (**re-verify**).
  - **`measureRef`** is the virtualizer's own `measureElement` method, passed through unchanged, so its identity is the instance's (**re-verify** that it is a stable bound function; if not, wrap it once in a `useCallback` over the instance). It is `undefined` until `isOn && isMeasured`: rows of the initial window (server, hydration, the first client frames) get no ref, because a node handed to an instance that is still disabled may be neither observed nor cached in some virtual-core versions, and a memo row with a stable ref is never handed to it again. When the store reports measured, the prop changes once from `undefined` to the function, so each mounted row re-renders once and React attaches the ref. That one re-render per initial row is accepted. After that rows keep the same function, so a memo row is not re-rendered by it.
  - TanStack's `useFlushSync` stays at its default (§12).

Token gate: every `--tessera-*` name that `nav.css` or `virtual.css` reads (`--tessera-nav-float-width`,
`--tessera-virtual-before`, `--tessera-virtual-after`, `--tessera-virtual-top`, `--tessera-virtual-spacer`) is set in
TS as a **literal quoted key** inside `cssVars({ … })` (§5.3), never through a computed key or a template name. That
way `scripts/convention-rules.ts` `definedTokens` (`:171-180`) sees it, and TypeScript accepts the custom-property key.

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
- **Screen (V1).** `WorkItemsScreen.tsx`:
  - `const [scroller, setScroller] = useState<HTMLElement | null>(null)` on the scroller `LayoutContent` ref (`:407`). The ref callback sets state, which is allowed (it is not an effect);
  - `<VirtualScrollerProvider scroller={scroller}>` wraps the five layouts and the BulkBar (`:408-417`);
  - **only event handlers go through `useStableCallback`**, because its ref is assigned in a layout effect and calling the wrapper while rendering runs the previous render's closure, or the initial one (`stable.ts:15-25`). `onMove` (`:233-256`, called on drop), `onQuickAdd` (`:258-307`, called on submit) and `onOrderChange` (`:353`, called from the sort plugin's `onSortChange`, `TableLayout.tsx:328`; the `columns` memo only tests it for truthiness, `:323`) become `useStableCallback`s;
  - `canQuickAdd` is **called during render** (`ListLayout.tsx:365`, `BoardLayout.tsx:217`, `CalendarLayout.tsx:169`), so it is not a stable callback. `quickAddContext` (`:181`, a fresh object today) becomes a `useMemo` over `[projectId, bundle, scopeDefaults]`, and `canQuickAdd` a `useCallback((group) => quickAddAllowed(group, quickAddContext), [quickAddContext])`. Its identity changes only with the bundle, when the layouts re-render anyway. Memo children never receive it: `BoardColumn` gets the boolean `canAdd` that `BoardLayout`'s `canAddTo(column)` computes, and list rows do not see it;
  - `selection` stays an inline object; rows read only its stable `onToggle` and a per-row `selected`;
  - `useFadeOnChange(scroller, …)` (decision 132 item 5).
- **List (V1).**
  - **New `work-items/ListGroupRows.tsx`.** It exports `ListGroupRows({ anchorId, items, setSize, isVirtual, isOpen, estimateStart, row })`, where `row` is the row's fixed props `{ display, onUpdate, onOpen, readOnly, selection }`.
    - When `!isOpen` it renders no rows and no `List` (the Collapsible keeps its content mounted, `Collapsible.js:306-313`). This holds below the threshold too; the footer and quick-add stay in the body.
    - It calls `useVirtualRows({ anchorId, kind: "list", count: items.length, getKey, isEnabled: isVirtual && isOpen, estimateStart })` with `const getKey = useCallback((i: number) => items[i].id, [items])`.
    - It renders `<List ref={anchorRef} className={anchorClassName} style={anchorStyle} data-virtual-open-end={anchorOpenEnd} density="compact" hasDividers onFocusCapture={onFocusCapture} onKeyDownCapture={…}>`. The children are the rows of `keptBefore`, `window` and `keptAfter`, each `<WorkItemRow key={item.id} item={items[r.index]} … selected={…} virtualIndex={isEnabled ? r.index : undefined} setSize={isEnabled ? setSize : undefined} measureRef={measureRef} keptTop={r.keptTop} />`. Only primitives and stable references go to the row; no per-row object is built.
    - `setSize` (decision 137) is `Math.max(group.count, items.length)`, or `Math.max(result.total, items.length)` when flat.
    - **Kept-row keys** (`onKeyDownCapture`): when `isNavKey(event)` and the event target's row (`closest("[data-index]")`) `isKept`, it calls `scrollToIndex(index)`, `preventDefault()` and `stopPropagation()`, so `useListFocus` at the root does not move. Every other key passes through.
    - **After each commit**, `useLayoutEffect` (no deps, no state) runs `stampTabStops(listRoot, ".tessera-wi-open")`, where `listRoot` is the closest `.tessera-wi-list`.
  - **`WorkItemRow`** (`ListLayout.tsx:269-327`) stays `memo` and gains four optional props: `virtualIndex?: number`, `setSize?: number`, `measureRef?: (el: Element | null) => void`, `keptTop?: number`. When `virtualIndex` is set, the `ListItem` gets `ref={measureRef}`, `data-index={String(virtualIndex)}`, `aria-posinset={virtualIndex + 1}` and `aria-setsize={setSize}`. With `keptTop` it also gets `className` `tessera-virtual-kept` (merged) and `style={cssVars({ "--tessera-virtual-top": cssPx(keptTop) })}`. The optimistic placeholder path (`:272-290`) gets the same attributes.
  - **`ListLayout` changes:**
    - `isVirtual = shouldVirtualize(loadedRows, VIRTUAL_LIST_MIN)`, where `loadedRows` is the sum of `group.item_ids.length` (or `result.items.length` when flat);
    - `starts = estimateStarts(…)` over the visible groups (open state, `has_more`, quick-add shown), or one flat section;
    - `GroupSection` renders `ListGroupRows` in place of the `List` (`:369-382`), with `anchorId = "list:" + (group ? group.id : "flat")` and `estimateStart = starts[i]`;
    - the root `onKeyDown` handles Home/End first when `isVirtual`, without modifiers and outside a typing target. It does `scroller.scrollTo({ top: 0 | scrollHeight })`, then runs a per-frame loop (decision 136): each `requestAnimationFrame` looks for the target row (`[data-index="0"]` in the first open group's anchor, or `[data-index="<count − 1>"]` in the last open group's anchor); while it is missing or its `getBoundingClientRect().top` moved more than 1 px since the previous frame, it re-issues the same `scrollTo` (measured sizes replacing estimates move `scrollHeight`); once it is present and still for two frames, it focuses that row's `.tessera-wi-open`. After 20 frames it focuses the first or last rendered `.tessera-wi-open` instead. A new Home/End press cancels a running loop. Otherwise it delegates to `handleKeyDown` (`:423-429`).
- **Board (V2).**
  - **New `work-items/BoardColumn.tsx`:** a `memo` component for one non-swimlane column. It renders the column `Card` and `Layout` that `BoardLayout.tsx:303-330` renders today. Its props are only primitives and stable references: `column`, `container`, `itemIds` (from `containers.get(container).itemIds`), `byId`, `properties`, `readOnly`, `canAdd: boolean` (from `canAddTo(column)`, computed in `BoardLayout`; never the `canQuickAdd` function), the stable event callbacks, `moveTargets` (a per-column array from a `useMemo` map keyed by column id), and the column's drag primitives `hiddenId: string | null` (the dragged id when this is the source), `slotIndex: number | null` (the target index when this is the target) and `placeholderHeight: number`.
    - It holds its body element in state through a merged ref callback (`registerContainer(container)` plus `setBody`), and wraps the body in `<VirtualScrollerProvider scroller={body} initialViewport={INITIAL_BOARD_BODY}>`.
    - A drag publish changes the drag primitives of at most two columns, so only those re-render. The test proves it with a render counter.
  - **New `work-items/BoardVirtualCards.tsx`:** `BoardVirtualCards({ container, cards, isVirtual })`. Here `cards` is the column's ordered `{ key, item | null }` list with the placeholder spliced in (`item` null) at `slotIndex`.
    - It calls `useVirtualRows({ anchorId: "board:" + container, kind: "board", count: cards.length, getKey, isEnabled: isVirtual, estimateStart: START.boardBodyPadding })` with `const getKey = useCallback((i: number) => cards[i].key, [cards])`; `cards` is a `useMemo` over `[itemIds, slotIndex]`.
    - It renders `<VStack gap={2} ref={anchorRef} className={cx("tessera-board-cards", anchorClassName)} style={anchorStyle}>`, with each rendered entry as `BoardCard`, the pending `Card` or the placeholder `Card`. Each gets `virtualIndex`, `measureRef` and `keptTop` as primitives.
  - **`BoardCard`** (`BoardCards.tsx:46-117`) becomes `memo`. It drops the `bundle` prop and reads `useProjectRow()` in `BoardCardBody` and `CardProperties` (as `RowProperties` does, `ListLayout.tsx:138-139`). Its other props stay as they are (`item`, `properties`, `columns`, `currentColumn`, `cardRef`, `handlers`, `isPeeked`, `onOpen`, `onMoveTo`; `BoardCards.tsx:46-60`), so `tests/ui/board-table-fixes.test.ts`'s `cardProps` (`:151-160`, rendered inside `ProjectProvider` by its `render`, `:80-88`) only drops `bundle`. It gains `virtualIndex?`, `measureRef?` and `keptTop?`, merged into `ClickableCard` (`ref` composed with `cardRef`, `data-index` as a string). Its props `handlers` and `cardRef` are cached per id (`use-pointer-drag.ts`, V1.4 and `:160-170`), `onMoveTo` is `moveToColumn` (stable once `onMove` is stable, V1.2), and `isPeeked` is a boolean.
  - **`renderCards` → `BoardColumn`:** `isVirtual = lanes === null && shouldVirtualize(visible.length, VIRTUAL_BOARD_MIN)`. The placeholder carries its `data-index` like any card. The EmptyState path is unchanged.
  - **Drags need no kept source here:** `use-pointer-drag.ts` uses window listeners and an overlay clone and reads rects live (`computeTarget`, `:195-210`), so a card that scrolls out of the window mid-drag does not break it. V2 does not add a kept index for board drags.
- **Table (V2).**
  - **New `work-items/table-cells.tsx`:** the cell renderers of `buildColumns` (`TableLayout.tsx:91-267`) as `memo` components that take the row's `item` and primitives and read project data through `useProjectRow()`. `buildColumns` then needs only `display.properties`, `showProject`, `readOnly` and the stable handlers, and the `columns` memo (`:321-324`) drops `bundle` from its deps. With V1.2's stable `onOrderChange`, `columns` keeps its identity across a refresh.
  - **The `plugins` record** (`:451-458`) is built in a `useMemo` over the plugin instances it holds. Astryx's `MemoizedTableRow` compares `columns` and `plugins` by reference (`BaseTable.js:192-240`).
  - **New `work-items/VirtualTable.tsx`.** It renders the `Table` element that TableLayout renders today (`:472-491`). Its props are the Table props plus `allRows: TableRow[]`, `idOf: (row: TableRow) => string` and `isVirtual`.
    - `idOf` is `groupedRows.idKey` when grouped (the only key source for the header Proxies; `row.id` reads `""` on them), else `(row) => row.id`.
    - It calls the hook with `anchorId: "table"`, `kind: "table"`, `count: allRows.length`, `getKey = useCallback((i: number) => idOf(allRows[i]), [allRows, idOf])` and `estimateStart: START.tableHead`.
    - It builds `data` from `tableSegments(rendered.map(({ index, start, size }) => ({ index, start: start + scrollMargin, end: start + size + scrollMargin })), totalSize, scrollMargin)`. A row segment is `allRows[index]` itself, the **same object** (never spread or copied, because the grouped header Proxies carry a private Symbol). A spacer segment is `spacerRow(id, height)`. A kept row therefore stays in normal flow between split spacers, keeping its column widths; table rows never get `.tessera-virtual-kept`.
    - A range change shifts every rendered row's `rowIndex` in `data`, so Astryx re-renders each rendered row (`BaseTable.js:196`). The memo cells make that re-render shallow: a cell whose `item` did not change bails out.
    - It adds the plugin from `table-virtual.ts`, last in the plugin order. The plugin instance is memoised on `allRows` and the hook's stable functions.
    - It anchors on `tbody`, found through `transformScrollWrapper`'s `ref` with `querySelector("tbody")` inside that ref callback, which calls `anchorRef`.
  - **`table-virtual.ts`** (pure plus a plugin factory):
    - `spacerRow<R extends object>(id: string, height: number): R` returns `{ id, groupKey: "", [SPACER]: height }` (a module `Symbol`) cast to `R` in this one place, with a comment that it is a synthetic row like Astryx's group headers. `TableLayout`'s row key (`row.id`) and `isDataRow` (`:70-72`, no `item` object → false) already handle it;
    - `spacerHeight(row: object): number | null`;
    - `dataIndexAttr(index: number): HTMLAttributes<HTMLTableRowElement>` returns `{ "data-index": String(index) }` with the one cast that `htmlProps` needs, because `HTMLAttributes` declares no `data-*` keys (`Table/types.d.ts:246`);
    - `virtualTablePlugin({ indexOf, measureRef })`:
      - `transformBodyRow`: for a spacer row it replaces `htmlProps` with `{ className: "tessera-table-spacer", "aria-hidden": true, role: "presentation", style: cssVars({ "--tessera-virtual-spacer": cssPx(h) }) }`. For a data or group-header row it adds `dataIndexAttr(i)` and `aria-rowindex = i + 1` (`i` = the row's index in `allRows`, which overrides the seeded value) and composes `ref` with the previous plugin's and `measureRef`;
      - `transformBodyCell`: `isContentSuppressed: true` for spacer rows.
  - **`TableLayout`** computes `isVirtual = shouldVirtualize(tableRows.length, VIRTUAL_TABLE_MIN)`, where `tableRows = grouped ? groupedRows.data : rows`. It renders `<VirtualTable …>`. TableLayout does not re-render on scroll; only VirtualTable does.
- **Gantt (V2).**
  - **New `work-items/GanttRows.tsx`.** It holds the body (today line, connectors, rows), moved out of `GanttLayout.tsx:154-188`.
    - Its row height is `metrics?.row ?? ESTIMATE.gantt`. **`GanttLayout` stays the single caller of `useGanttMetrics`** (it owns `rootRef` and computes the connector `paths` from `metrics`, `GanttLayout.tsx:93-95`): `isVirtual = shouldVirtualize(result.items.length, VIRTUAL_GANTT_MIN)` and `metrics = useGanttMetrics(rootRef, (edges.length > 0 || isVirtual) && result.items.length > 0)` (`gantt-metrics.ts:39-52`). It passes `metrics` and `isVirtual` to `GanttRows` as props; `GanttRows` and `useVirtualRows` never call it. One lint-safe measurement serves the connectors and the window, and it picks up the coarse-pointer 44 px rows.
    - `GanttRow` (`:205-333`) and `GanttDates` (`:336-369`) move to `GanttRows.tsx` with it (no import cycle back into `GanttLayout`). V2 updates the `GanttDates` import of `tests/ui/gantt-dates-lazy.test.ts` (`:33`) and the source paths that `tests/ui/row-truncation.test.ts` reads (`ROW_FILES` `:20-29`, the table case `:64-68`, the gantt case `:72`): the gantt patterns follow `GanttRow` to `GanttRows.tsx`, the table's `textOverflow="truncate"` follows the `Table` to `VirtualTable.tsx` and the cell patterns follow the cells to `table-cells.tsx`; V2 adapts the patterns to the memo cells' props without weakening what they check.
    - It calls `useVirtualRows({ anchorId: "gantt", kind: "gantt", count: items.length, getKey, fixedSize: rowHeight, keepIndexes, isEnabled: isVirtual, estimateStart: START.ganttBody })` with `getKey = useCallback((i: number) => items[i].id, [items])`.
    - `keepIndexes` is `[rowIndex.get(preview.id)]` while `useTimelineDrag().preview` is set, else `[]`. The bar holds pointer capture (`use-timeline-drag.ts:101`), so its row must not unmount mid-drag. A pointer press also focuses the bar, which makes it the focus-kept row from the first moment.
    - `GanttRow` becomes `memo`. `schedule` (`:76-83`) becomes `useStableCallback`; `ends` is the item itself unless it is the previewed one, and `conflictText` is a string.
    - Kept gantt rows sit absolutely at `keptTop` (`index × rowHeight`, `.tessera-virtual-kept`).
    - It renders connectors from `pathsInRows(paths, rowIndex, first − OVERSCAN.gantt, last + OVERSCAN.gantt)`.
  - **New `pathsInRows`** (`gantt-scale.ts`) keeps a path when `min(fromRow, toRow) ≤ last && max(fromRow, toRow) ≥ first`.
  - **The SVG** keeps `viewBox="0 0 days×day rows×row"` with `rows = items.length` (`:157`), and its height stays `--tessera-gantt-rows` × the row (`gantt.css:198`). The body's total height is `count × rowHeight` (padding plus rendered rows), so connector coordinates still match.
  - `GanttRows` imports `cssVars` from `@/components/shared/css-vars`; the private copy in `GanttLayout.tsx:40-42` stays for the head.
- **Drag (V1).**
  - New in `drag-math.ts`: `indexForSlot(ids, rendered, slot)`:
    - `slot < rendered.length` → `ids.indexOf(rendered[slot])`;
    - empty → `ids.length`;
    - else → `ids.indexOf(rendered.at(-1)) + 1`.
  - `use-pointer-drag.ts:208` uses it. Behaviour is identical when every item is rendered.
  - `itemHandlers(id, container)` (`:379-385`) returns a cached object per `(id, container)`, from a `useRef(new Map())` whose entries are built once. The entries call the latest `onPointerDown` through a ref, so `memo` cards keep their `handlers` prop.

**6.4 Calendar zoom (lane C)**

- `calendar-math.ts` (146 lines):
  - `export type CalendarView = "week" | "month" | "quarter"` (`:7`);
  - new `quarterStart(date)` → `YYYY-01|04|07|10-01`; new `quarterEnd(date)` → the last day of that quarter (through the private `monthEnd`, `:51-55`, which stays private);
  - `shiftPeriod` (`:57-63`): quarter moves by ±3 months and lands on the quarter start; week and month are unchanged;
  - `periodLabel` (`:70-77`): quarter gives `Q4 2026 (Oct – Dec)`, with `formatUtc` (`:65-68`, `{ month: "short" }`) for both months and the spaced en dash of the week label (`:74`);
  - `calendarWeeks` (`:98-118`): quarter → start `startOfWeek(quarterStart(anchor))`, end `startOfWeek(quarterEnd(anchor)) + 6`; the doc comment adds "A quarter is the whole weeks that touch it (13 or 14 rows)";
  - new `isOutsidePeriod(date, anchor, view)`: quarter → `quarterStart(date) !== quarterStart(anchor)`; week and month → `isOutsideMonth(date, anchor)`, which is today's rule for both (`CalendarLayout.tsx:228`), so the week and month grids do not change;
  - new `dayLabel(date, view)`: in a quarter, day 01 gives "Nov 1" (`formatUtc(date, { month: "short", day: "numeric" })`, the same output as `weekBandLabel`); otherwise the day number. It replaces the private `dayNumber` of `CalendarLayout.tsx:54-56`;
  - new `CELL_ITEM_LIMIT = { week: 4, month: 4, quarter: 2 }` (week and month keep today's `MAX_IN_CELL = 4`, `CalendarLayout.tsx:46`, which is removed) and `cellItemLimit(view, isNarrow)`: 0 for a narrow quarter, else the table value;
  - new `QUARTER_NARROW_PX = 600` (the root's content box; its 16 px inline padding is not counted);
  - `isOutsideMonth` (`:120-122`), `monthLabel` (`:79-81`), `weekBandLabel` (`:83-86`), `isWeekend` and `weekendShift` keep their signatures: `GanttLayout.tsx:25` and `planning/ModulesTimeline.tsx:22` import them;
  - header comment (`:1-4`): "Calendar grid (week, month and quarter)".
- `CalendarLayout.tsx` (383 lines):
  - the root `VStack className="tessera-cal" data-view={view}` (`:103`) stays. `data-view` already carries the zoom (`calendar.css:51, 60, 65`), so there is no `data-zoom`. The root takes the `ref` of `useNarrowContainer(QUARTER_NARROW_PX)` (`@/components/workspace-settings/use-narrow-container`, `:14`; `Stack ref`, `Stack.d.ts:29`). It measures the calendar itself, so a side peek that narrows it counts. `isNarrow` is used only when `view === "quarter"`. It is `false` on the server and the first paint, so a phone shows the item rows for one frame after hydration, the same trade-off as the settings tables (`use-narrow-container.ts:9-10`);
  - `const period = view` replaces `:100`, so the buttons read "Previous quarter" / "Next quarter" (`:117-118`); header comment `:3-8` says "Week, month and quarter calendar";
  - `DayCell` gets `view` and `limit = cellItemLimit(view, isNarrow)`. It uses `isOutsidePeriod(day, anchor, view)` for `data-outside` (`:228`), `dayLabel(day, view)` for the number (`:255`), `items.slice(0, limit)` (`:216`) and `items.slice(limit)` in the popover (`:278`);
  - with `limit === 0` the overflow Button (`:284`) gets ``label={`${hidden} ${hidden === 1 ? "work item" : "work items"} on ${day}`}`` (the ISO day, like `Add on ${day}` at `:241` and `More items on ${day}` at `:274`) and the visible text `+{hidden}` without the " more" word;
  - lazy popover content (field guide performance.md "Astryx 0.6.8"; precedent `properties/DateControl.tsx:75`): Unscheduled (`:125-140`) `content={unscheduledOpen ? … : null}`, quick add (`:234-252`) `content={quickAddOpen ? … : null}`, "+N more" (`:271-290`) `content={moreOpen ? … : null}`, Move to date (`:350-379`) `content={moveOpen ? … : null}`. A quarter draws up to 98 cells and two chips per cell, so these four closed contents (a `DateInput` per chip among them) would otherwise mount up to about 300 times.
- `calendar.css` (346 lines), after the `.tessera-cal-day` rule (`:83-90`):
  ```css
  /* Quarter zoom (decision 139): 13 or 14 short rows, so the cell floor is half the month's. */
  .tessera-cal[data-view="quarter"] .tessera-cal-day {
    min-height: calc(var(--spacing-8) * 2);
  }
  ```
  There is no week rule. The week grid already stretches to the panel height (`:51-62`) and hugs its chips at 480 px and narrower (`:64-75`); the old "min-height 8 × `--spacing-8`" rule would fight both.
- `DisplayMenu.tsx`: the SegmentedControl at `:193-201` becomes `label="Zoom"` with items `week` "Week", `month` "Month", `quarter` "Quarter", in the gantt's order (`:213-215`). Only one of the two "Zoom" controls is ever in the menu. `isCalendarView` (`:98-100`) narrows to `CalendarView` (imported type).
- `paging.ts`: the doc comment of `calendarWindow` (`:55-60`) says "the whole weeks of a week, a month or a quarter (up to 14 weeks)". The code (`:61-67`), `CALENDAR_CAP` (`:28`) and the Banner (`CalendarLayout.tsx:104-110`) are unchanged.

**Astryx props check** (all in §7):
- SideNav: `footerIcons`, `className`, `style`, `id`, `inert` and `data-*` through `...props`, `collapsible`, `resizable`; `useSideNavRenderMode()`; `SideNavItem` `...rest` on the collapsed link or folder button (`data-rail-label`); `SideNavCollapseButton collapsible`;
- DropdownMenu: `renderTrigger`, `alignment`, `menuWidth`, `hasChevron`, `DropdownMenuRadioGroup label value onChange`, `DropdownMenuRadioItem value label`, `DropdownMenuItem label description icon onClick`;
- Tooltip (RailItem, unchanged): `content`, `placement`, `focusTrigger`;
- refs and spread props: `LayoutPanel` `...props` (`inert`, `data-motion`), `Card ref`, `LayoutContent ref`, `List ref` + `style`, `ListItem ref` + rest props, `VStack ref`;
- Table plugin hooks `transformBodyRow` (`ref`, `htmlProps`), `transformBodyCell` (`isContentSuppressed`), `transformScrollWrapper` (`htmlProps.ref`); `rowCount`;
- hooks: `useMediaQuery(query, serverDefault)`, `useAppShellMobile().isMobile` (TopBar only), `useHotkeys`.
- Popover `content` (null while closed), `SegmentedControl label`, and Tessera's `useNarrowContainer` (lane C).

No raw div/span: the edge strip is a `VStack`; spacers are padding on Astryx elements or Table rows.

### 7. API verification

| API | Where verified | Used by |
|---|---|---|
| `SideNav` props `ref` `:27`, `header` `:40`, `topContent` `:44`, `footerIcons` `:56`, `className` `:72`, `style` `:77`, `resizable` `:102`, `collapsible` `:117`; destructuring with `...props` `:137` | `node_modules/@astryxdesign/core/dist/SideNav/SideNav.d.ts` | N |
| `...props` (so `id`, `inert`, `data-*`, handlers) go onto `<nav>` after `className` and the width style; `aria-label` from props overrides the default | `SideNav/SideNav.js:329-335` | N |
| Resizable SideNav wraps the nav with the ResizeHandle while not collapsed (Full ↔ rail remounts the nav); a resizable nav's inline width is the hook's size or unset while collapsed; a non-resizable nav uses `style` as given | `SideNav.js:223, 325-328, 406-427` | N (why the panel animates, why the labelled rail is sized by a class) |
| Drawer modes: `drawer` (`:266-289`) and, with a TopNav, `drawer-content` (`:295-312`): only `topContent`, children and `footerIcons`, no `<nav>`, no props, no collapse context; AppShell provides `"drawer-content"` around `sideNav` in the TopNav drawer | `SideNav.js:262-312`; `AppShell/AppShell.js:366-372, 527-533` | N (`isDrawer`, no options menu in the drawer) |
| `useSideNavRenderMode()`: `'default' \| 'topbar' \| 'drawer' \| 'drawer-content'` | `SideNav/SideNavRenderContext.d.ts:1-6`; exported at `SideNav/index.d.ts:21` | N (`side-nav-chrome.ts`) |
| Drag collapse: `useResizable` with `collapsedSize: COLLAPSE_THRESHOLD = 160` collapses when the raw drag width (before the min clamp) is below it and calls `onCollapseChange(true)`; the handle is shown only when resizable and not collapsed | `SideNav.js:46, 195-206, 223`; `Resizable/useResizable.js:629-637` | N (decision 128 drag path), Q |
| Collapsed `SideNavItem`: no icon → nothing; with children → `<button>` with `...rest` and a flyout (`:368-379`); without → link with `...rest` then the collapsed aria props (`aria-current`, `aria-label`) (`:405-420`) and a sibling Tooltip anchored on the row (`:422-430`); label `<span>` only when expanded (`:437`); theme class `astryx-side-nav-item` (`:357`) | `SideNav/SideNavItem.js`; `SideNavItemProps extends BaseProps<HTMLElement>` (`SideNavItem.d.ts:28`) | N (`data-rail-label`, decision 128) |
| `SideNavSection` theme class `astryx-side-nav-section` | `SideNav/SideNavSection.js:108` | N (`nav.css`) |
| `SideNavCollapsibleConfig { defaultIsCollapsed, isCollapsed, onCollapsedChange, hasButton, buttonLabel }`; `SideNavControlledCollapsible` (for `SideNavCollapseButton`); `useSideNavCollapse()`; all exported by name | `SideNav/SideNavCollapseContext.d.ts:10-24, 39`; `SideNav/index.d.ts:19-20`; `SideNavCollapseButton.d.ts:19-26` | N |
| `ResizableConfig` exported by name from Resizable (it is SideNav's `resizable` object type) | `Resizable/index.d.ts:10`; `Resizable/useResizable.d.ts:51`; `SideNav.d.ts:24, 102` | N (`side-nav-chrome.ts`) |
| Collapsed width `var(--spacing-12)` (`xhgvbfk`); default 260 px (`x1hfn5x7`) | `astryx.css:1974, 1946` | N |
| AppShell sidenav `LayoutPanel` with theme class `astryx-app-shell-sidenav`, `isScrollable: isFill`; inline only at or above the breakpoint; drawer below | `AppShell/AppShell.js:325, 408-417, 522-533` | N, motion |
| AppShell breakpoint `md` = 768 px in the theme; query `(width < 768px)`; `useMediaQuery` is `useSyncExternalStore` with a server value | `src/themes/catppuccin/catppuccin.js:394-400`; `catppuccinTheme.ts:188`; `AppShell.js:240, 258-259`; `hooks/useMediaQuery.d.ts:15`, `useMediaQuery.js:44` | lane 0 (`SIDENAV_DRAWER_QUERY`), N |
| AppShell main `id="astryx-app-shell-main"`, `tabIndex={-1}` (skip target) | `AppShell.js:63, 429-439` | N (focus after a route close) |
| `useAppShellMobile().isMobile` (context provided by AppShell, outside the streamed boundary) | `AppShell/AppShellMobileContext.d.ts:1-3, 29` | N (TopBar only) |
| Astryx CSS in `@layer astryx-base` (unlayered Tessera CSS wins) | `astryx.css:4` | N, V1 |
| `LayoutPanel` props `ref` `:18`, `padding` `:39`, `isScrollable` `:46`, `label` `:51`, `role` `:56`, `resizable` `:77`; `...props` spread onto its div | `Layout/LayoutPanel.d.ts`; `Layout/LayoutPanel.js:132-145, 176` | M (`inert`, `data-motion`) |
| `Card ref` | `Card/Card.d.ts:35` | M, V2 |
| `BaseProps` keeps `inert` and types every `data-*` prop as `string \| undefined` | `BaseProps.d.ts:7, 33` | N, M, V1, V2 |
| React `inert?: boolean` | `node_modules/@types/react/index.d.ts:2948` | N, M |
| `DropdownMenu` `renderTrigger` `:132`, `menuWidth` `:140`, `hasChevron` `:148`, `alignment` `:162`; `DropdownMenuRadioGroup` `value` `:19`, `onChange(value: string)` `:23`, `label` `:31`; `DropdownMenuRadioItem` `value` `:27`, `label` `:31`, `description` `:35`, `icon` `:40`; `DropdownMenuItem` `icon` `:31`, `label` `:33`, `description` `:35`, `onClick` `:43`, `isDisabled` `:58`; precedent | `DropdownMenu/*.d.ts`; `TopBar.tsx:129-162` | N |
| `IconButtonProps extends Omit<ButtonProps, …>` with `icon` (`:22-24`); `ButtonProps` `label` `:58`, `variant` `:63`, `size` `:68`, `tooltip` `:137`, `id` through `BaseProps` | `IconButton/IconButton.d.ts`; `Button/Button.d.ts` | N |
| `Tooltip` `content` `:34`, `placement` `:39`, `focusTrigger` `:63`, `isEnabled` `:83`, `isOpen` `:109`, `anchorRef` `:29` | `Tooltip/Tooltip.d.ts` | N (RailItem unchanged) |
| `useHotkeys(hotkeys)` | `hooks/useHotkeys.d.ts:59` | N |
| `ResizeHandle` sets `data-resizing` while dragging | `Resizable/ResizeHandle.js:501` | lane 0 (`isResizing`) |
| `--duration-medium` = 280 ms in the theme (`-min` 225, `-max` 350), scoped to `[data-astryx-theme="catppuccin"]`, set on `<html>` by the root `Theme`; Astryx's defaults (410 ms medium) do not apply; **served as `.28s` by the production CSS minifier** | `src/themes/catppuccin/catppuccin.css:146, 239-241`; `catppuccin.js:112-114`; `theme/Theme.js:222`; `astryx.css:78`; measured in `.next/static/**/*.css` and `getComputedStyle` | lane 0, N, M, Q |
| Tokens `--shadow-high` (`:85`), `--radius-container` (`:84`), `--spacing-0-5/1/1-5/2/3/4/8/11/12` (2/4/6/8/12/16/32/44/48 px, `:87`), `--font-size-xs` 10 px (`:82`), `--font-weight-medium` (`:83`), `--text-heading-6-leading` 1.6 (`:88`); `--border-width`, `--color-border`, `--color-background-body` | `astryx.css` and the theme | N, V1, C |
| `.tessera-peek-panel--cover { min-width: 100% }` beats a width animation; `.tessera-detail` is an inline-size container | `src/components/styles/detail.css:8-13, 48-50` | M (why the card slides) |
| `PeekDetail` keeps its component choice per mount; `MountedDetail` reports mount from a layout effect; the lazy component shows `PeekSkeleton` | `src/components/detail/peek-detail-lazy.tsx:30-38, 49-56, 60, 69-72` | M |
| `useCoverFocus` layout-effect timing | `src/components/detail/peek-cover.ts:75-114` | M |
| The `cssVars(vars): CSSProperties` pattern; `definedTokens` reads a quoted `"--x":` key anywhere in a TS file | `GanttLayout.tsx:40-42`, `ModulesTimeline.tsx:47-49`; `scripts/convention-rules.ts:170-180` | lane 0 (`shared/css-vars.ts`), N, V1, V2 |
| `flushSync` | `node_modules/@types/react-dom/index.d.ts:61` | lane 0, V1 (print) |
| `PushPin`, `PushPinSlash` icons; `SidebarIcon` | `node_modules/@phosphor-icons/react/dist/csr/PushPin*.d.ts`; `src/themes/catppuccin/icons.tsx:262` | lane 0, N |
| `LayoutContent ref` `:17`; `isScrollable = true` default | `Layout/LayoutContent.d.ts:17,81`; `LayoutContent.js:132` | V1, V2 |
| `List ref` + `style` `:21,96`; `ListItem ref` + `...restProps` `:24,116`; dividers are per-item styles of width `var(--border-width)`, and the last `li` loses its divider (`.x1t1lzn6:last-child { border-bottom-width: 0 }`) | `List/List.d.ts`, `List/ListItem.d.ts`, `ListItem.js:51-57, 212`; astryx.css | V1 (`data-virtual-open-end` rule) |
| `Collapsible` keeps closed content mounted (hidden by a style) | `Collapsible/Collapsible.js:306-313` | V1 (`ListGroupRows` renders no rows when closed) |
| The key `Button` sets no `tabIndex` by default | `Button/Button.js` | V1 (`stampTabStops`) |
| `useListFocus` defaults `hasHomeEnd = true`, `hasPaging = false`, `hasRovingTabIndex` opt-in; queries rendered items; re-stamps tab stops after the calling component's commits only | `hooks/useListFocus.js:186-188, 210, 294-313, 514-517` | V1 (`stampTabStops`, Home/End override) |
| Table `BodyRowRenderProps { htmlProps, ref, afterRow }` | `Table/types.d.ts:245-256` | V2 |
| `BodyCellRenderProps.isContentSuppressed` | `Table/types.d.ts:294` | V2 |
| `ScrollWrapperRenderProps { htmlProps & ref }`; `transformScrollWrapper` | `Table/types.d.ts:299-324, 423` | V2 |
| `transformBodyRow(props, item, index)` `:409`; `transformBodyCell` `:416` | `Table/types.d.ts` | V2 |
| `rowIndexStart` `:501`, `rowCount` `:513`; `aria-rowindex` seeded into row `htmlProps` before plugins (plugins may override); `htmlProps` is `HTMLAttributes<HTMLTableRowElement>` (no `data-*` keys, hence `dataIndexAttr`) | `Table/types.d.ts:246, 501, 513`; `BaseTable.js:155-159, 281-283, 441` | V2 |
| `MemoizedTableRow` skips a row only when `rowKey`, `rowIndex`, `ariaRowIndex`, `columns`, `plugins`, `textOverflow`, `RowComponent`, `CellComponent` and the item (same reference, else one-level shallow) are equal | `Table/BaseTable.js:192-240, 243` | V2 (stable `columns` and `plugins`, memo cells) |
| Grouped header rows are Proxies (`""` for unknown fields, `id` included; private Symbol marker); keys only through `idKey(row)` (`__group_<key>`); the plugin passes other rows through untouched; `plugins` is a `Record` (insertion order) | `Table/plugins/groupedRows/useTableGroupedRows.js:24-55, 202-235`; `Table.d.ts:68` | V2 (`idOf`, same-object rows) |
| Table scroll wrapper is `overflow-x: auto` (not a vertical scroller) | `Table/Table.js:59-64` | V2 (scroller = `.tessera-wi-scroller`) |
| `useGanttMetrics(rootRef, active)`: ResizeObserver, state set only in the observer callback; `readGanttMetrics` reads the first `.tessera-gantt-row` height | `src/components/work-items/gantt-metrics.ts:25-31, 39-52`; used at `GanttLayout.tsx:93` | V2 (gantt row height) |
| `useStableCallback`, `shareStructure`, `useShared` | `src/components/work-items/stable.ts:19-25, 69-84, 91-96` | V1 (screen handlers), V2 (`schedule`) |
| `useProjectRow()` lean row context `{ bundle, statesById, labelsById, actorsById, modulesById }` | `src/components/work-items/project-provider.tsx:66-72, 167` | V2 (board cards, table cells) |
| `use-pointer-drag.ts`: `registerItem` caches one ref per id; `computeTarget` maps the slot over rendered items; `itemHandlers` returns a new object per call | `src/components/dnd/use-pointer-drag.ts:160-170, 195-210 (rendered :200, index :208), 379-385` | V1 (`indexForSlot`, cached handlers), V2 |
| `use-timeline-drag.ts`: `setPointerCapture` on the bar; `preview { id, mode, delta }` | `src/components/dnd/use-timeline-drag.ts:15-19, 101` | V2 (`keepIndexes`) |
| `react-hooks/set-state-in-effect` also flags `useLayoutEffect` and `useInsertionEffect` bodies | `node_modules/eslint-plugin-react-hooks/cjs/eslint-plugin-react-hooks.development.js:46370-46372` | V1, V2 (store, no state in effects) |
| `react-hooks/incompatible-library` flags `useVirtualizer` | `eslint-plugin-react-hooks.development.js:18326, 31575-31580` | V1 |
| `VStack`/`Stack ref` (`Ref<HTMLElement>`) | `Stack/Stack.d.ts:29,185` | V1, V2, N, C (`useNarrowContainer` ref on the calendar root) |
| `@tanstack/react-virtual` `useVirtualizer<TScrollElement, TItemElement>(options: PartialKeys<ReactVirtualizerOptions, 'observeElementRect' \| 'observeElementOffset' \| 'scrollToFn'>): ReactVirtualizer`; `useFlushSync?: boolean` (**re-verify**) | read 2026-10-21 on 3.14.13 (unpkg `@tanstack/react-virtual@3.14.13/dist/esm/index.d.ts`); re-verified on the installed 3.14.19 in V1.1 | V1 |
| `VirtualizerOptions`: `count`, `getScrollElement`, `estimateSize(index)`, `overscan`, `getItemKey`, `scrollMargin`, `gap`, `initialRect`, `initialOffset` (number or function), `scrollPaddingStart`, `scrollPaddingEnd`, `indexAttribute` (default `data-index`), `enabled`, `rangeExtractor`, `measureElement(el, entry, instance)`. `Virtualizer`: `getVirtualItems()`, `getTotalSize()` (already minus `scrollMargin`), `measureElement(node)`, `indexFromElement(node)`, `scrollToIndex(index, { align })` (returns void), `measurementsCache`, `range`, `scrollOffset`, `scrollRect`. Exported `defaultRangeExtractor` and default `measureElement` (it warns and returns −1 without `data-index`). `VirtualItem { key, index, start, end, size, lane }`. `@tanstack/react-virtual` re-exports all of it (`export * from '@tanstack/virtual-core'`) (**re-verify** every name) | read 2026-10-21 on virtual-core 3.17.11 (193-line `dist/esm/index.d.ts`; its lines `:23-30, 36, 42, 65, 74` belong to that version) and `@tanstack/react-virtual@3.14.13/dist/esm/index.d.ts:2`; re-verified on the installed 3.19.4 in V1.1, recording the new line numbers | V1 |
| Playwright `reducedMotion`, `channel: "chromium"` = new headless | `node_modules/playwright-core/types/types.d.ts:2812, 17549`; Playwright 1.63.0 pins Chromium 1243 / 153.0.8010.12 (`node_modules/playwright-core/browsers.json`); `chromium-1243` (full) and `chromium_headless_shell-1243` are installed; `chromium.launchServer({ channel: "chromium" })` spawns `chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/…` and the default spawns `chromium_headless_shell-1243/…` (checked 2026-10-29, no download) | Q |
| `useNarrowContainer(minWidth): { ref, isNarrow }` (ResizeObserver on the content box; `false` on the server and first paint) | `src/components/workspace-settings/use-narrow-container.ts:14-27`; test `tests/ui/use-narrow-container.test.ts` (ResizeObserver stub `:16-27`) | C |
| Astryx `Popover` keeps closed `content` mounted; `content: ReactNode` accepts `null` while closed | `Popover/Popover.d.ts:79`; field guide performance.md "Astryx 0.6.8"; precedent `src/components/work-items/properties/DateControl.tsx:75` | C |
| `SegmentedControl label` is the radio group's `aria-label` | `SegmentedControl/SegmentedControl.d.ts:27-29` | C |
| `calendar_window` accepts any `{ from, to }` with `from <= to` | `src/lib/tessera/work-items/read.ts:117-122` | C |

**Re-verify after the install (V1.1, first step).** Lane 0 installs the package only after the user approves it (§9, §13). V1.1 then confirms each point below against `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts` and `node_modules/@tanstack/react-virtual/dist/esm/index.d.ts` (the `.js` where the point is behaviour), and records file:line in its report. A mismatch goes to the reconciler before any layout work.
1. `useVirtualizer` signature and the `PartialKeys` it omits; `useFlushSync` option name and default.
2. Option names and types: `count`, `getScrollElement`, `estimateSize`, `overscan`, `getItemKey`, `scrollMargin`, `gap`, `initialRect`, `initialOffset`, `scrollPaddingStart`, `scrollPaddingEnd`, `enabled`, `rangeExtractor`, `measureElement(el, entry, instance)`, `indexAttribute`.
3. `getTotalSize()` excludes `scrollMargin`; `VirtualItem.start`/`end` include it.
4. `measureElement` (the instance method) is a stable function per instance; `indexFromElement`; `measurementsCache` indexed by item index.
5. `scrollToIndex(index, { align: "auto" })` exists and returns void.
6. Public `range` (`{ startIndex, endIndex } | null`), `scrollOffset` and `scrollRect` are readable on the instance.
7. `defaultRangeExtractor` and the default `measureElement` are exported; the default `measureElement` warns and returns −1 without `data-index`.
8. Behaviour: `enabled` false → no observers and no items; flipping to true attaches them and computes a range (and keeps `scrollTop`, point 12).
9. Behaviour: which option changes re-compute the measurements. Changing `scrollMargin` or `gap` between renders must re-compute item starts. In 3.13.23 the memo keys are `count`, `paddingStart`, `scrollMargin`, `getItemKey`, `enabled` and `lanes` (`index.js:408-415`): a new `getItemKey` per render rebuilds every measurement (hence the stable `getKey`, §6.3), and `gap` is not a key. If `gap` is still not a key in 3.19.4, the hook calls `virtualizer.measure()` from a layout effect keyed on the gap (it sets no React state).
10. Behaviour: the range of an anchor wholly above or below the viewport (what `calculateRange` returns), and that the host re-renders only on `isScrolling` or range-index changes (`maybeNotify`); the store's near gate (§6.3) covers both.
11. Behaviour on the server: no `window` access during render with `enabled: false` (the hook's server path).
12. Behaviour: enabling an instance on a scrolled shared scroller does not change `scrollTop`, given `initialOffset: () => scroller.scrollTop` (3.13.23: `_willUpdate` calls `_scrollToOffset(getScrollOffset())`, which falls back to `initialOffset` while `scrollOffset` is null, `index.js:322-362, 373-379`); and a disabled instance clears its size cache (`:437-445`).
13. `scrollPaddingStart` / `scrollPaddingEnd` exist, default 0, and `scrollToIndex` subtracts them (3.13.23 `index.js:708-721`); whether `scrollToIndex` re-aims until the target is stable (`scheduleScrollReconcile` in 3.13.23).
14. Behaviour: what the instance's `measureElement` does with a node while `enabled` is false (3.13.23 caches it in `elementsCache` and observes it on enable; the plan's `measureRef` rule, §6.3, holds either way).

Points 8, 9, 10, 12, 13 and 14 were first read on a local copy of `@tanstack/virtual-core` 3.13.23 (`dist/esm/index.js`, read only, no download; not the version P12 installs). V1.1 re-reads them on the installed 3.19.4.

### 8. Lane split, leaf tasks and per-lane checks

| Lane | Starts | Owns (one owner per file) |
|---|---|---|
| **0 prep and docs** (alone) | first | Task 0 (own commit, first): `src/lib/tessera/schemas.ts` (the verbatim split only; then lane C owns it) and new `src/lib/tessera/schema-primitives.ts`. Then: `docs/PLAN.md`, `docs/PLAN-STATUS.md`, `docs/improvements.md`, `docs/contracts/ui.md`, `docs/process/swarm.md` (line 39 only); `package.json` + `package-lock.json`; `src/lib/tessera/seed-perf.ts` (line 311 only) and `tests/seed-perf.test.ts`; `src/themes/catppuccin/icons.tsx`; `src/app/globals.css`; new `src/components/styles/{nav,virtual}.css` (header only); new `src/components/shell/{nav-prefs,layout-motion}.ts`; new `src/components/shared/css-vars.ts`; tests `tests/ui/{nav-prefs,layout-motion}.test.ts`. Close-out (after Q): `docs/as-built/{README,shell-detail,work-items,operations,hardening}.md` and the P12 rows of `docs/PLAN-STATUS.md` and `docs/improvements.md` |
| **N nav** | after 0 | `shell/{TesseraShell,Sidebar,SidebarSkeleton,TopBar,CommandBar,ShortcutsDialog,RailParts,FavoritesSection}.tsx`, new `shell/{SidebarOptionsMenu.tsx,side-nav-chrome.ts,floating-nav.ts,use-floating-nav.ts,sidebar-commands.ts}`, `shell/{shortcuts,useShortcuts}.ts`, deletes `shell/nav-collapse-store.ts`, `styles/nav.css`; tests: new `tests/ui/{floating-nav,sidebar-commands,side-nav-chrome,nav-prefs-store}.test.ts`, deletes `tests/ui/nav-collapse-store.test.ts`, edits `tests/ui/{shortcuts,command-source,top-bar-search,shell-collapse-wiring,sidebar-top-content,rail-parts,sidebar-links,assistant-undo-palette}.test.ts` |
| **M motion** | after 0 | `detail/PeekHost.tsx`, new `detail/peek-motion.ts`, test `tests/ui/peek-motion.test.ts` |
| **V1 virtual core and list** | after 0 and lane 0 task 2 (the approved install) | new `src/components/virtual/**` (`virtual-config.ts`, `virtual-math.ts`, `roving.ts`, `print-store.ts`, `VirtualScrollerProvider.tsx`, `use-virtual-rows.ts`), `styles/virtual.css`, `work-items/{WorkItemsScreen,ListLayout}.tsx`, new `work-items/ListGroupRows.tsx`, `dnd/{drag-math,use-pointer-drag}.ts`, tests `tests/ui/{virtual-math,virtual-roving,virtual-store,list-virtual}.test.ts`, edits to `tests/ui/{drag-math,list-row-memo,list-visual-fixes,work-items-screen}.test.ts` (`list-visual-fixes` must pass unchanged; V1 edits it only if it fails for a reason the contract did not foresee, and reports it) |
| **V2 virtual board, table, gantt** | after V1's tasks V1.1, V1.2 and V1.4 are merged | `work-items/{BoardLayout,BoardCards,TableLayout,GanttLayout}.tsx`, `work-items/gantt-scale.ts`, new `work-items/{BoardColumn,BoardVirtualCards,VirtualTable,GanttRows}.tsx`, new `work-items/{table-virtual.ts,table-cells.tsx}`, tests `tests/ui/{table-virtual,board-virtual,board-memo}.test.ts`, edits to `tests/ui/{gantt-scale,gantt-layout,gantt-connectors,gantt-dates-lazy,board-keys,board-table-css,board-table-fixes,no-results,row-truncation}.test.ts` (`gantt-layout`, `gantt-connectors`, `no-results` and `board-table-css` must pass unchanged; `board-table-fixes` only drops the `bundle` card prop; `gantt-dates-lazy` and `row-truncation` follow the moved code) |
| **C calendar** | after lane 0 task 0 is merged | `src/lib/tessera/schemas.ts` (the two calendar lines, after the split), `src/lib/tessera/view-settings.ts` (`:54`), `docs/contracts/ai.md` (`:76`), `docs/contracts/schema.md` (`:102`), `work-items/{calendar-math.ts,CalendarLayout.tsx,DisplayMenu.tsx}`, `work-items/paging.ts` (the `calendarWindow` doc comment at `:55-60` only), `styles/calendar.css`, new `tests/ui/calendar-math.test.ts`, edits to `tests/ui/{calendar-layout,calendar-css,paging,url-state}.test.ts` and `tests/view-settings.test.ts` |
| **Reconciler** | after V1 merges, and again after V2 | `scripts/bundle-baseline.json`: after the merge, in a scratch copy, `next build` then `npm run check:bundle`; if a route is over the 5% tolerance (`scripts/check-bundle.ts:11, 34`) because of `@tanstack/*` or the new virtual modules, run `npm run check:bundle -- --update-baseline` and commit the baseline with that merge, naming the routes and the growth. Growth from anything else is a finding, not a baseline update |
| **Q Playwright** | after 0 (writes specs from day 1) | new `tests/e2e/{sidebar,motion,virtual-scroll,virtual-perf,calendar-zoom}.spec.ts`, new `tests/e2e/helpers-p12.ts`, the header comment of `playwright.perf.config.ts` (`:4-22`, to name `virtual-perf.spec.ts`; no setting changes); `tests/e2e/perf.spec.ts` (its scenario list only, decision 138; the method stays); fixes, only where P12 breaks them, to the existing specs listed in "Lane Q" and to `helpers-d.ts:260`. Not `fixtures.ts` |

**Prompt makeup per lane** (`docs/process/swarm.md:29`: a worker sees the common rules, the field guide, its lane section and its ownership row). For P12, a lane's "lane section" is the following parts of this plan, pasted in this order. The worker sees nothing else:

| Lane | Parts of this plan in its prompt |
|---|---|
| 0 | "What already exists" (all); §1; §2 (all rows, to copy verbatim); §3; §5; for the ui.md P12 summary (task 1i): §6.1 (the `ShellContextValue` and store paragraphs, the `nav.css` lead paragraph), §6.2.1 "What moves" and "Never remount the detail", §6.3 (the `VirtualScrollerProvider` store, "No provider", the `use-virtual-rows.ts` phases and kept rows, the token-gate paragraph, `virtual.css`) and §6.4 (the lazy popover bullet); §8 "File budget" and "Lane 0"; §9 |
| N | "What already exists": Shell and sidebar, Motion; §2 rows 128–133; §5.1, §5.2, §5.3, §5.4; §6.1; the §7 rows whose "Used by" names N; §8 "Lane N" |
| M | "What already exists": Motion (PeekHost, peek-detail-lazy, peek-cover, detail.css, hidden routes, the measured layout cost); §2 rows 132–133; §5.2; §6.2.1; the §7 rows naming M; §8 "Lane M" |
| V1 | "What already exists": Lists and paging (which holds the drag bullets), Tests and tooling; §2 rows 132 (item 5 only), 134–138; §5.2 (`useFadeOnChange`), §5.3; §6.2 (layout fade line); §6.3 (all); the §7 rows naming V1 and the re-verify list; §9; §10 (the budget it is measured against); §8 "Lane V1" |
| V2 | "What already exists": Lists and paging; §2 rows 135–138; §5.3; §6.3 (all; V1's merged exports are the contract and win over this text if they differ, reported as `ASSUMPTION:`); the §7 rows naming V2; §10; §8 "Lane V2" |
| C | "What already exists": Calendar; §2 row 139; §4; §6.4; the §7 rows naming C; §8 "Lane C"; docs/field-guide/performance.md (it is short and is the reason for the lazy popover content) |
| Q | "What already exists": Tests and tooling; §2 rows 128–139; §6 (for the ids, classes and data attributes); §8 "Lane Q"; §10; §11 |

Cross-lane contracts fixed here:
- `nav-prefs.ts` and `layout-motion.ts` (§5, lane 0 → N, M, V1);
- `ShellContextValue` (§6.1, N; M and V1 do not use it);
- `virtual-config.ts` (thresholds, `OVERSCAN`, `INITIAL_OVERSCAN`, `ESTIMATE`, `START`, `INITIAL_VIEWPORT`, `INITIAL_BOARD_BODY`), `virtual-math.ts` (`estimateStarts`, `initialRange`, `isNearViewport`, `tableSegments`, `cssPx`, …), `useVirtualRows` / `VirtualRow` / `VirtualRowsResult`, and the scroller store (`VirtualScrollerProvider`, `useScrollerStore`, `useScrollerViewport`, `useScrollerMeasured`, `useAnchorOffset`, `useAnchorGap`) (§6.3, V1 → V2; the thresholds and `ESTIMATE` also V1 → Q);
- the stable `layoutProps` handlers of `WorkItemsScreen` (`onMove`, `onQuickAdd`, `canQuickAdd`, `onOrderChange`, plus the existing `onUpdate` and `onOpen`) (V1 → V2);
- `indexForSlot` and the cached `itemHandlers(id, container)` of `use-pointer-drag.ts` (V1 → V2);
- `WorkItemRow`'s `virtualIndex` / `setSize` / `measureRef` / `keptTop` (V1); `BoardCard`'s `virtualIndex` / `measureRef` / `keptTop`, without `bundle` (V2);
- `cssVars` (`shared/css-vars.ts`, lane 0 → N, V1, V2);
- the perf seed's per-identifier project name (lane 0 task 3 → Q);
- the calendar `CalendarView` type and `calendar-math.ts` exports (C; `GanttLayout.tsx` and `planning/ModulesTimeline.tsx` keep importing the unchanged helpers);
- DOM ids `tessera-sidebar` / `tessera-nav-toggle` / `tessera-nav-options`, the attributes `data-nav-autofocus`, `data-rail`, `data-rail-label`, `data-dock`, `data-open` (N → Q) and `data-motion` on `.tessera-peek-panel` (M → Q);
- class names and data attributes listed in §6 (all lanes → Q).

**Merge order:** lane 0 task 0 (the verbatim `schemas.ts` split, its own commit, `docs/process/swarm.md:48`) → the rest of lane 0 → N, M, C in parallel, and V1 once lane 0 task 2 (the install the user approves, §13 Q2) is in → V2 after V1.1, V1.2 and V1.4 → Q → lane 0 close-out (task 8). Q1 was answered on 2026-10-21, so nothing waits for it. Lane 0 may merge without the install; then task 2 runs alone when the approval arrives, and only V1 and V2 wait. Run `npm run check` after each merge and `npm run check:e2e` after Q (in a scratch copy). After V1 merges, and again after V2, the reconciler re-checks `npm run check:bundle` and updates `scripts/bundle-baseline.json` only for growth from the virtual code (§8 ownership, "Reconciler"). After each merged batch whose gate is green, the reconciler runs `npm run live:update` once and says so (`docs/process/swarm.md:71`, decision 140); no other agent touches port 3000.

**File budget** (600 lines for `.ts`/`.tsx` under `src/` and `scripts/`, `scripts/convention-rules.ts:8`; tests and CSS are not counted, `scripts/check-conventions.ts:25-26, 129`; the ratchet file `scripts/file-budget.json` pins only `cycles.ts` 871 and `modules.ts` 694, which P12 does not touch). `wc -l` at `afe589c`:

| File | Lines | Room | P12 lane | After P12 (estimate) |
|---|---|---|---|---|
| `src/lib/tessera/schemas.ts` | 594 | 6 | 0 (split), C | 503 after task 0 |
| `src/components/shell/command-source.ts` | 548 | 52 | none (N adds `sidebar-commands.ts` instead) | 548 |
| `src/components/work-items/ListLayout.tsx` | 512 | 88 | V1 | about 530 |
| `src/components/work-items/TableLayout.tsx` | 497 | 103 | V2 | about 400 (cells to `table-cells.tsx`, the Table to `VirtualTable.tsx`) |
| `src/components/shell/CommandBar.tsx` | 464 | 136 | N | about 480 |
| `src/components/work-items/BoardLayout.tsx` | 448 | 152 | V2 | about 370 (the column to `BoardColumn.tsx`) |
| `src/components/work-items/WorkItemsScreen.tsx` | 438 | 162 | V1 | about 455 |
| `src/components/dnd/use-pointer-drag.ts` | 394 | 206 | V1 | about 410 |
| `src/themes/catppuccin/icons.tsx` | 388 | 212 | 0 | about 392 |
| `src/components/work-items/CalendarLayout.tsx` | 383 | 217 | C | about 420 |
| `src/components/work-items/GanttLayout.tsx` | 369 | 231 | V2 | about 300 (the body to `GanttRows.tsx`) |
| `src/components/shell/useShortcuts.ts` | 368 | 232 | N | about 369 |
| `src/components/shell/shortcuts.ts` | 366 | 234 | N | about 368 |
| `src/components/detail/PeekHost.tsx` | 328 | 272 | M | about 400 |
| `src/components/shell/Sidebar.tsx` | 275 | 325 | N | about 330 |
| `src/components/work-items/paging.ts` | 274 | 326 | C (comment) | 274 (comment only) |
| `src/lib/tessera/view-settings.ts` | 269 | 331 | C | 269 |
| `src/components/work-items/DisplayMenu.tsx` | 269 | 331 | C | about 272 |
| `src/lib/tessera/seed-perf.ts` | 345 | 255 | 0 (one line) | 345 |
| `src/components/work-items/gantt-scale.ts` | 223 | 377 | V2 | about 235 |
| `src/components/work-items/BoardCards.tsx` | 207 | 393 | V2 | about 215 |
| `src/components/dnd/drag-math.ts` | 206 | 394 | V1 | about 215 |
| `src/components/shell/TopBar.tsx` | 194 | 406 | N | about 225 |
| `src/components/work-items/calendar-math.ts` | 146 | 454 | C | about 200 |
| `src/components/shell/TesseraShell.tsx` | 104 | 496 | N | about 220 |
| `src/components/shell/ShortcutsDialog.tsx` | 84 | 516 | N | about 80 |
| `src/components/shell/SidebarSkeleton.tsx` | 24 | 576 | N | about 24 |

(For reference, not budgeted: `tests/e2e/fixtures.ts` 270, `calendar.css` 346, `work-items.css` 498, `gantt.css` 419, `board.css` 278, `table.css` 181, `paging.css` 54, `globals.css` 43.)

- **Within 40 lines of 600: only `schemas.ts` (594).** Lane 0 task 0 splits it verbatim before any lane edits it (below).
- **Watch:** `command-source.ts` (548): lane N puts the five sidebar commands in a new `shell/sidebar-commands.ts` (§6.1), so it does not grow. `ListLayout.tsx` ends closest to the limit (about 530).
- After each lane merges, the mechanical gate re-runs `wc -l` on the files that lane owns. A lane whose next task would take a file past 560 splits it verbatim first, in its own commit.

#### Lane 0: prep and docs (leaf tasks in order)

0. **Split `schemas.ts` verbatim (own commit, before any other P12 edit; docs/process/swarm.md:48).**
   - New `src/lib/tessera/schema-primitives.ts`: a three-line header comment ("Enums and primitive value schemas, moved verbatim out of schemas.ts for the file budget (P12). schemas.ts re-exports everything, so imports do not change. Client-safe: zod only."), `import { z } from "zod";`, a blank line, then `schemas.ts` lines 10–102 **verbatim** (from `ActorKindSchema` to `IdSchema`; they depend on `z` only).
   - `schemas.ts`: delete lines 10–102. Line 9 becomes `import { EstimateTypeSchema, HomeWidgetIdSchema, IdSchema, IsoDateSchema, IsoTimestampSchema, LayoutSchema, PaletteColorSchema, PrioritySchema, StateGroupSchema } from "./schema-primitives";` (the nine moved names that lines 103–594 use), line 10 is blank and line 11 is `export * from "./schema-primitives";`. The result is 503 lines; the new file is about 98.
   - No importer changes: 146 files import from `schemas.ts`, and every name is still exported there. There is no cycle, because `schema-primitives.ts` imports nothing from `schemas.ts`.
   - Old line N (N ≥ 103) becomes N − 91: `CalendarLayoutSchema` moves from `:228` to `:137` and its describe from `:250` to `:159`.
   - Gate: `npm run check`.
1. **Docs** (the convention gate needs the decision numbers before code cites them; `scripts/convention-rules.ts:14-24` reads every `| N |` row under "## Resolved design decisions"):
   - **a.** `docs/PLAN.md` rows 109, 110 and 111 (lines 192–194): after the bold title insert " **Dropped 2026-10-21 (decision 127); only the workspace revision index of decision 126 was built.** Original text:", keeping the rest.
   - **b.** Insert rows 127–139 from §2 between line 209 (row 126) and line 210 (row 140), in order, so the table reads 126, 127 … 139, 140, 141, 142. Do not renumber 140–142. Row 128 already holds the Q1 = B answer; copy it as written. In row 140 (line 210), replace "(Performance round, 2026-10-24; 127–139 are P12's, in `docs/drafts/p12-plan.md`, and join this table when P12 lands.)" with "(Performance round, 2026-10-24.)".
   - **c.** Line 66 (Cache Components rules): replace the "Start uncached … only in P11." bullet with "Reads stay uncached: the `"use cache"` lane (decisions 109–111) was dropped on 2026-10-21 (decision 127)."
   - **d.** §9 P11 row (line 463): scope `"use cache"` + tags → `~~"use cache" + tags~~ (dropped, decision 127)`.
   - **e.** §9: after the P11 row (line 463) add `| **P12 Shell and list polish** | 1.5 | Sidebar modes (full, icon rail, labelled rail) and the floating sidebar, layout motion with the reduced-motion rule, virtual scrolling for list/table/board/gantt, calendar zoom week/month/quarter | Playwright sidebar, motion, virtual-scroll and calendar-zoom specs green; decision 138 met (virtual-perf scroll budgets; list first render p95 ≤ 300 ms on 10 000 items) |`.
   - **f.** The verified-versions table: after the Recharts row (line 59) add `| @tanstack/react-virtual | 3.14.19 (exact), MIT, peers react/react-dom ^16.8–^19; its only dependency @tanstack/virtual-core 3.19.4 (MIT, no dependencies). Decision 134. |`.
   - **g.** `docs/PLAN-STATUS.md`: in the P11 row (line 21) "**Cache tags: skipped**" → "**Cache tags: skipped, then dropped 2026-10-21 (decision 127)**", and in the same row "P12 windowing (about 50 list rows)" → "P12 windowing (above 30 list or table rows, decision 135)"; after line 21 add a P12 row "| P12 Shell and list polish | sidebar modes, floating sidebar, layout motion, virtual lists, calendar zoom | planned (docs/drafts/p12-plan.md) | see docs/PLAN.md §9 | |".
   - **h.** `docs/improvements.md`: the cache lane is already under "Dropped by the user" (`:221-222`), and that line becomes true with 1a. "Planned for P12" (`:54-59`) stays until the close-out. Under it, add "### Deferred from P12" with the §1 deferral rows as one-line bullets.
   - **i.** `docs/contracts/ui.md`:
     - update the "Shell (lane B)" sidebar and top bar bullets (`ui.md:91-92`): three views (Full, Icons and labels 60 px, Icons only 48 px), floating, the options button, `tessera.nav.v1`; replace the `nav-collapse-store.ts` sentence with `nav-prefs.ts` (preferences and the floating open flag, each read with `useSyncExternalStore` in its consumer, server snapshot the defaults / false) and keep the streamed-subtree rule (`ui.md:93`) naming `nav-prefs.ts`;
     - append "## P12: sidebar modes, motion, virtual lists, calendar zoom", at most 40 lines summarising these §6 parts (the ones in lane 0's prompt, §8 "Prompt makeup"), with links to decisions 128–139: §6.1 the shell context (callbacks only) and the `nav-prefs.ts` stores, and the `nav.css` rule; §6.2.1 the peek card slide that never remounts the detail; §6.3 the scroller store and its anchors, the default store without a provider, kept rows, windowing off while printing, `virtual.css` and the token gate; §6.4 the lazy calendar popovers. It must say: the motion token is `--duration-medium` (280 ms in the theme, `.28s` in the built CSS, so code parses it); the labelled rail is CSS on Astryx's collapsed rail (`data-rail`, `data-rail-label`, `::after`); `nav.css` reaches `astryx-app-shell-sidenav`, `astryx-side-nav-item` and `astryx-side-nav-section` only through our own class `tessera-sidebar`, like `astryx-collapsible-trigger` under `.tessera-wi-group`, so these are per-instance layout rules, not a theme restyle; every `--tessera-*` style key goes through `cssVars`; virtual rows carry string `data-index`; Playwright locators for lists are scoped to the visible route; and calendar popovers mount their content only while open.
   - **j.** `docs/process/swarm.md:39`: "("Resolved design decisions", 1–28, and U1–U9)" → "("Resolved design decisions", 1–142 with P12's 127–139, and U1–U9)".
   - (`docs/contracts/ai.md:76` and `schema.md:102` are lane C's, task 1, so they change with the schema.)
2. **Dependency, only after the root planner records the user's approval (§13 Q2):** `npm install @tanstack/react-virtual@3.14.19 --save-exact`, then `npm run check:licenses` (both packages MIT). Check that `package-lock.json` resolves `@tanstack/virtual-core` to 3.19.4. `THIRD_PARTY_NOTICES.md` needs no row (plain dependency, not adapted code). If the approval comes later, this task runs alone after lane 0 has merged, and V1 waits for it.
3. **Perf seed per identifier:** `src/lib/tessera/seed-perf.ts:311` creates the big project as `name: "Performance"` whatever the identifier, so a second perf-seeded project in one database fails with CONFLICT ("A project named "Performance" already exists"; reproduced 2026-10-29). Change it to ``name: identifier === "PERF" ? "Performance" : `Performance ${identifier}` ``, so the decision 115 fixture keeps its name. Extend `tests/seed-perf.test.ts` with two identifiers seeded into one database. Measured with the change: the second and third 1 500-item seeds into one database take 4.6 s and 4.3 s.
4. **Icons:** `PinIcon` and `UnpinIcon` (§5.4).
5. **Stylesheets and helper:** empty `nav.css` and `virtual.css` with header comments, imported in `globals.css` after `paging.css`; `src/components/shared/css-vars.ts` (§5.3).
6. **`nav-prefs.ts`** with `tests/ui/nav-prefs.test.ts` (pure parts; the store's hydration cases move with lane N, §6.1):
   - parse: null, invalid JSON, a non-object, partial, wrong types, extra keys; an unknown `display` such as the never-shipped draft value `"labels"` falls back to `full` (`{"display":"labels","dock":"floating"}` → full/icons/floating);
   - the serialize round trip (exactly three keys);
   - `navView` and `navViewPatch` for the three views; `isRailShown` for all eight combinations;
   - `sidebarCommandPatch` for each of the five ids and for an unknown id;
   - store: `setNavPrefs` emits once and not when unchanged; a `storage` event for the key updates the snapshot and one for another key does not; a throwing `localStorage` still applies the change; `getServerSnapshot` returns the same object every time; `setNavOpenFlag` emits only on change and never writes storage (mock `window` in Node like `tests/ui/color-scheme.test.ts`).
7. **`layout-motion.ts`** with `tests/ui/layout-motion.test.ts`:
   - `parseDurationMs` ("280ms", ".28s", "0.28s", " .28s ", "", "auto", "-1s");
   - `layoutMotionMs` reads `--duration-medium` from `getComputedStyle(document.documentElement)` and falls back to 300 when it is empty (jsdom);
   - `widthMotionPlan` (reduced, resizing, equal widths, normal);
   - `isJanky` ([16, 17, 16] false, [40, 40, 16] true, [16, 40, 40] true, [40, 16, 16] false, fewer than two long intervals false);
   - jsdom checks: `withWidthMotion` calls `change` exactly once even when `el` is null; `animateWidth` and `animateSlide` return null when `Element.prototype.animate` is missing; `guardJank` with a fake `requestAnimationFrame` calls `finish()` on a janky sequence and stops after three intervals.

Gate: `npm run check` green and no behaviour change in the app.

8. **Close-out (after Q merges, before the reconciler's pass; a worker, reviewed by the reconciler).** Refresh the as-built files P12 changed, each with its new line counts and a "State described" line naming the P12 commit:
   - `docs/as-built/README.md:5` (the snapshot sentence "P12 is not in it; refresh the affected files when it lands.") and `:19` (the Hardening row says "e2e (21 specs)"; it is 25 at `afe589c` and 30 after P12);
   - `shell-detail.md`: rows `:24-28` (TesseraShell, nav-collapse-store, TopBar, Sidebar/SidebarSkeleton, RailParts), `:67` (PeekHost) and `:104` (shell.css); new rows for `nav-prefs.ts`, `layout-motion.ts`, `side-nav-chrome.ts`, `floating-nav.ts`, `use-floating-nav.ts`, `sidebar-commands.ts`, `SidebarOptionsMenu.tsx`, `peek-motion.ts`, `shared/css-vars.ts` and `nav.css` (there is no `NavRail` component: the labelled rail is CSS, decision 128);
   - `work-items.md`: rows `:35-38` (WorkItemsScreen, ListLayout, BoardLayout, TableLayout), `:67-68` (drag-math, use-pointer-drag), the tests list (`:147`, `:161`) and "Known debt" (`:177-187`); new rows for `src/components/virtual/**` (including `print-store.ts`), `ListGroupRows`, `BoardColumn`, `BoardVirtualCards`, `VirtualTable`, `table-virtual.ts`, `table-cells.tsx`, `GanttRows`, `virtual.css`;
   - `operations.md`: rows `:42-43` (CalendarLayout, GanttLayout), the decision rows `:69` and `:71`, the tests lines `:87-90` (`:90` "No Vitest: `CalendarLayout` render" is already stale: `tests/ui/calendar-layout.test.ts` exists) and `:108-109` ("Calendar zoom levels … exist for the gantt only");
   - `hardening.md`: `:50` (the Playwright row), `:93` (spec count), `:117` (add `virtual-perf.spec.ts` and decision 138 beside decision 115's spec);
   - `docs/improvements.md`: move "Planned for P12" (`:54-59`) to "Closed" as "### P12 (date)"; record the decision 138 table and board first-render numbers under "Open → Performance";
   - `docs/PLAN-STATUS.md`: the P12 row becomes done, with agent counts per role (docs/process/swarm.md:76).

#### Lane N: sidebar views, floating sidebar, shortcut and commands
Decisions 128–131 and 133. Read the "Shell and sidebar" facts first; the streamed-subtree rule (`docs/contracts/ui.md:93`) applies to every value this lane adds. Leaf tasks:
1. **`floating-nav.ts`** and its tests.
2. **`side-nav-chrome.ts`** (pure `sideNavChrome` plus `useSideNavChrome`, with `isDrawer` from `useSideNavRenderMode()`). Make `SidebarSkeleton` use it, so the skeleton and the sidebar render the same frame.
3. **`TesseraShell`**: the new `ShellContextValue` (callbacks in the context, `navPrefs`, `isNavCollapsed` and `isNavOpen` read inside `useShell()`), `setNavView` / `setNavCollapsed` / `setNavDock` / `setNavOpen`, `refocusNav`, `mod+b`, the breakpoint reset (§6.1). Port `nav-collapse-store.test.ts` to `nav-prefs-store.test.ts`, adapt `shell-collapse-wiring.test.ts` (plus the floating case), then delete `nav-collapse-store.ts` and its test.
4. **`Sidebar` integration:** the chrome, `useFloatingNav` (`use-floating-nav.ts`), the edge strip, `footerIcons`, `data-nav-autofocus`.
5. **Labelled rail:** `data-rail-label` on `RailItem` and the favourites folder item; the labelled-rail rules in `nav.css`.
6. **`SidebarOptionsMenu`** (`id="tessera-nav-options"`, three-item radio).
7. **`TopBar`**: the collapse button fed by `setNavCollapsed`, and the floating toggle with the toggle-press flag.
8. **`nav.css`** docked rules (`overflow-x: hidden`, `flex-shrink: 0`) and the floating rules.
9. **Shortcut registry entry, `DELEGATED`, `sidebar-commands.ts` (hidden below `md`), `CommandBar` dispatch and icon, and removing `EXTRA_GLOBAL` from `ShortcutsDialog.tsx`.**

Keyboard paths:
- `mod+b` docked: Full ↔ the stored rail kind (also inside inputs); floating: open/close; below `md` it does nothing;
- Tab to the top-bar toggle (floating), then Enter/Space opens the panel with focus on "New work item" (`[data-nav-autofocus]`);
- Escape closes and returns focus to the toggle;
- Tab past the last panel control closes it (focus left);
- Tab to "Sidebar options", Enter opens the menu, arrows move and Enter picks; after any of the three views focus is on `#tessera-nav-options` again (`refocusNav` after a remount; the menu's own focus return otherwise);
- in the Icons and labels rail, Tab moves tile by tile; each tile's name is read once (its `aria-label`), and its tooltip opens on focus;
- after "Undock sidebar" focus lands on `#tessera-nav-toggle`;
- after "Dock sidebar" focus lands on the remounted options button;
- Enter on a project link in the floating panel navigates, closes the panel and puts focus on `#astryx-app-shell-main`;
- Projects "+" in the floating panel opens Create project; Escape returns focus to "+" inside the still-open panel;
- Power K "Sidebar: …".

A11y:
- the docked, rail and floating sidebars are the same `nav[aria-label="Work"]` landmark;
- labelled-rail names are CSS `::after` content of the link; the link's accessible name is its `aria-label` (the label, or "name count" for projects), so nothing is read twice; a Playwright `getByRole("link", { name: "Home", exact: true })` must find the rail tile;
- `inert` while the floating panel is closed;
- the toggle has `aria-expanded` and `aria-controls="tessera-sidebar"`;
- the edge strip is `aria-hidden` and not focusable;
- the help dialog lists `mod+b` exactly once ("Collapse or expand the sidebar").

375 px:
- AppShell drawer as today (SideNav in `drawer-content` mode);
- no options button, no edge strip, no floating rules, no `data-rail` (the chrome sees `isDrawer`);
- `mod+b` and the `sidebar.*` commands do nothing or are hidden; the preferences stay stored and apply again at ≥ `md`;
- an overlay left open at desktop width is closed after the breakpoint flips both ways.

Both schemes: the rail names, the floating surface, hairline and `--shadow-high` must read in Latte and Frappé (screenshots in the report). The names use the row text colour on the wash (measured: Frappé `rgb(198, 208, 245)`, Latte `rgb(76, 79, 105)` on `rgb(230, 233, 239)`), so there is no new colour pair and no contrast-test change.

Vitest:
- `floating-nav.test.ts`: every branch of `floatingStaysOpen` (including `modalOpen`), `closeFocusTarget` (including `"route"` → `"main"`), `shouldCloseOnFocusOut`, the toggle-press flag (`markTogglePress`, `isTogglePressPending` at 0, 499 and 500 ms, `clearTogglePress`), and `MENU_OPEN_SELECTOR` in jsdom: an expanded favourites-folder button (`aria-expanded="true"`, no `aria-haspopup`) does not match, an open menu trigger (`aria-haspopup="menu"`, `aria-expanded="true"`) does;
- `side-nav-chrome.test.ts`: `sideNavChrome(input)` for docked Full, docked Icons only (`data-rail="icons"`), docked Icons and labels (`data-rail="labels"`), floating closed, floating open and drawer, with a stub `onCollapsedChange` (called with the right value, without animation);
- `nav-prefs-store.test.ts` and `shell-collapse-wiring.test.ts`: the round 6 hydration guards on the new store (§6.1), including the open flag;
- `rail-parts.test.ts`: `RailItem` puts `data-rail-label` on the collapsed link (and on the expanded row harmlessly) and keeps its tooltip; the folder item gets it too;
- `sidebar-top-content.test.ts`: unchanged cases still pass with the chrome;
- `sidebar-commands.test.ts`: `buildSidebarCommands` lists the two other views and Undock when docked, only Dock when floating (no view command and nothing that opens the overlay; decision 131), `[]` when `isDrawer`; each id maps to its patch;
- `shortcuts.test.ts`: `sidebar.toggle` resolves `mod+b`, `SHORTCUTS` holds exactly one `mod+b` entry, and it is absent from the palette;
- `command-source.test.ts`: unchanged sections; `paletteSection` returns null for `sidebar.toggle`;
- `top-bar-search.test.ts`: stays green (update its `useShell` mock for the new fields);
- `sidebar-links.test.ts`: its `useShell` mock (`:20`) gains `navPrefs: DEFAULT_NAV_PREFS`, `isNavOpen: false` and no-op `setNavView`, `setNavDock`, `setNavOpen`; its cases stay unchanged and green;
- `assistant-undo-palette.test.ts`: renders `CommandBar` alone (`:32`, `:102`), so it gains a `vi.mock("@/components/shell/TesseraShell", …)` `useShell` stub with the same fields; its `matchMedia` shim (`:43-53`) stays, and the shell code's `isSidenavDrawer()` guard (§5.2) also covers a test without it.

#### Lane M: peek motion
Decisions 132 (item 4) and 133. Leaf tasks:
1. `peek-motion.ts` and its tests: every input combination of both predicates (including `isHidden`), `closeOutcome` for finished/cancel × same/changed URL, and `slideOffset` (0, 4, 4.4, −1).
2. `PeekHost` motion (§6.2.1), in this order:
   - the `cardRef` merged with `watchPanelAndCover`, and the `wasOpen` / `prevModal` refs initialised from the first render;
   - the open slide in a layout effect declared after `useCoverFocus`, not depending on `isDetailMounted`;
   - the guarded close: `motionRef` guard, `closingHref` state with `isClosing` derived from it (`inert`, `data-motion="closing"`, Escape off), navigation decided at finish, `fill: "forwards"` until the URL changes, `"stay"` and cancel never navigate;
   - the layout-effect cleanup that cancels on hide and unmount.
   Do not add a `key` to, wrap, reorder or conditionally render the LayoutPanel, the Card or `PeekSlot`; do not touch `peek-detail-lazy.tsx` or `peek-cover.ts`.

Keyboard:
- Escape and the detail's close button both run `close()`;
- a second Escape or Close click during the closing slide does nothing, and neither does one while the router is still landing the URL;
- focus after close is unchanged: back on the list's opener (decision 11, `useCoverFocus`).

A11y: the panel is `inert` while closing; the covered list stays inert until the commit that closes the peek, as today.

375 px: the side peek (cover mode) slides at this width too (decision 132); reduced motion → instant.

Both schemes: no colour change.

Vitest: `tests/ui/peek-motion.test.ts`. Do not touch `detail-smoke.test.ts`, `peek-lazy.test.ts`, `peek-inert.test.ts`, `peek-cover.test.ts` or `peek-opener.test.ts`; they must stay green unchanged. jsdom has no `Element.animate`, so `animateSlide` returns null and close navigates at once.

#### Lane V1: virtual core, list, scroller, drag fix
Decisions 134–138. Leaf tasks:
1. **V1.1** Re-verify the TanStack points (§7 list) and report them. Then write `src/components/virtual/**` (§6.3: config, the pure helpers including `estimateStarts`, `initialRange` and `isNearViewport`, the roving stamp, the print store, the scroller store and provider, the hook with `rangeExtractor`, kept indexes, the measurement guard and `data-virtual-open-end`) with tests, and `virtual.css`. **Lint-clean, named approach:** no component sets state in an effect body, and no ref's `.current` is read or written during render (`react-hooks/refs`): the kept row is `useState` set from `onFocusCapture`, the extractor bounds come from `virtualizer.range`, and "near" is a store value read with `useSyncExternalStore` (§6.3). `npm run lint` is part of the gate, with only the one disabled `incompatible-library` line.
2. **V1.2** `WorkItemsScreen`: the scroller in state from the `LayoutContent` ref, `VirtualScrollerProvider` around the five layouts and the BulkBar, the three event handlers `onMove`, `onQuickAdd` and `onOrderChange` made stable (`useStableCallback`), `canQuickAdd` as a `useCallback` over a memoised `quickAddContext` (it is called during render, §6.3), and `useFadeOnChange(scroller, …)` (decision 132 item 5). **Check:** no function returned by `useStableCallback` is called while rendering (review every call site of the three handlers; `canQuickAdd` is not one of them).
3. **V1.3** `ListGroupRows` (collapsed groups mount no rows; `setSize`; the `onKeyDownCapture` kept-row rule), `WorkItemRow`'s four primitive props, the `ListLayout` threshold, `estimateStarts`, and Home/End (§6.3). **Baseline scroll measurement (decision 138):** before V2 starts, run the list scenario of `virtual-perf.spec.ts` (lane Q's file if it exists, else the §10 page script by hand on the same `data/p11-perf.db` copy and port) on a production build of the V1 branch, and report median, p95, long-task count and the longest task to the reconciler, who applies decision 138's fallback rule if needed.
4. **V1.4** `indexForSlot` in `drag-math.ts` used at `use-pointer-drag.ts:208`, and `itemHandlers` cached per `(id, container)` (`:379-385`).

Keyboard paths:
- the list arrows, Home/End, Tab and the kept-row rule of decision 136 (navigation keys only; Enter, Space, Escape and Tab on a kept row act as usual);
- Enter opens;
- the group header checkbox and the Collapsible trigger stay in the tab order before their rows; a collapsed group's rows are not in the tab order (they are not mounted).

A11y: decision 137 attributes; `[data-list-ready]` stays on the list root (`ListLayout.tsx:454`).

375 px:
- rows wrap to two lines and are measured, so no overlap;
- the live overscan (4 rows) covers the taller rows; the first paint may draw fewer rows than fit, and the measured window fills them on the next frame.

Both schemes: no colour change. (Row heights were measured equal in Latte and Frappé.)

Vitest:
- **`virtual-math.test.ts`:**
  - thresholds at 30/31 (list, table), 40/41 (gantt) and 8/9 (board);
  - `offsetWithin` with scrolled scrollers;
  - `estimateStarts` for flat, grouped with open and collapsed groups, with and without footers and quick-add;
  - `initialRange` for the refresh numbers: 10k grouped by state → rows 0–18 of the first group and `null` for the second; flat → 0–19; table → 0–21; board column → 0–4; gantt → 0–27; and `count` smaller than the window;
  - `isNearViewport` above, inside, below and touching the margin;
  - `paddings` for the first, middle and last windows with `scrollMargin` 0 and 400: `scrollMargin` is subtracted exactly once (items include it, `totalSize` does not);
  - `withKept` (duplicates, out-of-range, empty keep) and `partitionKept` before, inside and after the window;
  - `tableSegments`: top only, bottom only, both, a kept row before and after the window (split spacers), adjacent rows (no spacer), sub-pixel gaps dropped;
  - `isOpenEnd` and `isNavKey` (modifiers excluded);
  - `cssPx` rounding and clamping.
- **`virtual-roving.test.ts`** (jsdom): `stampTabStops` with none, one and two `tabindex="0"`, and with the `"0"` row placed after unstamped rows (it keeps the stop).
- **`virtual-store.test.ts`** (jsdom, stubbed ResizeObserver and rAF): the server snapshot is `{ measured: false, viewport: 768 }`; a measure with `clientHeight` 0 changes nothing; two changes in one frame emit once; an unchanged measure emits nothing; `offsetOf` follows a scrolled scroller; `scrollPaddingStart` reads the computed `scroll-padding-block-start`; two `scroll` events in one frame recompute "near" once, and a subscriber is notified only when an anchor's near boolean flips; `useScrollerStore()` without a provider returns the default store (`virtualizes` false), and a nested provider under it does not virtualise either.
- **`list-virtual.test.ts`** (jsdom, `renderToString` plus `hydrateRoot` and a client render with a mocked scroller):
  - grouped by state with 5 groups of 50 rows: the server markup holds 19 `.tessera-wi-row`, all in the first group; `hydrateRoot` of that markup logs no hydration error (console spy);
  - a flat list with 300 loaded rows of 1 500 renders `tessera-virtual` with at most the window plus overscan, `aria-setsize="1500"` and `data-virtual-open-end`;
  - a 30-row list renders all 30 rows with no `tessera-virtual` class (identical markup to before);
  - a collapsed group renders no `.tessera-wi-row`, also below the threshold;
  - ArrowDown on a kept row calls `scrollToIndex` and does not move focus; Enter on it is not intercepted;
  - a `matchMedia("print")` change to matching renders every loaded row;
  - with a mocked instance, the rows of the initial window get no `measureRef` before the first measure, and after the mocked first measure every rendered row has been passed to `measureElement` once;
  - a 40-row layout rendered without a provider (as `list-visual-fixes.test.ts` does) renders all 40 rows and no `tessera-virtual` class.
- **`list-row-memo.test.ts`** (extend "a memoized list row", `:217`): a window move from rows 0–19 to rows 4–23 renders only the four new rows (render counter), and the rows that stay are not re-rendered.
- **`work-items-screen.test.ts`** (extend): on the first render, a group whose quick add is allowed shows its quick-add row and one that is not allowed shows none (`canQuickAdd` is called during render with the current context).
- **`drag-math.test.ts`:** `indexForSlot` when all are rendered (old behaviour), for a windowed middle, for past the last rendered row, and for an empty container. A `use-pointer-drag` hook case: `itemHandlers("a", "c")` returns the same object twice.

#### Lane V2: board, table, gantt windows
Decisions 135–138. Leaf tasks:
1. **Board.** `BoardCard` as `memo` reading `useProjectRow()` (no `bundle` prop); the per-column move-targets map; `BoardColumn` (memo, nested provider, per-column drag primitives); `BoardVirtualCards` and the threshold.
2. **Table.** `table-cells.tsx` (memo cells, lean `buildColumns`), the memoised `plugins` record, `table-virtual.ts`, `VirtualTable` (with `idOf` and same-object rows) and the `TableLayout` switch.
3. **Gantt.** `GanttRows` with the metrics row height (`useGanttMetrics` stays in `GanttLayout`, active when windowed or with edges), the memo `GanttRow` with a stable `schedule`, the dragged row kept (`keepIndexes`), `pathsInRows`, and moving the body, `GanttRow` and `GanttDates` out of `GanttLayout`.
4. **Baseline scroll measurement (decision 138):** before Q's final run, run the table, board and gantt scenarios of `virtual-perf.spec.ts` (or the §10 page script by hand) on a production build of the V2 branch and report median, p95, long-task count and the longest task to the reconciler.

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
  - data assembly for windows at the top, in the middle and at the end, in grouped and flat mode, and with a kept row before or after the window. Row segments are the **same objects** as `allRows` (`toBe`), checked with a `Proxy` stand-in for a group header; keys come from `idOf`;
  - `columns` and `plugins` keep their identity across a re-render with equal inputs (a refreshed `bundle` with equal content included).
- **`board-virtual.test.ts`:** with the placeholder at index 0, in the middle and at the end, the keys and entries stay aligned; the placeholder carries `data-index`.
- **`board-memo.test.ts`** (jsdom, render counters): a drag publish that moves the slot inside column B re-renders column B only. Moving it from B to C re-renders B and C only. In a column of 8 cards (not windowed), no `BoardCard` re-renders when only the slot moves. In a windowed column (rendered under a test provider that virtualises), only the cards whose `virtualIndex` changed re-render (those between the old and the new slot), and cards before the lower slot do not. `containers.get(id).itemIds` keeps its identity across such a publish.
- **`gantt-scale.test.ts`:** `pathsInRows`. Keep a path that is inside the rows, one that crosses them in either direction and one that only touches the edge. Drop a path that is entirely outside them.
- **`gantt-layout.test.ts`**, **`gantt-connectors.test.ts`**, **`no-results.test.ts`**, **`board-keys.test.ts`** and **`board-table-css.test.ts`:** stay green unchanged except for imports that move (the layouts render without the screen's provider, so the default store renders every row; the table header rule of `board-table-css.test.ts:121-128` is not touched).
- **`board-table-fixes.test.ts`:** `cardProps` (`:151-160`) drops `bundle`; every other prop and every case stays.
- **`gantt-dates-lazy.test.ts`** and **`row-truncation.test.ts`:** follow `GanttDates`, `GanttRow`, the `Table` element and the cells to their new files (§6.3 Gantt).

#### Lane C: calendar zoom
Decision 139. Starts after lane 0 task 0 (the `schemas.ts` split) is merged. Re-read every owned file right before its first edit (the Edit tool refuses a stale read). Leaf tasks:
1. **Schema, type and docs in one commit** (§4): the two `schemas.ts` lines (`:137`, `:159` after the split), `view-settings.ts:54`, `CalendarView` with `"quarter"` plus `quarterStart`/`quarterEnd` and the quarter branches of `shiftPeriod`, `periodLabel` and `calendarWeeks` (`calendar-math.ts`), `isCalendarView` typed `value is CalendarView` (`DisplayMenu.tsx:98-100`), `docs/contracts/ai.md:76`, `docs/contracts/schema.md:102`, and the `tests/view-settings.test.ts` / `tests/ui/url-state.test.ts` cases. `npm run check` must be green after this commit alone.
2. **The rest of `calendar-math.ts`** (`isOutsidePeriod`, `dayLabel`, `CELL_ITEM_LIMIT`, `cellItemLimit`, `QUARTER_NARROW_PX`) and the new `tests/ui/calendar-math.test.ts`.
3. **`CalendarLayout` wiring** (§6.4): `useNarrowContainer` on the root, `period = view`, `DayCell` with `view` and `limit`, the narrow "+N" label, and lazy content for the four popovers.
4. **`calendar.css`**: the quarter rule (§6.4) and its `tests/ui/calendar-css.test.ts` case.
5. **The `DisplayMenu` "Zoom" control** (`:193-201`).
6. **The `paging.ts:55-60` doc comment**: "the whole weeks of a week, a month or a quarter (up to 14 weeks)".
7. **Report (no budget):** on a production build of a scratch copy with the 10 000-item `PERF` project, time 5 hard loads each of month and quarter at `cal` = a month with many targets (hydrated time, as perf-report-2026-10-28.md §4.1). Put the numbers in the report, so the reconciler can see what the quarter costs.

Keyboard paths:
- `[` and `]` by the current zoom (`CalendarLayout.tsx:82-86`); `t` today;
- the Display menu SegmentedControl "Zoom" with the arrow keys;
- the "+N" button opens the popover list;
- the item's Move to date control as today (its DateInput now mounts on open).

A11y:
- Previous/Next names say "quarter";
- the heading reads the quarter;
- narrow "+N" buttons are named "N work items on YYYY-MM-DD" ("1 work item on …" for one); wide ones keep "+N more".

375 px: quarter cells show "+N" only; week and month as today (the week grid hugs its chips, `calendar.css:64-75`). The same happens at desktop width when a side peek narrows the calendar's content box below 600 px.

Both schemes: muted outside days and the today marker in Latte and Frappé (screenshots).

Vitest:
- new `tests/ui/calendar-math.test.ts`:
  - `quarterStart` and `quarterEnd` for each quarter, including a leap year (Q1 2028 holds Feb 29);
  - `shiftPeriod` for a quarter across a year boundary in both directions, and from a mid-quarter anchor (lands on the quarter start);
  - `periodLabel` for each zoom ("Q4 2026 (Oct – Dec)", "Q1 2027 (Jan – Mar)");
  - `calendarWeeks` for a quarter with `weekStartsOn` 0, 1 and 6 and with `showWeekends` false: first and last day and the row count. Q4 2026 with Monday gives 2026-09-28 … 2027-01-03, 14 rows. A loop over 2000–2100 asserts 13 or 14 rows, never 15;
  - `isOutsidePeriod` (quarter; week and month equal `isOutsideMonth`);
  - `dayLabel` ("Nov 1" on the 1st in a quarter, "1" in a month);
  - `cellItemLimit` for every view and both narrow values.
- `tests/ui/calendar-layout.test.ts` (existing jsdom render): with a quarter display and `?cal=2026-11-10` (make its `useSearchParams` mock settable): heading "Q4 2026 (Oct – Dec)", 14 `.tessera-cal-week` rows, a "Nov 1" label, `data-outside` on 2026-09-28; three items on one day give two chips and "+1 more"; with a ResizeObserver stub that reports 500 (like `tests/ui/use-narrow-container.test.ts:16-27`) quarter cells hold no `.tessera-cal-item` and the button is named "3 work items on 2026-11-02" (a day with one item: "1 work item on …"); a closed Move to date popover renders no `DateInput`; week and month render as before (week keeps `data-outside` for days outside the anchor's month, and both still show 4 chips before "+N more").
- `tests/ui/calendar-css.test.ts`: the quarter `min-height` rule; no `data-zoom` selector exists.
- `tests/ui/paging.test.ts` (`:103-120`): `calendarWindow` for a quarter at `cal` 2026-11-10 with Monday is `{ from: "2026-09-28", to: "2027-01-03" }`.
- `tests/ui/date-span.test.ts:94-106` keeps its `calendarWeeks` and `shiftPeriod` cases unchanged.
- `tests/view-settings.test.ts` and `tests/ui/url-state.test.ts`: task 1.

#### Lane Q: Playwright specs
All specs import `test` and `expect` from `tests/e2e/fixtures.ts` (`:21-38`: its `page` fails a test on a page error or an untolerated console error) and reuse the existing helpers ("What already exists": Tests and tooling). `listRows` (`fixtures.ts:233`) is page-wide, so P12 specs never use it.

**New helper file `tests/e2e/helpers-p12.ts`** (like `helpers-a..d.ts`: it imports from `fixtures.ts` only and changes no other helper file; `fixtures.ts` stays as it is):
- `seedPerfProject(identifier, items): Promise<{ id: string; identifier: string }>`: runs `npx tsx scripts/perf-seed.ts --db <e2eDbPath()> --items <n> --projects 0 --project <identifier>` with `execFile` in the repository root, `TESSERA_DB_PATH` removed from the child's env (`scripts/perf-db.ts` refuses the path it names), timeout 120 s. Then it resolves the id with `mcp("list_projects")`. It needs lane 0 task 3 to seed a second project into one database.
- `archiveProject(id)`: `mcp("archive_project", { project_id: id })` (registry `archive_project`: the project "leave[s] the default lists").
- `visibleScroller(page)`: `page.locator(".tessera-wi-scroller:visible")`. Every row count and row locator in a P12 spec is scoped inside it. In `page.evaluate`, the scroller is `[...document.querySelectorAll(".tessera-wi-scroller")].find((el) => el.offsetParent !== null)`.
- `MAX_RENDERED = { list: 40, table: 40, gantt: 56, board: 12 } as const`: decision 138's rendered-row caps, the only copy of them; `virtual-scroll.spec.ts` and `virtual-perf.spec.ts` assert against it.
- `rowBoxes(scroller, selector)`: the rendered rows' top and bottom inside the scroller, for the overlap checks.
- `navPrefs(page)`: the parsed `localStorage["tessera.nav.v1"]`.
- Constants come from their source, never copied: `ROW_PAGE`, `BOARD_GROUP_PAGE` and `showMoreLabel` from `@/components/work-items/paging` (`:15`, `:17`, `:107`); `VIRTUAL_LIST_MIN`, `VIRTUAL_TABLE_MIN`, `VIRTUAL_GANTT_MIN`, `VIRTUAL_BOARD_MIN`, `ESTIMATE` and `OVERSCAN` from `@/components/virtual/virtual-config` (V1). Playwright resolves tsconfig `paths`; the first spec run confirms it, and a failure is reported as `ASSUMPTION:` with relative imports as the fallback.
**Seeding cost and timeouts** (measured 2026-10-29: Apple M4 Pro, load average 1.4–3.0, scratch copy of `afe589c`, `TESSERA_DB_PATH` unset, `/usr/bin/time` wall time):

| Seed | Into | Wall time |
|---|---|---|
| `--items 10000 --projects 0` | a fresh database | 27.2 s and 27.2 s (two runs; the script reports 24.9 / 25.9 s) |
| default (`PERF`, 10 000 + 4 small projects, 12 000 items), as `playwright.perf.config.ts:49` runs it | a fresh database | 33.4 s |
| `--items 10000 --projects 0` | a database with about 4 600 items | 32.3 s |
| `--items 1500 --projects 0` | a copy of the 50-item fixture | 3.5 s |
| `--items 1500 --projects 0`, second and third project | the same database, with lane 0 task 3 | 4.6 s, 4.3 s |
| `--items 1500 --projects 0` | the 10 000-item database | 5.8 s |
| an identifier that exists | any | 0.9 s (writes nothing) |
| a second project, without lane 0 task 3 | any | fails at once: CONFLICT "A project named "Performance" already exists" |

- `virtual-scroll.spec.ts`: each `beforeAll` calls `test.setTimeout(120_000)` first. That is at least 20 times the measured 1 500-item seed plus `npx` start-up and `list_projects`. It also stays inside `seedPerfProject`'s own 120 s `execFile` timeout. Tests keep the suite's 90 s (`playwright.config.ts:30`).
- `virtual-perf.spec.ts` seeds nothing. The perf config's webServer seeds `PERF` (about 33 s, inside its 300 s timeout, `playwright.perf.config.ts:53`). Each scenario calls `test.setTimeout(30 * 60_000)`, inside the config's 90 min (`:37`).
- `calendar-zoom.spec.ts`, `sidebar.spec.ts` and `motion.spec.ts` seed with `createProjectViaMcp` and `createItem` only and keep the default timeouts.
**Isolation** (decision 123):
- Each `test.describe` block of `virtual-scroll.spec.ts` seeds its own project with `seedPerfProject(uniqueIdentifier("VL"), 1500)` in `beforeAll` (one for the list blocks, one for the board, one for table and gantt) and calls `archiveProject` in `afterAll`. The below-threshold case seeds `seedPerfProject(uniqueIdentifier("VS"), Math.min(VIRTUAL_LIST_MIN, ROW_PAGE))`.
- Archiving matters: the seeded items are assigned to the user (`seed-perf.ts:166`, `:231`), and `work-items.spec.ts` and `workspace.spec.ts` run after `virtual-scroll.spec.ts` in file order on the same `data/e2e.db`.
- Blocks that mutate data (board drags) use `test.describe.serial` and document their order in a comment.
- `virtual-perf.spec.ts` reads the fixed `PERF` project of `data/p11-perf.db` and writes nothing (Show more does not write).
**Existing specs** (25 files, 138 tests at round 6). Q fixes, without changing what they test, any that P12 breaks, typically by scoping row locators with `visibleScroller`. **Dry run first:** Q's first task, once V1 is merged, is to run the whole existing suite on a build of the merged branch and list, per spec, the tests that see windowed rows (any list or table above 30 loaded rows: the demo WEB project has about 40 items, `seed.ts:103-104`, so every WEB list and table is now windowed) and the tests that fail. That list replaces the guesses below, goes in Q's report, and Q fixes from it. Known contact points (a guess until the dry run):
- the sidebar toggle labels "Collapse sidebar"/"Expand sidebar": `round5.spec.ts:198-209`, `round6.spec.ts:198-201`, and the early `mod+b` chord block `round6.spec.ts:260`. `helpers-d.ts:260` finds the toggle by `button[aria-label$="sidebar"]`, which also matches the floating "Show sidebar"/"Hide sidebar" (only one toggle renders at a time; check that it still holds);
- `navigation "Work"` and the sidebar: `collaboration.spec.ts`, `work-items.spec.ts`, `workspace.spec.ts`;
- board cards, list rows, calendar cells and gantt rows: `layouts.spec.ts` (`:57`), `drag.spec.ts`, `drag-surfaces.spec.ts`, `coverage-drops.spec.ts` (`:31-43`, `:118-127`), `coverage-touch.spec.ts` (`:26`), `coverage-timeline.spec.ts` (`:215-219`). The calendar ones use the month view and `[data-outside]`, which decision 139 does not change;
- `mobile.spec.ts`, `schemes.spec.ts`, `smoke.spec.ts`;
- `perf.spec.ts` is decision 115's harness: Q changes only its scenario list (below), never its method.

**`sidebar.spec.ts`**
- The default is the Full view (nav 250 px).
- The top-bar collapse button collapses to the Icons only rail (48 px); after a reload it is still the 48 px rail (`localStorage["tessera.nav.v1"]` says `"display":"rail","rail":"icons"`).
- `mod+b` toggles Full ↔ rail.
- The options menu radio: "Icons and labels" gives a 60 px nav with `data-rail="labels"`; the Home tile is 52 px wide and at least 44 px high, `getByRole("link", { name: "Home", exact: true })` finds it, and its `::after` content is `"Home"`; "Icons only" gives 48 px; "Full sidebar" gives the stored width. After each pick focus is on `#tessera-nav-options`.
- With Icons and labels stored, `mod+b` goes to Full and back to the 60 px rail.
- Dragging the resize handle 150 px to the left collapses to the stored rail kind and stores `"display":"rail"` (`useResizable.js:629-637`).
- Undock:
  - the panel width is 0;
  - `#tessera-sidebar` is `inert`;
  - "Show sidebar" opens it, focus is on "New work item", Escape closes it and focus is on the toggle.
- With the panel open and focus inside, a click on "Hide sidebar" closes it, and 600 ms later it is still closed (`inert`).
- Hover: hovering the edge at (4, 200) opens the panel after 120 ms, and moving the pointer to the content centre closes it after about 300 ms. The same holds with an expanded favourites folder in the panel (a folder is expanded by default, `FavoritesSection.tsx:144`; the spec creates one), so a plain `aria-expanded="true"` does not hold the panel open.
- Clicking a project in the floating panel navigates and closes it. Enter on a project link puts focus on `#astryx-app-shell-main`.
- Opening the project "…" menu keeps the panel open.
- Projects "+" in the open panel opens Create project. Escape closes the dialog, the panel is still open, and focus is on the "+" button.
- Dock restores the stored view (each of the three), and focus is on `#tessera-nav-options`.
- Power K runs the five commands; docked it never lists the current view; floating (overlay closed) it lists only "Sidebar: Dock", which docks and restores the stored view.
- The help dialog shows exactly one "Collapse or expand the sidebar" row with `mod+b`, and no "Collapse the sidebar" row.
- At 375 × 812: there is no "Sidebar options" button and no `[data-rail]`; `mod+b` leaves `localStorage["tessera.nav.v1"]` unchanged; Power K lists no "Sidebar:" command.
- Floating panel open at 1280 px, viewport to 375 px and back to 1280 px: the panel is closed.
- With a second page in the same context, a view change and an undock propagate without a reload.
- With `"display":"rail","rail":"labels"` stored and the sidebar chunk delayed 800 ms (the round 6 method), pressing `mod+b` at the shell's hydration point logs no console error, and the nav ends at the stored width.
**`motion.spec.ts`**
- `parseDurationMs(getComputedStyle(document.documentElement).getPropertyValue("--duration-medium"))` is 280 (the built CSS serves `.28s`).
- Right after the collapse click, `.astryx-app-shell-sidenav` has a running animation, and after 600 ms its width equals the rail width (48, or 60 with Icons and labels). About 100 ms into the expand, the nav is already at its final width while the panel is narrower (the nav is not squeezed), and the panel's `scrollWidth <= clientWidth`.
- With `emulateMedia({ reducedMotion: "reduce" })` there is no animation and the final width applies in the same frame.
- Peek:
  - open WEB-1: `.tessera-peek-card` has a running `transform` animation and the panel has its final width at once;
  - before every Escape below, wait until the lazy detail's heading is visible inside the card (decision 142: the chunk can arrive 300 ms or more after the skeleton), so the test closes a loaded detail;
  - Escape: the panel gets `data-motion="closing"` and `inert`; the URL keeps `peek` until the slide finishes (≤ 600 ms), then it drops; focus returns to the row's key;
  - Escape twice within 50 ms: the URL drops `peek` once, and the page is still the work-items list (no second Back);
  - Escape, then click the sidebar "Inbox" link within 100 ms: 800 ms later the URL is still `/inbox`;
  - with the detail chunk delayed 1 s (route the chunk request), opening a peek slides a card that shows the skeleton while it moves; once the editor appears, keep its node, trigger a re-render (an MCP write to the item, or a viewport resize) and check the editor is the same node (no remount); optionally count `MountedDetail` mounts (one);
  - under reduced motion the URL drops at once.
- A layout switch puts an opacity animation on the visible `.tessera-wi-scroller`, and so does a calendar zoom change (Display → Zoom → Quarter); a gantt zoom change does too.
- The floating panel has a `transition` under normal motion and `transition: none` under reduced motion (`getComputedStyle`).

**`virtual-scroll.spec.ts`** (1 500 items per project; every locator inside `visibleScroller(page)`)
- Threshold: the `VS` project (`Math.min(VIRTUAL_LIST_MIN, ROW_PAGE)` = 30 items, exactly at the threshold, and decision 135 windows only above it) has no `.tessera-virtual` in the list and the table, and renders all 30 rows. (`data/e2e.db`'s demo WEB project has about 40 items, `src/lib/tessera/seed.ts:104`, so it is windowed and is not used for this check.)
- Server window: `page.request.get(<flat list URL>)` returns HTML with at most 20 `tessera-wi-row` occurrences, and the loaded page logs no hydration error (`page.on("console")`, no message containing "hydrat").
- Flat list:
  - 200 rows loaded: `.tessera-virtual` is present and the `.tessera-wi-row` count is ≤ 40;
  - Show more gives 400 loaded rows, still ≤ 40 rendered;
  - scrolling to the bottom shows the footer text "Show 200 more (1100 hidden)";
  - halfway down, the last rendered row has a non-zero `border-bottom-width` (decision 135 divider rule);
  - `page.emulateMedia({ media: "print" })`: all 400 loaded rows are rendered; back to `screen`: ≤ 40 again;
  - navigate to Inbox through the sidebar and back: no two rendered rows overlap (each row's top ≥ the previous row's bottom − 1 px), and the rows at the scroll position are rendered.
- Grouped by state (windowed from the first paint):
  - while scrolling, the sticky band of the group under the top edge is the one whose rows are visible;
  - collapsing the first group moves the next band up with no gap: the first `.tessera-wi-row` sits within 100 px of its band, and the collapsed group holds no `.tessera-wi-row`;
  - scroll to the middle of the list, collapse a group above the viewport and expand it again: `scrollTop` is unchanged apart from the collapsed group's own height (the re-enabled instance does not jump to the top, decision 135 `initialOffset`); likewise `emulateMedia({ media: "print" })` and back to `screen` leave `scrollTop` unchanged;
  - scrolling slowly into the second group (10 px per animation frame) never shows a blank strip under its band (its first row is rendered in every frame where the band is visible), and after scrolling three groups down the rendered rows stay within `MAX_RENDERED.list`.
- Keyboard:
  - focus the first key and press ArrowDown 60 times: the focused key text equals the 61st loaded item, and it is in view;
  - End focuses the last loaded row, and Home the first row; in the grouped list the focused row is fully visible below the sticky band (its top ≥ the band's bottom);
  - wheel 3 000 px away from a focused row, then ArrowDown: the row scrolled back by `scrollToIndex` is fully visible below the sticky band (grouped list) or the sticky table header (table);
  - wheel 3 000 px away, then ArrowDown: the focused row is back in view and focus did not move;
  - wheel 3 000 px away, then Enter: the peek opens for the focused row (Enter is not intercepted).
- Selection: select 3 rows, scroll away and back; they are still checked; BulkBar says 3.
- Board (`test.describe.serial`):
  - the Backlog column (30 loaded cards, windowed) is scrolled; the column holds ≤ 12 `.tessera-board-card`;
  - `dragByPointer` a card from the middle of the window to the bottom slot of another column: after reload it sits after that column's last loaded card, not at the end of its unloaded rows (decision 114).
- Table: 400 rows; `table[aria-rowcount="1500"]`; row `aria-rowindex` equals its position; spacer rows are `aria-hidden`. Focus a row's key, wheel 3 000 px away: the focused `tr` is in normal flow (`position: static`), and ArrowDown or Tab works from it.
- Gantt:
  - 400 rows; `.tessera-gantt-row` count is ≤ 56;
  - the connectors present belong to rendered rows;
  - `t` centres today;
  - press on a bar, wheel 1 500 px, move 3 day widths, release: after reload the item's start date moved by 3 days.

**`calendar-zoom.spec.ts`** (a project from `createProjectViaMcp`; items from `createItem` with fixed 2026 target dates; `cal` passed through `workItemsUrl(id, display, { cal })`, `fixtures.ts:200`)
- Display → "Zoom" offers Week, Month, Quarter in that order. Picking Quarter at `cal=2026-11-10` shows the heading "Q4 2026 (Oct – Dec)". The row count is 14 with the Monday week start (Sep 28 to Jan 3); the spec reads `getWeekStart()` (`helpers-a.ts:62`) and expects 13 or 14 for any other start. Cells "Nov 1" and "Dec 1" carry those labels, and the 2026-09-28 cell carries `data-outside`.
- `]` goes to "Q1 2027 (Jan – Mar)", `[` comes back, and `t` goes to the quarter of today. The buttons are named "Previous quarter" and "Next quarter".
- Dragging the Oct 5 item to Nov 2 (`dragByPointer`) sets its target to 2026-11-02 (`getItem`).
- Three items on one day show two chips and a "+1 more" button, which opens the list.
- Show weekends off gives 5 columns (`.tessera-cal-head` count).
- At 375 × 812, quarter cells have no `.tessera-cal-item`; the Nov 2 cell has a button named "N work items on 2026-11-02".
- At 1280 × 720 with a side peek open from a chip, the calendar's content box is under 600 px, so quarter cells show only "+N" buttons; Escape closes the peek and the item rows return.
- After a reload the view is still quarter (saved view settings), and the URL-less reopen keeps it.
- Week and month still draw as before: month 5 or 6 rows, week 1 row.
- `mcp("describe_filters")` lists `quarter` under `display.calendar.layout`.
**`perf.spec.ts`** (decision 115, existing): its scenario list becomes list, board and table grouped by state (as today, `:35`, `:41-44`) plus list and table with `group_by: null`, all gated at p95 ≤ 300 ms. List grouped by labels is added as report-only (logged and attached, not asserted).

**`virtual-perf.spec.ts`:** decision 138, §10.

**Run commands** (always in a scratch copy: `git archive HEAD | tar -x`, `cp -Rc node_modules`, `npx next typegen`, `TESSERA_DB_PATH=<copy>/data/build/build.db npx next build`; prefix `export PATH=/opt/homebrew/bin:$PATH;`; never ports 3000 or 3001):
- one spec while writing it: `E2E_PORT=<assigned port> npx playwright test tests/e2e/calendar-zoom.spec.ts` (the webServer prepares a fresh `data/e2e.db` each start, `prepare-db.ts`);
- the whole suite: `E2E_PORT=<assigned port> npx playwright test`, or `npm run check:e2e` (build, bundle gate, suite);
- the perf gates (decision 138): `PERF_PORT=<assigned port> npx playwright test -c playwright.perf.config.ts` runs `perf.spec.ts` and `virtual-perf.spec.ts`; add `virtual-perf` to run only the scroll scenarios. The first run seeds `<copy>/data/p11-perf.db` (about 33 s).
- Browsers: nothing to install. The installed `chromium-1243` and `chromium_headless_shell-1243` match Playwright 1.63.0; `channel: "chromium"` launches the full build (checked 2026-10-29).

### 9. New dependencies

| Package | Version | Licence | Why | Notes |
|---|---|---|---|---|
| `@tanstack/react-virtual` | `3.14.19` exact (published 2026-10-13T18:25Z) | MIT | Headless row virtualisation over Tessera's own scroller (decision 134) | Peers `react` and `react-dom` `^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` (both 19.3.0 installed). 63.7 kB unpacked. Picked on 2026-10-29 as the newest patch at least 14 days old. Newer patches: 3.14.20 (2026-10-15T13:54Z, 14 days old only from 2026-10-29T13:54Z), 3.14.21 (10-16), 3.14.22 (10-22), 3.14.23 (10-26). The 2026-10-21 pick was 3.14.13 with virtual-core 3.17.11; the core has since released 3.18.0 and 3.19.0, so §7's TanStack rows are re-verified after the install (V1.1). Install only after the user approves the download (§13 Q2): `npm install @tanstack/react-virtual@3.14.19 --save-exact`, then `npm run check:licenses`. |
| `@tanstack/virtual-core` (transitive) | `3.19.4` (pinned exactly by react-virtual 3.14.19; published 2026-10-13T18:24Z) | MIT | Engine of the above | No dependencies. 489.8 kB unpacked (3.17.11 was 437.6 kB). |

Nothing else. Motion is WAAPI plus CSS, the floating sidebar is CSS on Astryx elements, and the calendar is `Grid`/`Stack`.

### 10. Performance budget: how it is measured

Both specs run under `playwright.perf.config.ts`, whose `testMatch: /perf\.spec\.ts$/` (`:32`) picks up `perf.spec.ts` and `virtual-perf.spec.ts`. The config uses the Desktop Chrome device, 1280×720 (`:46`), `next start` on `PERF_PORT` (default 3110, `:24`) over `PERF_DB` (default `data/p11-perf.db`, `:26`; it refuses `tessera.db`, `:27`), one worker, and seeds the PERF project idempotently (`:49`). Run both with `npx playwright test -c playwright.perf.config.ts` after `next build`; each spec skips itself unless `TESSERA_PERF=1` (`perf.spec.ts:38`), which the config sets (`:28`).

**First render: `tests/e2e/perf.spec.ts`** (decision 115, extended by lane Q):
- The method is unchanged: a hard `page.goto` per run, 2 warm-up rounds, 20 runs, interleaved scenarios, the time of the first frame where a visible `[data-list-ready]` exists, then a wait for load and an idle main thread (`:52-97`), nearest-rank percentiles (`:47-50`).
- Scenarios: list, board and table grouped by state (gated), list and table flat (gated), list grouped by labels (report-only).
- Assert p95 ≤ 300 ms for each gated scenario (`expect.soft`, as `:105-107`).
- Report the p50, p95, max and every run per scenario (`decision-115-list-ready.json`), and the load average before and after the run (`os.loadavg()`), because the numbers move with machine load.

**Scroll: `tests/e2e/virtual-perf.spec.ts`** (decision 138):
- **When it runs.** `test.skip(process.env.TESSERA_PERF !== "1", …)` and `test.setTimeout(30 * 60_000)`.
- **Browser.** `test.use({ channel: "chromium" })` at the top of the file: the full Chrome for Testing build in new headless mode (`chromium-1243`, installed), because the default headless shell does not paint like the real browser and its frame times would not mean anything. `perf.spec.ts` keeps the default browser, which is its baseline. No config setting changes.
- **Fresh document per scenario.** Each scenario starts with `page.goto(<work-items URL with q>)`, never an in-app navigation, so no hidden route copy is in the DOM. Every query still selects the visible element (`offsetParent !== null`).
- **Scenarios.** List flat, table flat and gantt flat (`{ display: { layout, group_by: null } }`), and the first column of the board grouped by state.
- **Load rows.** Click the "Show … more" button of the target (flat footer, or the first board column's footer) until at least 2 000 rows (board: 300 cards) are loaded or the button disappears. 5 s at 120 px per frame covers at most about 36 000 px (about 820 list rows), so the scroll never reaches the end of 2 000 rows and more loaded rows change only the merge cost. Each click is wrapped in the long-task observer below; its longest task is reported, not gated.
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
- **Assert** decision 138: `longTasks.length === 0`; list and gantt median ≤ 17.5 and p95 ≤ 34; table and board median ≤ 34 and p95 ≤ 50; rendered rows ≤ `MAX_RENDERED[kind]` (`helpers-p12.ts`: 40 list and table, 56 gantt, 12 cards).
- **Report only:** one End-key jump in the list and the table (its longest task), and the server HTML size of the grouped 10k list (`page.request.get`, bytes).
- **Report.** Attach `virtual-perf.json` with every number per scenario and the load average through `testInfo.attach`.
- A flaky run is re-run once before it counts as failed (§12). A real miss follows decision 138's fallback order; the reconciler decides and records it. The V1.3 and V2 baseline runs use this same script. For a closer look, the same run with `--headed` and the Chrome DevTools Performance panel shows the frames; the spec is the gate.

### 11. Acceptance (on a fresh `data/p12/acceptance.db` after `next build`, in a scratch copy)

Setup:
- Never use `data/tessera.db*`, `data/dev/`, or ports 3000 and 3001.
- Build and accept in a scratch copy: `git archive HEAD | tar -x -C <copy>`, `cp -Rc node_modules <copy>/`, `npx next typegen`, `TESSERA_DB_PATH=<copy>/data/build/build.db npx next build`.
- The phase's own folder (field guide, Environment): move any `data/p12/acceptance.db*` to the scratchpad, never delete it.
- Start the server: `TESSERA_DB_PATH=data/p12/acceptance.db nohup npx next start -H 127.0.0.1 -p <assigned port> > <scratchpad>/p12.log 2>&1 &`.
- Create project WEB with three items in the UI.
- Seed the big projects (lane 0 task 3 must be merged; `TESSERA_DB_PATH` unset): `env -u TESSERA_DB_PATH npm run perf:seed -- --db data/p12/acceptance.db --items 1500 --projects 0 --project VLST` (about 4 s). The 10 000-item checks (steps 28 and 29) use `data/p11-perf.db`, which the perf config seeds, not this database.

1. `npm run check` is green, with zero new lint warnings (the one `incompatible-library` line is disabled with its reason) and the licence gate passing with `@tanstack/*`.
2. `npm run check:bundle` is clean, and the build log has no new warnings.
3. The sidebar starts in the Full view, docked. The top-bar collapse button shrinks it to the 48 px Icons only rail: the content panel widens over about 0.3 s (280 ms), the sidebar text is not squeezed while it moves, and no horizontal scrollbar flashes in the sidebar, neither here nor on the way back. After a reload it is still the rail.
4. First paint (decision 130 trade-off): with a rail stored, a reload shows the Full sidebar for about a frame, then the rail, **without** an animation. With floating stored, the docked sidebar shows for about a frame, then the panel is gone without a slide.
5. `mod+b` → Full (animated); `mod+b` → the rail. A reload keeps the last choice.
6. "Sidebar options" (bottom of the sidebar) shows the "Show" radio with "Full sidebar", "Icons and labels" and "Icons only". All three apply, and after each pick focus is back on the "Sidebar options" button. "Icons and labels" gives a 60 px rail with a small name under each icon; "Workspace views" and "Active cycles" take two lines, the others one; Tab moves tile by tile and each tile's tooltip opens on focus. With Icons and labels chosen, `mod+b` goes to Full and back to it. Dragging the resize handle far to the left also goes to the chosen rail. "Undock sidebar":
   - the sidebar slides away and the panel takes the full width;
   - the top bar shows "Show sidebar", and focus is on it.
7. Rest the pointer at the left window edge below the top bar → the sidebar slides in over the content with a shadow, in the Full view. Move into the list → after a 300 ms pause it slides out over about 0.3 s.
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
10. In the floating panel's "Sidebar options", "Dock sidebar" re-docks it with the width animation and the previous view (Full, Icons and labels or Icons only), and focus is on "Sidebar options".
11. With two tabs: change the view, then undock, in tab A; tab B follows each within a second, without an animation.
12. Power K shows the "Sidebar: …" commands that change something ("Sidebar: Full sidebar", "Sidebar: Icons and labels", "Sidebar: Icons only", "Sidebar: Undock (float over the page)"; floating, only "Sidebar: Dock"), and each works. The help dialog (`mod+/`) lists `mod+b` once, as "Collapse or expand the sidebar".
13. At 375 px wide (device emulation):
    - the drawer works as before, with no options button and no edge hover;
    - `mod+b` does nothing, and Power K lists no "Sidebar:" command;
    - back at desktop width the preferences are unchanged;
    - floating: open the panel, narrow the window to 375 px and widen it again: the panel is closed.
14. Peek:
    - open WEB-1 → the list narrows at once and the item card slides in over about 0.3 s; the detail text does not reflow during it;
    - reload the page so the detail chunk is not cached, then open a peek at once → the card slides in with the skeleton, the detail replaces it, and typing in the description works right away (nothing remounted);
    - Escape → the card slides out, then the URL drops `peek` and focus returns to the row;
    - Escape twice quickly → it closes once (the list stays; no extra Back);
    - open WEB-1, press Escape and at once click "Inbox" in the sidebar → Inbox stays open (the closing peek does not pull you back);
    - at 768 px with the sidebar open (the peek covers the list) → the card slides in over the list, the list is not reachable by Tab, and Escape returns focus to the row;
    - opening WEB-2 from WEB-1 → no animation;
    - modal mode → the Dialog animates as before.
15. Switch the layout List → Board → Table → Calendar → Gantt: each fades in. Calendar zoom and gantt zoom changes fade too.
16. Turn on reduced motion (macOS Accessibility → Reduce motion, or DevTools Rendering emulation): steps 3, 6, 7, 14 and 15 apply instantly, with no animation, and the Escape close drops `peek` at once.
17. VLST list, flat:
    - 200 rows loaded, and the DOM holds at most about 40 rows (DevTools console: `[...document.querySelectorAll('.tessera-wi-scroller')].find((e) => e.offsetParent).querySelectorAll('.tessera-wi-row').length`); Show more gives 400 loaded rows and the count stays about 40;
    - halfway down, every rendered row down to the last one shows its divider;
    - scroll to the bottom: the footer reads "Show 200 more (1100 hidden)"; click it and the rows append;
    - Cmd+F for a title far below the window finds nothing, while the filter field finds it (decision 137);
    - the WEB project (3 items) is not windowed (no `.tessera-virtual` in the scroller).
18. Print preview (Cmd+P) of that 400-row list shows all 400 loaded rows. After it closes, the DOM is back to about 40 rows.
19. From the VLST list, go to Inbox through the sidebar and come back: the rows at the scroll position are drawn, with no overlap and no blank gap.
20. VLST grouped by state (windowed from the first paint). While scrolling:
    - the sticky group bands hand over correctly;
    - collapsing a group leaves no blank gap, and the collapsed group holds no rows in the DOM;
    - "Show more" in a middle group appends in place.
21. Keyboard in the virtual list:
    - ArrowDown 60 times moves focus row by row and the list follows;
    - End goes to the last loaded row and Home to the first;
    - scroll away with the wheel, then ArrowDown: the first press brings the focused row back into view, and the next press moves;
    - scroll away again, then Enter: the focused row's peek opens (Enter is not held back).
22. Selection: check three rows, scroll away and back: they are still checked, and the BulkBar counts 3. The group checkbox picks the loaded rows of its group.
23. Board grouped by state (each column loads 30 cards, so it is windowed):
    - a column holds at most about 12 cards in the DOM while scrolling;
    - drag a card from the middle to In Progress: the counts move by one;
    - a reload keeps the move;
    - scrolling smoothness is not judged by eye here: step 29's board scenario measures it.
24. Table, flat, 400 rows loaded:
    - the accessibility tree shows the table with row count 1500;
    - rows carry `aria-rowindex`; spacer rows are hidden;
    - header sort and the "Select all picks the loaded rows only" note work;
    - focus a row's key, scroll far away and back with the wheel: the focused row's cells still line up with the columns.
25. Gantt, 400 rows loaded:
    - rows virtualise (at most about 56 `.tessera-gantt-row` in the DOM);
    - dependency lines draw for rows in view and follow a bar drag;
    - press on a bar, scroll with the wheel while holding it, then move and release: the move commits;
    - `t` centres today;
    - the head and label column stay sticky.
26. Calendar:
    - Display → Zoom (Week, Month, Quarter) → Quarter at `cal=2026-11-10` shows "Q4 2026 (Oct – Dec)" with 14 week rows (Monday start: Sep 28 to Jan 3), and "Nov 1" / "Dec 1" labels; Sep 28 to Sep 30 and Jan 1 to Jan 3 are muted;
    - `]` → "Q1 2027 (Jan – Mar)"; `t` → today's quarter;
    - drag an item across a month boundary;
    - "+N more" opens; weekends off gives 5 columns;
    - at 375 px, quarter cells show "+N" only;
    - at desktop width, open a side peek so the calendar is under 600 px wide: quarter cells show "+N" only; close the peek and the item rows return;
    - week and month look as before (the week grid fills the panel);
    - save the view, reload: still quarter;
    - `TESSERA_DB_PATH=data/p12/acceptance.db npx tsx scripts/mcp-call.ts describe_filters '{}'` lists `quarter`.
27. Repeat 6 (Icons and labels), 7, 14, 17 and 26 in Latte and in Frappé: the rail names, the floating surface, shadow and hairline read in both, and so do the spacer-free table rows and the muted calendar days.
28. `env -u TESSERA_DB_PATH npm run perf:bench -- --db data/p11-perf.db` exits 0: decision 115's engine budgets are unchanged (the `PERF` project; if the database is missing, run step 29 first: its config seeds it).
29. `PERF_PORT=<assigned port> npx playwright test -c playwright.perf.config.ts` (after `next build`, on `data/p11-perf.db`) passes: `perf.spec.ts` gives p95 ≤ 300 ms for list, board and table grouped by state and for list and table flat; `virtual-perf.spec.ts` meets decision 138's scroll budget for the four scenarios. The report numbers, the load average, the report-only numbers (grouped by labels, Show more, jumps, HTML size) and the known gaps (CPU 4x, many-column boards, gantt first render) go into the reconciler's notes.
30. `E2E_PORT=<assigned port> npx playwright test` (the 25 existing spec files and the five P12 files) is green.
31. The console on every screen above shows only the tolerated Astryx Table warnings.

Afterwards: stop the server and leave `data/p12/` for the reconciler.

### 12. Risks

| Risk | Mitigation |
|---|---|
| Astryx changes the SideNav or AppShell structure, so the panel class, the nav remount, the drawer mode or the labelled-rail selectors (`> *`, `.astryx-side-nav-section`, `.astryx-side-nav-item[data-rail-label]`) move | The classes are documented theme targets. The `motion` and `sidebar` specs assert the widths (48, 60, 250), the tile size and the animation; §7 rows are re-verified on every Astryx upgrade (`astryx upgrade`). |
| `:has()` or absolute positioning inside a 0-width panel misbehaves | Chromium, Safari and Firefox support `:has()`. The panel keeps `overflow: visible` only in floating mode. The `sidebar` spec checks the panel's bounding box and that it covers content. |
| The nav remount on a Full ↔ rail or dock change drops focus | `refocusNav()` (decision 128) re-focuses the options button or the toggle two frames later; the `sidebar` spec checks focus after the menu picks and after Dock. |
| The floating panel's close paths fight each other (toggle click, focusout, outside press, dialogs, menus) | One live-DOM `floatingStaysOpen` check, the toggle-press flag and the one-frame deferred focusout (decision 129); `floating-nav.test.ts` covers every branch, and the `sidebar` spec covers the toggle click, the "+" dialog and the "…" menu. |
| The width animation re-lays out the content every frame: measured 20.3 ms median, 34.9 ms max per step on the 200-row list (decision 115 fixture), so it can drop below 30 fps | The jank guard finishes the animation when two of its first three frames exceed 34 ms (decision 132); the nav keeps its own width (`flex-shrink: 0`, decision 132), so it is not squeezed; V1 and V2 cut the rendered rows, and with them the cost per step. Real frame intervals were not measurable in a background pane, so acceptance step 3 checks the motion by eye and `layout-motion.test.ts` checks the guard (`isJanky`, `guardJank`). |
| The labelled rail is taller than the window (16 destinations scroll at 800 px, measured) | The rail scrolls like the Full sidebar; names clamp at two lines. |
| A nav value read through context breaks hydration of the streamed sidebar (error 418, round 6) | Every preference and the open flag are module stores read in the consumer (decision 130); `nav-prefs-store.test.ts`, `shell-collapse-wiring.test.ts` and the `round6` and `sidebar` specs cover early `mod+b`. |
| The floating panel opens by accident while aiming at content | The edge is only 8 px of wash, needs 120 ms of hover intent and only reacts to hover-capable pointers. |
| `scrollMargin` drifts for many group virtualizers, leaving blank gaps | One store measures every anchor in one rAF pass after any anchor registers and on every ResizeObserver change of the scroller or its first child; `overflow-anchor: none`. The `virtual-scroll` spec checks band and row adjacency after a collapse. |
| A focused row is unmounted by scrolling and focus drops to `<body>` | The kept-row rule through `rangeExtractor` (decision 135) and the navigation-key rule (decision 136); the spec covers it. |
| A kept row in the table loses its column widths | Table kept rows stay in normal flow between split spacers (`tableSegments`); the spec checks `position: static` and the manual step checks alignment. |
| A gantt bar drag loses pointer capture when its row leaves the window | The dragged row is in `keepIndexes`, and the pressed bar is also the focus-kept row (decision 135); a spec step drags across a wheel scroll. |
| TanStack's flush-sync scroll updates log a React warning in dev ("flushSync was called from inside a lifecycle method") | If seen, V1 sets `useFlushSync: false` in the hook (the only allowed change). The overscan keeps blank rows out of the perf spec. |
| Hidden `<Activity>` routes: a measurement of 0 px, or a stale window, when the route shows again | The store ignores passes while the scroller has no layout and re-measures when the ResizeObserver reports it again. The measurement guard keeps cached row sizes for elements without an `offsetParent`. The spec navigates away and back and checks that rows do not overlap. |
| A closing peek navigates after the user has already left the route, or twice | The slide is cancelled in a layout-effect cleanup (hide or unmount); a cancel never navigates; a finish navigates only if the URL is unchanged; the guard and `inert` stay until the URL has changed (§6.2.1); spec and acceptance step 14 cover it. |
| The peek slide remounts the lazy detail or restarts with the skeleton swap | Motion changes only props and WAAPI animations (§6.2.1, lane M rules); the `motion` spec delays the chunk, keeps the editor node once it appears and checks it survives a re-render. |
| Playwright hits hidden route copies | All P12 locators go through `visibleScroller`, the perf spec uses a fresh document per scenario, and DevTools commands select the visible scroller. |
| Find-in-page no longer finds off-screen rows, now for most lists (above 30 rows) | Decision 137: filter field, Power K, recorded in ui.md. The threshold is asked as a §13 question, because it trades find-in-page for decision 115. |
| Headless frame timing is noisy and the perf spec flakes | `channel: "chromium"` (the full Chrome for Testing 153.0.8010.12 in new headless mode, installed as `chromium-1243`; verified to launch here without a download), no other load, medians and p95, and zero long tasks as the hard gate. A flaky run is re-run once before it counts as failed. The frame budgets are estimates until V1.3 and V2 measure them; a real miss follows decision 138's fallback order, decided by the reconciler. |
| A virtualizer enabled after first paint (group expanded, threshold crossed, print ended) scrolls the shared scroller to the top | `initialOffset: () => scroller.scrollTop` (§6.3), re-verify point 12, and a `virtual-scroll` spec step that collapses and re-expands a group above the viewport and toggles print. |
| The first render misses 300 ms on another machine or under load | Measured margins at CPU 1x: list about 100 ms, board about 90 ms, table about 45 ms (row-cap probe, load average 1.4–5.8). `perf.spec.ts` reports the load average; a run over budget is re-run once on a quiet machine before it counts. If the table still misses, `INITIAL_OVERSCAN.table` drops to 0 (19 data rows, about −12 ms) before any design change. |
| The server window and the client's first render differ (hydration error) | Both come from `initialRange` over the same estimates and the store's server snapshot; `list-virtual.test.ts` hydrates server markup under a console spy, and the `virtual-scroll` spec watches the console. |
| A memo row re-renders on every range change because a prop is a fresh object or function | Rows take only primitives and stable references (§6.3). The `list-row-memo` and `board-memo` render counters fail on a fresh prop. The table re-renders each rendered row by Astryx design (`rowIndex`, `BaseTable.js:196`), and memo cells keep that shallow. |
| A many-column board (grouped by labels) or CPU 4x misses decision 115 | Recorded as known gaps (decision 138) and deferred to the follow-up lane (§1). Not gated in P12. |
| The estimates are off for real data (long titles wrap, other fonts) | Estimates only shape the first paint; the live window measures each row. A wrong estimate changes the first-paint row count, not correctness. The refresh measured 2–10% of 10k list rows wrapping to 65 px at 1280 px. |
| Quarter view hits the 1 000-item cap more often | The existing Banner explains it (`CalendarLayout.tsx:104-110`); filters narrow it (decision 112). |
| The peek close delays navigation by 280 ms plus the router's landing | It is skipped under reduced motion, and a second close is ignored. Browser Back stays instant. |
| A second perf-seeded project in one database fails: the big project is always named "Performance" (`seed-perf.ts:311`) | Lane 0 task 3 names it per identifier (`PERF` keeps "Performance"); `tests/seed-perf.test.ts` seeds two identifiers into one database. |
| The 1 500-item projects of `virtual-scroll.spec.ts` slow later specs: the items are assigned to the user (`seed-perf.ts:166, 231`), and `work-items.spec.ts` and `workspace.spec.ts` run after it | Each describe block archives its project in `afterAll` (`archive_project`). |
| The quarter draws up to 98 cells and 196 chips, and every Astryx Popover is a layer (field guide performance.md) | The four calendar popovers mount their content only while open (§6.4); lane C reports the month versus quarter load time on the 10 000-item fixture. |
| `@tanstack/virtual-core` moved from 3.17.11 (the API read) to 3.19.4 (the pick) | V1.1 re-verifies every §7 TanStack row on the installed `.d.ts` before layout work; a mismatch goes to the reconciler. |
| The download is not approved in time | Lane 0 merges without the install; N, M and C proceed; only V1 and V2 wait. |
| A file changes again before lanes start | Lanes re-read every owned file right before the first edit (field guide: the Edit tool refuses stale reads), and the "Still open before build" list says what to re-cite. |

### 13. Open questions

**Q1 (answered 2026-10-21: B).** The user chose Plane's three modes: the Full sidebar, a 48 px Icons only rail and a
60 px rail with a small label under each icon; the choice is remembered. Decision 128 holds it; §6.1.1 was merged
into §6.1 on 2026-10-29 and removed.

**Q2 (for the user, asked by the root planner before lane 0 task 2; blocks V1 and V2 only).** May Tessera download
`@tanstack/react-virtual@3.14.19` and its dependency `@tanstack/virtual-core@3.19.4`? Both are MIT, together about
554 kB unpacked, published 2026-10-13. Default: 3.14.19 (the newest patch at least 14 days old). The alternative is
3.14.13 with virtual-core 3.17.11 (2026-09-14), the version whose typings this contract was first checked against;
picking it changes only decision 134, §9 and lane 0 task 2, and V1.1 still re-verifies §7. Without the download,
lanes 0, N, M, C and Q proceed and V1 and V2 wait.

Every other choice in this contract is made. The defaults the user may want to revisit (each holds unless the user
objects; the root planner may ask them together with Q2):
- **Q3, the window threshold.** Windowing starts above 30 list or table rows, so Cmd/Ctrl+F finds only on-screen
  rows in most lists (the filter field and Power K still find every item). That is the price of decision 115's
  300 ms on 10 000 items. A higher threshold keeps find-in-page on more lists, and a list between 30 and the new
  value renders fully (about 105 ms + 3.3 ms per row).
- **The recorded gaps** (decision 138): CPU 4x, many-column boards and the gantt first render are not gated in P12;
  lazy per-row listbox content is a follow-up performance lane (§1).
- **The side peek** opens and closes with the list re-laid out at once and only the card sliding (a smooth width
  change measured 20 ms per frame on the 200-row list, and cover mode cannot resize smoothly).
- **The jank guard**: on a heavy screen a sidebar width animation jumps to its end when two of its first three
  frames exceed 34 ms.
- **The labelled rail**: names at 10 px, at most two lines, hover tooltips kept.
- **`mod+b` and the collapse button** switch between Full and the rail kind last picked (Icons only by default).
- **The help row** for `mod+b` reads "Collapse or expand the sidebar", with the note "Shows or hides it while
  undocked".
- **Other fixed values**: the floating hover edge (8 px, 120 ms), the calendar's items per cell (week 4 and month 4 as today,
  quarter 2) and the 600 px narrow quarter.

They are constants in `virtual-config.ts`, `floating-nav.ts`, `layout-motion.ts`, `calendar-math.ts`, `nav.css` and
`shortcuts.ts`.

### Still open before build (status 2026-10-29, HEAD `afe589c`)

The 2026-10-21 "Refresh before build" checklist is done: the other workflow landed, every citation was re-read and
re-cited, the file budget was measured (§8), the row heights were measured (`ESTIMATE`, `START`), the Playwright
browsers and the perf seed were timed (§8 Lane Q), and Q1 is merged. What is still open:
- **The `@tanstack/react-virtual` install** (§13 Q2): lane 0 task 2 runs only after the user approves the download.
- **The `.d.ts` re-check** (V1.1, first step): every point marked **re-verify** in §6.3 and §7 is confirmed against
  `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts` and `node_modules/@tanstack/react-virtual/dist/esm/index.d.ts`
  (the `.js` where the point is behaviour), with line numbers in the report. A mismatch goes to the reconciler before
  any layout work.
- **Moved lines.** If any file this contract cites changes before its lane starts, the lane re-reads it and the
  reconciler re-cites the lines; re-run `wc -l` on the §8 files and split verbatim any file a lane would take past
  560 lines.
- **Scroll baselines.** Decision 138's frame budgets are estimates until V1.3 (list) and V2 task 4 (table, board, gantt) measure them; the reconciler applies the fallback order.
- **Estimates.** Re-measure `ESTIMATE` and `START` only if `work-items.css`, `board.css`, `table.css` or `gantt.css`
  changes row padding or sizes before V1.

### Review log (2026-10-21)

Two reviews of the first draft: an API review (7 points) and a consistency review (30 points: H1–H3, M1–M15, L1–L12).
This log is history: it records the draft at `e04b840`. Where it names a line that moved, the `afe589c` line is given too, and section references such as §6.1.1 point to the draft (§6.1.1 is now part of decision 128 and §6.1).
Each point was checked against the code. Accepted points are folded into the sections named; rejected or partly
rejected points carry a one-line reason.

**API review**
- 1 `--duration-medium-min` is 225 ms in the theme: **accepted**. P12 uses `--duration-medium` (280 ms, `catppuccin.css:240`), the closest to 300 ms (decision 132, §5.2, `nav.css`, §7, §12, `motion` spec).
- 2 `data-index` must be a string: **accepted** (`BaseProps.d.ts:33`). `VirtualRowProps["data-index"]: string`; the table uses `dataIndexAttr` with its one cast (§6.3).
- 3 custom-property keys need `cssVars`: **accepted**. A shared `src/components/shared/css-vars.ts` is added (lane 0, §5.3), and the token-gate paragraph is updated.
- 4 grouped header rows are Proxies: **accepted**. `VirtualTable` gets `idOf = groupedRows.idKey` and passes the same row objects (§6.3, V2 tests).
- 5 `:last-child` drops the last divider: **accepted**. `data-virtual-open-end` plus a `virtual.css` rule (decision 135, §6.3).
- 6 gantt row height is only a minimum: **rejected**. `gantt.css:181-184` (`:107-110` at `e04b840`) sets both `min-height` and `height` to `--tessera-gantt-row`, so rows are fixed. The coarse-pointer 44 px variant (`gantt.css:40-43`; `:22-26` at `e04b840`) is now named, and the single measurement picks it up.
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

### Review log (2026-10-29 refresh and integration)


Three contract planners refreshed their parts at `afe589c` (shell: N, M and the shell facts; virtual: V1, V2 and the
list facts; calendar, tests and docs: C, Q, lane 0). The integrator merged them into this file, resolved the
conflicts below, re-checked the citations, and fixed the planner errors it found. Every point was checked against
the code at `afe589c`.

**What each planner changed**
- Shell. Q1 = B merged into decision 128 (the old §6.1.1 is gone). The labelled rail is CSS on Astryx's collapsed
  rail: a 60 px rail with 52 × 44 px tiles, measured. The nav preferences and the floating open flag follow round
  6's streamed-subtree rule. `tessera.nav.v1` gains `rail` and still reads the draft shape. The docked width
  animation keeps the nav at its width and has a jank guard (20 ms per step measured on 200 rows). The side peek
  slides its card instead of animating its width, because of cover mode's `min-width: 100%` and decision 142's
  lazy detail. The token is `.28s` in the built CSS. All shell citations were re-read.
- Virtual. Decisions 135 and 138 were redesigned from the perf data and a row-cap A/B with `perf.spec.ts` (n = 20):
  - thresholds 30/30/40/8;
  - a server-rendered initial window;
  - memoised per-row props (extends decision 141);
  - collapsed groups mount no rows;
  - a scroller store;
  - `ESTIMATE` and `START` measured at 1280 px in Latte and Frappé.
- Calendar, tests and docs (R1–R13 of that refresh):
  - the decision 139 schema edit moved to lane C, because alone it breaks `tsc` (`paging.ts:63`,
    `CalendarLayout.tsx:71`);
  - lane 0 splits `schemas.ts` (594 lines) first;
  - `data-zoom` was dropped for the existing `data-view`, and the week `min-height` rule for the existing stretch
    rule;
  - week keeps today's muted days;
  - the narrow quarter reuses `useNarrowContainer`;
  - the calendar popovers mount content only while open;
  - the perf gates reuse decision 115's harness;
  - Q's helpers go in `helpers-p12.ts`;
  - the perf seed names its project per identifier;
  - seeded spec projects are archived;
  - the missing `schema.md:102` and the as-built close-out were added.

**Conflicts resolved by the integrator**
- Decision 134. Version 3.14.19 with virtual-core 3.19.4, by the contract's own "newest patch at least 14 days old"
  rule, with the lint facts (`incompatible-library`, `set-state-in-effect` on layout effects) and the React
  Compiler revisit. V1.1 runs the re-verify list. 3.14.13 / 3.17.11 is the alternative named in Q2.
- Decision 138. The virtual planner's two-part gate, written by hand:
  - first render through `perf.spec.ts` (default browser) for list, board and table by state, plus list and table
    flat;
  - scroll through `virtual-perf.spec.ts` on `channel: "chromium"`;
  - the rendered-row caps live once, as `MAX_RENDERED` in `helpers-p12.ts`.

  The calendar planner's "table and board recorded only" and its claim that windowing cannot bring the table under
  300 ms were rejected: the row-cap probe measured the table at about 254–257 ms with 22 rows.
- `perf.spec.ts`. Lane Q edits its scenario list only. The "not edited" sentences in §8 and Lane Q were changed to
  say so.
- Ownership: one owner per file per lane.
  - The schema edit, `view-settings.ts`, `ai.md`, `schema.md` and the `url-state` / `view-settings` tests go to C.
  - `command-source.ts` is not edited; the commands go to N's new `sidebar-commands.ts`.
  - `fixtures.ts` is not edited; Q's helpers go in the new `helpers-p12.ts`.
  - V1 owns `WorkItemsScreen.tsx`, `ListLayout.tsx` and the new `virtual.css`. No lane edits `work-items.css`.
  - N owns `Sidebar.tsx`, `RailParts.tsx`, `FavoritesSection.tsx` and the deletion of `nav-collapse-store.ts`.
- Lane 0 tasks 6 and 7 use the shell planner's test lists (they match §5.1 and §5.2). Task 1i uses the shell
  planner's ui.md text plus the calendar popover rule. The close-out names no `NavRail` (there is none) and adds
  `sidebar-commands.ts`, `peek-motion.ts`, `css-vars.ts`, `print-store.ts`, `BoardColumn`, `table-cells.tsx`.
- Merge order:
  1. lane 0 task 0;
  2. the rest of lane 0;
  3. N, M and C in parallel, and V1 once the install is in;
  4. V2 after V1.1, V1.2 and V1.4;
  5. Q;
  6. the close-out.

  The reconciler runs `live:update` after each green batch.
- `motion.spec.ts`. The shell planner's version (parse the token, the card slide), plus the calendar planner's wait
  for the lazy detail heading before Escape and the fade on a calendar zoom change.
- §7, §12 and the deferral table. Rows composed from all three, with duplicates removed (Card ref, `cssVars`,
  `flushSync`, `BaseProps`, Stack ref, Playwright, the TanStack rows, the server-side preferences row). The Q1 risk
  row was removed. "Another workflow" became "a file changes again before lanes start".

**Planner errors corrected**
- swarm.md lines. The calendar planner's citations (`:65`, `:74`, `:97`, `:102`, `:53-57`, `:38-51`) were off by
  26. They are now `:39`, `:48`, `:71`, `:76`, `:27-31`, `:12-25`, and `:44-48` and `:57-69` in Sources.
- The WEB project as the below-threshold case. In `data/e2e.db`, WEB has the 40 demo items (`seed.ts:103-104`), so it
  is windowed. `virtual-scroll.spec.ts` uses a seeded `VS` project with `Math.min(VIRTUAL_LIST_MIN, ROW_PAGE)`
  items instead.
- §6.2.1 set `isClosing` in a layout effect on `here`, which `react-hooks/set-state-in-effect` rejects. Now:
  - the state is `closingHref`, set in `close()` and cleared only in the animation's promise callbacks;
  - `isClosing` is derived during render;
  - the URL and cleanup effects touch only `motionRef` and `animation.cancel()`.
- Acceptance. The setup no longer seeds an unused 10 000-item `VIRT` project (steps 28 and 29 use
  `data/p11-perf.db`). Step 29 takes the assigned port. Step 28 says how to get the database.
- The width-animation risk row. It no longer cites a `motion` spec trace that does not exist.

**Citation check (2026-10-29).** Every `file:line` in this file was extracted by a script and printed at `afe589c`
with read-only commands. A person compared the cited lines with the claims, covering all of §5 and §8 and a sample
across the other sections. The fixes are listed above and in the "Still open before build" section.

### Review log (2026-10-29, contract fix)

A review of the integrated contract raised 29 findings (4 high, 13 medium, 12 low). The contract fixer checked each
against the code at `afe589c` (read-only), the perf data in `docs/drafts/perf-report-2026-10-28.md` and the refresh's A3–A5 measurements, and, for TanStack behaviour, a local read-only copy of
`@tanstack/virtual-core` 3.13.23 (no download; V1.1 still re-verifies on 3.19.4). The pre-fix text stayed in the
session's scratch folder and is not committed. All 29 were accepted; three were narrowed, as noted.

High
- F1 `canQuickAdd` through `useStableCallback` is called during render: **accepted**. Confirmed at `ListLayout.tsx:365`, `BoardLayout.tsx:217`, `CalendarLayout.tsx:169` and `stable.ts:15-25`. §6.3 Screen now says only event handlers go through `useStableCallback`; `canQuickAdd` is a `useCallback` over a memoised `quickAddContext`; `BoardColumn` gets a boolean `canAdd`. V1.2 has the "never called while rendering" check and `work-items-screen.test.ts` a first-render case.
- F2 `bounds.current` and the kept-index ref are read or written in render (`react-hooks/refs`): **accepted**. `react-hooks/refs` is in the recommended preset (`eslint-plugin-react-hooks.development.js:18232-18238`). The kept row is now `useState` set from `onFocusCapture`; the bounds come from `virtualizer.range`; the extractor writes nothing (§6.3). Decision 134 and V1.1 require lint-clean code and name the approach.
- F20 an instance enabled after first paint scrolls the shared scroller to the top: **accepted**. Confirmed on 3.13.23 (`index.js:322-362, 373-379`; a disabled instance also clears its size cache, `:437-445`). Added `initialOffset: () => scroller.scrollTop`, re-verify point 12, a `virtual-scroll` spec step (collapse and re-expand above the viewport, print and back) and a §12 risk row.

Medium
- F3 Power K versus the overlay: **accepted, narrowed**. Decision 131 already hid the view commands while floating; the contradiction was decision 129 naming Power K as an opener. Decision 129 now says no command opens the overlay; decision 131 states the overlay-mode rule and the stale-selection case; `sidebar-commands.test.ts` and `sidebar.spec.ts` cover it.
- F4 `menuOpen` matches an expanded favourites folder: **accepted**. Confirmed: `FavoritesSection.tsx:144`, `SideNavItem.js:500, 527, 551` (plain `aria-expanded`), `DropdownMenu.js:884-885, 924-925` (menu triggers carry `aria-haspopup`; `MoreMenu` uses `DropdownMenu`). New `MENU_OPEN_SELECTOR`, a jsdom case and a spec step with a folder.
- F5 the table header is already sticky: **accepted**. Confirmed `table.css:38-56`, `board-table-css.test.ts:121-128`. "What already exists" and decision 136 corrected; the test stays unchanged; the header height feeds `scrollPaddingStart`.
- F6 `scrollToIndex` ignores CSS scroll padding: **accepted**. The store reads the scroller's computed `scroll-padding-block-start` (`work-items.css:271-273, 429-431`), the hook passes `scrollPaddingStart` (plus the `thead` height for the table), re-verify point 13, and spec steps check the row lands below the band or header.
- F7 lane N test ownership: **accepted, narrowed**. `sidebar-links.test.ts` and `assistant-undo-palette.test.ts` go to N. The second already shims `matchMedia` (`:43-53`); its real break is that `CommandBar` would call `useShell()`, which throws outside `TesseraShell` (`TesseraShell.tsx:41-46`), so it gains a `useShell` mock. `isSidenavDrawer()` (§5.2) guards `matchMedia` in shell code.
- F8 `board-table-fixes.test.ts` has no owner: **accepted**. Given to V2; `BoardCard` keeps every prop except `bundle` (§6.3 Board).
- F9 hooks without a provider: **accepted**. A default store that never virtualises, inherited by nested board providers (§6.3, decision 135). The five tests go to V1 or V2 and must pass unchanged. Also found: `gantt-dates-lazy.test.ts:33` imports `GanttDates` and `row-truncation.test.ts:20-29, 64-72` reads `TableLayout.tsx` and `GanttLayout.tsx` source; both go to V2, which moves that code.
- F10 decision 139 week 8 versus "week and month as before": **accepted**. Week stays at today's 4 (`CalendarLayout.tsx:46`); only the quarter is new (2). Decision 139, §6.4, the tests and §13 changed. No existing test asserted the week limit.
- F11 and F23 the scroll thresholds are unmeasured estimates with no fallback: **accepted, merged**. Decision 138 says the 17.5 / 34 / 50 ms numbers are estimates, adds baseline runs (V1.3 list, V2 task 4 table, board, gantt) and a fallback order decided by the reconciler; zero long tasks is relaxed only by the user. §10, §12 and "Still open" point to it.
- F21 `measureRef` during the unmeasured phase: **accepted**. `measureRef` is `undefined` until `isOn && isMeasured`, and `list-virtual.test.ts` checks every rendered row reaches `measureElement` after the first measure. Note: 3.13.23 does cache such a node (`elementsCache`) and observes it on enable, so the failure may not happen there; the rule holds in any version and costs one re-render per initial row (re-verify point 14).
- F22 the near-viewport gate goes stale: **accepted**. "Near" is a store boolean recomputed by a rAF-coalesced `scroll` listener and read with `useAnchorNear` (§6.3, decision 135); confirmed on 3.13.23 that the host re-renders only on `isScrolling` or range-index changes (`index.js:283-304`). Store test and spec steps added.

Low
- F12 `parseNavPrefs` draft-shape branch: **accepted**. Removed from decision 130, §3, §5.1 and lane 0 task 6.
- F13 `scripts/bundle-baseline.json` has no owner: **accepted**. The reconciler owns it, after V1 and after V2, for virtual-code growth only (5% tolerance, `scripts/check-bundle.ts:11, 34`).
- F14 `PLAN-STATUS.md:21` says "about 50 list rows": **accepted**. Lane 0 task 1g fixes it.
- F15 lane Q contact points are a guess: **accepted**. Q starts with a dry run of the existing suite after V1 merges.
- F16 "1 work items": **accepted**. Singular for one, in decision 139, §6.4 and the tests.
- F17 the ui.md summary's sources: **accepted**. Lane 0's prompt and task 1i list the §6 parts it summarises.
- F18 and F26 `panel` in PeekHost and the `useGanttMetrics` caller: **accepted**. Close step 3 uses `cardRef.current` (`PeekHost.tsx:236`: `panel` is the `useResizable` result); `GanttLayout` stays the single caller of `useGanttMetrics` and passes `metrics` to `GanttRows`.
- F19 two frames may be too few after Home/End: **accepted**. A per-frame loop re-issues the scroll until the target row is mounted and still for two frames, at most 20 frames (decision 136, §6.3).
- F24 the in-render ref reads must stay inside `useVirtualRows`: **superseded by F2**. F2 and F24 disagree on whether lint fails today; this was not probed, because after F2 no ref is read in render at all, so the code is lint-clean either way and the React Compiler revisit concerns only the `incompatible-library` line (decision 134).
- F25 `board-memo.test.ts` contradicts windowing: **accepted**. Split into the unwindowed column (no card re-renders) and the windowed column (only cards whose index changed).
- F27 the lazy skeleton swap lands after the slide: **accepted**. Decision 132 (4), §6.2.1, the `motion` spec step and the §12 row reworded.
- F28 header numbers: **accepted, with a corrected recompute**. 902/915 and 1,653/1,643 are `perf.spec.ts`'s grouped 250-row page (`perf.spec.ts:39-43`); the flat 200-row page is 754 / 1,265 (sweep) or 770 / 1,278 (A3). Refitting the sweep at 25–100 rows gives the table 117–121 ms + 5.3–5.6 ms per row, so 279–284 ms at 30 rows (the review said 279–288); measured 257 ms for 30 entries. Header, "Tests and tooling" and decision 135 corrected.
- F29 `getKey` is a new function per render: **accepted**. Every caller passes a `useCallback`; the hook passes `getKey` itself as `getItemKey` (the old text wrapped it in a new arrow); confirmed on 3.13.23 that `getItemKey` keys the measurement memo (`index.js:408-415`); re-verify point 9 extended (`gap` is not a key there).
