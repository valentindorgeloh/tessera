# As-built map: work items UI

State described: the working tree after fix round 5, 2026-10-23 (HEAD `66c02f8` plus uncommitted lane work; round 5 gave the project header's end buttons a class for the touch gap and made every create path log and notify its initial assignees; round 4 changed the project header's width bands and the peek's opener; rows below). The file was first written at `257798c` (P3); sections 2 to 7 are refreshed for the P4 to P11 changes, the visual alignment round (2026-10-22) and round 3 (phone list rows, the covered-list focus rules, the project tab strip). Line counts are tree counts. P4 to P11 additions to this screen (calendar, gantt, bulk bar, paging, rich filters) are mapped in views-settings.md, planning-extras.md, operations.md and hardening.md. Read this before the contracts; open the contract only for the section named in section 8.

## 1. Purpose and boundaries

This area draws the project frame (header, tabs, project context) and the work items list of a project, a cycle or a module, in three layouts (list, board, table) with filters, display settings, quick-add, a create dialog, inline property edits and pointer drag-and-drop. It also holds the Projects index and the "New project" dialog. One screen component (`WorkItemsScreen`) serves the project, cycle and module lists; only the server wrapper (`ScopedWorkItems`) differs by scope.

Lives elsewhere (do not look here):
- Engine, tools, zod schemas: `src/lib/tessera/**` (`work-items/`, `view-settings.ts`, `filters.ts`, `tools/registry/`). Server Action wrappers: `src/app/actions/{work-items,views,projects}.ts`.
- Peek, full detail page, property rail, editor: `src/components/detail/**`, `src/components/editor/**`, `src/app/(tessera)/work-items/**` (`load-detail.ts`, `DetailPage.tsx`).
- Cycles, modules, archives screens and the project menu/banner: `src/components/planning/**` (they mount `ScopedWorkItems` and import the property controls).
- Shell: sidebar, recents, Power K, shortcuts, `ChangesPoller`, `PanelHeader/PanelBar`, `dialogs`: `src/components/shell/**`.
- CSS: `src/components/styles/{work-items,board,table,shell}.css`. Icons: `src/themes/catppuccin/icons.tsx`.
- Routes of other project pages (cycles, modules, archives, `/projects/archives`) are not mapped here.

## 2. File map

Routes (`src/app/(tessera)/projects/`):

| Path | Responsibility | Key exports |
|---|---|---|
| `page.tsx` (87) | Projects index: one `ListItem` per project with counts text, links to `/projects/<id>/work-items`; header has `ArchivedProjectsLink` + `NewProjectButton`. Reads under Suspense + `io()` | `default ProjectsPage` |
| `[projectId]/layout.tsx` (81) | Loads the `ProjectBundle` once per navigation (`readTessera`); renders `ProjectProvider` + `ProjectFrame`; on NOT_FOUND/VALIDATION returns `children` bare (never throws). `instant = false` | `instant`, `default ProjectLayout` |
| `[projectId]/page.tsx` (47) | Index route: redirects to `work-items`; calls `notFound()` for an unknown project so Tessera's 404 shows | `default ProjectIndexPage` |
| `[projectId]/not-found.tsx` (31) | Not-found boundary; framed when the project context exists, bare otherwise (`useOptionalProject`) | `default ProjectNotFound` |
| `[projectId]/work-items/page.tsx` (34) | Awaits params/searchParams, mounts `ScopedWorkItems` with the project scope | `default WorkItemsPage` |
| `[projectId]/work-items/scoped-list.tsx` (165) | Async Server Component: decode `q`, read `view_settings`, merge display/filters, `listWorkItems`, mount `PeekHost` + `WorkItemsScreen`. Used by project, cycle and module pages | `ScopedWorkItems`, `loadPeek`, `ListSkeleton`, types `WorkItemsScope`, `ScopedWorkItemsProps` |
| `[projectId]/work-items/[workItemId]/page.tsx` (49) | Full detail page inside the frame; 404 if the item is in another project | `default WorkItemPage` |

`src/components/work-items/` (all client unless noted "pure"):

| Path | Responsibility | Key exports |
|---|---|---|
| `WorkItemsScreen.tsx` (438) | The screen: sub-header (title, purple count Badge, `LayoutSwitch`, `DisplayMenu`, "New work item"), filter row, layout switch; owns `useOptimistic`, the update/move/quick-add handlers, `?create=1`, hotkey `c`, `onOpen` (peek href); `display` goes through `useShared`, `onUpdate` and `onOpen` through `useStableCallback`, and the scroller carries `tessera-wi-scroller--grouped` while the list draws group bands (section 3a) | `WorkItemsScreen`, `WorkItemsScreenProps` |
| `ListLayout.tsx` (512) | Groups as collapsible `List`s, rows with compact property chips (24 px chips with a 44 px touch hit area), roving arrow-key focus, per-group quick-add; the row title (`tessera-wi-title`) and the group-marker names (`tessera-wi-label-text`) are cut to one line by a CSS ellipsis in `work-items.css`, not Astryx `Text maxLines`, which measures every Text on mount (a forced layout each); a cut title shows in full in a tooltip from `OneLineText`, measured only on hover; below 481 px or under a coarse pointer the group marker and quick-add text sit 8 px right to stay on the key's x. Row density (`work-items.css`): at 481 px and up the chip gap is 8 px and the title slot takes 4 px of the gap before the properties (`margin-inline-end: -4px`) so a full-width title no longer ends in an ellipsis early; at 480 px and narrower the chip gap and the row gap are 4 px on both axes, with no end padding (the label and module clusters carry `tessera-wi-chips`), so a row is as high as before the touch rework (65 px with one property line, 93 px with two) and key and title share a line; a coarse pointer above 480 px (a tablet) keeps 8 px gaps and 8 px of end padding. `.tessera-wi-filter` is `position: relative; z-index: 1` under touch so the Advanced button's hit area is not covered by the first row's own hit area. | `ListLayout` |
| `BoardLayout.tsx` (448) | Columns per group, swimlanes for `sub_group_by`, pointer DnD via `usePointerDrag`, "Move to" menu per card, quick-add per column; closed columns accept no drops; a touch drag starts only from the card grip (`.tessera-board-card-grip`), a mouse or pen from anywhere on the card; the peeked card is `aria-current` | `BoardLayout` |
| `TableLayout.tsx` (497) | Astryx `Table`: key and selection columns pinned from 768 px up, sticky header against `.tessera-wi-scroller`, Name column with a 240 px floor (Name and Project cells are `OneLineText` with the `tessera-wi-cell-text` one-line class: an ellipsis and, when cut, a tooltip measured on hover; no `maxLines`), one column per enabled property, client-side sort, grouped sections, resizable columns, inline-edit cells; the peeked row is `aria-current` | `TableLayout` |
| `DisplayMenu.tsx` (269) | `LayoutSwitch` and `DisplayMenu`; `useDisplayWriter` writes the URL (`q`) and `saveViewSettingsAction`/`resetViewSettingsAction` | `LayoutSwitch`, `DisplayMenu` |
| `FilterBar.tsx` (294) | `PowerSearch` tokens <-> `Filters`; writes only `q` (via `withSearchParam`); under touch each token and suggestion option is a 44 px target (theme and `work-items.css`) | `FilterBar` |
| `CreateWorkItemDialog.tsx` (264) | Dialog (shell `dialogs`) with name, description, common properties, "Create more", discard confirm; calls `createWorkItemAction` | `CreateWorkItemDialog`, `CreatedWorkItem` |
| `QuickAdd.tsx` (94) | Inline "add here" row: Enter creates and stays open, Escape cancels; `onCancel` tells a popover host (the calendar's narrow day cells) to close | `QuickAdd` |
| `OneLineText.tsx` (76) | One-line Text for row titles, table Name and Project cells and gantt labels: the caller's CSS class cuts it, and the full text shows in an Astryx sibling-mode `Tooltip` only after the mouse has rested on a cut line for 200 ms (one `scrollWidth` read at that moment, nothing on mount, unlike Astryx `Text maxLines`); closes on leave, press and Escape; mouse only | `OneLineText`, `OneLineTextProps` |
| `peeked.ts` (15) | The id the side peek shows (`?peek=`), so the board and the table can mark their card or row | `usePeekedId` |
| `detail/PeekHost.tsx` (321), `detail/peek-cover.ts` (114) | The peek around the list. When the container is under 640 px (`PEEK_COVER_BELOW`) the side panel covers the list, and the list region is then `inert` (decision 11): out of the tab order and the accessibility tree. `useCoverFocus` remembers the last control focused in the list (the row's key button, via the region's `onFocus`, and via `onPointerDown`, which records the closest tabbable control under the pointer because Safari does not focus a button on click; a pointer-down on no control keeps the previous opener), moves focus to the first tabbable control in the detail when the cover starts (unless focus is already inside it), and returns it to the remembered control when the peek closes or a resize ends the cover, only if the page left focus on `<body>`. The remembered control survives resizes (768 to 1440 to 768) and is dropped on close. A side panel beside the list gets the same return on close; the modal Dialog restores its own focus. | `PeekHost`, `useCoverFocus`, `useIsPanelCover`, `coversList` |
| `ProjectFrame.tsx` (157) | 52px project header: `ProjectToken`, title, `TabList` from `projectTabs`, `SectionMenu`, `ProjectMenu`; archived Banner outside the scroller; `LayoutContent` is the page scroller. Three width bands (decision 14). 1280 px and up: labelled tabs on one row. 600 to 1279 px: the tabs take their own row (a two-row grid) and only the current tab keeps its label; the others fold to their icon through a `:has()` rule in `shell.css` on the Astryx label span, each wrapped in a `Tooltip` with the tab's name (`useMediaQuery` on the fold band, `focusTrigger="always"` because the roving strip gives the other tabs `tabindex -1`; `isOpen={false}` when the tab is current or the band is not folded, so a tooltip opened by keyboard cannot outlive the fold). Below 600 px: the strip is `display: none` and the `SectionMenu` (`<project> pages`, Intake badge kept) is the second row's 44 px. Every `Tab` has `aria-label={tab.label}` so the accessible name and label-in-name hold. Under a coarse pointer at 600 to 1279 px a folded tab is 38 px drawn with the theme's 44 px hit area (3 px past each side) at a 6 px strip gap, so the boxes touch at a 44 px pitch without overlapping; the old 480/374/339 px padding steps and the tiling rule are gone. From 1280 px under a coarse pointer the labelled tabs' areas tile edge to edge (each reaches half the 2 px strip gap toward a neighbour and runs from 16 px above the tab to the bar's bottom edge; `shell.css`). The end `HStack` carries `tessera-project-bar-actions`, which widens the gap between Add to favorites and Project actions to 16 px under touch so their 44 px areas no longer overlap (round 5). `tests/ui/{project-tabs-css,project-frame,section-menu}.test.ts` | `ProjectFrame`, `ProjectToken` |
| `project-provider.tsx` (171) | Context over the bundle: lookup maps, `firstStateByGroup`; writes `tessera.lastProject.v1` after mount. A second, lean context (`useProjectRow`, section 3a) for rows and their property controls | `ProjectProvider`, `ProjectScope`, `useProject`, `useProjectRow`, `useOptionalProject`, `buildProjectContext`, `buildProjectRowContext`, `toRowBundle`, `LAST_PROJECT_STORAGE_KEY`, `ProjectContextValue`, `ProjectRowContextValue`, `RowBundle` |
| `stable.ts` (95) | Render identity helpers (section 3a): a callback with a fixed identity, structural sharing of server data | `useStableCallback`, `shareStructure`, `useShared` |
| `list-groups.ts` (28, pure) | Which groups the list draws, shared by `ListLayout` and the screen's scroller class | `visibleGroups`, `nothingMatches`, `listShowsGroups` |
| `types.ts` (130, pure) | Shared types | `ProjectBundle`, `LayoutProps`, `MoveInput`, `UpdateWorkItemPatch`, `QuickAddGroup`, `SettingsScope`, `ScopeDefaults`, `UrlState` |
| `url-state.ts` (187, pure) | `q` param codec and layering helpers | `encodeUrlState`, `decodeUrlState`, `mergeDisplay`, `mergeFilters`, `UrlDisplayPatchSchema` |
| `filter-state.ts` (42, pure) | Which filter keys the bar manages; explicit-empty clears | `LIST_FIELDS`, `DATE_FIELDS`, `isListField`, `isDateField`, `withExplicitClears` |
| `moves.ts` (99, pure) | Layout move -> engine `move_work_item` vocabulary | `isMovableGroup`, `toEngineMove` |
| `optimistic.ts` (16, pure) | Placeholder id prefix `optimistic-` | `OPTIMISTIC_ID_PREFIX`, `optimisticId`, `isOptimisticId` |
| `optimistic-list.ts` (216, pure) | Reducer for `useOptimistic`: update, move, create over `WorkItemListResult` incl. regrouping | `reduceOptimisticList`, `realNeighbour`, `OptimisticAction`, `StateGroupOf` |
| `quick-add.ts` (192, pure) | Which groups allow quick-add or a board drop; builds the create input; scope defaults | `openMemberships`, `isOpenGroupValue`, `acceptsGroupMove`, `quickAddAllowed`, `quickAddInput`, `withScopeDefaults` |
| `project-tabs.ts` (44, pure) | Tab list by feature toggles; tab for a pathname | `projectTabs`, `activeProjectTab`, `ProjectTabDef`, `ProjectTabKey` |
| `properties/index.ts` (14) | Barrel of the controls below | re-exports |
| `properties/{State,Priority,Assignee,Label,Date,Cycle,Module}Control.tsx` (41–89 each) | Ghost selectors / date input. Props `{ value, onChange, compact?, readOnly?, label? }`; options from `useProjectRow()`. `StateLabel`, `PriorityLabel` and `ActorLabel` cut their name with the `tessera-wi-label-text` CSS ellipsis (no `Text maxLines`); the compact `DateControl` chip mounts its `DateInput` only while its popover is open (Astryx 0.6.8 `Popover` keeps closed content mounted) | `StateControl/StateLabel/stateGroupVariant/stateGroupLabel`, `PriorityControl/PriorityLabel/PRIORITY_OPTIONS/isPriority/priorityOption`, `AssigneeControl/ActorLabel`, `LabelControl/paletteTokenColor`, `DateControl`, `CycleControl`, `ModuleControl` |
| `properties/membership-rules.ts` (88, pure) | Cycle read-only reasons; archived module ids kept out of the editable value | `cycleControlModel`, `splitModuleValue`, `mergeModuleChange`, `archivedModulesLabel`, `CYCLE_STATUS_LABEL` |
| `properties/date-format.ts` (25, pure) | `formatShortDate` ("Nov 10"), also used by planning | `formatShortDate` |

Other:

| Path | Responsibility | Key exports |
|---|---|---|
| `src/components/dnd/drag-math.ts` (206, pure) | Geometry and list maths ported from the Astryx kanban template | `containerAt`, `dropIndexFor`, `neighboursAt`, `isNoopDrop`, `applyMove`, `reorderIds`, `withoutId`, `exceedsThreshold`, `autoScrollFor`, types `DropTarget`, `MoveSpec`, `MoveAdapter` |
| `src/components/dnd/use-pointer-drag.ts` (394) | Pointer DnD hook: threshold, rect hit-testing, overlay through CSS vars, auto-scroll, Esc cancel | `usePointerDrag`, `DragState`, `DragDropEvent`, `ItemDragHandlers`, `UsePointerDragOptions` |
| `src/components/projects/CreateProjectDialog.tsx` (206) | "New project": name, identifier suggestion, logo icon and colour; `createProjectAction`, then pushes to the new project's work items | `CreateProjectDialog`, `NewProjectButton`, `suggestIdentifier` |

## 3. Data and control flow

Read (initial and after every mutation):
1. `projects/[projectId]/layout.tsx` `ProjectShell`: `await io()`, then one `readTessera` that builds the `ProjectBundle` (`getProject`, `listStates`, `listLabels`, `listCycles`, `listModules`, `listActors`, `latestSeq`, `ctx.today()`). The bundle holds only non-archived cycles and modules.
2. `ProjectProvider` -> `ProjectScope` -> `buildProjectContext` (full) and `buildProjectRowContext` (lean); every layout and dialog reads `useProject()`, every list row and property control `useProjectRow()` (section 3a); none fetch.
3. `work-items/page.tsx` -> `ScopedWorkItems`: `decodeUrlState(q)`, `getViewSettings(scope_type, scope_id)`, `mergeDisplay(DEFAULT_DISPLAY, settings.display, urlState.display)` through `withoutHiddenGroups`, `mergeFilters({}, settings.filters, urlState.filters)`, `listWorkItems(ctx, { scope, filters, display, limit: 2000 })`. Layering is defaults <- saved settings <- URL.
4. `?peek=<id>` runs a second, separately guarded read, `loadPeek` (-> `loadWorkItemDetail`); a bad id or another project's item gives `data: null`, never a failed list.
5. `WorkItemsScreen` renders `optimistic` (the `useOptimistic` copy of `result`) into the layout the display picks.

Write (inline edit, drag, quick-add):
1. Layout calls a `LayoutProps` callback: `onUpdate(id, patch)`, `onMove(MoveInput)`, `onQuickAdd(group, name)`.
2. `WorkItemsScreen` handler, inside `startTransition(async …)`: `applyOptimistic(action)` -> `reduceOptimisticList`; then the Server Action (`updateWorkItemAction`, `moveWorkItemAction`, `createWorkItemAction`). Moves first pass through `realNeighbour` (drops placeholder neighbours) and `toEngineMove`.
3. The action wrapper (`toolAction`) runs the tool as actor `user` and calls `refresh()`; the server re-renders steps 1–5 and `useOptimistic` settles to the real list. On `{ ok: false }` the state reverts and `fail()` raises an error Toast.
4. Quick-add: `quickAddInput` builds the create input from the group's value (plus `scopeDefaults`); if it returns null the screen opens `CreateWorkItemDialog` prefilled with the name instead. The placeholder row has an `optimistic-` id and is inert until the server item replaces it.
5. Create dialog: `createWorkItemAction` directly (no optimistic copy). `?create=1` (sidebar button) opens it via the `createOnOpen` prop, then `router.replace` drops the param.
6. Every create path (this dialog, quick-add, MCP `create_work_item`, assistant Apply, drafts Move to project) runs `createWorkItem`, which inserts with no assignees and then calls `syncAssignees`: the initial assignees (explicit `assignee_ids` and the project's `default_assignee_id`) are logged like a later `set_assignees` and notified by decisions 50 and 51 (an agent's item assigned to the user gives one `assigned you` row; the user creating an item for an agent notifies only the agent; self-assignment and the assistant as actor notify nobody). Copy and Move to project (`transfer.ts`) still insert with assignees silently. Round 5; tests in `tests/notifications.test.ts`, `tests/work-items.test.ts`, `tests/mentions.test.ts`.

Display/filter write (no Server Action for filters):
- Filter bar: `withExplicitClears(current, next)` -> `encodeUrlState` -> `router.replace(withSearchParam(…, "q", …), { scroll: false })`. Only `q` changes, so `?peek` survives.
- Display menu and layout switch: same URL write plus `saveViewSettingsAction({ scope_type, scope_id, display: patch })`; "Reset to defaults" calls `resetViewSettingsAction`. Properties are sent as the full object (the engine merges nested objects one level deep).

External writes (agents/MCP): `ChangesPoller` (shell) polls `/api/changes` every 4 s (`POLL_INTERVAL_MS`) and calls `refreshAction()`, which re-runs the read path; it also calls it when the payload's `unread_notifications` differs from the last count. The bundle's `cursor` seeds it.

Open item: `onOpen` builds `peekHref(pathname, searchParams, id)` and `notePeekPush`, then `router.push` (keeps `q`).

## 3a. Render identity (decision 141)

A write, an agent's through the poller or the user's own, makes the server render the page again and hand the client fresh copies of the same data (the RSC payload keeps no identity). Before this round every row of the list redrew on every tick, peek and write (about 9,200 components for one checkbox on the 48-row project, about 10,700 for an agent write). Now a row redraws only when something it shows changed:

- `WorkItemRow` is `memo`. Its props are `item`, `display`, `readOnly`, `selected` (a boolean, or undefined when the list has no selection column) and the handlers `onUpdate`, `onOpen`, `onToggle`. `GroupSection` computes `selected` per row, so a tick changes one row's prop and not the whole selection object that every row used to take.
- The handlers keep one identity: `onUpdate` and `onOpen` in `WorkItemsScreen` and `toggleId` in `use-selection.ts` go through `useStableCallback` (stable.ts). It assigns the latest closure in a layout effect, so call the result from an event handler or an effect, never while rendering. No row handler runs during render.
- Server data keeps its identity while its content is equal. `shareStructure(prev, next)` returns `prev` when the two are deeply equal and otherwise a copy of `next` that reuses every equal subtree; arrays of rows with a string `id` are matched by id, so an item inserted at the top (an agent created it) leaves every other row alone. `usePagedList` applies it to a new server result and to every merged page (`use-paged-list.ts`), `WorkItemsScreen` to `display` through `useShared` (setState during render, converging in one extra render). Date and Map values pass through unshared. Values are compared with `Object.is` (a NaN equals itself, so `useShared` settles instead of looping), and a key that `prev` lacks always makes a copy, so the result is deeply equal to `next` for any `prev`.
- Rows read a lean project context. `useProjectRow()` (project-provider.tsx) gives `RowBundle` plus the id maps of states, labels, actors and modules. `toRowBundle` drops what a write moves without a row drawing it: the cursor, `intake_open` and `projects`; the project's `counts`, `next_sequence` and audit stamps; a cycle's `progress` and `open_count`; a module's `progress`, `member_ids` and `links_count`; an actor's `last_seen_at` and audit stamps. The types omit them, so tsc rejects a read of a stripped field. `ProjectScope` (which `ProjectProvider` and the cross-project `RowProject` render) keeps the row bundle's identity with `useShared`, so the row context changes only when a state, label, cycle, module, actor, estimate, the date or a project flag changes. The full `useProject()` context is unchanged (the shell, the agents settings and the planning screens read the cursor, the counts and `last_seen_at`). The seven property controls, `RowProperties` and `GroupMarker` use the row context; the detail and the peek get it from the same provider.
- A memoized row still updates when its inputs change: its item (an agent write, an own inline edit through `useOptimistic`), its tick, the display properties it shows (a changed `display` redraws every row), and the row context (a renamed state or label redraws the controls inside the rows through context, not the rows).
- `tessera-wi-scroller--grouped` replaced two `.tessera-wi-scroller:has(.tessera-wi-group)` rules in `work-items.css`: a `:has()` on the scroller makes the browser re-check its whole subtree on every DOM change. `WorkItemsScreen` sets the class exactly when `listShowsGroups` (list-groups.ts) is true, the same test `ListLayout` uses to draw bands. Measured (review, 10k, same build, n=6+6): putting the `:has()` rule back costs +95 ms on the /inbox to ungrouped list navigation (920 against 826 ms) and about +90 ms on list and table ready in an interleaved A/B; a grouped list matches `:has()` at its first group and shows no difference. Do not undo it on the strength of a grouped-list probe.

Not covered: the table, the board, the calendar and the gantt still redraw everything on a tick or a write (known debt, section 7). The board's card memo and drag state go with the windowing work of P12; the table is the next perf round.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced by | Test |
|---|---|---|---|
| Items order by one project-wide fractional `sort_order`; a drop rewrites one row (`before_id`/`after_id` neighbours) | 4 | `neighboursAt` (drag-math), `toEngineMove`, engine `moveWorkItem` | `tests/ui/drag-math.test.ts`, `moves.test.ts` |
| Reads go under Suspense after `await io()`; no `router.refresh()`; mutations are Server Actions that `refresh()` | 12 | `ScopedWorkItems`, `ProjectShell`, `toolAction` wrappers | none direct (convention gate) |
| Board/list moves are optimistic, revert and Toast on failure | 13 | `WorkItemsScreen.onMove/onUpdate/onQuickAdd`, `reduceOptimisticList` | no reducer test in HEAD (see 7) |
| DnD is the hand-written pointer port; keyboard path is the "Move to" menu | 14 | `usePointerDrag`, `BoardLayout` card menu | `drag-math.test.ts` (21 cases) |
| Layouts are list, board, table, calendar and gantt (the last two since P10, `CalendarLayout` and `GanttLayout`; see operations.md) | 18 | `WorkItemsScreen` layout switch | `work-items-screen.test.ts` |
| Filters and display are `view` JSON; URL layers over saved settings | 20, 23 | `mergeDisplay`, `mergeFilters`, `withoutHiddenGroups` | `url-state.test.ts` |
| Display is remembered per scope row (`project`, `cycle`, `module`); a list saves to its own row | 23 | `useDisplayWriter(settingsScope)`, `settingsScope` prop | `work-items-screen.test.ts` ("saves … to the list's own settings scope") |
| URL display patch stays sparse (no zod defaults filled in) | 23 | `UrlDisplayPatchSchema`, `decodeUrlState` | `url-state.test.ts` ("keeps the display patch sparse") |
| A removed saved filter is written as an explicit empty value so it cannot return | 23 | `withExplicitClears` | `filter-state.test.ts` |
| Engine cannot move between `state_group`, `created_by`, `created_at`, `project`; `state_group` becomes the first state of that group | none (engine `RULE group_not_movable`; membership is decision 9) | `isMovableGroup`, `toEngineMove`, `firstStateByGroup` | `moves.test.ts` |
| Closed scopes: no quick-add or board drop into/out of an archived module or a completed/archived cycle; closed items cannot join a cycle | 16 | `acceptsGroupMove`, `quickAddAllowed`, `isOpenGroupValue`, `openMemberships` | `quick-add.test.ts` |
| Completed/archived cycle value is read-only; archived module ids are never dropped by `set_modules` | 16, 9 | `cycleControlModel`, `splitModuleValue`, `mergeModuleChange` | `property-controls.test.ts` |
| Touch drag starts only from a grip (`touch-action: none` on the grip, never on a card or row); a finger scrolls over the rest; the keyboard path stays the "Move to" menu | 14 | `.tessera-board-card-grip`, `.tessera-row-grip`; `tests/ui/board-table-css.test.ts` | `board-table-css.test.ts` |
| Colours are palette keys rendered as `Token`; state groups map to `StatusDot` variants | 22 | `paletteTokenColor`, `stateGroupVariant`, `ProjectToken` | none direct |
| "Today" is the server local date, carried in the bundle | 6 | `bundle.today`, `formatShortDate` | none direct |
| Placeholders (`optimistic-` ids) are inert: no open, move, update | 13 | `isOptimisticId` guards in `WorkItemsScreen`, `ListLayout`, `TableLayout` | `optimistic.test.ts` (ids only) |
| Project tabs follow feature toggles; Archives always; a disabled feature's route selects no tab | none (P3 contract, "Integration (E4)") | `projectTabs`, `activeProjectTab` | `project-tabs.test.ts`, `project-frame.test.ts` |
| Last-viewed project pointer feeds the sidebar's "New work item" | P2a contract | `ProjectProvider` effect, `LAST_PROJECT_STORAGE_KEY` | `last-project.test.ts` |

Rules without a decision number (code conventions): layouts import engine code only from `types`, `schemas`, `core/*` (client files); dialogs come from `@/components/shell/dialogs`; no raw `<div>`; layout through className + tokens in `styles/*.css`; panel rows use a 16px inline inset.

## 5. Tests that guard this area

| File | Covers |
|---|---|
| `tests/ui/work-items-screen.test.ts` | Sub-header title/count/New work item, title and count props, closed scope hides create, layout switch saves to the list's scope |
| `tests/ui/project-frame.test.ts` | Header row contents, tab selection, feature toggles, archived Banner placement |
| `tests/ui/project-tabs.test.ts` | `projectTabs`, `activeProjectTab` |
| `tests/ui/last-project.test.ts` | `tessera.lastProject.v1` key and `forgetLastProject` (blocked storage, other project) |
| `tests/ui/url-state.test.ts` | Encode/decode, base64url, unicode, sparse patch, nested patches, invalid values dropped |
| `tests/ui/filter-state.test.ts` | `withExplicitClears` |
| `tests/ui/moves.test.ts` | `isMovableGroup`, `toEngineMove` |
| `tests/ui/quick-add.test.ts` | `openMemberships`, `isOpenGroupValue`, `acceptsGroupMove`, `quickAddAllowed`, `quickAddInput` |
| `tests/ui/optimistic.test.ts` | Placeholder ids only |
| `tests/ui/drag-math.test.ts` | Pure drag maths |
| `tests/ui/property-controls.test.ts` | `cycleControlModel`, `splitModuleValue`/`mergeModuleChange` |
| `tests/ui/dialog-names.test.ts`, `planning-a11y.test.ts`, `detail-smoke.test.ts` | Reference some of these components (grep matched `CreateWorkItemDialog`, `ProjectProvider`, `ScopedWorkItems`); not read in detail |
| `tests/ui/list-touch-css.test.ts`, `list-visual-fixes.test.ts`, `list-audit-round2.test.ts` | Work-items stylesheet rules of the visual audit (touch hit areas, group gutter, filter field, the phone arm and tablet arm of row gaps, the title margin, the filter z-index) and the list fixes under jsdom |
| `tests/ui/peek-inert.test.ts`, `peek-cover.test.ts` | `useCoverFocus` and `inert` on the covered list: cover starts, close, resize round trips, a wide container, the modal, focus the user moved elsewhere is not stolen back |
| `tests/ui/project-tabs-css.test.ts`, `project-tabs.test.ts` | The folded tab strip rules, one `aria-label` and one foldable label span per tab, the 44 px pitch of folded hit areas, the phone band that hides the strip, the tooltip props |
| `tests/e2e/round-features.spec.ts` | Key and title share one line in every list row at 375 px, over WEB's rows and a project with very long titles |
| `tests/ui/row-truncation.test.ts`, `one-line-text.test.ts` | No `Text maxLines` in the row, table and gantt files; the one-line classes carry exactly Astryx's singleLine declarations; `OneLineText` measures nothing on mount and opens its tooltip only on a cut line after the delay (mouse, not touch), closing on leave and press |
| `tests/ui/stable.test.ts`, `list-row-memo.test.ts`, `project-row-context.test.ts`, `wi-scroller-css.test.ts`, `use-paged-list.test.ts` | Render identity (section 3a): `shareStructure` and `useShared`, `useStableCallback`; the real screen and list with 20 rows count `ListItem` renders (0 rows on a refresh with equal data, 1 for a changed item, a tick, an inline edit or an inserted item, all rows for a display change, a renamed state reaching rows through context); the row context keeps its identity across a write and changes on a rename; no `:has()` on the scroller and the grouped class; equal refreshes and merged pages keep row identities |
| `tests/ui/date-control-lazy.test.ts`, `gantt-dates-lazy.test.ts` | The compact `DateControl` chip and the gantt and modules-timeline Set-dates popovers mount their `DateInput`s only while open |
| `tests/ui/board-table-css.test.ts`, `board-table-fixes.test.ts`, `quick-add-cancel.test.ts` | Board and table stylesheet rules (column head, grip, sticky header, pinned columns) and behaviour (peeked marks, `QuickAdd` `onCancel`) |
| `tests/ui/peek-url.test.ts`, `peek-prefs.test.ts` | `withSearchParam`, `peekHref` used by the screen, filter bar and display menu |
| `tests/work-items.test.ts`, `tests/filters.test.ts`, `tests/projects.test.ts` | Engine behind the area (moves, filters, projects) |

Not covered: `reduceOptimisticList`, `ListLayout`/`BoardLayout`/`TableLayout` rendering, `usePointerDrag` (hook), `CreateWorkItemDialog`, `CreateProjectDialog`, `suggestIdentifier`, `ScopedWorkItems`/`withoutHiddenGroups`. Acceptance for these was a manual browser run (docs/PLAN-STATUS.md P2a, P3).

## 6. Extension points a later phase will use

- Layouts: add a component taking `LayoutProps` and a branch in `WorkItemsScreen` where `display.layout` picks the layout. P10 added `CalendarLayout` and `GanttLayout` as the `calendar` and `gantt` branches of `WorkItemsScreen`; `usePointerDrag` and `drag-math` (`applyMove`, `MoveAdapter`) are built to be shared by them.
- Project pages: add a `ProjectTabDef` (`key`, `label`, `segment`) and a `ProjectTabKey` member in `project-tabs.ts`, plus an icon in `ProjectFrame`'s `TAB_ICONS`, a route under `projects/[projectId]/<segment>/`, and a toggle on `Project` if the tab is optional. P4 views and later pages, intake and settings tabs go here.
- Scoped lists: `ScopedWorkItems` props `scope` (`WorkItemsScope`), `settingsScope` (`SettingsScope`), `scopeDefaults` (`ScopeDefaults`), `canCreate`, `hiddenGroupFields`, `title`, `count`. A saved view or a module/cycle list reuses it without changes to `WorkItemsScreen`.
- Bundle: add fields to `ProjectBundle` (`types.ts`), load them in `ProjectShell`, expose maps in `buildProjectContext`/`ProjectContextValue`.
- Property controls: new control in `properties/` taking `{ value, onChange, compact?, readOnly?, label? }`, exported from `properties/index.ts`. `EstimateControl` is exported from `properties/index.ts` (P8).
- Filters: add keys to `LIST_FIELDS`/`DATE_FIELDS` (`filter-state.ts`) and the matching `PowerSearch` field in `FilterBar.tsx`. The P10 rich filter tree (the Advanced dialog) sits beside the token map; see operations.md.
- Display options: extend `Display` in `src/lib/tessera/schemas`, mirror it in `UrlDisplayPatchSchema` (a parity test checks it against `DisplaySchema.shape`) and add the control to `DisplayMenu`.
- Optimistic actions: add a member to `OptimisticAction` and a case in `reduceOptimisticList`.
- Touch: a control in a dense row takes `tessera-hit` classes or relies on the theme's hit area (ui.md "Touch targets"); a new draggable surface gets a grip, never `touch-action: none` on the whole card or row.
- Bulk actions (P8): `LayoutProps.selection` and the `BulkBar` exist; see planning-extras.md.
- Create flow: `CreateWorkItemDialog` `defaults` prop (`Partial<Omit<CreateWorkItemInputType, "project_id">>`) and `onCreated`; P8 wired drafts into it through `SaveDraftDialog` (see planning-extras.md).

## 7. Known debt and quirks

File budget (`scripts/file-budget.json`): only `cycles.ts` and `modules.ts` are ratcheted. Nothing in this area is listed; the biggest files here are `TableLayout.tsx` (497 of 600), `ListLayout.tsx` (496) and `BoardLayout.tsx` (448).

Deferred, from the contracts:
- Calendar and Gantt, the modules timeline, `EstimateControl`, the intake badge and drafts in the create dialog were deferred when this file was written and have since shipped (P8 to P10); see planning-extras.md and operations.md.
- Labels, assignees and modules are read-only in list and table rows (`onUpdate` carries only the `update_work_item` patch; the `set_*` tools are reached from the detail).
- Date filters (`start_date`, `target_date`) have no empty form, so a saved date filter cannot be cleared from the bar.
- Deleting a state, label, cycle or module now strips its id from saved views and remembered view settings (`saved-filters.ts`, decision 32); see views-settings.md. `filters.ts` still tolerates unknown ids.
- `UrlDisplayPatchSchema` duplicates the engine's `DisplayPatchSchema` (that one is in server-only `view-settings.ts`) until it moves to `schemas.ts`.
- `LayoutProps.readOnly` is declared ("archived project: no create, no drag") but `WorkItemsScreen` never sets it and Board/List ignore it; an archived project's list is only marked by the banner.
- Paging (P11) replaced the fixed `LIMIT = 2000`: first pages of 200 rows or 50/30 per group, then "Show more" (hardening.md). A table header sort now writes `display.order_by` through `table-sort.ts`, so the server re-sorts the whole filtered list.
- `date-format.ts` calls `new Date()` for the current-year check in render paths; the field guide warns against argless `new Date()` in render (the bundle's `today` exists for this).
- The side peek narrows the list/board instead of overlaying it; at 1440 px the board's fourth column is cut while it is open. Below a 640 px container (360 px minimum panel plus 280 px for the list) it covers the list instead (`detail/peek-cover.ts`) and the list is inert.
- Focus after closing a side peek: the row's key button gets it back only if the browser focused that button on click; Safari does not focus a button on click, so there focus falls to `<body>`.
- At 360 px a few list rows (those with many chips) wrap one chip line more than at the 375 px audit baseline, so they are up to 28 px taller; key and title still share a line.
- In a row whose properties wrap under a long title, the title's `-4px` end margin can reach 4 px into the row's 16 px end inset (cosmetic).
- The poll runs every 4 s (fixed rate), not 5 s as `docs/PLAN.md` and `ui.md` "External writes" still say.
- A folded project tab (icon only) gets its tooltip from a `Tooltip` wrapper in `ProjectFrame` (Astryx `Tab` omits `title`). The wrapper is always mounted so keyboard focus is not lost when the band changes; `isEnabled` only stops it opening, so `isOpen={false}` closes one that is already open.

- The table, board, calendar and gantt are not memoized (section 3a): a tick or an agent write redraws every row or card there. `properties/index.ts` still names `useProject()` in a comment; the controls now read `useProjectRow()`. A cross-project list (`RowProject`) rebuilds each row's `ProjectScope` when the server hands in new `bundles`, because `BundlesProvider` does not share structure.

Quirks that cost agents time:
- `projects/[projectId]/layout.tsx` has `instant = false` and never throws: it returns `children` so each page can `notFound()` itself.
- A page under the project routes may render with no `ProjectProvider` (unknown project). Use `useOptionalProject` in anything the not-found boundary renders.
- `?create=1` handling is a render-time state flip plus an effect that strips the param; Next keeps the component mounted, so do not move it to a mount effect.
- Peek/`q` are separate URL params; any writer of `q` must use `withSearchParam` so `peek` survives.
- `useOptimistic` only reverts through the server re-render; a failed action relies on the Toast plus the transition ending.
- `toEngineMove` can return null (nothing to do); `onMove` then silently ignores the drop.
- Dev-only console noise: React's negative time stamp `measure` error after `notFound()` (the Astryx Table `tableContextMenu` warnings went with Astryx 0.7.0).
- Open issues in `docs/PLAN-STATUS.md` touching this area: peek-narrows-board (above), `.claude/**` worktrees scanned by eslint/tsc, the Next dev reload loop (clear `.next/dev`).

## 8. Where to read more

- `docs/contracts/ui.md`: "Route groups"; "Data flow (from docs/PLAN.md §7)"; "ProjectBundle and ProjectProvider"; "Work items screen (lane C)"; "Routes and modes (D3)" (peek and `?peek`); "P3: cycles, modules, archives" -> "Integration (E4): scoped list, frame, sidebar, tabs, Power K, links" (frame tabs, quick-add rules, scoped list, mismatches 27, 33, 34); "API verification and mismatches found while writing this section"; "As built (integration, 2026-10-11)" and "As built (layout rework merge, 2026-10-11)" (the 52px frame and rows).
- `docs/PLAN.md`: "Resolved design decisions" (table, numbers above); "5. Routes, screens, components"; "7. Data flow".
- `docs/PLAN-STATUS.md`: "P2a (integration, 2026-10-11)" (fix round 1: moves, `?create=1`), P2b fix rounds 1–2 (peek URL, poller timing), P3 integration notes.
- `docs/contracts/service-api.md` and `docs/contracts/tools.md`: engine side of `listWorkItems`, `move_work_item`, view settings.
- `docs/contracts/schema.md`: `view_settings`, `work_item` columns.
- `docs/field-guide/index.md`: Next 16 and Astryx traps; `docs/process/swarm.md`: gates and file budget.
