# UI contract

Owner: lane A for this document; the code is split between lanes B (shell), C (work items), D (detail, editor, pages), E (planning), F (views, analytics, settings) and G (AI) per `docs/contracts/OWNERS.md`. Astryx rules in `.cursor/rules/astryx.mdc` apply to every file: no raw `div`/`span` layout, components and tokens only, Phosphor icons through `src/themes/catppuccin/icons.tsx`, no xstyle, no hex, no px except structural widths.

## Route groups

```
src/app/layout.tsx                 fonts (next/font) + <Providers> only (no app frame)
src/app/(tessera)/layout.tsx       Tessera frame: TesseraShell (AppShell, TopBar, SideNav, content panel, ToastViewport) + the streamed sidebar and ChangesPoller + RecentsTracker
src/app/(tessera)/page.tsx         Tessera Home at / (`/home` is a permanent redirect to /, next.config.ts)
src/app/(tessera)/projects/...     see docs/PLAN.md §5 for the full route list
src/app/api/changes/route.ts       GET ?since=<seq> → { changes, cursor, unread_notifications }
```

There is no handbook frame any more: the legacy `(handbook)` group and its routes were deleted when Home moved to `/` (P6). There are no tabs either: the shell keeps navigation history as recents (`recents.ts`, "Shell" below).

## Data flow (from docs/PLAN.md §7)

