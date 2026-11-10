# As-built map: planning (cycles, modules, archives)

State described: the working tree after the visual alignment round (2026-10-22, on HEAD 5f0cc7c); fix round 3 (2026-10-23) changed only the archives and intake chrome: the archives strip is the generic `PanelBar tabsBelow` strip with 44 px tabs on a phone, and the Intake bar is covered in planning-extras.md. Read this before the long contracts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Contract: docs/contracts/ui.md "## P3: cycles, modules, archives".

## 1. Purpose and boundaries

This area is the UI for dated work windows (cycles), themed groups of work (modules) and the archives of work items, cycles, modules and projects, with restore and delete for each. It is a thin client over the engine: every read happens in a server `page.tsx` through one `readTessera`, and every write is a Server Action wrapper that calls a registry tool. The pure rules (labels, which menu entries exist, chart maths, archive tab list) live in small `*-format.ts` / `burndown.ts` / `archive-rules.ts` files so Vitest can test them without React.

It lives in `src/components/planning/**`, the route folders `cycles`, `modules` and `archives` under `src/app/(tessera)/projects/[projectId]/` (with `scope-lookup.ts`), `src/app/(tessera)/projects/archives/`, `src/app/(tessera)/active-cycles/`, the two alias routes `src/app/(tessera)/{cycles/[cycleId],modules/[moduleId]}/page.tsx`, and `src/components/styles/{planning,modules,archives}.css`.

Lives elsewhere (this area only calls it):
- Engine: `src/lib/tessera/{cycles,modules,cycle-dates,module-links}.ts`, tools in `src/lib/tessera/tools/registry/{cycles,modules}.ts`, snapshot/progress/overlap rules, `open_count`, breakdowns, `getActiveCycles`. Contracts: schema.md, service-api.md "P3 additions (lane A)", tools.md "P3 changes".
- Server Actions: `src/app/actions/{cycles,modules,projects,work-items}.ts` over `actions/_run.ts` (`toolAction`).
- Scoped work items list (`ScopedWorkItems`, `loadPeek`, `ListSkeleton`) in `projects/[projectId]/work-items/scoped-list.tsx`, plus `WorkItemsScreen`, quick-add and board drop rules (`quick-add.ts`, `BoardLayout`).
- Project frame and tabs: `components/work-items/ProjectFrame.tsx` (mounts `ProjectMenu` and `ProjectArchivedBanner`), `project-tabs.ts` (`projectTabs`, `activeProjectTab`), `ProjectProvider` and `useProject` (`bundle.cycles`, `bundle.modules`, `statesById`, `bundle.project.archived_at`).
- Shell: `PanelHeader`/`PanelBar`/`PanelPage`, `shell/dialogs` (Dialog, AlertDialog), `recents.ts`, `recents-store.ts`, `entity-labels.ts`, `useShortcuts.ts` (`n c`, `n m`, `g r`), `command-source.ts` (Power K), `FavoriteButton` (`useFavoriteToggle`, see workspace.md).
- Peek and detail: `components/detail/**` (`PeekHost`, `peek-url`, `WorkItemDetail`, which owns the work item Archive/Restore menu entry), `work-items/properties/{CycleControl,ModuleControl}.tsx`.
- Project settings: `components/project-settings/FeaturesSettings.tsx` turns cycles and modules on and off through `updateProjectFeaturesAction`; `GeneralSettings` mounts `ProjectDangerZone` from here (see views-settings.md).
- Digest cards: `components/ai/DigestCard.tsx` (see ai.md). The Gantt styles and drag hooks that `ModulesTimeline` reuses: `components/work-items/{date-span,gantt-scale,gantt-scroll}.ts`, `components/dnd/use-timeline-drag.ts`, `styles/gantt.css` (see operations.md).

## 2. File map

### Routes (`src/app/(tessera)/`)

| Path | Responsibility | Key exports |
|---|---|---|
| `projects/[projectId]/scope-lookup.ts` | Lookup order of the cycle, module and view pages: load the record first, then read the feature toggle (section 3). Takes the project row, no engine import | `lookupScoped`, `ScopeLookup` |
| `projects/[projectId]/cycles/page.tsx` | Cycles list. One read: `getProject` (cycles off returns `null`), `listCycles(ctx, id, {})`, the current cycle's detail. `?create=1` opens the dialog. Feature off gives `FeatureOffState` | default `CyclesPage` |
| `projects/[projectId]/cycles/cycle-data.ts` | Server-only reads shared by list and detail | `hasActiveEstimate`, `loadCycleCandidates` (limit 500, open states only), `loadCycleDetail` |
| `projects/[projectId]/cycles/[cycleId]/page.tsx` | Cycle detail: `lookupScoped` around `loadCycleDetail` and the stored `cycle` digest (`getStoredDigest`, `is_stale` from `currentDigestSeq`), then streams `<ScopedWorkItems scope={{type:"cycle"}}>`; `canCreate` only for open cycles; hides the "cycle" group-by | default `CyclePage` |
| `projects/[projectId]/modules/page.tsx` | Modules list: `getProject`, `listModules`, `today`; `?layout=timeline` picks the timeline | default `ModulesPage` |
| `projects/[projectId]/modules/[moduleId]/page.tsx` | Module detail: `lookupScoped` around `getModule`, candidates (all non-members, limit 500, none when archived) and the stored `module` digest, then the scoped list; hides the "module" group-by | default `ModulePage` |
| `projects/[projectId]/archives/{layout,page}.tsx` | Layout draws the "Archives" `PanelHeader` with `ArchivesTabs`; index redirects to `archives/work-items` | `ArchivesLayout`, `ArchivesIndexPage` |
| `projects/[projectId]/archives/work-items/page.tsx` | `listWorkItems({scope:{type:"archived"}, filters from ?q=, order -updated_at, limit 2000})` plus `loadPeek` inside `PeekHost` | default page |
| `projects/[projectId]/archives/{cycles,modules}/page.tsx` | `listCycles`/`listModules` with `archived: true`; feature off gives `FeatureOffState` | default pages |
| `projects/archives/page.tsx` | `listProjects({archived:true})` in a reading `PanelPage` | default page |
| `active-cycles/page.tsx` | Cycles whose dates include today (`getActiveCycles`), kept in project order for live projects with cycles on | default `ActiveCyclesPage` |
| `cycles/[cycleId]/page.tsx`, `modules/[moduleId]/page.tsx` | Aliases for `cycle:` / `module:` links: `getCycle`/`getModule` then `redirect` to the project route (outside the try) | default pages |

### Components (`src/components/planning/`)