- **Reads**: a page is a synchronous Server Component shell that renders `<Suspense fallback={<Skeleton …/>}>` around an async child. The child awaits `params` / `searchParams`, then `await io()` (from `next/cache`, bundled doc: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/io.md`), then `readTessera((ctx) => …)` from `@/lib/tessera/server`. Never read the database in a layout without the same pattern.
- **Mutations**: client code calls a typed wrapper exported from `src/app/actions/<domain>.ts` (file-level `"use server"`, `export const moveWorkItemAction = toolAction("move_work_item")`). The wrapper validates, runs the tool as actor `user`, calls `refresh()` and returns `ActionResult`. On `{ ok: false }` the caller shows a `Toast` with the message. Never `router.refresh()`.
- **Optimistic UI**: board, list reorder, calendar and gantt moves use `useOptimistic` + `startTransition`; on failure the reducer state reverts and a Toast appears.
- **External writes**: `ChangesPoller` (client, in the Tessera layout) polls `GET /api/changes?since=<cursor>` every 5 s while the tab is visible; the initial cursor comes from the page's `ListResult.cursor`. When a change by an actor other than `user` arrives it calls `refreshAction()` (a Server Action that only calls `refresh()`).
- Server Actions are serialised per client, so description autosave (P2b) never blocks a move; autosave goes through the POST routes.

## ProjectBundle and ProjectProvider

`src/app/(tessera)/projects/[projectId]/layout.tsx` loads once, under Suspense with `await io()`:

```ts
type ProjectBundle = {
  project: Project;            // from projects.ts
  states: State[];
  labels: Label[];
  cycles: Cycle[];             // non-archived
  modules: Module[];           // non-archived
  actors: Actor[];
  cursor: number;              // latestSeq at load
};
```

It renders `<ProjectProvider bundle={bundle}>` (client context in `src/components/work-items/project-provider.tsx`, lane C) and `<ProjectFrame>`: the panel header (`PanelHeader` with one 52px `PanelBar`, "Panel headers" under Shell) holding the project token, the project name (`PanelTitle`, the page's h1 except on a work item or project page detail, where it is level 2: see "Panel headers" under Shell), a vertical divider and the section `TabList` (`size="sm" layout="hug"`, docked on the header hairline) for Work items, then Cycles / Modules / Views / Pages / Intake according to the feature toggles, then Archives and Settings (`projectTabs`, `project-tabs.ts`). The strip has three width bands (decision 14, `shell.css`; the viewport width stands in for the panel width). From 1280px: labelled tabs on the single 52px row. From 600 to 1279px: the bar is a two-row grid (the token, the name and the end actions on a 44px first row, the strip full-width on the second, docked on the hairline); only the current tab keeps its label and the other tabs fold to their icon, each keeping its label as `aria-label` and showing it in an Astryx `Tooltip` (`focusTrigger="always"`, because the roving strip gives the other tabs `tabindex="-1"`; enabled only in that band through `useMediaQuery`, so the server renders none); under a coarse pointer the folded tabs are 38px drawn and 44px high with the theme's 44px hit areas at a 44px pitch (`column-gap: var(--spacing-1-5)`; the boxes touch without overlapping, no tiling). Below 600px (`max-width: 599px`): the strip is `display: none` and a `SectionMenu` (`src/components/shell/SectionMenu.tsx`) takes the second row (`grid-area: tabs`, 44px, its text on the 16px inset): one ghost sm button with the current section's icon, label and a caret, whose menu (an Astryx `DropdownMenu` in compound mode, 240px wide, named `<project> pages`) lists every section as a link with the current one marked `aria-current="page"` and a check, Intake keeping its count Badge; Enter or Space opens it, the arrows move, Enter follows the link, Escape closes it and returns focus to the button. Both renders stay mounted and CSS picks one (`.tessera-panel-bar .tessera-section-menu` is hidden from 600px), so nothing flips on hydration. `tests/ui/project-tabs-css.test.ts`, `tests/ui/section-menu.test.ts` and `tests/ui/shell-detail-css.test.ts` read the rules. The tabs are the project's only page navigation (the sidebar lists projects as flat rows); project-wide actions (the favourite star and the project menu) go in the bar's `end`. The frame's content is one scrolling `LayoutContent`. Every property control reads the bundle from `useProject()`; nothing fetches lists client-side except search typeahead.

## Work items screen (lane C)

`WorkItemsScreen` (client) owns the filter bar, the display menu, quick-add and the layout switch. The server page passes `result: WorkItemListResult`, the resolved `display`, `filters` and the `view_settings` defaults. It is a fill `Layout` whose `PanelHeader` stacks two rows: the 44px sub-header (`PanelBar size="subheader"`: "Work items" and the total as a purple `Badge`; at the end `LayoutSwitch`, the display menu and the primary sm "New work item") and the 44px filters row (`PanelBar size="filters" hasDivider` with the filter bar). Only the layout below them scrolls.

URL state: one `q` search param holding base64url-encoded JSON `{ filters?: Filters, display?: Partial<Display> }`, encoded and decoded by `src/components/work-items/url-state.ts` (zod-validated; invalid → ignored). The server merges: defaults ← `view_settings(project, projectId)` ← URL. Changing the display menu writes the URL (`router.replace`, no scroll) and calls `saveViewSettingsAction` so the choice is remembered.

Every layout component receives the same props:

```ts
type LayoutProps = {
  result: WorkItemListResult;              // items, total, cursor, groups (when grouped)
  display: Display;
  bundle: ProjectBundle;
  onMove: (input: MoveInput) => void;      // optimistic; MoveInput = { id, group_by?, value?, from_value?, before_id?, after_id? }
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void;   // inline property edits
  onOpen: (id: string) => void;            // P2a: navigates to /projects/[projectId]/work-items/[workItemId]; P2b switches to ?peek=<id>
  onQuickAdd: (group: { field: GroupBy | null; value: string | null }, name: string) => void;
};
```

Files: `ListLayout.tsx` (List/ListItem rows grouped with collapsible headers), `BoardLayout.tsx` (columns per group, sub-groups as swimlanes, pointer DnD through `src/components/dnd/use-pointer-drag.ts`), `TableLayout.tsx` (Astryx `Table` with `useTableGroupedRows`, `useTableSortable`, `useTableColumnResize`, inline edit via `renderCell` returning ghost controls). `CalendarLayout` and `GanttLayout` arrive in P10 with the same props.

List rows (`ListLayout`): the title is `RowTitle` (`OneLineText weight="medium"`, class `tessera-wi-title`) inside `ListItem`'s label; it is cut to one line by a CSS ellipsis in `work-items.css` (the four declarations of Astryx's Text singleLine style, shared with the state, priority, assignee and group-marker labels through `tessera-wi-label-text`), not by Astryx `Text maxLines`, because Astryx 0.6.8 measures every `maxLines` Text on mount (a forced layout each, even with `hasTruncateTooltip={false}`), thousands in a long list; a cut title still shows in full in a tooltip, as Plane's does: `OneLineText` (`work-items/OneLineText.tsx`) measures it only once the mouse has rested on it for the tooltip delay and then opens an Astryx sibling-mode `Tooltip` (mouse only, like Astryx's own truncation tooltip on a Text that is not focusable); the full title also stays in the DOM and the peek shows it; `work-items.css` gives the label slot `min-width: min(14rem, 100%)` (16rem until the layout rework merge, where it put the title under its key in the list beside a side peek at 1100px) and lets the row wrap, so properties move to a second line (kept at the end) instead of squeezing the title; on a line narrower than the chips (a phone) the chips wrap too. Selectors reach Astryx's slots only through our own classes (`:has(.tessera-wi-title)`, `:has(> .tessera-wi-props)`). Rows are at least 44px; the key is supporting-size, secondary and tabular; the row's end inset is the panel header's 16px (`padding-inline-end: --spacing-4`), so the last chip ends where the header actions do, and the start inset is 12px because the select checkbox and the key button bring their own. A group header is a 40px muted band: the `Collapsible` trigger (Astryx's documented `astryx-collapsible-trigger` class, scoped under `.tessera-wi-group`) is sticky, so the band stays at the top of the list while its group scrolls under it. In a row the compact ghost controls (selectors, and the date buttons through their own `tessera-wi-chip` class, so a selector's clear button keeps its Astryx look) read as chips: 24px, a control outline (`--color-border-emphasized`, 3:1 or more on every surface), `--radius-inner`, supporting-size text, no chevron (`.tessera-wi-props` rules in `work-items.css`); the detail keeps the full controls. The band sets only `background-color`, so the trigger's pressed overlay still shows, and the list scroller (`tessera-wi-scroller`) has a `scroll-padding-block-start` so focus moved into view is never hidden under a band; the detail body gives its descendants the matching `scroll-margin-block-start` under the pinned detail header.

Board (`BoardLayout`): columns 350px wide but never wider than the strip's content box (`COLUMN_WIDTH` is `min(350px, 100cqw)`, the strip is the size container; `board.css` repeats it as `--tessera-board-column-width`), so a phone shows one full column and snaps from column to column below 480px; 16px gaps on a muted backdrop whose corners are concentric with the 8px cards (12px padding) inside them. Table (`TableLayout`): the first column's text lines up with the panel header's 16px (`table.css`): the selection checkbox when it is on, else the key; the Key header and the key text start at the same x (the key cell pads `--spacing-1` since its open button brings 12px, the header `--spacing-4`). No results: while a filter, a search or an Advanced tree is active, an empty list, board or table shows "No work items match these filters" with a "Clear filters" button (`NoResults`, `clear-filters.ts`: simple filters get explicit empty values and the Advanced tree drops, as with the filter bar's Clear and the Advanced remove button); with no filter active the first-run state stays. The filter bar's Advanced button reads "Advanced · N conditions" while a tree applies (with a remove button next to it); a tree the builder cannot show opens read-only with its summary and Clear all, without Add condition or Add group.

Paging (P11, decisions 112 to 114): the loaders pass `listPaging(display, cal, today)` (`work-items/paging.ts`, built on `pageSizeFor`) to `listWorkItems`: 50 rows per group on a grouped list or table, 30 cards per board column and lane cell (25 and 20 when the grouping or sub-grouping is multi-valued: labels, assignees, modules; `groupPageSize`, also the "Show more" step), 200 rows for an ungrouped list, board, table and gantt, 1000 for the calendar, which loads only the items targeted in the shown period (`?cal=`, `calendarWindow`: the whole weeks of the month or the week) plus the unscheduled ones through `calendar_window` (a `Banner` says when it is cut). `usePagedList` sends the effective rich filter tree (`effectiveRichFilters`: the screen's own tree, else the URL's) with every "Show more" and re-request. Group counts, `total` and `has_more` are exact over the whole filtered set, so a group header `Badge` shows the full count and the optional `estimate_points` sum ("N pts", `GroupPoints`). `WorkItemsScreen` runs `usePagedList` (`use-paged-list.ts`) between the server result and `useOptimistic`. `GroupFooter` ("Show 50 more (70 hidden)", ghost sm button, `isLoading`) sits under a list group, in a board column or lane cell, under an ungrouped list, table or gantt, and inside a grouped table's group header; it calls the read action `listWorkItemsAction` with `group_value` (+ `sub_group_value`), `offset` and `limit` and merges the page (`mergeGroupPage`, `mergeRowsPage`). A write refreshes the page with a new first page: the hook keeps the rows an expanded group had loaded (`keepLoaded`), re-requests them in one `group_limits` call (`refetchPlan`, keys from `groupLimitKey`) and swaps the answer in; a change of filters, display or scope starts over. A drop at the end of a group with `has_more` passes `before_id` = the last loaded card, so the engine places it right behind that card; optimistic counts move by one between groups (`optimistic-list.ts`). The bulk bar says "Loaded rows only (50 loaded of 120)" while rows are unloaded. `[data-list-ready]` marks the list, board and table roots for the perf spec. Styles: `styles/paging.css`.

Property controls live in `src/components/work-items/properties/` and are reused by the detail panel (lane D) and bulk bar (lane E): `StateControl`, `PriorityControl`, `AssigneeControl`, `LabelControl`, `DateControl` (start or target), `CycleControl`, `ModuleControl`, `EstimateControl` (P8). Each takes `{ value, onChange, bundle?, compact?, readOnly? }` and renders a ghost `Selector` / `MultiSelector` / `DateInput`; the compact `DateControl` (the date chip) mounts its `DateInput` only while its `Popover` is open, since Astryx 0.6.8 `Popover` has no lazy prop and kept a full calendar mounted behind every closed chip (two per row with both dates shown); state shows a `StatusDot` by group, labels and cycles show `Token` with the palette colour, priority shows the Phosphor priority icon.

Create dialog: `CreateWorkItemDialog` (Astryx `Dialog` + `FormLayout`): name, description (plain `TextArea` until the editor lands in P2b), state, priority, assignees, labels, cycle, modules, dates; "Create more" keeps it open; closing with a dirty form asks "Save this draft?" (P8 wires drafts; until then the dialog just confirms discard). Quick-add: inline row at the bottom of a group / column that creates with that group's value.

Filter bar: Astryx `PowerSearch` tokens for state, priority, labels, assignees, cycle, module, dates, text, in the filters row. The layout switch is `LayoutSwitch` (`DisplayMenu.tsx`): an icon-only sm `SegmentedControl` (List, Board, Table) in the sub-header, writing through the same `useDisplayWriter` as the display menu. The display menu is a `Popover` with `Selector`s for group / sub-group / order / properties.

Visual alignment rules for the layouts (audit round, 2026-10-22; the touch rule is decision 14, option A, under Theme):

- List, group header gutter: below 481px or under a coarse pointer the group dot and the quick-add text start 8px further right (key text at x=65 at 375), because the row's select checkbox keeps a 44px hit area (its input is 44px about a 20px box, so the key button starts 8px further right to meet it instead of overlapping). At 1440 the marker is at the key's x (307). The key and the title keep one line down to 360px (title minimum `min(10rem, 100%)` under touch); a group band is a 44px target (the collapse trigger).
- List, filter field on touch: each token's label and cross is a 44px hit area (equal negative margin through the theme), wrapped token lines are 44px apart (8px row gap), and the PowerSearch suggestion options (`.astryx-typeahead-dropdown [role=option]`) are at least 44px. A positioned input keeps the field's input the top element at its own centre despite the tokenizer's hit area.
- Board: the column head is 44px on a desktop (the 28px title row, 8px above, 7px below, and the 1px divider) and keeps that under a finger, where the add button's hit area is the theme's pseudo-element; cards rest on `--shadow-low` and lift on hover. The card is not a whole-card touch grip: a touch drag starts only from `.tessera-board-card-grip` (44x44, shown under `(pointer: coarse), (max-width: 480px)`, the only part with `touch-action: none`), while a mouse or pen drags from anywhere on the card. The card menu is dimmed (`opacity: 0`) until hover or focus-within, always on under `(hover: none)`; the strip snaps mandatory at 480px and narrower.
- Table: the header is sticky against `.tessera-wi-scroller` (the Astryx scroll wrapper is `overflow: visible` here, so the work items scroller is the container a sticky header is measured against); the key and selection columns are pinned only at 768px and wider (`(min-width: 768px)`, on a phone the whole row scrolls); the Name column has a 240px floor (`proportional(2, { minWidth: 240 })`), and its cells and the Project column's are `OneLineText` with the `tessera-wi-cell-text` one-line class inside the Table's `textOverflow="truncate"`: one line with an ellipsis and, when cut, the full text in a tooltip measured on hover only (no `maxLines`, for the same reason as the list rows). The side peek's row (table) and card (board) are marked `aria-current` with an accent edge.
- Side peek on a narrow container: below `PEEK_COVER_BELOW` (the 360px minimum panel plus 280px kept for the list, `peek-cover.ts`) the panel covers the list as it does on a phone (`tessera-peek-panel--cover`), so the board strip or table is not squeezed into a sliver at 768px. The threshold is a fixed container width, so dragging the resize handle never flips the mode.
- Group headers follow Plane: the group name sits right after the group's icon or state dot, not on the rows' title column (L3, decided 2026-10-23).
- Timeline (gantt, modules timeline, calendar): a gantt or modules bar is the state's (or the module status's) colour at 25% over the surface with a border in that colour, and its label is primary text (4.65:1 or more in Frappé, 4.92:1 or more in Latte; secondary text drops under 4.5:1 on the tint). The label column and the calendar's toolbar, weekday row and grid use the 16px gutter. The calendar's today marker is a 20px accent circle. Touch targets for gantt rows, bars, handles and calendar controls are 44px under `(pointer: coarse), (max-width: 480px)` (decision 14), with the 1440 look (32px rows, 28px buttons) unchanged. Gantt bars and calendar chips carry `touch-action: none` only under `(pointer: fine)`: on touch the bar or chip scrolls, the resize handles stay grips, and the move paths are the Set-dates popover (gantt) and the open detail panel (calendar, where the Move button is inert without hover). The Set-dates popover of a gantt or modules-timeline row mounts its two date fields only while it is open (Astryx 0.6.8 `Popover` keeps closed content mounted, which put two calendars in every row), and the band labels, row names and bar labels are `OneLineText` with a one-line class in `gantt.css` (tooltip when cut, measured on hover), not `Text maxLines`.
- Calendar chips and week view (fix round 2026-10-23): every chip has the pointer cursor, because a click opens the peek, an archived (read-only) chip included; only a chip that can be dragged (`data-draggable`) gets the grab and grabbing cursors, and a read-only chip has no Move control either. On touch, a tap on a chip opens the peek and the Due date field moves it; the chip has no Move control at phone width (the field is the peek's Target date; picking a day there moves the chip to it without a reload, because the action's `refresh()` re-renders the calendar). The week view's one row of cells stretches to the panel's height at 481px and wider (visual audit T11; 493px tall at 375 was too tall); at 480px and below, `@media (max-width: 480px)` in `calendar.css` lets the week block and its row take their own height again (`grid-auto-rows: auto`, no `min-block-size`), so a cell is as tall as its chips (178px for a three-chip day, the month view's height for the same content, 128px at least). 768px and 1440px are unchanged.

## Shell (lane B)

- Frame (`TesseraShell.tsx`): `AppShell variant="wash" contentPadding={2}`, so the top bar and the sidebar sit on the wash (`--color-background-body`) and the content sits in one rounded panel 8px in from the wash on every side: a `Card padding={0} height="100%"` with class `tessera-panel` (`--radius-page`, 16px). Only the screen's own `LayoutContent` scrolls inside it. The shell also mounts `ToastViewport` and `CommandBar`; `(tessera)/layout.tsx` adds `RecentsTracker` and `ChangesPoller` together in one `Suspense` beside the content, not in the sidebar, whose mobile drawer React pauses while closed. There is no tab strip.
- Top bar (`TopBar.tsx`, Astryx `TopNav`): the sidebar collapse button (desktop only) and the brand (the workspace name from the workspace settings, which `WorkspaceName` publishes and which reads "Tessera" until then; logo tile, → `/`); in the middle the search field (`tessera-topbar-search`, about 364px, sm): a read-only `TextInput` (named "Search work items and commands", `aria-haspopup="dialog"`) with a `mod+k` `Kbd` that opens Power K on a click, Enter, Space, the arrow down or any printable key, the key becoming the palette's first query (`openCommandBar(initialQuery)`). Below 600px (`SearchTrigger` reads `(max-width: 599px)`, `shell.css` repeats it) the field is the mobile drawer's search: it takes the drawer's full width (`width: 100%`), the `Kbd` chip is left out and the placeholder reads "Search" instead of "Search work items, or type a command", so it no longer clips in a narrow input (`tests/ui/top-bar-search.test.ts`, `tests/ui/shell-detail-css.test.ts`). At the end: the assistant toggle (`mod+j`, only while `GET /api/ai/status` says the assistant is available), a help button (keyboard shortcuts, as `mod+/`) and the account menu (`Avatar` in a ghost `IconButton`) with the Colour scheme radio group and Keyboard shortcuts.
- Sidebar (`Sidebar.tsx`, Astryx `SideNav` on the wash, named "Work" as a landmark with no visible heading, since the top bar's brand already links home): a quiet secondary sm "New work item" button (an icon button while collapsed) that opens the create dialog for the last visited project (`tessera.lastProject.v1`), else the first, and is disabled with "Create a project first" when there are none; Home and Projects; the "Projects" section with a "+" (Create project, as `n p`) and the projects as flat rows (logo icon, name, total count; the current project selected). A project's own pages are the tabs in its panel header, not sidebar children. Resizable from 236 to 350px (250 by default), the width kept in `tessera.sidebarWidth.v1` and read after mount so the first render matches the server's. `mod+b` and the top bar's button collapse it; the collapsed flag lives in a module store (`nav-collapse-store.ts`), which every `useShell()` consumer reads through `useSyncExternalStore` with a server snapshot that is always false, and is not persisted (it resets on reload). The "New work item" tooltip names the global chord (`n i`, "N then I"). `SidebarSkeleton.tsx` mirrors it while the layout streams. While the rail is collapsed (`RailParts.tsx`, which reads Astryx's collapse context): the nav, favourite and project rows have a tooltip with their name (`RailItem`, anchored on the rendered row and opened by hover or keyboard focus, because Astryx's own sibling-mode tooltip never attaches in 0.6.8), and a section's end buttons (Create project, New folder) are not rendered (`ExpandedOnly`), since Astryx keeps a collapsed section's end content as visually hidden text and the buttons stayed focus stops off screen. A row with a menu (favourites, projects) shows its `...` button only on hover, focus-within or an open menu on a fine pointer wider than 480px (opacity 0, the space kept); the project's count sits in the same slot, ending 8px short of its edge (x=226 at the default width) like the Inbox and Drafts badges, and fades while the button shows. On touch and at 480px and narrower both show side by side (`tessera-row-actions`, `shell.css`; the count is `aria-hidden` there and the row's link carries it in its name).
- Streamed-subtree state rule: client state that a streamed subtree reads and that can change before that subtree hydrates (the sidebar sits behind a Suspense boundary and hydrates after the top bar and `mod+b` are live) is read in the consumer through `useSyncExternalStore` with a server snapshot, never through a changing context value provided from outside that boundary, because React 19.3 gives a still-dehydrated boundary the new value, so it hydrates against server HTML rendered with the old one and throws error 418 (round 6, `tests/ui/nav-collapse-store.test.ts`, `tests/ui/shell-collapse-wiring.test.ts`). A context provided inside the same boundary is safe: Astryx's `SideNavCollapseContext`, which the rows and the New work item button read, is fed from the Sidebar's own store read and hydrates with it. `AiStatusProvider` is the known latent exception (its `status` changes after mount and `SinceLastVisit`, `ViewsScreen`, `WorkspaceSettingsScreen` and `useAssistant` consumers read it from context); it has never reproduced and is covered by the round 6 regression tests (f) and (g).
- Panel headers (`PanelHeader.tsx`): a screen puts one `PanelHeader` (an Astryx `LayoutHeader`, hairline below; a labelled `div`, not a landmark, as before the rework) in its `Layout` header and stacks `PanelBar` rows in it: `size="header"` 52px (title, tabs, page actions), `"subheader"` 44px (the view's name and count, layout, display, the primary action), `"filters"` 44px (the filter bar; `hasDivider` draws the hairline above it). Heights come from tokens (`--size-element-md` plus `--spacing-5` or `--spacing-3`). `canWrap` (the work items sub-header) lets a row wrap: the end group drops under the title when both do not fit (a phone, the peek open) and wraps its own actions; without it the start group shrinks and the end group stays whole. A bar is a plain `HStack` with a 16px inline padding, not an Astryx `Toolbar`, so the tabs and the filter field keep their own arrow-key handling. `PanelTitle` is the page's h1 at the working size (14px medium, `Heading level={4}`), with `accessibilityLevel` 1 by default and 2 where the screen's own body holds the h1: `ProjectFrame` passes 2 on `/projects/<projectId>/work-items/<itemId>` (the item title, `Heading level={1}` in `DetailTitle` on the page host) and on `/projects/<projectId>/pages/<pageId>` (`PageTitle`), through `isWorkItemPagePath` and `isProjectPageDetailPath`, which match exactly one id segment. The title then looks the same but the content title is the document's only level-1 heading. The cycle and module detail headers keep the frame's h1 and give their own name level 2. Guard: `tests/ui/project-frame.test.ts`. `PanelPage` is a pinned header over scrolling content, `width="reading"` centring it in a 960px column (a `VStack` with class `tessera-reading`: Home and Projects) or `"full"`. The not-found screen is its own centred `EmptyState`, also used outside the shell; its title is the page's h1 (`headingLevel`, the size does not change).
- `PanelBar` `tabsBelow` (header tab strips, S7). Below 600px the bar is two rows: the title and `end` share a 44px row (`--size-element-md` plus `--spacing-3`) and the tab strip takes a full-width row under them on the hairline (the start group is `display: contents`, so its children take grid areas). `start` holds the title as one element (wrap a token and a name in one element), then the `TabList`; do not combine it with `canWrap`. From 600px up it is the ordinary single row. The profile, analytics and pages headers use it; the project frame and the inbox have phone grids of their own with the same shape (the project frame's second row holds the `SectionMenu`, not tabs: see "Project routes"), and they pull the first tab's padding onto the 16px inset too (`width: calc(100% + var(--spacing-3))`, `margin-inline-start: calc(-1 * var(--spacing-3))`). The tabs in that row are visible 44px boxes. Generic strip rules need no class: a `TabList` in a bar's start group docks on the hairline (the start group stretches, the strip is `align-self: flex-end`), and a strip that is the start group's first child gets `margin-inline-start: calc(-1 * var(--spacing-3))` so the first tab's text sits on the 16px inset. Guards: `tests/ui/panel-header.test.ts`, `tests/ui/shell-detail-css.test.ts`.
- Recents (`recents.ts`, `recents-store.ts`, `RecentsTracker.tsx`): every visited path, normalised as before (`resolveRoute`, `isTransientPath`), goes to the front of a list of at most 12 (`addRecent`; `/home` and transient routes skipped; a work item's project route and its global `/work-items/<id>` route count as one entry, `isSameRecent`), kept in `localStorage` `tessera.recents.v1` (`parseRecents` validates it) behind a `useSyncExternalStore` store whose server snapshot is empty. A work item opened in the peek is recorded by `PeekHost` once it has loaded, as a visit to its full page (`workItemPath`), so a peek that shows "not found" never becomes a recent. Every write starts from the stored list and a `storage` listener follows other tabs, so tabs never erase each other's visits. `forgetRecentsUnder(path)` drops a route and the routes under it: the detail calls it after a delete (the project path and `/work-items/<id>`), and the not-found screens (`NotFoundScreen`, the project's "Not found in this project") call `useMissingRoute()`, which forgets their own address and skips the tracker's visit to it, so a dead recent goes away once it has led there. Home shows the newest 8 first (`RecentsList.tsx`); Power K shows a "Recent" group of 5 when the query is empty, leaving out the page on screen and the item open in its peek (`onScreenPaths`, `otherRecents`). Pure functions in `recents.ts` and the store have Vitest coverage.
- Sidebar data: `listProjects` (with counts).
- `QuickCreate`: global create dialog host so the sidebar button and `n i` shortcut open the same dialog as lane C's screen (lane C exports `CreateWorkItemDialog`; lane B mounts it).
- Home at `/` (`PanelPage width="reading"`; `/home` redirects to it): Recents, then the "Since you were last here" card (`SinceLastVisit`, fed by `getHomeSummary`), then project rows from `listProjects` in a `List` with `edgeCompensation="inline"` (no Section around it: Section bleeds outward and would shift the heading).
- Keyboard: `useHotkeys` from `@astryxdesign/core/hooks` (verify the call form in `node_modules/@astryxdesign/core/hooks`); shortcut list per docs/PLAN.md §6. `isTypingTarget` lives in `shortcuts.ts`.
- Colour scheme: the account menu in the top bar holds "Colour scheme" (Frappé (dark), Latte (light), Match system). State lives in `src/components/shell/color-scheme.ts` (`useColorScheme`, `setColorScheme`, `localStorage` key `tessera.scheme.v1`); its values are the Astryx `<Theme mode>` values, which `src/app/providers.tsx` passes through.
- Sidebar inset: the wash strip beside the content card is the sidebar plus the card's 8px inset, so `shell.css` pads the sidebar's contents 12px/4px instead of Astryx's 8px/8px (`padding-inline: var(--spacing-3) var(--spacing-1)`). The collapsed rail's icons centre on the 56px strip at x=28, and the expanded rows have 12px on both sides. It applies in both states, never only while collapsed, so the icons do not jump sideways when the sidebar collapses or expands. The top bar's sidebar toggle (`tessera-sidebar-toggle`, an `IconButton` with the sidebar icon named "Open sidebar" or "Close sidebar") has a 6px start margin that puts it on the same x=28 column.

## Actors

- Every actor avatar goes through `ActorAvatar` (`src/components/shell/ActorAvatar.tsx`), a drop-in for Astryx `Avatar` that takes the actor (`{ id, name, kind, color }`, or null with a `name` when only a name is known). People (`kind: "user"`) keep the round initials avatar. Agents, the Assistant and System get a generated glyph on a rounded tile (`shape="rounded"`), so a bot never reads as a person and bots tell apart at a glance. The account avatar in the top bar is the user and stays a plain `Avatar`.
- The glyph (`src/themes/catppuccin/agent-glyph.ts`): an agent's robot face is built from parts (head, antenna, ears, eyes, mouth: 640 faces) picked by an FNV-1a hash of its id, so it survives a rename and does not depend on render order; the tile is the actor's palette colour. The Assistant is a sparkle and System a gear. The SVG reaches `Avatar` as a `data:` URI, which cannot read theme tokens, so it uses the Frappé hue of the palette key (`PALETTE_KEY_COLOURS`) with the face in Frappé crust: those read on both Latte and Frappé surfaces. Its content stays inside the tile's inscribed circle, because an `AvatarGroup` forces its own (round) shape on every child. Guard: `tests/ui/agent-glyph.test.ts`.

## Page screen: the outline (lane D)

`PageScreen` (`src/components/pages/PageScreen.tsx`) serves `/pages/<pageId>` (workspace wiki pages, no project frame) and `/projects/<projectId>/pages/<pageId>` (inside the frame). The Outline toggle (`ToggleButton`, icon only) sits in the header bar's end.

- The outline is an `aside` named "Outline" (`PageOutline.tsx`, a `VStack` with class `tessera-page-outline`) inside the page frame, not a `Layout` end panel, so opening it never narrows the reading column. It is mounted only while open. The structure is `LayoutContent` > `.tessera-page-container` > `.tessera-page-frame` (a grid, `data-outline="open"` while open) > the reading column (`.tessera-page tessera-reading`, 960px) and the outline.
- Frame under 1136px: the outline is a stacked block in grid row 1, above the column (row 2). It is centred, `calc(100% - var(--spacing-8))` wide up to `calc(960px - var(--spacing-8))`, a bordered card (`--radius-container`, `--color-background-popover`) with `max-height: 40dvh` and its own scroll, so it never covers page text; on a phone it is a short scrolling block.
- Frame from 1136px: a container query on `.tessera-page-container` (the content width, not the viewport; `container-type: inline-size`) puts the column and the outline side by side, the pair centred. The columns are `minmax(0, 1fr) 960px minmax(160px, 240px) minmax(var(--spacing-4), 1fr)`, so the outline gives way (240px down to 160px) and the column does not, and the card keeps a 16px gutter to the panel's edge. The outline sits in column 3, sticky at `--spacing-5` from the top with `margin-block-start: var(--spacing-5)`, aligned with the column's first element, `max-height: 70dvh`.
- 1136px is the column's 960px plus the outline's 160px minimum plus the 16px right gutter. It is a raw value because a container query cannot take a token.
- Content: Astryx `useOutlineFromDOM` reads the headings from the editor DOM; an empty body shows "No headings yet". Heading ids come from the `HeadingIds` extension (`editor/heading-ids.ts`): slugs rebuilt from the heading text on every change, never written into the Markdown, set on the initial document in `onCreate` (a transaction with `preventUpdate` and `addToHistory: false`, so nothing saves and no undo step appears).
- Guard: `tests/ui/pages-outline-css.test.ts` reads the stylesheet (stacked and sticky rules), since jsdom has no layout.

## Theme

- The theme is the local Astryx theme `catppuccin` in `src/themes/catppuccin/`. Edit `palette.ts` (colours and `[latte, frappe]` token pairs, the only place for hex) or `catppuccinTheme.ts` (`defineTheme`). Then run `npm run astryx -- theme build src/themes/catppuccin/catppuccinTheme.ts`, and again after every Astryx upgrade.
- Never edit the generated `catppuccin.{css,js,d.ts,css.d.ts}` (`npm run check:theme` fails when they are stale) or `src/astryx-themes.ts` (regenerate it with `npm run astryx -- theme add catppuccin --import`; `npm run astryx -- doctor` fails its theme-module check when it drifts). Every local import of the theme must resolve inside `src/themes/catppuccin/`; Astryx refuses the theme otherwise, which is why the icons live there.
- A new colour pair gets a case in `tests/themes/catppuccin-contrast.test.ts` (text 4.5:1; icons, control outlines and the focus ring 3:1; translucent fills composited over their surface). `tests/themes/catppuccin-wiring.test.ts` checks the built CSS carries the palette, the syntax mapping and the overrides the contrast test assumes.
- Density: the theme's type scale is `{ base: 14, ratio: 1.2 }` (body 14px, supporting 12px, h1 24px), with sm controls (28px) in headers and rows. A 16px or `1rem` assumption in app CSS is a bug; use the tokens.
- Corners: `--radius-inner` (4, chips and tokens), `--radius-element` (8, buttons, inputs, cards nested in a column), `--radius-container` (12, cards, menus, dialogs), `--radius-page` (16, page panels). Use `--radius-full` only for avatars and badges. A container's corner is the radius of the surface nested in it plus the padding between them, written with `calc()` on tokens (`src/components/styles/board.css`: 8px cards in 8px padding give 16px columns).
- Exceptions to "only avatars and badges are round", inherent to the component: the `Switch` track and thumb, the radio indicator, status dots and spinners, the `Token` remove button, tab underline caps, and in date pickers the `Calendar` range bands and the touch month-scroller puck (neither themeable; revisit if a range or touch picker lands).
- `--radius-page` (16) is the content panel's corner (`.tessera-panel`, 8px from the wash). The side peek is a 12px card 4px inside the panel's 1px border (5px from its outer edge), so its corners follow the panel's 16px ones.
- Control outlines (inputs, selectors, checkbox and radio rings, the off switch track) use `--color-border-emphasized`, tuned to 3:1 on every surface (WCAG 1.4.11). Change it only together with the contrast test.
- A restyle of a whole component goes in `components` in `catppuccinTheme.ts`, keyed by `npm run astryx -- theme targets <Name>`, never in app CSS and never through private `--_*` variables. Per-instance layout stays className + tokens. Current overrides:
  - Hairline borders on `popover` and `context-menu`.
  - Token text colour on `popover`, `context-menu` and `dialog`; the browser's default styles for `<dialog>` and `[popover]` set `color: CanvasText` (pure white or black), which glyphs without their own colour would inherit.
  - The off `switch` track takes `--color-border-emphasized` (the gray chip tint is too faint). Only the off state, so the checked track keeps Astryx's accent, hover tint and forced-colors colours. Trade-offs: the off track loses Astryx's 5% hover tint, and a disabled off track shows the outline colour at Astryx's half opacity.
  - Rounded-square `nav-icon`, `tab-scroll-button` and `calendar-day`.
  - `banner` scopes two tokens: secondary text reads as primary on the status tint, and `--color-neutral` is the plain surface, so secondary buttons in a banner do not stack their fill and hover overlay on the tint (Astryx's own themes scope banner tokens the same way). `banner-icon` gives the warning and success glyphs their text colours, because Latte yellow and green stay under 3:1 on their tint.
  - `onDark`/`onLight`: the focus ring on inverted surfaces (toasts) uses the on-colour, as the accent does there. The hover and pressed overlay tokens are the surface's own on-colour too (10% and 14% on dark, 8% and 12% on light): the page's text colour is the fill of an inverted surface, so a toast's dismiss button showed no hover.
  - `list-item`: `outline-offset: calc(-1 * var(--focus-outline-width))`, so a row's focus ring is drawn inside it (a list that sits flush against its scroller clips an outward ring: cycles, inbox, your work, agent activity).
  - `side-nav-item` selected: `font-weight: var(--font-weight-normal)`. Astryx also steps the weight to medium for the selected row, which made the label jump; colour and the overlay show the selection.
  - `adaptations`: `widthBreakpoints.sm` set to 481 and the two touch rules that carry `TOUCH_TARGET_COMPONENTS` (see "Touch targets" below).
- Touch targets (option A of decision 14) are hit areas, not boxes. Under `(pointer: coarse), (max-width: 480px)` an Astryx control keeps its drawn size and gets a 44px (`--spacing-11`) hit area: an absolutely positioned `::before`, centred, painting nothing and moving nothing, with `inset-block` and `inset-inline` of `min(0px, calc((100% - var(--spacing-11)) / 2))` (negative while the control is smaller than 44px, zero once it is as big, so a wide control grows only on its short axis). The theme generates it from `TOUCH_TARGET_COMPONENTS` in `catppuccinTheme.ts` through `adaptations`: `widthBreakpoints.sm` is 481 (only AppShell reads the named points, with its drawer at `md` = 768, unchanged), and two rules, `{ pointer: "coarse" }` and `{ width: { below: "sm" } }`, carry the same body, because Astryx conditions in one rule are ANDed. `button`, `tab`, `text-input`, `tokenizer`, `number-input`, `date-input`, `time-input`, `toggle-button`, `input-clear-button` and `top-nav-heading` get both axes; `tab-scroll-button`, `segmented-control-item` and `side-nav-heading` get the block axis only (`top-nav-heading` and `side-nav-heading` also get `position: relative`, the others are positioned already). Only menu, option, palette and drawer rows are visible 44px boxes (`min-block-size: var(--spacing-11)` on `dropdown-menu-item`, `selector-option-row`, `command-palette-item`, `side-nav-item`). A flex item's `min-inline-size` replaces its automatic minimum, so never set it on a tab or a button. At 1440 nothing changes: sm 28px controls in headers and rows. Guard: `tests/ui/touch-target-css.test.ts`.
- Header icon buttons (`TopBar.tsx`, `tessera-topbar-end` and `tessera-topbar-heading`) sit apart under the touch query (`column-gap: var(--spacing-4)`, 16px, for the end group; `var(--spacing-2)`, 8px, for the heading group), so their 44px hit areas (28px drawn) do not overlap (`shell.css`; guard `tests/ui/touch-target-css.test.ts`). The collapse button and the brand tile exactly at their shared edge (measured at 768 to 1440, DPR 1 and 2, docked and collapsed: right edge minus left edge is 0). The project bar's Add to favorites and Project actions buttons (`tessera-project-bar-actions`, `ProjectFrame.tsx`) take the same 16px gap.
- `src/components/styles/shell.css` covers what a theme key cannot reach, under the same media query: the same `::before` on `.astryx-selector [role=combobox]`, `.astryx-multi-selector [role=combobox]`, `button[role=combobox]`, `.astryx-complex-selector > button` and `.astryx-token > button` (a filter token's cross reaches outward only); the DateInput calendar toggle (20px to the start, 8px to the end, so it never covers the text); the native input of a Switch and a Checkbox at 44px; the token clip rule (`overflow: clip !important; overflow-clip-margin: var(--spacing-4) !important`, because Astryx clips a token and its label button and `calc()` is invalid for `overflow-clip-margin`); `.astryx-tokenizer` `row-gap: var(--spacing-2) !important`; `.astryx-tab-strip` with `padding-block: var(--spacing-2)` and an equal negative margin (a scrolling strip clips its tabs' hit areas otherwise); and the dropdown cap lifted to `min(calc(var(--spacing-12) * 10), 70dvh)` so the 44px menu rows show more than six. Modifiers: `tessera-hit--y` (`inset-inline: 0`, block axis only) and `tessera-hit--none` (`content: none`). A SegmentedControl's first and last segments reach 8px past the group; the ones between tile exactly. Text-like inputs (the `<input>` of a text input, tokenizer, number, date, time, date-time input and the selector searches, and the `<textarea>` of a text area) are `position: relative` under the same media query (no z-index: Astryx defines none, and one would paint a field over the sticky bands it scrolls under), so a tap on a field's centre lands on the input and not on a neighbouring control's 44px `::before`, which would otherwise paint above a non-positioned field.
- Dense rows whose control is not an Astryx component (reaction chips, list chips) use the legacy negative-margin classes: `tessera-hit` (block axis) and `tessera-hit-x` (inline axis) keep 44px for the finger and pull the same amount back with an equal negative margin, so the row keeps its height. `--tessera-hit-base` is the resting size: 28px (sm) by default, `tessera-hit--xs` 24px, `tessera-hit--line` 20px (a text link). The control must be a flex or inline-flex box. An Astryx control inside such a row already has its area from the theme and needs no class.
- Area CSS never copies the 44px box recipe. A lane that needs a hit area uses the theme or the `shell.css` pattern above, or the `tessera-hit*` classes, and never writes `min-block-size: var(--spacing-11)` on a control inside a dense row. List rows, menu rows, form fields (settings and dialogs) and the tabs of a phone tabs-below header stay visible 44px boxes by design.
- Base layer: `src/components/styles/base.css` declares the cascade order `tessera-fallback, reset, astryx-base, astryx-theme`. It must stay the first import of `src/app/globals.css`, because a bundler hoists `@import`s above an `@layer` statement written in the same file, which put the fallback layer above the theme's. The `tessera-fallback` layer holds the product focus ring (`--focus-outline-width` accent at the Astryx offset) for focusables Astryx does not render (editor links, entity chips, native task checkboxes, a `<time>`, gantt bars) and `accent-color: var(--color-accent)` for native checkboxes and radios, all at zero specificity (`:where`). An Astryx component keeps its own ring.
- Sidebar rows (favourites, projects) carry no `touch-action: none`, so a finger that starts on a row scrolls the drawer; their pointer drag is for a mouse or pen and the row menu (Move up, Move down) is the touch and keyboard path.
- Editor surfaces (`src/components/styles/editor.css`) follow the same rules: the frame is a control outline (`--color-border-emphasized`, accent while focused), entity links are purple chips (`--color-background-purple` / `--color-text-purple`), the placeholder is secondary text, and the bubble menu and suggestion popover are shaped like Astryx menus (12px around 8px rows at a 4px inset).
- Code highlighting uses Astryx's default syntax mapping (`syntaxTokenDefaults`, declared in the theme so it resolves to the Catppuccin text tokens). Code colours therefore follow `--color-text-{accent,green,orange,blue,purple,cyan,red,teal,secondary,primary}`.
- The root layout sets `<html data-theme="dark">`, the Astryx SSR hint for the Frappé default; the root `<Theme>` updates it after hydration. Until then `<html>` and `<body>` resolve Astryx's default tokens, because the root `<Theme>` copies `data-astryx-theme` onto `<html>` in an effect. So every page paints its own surface inside the Theme wrapper: the shell does, and the root not-found page uses `.tessera-root-frame` (`src/app/globals.css`).

### Accepted trade-offs

- Accepted trade-offs (not every pair can pass; these are recorded rather than tuned away): a ghost button's hover on a Latte error banner falls to 4.4:1 on the shell wash and 4.1:1 on a muted well, where banners do not render (the test covers content surfaces); the table cell-selection tint and active bubble-menu marks differ from their resting state by less than 3:1, as they did under paper.
- Latte icon contrast (findings planning-17 and settings-19): status and priority icons in the yellow, peach, pink and green families measure 2.31 to 2.96:1 on the Latte base. They stay: a darker Latte yellow or green stops reading as that colour, the name always sits beside the icon, and contrast checks are pragmatic. The banner glyphs (`banner-icon`) are the only icons tuned. The same applies to secondary icons on 44px rows in Latte, and to the favourite star (`FavoriteButton`): a favourite is a filled star in the `warning` icon colour (Latte yellow about 2.3:1 on the base; the outline-to-filled change carries the state) on a ghost `IconButton`, not a `ToggleButton`, whose pressed background read as a held-down button.
- Touch-target exceptions (decision 14): SegmentedControl segments are as wide as drawn (only the first and last reach outward) with a 44px block axis; the tab-scroll arrows are block-axis only (they are pointer-only, swipe and arrow keys scroll the strip); the filter token's cross reaches outward only, and its area corners are rounded by Astryx's clip; in a `gap-1` cluster a neighbour may take up to 4px of an edge (the later sibling in the DOM wins); a one-digit Estimate value button (7px wide) shares its right edge with the Clear button; a hover-only control (the calendar's Move button) takes no area. Labelled project tabs (coarse pointer, 1280px and wider): each area reaches half the 2px strip gap toward a neighbour, so the first tab does not reach outward at its start and the last does not at its end (the scrolling strip would clip it), and the area runs from 16px above the tab to its bottom edge so it stays out of the content row below. The top bar's search field (coarse pointer, 600px and wider) has a block-axis-only area on the field's box, so the 28px ⌘K chip is covered too.
- Home "Mark as seen" (`SinceLastVisit.tsx`) is Astryx's `secondary` button, which is tint-only: its edge measures 1.27:1 in Frappé and 1.12:1 in Latte against the card, and its label 6.3:1. Astryx 0.6.8 has four variants (primary, secondary, ghost, destructive) and none is bordered; a theme-wide border on secondary buttons is out of scope, so the button stays as it is.
- At 360px a few list rows wrap one more chip line than at 375px, because the row is narrower. Accepted: nothing is clipped and no hit area changes.

## Astryx usage rules that caught agents before

- Verify every component's props with `npx astryx component <Name>` or the `.d.ts` under `node_modules/@astryxdesign/core/<Name>` before use; names in the plan marked *check* changed between versions.
- Templates under `node_modules/@astryxdesign/cli/assets/templates/pages/` are reference code under MIT: port them (className + tokens, Phosphor icons), never import or paste them; they use `@stylexjs/stylex` and `@heroicons/react`, both forbidden by `scripts/check-conventions.ts`.
- `Link` goes through Astryx's `LinkProvider` (already configured in `src/app/providers.tsx` with `next/link`).
- CSS lives in `src/components/styles/<area>.css`, imported once from `src/app/globals.css` (one additive `@import` line per area), tokens only.
- `Dialog` and `AlertDialog` come from `@/components/shell/dialogs`, never from `@astryxdesign/core` (lint-enforced): the Astryx ones stay modal in a route Next has hidden and leave the next page inert. `dialogs.tsx` also gives focus back to the opener when an autofocused field took focus before Astryx recorded the trigger, and a Dialog a screen mounts only while open (opened from a menu row) gives focus back, when it unmounts, to the last focused element outside any dialog or menu: the menu's button, not `<body>`.

## Verification per phase

- Vitest for pure helpers (`url-state`, `recents`, the DnD reducer, grouping adapters).
- Browser acceptance through the in-app browser (`.claude/launch.json` → `tessera`) following the numbered steps in docs/PLAN.md §12; the verifier records what it saw with screenshots.
- `npm run check` green; `next build` green with no hydration warnings in the dev console on the screens touched.

## P2b: detail, editor, Power K

Four lanes run in parallel without talking to each other: **D1** editor
(docs/contracts/editor.md, the description beacon route, round-trip tests),
**D2** detail components (`src/components/detail/`, PropertyRail, sub-items, links,
activity, the new Server Action file), **D3** hosts (peek wiring, full pages,
`/work-items/[workItemId]`, `/browse/[key]`, tab labels), **D4** Power K, the
shortcut registry and `GET /api/search`. Every API named here was checked against
the installed packages on 2026-10-11 (file cited in brackets; Astryx declarations
live under `node_modules/@astryxdesign/core/dist/<Name>/`, not under `core/<Name>`
as the P2a rule above says). Mismatches with docs/PLAN.md are collected at the end.

### Routes and modes (D3)

- `/projects/[projectId]/work-items?peek=<id>` — the peek. `work-items/page.tsx`
  (additive) reads `query.peek`; when `IdSchema.safeParse(peek).success`
  (`@/lib/tessera/schemas`; `core/ids.isId` is not importable from client code and
  pages keep to the same rule) it loads the item in a second `readTessera` call
  guarded by its own try: a stale or foreign id renders the panel's not-found state
  and never 404s the list. The page passes `peek` to the host; `q` and `create`
  keep working unchanged. Reload keeps the peek (it is in the URL).
- Modes: `side` (default) is an Astryx `LayoutPanel` in the `end` slot of a nested
  `Layout`, 480 px by default, resizable 360–720 px; `modal` is an Astryx `Dialog`
  (`variant="standard" width={760} maxHeight="85dvh" purpose="form"`,
  `dist/Dialog/Dialog.d.ts`); `page` navigates to the full route. Mode and width
  live in `localStorage` key `tessera.peek.v1` as `{ "width": number, "mode": "side" | "modal" }`
  (`src/components/detail/peek-prefs.ts`, `useSyncExternalStore` with server snapshot
  `{ width: 480, mode: "side" }`, same pattern as the recents store). Only `?peek` is in the URL.
- Resizing: `const peek = useResizable({ defaultSize: prefs.width, minSize: 360, maxSize: 720, direction: "horizontal", onSizeChange: (size) => savePeekPrefs({ width: size }) })`
  then `<LayoutPanel resizable={peek.props} hasDivider={false} padding={1} isScrollable={false} label="Work item" role="complementary">`
  holding `<Card padding={0} height="100%" elevation="low" className="tessera-peek-card">` around the slot,
  with `<ResizeHandle resizable={peek.props} direction="horizontal" isReversed hasDivider={false} />`
  placed before the panel. The side peek is an inset card (layout rework, 2026-10-11): 12px corners
  4px inside the 16px content panel, its own hairline and low shadow, the detail scrolling inside it (`dist/Resizable/useResizable.d.ts`: `ResizableRegion.props`
  is the object both components take; `dist/Resizable/ResizeHandle.d.ts`: `isReversed`
  "when the handle controls a panel" on the end side; `dist/Layout/LayoutPanel.d.ts`:
  `width` is ignored when `resizable` is set). Do not use `autoSaveId`: Astryx's own
  storage format is not the `tessera.peek.v1` shape above.
- Host: `src/components/detail/PeekHost.tsx` (`"use client"`), rendered by
  `work-items/page.tsx` around the screen:
  `<PeekHost projectId={projectId} peek={peekData}><WorkItemsScreen …/></PeekHost>`.
  Closed → `children` only. Side → `<Layout height="fill" content={<LayoutContent padding={0} isScrollable>{children}</LayoutContent>} end={…panel…} />`
  (Layout slots `header/start/content/end/footer`, `dist/Layout/Layout.d.ts`; the
  shell and `ProjectFrame` already nest `Layout`s, so nesting is proven). Modal →
  `children` plus the `Dialog`. `AppShell` has no right-panel slot (`dist/AppShell/AppShell.d.ts`:
  `topNav`, `sideNav`, `banner`, `children`), which is why the panel lives inside the page.
- **One mount point (as built).** `WorkItemDetail` renders once, through
  `createPortal`, into a DOM node `PeekHost` owns. The side panel and the modal
  each hold a slot that adopts that node, so switching modes (from the header,
  or when the stored mode loads after hydration) moves DOM and keeps all React
  state: unsaved editor text, undo history, a save in flight, a title being
  edited. Portals have no server render, so until hydration the slot shows a
  `Skeleton`. Focus stays on the control that switched the mode. The list stays
  in the same tree position whether or not the panel is open.
- `peek` prop type: `{ id: string; data: WorkItemDetailData | null } | null` (null data = not found).
- Open/close: `WorkItemsScreen.onOpen` changes (one additive edit by D3 in lane C's
  file, named in the hand-off) from `router.push(`/projects/${projectId}/work-items/${id}`)`
  to `router.push(peekHref(pathname, searchParams, id), { scroll: false })`;
  `peekHref(pathname, searchParams, id | null)` in `src/components/detail/peek-url.ts`
  (pure, tested in `tests/ui/peek-url.test.ts`) sets or drops `peek` and keeps every
  other param (`q`). Enter and click on rows already call `onOpen` (`ListLayout` key
  button + `useListFocus`, `TableLayout`, `BoardLayout`). Escape closes:
  `useHotkeys([{ keys: "escape", onPress: close, allowInInputs: true, isDisabled: !open }])`
  in `PeekHost` (`dist/hooks/useHotkeys.d.ts`); the editor's own Escape blurs first
  and stops propagation (editor.md), dialogs and menus stop theirs, so the second
  Escape reaches the panel. Close = `router.replace(peekHref(…, null), { scroll: false })`,
  except when the list pushed the entry being closed: `onOpen` records the push
  in sessionStorage `tessera.peekPush.v1` (`src/components/detail/peek-history.ts`),
  `PeekHost` stamps the history length once the URL changed and follows an
  in-place item switch, and close calls `router.back()` when
  `closesWithBack(push, current, target, history.length)` holds
  (`peek-url.ts`). Opening and closing therefore leaves no duplicate history
  entry. Without storage the close falls back to the replace.
  Mode switch to `page` = `router.push(`/projects/${projectId}/work-items/${id}`)`.
- `/projects/[projectId]/work-items/[workItemId]` — full page, replaces
  `QuickDetail.tsx` (delete it). Same loader; renders `<WorkItemDetail host="page" …/>`
  inside the project frame; `item.project_id !== projectId` stays `notFound()`.
- `/work-items/[workItemId]` — global, outside the project frame:
  `src/app/(tessera)/work-items/[workItemId]/page.tsx`, sync shell → `<Suspense>`
  → async child awaiting `params`, `await io()`, then one `readTessera` loading
  `loadProjectBundle(ctx, item.project_id)` + `loadWorkItemDetail(ctx, workItemId)`
  (both helpers in `src/app/(tessera)/work-items/load-detail.ts`, lane D3;
  `loadProjectBundle` copies the seven-line bundle body of
  `projects/[projectId]/layout.tsx` so lane C can switch the layout to it later).
  Renders `<ProjectProvider bundle>` + Breadcrumbs (Project › Work items › KEY) +
  `<WorkItemDetail host="page" …/>`. Add `export const instant = false` only if the
  instant-navigation validator reports the `notFound()` path (same reason as the
  project layout; `next/dist/docs/01-app/02-guides/instant-navigation.md`).
- `/browse/[key]` — `src/app/(tessera)/browse/[key]/page.tsx`: sync shell →
  `<Suspense>` → async child: `const { key } = await params; await io();`
  `if (parseKey(key) === null && !IdSchema.safeParse(key).success) notFound();`
  (`parseKey` and `IdSchema` from `@/lib/tessera/server`, which re-exports
  `core/keys` and `schemas`); then in a `try`: `item = await readTessera((ctx) => getWorkItemByKey(ctx, key))`
  (`src/lib/tessera/work-items/` line 483, accepts key or id, any case), `NOT_FOUND`/`VALIDATION`
  → `notFound()`; after the try: `redirect(`/projects/${item.project_id}/work-items/${item.id}`)`.
  `getWorkItemByKey` also resolves a key the item held before `move_work_item_to_project`
  (and a retired project identifier), so `/browse/<OLDKEY>` redirects to the item's current project URL.
  `redirect` throws, so it stays outside `try` (`04-functions/redirect.md` lines 51–53)
  and is allowed in Server Components; it uses `replace` outside Server Actions (line 31).
- Recents labels: `src/components/shell/entity-labels.ts` (D3) — module store
  `registerEntityLabel(id: string, label: string)`, `useEntityLabels(): ReadonlyMap<string, string>`
  via `useSyncExternalStore` (server snapshot: empty map; never cleared so a recent
  entry keeps its label after navigating away). `WorkItemDetail` registers
  `${item.key} ${item.name}` in an effect. The recents store (`recents-store.ts`) labels
  each path with `resolveRoute(path, { ...lookupFromNames(projectNames), workItemLabel: (id) => labels.get(id) })`
  (`recents.ts`, tests in `tests/ui/recents.test.ts`): `/work-items/[id]` →
  `{ label: lookup.workItemLabel?.(id) ?? "Work item", icon: "work-item" }` and
  `/browse/[key]` → `{ label: key.toUpperCase(), icon: "work-item" }`. (Until the
  layout rework these labels named the tabs of the removed `TabBar`.)

### Detail components (D2) — `src/components/detail/`

Data shape (`src/components/detail/types.ts`, client-safe imports from
`@/lib/tessera/types`):

```ts
import type { ActivityLogEntry, WorkItem, WorkItemDetail, WorkItemLinkRow } from "@/lib/tessera/types";
import type { ReactionSummary } from "./reaction-model";
import type { RelationRowView } from "./relation-model";

export type WorkItemDetailData = {
  item: WorkItemDetail;                                   // WorkItem & { subscriber_ids, links: WorkItemLinkRow[] } (work-items.ts line 91)
  parent: Pick<WorkItem, "id" | "key" | "name"> | null;   // getWorkItem(ctx, item.parent_id)
  children: WorkItem[];                                   // listChildren(ctx, id) (line 506)
  activity: ActivityLogEntry[];                           // listActivity(ctx, { work_item_id: id }) (changes.ts line 163), newest first
  comments?: CommentView[];                               // listComments(ctx, id): roots oldest first, replies nested (decision 56)
  backlinks?: PageBacklink[];                             // listPageBacklinks(ctx, { entity_type: "work_item", entity_id }) (decision 44), for "Mentioned in"
  relations?: RelationRowView[];                          // listRelations(ctx, id) with the related item resolved (key, name, project_id, archived, state), grouped by display type in the UI (decision 55)
  reactions?: ReactionSummary[];                          // reactionsFor(ctx, "work_item", [id]).get(id) ?? [] -> { reaction, count, actor_ids } (decision 57)
  currentActorId: string;                                 // USER_ACTOR_ID, filled server-side ("assign me", subscribe toggle)
  cursor: number;                                         // latestSeq at load
};
export type DetailHost = "peek" | "modal" | "page";
```

The server helper `loadWorkItemDetail(ctx, id): WorkItemDetailData` is D3's
(above); D2 codes against the type. `relations` and `reactions` are optional (a host without them shows none);
`loadWorkItemDetail` (`src/app/(tessera)/work-items/load-detail.ts`) fills both, and both types are exported from
`src/components/detail/index.ts`. Components (all `"use client"`, CSS in
`src/components/styles/detail.css`, prefix `tessera-detail-`, one `@import` line in
`globals.css`):

```ts
export type WorkItemDetailProps = {
  data: WorkItemDetailData;
  host: DetailHost;
  onClose?: () => void;                       // peek and modal
  onHostChange?: (host: DetailHost) => void;  // the "Open as" menu in the header
  onOpenItem: (id: string) => void;           // parent, sub-item, `#` link: host decides (peek → replace ?peek, page → push)
};
export function WorkItemDetail(props: WorkItemDetailProps): JSX.Element;
```

- `WorkItemDetail` — one component, three hosts. Must mount inside
  `ProjectProvider` (reads `useProject()` for states, labels, actors, cycles,
  modules). Layout: `DetailHeader`; title (`Heading` that turns into an input on
  click/Enter, saved on blur or Enter via `updateWorkItemAction({ work_item_id, name })`);
  `PropertyRail` (a 320–384 px column behind a hairline on `page` once the detail is
  960 px wide, a `detail` container query; stacked under the title between hairlines
  on `modal`, a 760 px Dialog, and on `peek` with `compact`); `DescriptionEditor` with its `ReactionBar`; `SubItems`;
  `RelationsList`; `MentionedIn`; `LinksList`; `Timeline` (comments and updates merged oldest first, the newest 20
  shown until "Show older", then the comment composer unless the item is read-only). Registers
  the entity label (D3's store) and the command context (D4's store, below) in one
  effect, both unregistered on unmount.
- `DetailHeader` `{ item, parent, host, onClose, onHostChange, onOpenItem, onCopyItem, onDelete }`:
  one 44px `PanelBar size="subheader"` (class `tessera-detail-header`), pinned
  while the detail scrolls. Start: Astryx `Breadcrumbs` + `BreadcrumbItem`
  (`dist/Breadcrumbs/*.d.ts`: `href`, `onClick`, `isCurrent`, `startIcon`) —
  project (logo, href `/projects/<id>/work-items`), "Work items" on the full
  page, parent key (onClick → `onOpenItem`), current key `isCurrent`. End, in
  this order: copy link (`IconButton`, `useClipboard({ announce: "Copied" })`,
  `dist/hooks/useClipboard.d.ts`: `copy`, `isCopied`; copies the full page
  URL); `MoreMenu` "More actions" (Make a copy when `onCopyItem`, `Copy ID (<KEY>)`,
  Delete… when `onDelete`); the "Open as" menu (`DropdownMenu` whose trigger
  shows the current mode's icon, a `DropdownMenuRadioGroup` of Side panel /
  Modal / Full page; a choice focuses the trigger before the host moves the
  detail, so focus comes back to it); Close "Close (Esc)" (peek and modal).
  Icons come from `src/themes/catppuccin/icons.tsx`, added there additively
  (`export const <Name>Icon = duotoneIcon(<Phosphor>);`, alphabetical).
- `PropertyRail` `{ item, currentActorId, compact }` — four Astryx `MetadataList`s
  (`dist/MetadataList/MetadataList.d.ts`: `columns`, `label: { position, width }`,
  `orientation`) split by hairlines: status (State, Priority, Labels), people
  (Assignees, Subscription), planning (Cycle, Modules, Parent, Estimate) and dates
  (Start, Target, Created, Updated). One column; each row is a 16px icon and muted
  label in a 120px label column (104 px in the peek) and the value. Label and value are the same height,
  `--tessera-rail-row` = `--size-element-md` (32px; 44px under `(pointer: coarse), (max-width: 480px)`), each
  vertically centred, so a row's midlines meet and the pitch is constant. Ghost Selector controls are pulled back
  12px (`margin-inline-start: calc(-1 * var(--spacing-3))`), so the state dot, the priority icon and the bell sit in
  that slot and the text values (labels, assignees, cycle) share one start x with the dates and plain text. The rows hold the P2a controls from `@/components/work-items/properties`
  (`{ value, onChange, compact?, readOnly? }`): State → `updateWorkItemAction({ work_item_id, state_id })`;
  Priority → `{ priority }`; Assignees → `setAssigneesAction({ work_item_id, actor_ids })`;
  Labels → `setLabelsAction({ work_item_id, label_ids })`; Modules →
  `setModulesAction({ work_item_id, module_ids })`; Cycle → `{ cycle_id }`; Start /
  Target → `{ start_date }` / `{ target_date }` (`DateControl`; note the P2a
  double-fire gap in docs/PLAN-STATUS.md, dedupe by value); Parent → `ParentPicker`
  → `{ parent_id }`; Estimate → disabled control with tooltip "Arrives in P8";
  Subscribe toggle → `subscribeWorkItemAction` / `unsubscribeWorkItemAction({ work_item_id })`
  (`item.subscriber_ids.includes(currentActorId)`); Created / Updated as
  `Timestamp` (`dist/Timestamp/Timestamp.d.ts`: `value`, `format: "relative"`,
  `hasTooltip`). Each wrapper is a `div[data-property="state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "estimate" | "parent"]`
  so the shortcut dispatcher can open it (below). Writes follow the P2a
  `QuickDetail` pattern: call the action, Toast on `{ ok: false }`, the
  `refresh()` inside `runTool` re-renders the host with the new data.
- `ParentPicker` `{ value: string | null, onChange(id: string | null), projectId, excludeId }`:
  Astryx `Selector`-style ghost trigger showing the parent's key and name; the
  menu searches `GET /api/search?q=&scope=<projectId>&types=work_item&limit=8`
  (D4's route; D2 codes against the contract below) and excludes `excludeId` and
  its descendants (the engine rejects cycles with `RULE`; show the message).
- `SubItems` `{ parent: WorkItem, children: WorkItem[], onOpenItem }`: rows with
  key `Button` (→ `onOpenItem`), name, compact `StateControl`, `AssigneeControl`;
  "Add sub-item" inline input → `createWorkItemAction({ project_id, name, parent_id })`;
  reorder with alt+up / alt+down and a `…` menu ("Move up", "Move down", "Remove
  from parent" → `updateWorkItemAction({ work_item_id, parent_id: null })`) via
  `moveWorkItemAction({ work_item_id, before_id | after_id })`
  (`MoveWorkItemInput`, work-items.ts line 1266: a pure reorder needs no `group_by`).
  Drag-and-drop is optional in P2b; if added, reuse `src/components/dnd`.
- `RelationsList` `{ workItemId, projectId, relations: readonly RelationRowView[], readOnly?, onOpenItem }`
  (`RelationsList.tsx`, pure model `relation-model.ts`, class `tessera-detail-relations`), placed after `SubItems` and
  before `MentionedIn`. Rows are grouped by display type from this item's side (decision 55: blocked by / blocking,
  relates to, duplicate of, starts or finishes before / after, implemented by / implements). A row is a state dot,
  the key as a button (opens the item through `onOpenItem`; another project's item opens its full page), the name
  and a remove `IconButton`, on `.tessera-detail-row`. `Add relation` opens a Dialog (from `@/components/shell/dialogs`,
  width 480, `purpose="form"`) with a type `Selector` and a search across all projects that leaves out the item itself.
  Add and remove are optimistic (decision 13: `useOptimistic` in a transition, revert and toast on failure). On an
  archived item or project (`readOnly`) rows only open their item, and with no relation nothing renders; with no
  relation on an editable item only the heading and the Add control render. Guards: `tests/ui/relations-list.test.ts`,
  `tests/ui/relations-reactions-css.test.ts`, `tests/e2e/relations-reactions.spec.ts`.
- `ReactionBar` `{ target: "work_item" | "comment", targetId, reactions: readonly ReactionSummary[], currentActorId, readOnly?, label? }`
  (`ReactionBar.tsx`, model `reaction-model.ts`, classes `tessera-reactions`, `tessera-reaction` in `collaboration.css`),
  directly under the description (`WorkItemDetail`) and under each comment body (`CommentItem`; decision 57). Chips are
  sm `ToggleButton`s with `aria-pressed` for the user's own reaction and the accessible name "<emoji name> reaction, N".
  The pill is drawn by `::before` at 28px with a 1px border and an accent 10% fill when pressed, so the 44px touch box
  does not change what is drawn. An `Add reaction` `IconButton` opens a `Popover` with the eight emoji
  (`REACTION_CHOICES`, kept equal to the engine's `REACTION_EMOJI` by a test; four per row under touch). Toggling is
  optimistic (decision 13; revert and toast). Read-only: chips disabled, no add button, an empty bar renders nothing.
  Touch (decision 14): `.tessera-reaction` gets `min-inline-size: var(--spacing-11)` under `(pointer: coarse), (max-width: 480px)`, and
  the chips, Add reaction and the relation controls use `tessera-hit` / `tessera-hit-x`, so the 28px desktop look and the
  44px target both hold. Guard: `tests/ui/reaction-bar.test.ts`.
- `ParentPicker` and `RelationsList` share `use-work-item-search.ts`, so work item search against `GET /api/search` lives in one hook.
- `LinksList` `{ workItemId, links: WorkItemLinkRow[] }`: title or URL host as the
  label, external `<a target="_blank" rel="noreferrer">`; add (small `Dialog` with
  Title + URL) → `addLinkAction({ work_item_id, url, title })`
  (`AddLinkInput`, links.ts line 79, http(s) only); edit → `updateLinkAction({ link_id, title?, url? })`;
  remove → `removeLinkAction({ link_id })`.
- `MentionedIn` `{ backlinks: readonly PageBacklink[] }` (`MentionedIn.tsx`, class `tessera-detail-links`),
  between `SubItems` and `LinksList` in the main column on all three hosts: a "Mentioned in (N)"
  label (`Text type="label"`) over a list named "Mentioned in", one row per page that embeds the
  item, a page icon and a `Link` to the page (`pageHref`: `/pages/<id>` for a wiki page,
  `/projects/<projectId>/pages/<id>` for a project page); a page that is archived stays listed and
  reads "Archived" beside its name. It renders nothing when no page embeds the item. The pages
  are those whose body links the item with a `work:KEY` entity link, which `replacePageEmbeds`
  turns into `page_embed` rows (decision 44). `loadWorkItemDetail` (`work-items/load-detail.ts`)
  fills `backlinks` with `listPageBacklinks(ctx, { entity_type: "work_item", entity_id })` in the
  same read as the item, for the full page, the peek and the modal. Guards:
  `tests/ui/mentioned-in.test.ts`, `tests/detail-loader.test.ts`.
- `ActivityFeed` `{ entries: ActivityLogEntry[] }` (no longer rendered by `WorkItemDetail`, where
  `Timeline` replaced it; still exported): a timeline, newest first. Each
  entry is a 28px icon tile for the kind of change (by verb: created, archived,
  restored, deleted, copied, moved; else by field; else a pencil) on a hairline
  that joins the tiles, then `actor_name`, verb and field in words ("changed state",
  "edited the description" — with `merged_count > 1` → "edited the description
  N times"), `Timestamp format="relative" hasTooltip`. `ActivityLogEntry = ActivityRow & { actor_name, merged_count, last_seq }`
  (changes.ts line 88). No client fetch; the host reloads on `refresh()`.
- `DescriptionEditor` `{ workItemId, text, version, readOnly }`: composes D1's
  `MarkdownEditor` (ref), `useDescriptionSave({ workItemId, serverText: text, serverVersion: version, editor })`
  and the Banner states from docs/contracts/editor.md ("Save queue"). Passes
  `mentionActors` from `bundle.actors`, `projectId`, `onOpenEntity` → work links go
  through `onOpenItem` after resolving the key with `GET /api/search?q=<KEY>&types=work_item&limit=1`
  (key hits score first, search.ts line 63); other schemes toast "Arrives in P3/P6".
- Server Actions: new file `src/app/actions/detail.ts` (lane D, same header as
  `src/app/actions/work-items.ts`: `"use server"` first line, `import { toolAction } from "./_run"`):
  `subscribeWorkItemAction = toolAction("subscribe_work_item")`,
  `unsubscribeWorkItemAction = toolAction("unsubscribe_work_item")`,
  `copyWorkItemAction = toolAction("copy_work_item")`,
  `addLinkAction = toolAction("add_link")`, `updateLinkAction = toolAction("update_link")`,
  `removeLinkAction = toolAction("remove_link")`. Nothing is added to lane C's
  `actions/work-items.ts`; its existing wrappers (lines 11–20) cover the rest.

Visual alignment rules for the detail and the AI surfaces (audit round, 2026-10-22):

- On the full page (container 960px and wider) the properties group (`.tessera-detail-props`) is sticky below the pinned 44px header and scrolls on its own when the window is shorter than the rail; the rail column keeps its full-height hairline.
- `VersionHistoryDialog`: the list column is `clamp(160px, 30%, 240px)`, the diff takes the rest, and the panes stack below 600px with the list capped at 4 rows. "Restore this version" sits in the pinned footer, disabled with a reason ("This is the current version.") on the current version.
- `DigestCard` takes `inset` (`"list"` by default, `"none"` for the Home and Analytics widgets); the 16px margins live on `.tessera-ai-digest--inset` (`ai-surfaces.css`).
- The assistant's `ChatComposer` uses `elevation="none"`: Astryx's emphasized control border, accent while focused, 3:1 or more in both schemes.
- The peek's `ResizeHandle` is not rendered while the side panel is capped at its container width (a phone) or covers the list (see "Side peek on a narrow container" under Work items screen).
- The comment avatar is offset 2px (`margin-inline: var(--spacing-0-5) calc(-1 * var(--spacing-0-5))`), so its centre is on the activity hairline that runs through the 28px tile centres.

### Power K and shortcuts (D4)

- `src/components/shell/CommandBar.tsx` (`"use client"`) on Astryx `CommandPalette`
  (`dist/CommandPalette/CommandPalette.d.ts`: `isOpen`, `onOpenChange`,
  `searchSource: SearchSource<T>`, `input?`, `footer?`, `renderItem(item, isSelected)`,
  `emptySearchText`, `emptyBootstrapText`, `label`, `width` 640, `maxHeight` 480).
  Mounted by one additive line in `TesseraShell.tsx` next to `ToastViewport`
  (D4 is the only P2b lane that edits `TesseraShell.tsx`; it also adds
  `openCommandBar(initialQuery?: string)` to `ShellContextValue`, which the top bar's
  search field calls; a call while the palette is open does nothing).
- Opening: `useHotkeys([{ keys: "mod+k", onPress: () => open(), allowInInputs: true }, { keys: "mod+/", onPress: openHelp, allowInInputs: true }])`.
  `mod+/` is a shift-free combo, so `event.key` matching is layout-safe here.
- Search source (`src/components/shell/command-source.ts`, pure apart from `fetch`):
  implements `SearchSource` from `@astryxdesign/core/Typeahead`
  (`dist/Typeahead/types.d.ts` line 77: `search(q)`, `bootstrap()`, `cancel?()`);
  items are `SearchableItem` (`{ id, label, element?, auxiliaryData? }`, auto-grouped
  by `auxiliaryData.group`, line 26). `bootstrap()` and an empty `search("")` return
  the "Recent" group (the newest 5 recents not on screen, empty in the Ask tab)
  followed by the static commands for the current context; a non-empty `search(q)`
  leaves the recents out, aborts the previous request (`cancel()` holds an
  `AbortController`), waits 150 ms, fetches `/api/search` and merges the hits with
  the static commands whose label or keywords contain `q`. Selection: the palette
  closes and `onValueChange(value)` delivers the chosen item id (picker mode,
  `value`/`onValueChange` props); `CommandBar` keeps a `Map<id, () => void>` built
  with the items and runs the handler. Section order (group names): "Recent", "Work items",
  "Projects", "Cycles", "Modules", "Pages", "Actions", "Create", "Navigate", "Settings".
  Hit ids are `hit:<type>:<id>`; command ids are `CommandId`s: the `ShortcutId`s below plus the palette-only theme commands; the open-item command is `open:<workItemId>`; a recent route is `recent:<path>` (`auxiliaryData.kind === "recent"`, which pushes the path).
- Theme commands in the "Settings" group: "Theme: Frappé (dark)", "Theme: Latte (light)" and "Theme: Match system" call `setColorScheme("dark" | "light" | "system")` from `src/components/shell/color-scheme.ts`. They are palette-only commands with ids `theme.dark`, `theme.light` and `theme.system`, have no key binding, and are not entries in `SHORTCUTS`.
- Scope: inside a project (`useOptionalProject()` non-null) `scope=<projectId>`
  and a footer toggle "All projects" (`CommandPaletteFooter` replaced through the
  `footer` slot) drops it; outside, no scope.
- Look and highlight (visual audit S4, S12): the dialog is pinned 80px from the top of the window (`--tessera-cmd-top`, 32px below 600px), not centred, so the input stays put while the list grows and shrinks; its height caps at 480px or the window less both margins. Once the results of a typed query have landed, the first enabled row is the active descendant (it carries the highlight overlay and the input's `aria-activedescendant`), once per query, never while a search is in flight, and never for the idle empty-query list, which opens without a highlight as Astryx does (`command-source.autoHighlightRow`, `palette-parts.tsx`). Below 600px the footer drops its keyboard hints and keeps the "All projects" switch.
- "Ask" tab: the `input` slot renders `<CommandPaletteInput …>` above a `TabList`
  (`size="sm"`) with "Search" and "Ask"; "Ask" shows `CommandPaletteEmpty` text
  "The assistant arrives in P5" and disables the list. Both components are exported
  from `@astryxdesign/core/CommandPalette` (`dist/CommandPalette/index.d.ts`).
- `GET /api/search` — `src/app/api/search/route.ts` (D4), pattern of
  `src/app/api/changes/route.ts`: params `q` (required, ≤ 500 chars, else 400),
  `scope` (project id, optional), `types` (comma list of `work_item|page|cycle|module|project`,
  optional), `limit` (1–200, default 20). Runs
  `readTessera((ctx) => searchAll(ctx, q, { scope: scope ? { project_id: scope } : undefined, types, limit }))`
  (`src/lib/tessera/search.ts` line 334; `SearchAllInput` line 46) and returns
  `{ hits: SearchHit[] }` (`SearchHit = { type, id, project_id, key?, title, subtitle?, score }`,
  line 26) with `Cache-Control: no-store`. `VALIDATION` → 400 `{ error }`.
  Consumers: Power K, `#` mentions, `ParentPicker`, entity-link resolution.
- Contextual actions: `src/components/shell/command-context.ts` (D4; D2 imports
  `registerCommandContext` — whichever lane needs the file first creates it with
  exactly this surface so the merge is clean):

```ts
export type CommandItem = { id: string; key: string; title: string; projectId: string; url: string };
export type CommandContextValue = { item: CommandItem; actions: Partial<Record<ShortcutId, () => void>> };
export function registerCommandContext(value: CommandContextValue): () => void;  // returns unregister
export function useCommandContext(): CommandContextValue | null;                  // useSyncExternalStore, server snapshot null
```

  `WorkItemDetail` registers `{ item, actions }` where `actions` opens the
  matching `PropertyRail` control (`item.state` → focus the first `button` inside
  `div[data-property="state"]` and `.click()` it; the P2a ghost `Selector`s open on
  click; switch to an `isOpen` prop if lane C adds one), `item.assignMe` →
  `setAssigneesAction` with the union of `assignee_ids` and `currentActorId`,
  `item.subscribe` toggles, `item.delete` opens Astryx `AlertDialog`
  (`dist/AlertDialog/AlertDialog.d.ts`: `title`, `description`, `actionLabel`,
  `onAction`, `cancelLabel`, `actionVariant: "destructive"`) → `deleteWorkItemAction({ work_item_id })`
  → close/navigate to the list, `item.copyId` / `item.copyTitle` / `item.copyUrl`
  via `useClipboard`, `item.estimate` → Toast "Arrives in P8". When a context is
  registered, Power K's bootstrap adds the "Actions" group ("Change state…",
  "Change priority…", "Assign…", "Assign to me", "Labels…", "Subscribe"/"Unsubscribe",
  "Copy ID", "Copy link", "Open full page", "Delete…").
- Registry `src/components/shell/shortcuts.ts` (pure, no React; tests in
  `tests/ui/shortcuts.test.ts`):

```ts
export type ShortcutId =
  | "palette.open" | "shortcuts.help" | "peek.close"
  | "item.state" | "item.priority" | "item.assign" | "item.assignMe" | "item.labels" | "item.estimate"
  | "item.cycle" | "item.modules" | "item.subscribe" | "item.delete" | "item.copyId" | "item.copyTitle" | "item.copyUrl"
  | "create.workItem" | "create.cycle" | "create.module" | "create.view" | "create.page" | "create.project"
  | "nav.home" | "nav.workItems" | "nav.cycles" | "nav.modules" | "nav.views" | "nav.pages" | "nav.inbox"
  | "nav.archives" | "nav.settings" | "nav.yourWork" | "nav.analytics" | "nav.projects" | "nav.intake" | "nav.drafts";
export type CommandId = ShortcutId | "theme.dark" | "theme.light" | "theme.system";
export type ShortcutDef = { id: ShortcutId; label: string; keys: string; group: "Global" | "Work item" | "Create" | "Navigate"; needsItem?: boolean; arrives?: "P3" | "P5" | "P6" | "P7" | "P8" | "P9" };
export const SHORTCUTS: readonly ShortcutDef[];
export const CHORD_WINDOW_MS = 1000;
export type KeyLike = { code: string; key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };
export type ChordState = { prefix: "g" | "n"; at: number } | null;
export type ShortcutContext = { isMac: boolean; hasItem: boolean; isTyping: boolean; singleKeys: boolean };
export type Resolved = { kind: "action"; id: ShortcutId } | { kind: "chord"; prefix: "g" | "n" } | null;
export function resolveShortcut(event: KeyLike, chord: ChordState, now: number, context: ShortcutContext): Resolved;
export function formatKeys(keys: string, isMac: boolean): string;   // "mod+." → "⌘ ." / "Ctrl ."
```

  Matching is by `event.code` (`KeyS`, `KeyP`, `KeyA`, `KeyI`, `KeyL`, `KeyE`,
  `KeyC`, `KeyM`, `KeyG`, `KeyN`, `Period`, `Quote`, `Comma`, `Slash`, `Delete`,
  `Backspace`) plus modifiers (`mod` = `metaKey` on Mac, `ctrlKey` elsewhere), which
  is why the item shortcuts do not go through Astryx `useHotkeys`: it compares the
  final key with `event.key`, so `mod+shift+'` and `mod+shift+,` would depend on the
  keyboard layout (`dist/hooks/useHotkeys.d.ts`, "Shift semantics"). Table:
  `s` state, `p` priority, `a` assign, `i` assign me, `l` labels, `shift+e` estimate
  (P8 hint), `shift+c` cycle, `shift+m` modules, `shift+s` subscribe (P7 hint:
  "Notifications arrive in P7", the subscription itself works), `mod+delete`
  (`Delete` or `Backspace`) delete with confirm, `mod+.` copy ID, `mod+shift+'` copy
  title, `mod+shift+,` copy URL; chords `n` then `i` work item / `c` cycle (P3) /
  `m` module (P3) / `v` view (P3) / `d` page (P6) / `p` project; `g` then `h` Home
  (`/home`) / `i` work items of the current or last project (`tessera.lastProject.v1`)
  / `c` cycles (P3) / `m` modules (P3) / `v` views (P3) / `d` pages (P6) / `k` inbox
  (P7) / `r` archives (P9) / `s` settings (P8) / `j` your work (P9) / `a` analytics
  (P9) / `p` projects (`/projects`) / `x` intake (P8) / `y` drafts (P9). docs/PLAN.md
  §6 lists the letters without meanings; these assignments are the contract. A
  target that does not exist yet shows a Toast "Arrives in P<n>" (`arrives`).
  `g`/`n` are discarded after `CHORD_WINDOW_MS` or on any non-matching key.
  Item shortcuts resolve only when `hasItem`; single-key shortcuts resolve only when
  `singleKeys` (off switch in the help dialog, `localStorage` `tessera.shortcuts.v1`
  `{ "singleKeys": boolean }`, satisfying the WCAG note in `useHotkeys.d.ts`).
- Dispatcher `src/components/shell/useShortcuts.ts` (`"use client"`, mounted once
  inside `CommandBar`): one `window` keydown listener; `isTyping = isTypingTarget(event.target)`
  (`shortcuts.ts`; it lived in `tab-registry.ts` until the layout rework) blocks everything except
  `palette.open` and `shortcuts.help`; `hasItem = useCommandContext() !== null`;
  item ids run the registered context action, `create.workItem` pushes
  `/projects/<current or last>/work-items?create=1` (what the Sidebar does today;
  `QuickCreate` from the P2a note does not exist yet), `nav.*` push routes,
  `peek.close` is left to `PeekHost`. `event.preventDefault()` only when something resolved.
- Help dialog (`mod+/` and the "Keyboard shortcuts" command): Astryx `Dialog`
  listing `SHORTCUTS` by group with `Kbd` (`dist/Kbd/Kbd.d.ts`: `keys` string such
  as `"mod+k"`) and the single-key switch.

### Lane split and file ownership

The lane split below is the P2b record. The layout rework (2026-10-11) deleted
`TabBar.tsx`, `tab-registry.ts` and `tests/ui/tab-registry.test.ts`; the table
names their replacements, `recents.ts` (with `tests/ui/recents.test.ts`),
`recents-store.ts` and `RecentsTracker.tsx` ("Shell" above).

| Lane | Creates | May edit additively (name it in the hand-off) | Must not touch |
|---|---|---|---|
| D1 editor | `src/components/editor/**`, `src/components/styles/editor.css`, `src/app/api/work-items/[workItemId]/description/route.ts`, `tests/editor/**` | `src/app/globals.css` (one `@import`), `src/themes/catppuccin/icons.tsx` (`DragHandleIcon`), `package.json` + lockfile only for the three installs in editor.md | `src/components/detail`, `src/components/shell`, `src/components/work-items`, `src/app/actions/*` |
| D2 detail | `src/components/detail/**` (except `PeekHost.tsx`, `peek-url.ts`, `peek-prefs.ts`), `src/components/styles/detail.css`, `src/app/actions/detail.ts` | `src/app/globals.css` (one `@import`), `src/themes/catppuccin/icons.tsx` (icons listed above), `src/components/shell/command-context.ts` only if absent (verbatim surface) | `WorkItemsScreen.tsx`, `properties/*`, `TesseraShell.tsx`, `RecentsTracker.tsx`, routes |
| D3 hosts | `src/components/detail/{PeekHost.tsx,peek-url.ts,peek-prefs.ts}`, `src/components/shell/entity-labels.ts`, `src/app/(tessera)/work-items/**`, `src/app/(tessera)/browse/**`, `tests/ui/peek-url.test.ts` | `projects/[projectId]/work-items/page.tsx` (peek load + `PeekHost`), `projects/[projectId]/work-items/[workItemId]/page.tsx` (replace `QuickDetail`, delete `QuickDetail.tsx`), `WorkItemsScreen.tsx` (`onOpen` body + one import), `recents.ts` (lookup, two cases), `tests/ui/recents.test.ts` | `TesseraShell.tsx`, `Sidebar.tsx`, `properties/*`, `src/components/editor` |
| D4 Power K | `src/components/shell/{CommandBar.tsx,command-source.ts,command-context.ts,shortcuts.ts,useShortcuts.ts}`, `src/app/api/search/route.ts`, `tests/ui/shortcuts.test.ts` | `TesseraShell.tsx` (mount + `openCommandBar`), `Sidebar.tsx` (search button → `openCommandBar`, if the button exists), `src/components/styles/shell.css` | `recents.ts`, `RecentsTracker.tsx`, `src/components/detail`, `src/components/work-items`, routes other than `api/search` |

Shared contracts between lanes are the types and signatures in this section;
until all four merge, a lane that imports another lane's module may stub it
locally with the exact exported names and must delete the stub in its hand-off.
`WorkItemDetail` (D2) is rendered by D3's hosts with the props above; D2 ships a
`src/components/detail/index.ts` exporting `WorkItemDetail`, `DescriptionEditor`
and the types.

### Acceptance (P2b)

Browser steps (docs/PLAN.md §12, through `.claude/launch.json` → `tessera`), in order:

1. Steps 1–4 of §12 still pass (project `WEB`, `WEB-1`, drag, priority + due date);
   step 4 is done in the peek: press Enter on the row → `?peek=<id>` opens the
   side panel, set priority High and a due date, reload → both kept and the peek
   is still open; Escape closes it and drops `?peek` while keeping `q`.
2. Step 5: type in the description, reload within 200 ms → text persisted (the
   `pagehide` beacon hits `POST /api/work-items/<id>/description`; check the
   Network panel for a 200).
3. Step 6: from the stdio MCP change the state → the open tab refreshes within
   5 s. Then type in the description and, before the 400 ms save, change the
   description from the MCP (`update_work_item_description`) → the Banner
   "Changed elsewhere" with "Keep mine" / "Load theirs" appears instead of a silent
   overwrite; "Keep mine" saves and the Banner clears.
4. `mod+k`, type `WEB-1` → the item is the first hit; Enter opens it (peek inside
   the project, full page elsewhere). "All projects" toggle shows the same hit from `/home`.
5. With the peek open, `s` opens the state picker; `mod+.` copies the ID (toast
   or announce); `mod+/` lists the shortcuts.
6. `/browse/WEB-1` redirects to `/projects/<id>/work-items/<itemId>`;
   `/browse/NOPE-9` renders not-found; `/work-items/<itemId>` renders the detail
   without the project tabs and its Recents entry (Home, Power K) reads `WEB-1 <title>`.
7. Drag the peek's handle → width changes within 360–720 px and survives reload;
   switch to modal from the "Open as" menu → survives reload.
8. Round trip: paste a description with a table, nested task list and a
   `[WEB-1](work:WEB-1)` link, reload → the editor shows the same content and the
   chip opens the item.

Gate: `npm run check` green (lint, conventions, licences, Vitest including
`tests/editor/*` under jsdom and `tests/ui/{shortcuts,peek-url,recents}.test.ts`),
`next build` green, no hydration warnings in the dev console on the list, the
peek, the full page, `/work-items/[id]` and `/browse/[key]`.

### API verification and mismatches found while writing this section

1. docs/PLAN.md §11 names `@tiptap/extension-task-list`, `@tiptap/extension-placeholder`
   and `@tiptap/extension-bubble-menu` as installs; in Tiptap 3.31.4 the pieces come
   from `@tiptap/extension-list`, `@tiptap/extensions` and `@tiptap/react/menus`.
2. `@tiptap/extension-link@3.31.4` and `@tiptap/extension-list@3.31.4` are only
   transitive today; add them as exact direct dependencies (editor.md).
3. No DOM test environment is installed; add devDependency `jsdom@30.1.2` (MIT) and
   use the per-file `// @vitest-environment jsdom` docblock.
4. Astryx `useHotkeys` matches the final key against `event.key`
   (`dist/hooks/useHotkeys.d.ts`), so `mod+shift+'` / `mod+shift+,` would be
   layout-dependent; item shortcuts use the `event.code` resolver above, and
   `useHotkeys` is used only for `mod+k`, `mod+/`, `escape`.
5. `@/lib/tessera/core/ids` (`isId`) is not importable from components; use
   `IdSchema.safeParse` from `@/lib/tessera/schemas`.
6. `refresh()` is Server-Action-only (`refresh.md` line 13): the beacon route and
   `/api/search` cannot refresh; the route mirrors `_run.ts` without it.
7. Astryx `AppShell` has no right-panel slot; the peek is a `Layout` `end` slot
   inside the page (`LayoutPanel` + `ResizeHandle isReversed`).
8. Astryx `Banner` has no `actions` prop; buttons go in `endContent`
   (`dist/Banner/Banner.d.ts`).
9. `useResizable` persists through `autoSaveId` in its own format and its single
   config uses `defaultSize/minSize/maxSize` (not SideNav's `defaultWidth/minWidth/maxWidth`
   from `ResizableConfig`); the contract stores `tessera.peek.v1` itself via `onSizeChange`.
10. `resolveTab` labels `/work-items/[id]` and `/browse/[key]` by `titleCase(root)`
    today; two additive cases are needed (D3).
11. `actions/work-items.ts` has no subscribe/copy/link wrappers; they go in the new
    lane-D file `actions/detail.ts`.
12. The P2a shell note above mentions `QuickCreate` and a `mod+k` search button;
    neither exists in `src/components/shell/` yet (the Sidebar's "New work item"
    pushes `?create=1`), so D4 wires `n i` to that URL and `mod+k` itself.
13. The Astryx `work-item-detail` page template (`node_modules/@astryxdesign/cli/assets/templates/pages/work-item-detail/page.tsx`)
    is stylex-based reference code: port ideas only, never import it.
14. Astryx declarations live under `node_modules/@astryxdesign/core/dist/<Name>/`;
    the P2a rule's `core/<Name>` path does not exist.
15. `@tiptap/markdown` keeps unrecognised HTML as literal text and needs
    `window.DOMParser` for recognised inline HTML (`dist/index.js` ~927); without a DOM
    everything becomes literal text, which is why the corpus runs under jsdom.

## P3: cycles, modules, archives

Five lanes start on the same day and do not talk to each other: **A** engine
additions (progress schemas, cycle points and snapshot, `open_count`,
breakdowns, the archived-module guard, tool descriptions; no new tools) plus the
acceptance MCP client `scripts/mcp-call.ts` and the docs/PLAN.md corrections,
**E1** cycles and the burndown/burnup chart, **E2** modules, **E3** archives
(work items, cycles, modules, projects) with every archive and restore control,
**E4** integration (the scoped work items list, project tabs, sidebar, tab
labels, Power K, editor links). Every API named here was checked against the
installed packages on 2026-10-11 (file cited in brackets; Astryx declarations
under `node_modules/@astryxdesign/core/dist/<Name>/`). `recharts@3.10.1` and
`react-is@19.3.0` (exact) were installed in the P3 prep commit, together with the
icon patch and the three empty stylesheets with their `@import` lines (see "Icons,
CSS and conventions"); E1 re-checks the Recharts props named here against
`node_modules/recharts/types/` before writing the chart. Mismatches with
docs/PLAN.md and the code are collected at the end.

### Carried items (not P3 work)

- List titles, the Home "Projects" heading, the handbook search dialog's
  accessible name and the old handbook tabs' button inside a button were fixed
  in `2c96000`; nothing to do.
- `npm run astryx -- doctor` now reports two warnings, the theme-fonts check and
  the themes summary that repeats it (the agent-instructions warning is gone;
  re-run 2026-10-11: pass 18, warn 2, fail 0).
  Fonts load through `next/font`, as AGENTS.md records; accepted until Astryx
  recognises `next/font`.
- Astryx 0.6.8 `ContextMenu` prop warnings in development: an upstream fix; P3
  adds no `ContextMenu`. React's occasional "negative time stamp" performance
  error in development: known React issue, noted since P2a, not in production.
  These two are the only dev-console entries the P3 acceptance tolerates.

### Scope and deferrals

Ships in P3: cycles list (sections Current, Upcoming, Completed, Draft) with the
active cycle summary card; create and edit dialog; cycle detail with the scoped
work items list and a side panel (progress, burndown/burnup, breakdowns by
assignee, label and state); transfer of open items (to a cycle or to no cycle);
archive, restore and delete of cycles; modules list and detail (status, lead,
members, dates, links, progress, breakdowns); "Add existing work items" for
cycles and modules; project archives (work items, cycles, modules) and archived
projects, each with restore and delete; archive and restore of a work item from
its detail; Cycles, Modules and Archives tabs in the project panel header, recent
labels, Power K targets and `cycle:` / `module:` editor links. (P3 shipped
per-project sidebar entries and tab-bar labels; the layout rework merge replaced
them with flat sidebar rows and recents, see "As built (layout rework merge,
2026-10-11)".)

| Deferred | Phase | Note |
|---|---|---|
| Module gallery and timeline layouts | P10 (timeline with gantt), P9 (gallery) | P3 modules list is a `List` |
| Module burndown chart | P9 | The panel shows counts and breakdowns only |
| Favourites of cycles and modules (`mod+f`) | P9 | No star button in P3 |
| `/active-cycles` workspace page | P9 | Engine `getActiveCycles` already exists |
| Cycle and module reorder UI | P9 (with favourites) | `reorder_cycle` / `reorder_module` stay MCP-only |
| Entity activity feeds for cycles and modules | P5 (digests) | Rows are logged already |
| `view_settings` and saved-filter cleanup when a cycle or module is deleted | P4 | Stale rows are ignored by the engine |
| Feature toggle settings UI | P4 | P3 reads `cycles_enabled` / `modules_enabled` and hides UI; MCP `update_project_features` changes them |
| Estimates UI; points mode in practice | P8 | P3 ships the points switch, shown only with an active estimate |
| Search hits marked as archived | P9 | `searchAll` excludes archived entities by default |
| Read-only UI for archived projects | P4 | P3 shows a Banner; the engine refuses writes (`ARCHIVED`, Toast) |
| Burnup scope over time (a per-day scope series from each item's join day) | P9 analytics | P3 draws the current scope (`total − cancelled`) as a flat line, so items added mid-cycle do not show as a scope step; the engine has no scope series (tools.md `get_cycle_progress` says so) |
| Filters, display options and layouts on Archives › Work items | P4 (views) | P3 shows a plain `List` ordered by last update; the `archived` view_settings scope stays unused |
| Search, sort and filter on the cycles and modules lists | P4 (views) | Engine order (`sort_order`, then creation) |
| "Copy link" in the cycle and module menus | P9 (with favourites) | The URL bar carries the link |
| Module shortcuts `s` (status) and `m` (members) | P9 | The side panel's inline controls only |
| Activity row per detached item when a module is deleted | P5 (entity feeds) | `deleteModule` logs only the module row; `deleteCycle` already logs one per item |
| Row action "Remove from cycle" / "Remove from module" in the scoped list | P8 (bulk bar) | An item leaves through its Cycle or Modules property (peek or full page); P3 adds no `remove_work_items_from_*` wrapper |
| Manual start/stop and parallel cycles | never | Decision 16: dates decide the status, no overlap |

### Routes and data loading

| Route | File (lane) | Reads in one `readTessera` |
|---|---|---|
| `/projects/[projectId]/cycles` | `src/app/(tessera)/projects/[projectId]/cycles/page.tsx` (E1) | `getProject`, `listCycles(ctx, projectId, {})`; for the current cycle `getCycle` and, with an active estimate, `getCycleProgress(ctx, id, { mode: "points" })`; `ctx.today()` |
| `/projects/[projectId]/cycles/[cycleId]` | `.../cycles/[cycleId]/page.tsx` (E1) | `getProject`, `getCycle`, points progress as above, candidates (below), `ctx.today()`; then `<ScopedWorkItems>` (E4) |
| `/projects/[projectId]/modules` | `.../modules/page.tsx` (E2) | `getProject`, `listModules(ctx, projectId, {})`, `ctx.today()` |
| `/projects/[projectId]/modules/[moduleId]` | `.../modules/[moduleId]/page.tsx` (E2) | `getProject`, `getModule`, candidates, `ctx.today()`; then `<ScopedWorkItems>` |
| `/projects/[projectId]/archives` | `.../archives/page.tsx` (E3) | none: after `await params` it redirects to `/projects/<projectId>/archives/work-items` |
| (layout) | `.../archives/layout.tsx` (E3) | none: renders `<ArchivesTabs projectId>` above `children` |
| `/projects/[projectId]/archives/work-items` | `.../archives/work-items/page.tsx` (E3) | `listWorkItems(ctx, { scope: { type: "archived", project_id }, display: { order_by: "-updated_at" }, limit: 2000 })`, the peek through `loadPeek` (E4) |
| `/projects/[projectId]/archives/cycles` | `.../archives/cycles/page.tsx` (E3) | `getProject`, `listCycles(ctx, projectId, { archived: true })` |
| `/projects/[projectId]/archives/modules` | `.../archives/modules/page.tsx` (E3) | `getProject`, `listModules(ctx, projectId, { archived: true })` |
| `/projects/archives` | `src/app/(tessera)/projects/archives/page.tsx` (E3) | `listProjects(ctx, { archived: true })` |
| `/cycles/[cycleId]`, `/modules/[moduleId]` | `src/app/(tessera)/{cycles/[cycleId],modules/[moduleId]}/page.tsx` (E4) | `getCycle` / `getModule` → `redirect` to the project route |

- Pattern for every page (copy of `/browse/[key]` and the P2b detail page): sync
  default export → `<Suspense fallback={<…Skeleton />}>` → async child that awaits
  `params` (and `searchParams` where used), `await io()` (`04-functions/io.md`:
  "call `await io()` before reading … a synchronous database driver"), validates
  ids with `IdSchema.safeParse` (from `@/lib/tessera/schemas`) and calls `notFound()`
  for a malformed id, then one `readTessera` in a `try`; `NOT_FOUND` / `VALIDATION`
  → `notFound()`; an entity whose `project_id !== projectId` → `notFound()`.
  `redirect()` stays outside the `try` (`04-functions/redirect.md`). The project
  layout's `export const instant = false` opts out only navigations *into* the
  project segment; navigations between sibling segments under it (work items →
  cycles → a cycle → archives) are still validated ("Opting out" in
  `01-app/02-guides/instant-navigation.md`: "Navigations between sibling segments
  below are still validated"). So every new P3 page (each route in the table,
  `/projects/archives` and the two alias routes included) adds
  `export const instant = false` to its own `page.tsx` when the dev validator reports
  an insight for it (typically the `notFound()` or `redirect()` path), and the lane
  names it in the hand-off. Acceptance step 15 walks the sibling navigations.
- `/projects/archives` is a static segment next to `[projectId]`, so Next routes it
  to its own page and the project layout does not wrap it. Three path parsers treat
  `archives` as a project id today (`Sidebar.tsx`, `useShortcuts.ts`, `CommandBar.tsx`;
  mismatch 12); E4 replaces them with one guarded function, which lives in
  `recents.ts` since the layout rework merge (`projectIdFromPath`).
- Feature off (`project.cycles_enabled` / `modules_enabled`, read with `getProject`
  in the same `readTessera`): the list and detail routes of that feature
  (`/cycles`, `/cycles/[cycleId]`, `/modules`, `/modules/[moduleId]`) and its
  archive route (`/archives/cycles`, `/archives/modules`) render
  `<FeatureOffState feature="cycles" | "modules" />` (E1) instead of the screen and
  skip the other reads; `ArchivesTabs` leaves out the Cycles or Modules tab; the
  alias routes `/cycles/[cycleId]` and `/modules/[moduleId]` still redirect (the
  target then shows the state). `FeatureOffState` is an Astryx `EmptyState`
  (`dist/EmptyState/EmptyState.d.ts`: `title`, `description`, `icon`, `actions`,
  `isCompact`) titled "Cycles are turned off for this project" (or "Modules …",
  "Views …", "Pages …", "Intake …"), description "Turn them on in Settings ›
  Features." with an "Open Features settings" button to
  `/projects/<projectId>/settings/features` (the P3 text said settings arrive in
  P4, with no button).
- Lookup order on the detail routes of a scope (`/cycles/[cycleId]`,
  `/modules/[moduleId]` and the saved view page `/views/[viewId]`): the record is
  looked up before the feature toggle is read (`lookupScoped`,
  `src/app/(tessera)/projects/[projectId]/scope-lookup.ts`, called inside the page's
  one `readTessera` after `getProject`). An unknown, deleted or malformed id, or a
  record of another project, is "missing" and the page answers `notFound()` whether
  the feature is on or off; only a real record of a project that has the feature
  turned off reaches `FeatureOffState`. An unknown project still throws its own
  NOT_FOUND, which the page maps to `notFound()` as before. The order matters to
  recents: `RecentsTracker` records the paths of pages that render, and a
  feature-off state shown before the lookup stored dead ids as recents, so a
  missing id now renders the not-found screen, which `useMissingRoute` keeps out of
  the list. The list routes (`/cycles`, `/modules`, `/views`) have no id to look
  up and still check the toggle first. Guard: `tests/ui/scope-lookup.test.ts`
  (decision 31).
- `?create=1` on `/cycles` and `/modules` opens the create dialog once and is then
  dropped with `router.replace` (the `WorkItemsScreen` `createOnOpen` handling). It
  is what `n c` / `n m` push.
- Candidates for "Add existing work items" are loaded with the detail, not searched:
  `listWorkItems(ctx, { scope: { type: "project", project_id }, filters, display: { order_by: "-updated_at" }, limit: 500 })`
  mapped to `ItemCandidate` (below). Cycles pass `filters: { state_group: ["backlog", "unstarted", "started"] }`
  (the engine refuses closed items, `RULE work_item_closed`) and the client drops
  members, items in a completed cycle (`bundle.cycles` status) and items in a cycle
  missing from the bundle (archived); modules pass no filter and drop members.
  Skipped for completed or archived cycles and archived modules.
- `today` (`ctx.today()`, server local date, decision 6) travels as a prop so
  "days left", the chart's today marker and the pace line render the same on the
  server and the client.
- Recent labels (E4; `recents.resolveRoute` since the layout rework merge, which
  replaced the tab bar's `tab-registry.ts`): `/projects/<p>/cycles` → "<project> ·
  Cycles", `/projects/<p>/cycles/<c>` → "<project> · <cycle name>" (else "Cycle"),
  `/projects/<p>/modules(/<m>)` likewise with "Modules" / "Module",
  `/projects/<p>/archives/<tab>` → "<project> · Archived work items", "· Archived
  cycles" or "· Archived modules" (one label per tab since the layout rework merge,
  so three archives recents never read as one repeated entry; any other path under
  it → "<project> · Archives"), `/projects/archives` → "Archived projects". These labels show on Home's "Recent" list and in Power K's
  "Recent" group. Never recorded (`isTransientPath`): `/cycles/<id>` and
  `/modules/<id>` (aliases that redirect, like `/browse/`), the project index
  `/projects/<p>` and the archives index `/projects/<p>/archives`, which redirect
  too. Detail screens call `registerEntityLabel(id, name)`
  (`src/components/shell/entity-labels.ts`) in an effect.

### Lane A: engine additions

No new tools, no new activity verbs, no migration (`progress_snapshot` is JSON
and the schema only widens). Signatures and rules are appended to
`docs/contracts/service-api.md` ("P3 additions") and `docs/contracts/tools.md`
("P3 changes"). Summary:

1. `schemas.ts`: `PointsCountsSchema` (the `ProgressCounts` keys as
   `z.number().nonnegative()`, since estimate values may be fractional),
   `ProgressModeSchema = z.enum(["issues", "points"])` (`CycleProgressModeSchema` stays
   as an alias), `ProgressBreakdownRowSchema = z.object({ id: IdSchema.nullable(), total: int ≥ 0, completed: int ≥ 0 })`.
   `CycleProgressSchema` changes `points` to `PointsCountsSchema.optional()` and
   `completion_chart` values to `z.number().nonnegative()`, and adds optional
   `assignees`, `labels` (breakdown rows), `chart_mode` (`ProgressModeSchema`) and
   `completion_chart_points` (written into snapshots only; never part of a returned
   `CycleProgress`, but visible inside the raw `progress_snapshot` field, because
   `Cycle` and `CycleDetail` spread the whole `CycleRow` in `toCycles` /
   `toCycleDetail`, so `list_cycles`, `get_cycle` and the project bundle carry it).
   Types `PointsCounts`, `ProgressBreakdownRow`, `ProgressMode` in `types.ts`.
2. Cycle points follow the project's active estimate (`estimates_enabled` and
   `estimate_id`), count only non-deleted points of that estimate with a numeric
   value ≥ 0, and are absent otherwise (module progress already behaves this way).
   `computeProgress` builds the items series and, with an active estimate, the
   points series; `freezeSnapshot` stores both; `forMode` returns the requested
   series with `chart_mode`, falling back to the items series (`chart_mode: "issues"`)
   when no points series exists (pre-P3 snapshots, no estimate).
3. `Cycle` and `CycleDetail` gain `open_count: number`: live count of non-deleted
   members whose state group is neither completed nor cancelled, archived and triage
   members included, so it equals what `transferCycleWorkItems` would move.
4. Archived-module guard: `syncModules` (`set_modules`, `move_work_item` grouped by
   module) and `createWorkItem` refuse with `ARCHIVED` when a module being added or
   removed is archived; memberships of archived modules the call does not change are kept.
5. Breakdowns: `CycleProgress` and `ModuleProgress` gain `assignees` and `labels`
   rows (`completed` = completed group); `ModuleProgress` also gains `by_label` and
   `by_assignee`.
6. `modules.ts` `logMembership` writes the item-side row with `field: "modules"`
   (the name `work-items.ts` uses), so one activity label covers both paths.
7. Tool descriptions: `get_cycle_progress` (drop "the ideal line"; say there is no
   scope series), `get_module_progress` (drop "the completion percentage"),
   `list_cycles` and `get_cycle` (mention `open_count`), `unarchive_cycle` (name the
   `CONFLICT` on overlapping dates and the kept snapshot). Exact text in tools.md.
8. Tests: `tests/cycles.test.ts` (points gating, fractional and negative values,
   both series frozen and served by mode, pre-P3 snapshot fallback, breakdown rows
   with `id: null`, `open_count` equals `moved`; update the fixtures at lines
   723–780 to enable the estimate on the project, and the expectations at 434–440,
   648 and 821–822), `tests/modules.test.ts` (breakdowns; `field: "modules"` at
   lines 489 and 536), `tests/work-items.test.ts` (archived-module guard on create,
   `set_modules` add and remove, kept membership). Lane A merges first; the UI lanes
   rebase onto it before using the new fields and never edit `schemas.ts` / `types.ts`.
9. Acceptance MCP client `scripts/mcp-call.ts` (lane A owns `scripts/**`), run as
   `npx tsx scripts/mcp-call.ts <tool> ['<json arguments>']`, for example
   `npx tsx scripts/mcp-call.ts get_work_item_by_key '{"key":"P3A-3"}'`:
   - `<tool>` is the registry name; the script prefixes it with `mcpToolName`
     (`@/lib/tessera/tools/mcp`). Arguments default to `{}`; destructive tools need
     `"confirm": true` in the JSON, as for any MCP client.
   - It connects a `Client` from `@modelcontextprotocol/client` (2.3.1, already a dev
     dependency) named `p3-acceptance` through `StdioClientTransport`
     (`@modelcontextprotocol/client/stdio`) to `command: "npx"`,
     `args: ["tsx", "scripts/mcp-stdio.ts"]`, `cwd` the repo root, `stderr: "pipe"`,
     and an environment from `getDefaultEnvironment()` (a whitelist) with the
     directory of `process.execPath` prepended to `PATH` (Node-API 10 for
     better-sqlite3) and `TESSERA_DB_PATH` copied over when the calling shell sets it. This is
     the spawn form `.mcp.json` and `tests/mcp-stdio.test.ts` use. No `--db` and no
     `--migrate`: the stdio server resolves the database as the server does
     (`TESSERA_DB_PATH` from the environment or `.env.local`, else `data/tessera.db`)
     and refuses pending migrations (exit 2) instead of migrating a database a server
     owns. Since decision 140, `npm run dev` sets `data/dev/tessera.db` and the live app
     on port 3000 serves `data/tessera.db`, so export the dev server's
     `TESSERA_DB_PATH` before calling it against the dev server.
   - Output: the stdio server's stderr (it names the absolute database path) is
     copied to the script's stderr; `structuredContent` (else the first text
     content) is printed to stdout as JSON; exit code 1 when the result `isError`,
     2 when the connection fails. The actor is `mcp:p3-acceptance` (kind `agent`),
     so `ChangesPoller` refreshes open tabs.
   - No test: it is a verification tool. `npm run typecheck` covers it.
10. docs/PLAN.md corrections (lane A, which owns `docs/contracts/**`; no other lane
    owns the plan):
    §11 step 2 and §9 (Recharts and `react-is` are added in P3 with the burndown, P9
    reuses them for analytics), §5 (the alias routes `/cycles/[cycleId]` and
    `/modules/[moduleId]`, and `/projects/archives` owned by lane E), §6 and §13
    (project Archives is a frame tab plus `g r` and a link on `/projects` until the P9
    sidebar pass adds the project `…` menu; listed under deviations).

Burnup and the ideal line are derived in the client from `completion_chart`
(pending per day), the dates and the scope; the engine does not store them. There
is no scope series: the burnup draws today's scope as a flat line (deferral table).

### Shared planning pieces (E1 creates, E2 and E3 import)

`src/components/planning/types.ts` (client-safe imports from `@/lib/tessera/types` only):

```ts
import type { CycleDetail, CycleProgress, ModuleDetail, WorkItem } from "@/lib/tessera/types";

/** A row of the "Add existing work items" dialog, mapped server-side from listWorkItems. */
export type ItemCandidate = Pick<WorkItem, "id" | "key" | "name" | "state_id" | "cycle_id">;

export type CycleDetailData = {
  cycle: CycleDetail;                  // getCycle: status, open_count, progress (issues mode)
  pointsProgress: CycleProgress | null; // getCycleProgress(points) when the project has an active estimate, else null
  candidates: ItemCandidate[];         // [] for completed or archived cycles
  today: string;                       // ctx.today()
};

export type ModuleDetailData = { module: ModuleDetail; candidates: ItemCandidate[]; today: string };

export type ProgressTarget = { type: "cycle"; cycle_id: string } | { type: "module"; module_id: string };
```

- `ProgressPanel` (`src/components/planning/ProgressPanel.tsx`, `"use client"`):
  ```ts
  export type ProgressPanelProps = {
    title: string;                        // "Progress"
    counts: ProgressCounts;               // items: drives the top bar and the five state-group rows
    points?: PointsCounts;                // second line "12 of 20 points" when present
    byState: Record<string, number>;      // States tab: one row per state id, count only
    assignees?: ProgressBreakdownRow[];   // absent on snapshots frozen before P3
    labels?: ProgressBreakdownRow[];
    byAssignee: Record<string, number>;   // fallback rows (totals only) when assignees is absent
    byLabel: Record<string, number>;
    includesArchived?: boolean;           // cycles: true → caption "Includes archived work items."
    isFrozen?: boolean;                   // cycles: cycle.progress_snapshot !== null → caption "Frozen when the open items moved or the cycle was archived."
    chart?: ReactNode;                    // cycles pass <BurndownChart/>; modules pass nothing (chart in P9)
  };
  ```
  Top: Astryx `ProgressBar` (`dist/ProgressBar/ProgressBar.d.ts`: `label` required,
  `value`, `max`, `hasValueLabel` (default false; the formatter renders only when it
  is true), `formatValueLabel`, `variant` accent | success | warning | neutral |
  error) with `label="Completed"`, `value={completed}`, `max={total - cancelled}`,
  `variant="success"`, `hasValueLabel`, `formatValueLabel` → "3 of 8"; `max` 0
  renders the text "No work items" instead of the bar. Then the five state groups
  from `counts` (backlog, unstarted, started, completed, cancelled) as rows
  (`StatusDot` with the decision 22 variant via `stateGroupVariant` from
  `@/components/work-items/properties`, group label, count), then `chart`, then
  `<BreakdownTabs>`, then the captions as `Text type="supporting"`. A cycle counts as
  frozen exactly when `cycle.progress_snapshot !== null` (lane A item 1: the raw
  snapshot reaches the client); the frozen caption shows only then, and the
  archived-items caption always shows for cycles (mismatch 22).
- `BreakdownTabs` (`BreakdownTabs.tsx`): the WAI-ARIA tabs pattern, because the tabs
  swap a panel in place: `<TabList role="tablist" value onChange size="sm" layout="hug">`
  (`dist/TabList/TabList.d.ts`: `value` and `onChange` required; `role="tablist"`
  gives `role="tab"` + `aria-selected` and wires `panelId` as `aria-controls`; without
  it the strip is a `<nav>` and `Tab.js` warns in development that `panelId` does
  nothing). Each `Tab` gets `value`, `label`, `id={`${base}-tab-${key}`}` and
  `panelId={`${base}-panel-${key}`}` (`dist/TabList/Tab.d.ts`; other props spread onto
  the element), `base` from `useId()` so two panels on one page never collide; no
  `href`. Tabs Assignees, Labels, States; the open panel renders as
  `<VStack id={`${base}-panel-${key}`} role="tabpanel" aria-labelledby={`${base}-tab-${key}`}>`
  (`VStack` props extend `BaseProps`, which extends `React.HTMLAttributes`,
  `dist/BaseProps.d.ts`). Rows are an Astryx `List density="compact"` of `ListItem`
  (`dist/List/ListItem.d.ts`: `label` ReactNode, `startContent`, `endContent`):
  - Assignees (from `assignees`): `Avatar name size="sm"` + name (`ActorLabel`),
    `id: null` → "No assignee"; Labels (from `labels`): `Token label
    color={paletteTokenColor(label.color)} size="sm"`, `id: null` → "No label". Their
    `endContent` is a 64px `ProgressBar isLabelHidden label="<name> completed"
    variant="success" value={completed} max={total}` plus the text "2/5". When
    `assignees` / `labels` are absent (pre-P3 snapshot), the rows come from
    `byAssignee` / `byLabel` with the count only and no bar.
  - States (from `byState`): `StatusDot` (group variant) + state name and the count
    as text. No `ProgressBar`: a state's items are all completed or none are, so a bar
    would only repeat the group.
  Rows keep the engine order (States follow `bundle.states` order); a deleted actor,
  label or state shows "Removed".
- `AddExistingItemsDialog` (`AddExistingItemsDialog.tsx`):
  ```ts
  export type AddExistingItemsDialogProps = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;                          // "Add work items to Sprint 1"
    target: ProgressTarget;
    candidates: ItemCandidate[];
    onAdd: (ids: string[]) => Promise<boolean>; // the screen calls addWorkItemsTo{Cycle,Module}Action; true closes
  };
  ```
  Astryx `Dialog purpose="form" width={560} maxHeight="80dvh"` with the house
  layout (`Layout` header / content / footer as in
  `src/components/projects/CreateProjectDialog.tsx`; Astryx has no `DialogFooter`):
  `DialogHeader title hasDivider`, a `TextInput` "Filter" (client-side match on key
  or name, case-insensitive), a `List` of candidates, footer "Cancel" + primary "Add
  N work items" (disabled at 0, `isLoading` while pending). At most 500 rows; an
  empty list shows `EmptyState isCompact title="Nothing to add"`. Each row is a small
  `CandidateRow` component owning `const rowRef = useRef<HTMLInputElement>(null)`:
  `<ListItem label={<>{key} {name}</>} interactiveRef={rowRef} startContent={<CheckboxInput label={`${key} ${name}`} isLabelHidden value={selected} onChange={(checked) => toggle(id, checked)} ref={rowRef} />} />`
  (`dist/CheckboxInput/CheckboxInput.d.ts`: `label: string` and `value: boolean |
  "indeterminate"` required, `isLabelHidden`, `onChange(checked, event)`,
  `ref?: React.Ref<HTMLInputElement>`; `ListItem.d.ts` `interactiveRef`: the row
  delegates clicks to the checkbox and adds no second tab stop). `isLabelHidden`
  keeps the label for assistive technology without printing it twice.
- `FeatureOffState` (`FeatureOffState.tsx`): the EmptyState described under routes.
- `panel-prefs.ts`: `localStorage` key `tessera.planningPanel.v1` =
  `{ "open": boolean, "chart": "burndown" | "burnup", "unit": "issues" | "points" }`,
  read through `useSyncExternalStore` with server snapshot
  `{ open: true, chart: "burndown", unit: "issues" }` (the `peek-prefs.ts` pattern),
  writes wrapped in `try`. Shared by cycles and modules (modules use `open` only).
  The unit in use is `effectiveUnit(prefs.unit, pointsProgress !== null)` from
  `burndown.ts`: `"issues"` whenever the cycle has no points progress; the stored
  `"points"` is kept, not applied, and applies again on a cycle that has points.

### Cycles (E1): `src/components/planning/`

- `CyclesScreen` (`"use client"`):
  ```ts
  export type CyclesScreenProps = {
    projectId: string;
    cycles: Cycle[];                 // non-archived, engine order
    active: CycleDetailData | null;  // the current cycle with full progress, candidates []
    today: string;
    createOnOpen: boolean;
  };
  ```
  Header row: `Heading level={2}` "Cycles" (the frame holds the `h1`) and a primary
  `Button size="sm" label="New cycle" icon={<PlusIcon />}`. Then
  `<ActiveCycleSummary data={active} />` when a cycle is current. Then one Astryx
  `List` per non-empty section in the order Current, Upcoming, Completed, Draft
  (`List.d.ts` `header`, `hasDividers`), grouped by `groupCycles(cycles)`
  (`cycle-format.ts`). No cycles at all → `EmptyState` "No cycles yet" with the New
  cycle button in `actions`.
- `CycleRow`: ``ListItem href={`/projects/${projectId}/cycles/${id}`}`` (`ListItem.d.ts`:
  `href` renders an invisible anchor, so the menu in `endContent` is a sibling, not
  nested). `startContent` = `StatusDot variant label` (current accent, upcoming
  neutral, completed success, draft neutral; label = status label), `label` = name,
  `description` = `formatCycleRange(start, end)` plus, when current, `daysLeftLabel`.
  `endContent` = "3/8" + `ProgressBar isLabelHidden label="<name> progress"` (96px),
  an "N open" `Badge` when completed with `open_count > 0`, and `<CycleMenu>`.
- `CycleMenu`: Astryx `MoreMenu` (`dist/MoreMenu/`: `items`, `label`, `size`) with
  `DropdownMenuItemData` (`dist/DropdownMenu/DropdownMenu.d.ts`: `id`, `label`, `icon`,
  `onClick`, `isDisabled`, `description`, `variant: "default" | "destructive"`)
  from `cycleActions(cycle, today)` (`cycle-format.ts`, pure):
  Edit… (not completed, not archived), Transfer open items… (completed, not archived,
  `open_count > 0`), Archive (enabled only when completed; otherwise disabled with
  description "Cycles can be archived after their end date"), Restore (archived),
  Delete… (destructive; disabled on a completed, non-archived cycle with
  description "Archive it first"; the engine answers `LOCKED`). Delete confirms with
  `AlertDialog` (`dist/AlertDialog/`: `title`, `description`, `actionLabel`,
  `actionVariant="destructive"`, `onAction`, `isActionLoading`): "Delete Sprint 1? Its
  work items stay and leave the cycle."
- `ActiveCycleSummary`: Astryx `Card` (`dist/Card/`: `padding`, `variant`) with
  `Heading level={3}` name + `Token label="Current"`, the range with `CalendarDotsIcon`,
  `daysLeftLabel` with `TimerIcon`, the same top `ProgressBar` as `ProgressPanel`
  (`hasValueLabel`, "3 of 8"), the counts by group, and a
  compact `<BurndownChart height={160} hasDataTable={false} …/>`; an "Open cycle"
  `Link` (`dist/Link/`). The chart keeps its text summary even when compact.
- `CycleDialog` (create and edit):
  ```ts
  export type CycleDialogProps = {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    cycle?: Cycle;                    // edit when set
  };
  ```
  The other cycles come from `useProject().bundle.cycles` (non-archived, with
  `status` and, after lane A, `open_count`), the same source on the list page, the
  detail header and the summary card: `otherCycles = overlapCandidates(bundle.cycles, cycle?.id ?? null)`
  (`cycle-format.ts`: every bundle cycle except the edited one).
  `Dialog purpose="form" width={520}`; fields `TextInput` "Name" (required, ≤ 120),
  `TextArea` "Description" (plain Markdown, optional), `DateRangeInput` "Dates"
  (`dist/DateRangeInput/DateRangeInput.d.ts`: `value: DateRange | null`, `onChange`,
  `hasClear`, `dateConstraints: ReadonlyArray<(date: Date) => boolean>` where a
  `false` disables the day, `status: { type, message }`, `numberOfMonths`;
  `DateRange` = `{ start, end }` of ISO dates, `dist/utils/dateTypes.d.ts`). The
  constraint disables days inside `otherCycles` ranges (convert the `Date` with its
  local getters, never `toISOString`). No dates = draft, and the helper text says so.
  Submit → `createCycleAction({ project_id, name, description_md, start_date, end_date })`
  or `updateCycleAction({ cycle_id, … })` with only changed fields. `CONFLICT` and
  `VALIDATION` render as the date field's `status` error, other errors as a Toast.
- `CycleDetailScreen` (`"use client"`) wraps the scoped list it receives as
  `children` (a Server Component passed into a Client Component,
  `01-app/01-getting-started/05-server-and-client-components.md`, interleaving):
  ```ts
  export type CycleDetailScreenProps = { projectId: string; data: CycleDetailData; children: ReactNode };
  ```
  `<Layout height="fill" header={<CycleHeader …/>} content={<LayoutContent padding={0} isScrollable>{children}</LayoutContent>} end={panelOpen && !peekOpen ? <CycleSidePanel …/> : undefined} />`
  (`dist/Layout/Layout.d.ts` slots). `peekOpen = peekIdOf(useSearchParams()) !== null`
  (`src/components/detail/peek-url.ts`): the peek's own panel replaces the progress
  panel while an item is open. Registers `registerEntityLabel(cycle.id, cycle.name)`.
- `CycleHeader`: name (`Heading level={2}`), status `Token`, range, days left,
  buttons "Add existing" (open cycles only; opens `AddExistingItemsDialog`), a
  `IconButton` toggling the panel (`label="Show progress"` / `"Hide progress"`,
  `BurndownIcon`), `<CycleMenu>`. Completed: a `Text` line "Completed cycles are
  read-only. Transfer the open items to keep working on them." Archived: Astryx
  `Banner status="info" title="This cycle is archived"` with a Restore `Button` in
  `endContent` (`dist/Banner/Banner.d.ts`: no `actions` prop).
- `CycleSidePanel`: `LayoutPanel width={360} hasDivider padding={4} isScrollable label="Cycle progress" role="complementary"`
  (`dist/Layout/LayoutPanel.d.ts`) containing `ProgressPanel` with the chart block:
  a `SegmentedControl size="sm" label="Chart"` (`dist/SegmentedControl/`: `value`,
  `onChange`, `label`; items `value`, `label`, `icon`) Burndown / Burnup with
  `BurndownIcon` / `BurnupIcon`, and, only when `pointsProgress !== null`, a second
  `SegmentedControl label="Unit"` with items labelled "Work items" (value `issues`,
  the engine's mode name) and "Points" (value `points`). Visible text never says
  "issues": summaries read "5 of 8 work items pending". Choices persist in
  `panel-prefs`; the unit in use is `effectiveUnit` (above). `ProgressPanel` gets
  `includesArchived` and `isFrozen={cycle.progress_snapshot !== null}`.
- `TransferDialog`:
  ```ts
  export type TransferDialogProps = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    cycle: Cycle;            // completed, not archived; N = cycle.open_count
  };
  ```
  Targets come from `useProject().bundle.cycles`:
  `transferTargets(bundle.cycles, cycle.id)` (`cycle-format.ts`: status current,
  upcoming or draft, the source excluded; the bundle holds no archived cycles).
  `Dialog purpose="form" width={480}`; text "Move the N open work items of Sprint 1.
  Its progress is frozen as it is now." (`cycle-format.transferText`); when
  `cycle.progress_snapshot !== null` (frozen earlier, for example archived and then
  restored; the engine never replaces a snapshot) the second sentence reads "Its
  progress was frozen earlier and stays as it was then."; Astryx `Selector label="Move to"`
  (`dist/Selector/Selector.d.ts`) with targets (status in the option description)
  plus "No cycle" (value `__none__`, the `DisplayMenu` NONE pattern); footer primary
  "Transfer N work items". → `transferCycleWorkItemsAction({ cycle_id, to_cycle_id })`;
  Toast "Moved N work items to Sprint 2" (or "out of the cycle").
- Server Actions `src/app/actions/cycles.ts` (`"use server"`, `toolAction` from `./_run`):
  `createCycleAction`, `updateCycleAction`, `archiveCycleAction`,
  `unarchiveCycleAction`, `deleteCycleAction`, `addWorkItemsToCycleAction`,
  `transferCycleWorkItemsAction` (tools `create_cycle`, `update_cycle`,
  `archive_cycle`, `unarchive_cycle`, `delete_cycle`, `add_work_items_to_cycle`,
  `transfer_cycle_work_items`; inputs per tools.md: `{ cycle_id, … }`,
  `{ cycle_id, work_item_ids }`, `{ cycle_id, to_cycle_id }`). No wrapper for
  `remove_work_items_from_cycle`: nothing in P3 calls it (deferral table).
- `cycle-format.ts` (pure, no directive, `tests/ui/cycle-format.test.ts`):
  `CYCLE_STATUS_LABEL`, `cycleStatusVariant(status)`, `groupCycles(cycles)` →
  `{ key, label, cycles }[]` in section order without empty sections,
  `formatCycleRange(start, end)` ("Mar 1 – Mar 14", "No dates") through
  `formatShortDate` imported from `@/components/work-items/properties/date-format`
  (directive-free, created by E4, mismatch 27; never from the `"use client"`
  `DateControl.tsx`), `daysLeftLabel(end, today)` ("Ends today", "1 day left", "N
  days left") with `daysBetween` from `@/lib/tessera/core/time`,
  `cycleActions(cycle, today)`, `overlapCandidates(cycles, exceptId)`,
  `transferTargets(cycles, sourceId)`. Server Components may call these helpers.

### Burndown and burnup chart (E1)

- Library: `recharts@3.10.1` (MIT) plus `react-is@19.3.0` (MIT) as exact direct
  dependencies (mismatches 1 and 10). After install run `npm run check:licenses`
  (Recharts' tree is MIT and ISC, both allowed by `scripts/check-licenses.ts`).
  Recharts ships no `"use client"` banner, so only files marked `"use client"`
  import it; `BurndownChart.tsx` starts with `"use client"` and is imported by client
  components only.
- `burndown.ts` (pure, no React, `tests/ui/burndown.test.ts`):
  ```ts
  export type ChartKind = "burndown" | "burnup";
  export type ChartRow = { date: string; actual: number | null; ideal: number };
  export type ChartEmpty = "draft" | "upcoming" | "no_items";
  export type ChartModel = {
    kind: ChartKind;
    unit: ProgressMode;            // progress.chart_mode ?? "issues", never the requested unit blindly
    rows: ChartRow[];              // every day start_date..end_date inclusive
    scope: number;                 // total − cancelled in the unit (points.* in points)
    today: string | null;          // today when start_date ≤ today ≤ end_date, else null
    current: { actual: number; ideal: number } | null;  // at min(today, end_date)
    pace: { status: "on_track" | "ahead" | "behind"; delta: number } | null;
    empty: ChartEmpty | null;
  };
  export function buildChartModel(input: { start_date: string | null; end_date: string | null; status: CycleStatus; today: string; progress: CycleProgress; kind: ChartKind }): ChartModel;
  export function idealSeries(scope: number, days: number): number[];
  export function paceOf(actualPending: number, idealPending: number, scope: number): ChartModel["pace"];
  export function summarizeChart(model: ChartModel): string;
  export function formatAmount(value: number, unit: ProgressMode): string;   // "1 work item", "3 work items", "4.5 points" (one decimal at most)
  export function effectiveUnit(preferred: ProgressMode, hasPoints: boolean): ProgressMode;  // "issues" unless hasPoints
  ```
  Burndown `actual` = `completion_chart[date]` (pending), `null` for days after
  `min(today, end_date)` so the line stops; burnup `actual` = `scope − pending`, and
  the scope line is flat at today's `scope` for the whole range (a known
  simplification: the engine has no per-day scope series, deferral table → P9). On
  a frozen cycle `scope` comes from the snapshot, so it is flat at the frozen scope.
  Ideal burndown: `scope × (n − 1 − i) / (n − 1)` for day `i` of `n` days, one day
  → `[0]`; burnup ideal is `scope − ideal`. Pace compares pending at
  `min(today, end_date)` with the ideal there: on track when
  `|delta| ≤ max(1, 5% of scope)`, behind when pending is higher, ahead when lower.
  `empty`: no dates → `"draft"`, status upcoming → `"upcoming"`, `scope === 0` → `"no_items"`.
- `chart-colors.ts`: token names only, never hex (the `hex-colour` convention rule):
  ```ts
  export const CHART_TOKENS = {
    actual: "--color-data-categorical-blue",
    ideal: "--color-text-secondary",
    scope: "--color-data-categorical-purple",
    today: "--color-border-emphasized",
    grid: "--color-border",
    axis: "--color-text-secondary",
    tooltipSurface: "--color-background-popover",
    tooltipText: "--color-text-primary",
  } as const;
  export function useChartColors(): Record<keyof typeof CHART_TOKENS, string>;
  ```
  `useChartColors` reads `useTheme().tokens` (`@astryxdesign/core/theme`,
  `dist/theme/useTheme.d.ts`: "raw CSS values … suitable for … data visualization
  libraries", resolved for the active mode and memoized per theme and mode) and maps
  the names in a `useMemo`. Recharts writes colours into SVG attributes, which is the
  case the Astryx doc reserves the resolver for; `tokenVar` stays for CSS. The data
  tokens are already wired in `palette.ts` `DATA_TOKENS`.
- Contrast (Theme rules): chart strokes are graphics and need 3:1 against the panel
  and card surfaces (`--color-background-surface` / `-card`, both `base`) and the
  body (`mantle`). Measured: blue 4.34 / 5.34 (Latte / Frappé on base), purple
  4.79 / 5.60, `--color-border-emphasized` 3.54 / 3.65, axis text (`subtext1`) 5.53 /
  6.75. Green (2.96) and peach (2.64) fail on Latte, so they are not used. E1 adds one
  case to `tests/themes/catppuccin-contrast.test.ts` ("chart strokes are visible on
  every content surface") importing `DATA_TOKENS`. Blue and purple are close in
  luminance (1.10), so lines also differ by pattern and by direct labels: actual
  solid 2px, ideal dashed `"4 4"`, scope dotted `"2 4"`, each named in the legend
  text, never by colour alone (WCAG 1.4.1).
- `BurndownChart`:
  ```ts
  export type BurndownChartProps = {
    cycle: Pick<Cycle, "name" | "start_date" | "end_date" | "status">;
    progress: CycleProgress;       // issues or points progress
    kind: ChartKind;
    today: string;
    height?: number;               // default 240
    hasDataTable?: boolean;        // default true
    onAddDates?: () => void;       // draft empty state action (open cycles only)
  };
  ```
  Recharts parts: `LineChart` with the `responsive` prop (not `ResponsiveContainer`)
  and `style={{ width: "100%", height }}`, `accessibilityLayer={false}`;
  `CartesianGrid vertical={false} stroke={grid}`; `XAxis dataKey="date"` (category,
  ticks through `formatShortDate`, `tick={{ fill: axis }}`, `stroke={grid}`);
  `YAxis allowDecimals={unit === "points"} stroke={grid} tick={{ fill: axis }}` (left
  bare, both axes fall back to Recharts' default `#666` stroke, which also colours the
  tick text: a hard-coded hex near 2:1 on Frappé base); `Line dataKey="actual"
  type="linear" stroke={actual} strokeWidth={2} dot={false} connectNulls={false}
  isAnimationActive={false}`; `Line dataKey="ideal" strokeDasharray="4 4"
  stroke={ideal} dot={false} isAnimationActive={false}`; burnup only:
  `ReferenceLine y={scope} stroke={scope} strokeDasharray="2 4" label={{ value: "Scope", fill: axis, position: "insideTopRight" }}`;
  `ReferenceLine x={today} stroke={today} label={{ value: "Today", fill: axis, position: "insideTopRight" }}`
  only when `model.today` (a bare string label sets no fill, so its text would fall
  back to SVG black); `Tooltip cursor={{ stroke: grid }} isAnimationActive={false}`
  (the default cursor is a light grey, the default animation `"auto"`) with
  `contentStyle` / `labelStyle` / `itemStyle` built from the tooltip colours and
  `var(--radius-container)`. No animation anywhere (reduced motion, stable tests), and
  no colour in the chart that does not come from `useChartColors`.