| File | Responsibility | Key exports |
|---|---|---|
| `types.ts` | Shared view models | `ItemCandidate`, `CycleDetailData`, `ModuleDetailData`, `ProgressTarget` |
| `CyclesScreen.tsx`, `CycleRow.tsx`, `ActiveCycleSummary.tsx` | Cycles list: sections via `groupCycles`, summary card of the current cycle with chart, rows with progress bar and menu (at 480 px and narrower the 96 px bar is hidden and the count stays) | `CyclesScreen`, `CycleRow`, `cycleRowDescription`, `ActiveCycleSummary` |
| `ActiveCyclesScreen.tsx` | `/active-cycles`: one section per current cycle with the project token and `ActiveCycleSummary`; empty state "No active cycles"; content gutter 16 px (`VStack padding={4}`) | `ActiveCyclesScreen`, `ActiveCycleSection` |
| `CycleDetailScreen.tsx`, `CycleHeader.tsx`, `CycleSidePanel.tsx` | Cycle detail frame: sub-header (status, range, days left, Add existing, panel toggle, favourite star, menu), digest card on top of the list, read-only line, 360px progress panel | `CycleDetailScreen`, `CycleHeader`, `CycleSidePanel` |
| `CycleMenu.tsx`, `CycleDialog.tsx`, `TransferDialog.tsx` | Menu (favourite, edit, transfer, archive, restore, delete), create/edit dialog with overlap pre-check, transfer of open items. The menu is disabled in an archived project | `CycleMenu`, `failureText`, `CycleDialog`, `TransferDialog`, `NO_CYCLE` |
| `ModulesScreen.tsx`, `ModuleRow.tsx`, `ModulesTimeline.tsx` | Modules list with a List/Timeline switch (`?layout=`) and row (status, lead, range, progress; fixed lead and members slots of 24 and 96 px at wide widths, shrunk to content at 480 px and narrower, where the progress bar stays at 48 px). The timeline is the Gantt over `start_date`..`target_date`; dragging a bar writes `update_module` (decision 108) | `ModulesScreen`, `ModuleRow`, `ModulesTimeline` |
| `ModuleDetailScreen.tsx`, `ModuleHeader.tsx`, `ModuleSidePanel.tsx` | Module detail with digest card; optimistic inline writes; `readOnly` for an archived module or project | `ModuleDetailScreen`, `useModuleWriter`, `ModuleWriter`, `ModuleHeader`, `ModuleSidePanel` |
| `ModuleMenu.tsx`, `ModuleDialog.tsx`, `ModuleLinks.tsx`, `LeadControl.tsx` | Menu, create/edit dialog and status control, links list with add/edit/remove, lead picker | `ModuleMenu`, `ModuleDialog`, `ModuleStatusControl`, `ModuleStatusLabel`, `ModuleLinks`, `LeadControl`, `EditableModule` |
| `AddExistingItemsDialog.tsx` | Shared "Add existing work items" for cycles and modules (filter, checkboxes, 500-row cap via `MAX_ROWS`) | `AddExistingItemsDialog`, `eligibleCandidates`, `matchesFilter` |
| `ProgressPanel.tsx`, `BreakdownTabs.tsx` | Shared progress block: completed bar, state-group rows, points, tabs for state/assignee/label | `ProgressPanel`, `CompletedBar`, `StateGroupRows`, `formatOfTotal`, `BreakdownTabs` |
| `BurndownChart.tsx`, `chart-colors.ts` | Recharts burndown/burnup (renders only after hydration, summary sentence as name, "Data table" toggle); the legend sits beside the `role="img"` frame; colours resolved from theme tokens | `BurndownChart`, `ChartLegend`, `legendEntries`, `CHART_TOKENS`, `resolveChartColors`, `useChartColors` |
| `burndown.ts` | Pure chart model and wording | `buildChartModel`, `idealSeries`, `paceOf`, `paceSentence`, `todayLabelPosition`, `summarizeChart`, `effectiveUnit`, `formatNumber`, `formatAmount` |
| `cycle-format.ts` | Cycle labels, sections, dates, menu entries, transfer targets and text, overlap helpers | `CYCLE_STATUS_LABEL`, `groupCycles`, `cycleStatusOn`, `cycleActions`, `transferTargets`, `transferText`, `rangeOverlaps`, `isDayTaken`, `localIsoDate`, `daysLeftLabel` |
| `module-format.ts` | Module labels, status variants, menu entries, progress text, form diff | `MODULE_STATUS_LABEL`, `canArchiveModule`, `moduleActions`, `moduleProgressValues`, `moduleDateError`, `changedModuleFields`, `sameMembers`, `isHttpUrl` |
| `panel-prefs.ts` | Remembered panel state in `localStorage` (`tessera.planningPanel.v1`) through `useSyncExternalStore` | `PanelPrefs`, `parsePanelPrefs`, `savePanelPrefs`, `usePanelPrefs` |
| `FeatureOffState.tsx` | Empty state for a feature turned off (cycles, modules, views, pages, intake); its button opens `/projects/<id>/settings/features` | `FeatureOffState` |
| `ArchivesTabs.tsx`, `archive-rules.ts` | Archive tab strip and pure rules | `ArchivesTabs`, `archiveTabs`, `activeArchiveKind`, `canArchiveWorkItem`, `ARCHIVE_OPEN_ITEM_REASON`, `confirmsDelete`, `failureText` |
| `ArchivedWorkItems.tsx`, `ArchivedCycles.tsx`, `ArchivedModules.tsx` | Archive lists with Restore and Delete (AlertDialog). The work items list has a `FilterBar` over `?q=`, row selection with `BulkBar variant="archived"`, and opens the peek | same names |
| `ArchivedProjects.tsx`, `ProjectArchive.tsx`, `DeleteProjectDialog.tsx` | Archived projects list and "Archived projects" link; project menu (Project settings, Archive or Restore, Delete), the settings danger zone, banner and restore hook; typed-identifier delete dialog | `ArchivedProjects`, `ArchivedProjectsLink`, `ProjectMenu`, `ProjectDangerZone`, `ProjectArchivedBanner`, `useRestoreProject`, `DeleteProjectDialog` |

### Styles (`src/components/styles/`, imported once from `src/app/globals.css`)