- Hydration: the theme mode resolves on the client and `responsive` measures the
  DOM, so the SVG renders only after mount (`useSyncExternalStore(noop, () => true, () => false)`,
  the `useHydrated` pattern in `src/components/detail/RelativeTime.tsx`); before
  that a `Skeleton` of the same height holds the space.
- Accessibility: the chart container is an Astryx primitive,
  `<VStack role="img" aria-label={summarizeChart(model)}>` around the `LineChart`
  (`VStack` props extend `BaseProps`, which extends `React.HTMLAttributes`,
  `dist/BaseProps.d.ts`; never a raw `div`), with the label "Burndown of Sprint 1: 5
  of 8 work items pending on Mar 9, ideal 4. Behind by 1."; the same sentence is
  visible under the chart
  (`Text type="supporting"`); a `Collapsible trigger="Data table"`
  (`dist/Collapsible/`: `trigger`, `isOpen`, `onOpenChange`) holds an Astryx
  `Table density="compact"` (`dist/Table/types.d.ts`: `data`, `columns` with `key`,
  `header`, `align: "end"`, `idKey="date"`) with Date, Pending (or Done) and Ideal.
- Empty states (`EmptyState isCompact`): draft "Add dates to see the chart" (action
  "Add dates" when `onAddDates`), upcoming "Starts <date>", no items "Add work items
  to see the chart". The panel's other sections still render.

### Modules (E2): `src/components/planning/`

- `ModulesScreen` (`"use client"`): props `{ projectId, modules: Module[], today, createOnOpen }`.
  Header `Heading level={2}` "Modules" + "New module" button; one `List` of
  `ModuleRow`s in engine order; empty → `EmptyState` "No modules yet".
- `ModuleRow`: ``ListItem href={`/projects/${projectId}/modules/${id}`}``; `startContent`
  `StatusDot` (`moduleStatusVariant`: backlog and planned neutral, in_progress accent,
  paused warning, completed success, cancelled error), `label` name, `description`
  status label · `formatModuleRange(start_date, target_date)`; `endContent` lead
  `Avatar`, members `AvatarGroup size="sm"` with `AvatarGroupOverflow count` beyond 3
  (`dist/AvatarGroup/`), "3/8" + `ProgressBar isLabelHidden`, `<ModuleMenu>`.
- `ModuleMenu` from `moduleActions(module)` (`module-format.ts`): Edit…, Archive
  (enabled only for completed or cancelled; description "Set the status to Completed
  or Cancelled first"), Restore (archived), Delete… (`AlertDialog`, "Its work items
  stay and leave the module.").
- `ModuleDialog` props `{ projectId, isOpen, onOpenChange, module?: Module }`:
  `TextInput` name, `TextArea` description, `Selector` status (default "Planned",
  decision 5), `LeadControl`, members through `AssigneeControl label="Members"`
  (`src/components/work-items/properties/AssigneeControl.tsx`, `value: string[]`),
  start and target dates through two Astryx `DateInput`s labelled "Start date" and
  "Target date" (`dist/DateInput/DateInput.d.ts`: `value?: ISODateString`,
  `onChange(value | undefined)`, `min`, `max`, `hasClear`, `format="date"`,
  `status?: { type: "error" | "warning" | "success"; message?: string }` from
  `dist/Field/types.d.ts`), linked by `max` / `min`. Not `DateControl`: it has no
  `status` prop (mismatch 29).
  Create → `createModuleAction({ project_id, name, description_md, status, lead_actor_id, member_ids, start_date, target_date })`;
  edit sends changed fields to `updateModuleAction` and members to
  `setModuleMembersAction({ module_id, actor_ids })`. Errors (the
  `CreateProjectDialog` pattern, which maps `CONFLICT` to a field `status`):
  - `CONFLICT` (names are unique per project) → `status={{ type: "error", message: "A module with this name exists" }}`
    on the Name `TextInput`.
  - `VALIDATION` whose `details` issues have `path[0]` `start_date` or `target_date`
    (`modules.ts` reports `target_date` when start is after target) → `status` on the
    Target date input with the engine's message.
  - Anything else (other `VALIDATION`, `ARCHIVED`, `NOT_FOUND`) → error Toast with the
    message; the dialog stays open.
- `LeadControl` props `{ value: string | null; onChange: (actorId: string | null) => void; readOnly?: boolean }`:
  `Selector label="Lead"` over `bundle.actors` plus "No lead" (`__none__`).
- `ModuleDetailScreen` props `{ projectId, data: ModuleDetailData, children }`: the
  cycle detail's layout with `ModuleHeader` and `ModuleSidePanel`; same peek rule,
  same `registerEntityLabel`.
- `ModuleHeader`: name, status `Selector` (inline, `size="sm"`, saves on change),
  "Add existing", panel toggle (`label` "Show details" / "Hide details" and no
  `aria-pressed`, like the cycle toggle), `ModuleMenu`; archived → info `Banner` with Restore.
- `ModuleSidePanel` (`LayoutPanel width={360}`): Astryx `MetadataList`
  (`dist/MetadataList/`: `MetadataListItem label icon`) with Lead, Members, Start,
  Target (inline controls), then `ModuleLinks`, then `ProgressPanel` without `chart`.
- Archived module (`module.archived_at !== null`): every inline control is read-only
  (header status `Selector isReadOnly`, `LeadControl readOnly`, `AssigneeControl
  readOnly`, the date inputs `isDisabled`, `ModuleLinks readOnly`), "Add existing"
  and quick-add are gone (`canCreate={false}`), and the menu offers Restore and
  Delete only. Inline saves that fail show an error Toast with the engine message.
- `ModuleLinks` props `{ moduleId: string; links: Link[]; readOnly: boolean }` (`Link` the
  type from `@/lib/tessera/types`, imported under an alias next to Astryx's `Link`): `List`
  of links, each `<AstryxLink href={link.url} isExternalLink>{link.title || link.url}</AstryxLink>`
  (`dist/Link/Link.d.ts`: `isExternalLink` opens a new tab with the external-link
  icon, sets `target="_blank"` and `rel="noopener noreferrer"`, and announces the new
  tab through `newTabLabel`; no hand-added icon), `MoreMenu` Edit… / Remove (hidden
  when `readOnly`); "Add link" opens a small form dialog (URL required, `https?://`,
  title optional). Actions `addModuleLinkAction({ module_id, url, title })`,
  `updateModuleLinkAction({ link_id, url, title })`, `removeModuleLinkAction({ link_id })`.
- Server Actions `src/app/actions/modules.ts`: `createModuleAction`,
  `updateModuleAction`, `archiveModuleAction`, `unarchiveModuleAction`,
  `deleteModuleAction`, `addWorkItemsToModuleAction`, `setModuleMembersAction`,
  `addModuleLinkAction`, `updateModuleLinkAction`, `removeModuleLinkAction`. No
  wrapper for `remove_work_items_from_module` (deferral table).
- `module-format.ts` (pure, no directive, `tests/ui/module-format.test.ts`):
  `MODULE_STATUS_LABEL`, `moduleStatusVariant`, `ARCHIVABLE_STATUSES` (the test
  asserts it equals the engine's `ARCHIVABLE_MODULE_STATUSES`; components cannot
  import `modules.ts`), `formatModuleRange` (through `formatShortDate` from
  `@/components/work-items/properties/date-format`), `moduleActions`.

### Archives (E3)

- `ArchivesTabs` (`src/components/planning/ArchivesTabs.tsx`, `"use client"`, props
  `{ projectId: string }`): navigation tabs, so no `role` and no `panelId`:
  `<TabList value={activeKind} onChange={() => {}} size="sm" layout="hug">` (both
  `value` and `onChange` are required in `dist/TabList/TabList.d.ts`; the no-op
  `onChange` is the `ProjectFrame.tsx` pattern for `href` tabs) with
  `<Tab value={kind} label href={`/projects/${projectId}/archives/${kind}`} />` for Work
  items, Cycles, Modules; `activeKind` is the path segment after `archives/` from
  `usePathname()`. The Cycles tab is left out when
  `useProject().bundle.project.cycles_enabled` is false, the Modules tab when
  `modules_enabled` is false (the archives layout sits inside the project layout,
  so the bundle is there).
- `ArchivedWorkItems` props `{ projectId: string; items: WorkItem[] }`, rendered by
  the page inside `<PeekHost projectId peek>`: a `List` whose rows open the peek
  (`peekHref` + `notePeekPush`, the `WorkItemsScreen.onOpen` body), `startContent`
  `StatusDot` of the state, `label` "WEB-3 Title", `description`
  `<RelativeTime value={item.archived_at} />` (`src/components/detail/RelativeTime.tsx`),
  `endContent` a secondary "Restore" `Button` (`RestoreIcon`) →
  `unarchiveWorkItemAction({ work_item_id })` and a `MoreMenu label="Work item actions"`
  with Delete… (destructive) → `AlertDialog` "Delete WEB-3? This cannot be undone."
  (`actionLabel="Delete"`, `isActionLoading`, closes on success) →
  `deleteWorkItemAction({ work_item_id })` (exists; `delete_work_item` works on
  archived items). Toasts "Restored WEB-3" / "Deleted WEB-3". Empty → `EmptyState`
  "No archived work items".
- `ArchivedCycles` props `{ projectId, cycles: Cycle[] }` and `ArchivedModules` props
  `{ projectId, modules: Module[] }`: rows link to the detail (which shows the archived
  Banner) and carry Restore plus a `MoreMenu` with Delete… (`AlertDialog`). Neither
  needs the other cycles: `unarchive_cycle` answers `CONFLICT` when the dates now
  overlap, and the engine message already names the cycle (`assertNoOverlap` in
  `cycles.ts`: `The dates overlap cycle "Sprint 3"`), so the Toast reads "Could not
  restore Sprint 1. The dates overlap cycle "Sprint 3"." (`ActionFailure.message`).
- `ArchivedProjects` props `{ projects: Project[] }` on `/projects/archives` (outside
  the project layout, so no `useProject()` here or in anything it renders):
  `Heading level={1}` "Archived projects", rows with `ProjectToken`
  (`src/components/work-items/ProjectFrame.tsx`) linking to the project, Restore →
  `unarchiveProjectAction({ project_id })`, Delete… → `DeleteProjectDialog`.
- `ProjectArchive.tsx` exports two components rendered by E4's `ProjectFrame`:
  `ProjectMenu({ project })` (`MoreMenu label="Project actions"`: Archive project
  (`AlertDialog`: "Archive WEB? It leaves the sidebar and becomes read-only until
  restored." → `archiveProjectAction`, then `router.push("/projects/archives")`),
  Restore project (archived), Delete project… → `DeleteProjectDialog`) and
  `ProjectArchivedBanner({ project })` (null unless archived; `Banner status="info"
  title="This project is archived"` with Restore in `endContent`).
- `DeleteProjectDialog` props `{ project: Project; isOpen; onOpenChange }`:
  `Dialog purpose="form" width={480}`, text "Deletes WEB with its work items, cycles,
  modules and views.", `TextInput label="Type WEB to confirm"`, footer Cancel +
  `Button variant="destructive" label="Delete project"` enabled when
  `confirmsDelete(project.identifier, typed)` (`archive-rules.ts`: trimmed,
  case-insensitive). → `deleteProjectAction({ project_id })` then `router.push("/projects")`.
- Work item archive and restore (additive edits in lane D's and C's files):
  `DetailHeaderProps` gains `onArchive?: () => void`, `onRestore?: () => void`,
  `archiveBlockedReason?: string`; the `MoreMenu` renders when any handler is set and
  adds Archive (`ArchiveIcon`, `isDisabled` + `description` = the reason) or Restore
  (`RestoreIcon`). `WorkItemDetail` passes them: archive only when the state group
  is completed or cancelled (`canArchiveWorkItem(group)` in `archive-rules.ts`;
  otherwise reason "Only completed or cancelled work items can be archived"), and
  shows `Banner status="info" title="This work item is archived" description="Restore it to edit it."`
  with a Restore `Button` above the title when `item.archived_at !== null`. Actions:
  `archiveWorkItemAction` (exists) and new `unarchiveWorkItemAction` in
  `src/app/actions/work-items.ts`; `archiveProjectAction`, `unarchiveProjectAction`,
  `deleteProjectAction` in `src/app/actions/projects.ts`. Toasts "Archived WEB-3" /
  "Restored WEB-3".
- `projects/page.tsx` (lane C file, additive): an "Archived projects" `Link` (with
  `ArchiveIcon`) next to "New project".
- `archive-rules.ts` (pure, `tests/ui/archive-rules.test.ts`): `canArchiveWorkItem`,
  `confirmsDelete`.

### Icons, CSS and conventions (all lanes)

- One P3 icon patch for `src/themes/catppuccin/icons.tsx`, applied in the prep
  commit; no lane edits `icons.tsx` or adds another icon (a missing one is an open
  issue in the hand-off). Phosphor files verified in `node_modules/@phosphor-icons/react/dist/csr/`.
  ```tsx
  // import list, after `RowsPlusTop,`:
    // P3 planning: cycles, charts, transfer and archives.
    Archive,
    ArrowCounterClockwise,
    ArrowsLeftRight,
    CalendarDots,
    ChartLineDown,
    ChartLineUp,
    Timer,
  // after `export const RowAddBelowIcon = duotoneIcon(RowsPlusBottom);`:
  export const ArchiveIcon = duotoneIcon(Archive);
  export const BurndownIcon = duotoneIcon(ChartLineDown);
  export const BurnupIcon = duotoneIcon(ChartLineUp);
  export const CalendarDotsIcon = duotoneIcon(CalendarDots);
  export const RestoreIcon = duotoneIcon(ArrowCounterClockwise);
  export const TimerIcon = duotoneIcon(Timer);
  export const TransferIcon = duotoneIcon(ArrowsLeftRight);
  ```
  Existing icons used: `CycleIcon`, `ModuleIcon`, `PlusIcon`, `UsersIcon`, `UserIcon`,
  `LinkIcon`, `PencilIcon`, `TrashIcon`, `CalendarIcon`, `TargetIcon`, `KanbanIcon`.
  External links get their icon from Astryx `Link isExternalLink`, not from an icon.
- CSS: `src/components/styles/planning.css` (E1: cycles list, summary card, detail
  header, side panel, progress panel, breakdowns, chart frame and data table),
  `modules.css` (E2), `archives.css` (E3); classes prefixed `tessera-planning-`,
  `tessera-modules-`, `tessera-archives-`; the three files and their `@import` lines
  in `src/app/globals.css` (order planning, modules, archives) exist since the prep
  commit, so no lane edits `globals.css`. Tokens only. Corners per the Theme rules: the summary
  card and any custom panel surface `--radius-container`, nested rows or chips
  `--radius-element` / `--radius-inner`; the chart frame has no corner of its own.
  Control outlines (filter field, inline selectors) stay Astryx's
  (`--color-border-emphasized`). No component restyles: if one is needed it is a
  request to lane B for `catppuccinTheme.ts`, not app CSS.
- Dates: `YYYY-MM-DD` values render through `formatShortDate` (from
  `properties/date-format.ts`); timestamps through `RelativeTime`. Never Astryx
  `Timestamp` on a date-only string (mismatch 13).
- Accepted trade-off (P3; lane B copies it into the Theme section's trade-offs on its
  next pass): `ProgressBar variant="success"` fills with `--color-success`
  (`pair("green")`, `palette.ts`), 2.96:1 on Latte base, under the 3:1 graphics
  rule. It stays because the fill never carries the information alone: every bar
  sits next to its text value ("3 of 8", "2/5") or is `isLabelHidden` with that text
  in the same row. A bar without an adjacent value must use `variant="accent"`.
  Chart strokes have no such text, which is why the chart avoids green (above).

### Integration (E4): scoped list, frame, sidebar, tabs, Power K, links

- Scoped work items list, `src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx`
  (async Server Component, no directive; it imports `@/lib/tessera/server`, which
  is why it lives under `src/app/` and not `src/components/`):
  ```ts
  export type WorkItemsScope = { type: "project"; project_id: string } | { type: "cycle"; cycle_id: string } | { type: "module"; module_id: string };
  export type SettingsScope = { scope_type: "project" | "cycle" | "module"; scope_id: string };
  export type ScopeDefaults = { cycle_id?: string; module_ids?: string[] };

  export type ScopedWorkItemsProps = {
    projectId: string;
    scope: WorkItemsScope;
    settingsScope: SettingsScope;              // view_settings row (decision 23): cycle → { "cycle", cycleId }
    query: Record<string, string | string[] | undefined>; // the page's awaited searchParams: q, peek, create
    scopeDefaults?: ScopeDefaults;             // new items join the cycle / module
    canCreate?: boolean;                       // default true; false for completed or archived cycles and archived modules
    hiddenGroupFields?: readonly GroupBy[];    // cycle scope ["cycle"], module scope ["module"]
  };
  export async function ScopedWorkItems(props: ScopedWorkItemsProps): Promise<React.JSX.Element>;
  export async function loadPeek(projectId: string, peekId: string): Promise<PeekData>;   // moved here from page.tsx unchanged
  export function ListSkeleton(): React.JSX.Element;                                     // moved here from page.tsx
  ```
  Body: `await io()`, then the `loadWorkItems` body of today's `work-items/page.tsx`
  generalised to `getViewSettings(ctx, settingsScope.scope_type, settingsScope.scope_id)`
  and `listWorkItems(ctx, { scope, filters, display, limit: 2000 })`; a `group_by` or
  `sub_group_by` in `hiddenGroupFields` (from saved settings or the URL) becomes
  `null` before the list call. Then the peek and
  `<PeekHost projectId peek><WorkItemsScreen …/></PeekHost>`. `work-items/page.tsx`
  becomes a thin page rendering `<ScopedWorkItems scope={{ type: "project", project_id }} settingsScope={{ scope_type: "project", scope_id: projectId }} …/>`
  with identical behaviour. E1 and E2 render it as the `children` of their detail
  screens inside `<Suspense fallback={<ListSkeleton />}>` so the header streams first.
- `WorkItemsScreen` gains optional props (defaults keep the project list as it is):
  `settingsScope` (default `{ scope_type: "project", scope_id: projectId }`),
  `scopeDefaults`, `canCreate` (default true), `hiddenGroupFields` (default `[]`).
  The quick-add closure moves into a new pure module
  `src/components/work-items/quick-add.ts` (no directive, `tests/ui/quick-add.test.ts`)
  so it can be tested:
  ```ts
  export type OpenMemberships = {
    openModuleIds: ReadonlySet<string>;   // bundle.modules that are not archived
    openCycleIds: ReadonlySet<string>;    // bundle.cycles that are not completed (the bundle holds no archived cycle)
  };
  export type QuickAddContext = OpenMemberships & {
    projectId: string;
    states: readonly State[];        // bundle.states (state_group, sort_order); the first state per group as today
    scopeDefaults?: ScopeDefaults;
  };
  export function openMemberships(bundle: Pick<ProjectBundle, "modules" | "cycles">): OpenMemberships;
  export function isOpenGroupValue(field: GroupBy | null, value: string | null, open: OpenMemberships): boolean;
  export function acceptsGroupMove(field: GroupBy | null, fromValue: string | null, toValue: string | null, open: OpenMemberships): boolean;
  export function quickAddInput(group: QuickAddGroup, name: string, context: QuickAddContext): CreateWorkItemInputType | null;
  export function withScopeDefaults<T extends ScopeDefaults>(input: T, scopeDefaults: ScopeDefaults | undefined): T;
  export function quickAddAllowed(group: QuickAddGroup, context: QuickAddContext): boolean;
  ```
  `quickAddInput` keeps today's switch and then applies `scopeDefaults` through
  `withScopeDefaults` (`cycle_id ??=`; `module_ids` is the union); the optimistic
  placeholder follows the input; the create dialog gets
  `{ ...scopeDefaults, ...createDefaults }` (module ids united). `quickAddAllowed` is
  true for the none group (value null) and false in two cases:
  - in every scope, for a group whose value is a module or cycle that is not open
    (`isOpenGroupValue`: an archived module, a completed or archived cycle). Items
    neither join nor leave those (`ARCHIVED`, `LOCKED`), so the group shows no
    quick-add row instead of a failing request;
  - in a cycle scope (`scopeDefaults.cycle_id` set), for a group that pins a closed
    state: field `state` whose state's group is `completed` or `cancelled`, or field
    `state_group` with value `completed` or `cancelled`. Closed items cannot join a
    cycle (`RULE work_item_closed`).

  Every other group keeps the row, and a module scope adds no state rule. The board
  applies the same open-membership rule to drops and "Move to"
  (`acceptsGroupMove`; see "As built (review fixes, 2026-10-11)"). Test cases: both
  closed state group kinds hidden in a cycle scope and shown in a module scope and in
  the project list, groups of an archived module and of a completed or archived cycle
  hidden in every scope, open groups shown, `openMemberships`, `acceptsGroupMove`, and
  `quickAddInput` merging `cycle_id` and the module union.
  `canCreate` false: no "New work item" button, the `c` hotkey and `?create=1` do
  nothing, layouts get `onQuickAdd={undefined}`. The unused `settingsDisplay` prop
  stays as is.
- `src/components/work-items/types.ts`: `LayoutProps.onQuickAdd` becomes optional and
  `LayoutProps` gains `canQuickAdd?: (group: QuickAddGroup) => boolean` (absent =
  always). `ListLayout` and `BoardLayout` render a group's or column's quick-add only
  when `onQuickAdd` is set and `canQuickAdd?.(group) !== false`, passing the same
  `QuickAddGroup` they would pass to `onQuickAdd`. `WorkItemsScreen` passes
  `canQuickAdd={(group) => quickAddAllowed(group, context)}`.
- `DisplayMenu` gains `settingsScope: SettingsScope` and `hiddenGroupFields?: readonly GroupBy[]`:
  save and reset call `saveViewSettingsAction({ ...settingsScope, display })` /
  `resetViewSettingsAction(settingsScope)` instead of the hard-coded project scope;
  group and sub-group options drop the hidden fields.
- Project frame tabs, new pure module `src/components/work-items/project-tabs.ts`
  (tested in `tests/ui/project-tabs.test.ts`):
  ```ts
  export type ProjectTabKey = "work-items" | "cycles" | "modules" | "archives";
  export type ProjectTabDef = { key: ProjectTabKey; label: string; segment: string };
  export function projectTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled">): ProjectTabDef[];
  export function activeProjectTab(pathname: string, projectId: string, tabs: readonly ProjectTabDef[]): ProjectTabDef | null;
  ```
  Order: Work items, Cycles (when enabled), Modules (when enabled), Archives
  (always). `ProjectFrame` replaces the static `TABS` (no other importer) with
  `projectTabs(project)`, maps icons in the component (`KanbanIcon`, `CycleIcon`,
  `ModuleIcon`, `ArchiveIcon`), passes `value={active?.key ?? ""}` (a route of a
  disabled feature selects no tab), and renders E3's `<ProjectMenu project />` at the
  end of the header row. Since the layout rework merge the header row is the
  project's `PanelHeader` (one 52px `PanelBar`: project token, name, a hairline, the
  tabs; `ProjectMenu` at its end), and `<ProjectArchivedBanner project />` sits under
  the `PanelHeader` in the `Layout` header slot (outside the scroller), not between
  the row and the tabs.
- Property controls and lane A's new refusals (an item may sit in an archived cycle
  or module, which the bundle leaves out). New pure module
  `src/components/work-items/properties/membership-rules.ts` (no directive, tested in
  `tests/ui/property-controls.test.ts`):
  ```ts
  export type CycleControlModel = {
    options: { value: string; label: string; description: string }[];
    readOnly: boolean;
    reason: "completed" | "archived" | null;
  };
  export function cycleControlModel(value: string | null, cycles: readonly Pick<Cycle, "id" | "name" | "status">[]): CycleControlModel;
  export function splitModuleValue(value: readonly string[], modules: readonly Pick<Module, "id">[]): { editable: string[]; kept: string[] };
  export function mergeModuleChange(next: readonly string[], kept: readonly string[]): string[];
  ```
  - `CycleControl.tsx`: options are the bundle cycles that are not completed, plus the
    current value. The control is read-only (`Selector isReadOnly`) when the value is
    a completed cycle (`reason: "completed"`, the engine answers `LOCKED`) or is
    missing from `bundle.cycles` (`reason: "archived"`, the engine answers
    `ARCHIVED`); a missing value gets the synthetic option `{ value, label: "Archived
    cycle", description: "Archived" }` so the selector shows it. Option descriptions
    keep the status label.
  - `ModuleControl.tsx`: ids not in `bundle.modules` (archived modules) are `kept`:
    the `MultiSelector` receives only `editable` as `value`, its `onChange` calls
    `onChange(mergeModuleChange(next, kept))` so `set_modules` never drops them, and a
    read-only `Token size="sm" color="gray"` next to it reads "1 archived module" /
    "N archived modules" (names are not in the bundle).
  - Test cases: completed value read-only; archived (missing) value read-only with the
    synthetic option; open value editable and completed cycles left out of the options;
    `kept` ids survive adding and removing an editable module; no kept ids → the value
    passes through unchanged.
- Sidebar (`src/components/shell/Sidebar.tsx`): since the layout rework merge the
  projects are flat rows with no children (P3's `projectNavItems` is gone); a
  project's Work items, Cycles, Modules and Archives are the tabs of its panel header
  (above), which follow the feature toggles. "Projects" is also selected on
  `/projects/archives` and below it (`isProjectsPage`). `projectIdFromPath` is one
  export of `src/components/shell/recents.ts` (it was in `tab-registry.ts` until the
  merge) with the guard `/^\/projects\/(?!archives(?:[/?#]|$))([^/?#]+)/`;
  `Sidebar.tsx` (the current project's row), `useShortcuts.ts` and `CommandBar.tsx`
  (the palette's project scope, which on `/projects/archives` would send
  `scope=archives` to `/api/search` and fail its `IdSchema`) import it and keep no
  local copies. `tests/ui/recents.test.ts` covers `/projects/archives` and
  `/projects/archives/` → `null`, `/projects/<id>/archives/cycles` → `<id>`,
  `/projects/<id>` → `<id>`.
- `src/components/work-items/properties/date-format.ts` (new, no directive):
  `formatShortDate` moves here unchanged from `DateControl.tsx`, which imports it and
  re-exports it so current importers keep working. `cycle-format.ts` and
  `module-format.ts` (E1, E2) import it from here (mismatch 27).
- Recents (`src/components/shell/recents.ts`, which replaced `tab-registry.ts` and
  `TabBar.tsx` in the layout rework merge): `RouteIconKey` adds `"cycles" | "cycle" |
  "modules" | "module" | "archives"`; `RouteLookup` adds `entityLabel?: (id: string)
  => string | undefined`; `resolveRoute` adds the cases under "Routes and data
  loading" (`/projects/archives` checked before the project lookup);
  `isTransientPath` also matches `/cycles/`, `/modules/`, the project index and the
  archives index. `shell-icons.ts`: `ROUTE_ICONS` maps `cycles` and `cycle` to
  `CycleIcon`, `modules` and `module` to `ModuleIcon`, `archives` to `ArchiveIcon`;
  `recents-store.ts` passes `entityLabel: (id) => entityLabels.get(id)` (the store
  `registerEntityLabel` fills).
- Power K:
  - `shortcuts.ts`: remove `arrives` from `create.cycle`, `create.module`,
    `nav.cycles`, `nav.modules`, `nav.archives`; `create.view` and `nav.views` →
    `arrives: "P4"`; `ShortcutArrival` = `"P4" | "P5" | "P6" | "P7" | "P8" | "P9"`.
  - `useShortcuts.runShortcut`: `create.cycle` → `/projects/<p>/cycles?create=1`,
    `create.module` → `/projects/<p>/modules?create=1`, `nav.cycles` →
    `/projects/<p>/cycles`, `nav.modules` → `/projects/<p>/modules` (each with
    `currentOrLastProjectId()`, else Toast "Open a project first"); `nav.archives` →
    `/projects/<p>/archives` inside a project, else `/projects/archives`.
  - `CommandBar.openHit`: `cycle` → `/projects/${hit.project_id}/cycles/${hit.id}`,
    `module` → `/projects/${hit.project_id}/modules/${hit.id}` (no-op without
    `project_id`); `work_item` opens the peek when
    `mountsPeek(window.location.pathname, hit.project_id)` and a `PeekHost` of that
    project is mounted (`peek-url.workItemHitTarget`, `peek-hosts.hasPeekHost`), else
    the full page.
  - `src/components/detail/peek-url.ts` (additive): `mountsPeek(pathname, projectId)`
    is true for `/projects/<projectId>/work-items`, `/projects/<projectId>/cycles/<id>`,
    `/projects/<projectId>/modules/<id>` and `/projects/<projectId>/archives/work-items`
    (trailing slash ignored).
- Editor links: `src/components/editor/links.ts` `entityRoute` returns
  `/cycles/<encoded ref>` for `cycle` and `/modules/<encoded ref>` for `module`
  (`page` stays `null` until P6). `DescriptionEditor.openEntity` pushes that route
  for cycles and modules instead of the "Arrives in P3" Toast. The alias pages
  `(tessera)/cycles/[cycleId]/page.tsx` and `(tessera)/modules/[moduleId]/page.tsx`
  follow `/browse/[key]`: `IdSchema` check → `getCycle` / `getModule` in a `try`
  (`NOT_FOUND` / `VALIDATION` → `notFound()`) → `redirect` to
  `/projects/<project_id>/cycles/<id>` (or modules) outside the `try`.
- `src/components/detail/activity-text.ts`: `FIELD_LABELS` gains `module: "module"`
  for item rows written before lane A's rename.

### Lane split and file ownership

All five lanes start at once from `main`. Merge order: A, E1, E4, E2, E3, so the
shared planning pieces (E1) and the scoped list (E4) are on `main` before the lanes
that use them. Until a dependency merges, a lane codes against the signatures in
this section; a stub lives at the owner's exact path with the exact exported names,
starts with the line `// STUB(P3): replaced by lane <X>`, and loses to the owner's
file in the merge (add/add conflict resolved by taking the owner's version; between
two stubs, keep the one already on `main`). Gate: `grep -rn "STUB(P3)" src` is empty
after the last merge. UI lanes never stub `src/lib/tessera/**`: they rebase onto A
before using its new fields. Lanes B, C and D are idle in P3, so E3 and E4 may change
(not only extend) the files in their middle column, keeping every behaviour this
section does not change; the hand-off names each file.

As built (prep, 2026-10-11): the lanes run at the same time in one shared checkout,
not on branches, as in P2b. "Merge order" is the order in which the integrator
resolves leftover stubs. A lane writes a stub only while the owner's file does not
exist yet, never overwrites a file it does not own, and checks again before its
hand-off (a stub whose owner has landed is deleted and the import kept). An owner
that finds a file starting with the `STUB(P3)` line replaces it. `package.json`, the
lockfile, `icons.tsx` and `globals.css` are already done (prep) and no lane edits
them; `planning.css`, `modules.css` and `archives.css` exist with a header comment
only, and each lane fills its own.

| Lane | Creates | May edit additively (name it in the hand-off) | Must not touch |
|---|---|---|---|
| A engine | `scripts/mcp-call.ts` | `src/lib/tessera/{schemas,types,cycles,modules,work-items}.ts`, `src/lib/tessera/tools/registry/` (five descriptions), `tests/{cycles,modules,work-items}.test.ts`, `docs/contracts/{service-api,tools}.md` (corrections only), `docs/PLAN.md` (§5, §6, §9, §11 step 2, §13; item 10) | `src/app/**`, `src/components/**`, migrations |
| E1 cycles and charts | `src/app/(tessera)/projects/[projectId]/cycles/**`, `src/components/planning/{types,panel-prefs,burndown,cycle-format,chart-colors}.ts`, `src/components/planning/{ProgressPanel,BreakdownTabs,AddExistingItemsDialog,FeatureOffState,CyclesScreen,CycleRow,CycleMenu,ActiveCycleSummary,CycleDialog,CycleDetailScreen,CycleHeader,CycleSidePanel,TransferDialog,BurndownChart}.tsx`, `src/components/styles/planning.css`, `src/app/actions/cycles.ts`, `tests/ui/{burndown,cycle-format}.test.ts` | `tests/themes/catppuccin-contrast.test.ts` (one case) | `src/components/{work-items,shell,detail,editor}/**`, other routes, `palette.ts`, `catppuccinTheme.ts` |
| E2 modules | `src/app/(tessera)/projects/[projectId]/modules/**`, `src/components/planning/{ModulesScreen,ModuleRow,ModuleMenu,ModuleDialog,ModuleDetailScreen,ModuleHeader,ModuleSidePanel,ModuleLinks,LeadControl}.tsx`, `src/components/planning/module-format.ts`, `src/components/styles/modules.css`, `src/app/actions/modules.ts`, `tests/ui/module-format.test.ts` | none | E1's planning files (stub them), `src/components/{work-items,shell,detail}/**` |
| E3 archives | `src/app/(tessera)/projects/[projectId]/archives/**`, `src/app/(tessera)/projects/archives/page.tsx`, `src/components/planning/{ArchivesTabs,ArchivedWorkItems,ArchivedCycles,ArchivedModules,ArchivedProjects,ProjectArchive,DeleteProjectDialog}.tsx`, `src/components/planning/archive-rules.ts`, `src/components/styles/archives.css`, `tests/ui/archive-rules.test.ts` | `src/app/actions/work-items.ts` (`unarchiveWorkItemAction`), `src/app/actions/projects.ts` (three wrappers), `src/components/detail/{DetailHeader,WorkItemDetail}.tsx` (archive and restore), `src/app/(tessera)/projects/page.tsx` (link) | `ProjectFrame.tsx`, `src/components/shell/**`, `src/components/work-items/**` except the files named |
| E4 integration | `src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx`, `src/components/work-items/{project-tabs,quick-add}.ts`, `src/components/work-items/properties/{membership-rules,date-format}.ts`, `src/app/(tessera)/cycles/[cycleId]/page.tsx`, `src/app/(tessera)/modules/[moduleId]/page.tsx`, `tests/ui/{project-tabs,quick-add,property-controls}.test.ts` | `projects/[projectId]/work-items/page.tsx`, `src/components/work-items/{WorkItemsScreen,DisplayMenu,ListLayout,BoardLayout,ProjectFrame,types}.ts(x)`, `properties/{CycleControl,ModuleControl,DateControl}.tsx`, `src/components/shell/{Sidebar,recents,recents-store,shell-icons,shortcuts,useShortcuts,CommandBar}.ts(x)` (P3 edited `tab-registry.ts` and `TabBar.tsx`, which the layout rework merge replaced with the three recents files), `src/components/detail/{peek-url,activity-text,DescriptionEditor}.ts(x)`, `src/components/editor/links.ts`, `tests/ui/{recents,shortcuts,peek-url}.test.ts` (`tab-registry.test.ts` before the merge), `tests/editor/links.test.ts` | `src/components/planning/**` (renders `ProjectMenu` and `ProjectArchivedBanner` through stubs), `src/lib/tessera/**` |

Stubs expected: E2 and E3 stub E1's `planning/types.ts`, `ProgressPanel`,
`AddExistingItemsDialog`, `FeatureOffState` and `cycle-format.ts` as they need them;
E3 stubs E2's `module-format.ts`; E1, E2 and E3 stub E4's `scoped-list.tsx`
(`ScopedWorkItems` and `ListSkeleton` render a plain "Work items arrive with E4"
text, `loadPeek` returns `{ id, data: null }`); E1 and E2 stub E4's
`properties/date-format.ts` (the `formatShortDate` body copied from `DateControl.tsx`,
so the stub pulls no client file); E4 stubs E3's `ProjectArchive.tsx` (both
components return `null`). There is no `src/components/planning/index.ts` barrel:
files are imported directly, so no lane writes a file another lane owns. Lane A's
`scripts/mcp-call.ts` and docs/PLAN.md edits touch no UI file.

### Acceptance (P3)

As run on 2026-10-11. Ports and databases changed with decision 140: port 3000 is now
the user's live app (never stopped or restarted by a run), `npm run dev` serves port
3001 with `data/dev/tessera.db`, and a later acceptance run uses a port of its own and
a database in a folder of its own (`data/<run>/`), never `data/tessera.db`.

The run uses its own database, so the user's `data/tessera.db` is never written.
The gate's `next build` needs the dev server stopped anyway (it shares `.next` with
`next dev`, and a second `next dev` in this folder exits on the lock `.next/dev/lock`,
`setup-dev-bundler.js`, `Lockfile.acquireWithRetriesOrExit`). So the verifier, after
the build:

- stops the dev server, runs `rm -rf .next/dev` (a stale Turbopack dev cache after a
  build causes an HMR reload loop), and restarts it with
  `TESSERA_DB_PATH=<repo>/data/p3-acceptance.db` in the environment (a new file;
  `.env.local` does not exist, and an exported variable wins over it anyway);
- loads `http://127.0.0.1:3000/home` once, so the server creates and migrates the
  file (the stdio MCP server refuses pending migrations), then exports the same
  `TESSERA_DB_PATH` in the shell that runs `scripts/mcp-call.ts`, whose stderr line
  names the database (the report records it);
- at the end stops the server, runs `rm -rf .next/dev` and restarts it without the
  variable (default `data/tessera.db`), and leaves `data/p3-acceptance.db` in place
  (`data/` is git-ignored).

The steps still use projects with identifiers of their own, `P3A` ("P3 Acceptance")
and `P3T` ("P3 Throwaway"). Browser: the in-app browser, or a Chrome DevTools
session at `http://127.0.0.1:3000` when the pane does not open (as in P2b).

Before step 1:

- "MCP" below means `npx tsx scripts/mcp-call.ts <tool> '<json>'`; ids come from the
  browser URL (`/projects/<projectId>/cycles/<cycleId>`) or from
  `get_work_item_by_key '{"key":"P3A-3"}'`.

Steps in order:

1. `/projects` → New project "P3 Acceptance" (`P3A`) → the project's panel header
   shows the tabs Work items, Cycles, Modules, Archives, and the sidebar lists P3
   Acceptance as one flat row with no children. MCP `list_projects` lists P3
   Acceptance, which proves the client and the server share one database (if not,
   stop: the server runs on another `TESSERA_DB_PATH`). MCP `update_project_features '{"project_id":"<id>","cycles_enabled":false}'`
   → within 5 s the Cycles tab of the panel header and the Archives › Cycles tab
   disappear; `/projects/<id>/cycles`, `/projects/<id>/cycles/00000000-0000-4000-8000-000000000000`
   and `/projects/<id>/archives/cycles` show "Cycles are turned off for this
   project". MCP `update_project_features` with `cycles_enabled: true` → all three
   come back.
2. Work items → create `P3A-1` "Existing task". `g c` → Cycles shows "No cycles yet".
   New cycle "Sprint 1" with dates today − 7 … today + 7 → listed under Current and
   the summary card shows Sprint 1 with "7 days left". New cycle again → the Dates
   picker shows the days of Sprint 1 disabled; Cancel.
3. Open Sprint 1 → quick-add "Alpha" (`P3A-2`) and "Beta" (`P3A-3`) → both show
   Sprint 1 in the cycle property. Display → group by State → the Done and Cancelled
   groups have no quick-add row, Backlog and Todo do; set grouping back. "Add
   existing" → filter "Existing" → add `P3A-1` → three items; the panel shows 0 of 3.
   The Recent entry for the cycle reads "P3 Acceptance · Sprint 1" with the cycle
   icon, on Home or in Power K's "Recent" group (open `mod+k` from another page: the
   group leaves out the page on screen).