| File | Classes |
|---|---|
| `planning.css` | `tessera-planning-{row-end,cycle-bar,detail-bar,detail-title,side-panel,row-bar,panel-list,breakdown-tabs,link,tabpanel,chart-frame,chart-legend,chart-swatch,data-table}`; side panel capped at `max-width: 100%`; `tessera-row-hit` (the row's link gets a block-axis hit area under touch; shared by the views, intake, drafts and projects lists), `tessera-cycle-dates`, `tessera-dialog-form` (touch rules, see below) |
| `modules.css` | `tessera-modules-{row,row-lead,row-members,row-progress,row-count,row-bar,row-end,row-name,description,links,props}` (`props--dialog`: 44 px property rows under touch) |
| `archives.css` | `tessera-archives-projects` (the archives strip uses the generic `shell.css` tab-strip rules) |

The timeline uses the `tessera-gantt-*` classes of `gantt.css`.

Visual alignment rules (ui.md "Planning (cycles, modules, intake, views, projects)"): side-panel lists are pulled out 8 px (`tessera-planning-panel-list`) so dots and text sit on the 16 px inset and the breakdown tabs are pulled in 12 px; the calendar button, sm selector triggers and standalone links (`tessera-planning-link`) get 44 px touch targets without changing size (decision 14); a scrolling dialog form keeps 8 px under its last field so its hit area is not clipped; the module dialog's property rows are 44 px under touch while the side panel keeps its dense rows.

## 3. Data and control flow

### Read path
1. A route `page.tsx` is a sync default export wrapping an async child in `<Suspense fallback={<…Skeleton/>}>`; the cycles list and a cycle's page are the exception (decision 156): no boundary, `instant = false`, so the page blocks and comes in the first HTML flush, and the cycle's work items list has no boundary either.
2. The child awaits `params`/`searchParams`, calls `await io()`, validates ids with `IdSchema.safeParse` (bad id calls `notFound()`), then runs one `readTessera(ctx => …)`: `getProject`, `listCycles`/`getCycle`/`getCycleProgress`, `listModules`/`getModule`, `listWorkItems` (candidates, archived items), `getStoredDigest`, `listProjects`, `getActiveCycles`.
3. `NOT_FOUND` and `VALIDATION` from the engine map to `notFound()`; other errors rethrow.
4. List and archive pages read `getProject(...).cycles_enabled` / `modules_enabled`; false makes the loader return `null` (or `enabled: false`), and the page renders `FeatureOffState` without the other reads.
5. The cycle and module detail pages wrap the record in `lookupScoped` (decision 31): the cycle or module is loaded before the toggle is read. A `NOT_FOUND` or `VALIDATION` error, or a record whose `project_id` differs from the URL, is `missing` and the page calls `notFound()` whether the feature is on or off; only a real record with the feature off gives `FeatureOffState`. `RecentsTracker` records paths of pages that render, so a dead id never reaches recents.
6. `ctx.today()` (server local date, decision 6) travels as a prop (`data.today`, `today`) so server and client render the same days left and chart marker. `cycle-data.loadCycleDetail` adds points progress only with `hasActiveEstimate` (project estimate type `points`).
7. Detail pages pass the stored digest (`is_stale` when newer activity exists) to the screen, which renders `DigestCard` above the work item list; the model is never called on load (ai.md). They stream `ScopedWorkItems` inside a second Suspense; the cycle or module settings scope (`settingsScope`) stores layout and display (decision 23).
8. Client screens also read the project bundle from `useProject()` (`bundle.cycles` for overlap checks and transfer targets, `bundle.modules`, states, actors).
9. External writes (MCP) arrive through the shell's change polling (decision 12), which triggers a refresh of the open page.

### Write path
1. A client component calls a wrapper from `src/app/actions/{cycles,modules,projects,work-items}.ts`, each `toolAction("<tool>")` (decision 26). Cycles: `createCycleAction`, `updateCycleAction`, `archiveCycleAction`, `unarchiveCycleAction`, `deleteCycleAction`, `addWorkItemsToCycleAction`, `transferCycleWorkItemsAction`. Modules: create, update, archive, unarchive, delete, `addWorkItemsToModuleAction`, `setModuleMembersAction`, add/update/remove link. Projects: archive, unarchive, delete. Work items: `unarchiveWorkItemAction`, `deleteWorkItemAction`. The reorder and remove-from-cycle/module tools have no wrapper.
2. `_run.runTool` validates input against the registry schema, runs the tool as actor `user`, then calls `refresh()` for mutating tools. It never throws: the caller gets `{ ok: true, data, cursor }` or `{ ok: false, code, message, details }`.
3. Callers run it in `useTransition`, then toast: `toast({type:"info"})` on success, `toast({type:"error", body: failureText(...)})` on failure (`CycleMenu.failureText`, `archive-rules.failureText`).
4. Cycle create/edit: `CycleDialog` pre-checks overlap with `rangeOverlaps` and `isDayTaken` against `bundle.cycles`; an engine `CONFLICT` or `VALIDATION` is shown on the date field.
5. Transfer: `TransferDialog` offers `transferTargets(bundle.cycles, id)` plus `NO_CYCLE`, calls `transferCycleWorkItemsAction({cycle_id, to_cycle_id})` and toasts `result.data.moved`. The engine freezes `progress_snapshot` on the first transfer (`freezeSnapshot`).
6. Module inline edits (status, lead, dates, members) go through `useModuleWriter`: `useOptimistic` plus `startTransition`, only changed fields sent (`changedInline`), toast on failure (reverts). The timeline writes dates through `updateModuleAction` the same way and reverts the bar on failure.
7. Deleting calls `forgetRecentsUnder(path)` (cycle, module, work item routes, `/projects/<id>`), and `DeleteProjectDialog` also calls `forgetLastProject`. Archiving a project calls `forgetRecentsUnder` then `router.push("/projects/archives")`.
8. An archived project is read-only here: `CyclesScreen`, `ModulesScreen` and the detail screens read `bundle.project.archived_at`, hide New cycle, New module, Add existing and the archived Banner's Restore, and the cycle and module menus are disabled (project-level Restore stays in `ProjectArchivedBanner`).
9. Dialogs come from `@/components/shell/dialogs` and carry an `aria-label` equal to their title; forms mount only while `isOpen`.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced by | Guard |
|---|---|---|---|
| Both dates or none; start <= end | 16 | engine `cycle-dates.checkDates` | tests/cycles.test.ts "createCycle", "updateCycle" |
| No overlap of non-archived cycles (CONFLICT, inclusive ends) | 16 | engine `cycle-dates.assertNoOverlap`; UI pre-check `cycle-format.rangeOverlaps`, `isDayTaken`, `overlapCandidates` | tests/cycles.test.ts; tests/ui/cycle-format.test.ts |
| Status derives from dates (current, upcoming, completed, draft) | 5, 16 | engine `cycles.deriveCycleStatus`; UI `cycle-format.cycleStatusOn` | tests/cycles.test.ts "derived status"; cycle-format.test.ts |
| Archive a cycle only after its end date | 16 | engine `archiveCycle` (`RULE cycle_not_ended`); UI `cycleActions` disables Archive with `ARCHIVE_BLOCKED_REASON` | cycle-format.test.ts "cycleActions" |
| A completed cycle must be archived before it is deleted | 16 | engine `deleteCycle` (`assertNotCompleted` unless archived, `LOCKED`); UI `cycleActions` (`DELETE_BLOCKED_REASON`) | tests/cycles.test.ts "deleteCycle"; cycle-format.test.ts |
| Completed cycles are read-only (edit, join, leave refused) | 16 | engine `assertNotCompleted` (`LOCKED`); UI hides Edit/Add existing (`isOpenCycle`), `CycleHeader` read-only line | tests/cycles.test.ts; planning-a11y.test.ts |
| Only completed cycles transfer open items; target in same project, different from source | 16 | engine `transferCycleWorkItems` (`cycle_not_completed`); UI `transferTargets`, Transfer entry only with `open_count > 0` | cycles.test.ts "transferCycleWorkItems"; cycle-format.test.ts |
| `progress_snapshot` frozen on first transfer out, or at archive if null; served whenever non-null; restore keeps it | 16 | engine `freezeSnapshot`, `readSnapshot`; UI text `transferText(name, n, isFrozen)` | cycles.test.ts; cycle-format.test.ts "transferText" |
| Joining a cycle replaces the previous one; one cycle per item | 9, 16 | engine `addWorkItemsToCycle`; `eligibleCandidates` drops members and items held by a completed or archived cycle | cycles.test.ts "addWorkItemsToCycle" |
| Closed work items cannot join a cycle | 16 | engine `work_item_closed` rule; `loadCycleCandidates` filters state groups backlog, unstarted, started | cycles.test.ts |
| Module status default Planned; archive only when Completed or Cancelled | 5 | engine `archiveModule` (`module_status`); UI `canArchiveModule`, `ARCHIVABLE_STATUSES`, `ARCHIVE_BLOCKED_REASON` | modules.test.ts "archive and unarchive"; module-format.test.ts (archivable statuses equal the engine's) |
| Archived module or project takes no writes (`ARCHIVED`) | 7 | engine `loadWritableModule`, `loadWritableProject`; UI hides Add existing, links edit, `canCreate=false`, disables the menus and inline controls | modules.test.ts "archived project"; planning-a11y.test.ts "F3.4" |
| Many modules per work item; module dates `target_date >= start_date` | 9 | engine `createModule`/`updateModule`; UI `moduleDateError` | modules.test.ts; module-format.test.ts |
| A cycle or module id that is unknown, deleted or of another project is not found, with the feature on or off; only a real record with the feature off shows `FeatureOffState` | 31 | `scope-lookup.lookupScoped` in the cycle, module and view pages | tests/ui/scope-lookup.test.ts |
| Feature off hides routes, tab and archive tab | 31 | `FeatureOffState`; `archive-rules.archiveTabs`; `project-tabs.projectTabs` | archive-rules.test.ts; project-tabs.test.ts |
| The modules list switches List and Timeline through `?layout=`; timeline bars write `update_module`, no connectors | 108 | `ModulesScreen`, `ModulesTimeline` | tests/ui/modules-timeline.test.ts |
| Only completed or cancelled work items can be archived | 7 | `archive-rules.canArchiveWorkItem` (used by `WorkItemDetail`), engine refuses otherwise | archive-rules.test.ts |
| Deleting a project needs the typed identifier | 7 | `archive-rules.confirmsDelete` in `DeleteProjectDialog` | archive-rules.test.ts |
| Progress numbers: completed over (total - cancelled), the same on rows, summary card and panel | 21 | `module-format.moduleProgressValues`, `CompletedBar`, `burndown.scopeOf` | module-format.test.ts; burndown.test.ts |
| Burndown/burnup: ideal line from scope to zero; pace tolerance max(1, 5% of scope); scope = total - cancelled | 16 | `burndown.idealSeries`, `paceOf`, `buildChartModel` | tests/ui/burndown.test.ts |
| Points mode only with an active estimate; otherwise work items | 16 | `cycle-data.hasActiveEstimate`, `burndown.effectiveUnit` | burndown.test.ts "points and the issues fallback" |
| Chart colours come from theme tokens, lines differ by dash as well as colour, and the legend sits outside the `role="img"` frame | 19, 22 | `chart-colors.CHART_TOKENS`, `useChartColors`, `BurndownChart.ChartLegend` | tests/ui/chart-colors.test.ts, burndown-legend.test.ts; tests/themes/catppuccin-contrast.test.ts |
| Breakdown rows sorted by total desc, then id | 21 | engine `cycles.breakdownRows` | cycles.test.ts (id tie-break pinned) |
| Recents: drop a deleted route and its children; aliases, project index and archives index are never recorded | 15 | `recents-store.forgetRecentsUnder`, `recents.isTransientPath`, `recents.resolveRoute` labels | recents.test.ts, recents-store.test.ts |
| Display settings for a cycle or module stored per scope | 23 | `ScopedWorkItems settingsScope` | tests/view-settings.test.ts |
| Items do not join or leave an archived module or a completed/archived cycle through lists or board | 16 | `quick-add.openMemberships`, `acceptsGroupMove`, `BoardLayout.acceptsDrop` | tests/ui/quick-add.test.ts |
| Dates and "today" use the server local date, never `Date.now()` in render | 6 | `ctx.today()` passed as prop; `cycle-format.localIsoDate` for pickers | cycle-format.test.ts |
| Every mutating service export is bound by exactly one tool; UI writes go through wrappers | 26 | `toolAction`, registry | tests/registry.test.ts |

## 5. Tests that guard this area

| File | Covers |
|---|---|
| tests/cycles.test.ts (1202 lines) | Engine: create, derived status, list/get, update, reorder, archive/restore, add/remove items, transfer and snapshot, progress and breakdown, active cycles, delete |
| tests/modules.test.ts (862) | Engine: create/list, get, update, reorder, archive/restore, members, add/remove items, progress, delete, links, archived project |
| tests/ui/cycle-format.test.ts | Labels, sections, dates, overlap helpers, `cycleActions`, `transferTargets`, `transferText` |
| tests/ui/module-format.test.ts | Status labels and variants, archivable statuses, range, progress numbers, `moduleActions`, `moduleDateError`, `changedModuleFields`, helpers |
| tests/ui/archive-rules.test.ts | `canArchiveWorkItem`, `confirmsDelete`, `archiveTabs`, `activeArchiveKind`, `failureText` |
| tests/ui/burndown.test.ts, burndown-legend.test.ts | `idealSeries`, `buildChartModel` (burndown, burnup, empty cases, today), pace, points fallback; the legend entries and their place beside the chart frame |
| tests/ui/chart-colors.test.ts | Token names and resolution |
| tests/ui/panel-prefs.test.ts | `parsePanelPrefs` and the store (stored value, no re-read, corrupt value) |
| tests/ui/planning-a11y.test.ts | Dialog names, archive rows, panel toggle states, sub-headers and banners of the list and detail screens, no Restore in an archived project |
| tests/ui/scope-lookup.test.ts | `lookupScoped`: missing, foreign and feature-off cases for cycles and modules |
| tests/ui/modules-timeline.test.ts | Timeline drag rules over `update_module`, failed write reverts, Today centring |
| tests/ui/planning-visual-css.test.ts, planning-touch-phone.test.ts | Stylesheet rules of the alignment round (gutters, panel lists, module row slots, 480 px row layout) and the touch hit areas (`tessera-row-hit`, `tessera-planning-link`, dialog rules), read from the CSS |
| tests/ui/dialog-names.test.ts, dialog-teardown.test.ts | `aria-label` on the work item, project and link dialogs; dialogs close when a route is hidden |
| tests/ui/project-tabs.test.ts | Project frame tabs follow the feature toggles |
| tests/ui/recents.test.ts, recents-store.test.ts | Labels of cycles, modules, archives, aliases, `projectIdFromPath`, forget on delete |
| tests/ui/quick-add.test.ts | Open memberships and closed groups in scoped lists and boards |
| tests/ui/peek-url.test.ts | Power K work item hit opens a peek only where a host is mounted |
| tests/ui/{moves,work-items-screen,detail-smoke,property-controls}.test.ts | Neighbouring screens that use cycles and modules |
| tests/{registry,projects,view-settings,counts,filters}.test.ts | Tool binding, project archive, settings scopes, counts |

No test submits `CycleDialog` or `TransferDialog`, runs the Restore and Delete flows of the archive lists, or renders `ActiveCyclesScreen`, and no Playwright spec covers cycles, modules or archives. Those were checked in the browser (17-step acceptance in ui.md).

## 6. Extension points

- Feature toggles: `FeaturesSettings` calls `updateProjectFeaturesAction`; `archive-rules.archiveTabs` and `project-tabs.projectTabs` react. A new feature needs an entry in `FeatureOffState`'s `FEATURES` map.
- Lists: `ArchivedWorkItems` takes filters from `?q=` (`FilterBar`). `CyclesScreen`/`ModulesScreen` show engine order; decision 88's `?q=`/`sort=` is not built.
- Progress and charts: `ProgressPanel` (props `chart`, `isFrozen`, `includesArchived`) is shared by `CycleSidePanel` and `ModuleSidePanel`; a module burndown can pass a `chart` node. `buildChartModel(BuildChartInput)` accepts a scope series only through `progress`, so a per-day scope series needs a new field.
- Panel state: `savePanelPrefs(patch)` and `usePanelPrefs()` (key `tessera.planningPanel.v1`).
- Add existing: `AddExistingItemsDialog` takes `onAdd(ids) => Promise<boolean>` and a `ProgressTarget`; `eligibleCandidates` is the filter.
- Menus: `cycleActions` / `moduleActions` return entries with `id`; add an id to `CycleActionId` or `ModuleActionId`, then the handler map in `CycleMenu`/`ModuleMenu`.
- Module status: `MODULE_STATUS_LABEL` and `moduleStatusVariant` serve the rows, the header control and `ModulesTimeline`.
- Scoped routes: a new page that looks up a record under a project wraps the read in `lookupScoped` so a dead id is not found before the feature toggle.
- Entity labels and recents: `registerEntityLabel(id, name)`; `forgetRecentsUnder(path)` after any delete or archive of a routed entity.
- Peek on archive lists: `PeekHost` + `loadPeek` + `peekHref`, `notePeekPush` (pattern in `ArchivedWorkItems`).
- Power K / shortcuts: `n c` and `n m` push `?create=1`, `g r` goes to Archives, `g c`/`g m` to lists.
- Alias routes: `cycles/[cycleId]` and `modules/[moduleId]` follow the same pattern as `pages/[pageId]` for a new link scheme.
- Favourites: `FavoriteButton` in both headers and the favourite entry of both menus (`useFavoriteToggle`).

## 7. Known debt and quirks

File budget (scripts/file-budget.json): `src/lib/tessera/cycles.ts` 871 and `src/lib/tessera/modules.ts` 694 (both at their budget; they may not grow). No file in `src/components/planning` is near 600 lines; the largest are `ModulesTimeline.tsx` (353) and `ModuleDialog.tsx` (298).

Not built (ui.md P3 "Scope and deferrals" and "As built"):
- Module gallery layout and a module burndown (the module side panel has no chart).
- Reorder UI for cycles and modules (`reorder_cycle`, `reorder_module` exist as tools; no action wrapper).
- Search, sort and filter on the cycles and modules lists (decision 88); stale `view_settings` and saved filters stay when a cycle or module is deleted (ignored by the engine).
- A row action "Remove from cycle/module" in the scoped list (`remove_work_items_from_cycle` and `..._module` have no wrapper); an item leaves through its Cycle or Modules property.
- "Copy link" in the cycle and module menus.
- Entity activity feeds for cycles and modules; `deleteModule` logs no row per detached item.
- Burnup scope is a flat line (`total - cancelled`); a per-day scope series needs analytics.
- The timeline has no dependency connectors (decision 108).
- Manual start/stop and parallel cycles: never (decision 16).

Quirks:
- Dialogs must come from `@/components/shell/dialogs` (lint-enforced). Raw Astryx Dialog leaves the next page inert when Next hides a route; the BottomSheet presentation on touch screens is not covered; focus after Back goes to `<body>`.
- `aria-label` on each form dialog is required because Astryx names a dialog only when the element attaches.
- The panel toggle is disabled with a tooltip while a peek is open (`isPanelBlocked`); the peek takes the panel's place.
- `failureText` exists twice (`CycleMenu`, `archive-rules`) with different signatures.
- Candidates are capped at 500 (`CANDIDATE_LIMIT`, duplicated in the module page) and archived work items at 2000; the dialog shows at most 500 rows (`MAX_ROWS`). The module page re-declares candidate loading instead of sharing `cycle-data.ts`.
- A transfer only applies to completed cycles with open items; "Restore" of a cycle can fail with `CONFLICT` if its dates are taken now.
- In an archived project the detail Banner of an archived cycle or module offers no Restore (the engine refuses it), but the rows of Archives > Cycles and Modules still show Restore and Delete and the engine answers `ARCHIVED`.
- App anchors carry a stray `to` attribute (Astryx `LinkProvider` with `next/link`). (The Astryx Table `ContextMenu` warnings that were tolerated on 0.6.8 are gone since 0.7.0.)
- No `instant = false` is needed on any of these pages.

## 8. Where to read more

- docs/contracts/ui.md, "## P3: cycles, modules, archives", subsections: "Scope and deferrals", "Routes and data loading", "Lane A: engine additions", "Shared planning pieces", "Cycles (E1)", "Burndown and burnup chart (E1)", "Modules (E2)", "Archives (E3)", "Icons, CSS and conventions (all lanes)", "Integration (E4)", "Acceptance (P3)", "As built (integration, 2026-10-11)", "As built (fix round 1, 2026-10-11)", "As built (fix round 2, 2026-10-11)", "As built (review fixes, 2026-10-11)", "As built (layout rework merge, 2026-10-11)".
- docs/contracts/service-api.md "P3 additions (lane A)"; docs/contracts/tools.md "P3 changes"; docs/contracts/schema.md "Cycles" and "Modules".
- docs/PLAN.md: decisions 5, 6, 9, 15, 16, 21, 23, 26, 31, 108 and section 13 (Archives tab in the project panel header).
- docs/PLAN-STATUS.md: "P3 (integration, 2026-10-11)", "Layout rework merge (2026-10-11)".
- docs/field-guide/index.md: Next 16 (Cache Components), Astryx and theme, Shell.