4. Open `P3A-2` in the peek (the progress panel hides), set it to Done, close the
   peek → the panel shows 1 of 3; the burndown has a dashed ideal line, an actual
   line ending today, a "Today" marker and the sentence under it names pending and
   ideal values in work items; the axes and labels read in both colour schemes; open
   "Data table" → one row per day. Switch to Burnup → a dotted "Scope" line at 3 and
   actual 1 today; reload → Burnup is kept. The Unit switch is absent (no estimate).
5. Edit Sprint 1 → end date yesterday → the header says Completed, quick-add and
   "Add existing" are gone, the read-only line shows; a `P3A-1` peek shows the cycle
   control read-only. MCP `update_work_item '{"work_item_id":"<P3A-3 id>","priority":"high"}'`
   → the open cycle page shows High within 5 s.
6. Cycles → New cycle "Sprint 2" with dates today … today + 13 → the summary card
   now shows Sprint 2; Sprint 1 sits under Completed with a "2 open" badge and its
   menu shows Archive enabled and Delete disabled ("Archive it first").
7. Sprint 1 menu → "Transfer open items…" (targets: Sprint 2 and "No cycle") → Sprint
   2 → Toast "Moved 2 work items to Sprint 2" → Sprint 2 lists `P3A-1` and `P3A-3`;
   Sprint 1 still shows 1 of 3 in the row and in its panel, the panel says the
   progress is frozen, its chart is unchanged and the Transfer item is gone. MCP
   `get_cycle '{"cycle_id":"<Sprint 1 id>"}'` returns `open_count: 0` and a non-null
   `progress_snapshot`.
8. Sprint 1 menu → Archive → it leaves the list. Work items → open `P3A-2` (still in
   Sprint 1) in the peek → its cycle control reads "Archived cycle" and is read-only.
   Archives tab → Cycles lists Sprint 1; open it → "This cycle is archived" Banner →
   Restore → it is back under Completed. Sprint 2's menu shows Archive disabled with
   "Cycles can be archived after their end date".
9. `g m` → New module "Launch" (status Planned by default, lead and member = the
   human actor, start today, target today + 30) → the row shows the status, lead,
   member and dates. New module "Launch" again → the Name field says "A module with
   this name exists"; Cancel. Open Launch → Add link `https://example.com` "Spec" →
   listed with the external-link icon, opens in a new tab; "Add existing" → `P3A-1`;
   quick-add "Gamma" (`P3A-4`) → two items; the panel shows 0 of 2 with the
   Assignees, Labels and States tabs (arrow keys move between them).
10. Launch menu → Archive is disabled ("Set the status to Completed or Cancelled
    first"); set status Completed → Archive → Archives › Modules lists Launch. Open
    `P3A-1` in the peek → the Modules control shows "1 archived module" and no Launch
    option; MCP `get_work_item_by_key '{"key":"P3A-1"}'` still lists Launch's id in
    `module_ids`. Open Launch from Archives › Modules → the archived Banner, read-only
    controls, no "Add link", no quick-add → Restore → back in Modules.
11. Work items → open `P3A-2` (Done) → More actions → Archive → "This work item is archived"
    Banner; the list no longer shows it. Archives › Work items lists `P3A-2` → open
    it (peek with the Banner) → Restore → it is back in Work items. On `P3A-1` (open)
    the Archive item is disabled with its reason. Archive `P3A-2` again → Archives ›
    Work items → its menu → Delete… → confirm → Toast "Deleted P3A-2" and Archives ›
    Work items shows "No archived work items".
12. Project actions (the "…" at the end of the project's panel header) → Archive project → confirm → `/projects/archives`
    lists P3 Acceptance and the sidebar no longer shows it; open it → the archived
    Banner; Restore → the sidebar shows it again. Create project "P3 Throwaway"
    (`P3T`), Delete project… → the button enables only after typing `P3T` → it
    disappears everywhere.
13. Power K inside P3 Acceptance: `g c` → Cycles; `n c` → the New cycle dialog
    (Cancel); `mod+k` "Sprint 2" → Enter opens its detail; `g r` → Archives; `g m` →
    Modules. On `/projects/archives`: `mod+k` "Existing task" finds `P3A-1` (the
    palette is not scoped to a project called "archives") and `n i` opens the create
    dialog of the last project (P3 Acceptance), never `/projects/archives/work-items`. The help
    dialog (`mod+/`) shows no "Arrives in P3" hint; Views say "Arrives in P4".
14. Copy Sprint 2's id from the URL; open `P3A-1`, switch its description to source,
    add `[Sprint 2](cycle:<id>)`, switch back → a chip; click it → `/cycles/<id>`
    redirects to the cycle, and the recents (Home, or Power K's "Recent" group opened
    from another page) hold one entry for it, "P3 Acceptance · Sprint 2", and none
    for `/cycles/<id>` (the alias is transient).
15. Sibling navigations, by clicking only (no typed URLs, no reloads): Work items tab
    → Cycles tab → Sprint 2 row → Archives tab → Cycles (archives) → Modules
    (archives) → Modules tab of the panel header → Launch row → Work items tab. Each screen
    renders, and no Next dev overlay, error or instant-navigation insight appears.
16. The dev console shows no errors and no hydration warnings on any screen visited
    in steps 1–15 (only the two known dev-only entries under "Carried items" are
    allowed).
17. Clean-up: P3 Acceptance → Project actions → Delete project… → type `P3A` → it
    leaves the sidebar, `/projects` and `/projects/archives`; MCP `list_projects` and
    `list_projects '{"archived":true}'` hold neither `P3A` nor `P3T`. The deleted
    rows and their activity stay in `data/p3-acceptance.db` as soft-deleted history.

Gate: `npm run check` green (typecheck, lint, Vitest including the new
`tests/ui/{burndown,cycle-format,module-format,archive-rules,project-tabs,quick-add,property-controls}.test.ts`
and the updated engine and UI tests, conventions, licences, theme), `next build`
green, `grep -rn "STUB(P3)" src` empty, and docs/PLAN.md §9's P3 exit criteria met
(cycle rules Vitest, transfer keeps the snapshot, restore works in the browser:
steps 7, 8, 10 and 11).

### API verification and mismatches found while writing this section

| # | Source says | Installed code or package says | P3 resolution |
|---|---|---|---|
| 1 | docs/PLAN.md §11 step 2: "Recharts and Playwright are added at P9 and P11"; §9 names Recharts only in the P9 row | The burndown needs a chart in P3; `recharts` is not installed | E1 installs `recharts@3.10.1`; P9 reuses it; lane A corrects §9 and §11 (lane A item 10) |
| 2 | `palette.ts` comment "Categorical chart hues (P9 charts)" | `DATA_TOKENS` are already wired in `catppuccinTheme.ts` | No palette change; lane B updates the comment on its next pass (others may not edit `palette.ts`) |
| 3 | `shortcuts.ts` `create.view` / `nav.views` `arrives: "P3"` | Views are P4 (docs/PLAN.md §9) | E4 sets `"P4"` |
| 4 | `shortcuts.ts` `nav.archives` `arrives: "P9"` | Archives ship in P3 | E4 removes `arrives` and wires `g r` |
| 5 | docs/PLAN.md §6: project Archives in the sidebar's `…` menu, a workspace "Archives" entry | No project `…` menu exists; frame tabs are the project navigation | Archives is a permanent frame tab plus `g r` and a link on `/projects`; the sidebar entries wait for the P9 sidebar pass; lane A records the deviation in PLAN §6 and §13 and the alias routes in §5 (item 10) |
| 6 | House dialogs need a footer | Astryx has no `DialogFooter` (`dist/Dialog/`) | `Layout` header / content / footer (`CreateProjectDialog.tsx`) |
| 7 | Row menus inside clickable rows risk nested controls (the handbook tabs bug fixed in `2c96000`) | `ListItem` `href` / `onClick` render an invisible anchor or button beside the content (`dist/List/ListItem.d.ts`), and `label` is a ReactNode | Rows use `href` with menus in `endContent`; checkbox rows use `interactiveRef` |
| 8 | `get_cycle_progress` description promises "the ideal line"; `get_module_progress` "the completion percentage" | Neither is returned | Lane A rewrites the descriptions (tools.md) |
| 9 | Public product docs show a new module starting in Backlog | Decision 5 and `createModule` default to `planned` | Keep `planned` |
| 10 | Recharts declares `react-is` as a peer | The hoisted `react-is` is 16.13.1 (via `prop-types`); React 19 elements need `react-is` 19 to be recognised | E1 adds `react-is@19.3.0` as an exact direct dependency |
| 11 | P2b tests pin the pre-P3 behaviour | `tests/ui/shortcuts.test.ts` 441–446 ("Arrives in P3"), `tests/ui/tab-registry.test.ts` 77–79 (cycles icon `"page"`), `tests/editor/links.test.ts` 76–78 (cycle and module routes `null`) | E4 updates them. Since the layout rework merge the route cases live in `tests/ui/recents.test.ts` (`/projects/<id>/cycles` has the `"cycles"` icon; the generic section case uses `/settings`) |
| 12 | `/projects/archives` is a static route | Three copies of `projectIdFromPath` match `archives` as a project id: `Sidebar.tsx` 49, `useShortcuts.ts` 115 and `CommandBar.tsx` 104 (the palette scope at 147, which would send `scope=archives` to `/api/search`) | One guarded export, `recents.projectIdFromPath` (in `tab-registry.ts` until the layout rework merge), imported by all three (E4); `tests/ui/recents.test.ts` covers `/projects/archives` → `null` |
| 13 | Astryx `Timestamp` formats dates | A `YYYY-MM-DD` string parses as UTC midnight, a day early west of UTC and a hydration risk | `formatShortDate` for dates, `RelativeTime` for timestamps |
| 14 | This contract names Recharts props | Not verifiable before install | E1 checks `responsive`, `accessibilityLayer`, `Line` (`connectNulls`, `strokeDasharray`, `isAnimationActive`, `dot`), `ReferenceLine` (`x`, `y`, `label` as an object with `value`, `fill`, `position`), `XAxis` / `YAxis` (`allowDecimals`, `tick`, `stroke`; the `CartesianAxis` default stroke `#666` they override), `CartesianGrid vertical`, `Tooltip` (`contentStyle`, `labelStyle`, `itemStyle`, `cursor`, `isAnimationActive`) in `node_modules/recharts/types/` and records any deviation in its hand-off |
| 15 | `DateRangeInput` constraints could take ISO strings | `dateConstraints: ReadonlyArray<(date: Date) => boolean>` (`dist/DateRangeInput/DateRangeInput.d.ts`) | Convert with local date getters |
| 16 | `CycleProgressSchema` `points` and `completion_chart` are integers | Estimate values may be fractional; a fractional snapshot fails `safeParse` and progress silently goes live | Lane A item 1 |
| 17 | Module points follow the active estimate | Cycle points ignore `estimates_enabled` and the estimate id (`cycles.ts` `loadProgressItems`) | Lane A item 2 |
| 18 | The snapshot freezes "issues mode, points included" (schema.md "Cycles") | Points mode on a frozen cycle returns the items series under point totals | Lane A item 2 (both series frozen, `chart_mode`) |
| 19 | One activity field per membership kind | `modules.ts` writes `field: "module"`, `work-items.ts` writes `"modules"`; `activity-text.ts` labels only `modules` | Lane A item 6 plus E4's alias for stored rows |
| 20 | Decision 24: cycle and module membership log on both sides | `update_work_item.cycle_id` and `set_modules` log only the item side | Recorded; fixed with the P5 entity activity feed |
| 21 | Module tools refuse archived modules (`ARCHIVED`) | `syncModules` and `createWorkItem` let items join or leave an archived module | Lane A item 4 |
| 22 | Cycle progress counts archived items (schema.md) | The cycle-scoped list hides archived items | The panel caption says "Includes archived work items." |
| 23 | Feature toggles hide cycles and modules | The engine does not refuse cycle or module tools while a toggle is off; there is no settings UI before P4 | UI-only hiding in P3; enforcement decided with P4 settings |
| 24 | `.cursor/rules/astryx.mdc` describes Astryx | It still describes 0.6.0 | Not P3; refresh with the next Astryx upgrade |
| 25 | Acceptance could serve a fresh database on a second app server | Next 16.4 dev takes `<distDir>/lock` (`node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js` 175, `Lockfile.acquireWithRetriesOrExit`), so a second `next dev` here exits | Acceptance restarts the dev server after the build on its own database `data/p3-acceptance.db` (prep decision, 2026-10-11; the user's database is never written); MCP steps go through `scripts/mcp-call.ts` with the same `TESSERA_DB_PATH` (lane A item 9) |
| 26 | The project layout's `instant = false` covers the pages under it | `01-app/02-guides/instant-navigation.md` "Opting out": "Navigations between sibling segments below are still validated" | Each new page adds `instant = false` when the validator reports it; acceptance step 15 walks sibling navigations |
| 27 | Pure format helpers can import `formatShortDate` | It is exported from `DateControl.tsx`, a `"use client"` file: a Server Component would get a client reference, and Vitest would load Astryx client components | E4 moves it to `properties/date-format.ts` (no directive); `DateControl.tsx` re-exports it; E1 and E2 import the new path |
| 28 | `completion_chart_points` is snapshot-only | `toCycles` / `toCycleDetail` spread `CycleRow`, so `progress_snapshot` reaches `list_cycles`, `get_cycle` and the project bundle | Documented (lane A item 1, service-api.md); the UI's frozen flag is `progress_snapshot !== null` |
| 29 | Module date errors show on the date control | `DateControl` has no `status` prop; Astryx `DateInput` has `status?: InputStatus` (`dist/DateInput/DateInput.d.ts`, `dist/Field/types.d.ts`) | `ModuleDialog` uses two `DateInput`s directly |
| 30 | `ProgressBar variant="success"` meets the 3:1 graphics rule | `--color-success` is `pair("green")` (`palette.ts` 154), 2.96:1 on Latte base | Accepted trade-off: a text value accompanies every bar ("Icons, CSS and conventions") |
| 31 | A `Tab` with `panelId` works in any `TabList` | Without `role="tablist"` the strip is a `<nav>` and `dist/TabList/Tab.js` 208 warns in development that `panelId` does nothing | `BreakdownTabs` uses `role="tablist"`, tab ids and `role="tabpanel"` panels; `ArchivesTabs` and the frame tabs keep the navigation pattern without `panelId` |
| 32 | External links need a hand-added icon | Astryx `Link isExternalLink` adds the icon, `target="_blank"`, `rel` and the new-tab announcement (`dist/Link/Link.d.ts`) | `ModuleLinks` uses it |
| 33 | Quick-add works in every group | In a cycle scope a group pinned to a closed state sends `cycle_id` with that state, which `createWorkItem` refuses (`RULE work_item_closed`) | `quickAddAllowed` hides those quick-add rows (E4) |
| 34 | Property controls only need the bundle's cycles and modules | The bundle leaves out archived cycles and modules; after lane A, dropping an archived module through `set_modules` or leaving an archived cycle answers `ARCHIVED` | `membership-rules.ts` keeps archived module ids and makes an archived or completed cycle value read-only (E4) |
| 35 | The project layout wraps `/projects/archives` | It is a sibling static segment, so it has no `ProjectProvider` | `ArchivedProjects` takes its data as props and uses no `useProject()` |

Review fixes adopted with a change:

- Module date errors: shown on the Target date field as asked, but through Astryx
  `DateInput` rather than `DateControl`, which has no `status` prop (row 29).
- Acceptance MCP client: it spawns `npx tsx scripts/mcp-stdio.ts` (the form
  `.mcp.json` and `tests/mcp-stdio.test.ts` use) with no `--db` and no `--migrate`
  rather than `npm run mcp:stdio -- --db <path>`, so it opens exactly the database the
  server resolves for the same `TESSERA_DB_PATH` and never migrates it.

### As built (integration, 2026-10-11)

Notes from the P3 integration run; the hand-off is in docs/PLAN-STATUS.md "P3
(integration, 2026-10-11)".

- No page needed `instant = false`: the project layout keeps its P2a opt-out
  (row 26), and acceptance step 15 walked the sibling navigations with no Next
  overlay, error or instant-navigation insight.
- Recents (P3 built this for the tab bar; the layout rework merge moved it to
  recents): the project index `/projects/<id>` is transient like the alias routes
  (`recents.isTransientPath`), so it never becomes a recent. Deleting a cycle, a
  module or a project forgets its recent and every recent under it
  (`recents-store.forgetRecentsUnder` over the pure `recents.removeRecentsUnder`,
  called by `CycleMenu`, `ModuleMenu`, `ArchivedCycles`, `ArchivedModules` and
  `DeleteProjectDialog`; P3's `TabBar.forgetTabsUnder` and
  `tab-registry.dropTabsUnder` are gone). Recent labels of an archived project keep
  its name: the recents tracker reads active and archived projects.
- `CycleHeader`: a completed cycle reads "Completed cycles are read-only." and adds
  the transfer hint only while it has open items.
- `ModuleControl`: an item whose only module is archived shows "No active modules
  in this project" in the empty picker.
- Power K's search input carries an id (`useId`).

### As built (fix round 1, 2026-10-11)

- Power K opens a work item hit as a peek only when the route is a list of the
  item's project (`mountsPeek`) and a `PeekHost` of that project is mounted:
  `PeekHost` counts itself in `src/components/detail/peek-hosts.ts`
  (`registerPeekHost` in an effect, `hasPeekHost`), and `peek-url.workItemHitTarget`
  makes the choice. A cycle or module route that shows `FeatureOffState` or the
  not-found screen keeps its URL but mounts no host, so the hit opens the full page.
- Power K Enter: Astryx keeps a hover highlight when a new query narrows the list.
  `PaletteInput` clears the highlight when the query changes and when it points past
  the end of the list (so `aria-activedescendant` never names a missing option), and
  Enter treats a highlight outside the list as none (`command-source.liveHighlight`)
  and opens the first result.
- `TransferDialog` text comes from `cycle-format.transferText`; a cycle that already
  has a snapshot reads "Its progress was frozen earlier and stays as it was then."
- `ModuleHeader`'s panel toggle has no `aria-pressed` (its label already changes),
  matching the cycle toggle.

### As built (fix round 2, 2026-10-11)

- Modal dialogs and hidden routes: Cache Components keeps a route the user leaves
  mounted under React `<Activity mode="hidden">` (`display: none`). The Astryx
  `Dialog` (and `AlertDialog`) opens its native `<dialog>` with `showModal()` in an
  effect with no cleanup, so a dialog open at the moment of a navigation (a chip or
  the breadcrumb in the modal peek, Power K, a link clicked from code, a redirect)
  stayed in the top layer without a box and made the next page inert. Dialogs
  come from `@/components/shell/dialogs` (lint-enforced: `no-restricted-imports` in
  `eslint.config.mjs` rejects `Dialog` and `AlertDialog` from the Astryx entry
  points; `DialogHeader` is re-exported there). The wrapper reaches the element
  through Astryx's public `ref` and closes it in a `useLayoutEffect` cleanup, which
  React runs when Activity hides the route (Next, "Effect and media cleanup" in
  `01-app/02-guides/preserving-ui-state.md`). React state is untouched, so Back
  shows the route again and Astryx's effect reopens the dialog (`showModal()`), the
  modal peek included. Known limits: focus after Back goes to `<body>`; the
  BottomSheet presentation Astryx uses on touch screens is not covered. Tests:
  `tests/ui/dialog-teardown.test.ts` (with a raw-Astryx baseline) and the PeekHost
  case in `tests/ui/detail-smoke.test.ts`.
- Burndown and burnup: the "Today" label sits right of its marker in the first half
  of the cycle and left of it from the middle on (`burndown.todayLabelPosition`), so
  it is no longer clipped by the y-axis when today is the first day.
- Work items toolbar (`WorkItemsScreen`): the row wraps (`wrap="wrap"`), the filter
  keeps `min(16rem, 100%)` and the actions (Display, New work item) move to a line
  of their own at the end, wrapping themselves when the column is narrower still (a
  cycle or module detail beside its side panel, the list beside a side peek).
- The cycles and modules lists and the three archive lists end with
  `paddingBlockEnd={10}`, so the last row's menu scrolls clear of the bottom-end
  toasts and the Next dev indicator.

### As built (review fixes, 2026-10-11)

Fixes from the review before the P3 commit; the hand-off is in
docs/PLAN-STATUS.md "Review fixes, logic and tests".

- Open memberships, quick-add and board drops. Items neither join nor leave an
  archived module (`ARCHIVED`) or a completed (`LOCKED`) or archived (`ARCHIVED`)
  cycle. `quick-add.openMemberships(bundle)` builds `openModuleIds` and
  `openCycleIds` into `QuickAddContext`; `isOpenGroupValue` is false for a module or
  cycle group whose value is not open and true for every other field and the none
  group; `acceptsGroupMove` needs both the old and the new value open.
  `quickAddAllowed` hides the row of such a group in every scope (the E4 text above
  is corrected to match). `BoardLayout.acceptsDrop` refuses a drop into or out of
  such a column or swimlane: no placeholder shows, the card snaps back and no request
  goes out. "Move to" (`moveTargetsFrom`) leaves closed columns out, and a card in a
  closed column has no "Move to" entry. An empty closed column says why: "This module is
  archived, so work items cannot join it." or "This cycle is completed or archived,
  so work items cannot join it." The list layout takes no drops between groups, so
  it needed no change. The engine is unchanged: `filters.loadModules` still lists
  archived modules as groups.
- Cycle rows. `CycleRow` shows completed / (total − cancelled) through
  `module-format.moduleProgressValues`. These are the numbers of the progress panel,
  the summary card and the module rows. `CycleProgressSummary` (list_cycles) carries
  `cancelled` over the same rows as `total` (service-api.md "P3 additions (lane A)").
- Panel toggles while a peek is open. The side peek takes the panel's place, so the
  detail screens pass `isPanelBlocked={peekOpen}` to `CycleHeader` and
  `ModuleHeader`. The toggle is then disabled, keeps its "Show progress" or "Show
  details" label, and its tooltip reads "Close the work item to show progress" or
  "Close the work item to show details".
- Deleting a project. `DeleteProjectDialog` calls `useShortcuts.forgetLastProject`
  after the delete. It removes `tessera.lastProject.v1` when the key names the
  deleted project, so `g i`, `g c`, `g m`, `n c`, `n m` and `c` off-project say
  "Open a project first" instead of opening a not-found route. Archiving keeps the
  pointer: an archived project's routes still render, read-only under the Banner,
  and the layout rework merge kept that (see "As built (layout rework merge,
  2026-10-11)").
- Dialog names. Astryx `Dialog` takes its name from the `DialogHeader` title only
  when the `<dialog>` element attaches. A dialog whose form mounts only while
  `isOpen` is true therefore stayed unnamed. Each such dialog passes an `aria-label`
  equal to its visible title:
  - P3: `CycleDialog` ("New cycle" or "Edit <name>"), `TransferDialog`,
    `AddExistingItemsDialog` (its title), `ModuleDialog` ("New module" or "Edit
    module"), the `ModuleLinks` link dialog and `DeleteProjectDialog` ("Delete
    <name>?");
  - earlier screens: `CreateWorkItemDialog` ("New work item"; the cycle and module
    lists open it too), `CreateProjectDialog` ("New project") and the work item
    `LinksList` dialog ("Add link" or "Edit link").

  Tests: `tests/ui/planning-a11y.test.ts` and `tests/ui/dialog-names.test.ts`.
- Breakdown order. `cycles.breakdownRows` sorts by total descending, then by id.
  `tests/cycles.test.ts` pins the id tie-break: its tied labels reach the breakdown
  in the opposite order of their ids, so a sort by total alone fails the test.
- Not changed: a stray `to` attribute on app anchors. Astryx `LinkProvider` hands a
  custom link component `to={href}` (for React Router), and `next/link` passes
  unknown props on to the `<a>`. `src/app/providers.tsx` uses the documented
  `<LinkProvider component={Link}>` setup. Dropping `to` would need an adapter the
  Astryx docs do not describe, so it waits for a decision or an upstream fix.

### As built (layout rework merge, 2026-10-11)

The layout rework (`claude/app-visual-rework-250c6c`; the "Shell", "Theme" and
"Work items screen" sections above) was merged into `main` over P3. Its shell and
look stay as designed, and every P3 behaviour was ported onto them. Where the two
contradicted, the rework decided look and layout and P3 decided cycles, modules
and archives behaviour. The hand-off is in docs/PLAN-STATUS.md "Layout rework
merge (2026-10-11)". Port rules:

- No tab bar. `TabBar.tsx`, `tab-registry.ts` and `tests/ui/tab-registry.test.ts`
  are deleted. The tab-only gestures (`alt+w`, middle-click close, the tab context
  menu) are gone for good. What P3 gave the tabs now serves the recents (Home's
  "Recent" list and Power K's "Recent" group):
  - Labels and icons: `recents.resolveRoute` has P3's cases ("Routes and data
    loading": the cycle and module lists, their details with the registered name,
    "<project> · Archived work items / cycles / modules" (one label per
    archives tab; P3's single "<project> · Archives" repeated three times in
    Home's list), "Archived projects", the `/cycles/<id>` and
    `/modules/<id>` aliases). `RouteIconKey` adds `cycles`, `cycle`, `modules`,
    `module` and `archives`, drawn by `shell-icons.ROUTE_ICONS` (`CycleIcon`,
    `ModuleIcon`, `ArchiveIcon`). `recents-store` resolves cycle and module names
    through `entityLabel` from the `registerEntityLabel` store.
  - Path guard: `recents.projectIdFromPath` (`/^\/projects\/(?!archives(?:[/?#]|$))([^/?#]+)/`)
    never reads `/projects/archives` as a project, so the sidebar, `useShortcuts`
    and `CommandBar` (all three import it) never scope to "archives".
    `isTransientPath` keeps the aliases, the project index `/projects/<p>` and the
    archives index `/projects/<p>/archives` out of the list; `/projects/archives`
    is a page of its own and is recorded.
  - Forget on delete and archive: `recents-store.forgetRecentsUnder` (over the pure
    `recents.removeRecentsUnder`) drops a route and the routes under it. `CycleMenu`
    and `ArchivedCycles` call it after a cycle delete
    (`/projects/<p>/cycles/<id>`), `ModuleMenu` and `ArchivedModules` after a module
    delete, `DeleteProjectDialog` after a project delete and `ProjectMenu` after a
    project archive (`/projects/<id>`). A work item delete from the detail forgets
    both of its routes (the rework). An archived cycle, module or work item keeps
    its recents: its page still resolves, with the archived Banner.
  - Names: `(tessera)/layout.tsx` reads active and archived projects for
    `RecentsTracker`, so recents of an archived project keep its name.
  - Peeks: `PeekHost` records an item once its peek has loaded (the rework), so
    peeks on a cycle, a module and Archives › Work items become recents of the
    item's full page, like peeks on the work items list.
- Last project: P3's rule stands (P3 decides archives behaviour). Archiving a
  project keeps `tessera.lastProject.v1`, and `ProjectProvider` writes the pointer
  on every project route, archived or not, because an archived project's routes
  still render (read-only, with the Banner; the engine refuses writes with
  `ARCHIVED`). Only a delete clears it, through `forgetLastProject` in
  `DeleteProjectDialog`, when it names the deleted project. A draft of the merge
  that also cleared it on archive was dropped. Archiving does forget the project's
  recents (`forgetRecentsUnder`), since the project leaves the sidebar.
- Panel headers. P3's screens moved from their own header rows (20px inset) onto
  the rework's `PanelHeader` and `PanelBar` (16px inline padding), and their list
  rows line up with that 16px inset:
  - Project frame: one 52px `PanelBar` (project token, name, a hairline, the
    `projectTabs` tabs Work items, Cycles, Modules, Archives) with `ProjectMenu`
    ("Project actions") at its end; `ProjectArchivedBanner` sits under the
    `PanelHeader`, outside the scroller. The sidebar lists projects as flat rows;
    "Projects" is selected on `/projects/archives` too.
  - Cycles and Modules lists: a full-width `PanelPage` whose 44px sub-header holds
    the "Cycles" or "Modules" heading (`Heading level={4} accessibilityLevel={2}`;
    the frame's title is the `h1`) with the count `Badge`, and "New cycle" or "New
    module" at its end.
  - Cycle and module detail: a 44px sub-header (`PanelBar canWrap`) with the name,
    the status and, for cycles, the range and days left at its start, and "Add
    existing", the panel toggle and the menu at its end. The archived Banner and
    the completed cycle's read-only line sit in padded rows under it. The scoped
    work items list below brings its own sub-header ("Work items", the count, the
    layout switch, Display, "New work item" while `canCreate`) and filters row;
    the layout switch and the display menu save to the cycle or module settings
    scope (decision 23).
  - Archives: a `PanelHeader` "Archives" whose sub-header holds `ArchivesTabs`
    (Work items, Cycles, Modules); the lists scroll under it. The strip is pulled
    in by a tab's own 12px (`archives.css`), so the first tab's text sits on the
    16px inset like the titles above and below it.
  - `/projects/archives`: a reading `PanelPage` titled "Archived projects".
  - `/projects`: "Archived projects" (`ArchivedProjectsLink`) and "New project" at
    the end of the Projects panel header.
- Detail: `DetailHeader` keeps the rework's pinned bar (breadcrumbs, Copy link,
  "More actions", "Open as", Close). Its "More actions" menu reads Make a copy,
  Copy ID, then Restore (archived) or Archive (`isDisabled` with the reason while
  the state group is open), then Delete….
- Power K: cycle and module hits open their project route, and its "Recent" group
  leaves out the page on screen and its peek (the rework).
- The two Astryx `ContextMenu` dev warnings listed under "Carried items" (an
  unknown `moveTo` prop; invalid `start` and `cancel` props on a `div`) still appear
  after the merge. They come from the Astryx `Table` (`tableContextMenu`), so they
  show once the work items Table layout renders; they did not come from the tab
  bar. They stay the only tolerated console entries.
- Narrow panels (browser check at 375 and at 1100 with a side peek):
  - Project frame: the token and the name no longer shrink
    (`tessera-project-frame-token`, `tessera-project-frame-title`, the name capped
    at 40% of the row, `shell.css`); the four tabs scroll in the room left. On a
    phone the token had lost its label and the name read "P3 A…".
  - Side panels: the side peek (`tessera-peek-panel`, `detail.css`) and the cycle
    and module side panels (`tessera-planning-side-panel`, `planning.css`) are
    capped at `max-width: 100%`. On a phone the peek's stored width (360–720px)
    pushed More actions, Open as and Close off the screen, and the 360px planning
    panels overflowed by 3px.
  - List rows: the title's minimum share is 14rem (was 16rem), so in the 352px list
    beside a 480px peek at 1100px the title stays beside its key and only the
    properties wrap.
- Fix round 2's "Work items toolbar" note describes P3's own toolbar row. The
  rework's sub-header (`PanelBar canWrap`) and filters row replace it: the actions
  drop under the title when both do not fit, and the filter field takes its own
  row.

## Visual alignment rules by area (audit round, 2026-10-22)

One audit measured nine areas at 1440 and 375px in both schemes against `docs/drafts/plane-visual-reference.md` and turned 161 findings into 130 fix items (`docs/drafts/visual-audit-items.json`). This section records the values and rules the fixes settled for the areas that have no section of their own above. The shared rules (touch targets as hit areas, tab strips, the fallback layer, the Latte icon trade-off) are under Theme and Shell; the layouts, the detail and the palette are in their own sections. Where this section and an older paragraph differ, this section is the newer one.

### Planning (cycles, modules, intake, views, projects)

- Active cycles: the content gutter is 16px (`VStack padding={4}`), not 24px.
- Cycle and module rows on a phone: at 480px and narrower the cycle row's 96px progress bar (`tessera-planning-cycle-bar`) is hidden and the count carries the value, and the end group keeps a 12px gap from the text. The module row keeps its bar there, shrunk to 48px (`--spacing-12`), because the group fits beside the menu; record the difference. The module row has fixed lead and members slots (24px and 96px) at wide widths, so the avatars start at the same x row under row; at 480px and narrower the slots shrink to their content (an empty one takes nothing) and the wrapped line starts on the name's inset.
- Side-panel lists (state groups, breakdown rows, module links) are pulled out by 8px with `tessera-planning-panel-list`, so the dots and the text sit on the 16px inset; the breakdown tab strip is pulled in by 12px (`tessera-planning-breakdown-tabs`).
- Touch (decision 14): the calendar button and the sm selector triggers in the side panels and headers get their 44px hit area from the theme and `shell.css`, with no size change. A link that stands alone in a card or header (`tessera-planning-link`: Open cycle, the project name) is a 44px box with an equal negative block margin. ListItem rows in the planning, views, intake, drafts and projects lists opt into `tessera-row-hit` (`planning.css`): under `(pointer: coarse), (max-width: 480px)` the row's label link or button gets a `::before` that reaches the row's padding (8px balanced, 4px compact), block axis only, no size change.
- Dialog touch rules: the module dialog's property rows (`tessera-modules-props--dialog`) are 44px under touch, so the neighbouring hit areas tile (the side panel keeps its denser rows). A scrolling dialog form (`tessera-dialog-form`: the cycle, view and project dialogs) keeps 8px of padding below its last field, or its `overflow: auto` clips the last field's hit area. The cycle dialog's date-range trigger takes a 44px box and gives the height back with a negative margin, so the field stays 32px.
- Intake below 1024px has the same split as the inbox: the list fills the panel, and with an item selected the item replaces the list, with a "Back to intake" button above it. The item's action row wraps instead of running off the right edge.
- Workspace views: the saved list shares the project views list structure and the reorder wiring (`views/use-view-reorder.ts`): optimistic manual order (decision 13), pointer drag (decision 105) and the menu's Move up / Move down as the keyboard path. The project rows' identifier token (`tessera-project-row-token`) has a 64px minimum width, so every title starts at the same x.

### Settings and workspace settings

- Touch (decision 14): settings and dialog fields (text inputs, selectors, switch labels, dialog item rows) are visible 44px boxes under `(pointer: coarse), (max-width: 480px)`, through `.tessera-settings-body` (the project settings column) and `.tessera-settings-fields` (the workspace screens and dialogs) in `project-settings.css`; the profile's link rows are 44px through `.tessera-profile-list` in `profile.css`. The 1440 field height (32px) is unchanged.
- The project settings' seven tabs (`SettingsTabs.tsx`) never scroll from 600px: 600 to 1023px takes an 8px tab padding and runs the strip to the panel edge (`tessera-settings-tabs--project`, `project-settings.css`); below 600px the strip is hidden and a `SectionMenu` named "Project settings" in the same 44px sub-header lists the tabs (see "Project routes"). The workspace settings strip keeps its own phone rule.
- All Switches in project and workspace settings, dialogs and Backups use Astryx size `sm` (32x20).
- Row titles are 14/20/500 (`SettingsTitle`) and helper lines are supporting 12/20 (`SettingsHelp`), both in `project-settings/SettingsRow.tsx`.
- The workspace settings screens share the project settings column (`paddingInline` 4 plus the `tessera-settings-body` block padding): fields run x=381, w=928 at 1440.
- The profile header is the two-row `tabsBelow` pattern: avatar, name and tokens in one group (`tessera-profile-title`), no "You" token on the user's own profile, and a scrollable tab strip at 375.
- Phone tab strips: on the profile and workspace settings (480px and narrower) the five tabs fit. The profile's tab padding is 6px (`calc(var(--spacing-1) * 1.5)`), the workspace settings' is 8px (`--spacing-2`), and the strip runs to the panel edge with the first tab's text still on the 16px inset. They scroll again below about 360px.
- Workspace settings tables (backups, exports, webhook deliveries): the long text column keeps a flexible floor (File 216, Name 136, Event 152px) and every other column is a fixed pixel width (`workspace-settings/table-widths.ts`); when the floors no longer fit, the table's own scroll region takes over. The exports and delivery tables fold their secondary columns into a second line of the first cell when the measured container is narrower than their full floors (`use-narrow-container.ts`, 584px and 688px).
- Status in the exports and delivery tables is a dot with its word (`StatusLabel`), never a dot alone.
- A Dialog a screen mounts only while open gives focus back, when it unmounts, to the last focused element outside any dialog or menu (`shell/dialogs.tsx`): the menu's button, not `<body>`.

### Pages and the editor

- Body headings in the editor follow the theme's scale below the page title: h1 24/32, h2 20/28, h3 17/24, all semibold; the page title is display 3 (29px on a 40px line). The first block has no top margin.
- The block drag handle is a 20px box inside the editor's start padding (`--spacing-8`), centred on the block's first line (a heading adds the `tessera-editor-drag--h1/h2/h3` offset). Under touch and on a phone the handle is hidden and the start padding drops to 16px.
- A compact read-only editor (a comment, a locked peek description) has no 120px minimum and no toolbar row in rich mode; the 120px minimum stays on the editable composer.
- The Locked state is a 24px pill (`tessera-lock-pill`) with a 20% accent tint and primary text. `/wiki` and the project Pages tab are one `PanelPage` width (`"full"`).
- Touch (decision 14): page tree rows are 44px, the expand chevron has a 44px hit area with the grip shifted after it so the two boxes do not overlap, and task-checkbox labels are 44px (a 16px box and a 24px label at desktop).
- The slash menu rows carry a 16px icon; a block's hint (Table) is the row's title tooltip, not a description line, so every row has one height (`tests/editor/slash-rows.test.ts`).

### Workspace (inbox, stickies, home, analytics)

- Inbox: below 1024px the list and the detail are one pane at a time ("Back to notifications"), the first tab is "All", and the unread dot keeps its slot on every row, so the time has one x.
- Stickies: cards are content height with a 540px cap and a scrolling body; the grid column minimum is 256px (`STICKY_COLUMN_MIN`).
- Home: quick links are 240 x 56 card rows (32px icon tile, a supporting line, a hover-revealed menu); the Recent heading sits above its filter; the recents rows are 44px under a coarse pointer or at 480px and narrower. The "Since you were last here" rows keep a one-line label on a desktop; at 480px and narrower the label (a `<Text>` with `tessera-home-since-label`) wraps to at most two lines (`home.css`).
- Analytics: the header is two rows below 1100px and three rows below 600px (title, then the range controls, then the tabs on their own 44px row); `COUNT_COLUMN` has a 100px minimum.


## Superagent control (decisions 143, 144 and 145)

The superagent is a runner on this Mac (separate repo `tessera-agents`) that takes requests from Tessera work items and answers with comments and pull requests. Tessera's side: idempotent comments (`client_ref`), per-project agent settings, `latest_seq` on the change feed, a control screen at `/agents/superagent` that drives the runner's local HTTP API, and "Send to superagent" on a work item. The runner and Tessera meet only at bring-up, so the control client follows the plan's "Runner API contract (v1)" exactly (mirrored below) and is tested with a stubbed `fetch`. Engine details: `tools.md` and `service-api.md` "Superagent", `schema.md` "Migration 0014".

### Control client (`src/lib/superagent/`, lane S)

Files and boundaries:
- `schemas.ts`: zod mirrors of the v1 shapes (below). Objects are plain `z.object` (unknown keys stripped, never `.strict()`), so an additive runner field does not break the screen; enums are exact.
- `types.ts`: client-safe. `import type` from `./schemas` only, plus `SUPERAGENT_ACTOR_NAME = "mcp:superagent"`, `RUNNER_FAILURE_STATES`, `REQUEST_SCOPES = ["open", "recent", "all"]`. Components import nothing else from `@/lib/superagent` (eslint pattern `^@/lib/superagent(?!/types$)` added to `componentPatterns`).
- `client.ts`: `createRunnerClient`. No file system, no `server-only`, so Vitest imports it.
- `token.ts`: `tokenFilePath(env = process.env)`, `readRunnerToken(path)`. Node `fs/promises`, `os`, `path`.
- `server.ts`: `import "server-only"`; `withRunner` and `loadSuperagent`. Reads `agents.runner_url` through `readTessera(getWorkspaceSettings)` (default `AGENT_RUNNER_DEFAULT_URL`) and the token per call.

Shapes (`schemas.ts`, names exact; every timestamp `z.string()`, money `z.number()`, counts `z.number().int().nonnegative()`):

```ts
STAGE_KINDS = ["needs_delivery","needs_question","needs_signoff","needs_hold","needs_review","needs_blocked","needs_failed","paused","queued","working","done","dropped","stopped"]
StageSchema = { kind: enum(STAGE_KINDS), label: string, reason: string | null }
RUNNER_ACTIONS = ["approve","retry","stop","resize","budget","lift_hold"];  RunnerActionSchema = enum(RUNNER_ACTIONS)
SIMPLE_ACTIONS = ["approve","retry","stop","lift_hold"];  SimpleActionSchema = enum(SIMPLE_ACTIONS)   // the no-body POSTs: requestAction's and superagentRequestAction's `action`
RequestSizeSchema = enum(["S","M","L"]);  DeliverableSchema = enum(["pr","answer","investigation"])
PullRequestSchema = { number: int, url: string, state: enum(["draft","open","merged","closed"]) }
RequestSummarySchema = { id, itemKey, workItemId, projectId, repo, title: string, size, deliverable, stage, models: string[], costUsd, budgetUsd, pr: PullRequestSchema | null, createdAt, updatedAt, actions: RunnerAction[] }
SessionSchema = { id, role, model, effort: string, costUsd, startedAt, endedAt: string | null, outcome: string | null }
EventSchema = { at, kind, text: string }
RequestDetailSchema = RequestSummarySchema.extend({ scope: string, question: string | null, planPageId: string | null, sessions: Session[], events: Event[] })
RunnerStateSchema = { health: { status: enum(["ok","degraded","setup_failed"]), checks: { name, ok: boolean, detail: string | null }[] }, paused: boolean, pauseReason: enum(["manual","daily_cap"]) | null, spend: { todayUsd, dailyCapUsd }, slots: { running, max }, counts: { needsYou, working, queued }, intake: { rewound: boolean, cursor: int, latestSeq: int } }
RunnerStatsSchema = { bySize: { size, completed, avgCostUsd }[], byModel: { model, sessions, costUsd }[], sizeChanged: { total, changed }, firstPassReviewRate: number | null, escalations: { cause: string, count }[] }
TriageRowSchema = { id, itemKey, status: enum(["queued","running","decided","unavailable"]), attempts, lastError: string | null, updatedAt }
RevisionSchema = string | number          // the v1 text gives no type; passed back unchanged as baseRevision
RunnerSettingsSchema = { budgetsUsd: { S, M, L }, dailyCapUsd, maxParallel: int, signoffM: boolean }
RunnerSettingsDocSchema = { settings: RunnerSettings, revision }
TeamSectionSchema = { repo: string, section: enum(["communication","scope","delivery"]), text: string }
RunnerPromptsDocSchema = { teamSections: TeamSection[], revision }
RunnerErrorBodySchema = { error: { code: string, message: string } }
// envelopes: { requests: RequestSummary[] }, { request: RequestDetail }, { triage: TriageRow[] }, { triage: TriageRow }, { request: RequestSummary }, { paused: boolean }
```

Client (`client.ts`):

```ts
export const RUNNER_TIMEOUT_MS = 5000;
export type RunnerFailureState = "not_set_up" | "token_unreadable" | "unreachable" | "timeout" | "unauthorized" | "forbidden" | "not_found" | "validation" | "conflict" | "unavailable" | "bad_response" | "http_error";
export type RunnerFailure = { state: RunnerFailureState; message: string; status: number | null; code: string | null };
export type RunnerResult<T> = { ok: true; data: T } | { ok: false; failure: RunnerFailure };   // both in types.ts
export function createRunnerClient(options: { baseUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number }): RunnerClient;
type RunnerClient = {
  getState(): Promise<RunnerResult<RunnerState>>;                                   // GET  /v1/state
  listRequests(scope: RequestScope): Promise<RunnerResult<RequestSummary[]>>;      // GET  /v1/requests?scope=<scope>      → body.requests
  getRequest(id: string): Promise<RunnerResult<RequestDetail>>;                    // GET  /v1/requests/:id                → body.request
  getStats(): Promise<RunnerResult<RunnerStats>>;                                   // GET  /v1/stats
  listTriage(): Promise<RunnerResult<TriageRow[]>>;                                 // GET  /v1/triage                      → body.triage
  getSettings(): Promise<RunnerResult<RunnerSettingsDoc>>;                          // GET  /v1/settings
  putSettings(settings: RunnerSettings, baseRevision: Revision): Promise<RunnerResult<RunnerSettingsDoc>>;   // PUT /v1/settings {settings, baseRevision}
  getPrompts(): Promise<RunnerResult<RunnerPromptsDoc>>;                            // GET  /v1/prompts
  putPrompts(teamSections: TeamSection[], baseRevision: Revision): Promise<RunnerResult<RunnerPromptsDoc>>;  // PUT /v1/prompts {teamSections, baseRevision}
  setPaused(paused: boolean): Promise<RunnerResult<{ paused: boolean }>>;          // POST /v1/pause {paused}
  requestAction(id: string, action: "approve" | "retry" | "stop" | "lift_hold"): Promise<RunnerResult<RequestSummary>>;  // POST /v1/requests/:id/{approve|retry|stop|lift-hold}, no body → body.request
  resize(id: string, size: RequestSize): Promise<RunnerResult<RequestSummary>>;     // POST /v1/requests/:id/resize {size}
  setBudget(id: string, usd: number): Promise<RunnerResult<RequestSummary>>;       // POST /v1/requests/:id/budget {usd}
  retryTriage(id: string): Promise<RunnerResult<TriageRow>>;                        // POST /v1/triage/:id/retry, no body → body.triage
};
```

- URL: `baseUrl` without a trailing `/`, then `/v1/...`; path ids through `encodeURIComponent`. Every request: `Authorization: Bearer <token>`, `x-agents-request: 1`, `Accept: application/json`, `cache: "no-store"`, `redirect: "error"`, `signal: AbortSignal.timeout(timeoutMs)`. `Content-Type: application/json` and a JSON body only on PUT and on POSTs with a body; "(empty body)" routes send no body and no content type. No `Origin`.
- Failures, never thrown: fetch rejected with `TimeoutError`/`AbortError` → `timeout`; any other rejection → `unreachable`; a non-2xx answer maps by `error.code` when the body parses as `RunnerErrorBodySchema` (`UNAUTHORIZED` → `unauthorized`, `FORBIDDEN` → `forbidden`, `NOT_FOUND` → `not_found`, `VALIDATION` → `validation`, `CONFLICT` → `conflict`, `UNAVAILABLE` → `unavailable`), else by status (401, 403, 404, 400 and 422, 409, 503 the same way), else `http_error`; a 2xx answer that is not JSON or fails the schema → `bad_response` (message: the first zod issue path and text). `message` is the runner's `error.message`, else a short technical text; `status` and `code` as received. The token never appears in a result, a log line or an error.
- Token (`token.ts`): `tokenFilePath` returns `TESSERA_AGENTS_TOKEN_FILE` (a leading `~/` expands to the home directory; relative paths resolve against the process cwd) or `<homedir>/.tessera-agents/api-token`. `readRunnerToken` returns `{ kind: "ok", token }` (trimmed), `{ kind: "missing" }` for ENOENT or an empty or whitespace-only file, `{ kind: "unreadable", message }` for anything else (EACCES, EISDIR; the message names the code, never the content).
- `withRunner(run)` (server): token missing → `{ ok: false, failure: { state: "not_set_up", message: "No runner token file", status: null, code: null } }` without a fetch; unreadable → `token_unreadable`; else builds the client and returns `run(client)`.
- `loadSuperagent({ scope, requestId })` → `SuperagentLoad = { runnerUrl, tokenFile, state, requests, triage, stats, settings, prompts, request: RunnerResult<RequestDetail> | null }`, the runner calls in parallel (`request` only when `requestId` is set). Plain objects, passed to the client component as props.

### Server Actions (`src/app/actions/superagent.ts`, lane S)

File-level `"use server"`; each export is an async function that validates its input with zod (a bad input returns `{ ok: false, failure: { state: "validation", … } }` without a call), runs `withRunner`, then calls `refresh()` outside any try (also after a runner failure, so the screen shows current data), and returns the `RunnerResult`:

| Action | Input | Runner call |
|---|---|---|
| `superagentPauseAction` | `{ paused: boolean }` | `setPaused` |
| `superagentRequestAction` | `{ request_id: string (1–200), action: "approve" \| "retry" \| "stop" \| "lift_hold" }` | `requestAction` |
| `superagentResizeAction` | `{ request_id, size: "S" \| "M" \| "L" }` | `resize` |
| `superagentBudgetAction` | `{ request_id, usd: number (> 0, ≤ 10000) }` | `setBudget` |
| `superagentRetryTriageAction` | `{ triage_id: string (1–200) }` | `retryTriage` |
| `superagentSaveSettingsAction` | `{ settings: RunnerSettings, base_revision: string \| number }` | `putSettings` |
| `superagentSavePromptsAction` | `{ team_sections: TeamSection[] (≤ 200), base_revision }` | `putPrompts` |
| `superagentRefreshAction` | none | none; only `refresh()` |

These are not registry tools and never become ones (decision 145). Tessera's own mapping is saved with `setAgentSettingsAction = toolAction("set_agent_settings")` in `src/app/actions/workspace-settings.ts` (lane E).

### Screen `/agents/superagent` (lanes U1 and U2)

Route `src/app/(tessera)/agents/superagent/page.tsx` (static segment, so it wins over `agents/[actorId]`): a `Suspense` with a skeleton around an async child that awaits `searchParams` (`scope`: `open` (default) | `recent` | `all`; `request`: a request id or none), then `await io()`, then in parallel `loadSuperagent({ scope, requestId })` and `readTessera` for `{ agents: getWorkspaceSettings(ctx).agents, projects }`, where `projects` is `listProjects(ctx, {})` then `listProjects(ctx, { archived: true })` mapped to `ProjectOption` (`archived` false, then true; review round, 2026-11-10), and renders `SuperagentScreen`.

`SuperagentScreen` (`"use client"`, props `{ runner: SuperagentLoad; agents: AgentSettings | null; projects: ProjectOption[]; scope: RequestScope; requestId: string | null }`) is a `PanelPage` with `PanelHeader label="Superagent"` > `PanelBar` (start `PanelTitle` "Superagent"; end a ghost `IconButton` "Refresh" that calls `superagentRefreshAction`). The body is a `VStack gap={6} padding={4}` (as `WebhookScreen`) with, in this order:

0. **Banners.** When `runner.state` failed: one `Banner` from `failureCopy(failure, { tokenFile, runnerUrl })`. When it loaded: `state.paused` → info "Paused" with "Paused by you." or "The daily cap is reached; new work waits until tomorrow."; `state.intake.rewound` → warning "Tessera history rewound", "The runner's cursor ({cursor}) is past Tessera's newest change ({latestSeq}), as after a restore. Intake stays stopped until the runner is reset."; `health.status === "setup_failed"` → error "Runner setup failed" naming the failed checks.
1. **Needs you** (`Heading` level 2 "Needs you", with `Badge` = `state.counts.needsYou` when above 0). A `SegmentedControl` (Open, Recent, All) sets `?scope=`. `RequestsTable` (U1): `Table` rows from `sortRequests(requests)`, columns Item (key as a `Link` to `/work-items/<workItemId>`, title as supporting text below), Repo, Size (size, plus " · answer" or " · investigation" when not `pr`), Stage (`StatusDot variant={stageVariant(kind)}` + label, reason as supporting text), Models (comma list), Cost (`formatUsd(costUsd)` of `formatUsd(budgetUsd)`), PR (`#<number> <state>` linking to `pr.url`, or "None"), Actions (`primaryAction(actions)` as an sm secondary `Button` named "<Label> <itemKey>", and a `MoreMenu` "Actions for <itemKey>" with every listed action). A container under 640px (`useNarrowContainer(640)`) shows Item, Stage and Actions only. A row click selects it (`router.push` to `?scope=…&request=<id>`, `scroll: false`); the key link stops propagation. Empty: `EmptyState` "No requests" ("Assign or mention the superagent on a work item in a mapped project."). Below the table, triage rows with `status === "unavailable"`: a `List` titled "Triage unavailable", each `Item` with the item key, "Tried {attempts} times", `lastError`, `RelativeTime` of `updatedAt`, and a "Re-triage <itemKey>" button (`superagentRetryTriageAction`).
   - Approve, Retry and Lift hold run at once. Stop opens an `AlertDialog` ("Stop <itemKey>?", "Stop is final: the session is aborted and late results are discarded.", destructive "Stop request"). Resize opens a `Dialog` with a `SegmentedControl` S, M, L (current one selected). Budget opens a `Dialog` with a `NumberInput` "Budget (USD)" (min 0.01, step 0.5, starts at `budgetUsd`). Dialogs come from `@/components/shell/dialogs`. A failed action shows a `Toast` from `failureCopy`; a done one shows "<Label> sent for <itemKey>".
2. **Health** (`RunnerOverview`, U1). Status as `StatusDot` + "Healthy", "Degraded" or "Setup failed"; checks as a `List` (dot + name + detail); a `MetadataList` with Slots ("{running} of {max} running"), Needs you, Working, Queued, Triage ("{n} queued, {m} running" from the triage rows) and Intake ("cursor {cursor}, Tessera at {latestSeq}"). Spend: `ProgressBar` label "Spent today", value `todayUsd`, max `dailyCapUsd`, value label "{formatUsd(today)} of {formatUsd(cap)}", variant `warning` from 80% and `error` from 100%; beside it a secondary `Button` "Pause" or "Resume" (`superagentPauseAction`).
3. **History** (`RequestHistory`, U1). No selection: secondary text "Select a request to see its history." Otherwise heading "<itemKey> <title>", a `MetadataList` (Stage, Size, Deliverable, Repo, Cost, PR, Created and Updated as `RelativeTime`, Plan page as a `Link` to `/pages/<planPageId>` when set), the scope text (pre-wrapped), the open question as an info `Banner` when set, a sessions `Table` (Role, Model, Effort, Cost, Started, Ended, Outcome) and the events as a `List`, newest first (`RelativeTime`, kind, text). A failed load shows its `failureCopy` inline.
4. **Routing** (`RunnerOverview`, U1). "By size" `Table` (Size, Completed, Average cost), "By model" `Table` (Model, Sessions, Cost), a `MetadataList` with "Size changed" ("{changed} of {total} requests"), "First-pass reviews" (percent, or "No reviews yet") and "Escalations" ("{cause}: {count}" joined, or "None").
5. **Settings** (`AgentSettingsSection`, U2, props `{ agents: AgentSettings | null; projects: ProjectOption[]; runnerSettings: RunnerResult<RunnerSettingsDoc>; state: RunnerResult<unknown>; context: FailureContext }`; `state` is `runner.state` and `context` is `{ tokenFile: runner.tokenFile, runnerUrl: runner.runnerUrl }`, so the section's line is `sectionNote(state, runnerSettings, context)` and its Toasts use the real token path and URL; review round, 2026-11-10). Two forms in a `FormLayout` each:
   - "Projects and repositories" (Tessera, always available): `TextInput` "Runner URL" (placeholder `AGENT_RUNNER_DEFAULT_URL`; a blank field saves the default URL, as the placeholder says), then one row per mapping: `Selector` "Project" (live projects not mapped in another row), `TextInput` "Repository" (`name` or `owner/name`), `IconButton` "Remove <project name>"; an "Add project" button; "Save mapping" calls `setAgentSettingsAction({ runner_url, projects })`. Field errors from `AgentRunnerUrlSchema` and `AgentRepoSchema` show before sending, and their words name every rule of those schemas (schema.md "AgentSettings": the port range, the 140-character cap and the segment rules; reconciler, 2026-11-10). `ProjectOption` is `{ id, name, identifier, archived: boolean }`; the page passes live and archived projects. A mapping to an archived project stays as a row (its `Selector` shows the project with " (archived)" and offers it only to that row) and is saved unchanged, since `setAgentSettings` allows archived projects. A stored mapping whose project no longer exists (deleted) is left out of the rows, with an info line "{n} mapped project(s) no longer exist and are dropped on save." No px width caps: the forms take the section's width, and the only px numbers are container thresholds passed to `useNarrowContainer` (640 for the table, 480 for the mapping row).
   - "Runner" (runner settings, disabled with the failure text while `runnerSettings` failed): `NumberInput`s "Budget for S (USD)", "M", "L", "Daily cap (USD)", "Parallel requests" (integer 1 to 8), `Switch` "M requests wait for my sign-off" (`signoffM`); "Save runner settings" calls `superagentSaveSettingsAction` with the loaded `revision`. A `conflict` shows "Changed elsewhere. The latest values are loaded."; the form is keyed by the revision so the refreshed values replace the fields.
6. **Team sections** (`TeamSectionsSection`, U2, props `{ prompts: RunnerResult<RunnerPromptsDoc>; repos: string[]; state: RunnerResult<unknown>; context: FailureContext }`, `state` and `context` as in Settings; `repos` = mapped repos plus repos already in `teamSections`, sorted). One `Collapsible` per repo, three `TextArea`s ("Communication", "Scope", "Delivery"), and one "Save team sections" that sends every non-empty text (entries of repos not shown pass through unchanged) with the loaded `revision`; `conflict` as in Settings. Disabled with the failure text while `prompts` failed.

While the tab is visible and no dialog is open, the screen calls `superagentRefreshAction` every 15 s, so health and stages stay current.

Shared helpers (`src/components/superagent/superagent-format.ts`, U1; names exact, U2 imports them):
- `formatUsd(value: number): string` → `$0.42`, `$12.00` (two decimals, `en-US`).
- `stageVariant(kind)` → `needs_failed` error; other `needs_*` warning; `working` accent; `done` success; `paused`, `queued`, `dropped`, `stopped` neutral.
- `sortRequests(rows)`: by stage order (`needs_delivery`, `needs_question`, `needs_signoff`, `needs_hold`, `needs_review`, `needs_blocked`, `needs_failed`, `paused`, `queued`, `working`, `done`, `dropped`, `stopped`), then `updatedAt` newest first. Never mutates its input.
- `ACTION_LABELS`: approve "Approve", retry "Retry", stop "Stop…", resize "Resize…", budget "Budget…", lift_hold "Lift hold". `primaryAction(actions)`: the first of approve, lift_hold, retry that is listed, else null.
- `failureCopy(failure, { tokenFile, runnerUrl })` → `{ status: "info" | "warning" | "error"; title; body }`: `not_set_up` info "Runner not set up" / "Tessera reads the runner's token from {tokenFile}. Start the superagent runner once to create it."; `token_unreadable` error "Token file unreadable" / "Tessera cannot read {tokenFile} ({message})."; `unreachable` warning "Runner not answering" / "Nothing answers at {runnerUrl}. Check that the runner is running."; `timeout` warning "Runner timed out" / "The runner at {runnerUrl} did not answer within 5 seconds."; `unauthorized` error "Token rejected" / "The runner rejected Tessera's token. Restart the runner or check {tokenFile}."; `forbidden` error "Request refused" / message; `not_found` warning "Not found" / message; `validation` error "Not accepted" / message; `conflict` warning "Changed elsewhere" / "The latest values are loaded."; `unavailable` warning "Runner unavailable" / message; `bad_response` error "Unexpected answer" / "The runner's answer does not match the API contract (v1): {message}"; `http_error` error "Runner error" / "The runner answered {status}: {message}".
- Also shared across the lanes (review round): `type FailureContext = { tokenFile, runnerUrl }` (the second argument of `failureCopy`); `failureToast(what, copy)` → "{what}. {title}. {body}"; `sectionNote(state, own, context)` → "Not available: {title}." when `state` failed, the title when only `own` failed, else null (the rule below); `type ProjectOption` (Settings); `teamRepos(agents, prompts)` (Team sections' `repos`).

Every part that depends on the runner shows, when its own load failed but the state loaded, one line of secondary text with the failure title; when the state failed, only the banner speaks and the sections show "Not available: {title}." The Tessera mapping form always works.

CSS: `src/components/styles/superagent.css` (one `@import` line in `globals.css`), tokens only, for the section grid and the table frame. Astryx components only; no raw `div`/`span`, hex or px beyond the container thresholds (640 and 480) and the table's `pixel()` column widths (precedent: `workspace-settings/table-widths.ts`).

### Send to superagent (lane U2)

- `ProjectBundle` gains `superagent_repo?: string | null` ("Repository the superagent works in for this project (decision 144), or null when it is not mapped"). `projects/[projectId]/layout.tsx` and `work-items/load-detail.ts` (`loadProjectBundle`) fill it with `agentRepoFor(getWorkspaceSettings(ctx).agents, project.id)`; other bundles leave it out.
- `DetailHeader` gains `onSendToSuperagent?: () => void` and `sendToSuperagentBlockedReason?: string`. The menu row `{ id: "superagent", label: "Send to superagent", icon: RobotIcon, isDisabled, description }` sits after "Move to project…" and before "Copy ID".
- `WorkItemDetail` passes them when the item is writable and `bundle.superagent_repo` is set. The superagent is `bundle.actors.find((a) => a.kind === "agent" && a.name === SUPERAGENT_ACTOR_NAME)`. Without it the row is disabled with "The superagent has not connected to Tessera yet."; when it is already an assignee, the row reads "Open superagent chat" and opens the item's chat (decision 146; it was disabled with "Already assigned to the superagent." before). Otherwise the click calls `setAssigneesAction({ work_item_id, actor_ids: [...current assignee ids, superagent.id] })` and shows "Sent to the superagent ({repo})." or the error. The runner treats your assignment as the request (the plan's intake rules).
- The Agents screen (`AgentsScreen`) gets a "Superagent" link in its `PanelBar` end (Astryx `Button` with `href` if its props allow, else `Link`), to `/agents/superagent`.

### Fake runner and fixtures (lane S)

- `tests/fixtures/superagent/`: `state.json`, `requests.json` (at least one request per stage group: `needs_signoff` with approve, `needs_hold` with lift_hold, `needs_blocked` with budget and resize, `needs_review` with an open PR, `needs_question`, `working` with stop, `queued`, `done` with a merged PR, `stopped`; at least one non-`pr` deliverable), `request-detail.json` (sessions and events), `stats.json`, `triage.json` (one `unavailable`, one `queued`), `settings.json`, `prompts.json`. Client tests and the fake runner read the same files, so a fixture that drifts from the schema fails a test.
- `scripts/superagent-stub.ts` (`npx tsx scripts/superagent-stub.ts --port <n> --token-file <path> [--rewound] [--conflict]`): a `node:http` server on `127.0.0.1:<port>` that applies the v1 auth rules (bearer token from the file, `x-agents-request: 1`, no `Origin`, Host `127.0.0.1:<port>` or `localhost:<port>`), serves the fixtures and applies actions in memory (approve → `working`; stop → `stopped`; lift-hold → `working`; retry → `queued`; resize, budget; pause toggles `paused` with `pauseReason: "manual"`; triage retry → `queued`, attempts + 1; PUT with a stale `baseRevision` → 409 `CONFLICT`, else revision + 1). `--rewound` sets `intake.rewound`; `--conflict` makes every PUT a 409. For acceptance only; not part of the app.

### Lane split and file ownership

| Lane | Model | Owns |
|---|---|---|
| E (engine) | sonnet, high | `drizzle/0014_superagent.sql`, `drizzle/meta/{_journal.json,0014_snapshot.json}`, `src/lib/tessera/db/schema/{collaboration,workspace}.ts`, `src/lib/tessera/{comments,changes,schemas,types}.ts`, `src/lib/tessera/workspace/{settings,index}.ts`, `src/lib/tessera/tools/registry/{comments,workspace,meta}.ts`, `src/app/api/changes/route.ts`, `src/app/actions/workspace-settings.ts`, tests `comments-client-ref.test.ts`, `workspace/agent-settings.test.ts`, `registry.test.ts`, `changes.test.ts`, `changes-route.test.ts` |
| S (control client) | sonnet, high | `src/lib/superagent/**`, `src/app/actions/superagent.ts`, `scripts/superagent-stub.ts`, `tests/fixtures/superagent/**`, `tests/superagent/**`, one pattern in `eslint.config.mjs` |
| U1 (screen) | sonnet, high | `src/app/(tessera)/agents/superagent/**`, `src/components/superagent/{SuperagentScreen,RequestsTable,RunnerOverview,RequestHistory}.tsx`, `src/components/superagent/superagent-format.ts`, `src/components/styles/superagent.css`, the `@import` line in `src/app/globals.css`, `tests/ui/superagent-format.test.ts` |
| U2 (settings and send) | sonnet, high | `src/components/superagent/{AgentSettingsSection,TeamSectionsSection}.tsx`, `src/components/detail/{DetailHeader,WorkItemDetail}.tsx`, `src/components/work-items/types.ts`, `src/app/(tessera)/projects/[projectId]/layout.tsx`, `src/app/(tessera)/work-items/load-detail.ts`, `src/components/profile/AgentsScreen.tsx`, `tests/ui/detail-superagent.test.ts` |
| Root | opus | docs, `tests/mcp-http-identity.test.ts` (written in the contract step), commits |

Added by the lanes (reviewed and kept): S `tests/superagent/support.ts`; U1 `src/components/superagent/{RequestDialogs,RunnerBanners}.tsx`, `request-parts.tsx`, `use-runner-report.ts`, `tests/ui/superagent-screen.test.ts`; U2 `src/components/superagent/settings-format.ts`, `send-to-superagent.ts`, `tests/ui/superagent-settings.test.ts`; E `tests/foundation.test.ts` (the un-apply-newest-migration test) and `scripts/demo/collab.ts` (narrows the `create_comment` union). Review round: `src/components/detail/use-detail-actions.ts` (`setAssigneesReporting`, the optimistic send), `src/components/shell/recents.ts` and `tests/ui/recents.test.ts` (the "Superagent" label).

E and S run first and in parallel; U1 and U2 start once both are green, in parallel. Every file stays under 600 lines; `schemas.ts` has six lines of room and takes exactly the six lines of decision 144's schemas.

### Tests

- Lane E: `client_ref` (first create; repeat returns the same id with no new activity, notification, subscription or mention rows and an unchanged `latestSeq`; another body is `CONFLICT` with `comment_id`; a deleted comment and a reply deleted with its root give `{ deleted: true }`; another actor or item with the same ref gets its own comment; a repeat on an item archived since returns the comment; a bad ref is `VALIDATION`; the registry path; views carry `client_ref`). Agent settings (normalisation cases; set and read back through `get_workspace_settings`; omitted URL kept; `[]` clears; non-loopback, `https`, `127.0.0.2` and portless URLs refused; unknown and deleted projects `NOT_FOUND`; a repeated project `VALIDATION`; an agent through `runToolWithContext`, the assistant through `applyProposals` and an MCP client through the in-memory adapter all get `RULE user_only`; `agentRepoFor`). `latest_seq` (equals `latestSeq`; below `since_seq` after a simulated rewind while `cursor` stays; a cut page keeps the real latest); `/api/changes` returns it; registry entries.
- Lane S: every route's method, URL, headers and body against a stubbed `fetch`; every fixture parses; a missing field and non-JSON are `bad_response`; each error code and bare status maps to its state; a rejected fetch is `unreachable`; a fetch that waits for its signal with `timeoutMs: 20` is `timeout`; no result, failure or log contains the token; token path, `~` expansion, missing, empty, whitespace-trimmed, unreadable (mode 000) and directory cases; actions validate before calling, call `refresh()` (mocked `next/cache` and `server-only`), and the registry has no tool whose name contains `superagent` or `runner`.
- Lane U1: `superagent-format` helpers (every failure state, stage variants, sort order and stability, primary action, money).
- Lane U2: `DetailHeader` menu with and without `onSendToSuperagent`, disabled with each reason (render with `createElement`, as `detail-smoke.test.ts`).
- Root: `tests/mcp-http-identity.test.ts` (pinned client writes as `mcp:superagent`, no `mcp:unknown`; the legacy era loses the name).

### API verification and mismatches found while writing this section

| API | Used by | Verified |
|---|---|---|
| `@modelcontextprotocol/client` 2.3.1: `new Client(info, { versionNegotiation: { mode: { pin: "2026-07-28" } } })`, `new StreamableHTTPClientTransport(url, { fetch })` | identity test, the runner | `dist/index.d.mts` (`VersionNegotiationOptions`, default `'legacy'`); run against the real route on 2026-11-09: legacy → `mcp:unknown`, pinned → `mcp:superagent` |
| `mcp-handler` 2.3.0 `createMcpHandler` | `/api/mcp` | wraps the server SDK's `createMcpHandler`, which seeds the client identity from each request's `_meta["io.modelcontextprotocol/clientInfo"]` on the modern era only (`@modelcontextprotocol/server` `dist/index.mjs`) |
| `AbortSignal.timeout(ms)`; fetch rejects with a `TimeoutError` `DOMException` | client | Node 22 |
| Node fetch (undici) sends no `Origin`; `Host` comes from the URL (`127.0.0.1:3090`) | client | the fake runner rejects `Origin` and checks `Host`, so acceptance proves it |
| `fs/promises.readFile` error codes `ENOENT`, `EACCES`, `EISDIR` | token | Node 22 |
| `refresh()` (`next/cache`) only inside Server Actions; `io()` before reads; `searchParams` awaited under `Suspense` | actions, page | field guide; `node_modules/next/dist/docs/` |
| Astryx 0.6.8 `Section`, `MetadataList`, `ProgressBar` (`label`, `value`, `max`, `hasValueLabel`, `formatValueLabel`, `variant`), `StatusDot` (`variant`, `label`) | screen | `npm run astryx -- component <Name>` on 2026-11-09. Workers check every other component the same way before use |
| Runner API v1 | client | the plan's text, mirrored above |

Mismatches and assumptions (the runner contract stays as written):
1. `revision` has no type in v1: mirrored as `string | number` and sent back unchanged.
2. `intake.cursor` and `intake.latestSeq` are numbers, never null; a runner that sends null before its first poll gets `bad_response` on the state (noted for the runner session).
3. "(empty body)" POSTs send no body and no `Content-Type`.
4. `RequestSummary.workItemId` is taken as Tessera's work item id (links go to `/work-items/<workItemId>`).
5. `stats.firstPassReviewRate` has no unit in v1: read as a fraction from 0 to 1 (shown as a percent).
6. An error body with an unknown `error.code` maps by HTTP status; `failure.code` keeps only a code that matches `^[A-Z][A-Z0-9_]{0,63}$` and never contains the token, else null.
7. A path id (`:id`, `:triageId`) that is empty, `.` or `..` is refused in the client as `validation` with no call, because `fetch` would resolve the dot segment to another route.
8. `RequestSummary.size` and `stats.bySize[].size` are `S`, `M` or `L`; another value is `bad_response`.

Review round (2026-11-10), house rules confirmed: `client_ref` is part of every comment view (the runner reconciles with it; refs are per actor and not secret). Toasts are composed as: done "<Label without the ellipsis> sent for <itemKey>", pause "Runner paused" / "Runner resumed", failure "<what was tried>. <failureCopy title>. <body>". "Send to superagent" goes through the detail's optimistic assignee path (`useDetailActions`), so a quick second assignee edit cannot drop the superagent. Recents and Power K label `/agents/superagent` "Superagent".

### Acceptance (Frappé and Latte, 1440 and 375)

Scratch only: `TESSERA_DB_PATH=data/superagent/acceptance.db` (fresh, migrated, demo seed), `next dev` on port 3311 (`PORT=3311`), `TESSERA_AGENTS_TOKEN_FILE=data/superagent/api-token`, the fake runner on 127.0.0.1:3391. Never port 3000 or `data/tessera.db`. Screenshots at each width and scheme for steps 4 to 7.

1. No token file: `/agents/superagent` shows the info banner "Runner not set up" naming the token path; every runner section says "Not available: Runner not set up."; the console is clean; no Toast.
2. Settings: set the runner URL to `http://127.0.0.1:3391`, map the demo project to `tessera`, save. Reload: the mapping is there; `scripts/mcp-call.ts get_workspace_settings` returns `agents` with that map. `http://example.com:3391` shows a field error and sends nothing.
3. Send to superagent: on an item of the mapped project the More menu shows "Send to superagent", disabled with "The superagent has not connected to Tessera yet."; after `scripts/mcp-call.ts --client superagent list_projects '{}'` (`--client` goes before the tool) and a reload it is enabled; a click assigns `mcp:superagent` (the assignee shows its robot avatar) and the row then reads "Open superagent chat" (decision 146; before it, disabled "Already assigned to the superagent.") An item of an unmapped project has no row.
4. Token file and fake runner up: the banners match the state; "Needs you" lists needs-you rows first; Health shows status, checks, slots and the spend bar with Pause; the unavailable triage row has Re-triage; Routing and both settings forms and the team sections show the fixture values.
5. Actions: Approve moves its row to Working; Stop asks first and then shows Stopped; Resize and Budget dialogs change size and budget; Lift hold and Re-triage work; Pause turns into Resume and the "Paused" banner appears; each shows its Toast.
6. A row click selects the request: the URL gains `request=`, History shows the metadata, scope, sessions and events; the scope control switches Open, Recent and All.
7. Runner settings saved with the fake runner on `--conflict` show "Changed elsewhere" and reload; team sections save and survive a reload.
8. Fake runner stopped: "Runner not answering", no crash; a wrong token in the file: "Token rejected"; `--rewound`: "Tessera history rewound".
9. 375: no horizontal page scroll; the table shows Item, Stage and Actions; menus, dialogs and the 44px touch areas follow the Theme rules; Latte and Frappé both read.

## Superagent chat (decision 146)

A chat with the superagent inside Tessera. One conversation is one work item; the messages are its description and comments. There is no new storage, no registry tool and no runner API change (runner v1 as above; the runner repo's schemas stay the source of truth). The page reads Tessera first and adds runner data on top, so it works with the runner offline.

### Facts this section relies on (checked 2026-11-10)

- The runner posts a question as a comment with `client_ref` `question:<requestId>:<questionId>`, as a reply to the root of the comment that led to it (`tessera-agents` `src/pipeline/scheduler.ts` `ask`). It sends `client_ref` only when its `tessera.clientRef` config is on (default off), and posts the question text verbatim, which is also `RequestDetail.question`.
- While a request has an open question, the runner takes any comment of the owner on that item as the answer (`src/pipeline/follow-up.ts`). A reply whose parent is a comment the runner posted is routed to that request explicitly (`src/domain/routing.ts`). Threading is therefore a help, not a must.
- `createCommentAction` and `createWorkItemAction` are `toolAction`s: the registry runs in process as the user (`runTool`, `USER_ACTOR_ID`) and calls `refresh()` after a write. That is "Tessera's own service layer as the user". MCP and the assistant are never involved.
- `ChangesPoller` (shell) already re-renders the open screen within 5 s of any write by another actor, so new agent comments appear by themselves.
- `CommentView` carries `client_ref`, `parent_comment_id`, `body_version` and `edited_at`. Threads are one level deep.
- Astryx 0.6.8 has `@astryxdesign/core/Chat`: `ChatLayout` (`children`, `composer`, `emptyState`, `scrollRef`, `density`), `ChatMessageList` (`emptyState`, `align`, `density`), `ChatMessage` (`sender: "user" | "assistant" | "system"`, `avatar`, `name`, `metadata`), `ChatMessageBubble` (`name`, `metadata`, `variant`), `ChatMessageMetadata` (`timestamp`, `footer`, `status`), `ChatSystemMessage`, `ChatComposer` (`onSubmit`, `value`, `onChange`, `placeholder`, `isDisabled`, `footerActions`, `headerContext`, `status: { type: "error" | "warning"; message }`). Workers read `npx astryx component <Name>` before using any other prop.
- The frame is the Inbox's (`InboxScreen`, `inbox.css`): `Layout height="fill"` with a resizable `LayoutPanel` list, a `ResizeHandle`, and a `LayoutContent` pane. Under 1024px one pane shows at a time, with a back button.

### Data (lane C1)

**Engine read** `src/lib/tessera/agent-conversations.ts` (exported from `src/lib/tessera/index.ts`). It is a plain service read, not a tool, and stays under 150 lines:

```ts
export type AgentConversationRow = {
  work_item_id: string;
  key: string;                 // formatKey(project.identifier, sequence_id)
  name: string;
  project_id: string;
  project_name: string;
  is_archived: boolean;        // work_item.archived_at !== null
  last_comment: { actor_id: string; actor_name: string; snippet: string; created_at: string } | null; // newest live comment, snippet = commentSnippet(body_md)
  last_activity_at: string;    // max(work_item.updated_at, last_comment.created_at)
};
export function listAgentConversations(
  ctx: TesseraContext,
  input: { actor_id: string; project_ids: readonly string[]; extra_work_item_ids?: readonly string[] },
): AgentConversationRow[];
```

- **Which items.** Not deleted, not drafts, in a project of `project_ids` that is not deleted (archived items and projects are included). An item qualifies when any of these holds:
  - `actor_id` is an assignee;
  - a `mention` row names `actor_id` with `entity_type = 'work_item'` for the item;
  - a `mention` row names `actor_id` with `entity_type = 'comment'` for a live comment of the item;
  - the item's id is in `extra_work_item_ids`.
- **Order and limit.** `last_activity_at` newest first, then `key`; at most 200 rows. Empty `project_ids` returns `[]` with no query.

**Types** in `src/lib/superagent/types.ts`, client-safe. They import types only, from `./schemas` and `@/lib/tessera/types`:

```ts
export const SUPERAGENT_CHAT_PATH = "/agents/superagent/chat";
export type ChatProject = { id: string; name: string; identifier: string; repo: string };
export type ChatConversation = {
  workItemId: string; itemKey: string; title: string; projectId: string; projectName: string; isArchived: boolean;
  lastMessage: { actorName: string; snippet: string; at: string } | null;
  lastActivityAt: string;
  /** The item's newest runner request (largest createdAt), or null when it has none or the runner list failed. */
  request: RequestSummary | null;
};
export type ChatEntry = {
  /** The comment id, or `description` for the item's description. */
  id: string;
  kind: "description" | "comment" | "reply";
  actorId: string; actorName: string; actorKind: ActorKind; actorColor: PaletteColor;
  bodyMd: string;
  createdAt: string;
  isEdited: boolean;           // a comment with edited_at set; the description never
};
export type ChatOpen =
  | { kind: "not_found"; itemKey: string }
  | {
      kind: "item";
      workItemId: string; itemKey: string; title: string; projectId: string; projectName: string; isArchived: boolean;
      entries: ChatEntry[];
      /** The item's project actors, for mention rendering in the comment renderer. */
      mentionActors: { id: string; name: string }[];
      request: RequestSummary | null;
      /** GET /v1/requests/:id of `request`; null when `request` is null. */
      detail: RunnerResult<RequestDetail> | null;
      /** Where the composer's message goes as a reply (the open question's thread root), or null for a top-level comment. */
      replyToCommentId: string | null;
    };
export type SuperagentChatLoad = {
  runnerUrl: string; tokenFile: string;
  requests: RunnerResult<RequestSummary[]>;
  /** The live `mcp:superagent` actor (kind agent), or null before the runner first connected. */
  superagentActorId: string | null;
  userActorId: string;
  /** Mapped projects that are live (not archived, not deleted), in mapping order, with their repo. */
  projects: ChatProject[];
  conversations: ChatConversation[];
  /** null on /agents/superagent/chat (no item in the URL). */
  open: ChatOpen | null;
};
```

**Loader** `src/lib/superagent/chat.ts` (`import "server-only"`): `export async function loadSuperagentChat({ itemKey }: { itemKey: string | null }): Promise<SuperagentChatLoad>`. `server.ts` exports its private `connect()` as `connectRunner()` for this; behaviour is unchanged.

1. `connectRunner()`. Then, in parallel:
   - runner `listRequests("all")`;
   - one `readTessera` for:
     - `agents`;
     - the superagent actor: `kind = 'agent'`, `name = SUPERAGENT_ACTOR_NAME`, not deleted;
     - `ctx.actor.id`;
     - the mapped live projects as `ChatProject`;
     - `listAgentConversations` (only when the actor exists, else `[]`);
     - when `itemKey` is set: `getWorkItemByKey` (a `NOT_FOUND` becomes `{ kind: "not_found" }`, other errors propagate), `listComments`, and the project's actors.
2. **Request-only items.** When the runner list loaded, the items of requests in mapped projects that are missing from the rows come from a second `readTessera`: `listAgentConversations` with `extra_work_item_ids` set to those ids. The two row sets are merged by id and sorted again.
3. **Request per item.** `request` per conversation and for the open item is the newest request with that `workItemId`. For the open item with a request, `getRequest(request.id)` gives `detail`.
4. **Entries.**
   - The description comes first when `description_md.trim()` is not empty: `kind "description"`, actor `created_by`, at `created_at`.
   - Then every live comment, roots and replies flattened, ordered by `created_at` and then `id`. `kind` is `"reply"` when `parent_comment_id` is set.
5. **`replyToCommentId`.** Set only when `detail` loaded and `detail.data.question` is not null.
   - The question comment is the newest live comment by the superagent actor whose `client_ref` starts with `question:<request.id>:`.
   - If there is none, it is the newest live comment by that actor whose `body_md.trim()` equals `question.trim()`.
   - The value is that comment's `parent_comment_id ?? id`.
   - If neither comment exists, the value is null.
6. A runner failure never throws: `requests` and `detail` carry it. A Tessera error propagates, as on every screen.

**Fake runner.** `scripts/superagent-stub.ts` gains a repeatable `--bind <requestId>=<workItemId>,<itemKey>,<projectId>`. The bound request's summary and detail carry those three values, so acceptance can point fixtures at real items.

**Refresh hook.** `src/components/superagent/use-runner-refresh.ts`: `export function useRunnerRefresh(intervalMs: number, isPaused: boolean): void`.
- While not paused, it calls `superagentRefreshAction()` every `intervalMs`, inside a transition, when `document.visibilityState === "visible"`.
- It is the screen's current loop, moved. `SuperagentScreen` uses it with `REFRESH_INTERVAL_MS` (15 s) and `isDialogOpen`, with no behaviour change.

### Screen (lane C2)

**Routes.**
- `src/app/(tessera)/agents/superagent/chat/page.tsx` awaits `searchParams` (`new`: `"1"` or absent).
- `src/app/(tessera)/agents/superagent/chat/[itemKey]/page.tsx` awaits `params`.

Both do so under `Suspense` with a skeleton, then `await io()`, then `loadSuperagentChat`, and render `SuperagentChat`. The static segments win over `agents/[actorId]/[tab]`.

**Components** live in `src/components/superagent/chat/`, each file under 300 lines: `SuperagentChat.tsx`, `ConversationList.tsx`, `ConversationPane.tsx`, `ConversationHeader.tsx`, `NewChatPane.tsx` and `ChatEntryView.tsx`. Pure helpers go in `src/components/superagent/chat-format.ts`.

**`SuperagentChat`** (`"use client"`, props `{ load: SuperagentChatLoad; isNew: boolean }`) is the Inbox frame:
- `Layout height="fill"` with class `tessera-chat`, plus `tessera-chat--open` when `load.open !== null || isNew`.
- **header:** `PanelHeader label="Superagent chat"` > `PanelBar`. Start: `PanelTitle` "Superagent chat". End:
  - a ghost sm `Button` "Control screen" with `href="/agents/superagent"`;
  - a primary sm `Button` "New chat" with `PlusIcon` and `href="${SUPERAGENT_CHAT_PATH}?new=1"`. It is disabled when `superagentActorId === null` or `projects.length === 0`.
- **start:** a `LayoutPanel` with class `tessera-chat-list` (resizable via `useResizable`, as the Inbox, label "Chats") holding `ConversationList`, then a `ResizeHandle` labelled "Resize chats".
- **content:** a `LayoutContent padding={0}` with class `tessera-chat-thread`. It holds `ConversationPane` when `open` is set, else `NewChatPane`.
- **Back button.** Above either pane, under 1024px only (CSS, as `.tessera-inbox-back`): a ghost sm `Button` "All chats" with `CaretLeftIcon` to `SUPERAGENT_CHAT_PATH`.
- **Refresh.** `useRunnerRefresh(CHAT_REFRESH_INTERVAL_MS = 5_000, isDialogOpen || isSending)`. Tessera writes arrive through `ChangesPoller` already.

**`ConversationList`** (props `{ load }`):
- **Not connected.** When `superagentActorId === null`, an info `Banner` "The superagent hasn't connected yet", "It shows up after the runner first connects to Tessera. New chats start once it has."
- **Runner failed.** When `load.requests` failed, one line of secondary `Text`: "{failureCopy(failure, context).title}: stages and costs are hidden."
- **Rows.** A `List aria-label="Chats" hasDividers` of `ListItem`s, one per conversation (as `NotificationRow`; check `npx astryx component ListItem` for the selected and click props):
  - label "{itemKey} {title}";
  - description: "{entryName}: {snippet}" from `lastMessage`, else "No messages yet";
  - end slot: `RelativeTime` of `lastActivityAt`, and the request's `StageLabel` when `request` is set.
- **Selection.** The selected row is the open item. A click does `router.push(chatHref(itemKey))`.
- **Empty.** `ListItem` "No chats yet", "Start one, or assign or mention the superagent on a work item in a mapped project."

**`ConversationPane`** (props `{ open: ChatOpen; load; onDialogChange }`):
- **Not found.** For `not_found`: a centred `EmptyState` "No such work item", "{itemKey} does not exist or was deleted." with `headingLevel={2}`.
- **Item.** For an item: `ConversationHeader`, then `ChatLayout density="compact"`:
  - `ChatMessageList` holds one `ChatEntryView` per entry, plus optimistic pending entries (`useOptimistic`). Its `emptyState` is "No messages yet".
  - The `composer` is a `ChatComposer` (controlled):
    - placeholder "Message the superagent";
    - `headerContext` "Replies in the question's thread" when `replyToCommentId !== null`;
    - `status` from `composerStatus(load.requests, context)`;
    - `isDisabled` when `isArchived`, with placeholder "Archived work items take no comments."
- **Sending.** Submit trims the text and ignores it when empty. It calls `createCommentAction({ work_item_id: workItemId, body_md, ...(replyToCommentId ? { parent_comment_id: replyToCommentId } : {}) })`.
  - While pending, the text shows as a right-side bubble with `ChatMessageMetadata status="sending"`.
  - On success the input clears; the action's `refresh()` brings the stored comment.
  - On failure: a `Toast` "Could not send. {message}", the text goes back into the input, and the pending bubble goes away.
- **Scrolling.** The composer stays docked at the bottom of the pane at both widths. If `LayoutContent` scrolls instead of `ChatLayout`, pass its scroll element as `scrollRef`; report which way works.

**`ChatEntryView`** (props `{ entry; isMine; name; projectId; mentionActors }`):
- `ChatMessage sender={isMine ? "user" : "assistant"}`; for the other side, `avatar` is `ActorAvatar` and `name` is set.
- The `ChatMessageBubble` holds the existing comment renderer: `MarkdownEditor value={bodyMd} onChange={() => {}} readOnly compact projectId mentionActors onOpenEntity`. `onOpenEntity` does `router.push(entityRoute(link))`, as `Timeline` does (`entityHref` gives `work:KEY`, not a route; a page link with no route shows the Timeline Toast).
- `metadata` is a `ChatMessageMetadata` whose `timestamp` is `RelativeTime` of `createdAt`. Its `footer` lists, joined with " · ", whichever apply: "Description" for the description, "In a thread" for a reply, "edited" when edited.
- `isMine` is `entry.actorId === load.userActorId`. `name` is `entryName(entry, superagentActorId)`.

**`ConversationHeader`** (props `{ open; load; onDialog }`):
- **Title.** A `Heading` level 2 with the key as a `Link` to `/work-items/{workItemId}`, then the title.
- **Request row.** When `request` is set: `StageLabel stage hasReason`, `Text` `usdOf(costUsd, budgetUsd)`, `PullRequestLink pr` (only when `pr` is set; the "None" placeholder belongs to the control screen's PR column), and one sm `Button` per entry of `request.actions` in listed order, named "{ACTION_LABELS[a]} {itemKey}".
  - The `primaryAction(actions)` button is primary; the others are secondary.
  - Approve, Retry and Lift hold call `superagentRequestAction` and report through `useRunnerReport(context)` with the same texts as `RequestsTable`.
  - Stop, Resize and Budget open `RequestDialogs` (`{ kind, request }`, the same `context`).
- **No request.** When `request` is null and the list loaded: secondary `Text` "No runner request yet."
- **Runner failed.** When the list failed, the header has no runner part; the composer status speaks.
- **Wrapping.** The row wraps (`HStack` with wrap) and never scrolls the page sideways at 375.

**`NewChatPane`** (props `{ load; onSending }`):
- `ChatLayout` with an `emptyState` `EmptyState` "Start a chat", "Pick a project and say what you need. The superagent gets it as a new work item."
- The composer is a `ChatComposer` with placeholder "What should the superagent do?". Its `footerActions` hold a sm `Selector` "Project" over `load.projects` (label "{name}", description `repo`, first one selected). `status` comes from `composerStatus`.
- It is disabled in two cases:
  - with `superagentActorId === null`, placeholder "The superagent hasn't connected yet.";
  - with no projects, placeholder "Map a project to a repository first." and a `Link` "Open settings" to `/agents/superagent`.
- **Submit.** It calls `createWorkItemAction({ project_id, name: chatTitle(text), description_md: text, assignee_ids: [superagentActorId] })`. On success: `router.push(chatHref(key))`, where `key` is the created item's key (read it from the tool's result). On failure: a `Toast` "Could not start the chat. {message}", and the text stays.

**`chat-format.ts`** (pure, tested):
- `chatHref(itemKey)` → `${SUPERAGENT_CHAT_PATH}/${encodeURIComponent(itemKey)}`.
- `chatTitle(text)`:
  - takes the first line with non-space text, trimmed, with leading `#`, `>`, `-` or `*` markers and spaces removed;
  - clips to 80 characters, cut at the last space before 80 when there is one, plus "…";
  - an empty result gives "Chat with the superagent".
- `entryName(entry, superagentActorId)` → "Superagent" for that actor, else `actorName`.
- `composerStatus(requests, context)` gives:
  - null when the list loaded;
  - `{ type: "warning", message: "Runner offline. It will read this when it's back." }` for `unreachable`, `timeout` and `unavailable`;
  - else `{ type: "warning", message: "{failureCopy title}. The runner reads this once it is running." }`.

**CSS.** `src/components/styles/superagent-chat.css`, imported once in `globals.css`. It holds the `tessera-chat*` rules, copied from `inbox.css`: `min-width: 0; min-height: 0`, the 1024px one-pane rule, and the back button hidden from 1024px up. Tokens only.

### Navigation and send (lane C3)

- **Control screen.** `SuperagentScreen`'s `PanelBar` end gets a secondary sm `Button` "Chat" with `href={SUPERAGENT_CHAT_PATH}`, before Refresh.
- **Sidebar.** `Sidebar.tsx` gets a `RailItem` "Superagent chat" (`AssistantIcon`, href `SUPERAGENT_CHAT_PATH`) right after "Agents", selected on that path and below it. "Agents" is no longer selected there.
- **Recents and Power K labels.** `recents.ts` labels `/agents/superagent/chat` "Superagent chat" and `/agents/superagent/chat/<KEY>` "Chat {KEY}", both with the agents icon. Tested in `tests/ui/recents.test.ts`.
- **Send to superagent opens the chat.** `send-to-superagent.ts`:
  - The `blocked` state with `SUPERAGENT_ALREADY_ASSIGNED` becomes `{ kind: "open" }`. `SUPERAGENT_ALREADY_ASSIGNED` is removed. "Not connected" stays `blocked`.
  - `DetailHeader` gains `sendToSuperagentLabel?: string` (default "Send to superagent").
  - `WorkItemDetail`, on `ready`, assigns as today. On success it shows the Toast and then does `router.push(chatHref(item key))`.
  - On `open`, the row reads "Open superagent chat", enabled, and navigates.
  - Tests in `tests/ui/detail-superagent.test.ts`.

### Lane split and file ownership

| Lane | Model | Owns |
|---|---|---|
| C1 (data) | sonnet, high | `src/lib/tessera/agent-conversations.ts`, one export line in `src/lib/tessera/index.ts`, `src/lib/superagent/{types,server,chat}.ts`, `scripts/superagent-stub.ts`, `src/components/superagent/use-runner-refresh.ts`, `src/components/superagent/SuperagentScreen.tsx` (the hook only), tests `tests/agent-conversations.test.ts`, `tests/superagent/chat-load.test.ts`, `tests/superagent/stub.test.ts` (`--bind`), `tests/superagent/server.test.ts` if `connectRunner` touches it |
| C2 (chat screen) | sonnet, high | `src/app/(tessera)/agents/superagent/chat/**`, `src/components/superagent/chat/**`, `src/components/superagent/chat-format.ts`, `src/components/styles/superagent-chat.css`, the `@import` line in `src/app/globals.css`, `tests/ui/superagent-chat.test.ts` |
| C3 (navigation and send) | sonnet, high | `src/components/superagent/SuperagentScreen.tsx` (the Chat button), `src/components/shell/Sidebar.tsx`, `src/components/shell/recents.ts`, `src/components/superagent/send-to-superagent.ts`, `src/components/detail/{DetailHeader,WorkItemDetail}.tsx`, tests `tests/ui/recents.test.ts`, `tests/ui/detail-superagent.test.ts` |
| Root | opus | docs, bundle baseline, acceptance, commits |

**Order.** C1 runs first. C2 and C3 start once it is green, in parallel. C3 imports `chatHref` from C2's `chat-format.ts`; until C2 lands, it builds the same string from `SUPERAGENT_CHAT_PATH` inline and switches to the import at integration. Every file stays under 600 lines.

### Tests

- **C1, engine read.** `listAgentConversations`:
  - each qualifying path: assignee, item mention, comment mention, extra id;
  - what never qualifies: a mention on a deleted comment, a deleted or draft item, an item in an unmapped project;
  - archived items included;
  - order and the 200 cap;
  - empty `project_ids`.
- **C1, loader.** `loadSuperagentChat` with a stubbed runner client and a seeded memory database:
  - runner down, so the conversations still come from Tessera and `requests` carries the failure;
  - request-only items merged;
  - the newest request per item;
  - entries: description first, replies flattened in time order;
  - `replyToCommentId` by `client_ref`, by body, and null;
  - `not_found` for an unknown key;
  - no superagent actor, so no conversations.
- **C1, stub and hook.** The stub's `--bind`. `useRunnerRefresh` pauses and needs visibility, with fake timers.
- **C2.** The `chat-format` helpers: every branch of `chatTitle`, `composerStatus` for each failure state, `entryName`, `chatHref` encoding. A render smoke test of `SuperagentChat` with `createElement` covers: not connected (banner, New chat disabled), an open item (bubbles on both sides, header buttons from `actions`), not found, the archived composer disabled.
- **C3.** Recents labels. `sendToSuperagentState` `open`. `DetailHeader` with `sendToSuperagentLabel`. The Sidebar selection for the chat path.

### Acceptance (Frappé and Latte, 1440 and 375)

Scratch only:
- a fresh `TESSERA_DB_PATH=data/superagent/chat-acceptance.db` (demo seed);
- `next dev` on 3311 with `TESSERA_AGENTS_TOKEN_FILE=data/superagent/api-token`;
- the fake runner on 3391.

Never port 3000 or `data/tessera.db`. Screenshots at each width and scheme for steps 2, 5 and 9.

1. **Not connected.** Map a project on `/agents/superagent`. `/agents/superagent/chat` then shows "The superagent hasn't connected yet", New chat is disabled, and the list says "No chats yet".
2. **New chat.** Run `scripts/mcp-call.ts --client superagent list_projects '{}'` and reload. New chat is now enabled. A two-line message in the mapped project lands on `/agents/superagent/chat/<KEY>`, and the item has:
   - the first line as its title;
   - the whole message as its description;
   - `mcp:superagent` as its assignee.

   The description is the first bubble, on the right.
3. **Runner offline** (fake runner stopped). The composer says "Runner offline. It will read this when it's back.". A message sends and shows on the right, and the list still shows the chat.
4. **Agent comment.** A comment by `--client superagent create_comment` on the item shows on the left within about 5 s, with no reload.
5. **Runner up** (fake runner with `--bind rq_question=…` and `--bind rq_signoff=…` on two chat items):
   - The header shows the stage, cost, PR and the listed buttons.
   - The superagent's question comment (`client_ref` `question:rq_question:1`, the fixture's question text) is in the thread. The next message is stored as a reply to its root (`list_comments`).
   - Approve on the signoff chat shows its Toast, and the stage moves within about 5 s.
   - Stop asks first.
6. **Mention.** A user comment that mentions the superagent on an unassigned item of a mapped project adds that item to the list.
7. **Send to superagent.** On another item, it assigns and opens that item's chat. On an assigned item the row reads "Open superagent chat".
8. **Links.** The sidebar "Superagent chat", the control screen's "Chat" and the Recents label work.
9. **375 and both themes.**
   - `/agents/superagent/chat` shows the list only; a chat shows the thread with "All chats"; New chat shows its pane with the back button.
   - There is no horizontal page scroll, and the composer stays docked.
   - Latte and Frappé both read.
