# As-built map: P3 planning (cycles, modules, archives)

Describes the committed state at HEAD `257798c` (P3 is done, 2026-10-11; layout rework merged). Read this before the long contracts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Contract: docs/contracts/ui.md "## P3: cycles, modules, archives".

## 1. Purpose and boundaries

This area is the UI for dated work windows (cycles), themed groups of work (modules) and the archives of work items, cycles, modules and projects, with restore and delete for each. It is a thin client over the engine: every read happens in a server `page.tsx` through one `readTessera`, and every write is a Server Action wrapper that calls a registry tool. The pure rules (labels, which menu entries exist, chart maths, archive tab list) live in small `*-format.ts` / `burndown.ts` / `archive-rules.ts` files so Vitest can test them without React.

It lives in `src/components/planning/**`, the route folders `cycles`, `modules` and `archives` under `src/app/(tessera)/projects/[projectId]/`, `src/app/(tessera)/projects/archives/`, the two alias routes `src/app/(tessera)/{cycles/[cycleId],modules/[moduleId]}/page.tsx`, and `src/components/styles/{planning,modules,archives}.css`.

Lives elsewhere (this area only calls it):
- Engine: `src/lib/tessera/{cycles,modules,cycle-dates,module-links}.ts`, tools in `src/lib/tessera/tools/registry/{cycles,modules}.ts`, snapshot/progress/overlap rules, `open_count`, breakdowns. Contracts: schema.md, service-api.md "P3 additions (lane A)", tools.md "P3 changes".
- Server Actions: `src/app/actions/{cycles,modules,projects,work-items}.ts` over `actions/_run.ts` (`toolAction`).
- Scoped work items list (`ScopedWorkItems`, `loadPeek`, `ListSkeleton`) in `projects/[projectId]/work-items/scoped-list.tsx`, plus `WorkItemsScreen`, quick-add and board drop rules (`quick-add.ts`, `BoardLayout`).
- Project frame and tabs: `components/work-items/ProjectFrame.tsx` (mounts `ProjectMenu` and `ProjectArchivedBanner`), `project-tabs.ts` (`projectTabs`, `activeProjectTab`), `ProjectProvider` and `useProject` (`bundle.cycles`, `bundle.modules`, `statesById`).
- Shell: `PanelHeader`/`PanelBar`/`PanelPage`, `shell/dialogs` (Dialog, AlertDialog), `recents.ts`, `recents-store.ts`, `entity-labels.ts`, `useShortcuts.ts` (`n c`, `n m`, `g r`), `command-source.ts` (Power K), `HiddenDialogGuard`.
- Peek and detail: `components/detail/**` (`PeekHost`, `peek-url`, `WorkItemDetail`, which owns the work item Archive/Restore menu entry), `work-items/properties/{CycleControl,ModuleControl}.tsx`.
- Project settings UI and feature toggles: P4 (not built); today `update_project_features` is MCP only.

## 2. File map

### Routes (`src/app/(tessera)/`)

| Path | Responsibility | Key exports |
|---|---|---|
| `projects/[projectId]/cycles/page.tsx` | Cycles list. One read: `getProject`, `listCycles(ctx, id, {})`, current cycle's detail. `?create=1` opens the dialog. Feature off gives `FeatureOffState`. | default `CyclesPage` |
| `projects/[projectId]/cycles/cycle-data.ts` | Server-only reads shared by list and detail | `hasActiveEstimate`, `loadCycleCandidates` (limit 500, open states only), `loadCycleDetail` |
| `projects/[projectId]/cycles/[cycleId]/page.tsx` | Cycle detail: `loadCycleDetail`, then streams `<ScopedWorkItems scope={{type:"cycle"}}>`; `canCreate` only for open cycles; hides the "cycle" group-by | default `CyclePage` |
| `projects/[projectId]/modules/page.tsx` | Modules list: `getProject`, `listModules`, `today` | default `ModulesPage` |
| `projects/[projectId]/modules/[moduleId]/page.tsx` | Module detail: `getModule`, candidates (all non-members, limit 500, none when archived), scoped list; hides the "module" group-by | default `ModulePage` |
| `projects/[projectId]/archives/{layout,page}.tsx` | Layout draws the "Archives" `PanelHeader` with `ArchivesTabs`; index redirects to `archives/work-items` | `ArchivesLayout`, `ArchivesIndexPage` |
| `projects/[projectId]/archives/work-items/page.tsx` | `listWorkItems({scope:{type:"archived"}, order -updated_at, limit 2000})` plus `loadPeek` inside `PeekHost` | default page |
| `projects/[projectId]/archives/{cycles,modules}/page.tsx` | `listCycles`/`listModules` with `archived: true`; feature off gives `FeatureOffState` | default pages |
| `projects/archives/page.tsx` | `listProjects({archived:true})` in a reading `PanelPage` | default page |
| `cycles/[cycleId]/page.tsx`, `modules/[moduleId]/page.tsx` | Aliases for `cycle:` / `module:` links: `getCycle`/`getModule` then `redirect` to the project route (outside the try) | default pages |

### Components (`src/components/planning/`)

| File | Responsibility | Key exports |
|---|---|---|
| `types.ts` | Shared view models | `ItemCandidate`, `CycleDetailData`, `ModuleDetailData`, `ProgressTarget` |
| `CyclesScreen.tsx`, `CycleRow.tsx`, `ActiveCycleSummary.tsx` | Cycles list: sections via `groupCycles`, summary card of the current cycle with chart, rows with progress bar and menu | `CyclesScreen`, `CycleRow`, `cycleRowDescription`, `ActiveCycleSummary` |
| `CycleDetailScreen.tsx`, `CycleHeader.tsx`, `CycleSidePanel.tsx` | Cycle detail frame: sub-header (status, range, days left, Add existing, panel toggle, menu), read-only line, 360px progress panel | `CycleDetailScreen`, `CycleHeader`, `CycleSidePanel` |
| `CycleMenu.tsx`, `CycleDialog.tsx`, `TransferDialog.tsx` | Menu (edit, transfer, archive, restore, delete), create/edit dialog with overlap pre-check, transfer of open items | `CycleMenu`, `failureText`, `CycleDialog`, `TransferDialog`, `NO_CYCLE` |
| `ModulesScreen.tsx`, `ModuleRow.tsx` | Modules list and row (status, lead, range, progress) | `ModulesScreen`, `ModuleRow` |
| `ModuleDetailScreen.tsx`, `ModuleHeader.tsx`, `ModuleSidePanel.tsx` | Module detail; optimistic inline writes | `ModuleDetailScreen`, `useModuleWriter`, `ModuleWriter`, `ModuleHeader`, `ModuleSidePanel` |
| `ModuleMenu.tsx`, `ModuleDialog.tsx`, `ModuleLinks.tsx`, `LeadControl.tsx` | Menu, create/edit dialog and status control, links list with add/edit/remove, lead picker | `ModuleMenu`, `ModuleDialog`, `ModuleStatusControl`, `ModuleStatusLabel`, `ModuleLinks`, `LeadControl`, `EditableModule` |
| `AddExistingItemsDialog.tsx` | Shared "Add existing work items" for cycles and modules (filter, checkboxes, 500-row cap via `MAX_ROWS`) | `AddExistingItemsDialog`, `eligibleCandidates`, `matchesFilter` |
| `ProgressPanel.tsx`, `BreakdownTabs.tsx` | Shared progress block: completed bar, state-group rows, points, tabs for state/assignee/label | `ProgressPanel`, `CompletedBar`, `StateGroupRows`, `formatOfTotal`, `BreakdownTabs` |
| `BurndownChart.tsx`, `chart-colors.ts` | Recharts burndown/burnup (renders only after hydration, summary sentence as name, "Data table" toggle); colours resolved from theme tokens | `BurndownChart`, `CHART_TOKENS`, `resolveChartColors`, `useChartColors` |
| `burndown.ts` | Pure chart model and wording | `buildChartModel`, `idealSeries`, `paceOf`, `paceSentence`, `todayLabelPosition`, `summarizeChart`, `effectiveUnit`, `formatNumber`, `formatAmount` |
| `cycle-format.ts` | Cycle labels, sections, dates, menu entries, transfer targets and text, overlap helpers | `CYCLE_STATUS_LABEL`, `groupCycles`, `cycleStatusOn`, `cycleActions`, `transferTargets`, `transferText`, `rangeOverlaps`, `isDayTaken`, `localIsoDate`, `daysLeftLabel` |
| `module-format.ts` | Module labels, status variants, menu entries, progress text, form diff | `MODULE_STATUS_LABEL`, `canArchiveModule`, `moduleActions`, `moduleProgressValues`, `moduleDateError`, `changedModuleFields`, `sameMembers`, `isHttpUrl` |
| `panel-prefs.ts` | Remembered panel state in `localStorage` (`tessera.planningPanel.v1`) through `useSyncExternalStore` | `PanelPrefs`, `parsePanelPrefs`, `savePanelPrefs`, `usePanelPrefs` |
| `FeatureOffState.tsx` | Empty state for a feature turned off | `FeatureOffState` |
| `ArchivesTabs.tsx`, `archive-rules.ts` | Archive tab strip and pure rules | `ArchivesTabs`, `archiveTabs`, `activeArchiveKind`, `canArchiveWorkItem`, `ARCHIVE_OPEN_ITEM_REASON`, `confirmsDelete`, `failureText` |
| `ArchivedWorkItems.tsx`, `ArchivedCycles.tsx`, `ArchivedModules.tsx` | Archive lists with Restore and Delete (AlertDialog) | same names |
| `ArchivedProjects.tsx`, `ProjectArchive.tsx`, `DeleteProjectDialog.tsx` | Archived projects list and "Archived projects" link; project menu, banner and restore hook; typed-identifier delete dialog | `ArchivedProjects`, `ArchivedProjectsLink`, `ProjectMenu`, `ProjectArchivedBanner`, `useRestoreProject`, `DeleteProjectDialog` |

### Styles (`src/components/styles/`, imported once from `src/app/globals.css`)

| File | Classes |
|---|---|
| `planning.css` | `tessera-planning-{row-end,cycle-bar,detail-bar,detail-title,side-panel,row-bar,tabpanel,chart-frame,chart-swatch,data-table}`; side panel capped at `max-width: 100%` |
| `modules.css` | `tessera-modules-{row,row-count,row-bar,description,links}` |
| `archives.css` | `tessera-archives-tabs` (pulled in 12px so the first tab sits on the 16px inset), `tessera-archives-projects` |

## 3. Data and control flow

### Read path
1. A route `page.tsx` is a sync default export wrapping an async child in `<Suspense fallback={<…Skeleton/>}>`.
2. The child awaits `params`/`searchParams`, calls `await io()`, validates ids with `IdSchema.safeParse` (bad id calls `notFound()`), then runs one `readTessera(ctx => …)`: `getProject`, `listCycles`/`getCycle`/`getCycleProgress`, `listModules`/`getModule`, `listWorkItems` (candidates, archived items), `listProjects`.
3. `NOT_FOUND` and `VALIDATION` from the engine map to `notFound()`; an entity whose `project_id` differs from the URL also maps to `notFound()`. Other errors rethrow.
4. `getProject(...).cycles_enabled` / `modules_enabled` false makes the loader return `null`; the page renders `FeatureOffState` and skips the other reads.
5. `ctx.today()` (server local date, decision 6) travels as a prop (`data.today`, `today`) so server and client render the same days left and chart marker. `cycle-data.loadCycleDetail` adds points progress only with `hasActiveEstimate`.
6. Detail pages stream `ScopedWorkItems` inside a second Suspense; the cycle or module settings scope (`settingsScope`) stores layout and display (decision 23).
7. Client screens also read the project bundle from `useProject()` (`bundle.cycles` for overlap checks and transfer targets, `bundle.modules`, states, actors).
8. External writes (MCP) arrive through the shell's change polling (decision 12), which triggers a refresh of the open page.

### Write path
1. A client component calls a wrapper from `src/app/actions/{cycles,modules,projects,work-items}.ts`, each `toolAction("<tool>")` (decision 26). Cycles: `createCycleAction`, `updateCycleAction`, `archiveCycleAction`, `unarchiveCycleAction`, `deleteCycleAction`, `addWorkItemsToCycleAction`, `transferCycleWorkItemsAction`. Modules: create, update, archive, unarchive, delete, `addWorkItemsToModuleAction`, `setModuleMembersAction`, add/update/remove link. Projects: archive, unarchive, delete. Work items: `unarchiveWorkItemAction`, `deleteWorkItemAction`.
2. `_run.runTool` validates input against the registry schema, runs the tool as actor `user`, then calls `refresh()` for mutating tools. It never throws: the caller gets `{ ok: true, data, cursor }` or `{ ok: false, code, message, details }`.
3. Callers run it in `useTransition`, then toast: `toast({type:"info"})` on success, `toast({type:"error", body: failureText(...)})` on failure (`CycleMenu.failureText`, `archive-rules.failureText`).
4. Cycle create/edit: `CycleDialog` pre-checks overlap with `rangeOverlaps` and `isDayTaken` against `bundle.cycles`; an engine `CONFLICT` or `VALIDATION` is shown on the date field.
5. Transfer: `TransferDialog` offers `transferTargets(bundle.cycles, id)` plus `NO_CYCLE`, calls `transferCycleWorkItemsAction({cycle_id, to_cycle_id})` and toasts `result.data.moved`. The engine freezes `progress_snapshot` on the first transfer (`freezeSnapshot`).
6. Module inline edits (status, lead, dates, members) go through `useModuleWriter`: `useOptimistic` plus `startTransition`, only changed fields sent (`changedInline`), toast on failure (reverts).
7. Deleting calls `forgetRecentsUnder(path)` (cycle, module, work item routes, `/projects/<id>`), and `DeleteProjectDialog` also calls `forgetLastProject`. Archiving a project calls `forgetRecentsUnder` then `router.push("/projects/archives")`.
8. Dialogs come from `@/components/shell/dialogs` and carry an `aria-label` equal to their title; forms mount only while `isOpen`.

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
| Archived module or project takes no writes (`ARCHIVED`) | 7 | engine `loadWritableModule`, `loadWritableProject`; UI hides Add existing, links edit, `canCreate=false` | modules.test.ts "archived project" |
| Many modules per work item; module dates `target_date >= start_date` | 9 | engine `createModule`/`updateModule`; UI `moduleDateError` | modules.test.ts; module-format.test.ts |
| Cycle and module routes of another project are not found | none |  page `project_id !== projectId` check, then `notFound()` | acceptance steps (ui.md "Acceptance (P3)") |
| Feature off hides routes, tab and archive tab | 5 | `FeatureOffState`; `archive-rules.archiveTabs`; `project-tabs.projectTabs` | archive-rules.test.ts; project-tabs.test.ts |
| Only completed or cancelled work items can be archived | 7 | `archive-rules.canArchiveWorkItem` (used by `WorkItemDetail`), engine refuses otherwise | archive-rules.test.ts |
| Deleting a project needs the typed identifier | 7 | `archive-rules.confirmsDelete` in `DeleteProjectDialog` | archive-rules.test.ts |
| Progress numbers: completed over (total - cancelled), the same on rows, summary card and panel | 21 | `module-format.moduleProgressValues`, `CompletedBar`, `burndown.scopeOf` | module-format.test.ts; burndown.test.ts |
| Burndown/burnup: ideal line from scope to zero; pace tolerance max(1, 5% of scope); scope = total - cancelled | 16 | `burndown.idealSeries`, `paceOf`, `buildChartModel` | tests/ui/burndown.test.ts |
| Points mode only with an active estimate; otherwise work items | 16 | `cycle-data.hasActiveEstimate`, `burndown.effectiveUnit` | burndown.test.ts "points and the issues fallback" |
| Chart colours come from theme tokens, lines differ by dash as well as colour | 19, 22 | `chart-colors.CHART_TOKENS`, `useChartColors` | tests/ui/chart-colors.test.ts; tests/themes/catppuccin-contrast.test.ts |
| Breakdown rows sorted by total desc, then id | 21 | engine `cycles.breakdownRows` | cycles.test.ts (id tie-break pinned) |
| Recents: drop a deleted route and its children; aliases, project index and archives index are never recorded | 15 | `recents-store.forgetRecentsUnder`, `recents.isTransientPath`, `recents.resolveRoute` labels | recents.test.ts, recents-store.test.ts |
| Display settings for a cycle or module stored per scope | 23 | `ScopedWorkItems settingsScope` | tests/view-settings.test.ts |
| Items do not join or leave an archived module or a completed/archived cycle through lists or board | 16 | `quick-add.openMemberships`, `acceptsGroupMove`, `BoardLayout.acceptsDrop` | tests/ui/quick-add.test.ts |
| Dates and "today" use the server local date, never `Date.now()` in render | 6 | `ctx.today()` passed as prop; `cycle-format.localIsoDate` for pickers | cycle-format.test.ts |
| Every mutating service export is bound by exactly one tool; UI writes go through wrappers | 26 | `toolAction`, registry | tests/registry.test.ts |

## 5. Tests that guard this area

| File | Covers |
|---|---|
| tests/cycles.test.ts (1128 lines) | Engine: create, derived status, list/get, update, reorder, archive/restore, add/remove items, transfer and snapshot, progress and breakdown, active cycles, delete |
| tests/modules.test.ts (788) | Engine: create/list, get, update, reorder, archive/restore, members, add/remove items, progress, delete, links, archived project |
| tests/ui/cycle-format.test.ts | Labels, sections, dates, overlap helpers, `cycleActions`, `transferTargets`, `transferText` |
| tests/ui/module-format.test.ts | Status labels and variants, archivable statuses, range, progress numbers, `moduleActions`, `moduleDateError`, `changedModuleFields`, helpers |
| tests/ui/archive-rules.test.ts | `canArchiveWorkItem`, `confirmsDelete`, `archiveTabs`, `activeArchiveKind`, `failureText` |
| tests/ui/burndown.test.ts | `idealSeries`, `buildChartModel` (burndown, burnup, empty cases, today), pace, points fallback |
| tests/ui/chart-colors.test.ts | Token names and resolution |
| tests/ui/panel-prefs.test.ts | `parsePanelPrefs` and the store (stored value, no re-read, corrupt value) |
| tests/ui/planning-a11y.test.ts | Dialog names, archive rows, panel toggle states, sub-headers and banners of the list and detail screens |
| tests/ui/dialog-names.test.ts | `aria-label` on the work item, project and link dialogs |
| tests/ui/dialog-teardown.test.ts | Dialogs close when a route is hidden |
| tests/ui/project-tabs.test.ts | Project frame tabs follow the feature toggles |
| tests/ui/recents.test.ts, recents-store.test.ts | Labels of cycles, modules, archives, aliases, `projectIdFromPath`, forget on delete |
| tests/ui/quick-add.test.ts | Open memberships and closed groups in scoped lists and boards |
| tests/ui/peek-url.test.ts | Power K work item hit opens a peek only where a host is mounted |
| tests/ui/{moves,work-items-screen,detail-smoke,property-controls}.test.ts | Neighbouring screens that use cycles and modules |
| tests/{registry,projects,view-settings,counts,filters}.test.ts | Tool binding, project archive, settings scopes, counts |

No test renders `BurndownChart`, `CycleDialog` submit, `TransferDialog` submit or the archive list restore flows. Those were checked in the browser (17-step acceptance in ui.md).

## 6. Extension points for later phases

- Feature toggles: P4 settings call `updateProjectFeaturesAction` (to be wrapped from `update_project_features`); `FeatureOffState` copy ("Project settings arrive in P4") must change then; `archive-rules.archiveTabs` and `project-tabs.projectTabs` already react.
- Views and filters for lists: P4 can add search/sort/filter to `CyclesScreen`/`ModulesScreen` (they use engine order today) and to `ArchivedWorkItems` (plain `List`; the `archived` view_settings scope is unused).
- Read-only UI for archived projects: `ProjectArchivedBanner` and `ProjectMenu` exist; controls stay enabled today (engine returns `ARCHIVED`).
- Progress and charts: `ProgressPanel` (props `chart`, `isFrozen`, `includesArchived`) is shared by `CycleSidePanel` and `ModuleSidePanel`; a module burndown (P9) can pass a `chart` node. `buildChartModel(BuildChartInput)` accepts a scope series only through `progress`, so a per-day scope series (P9) needs a new field.
- Panel state: `savePanelPrefs(patch)` and `usePanelPrefs()` (key `tessera.planningPanel.v1`).
- Add existing: `AddExistingItemsDialog` takes `onAdd(ids) => Promise<boolean>` and a `ProgressTarget`; a bulk bar (P8) can reuse `eligibleCandidates`.
- Menus: `cycleActions` / `moduleActions` return entries with `id`; add an id to `CycleActionId` or `ModuleActionId`, then the handler map in `CycleMenu`/`ModuleMenu`.
- Dialog status for module: `ModuleStatusControl` is reusable by gallery or timeline layouts (P9, P10).
- Entity labels and recents: `registerEntityLabel(id, name)`; `forgetRecentsUnder(path)` after any delete or archive of a routed entity.
- Peek on archive lists: `PeekHost` + `loadPeek` + `peekHref`, `notePeekPush` (pattern in `ArchivedWorkItems`).
- Power K / shortcuts: `n c` and `n m` push `?create=1`, `g r` goes to Archives, `g c`/`g m` to lists.
- Alias routes: add the same pattern for any new link scheme (`page:` arrives in P6).
- Favourites (`mod+f`), `/active-cycles` page (engine `getActiveCycles`, tool `list_active_cycles`), reorder UI (`reorder_cycle`, `reorder_module`): P9.

## 7. Known debt and quirks

File budget (scripts/file-budget.json at HEAD): `src/lib/tessera/cycles.ts` 925, `src/lib/tessera/db/schema.ts` 857, `src/lib/tessera/modules.ts` 735 (actual: 879 and 691 lines for the two engine files). No file in `src/components/planning` is listed or near 600 lines; the largest is `ModuleDialog.tsx` (290). Cycles and modules in the engine may not grow.

Deferred (ui.md P3 "Scope and deferrals" and "As built"):
- Module gallery and timeline layouts (P9, P10); module burndown (P9); favourites, reorder UI, `/active-cycles` (P9); "Copy link" and module shortcuts `s`, `m` (P9).
- Burnup scope is a flat line (`total - cancelled`); a per-day scope series needs analytics (P9).
- Search, sort, filter on cycles and modules lists and on Archives > Work items (P4).
- Feature toggle settings UI (P4); stale `view_settings` and saved filters left when a cycle or module is deleted (P4, ignored by the engine).
- Estimates UI and real points use (P8). Row action "Remove from cycle/module" in the scoped list (P8); an item leaves through its Cycle or Modules property.
- Entity activity feeds for cycles and modules (P5); `deleteModule` logs no row per detached item.
- Manual start/stop and parallel cycles: never (decision 16).

Quirks:
- Dialogs must come from `@/components/shell/dialogs` (lint-enforced). Raw Astryx Dialog leaves the next page inert when Next hides a route; the BottomSheet presentation on touch screens is not covered; focus after Back goes to `<body>`.
- `aria-label` on each form dialog is required because Astryx names a dialog only when the element attaches.
- The panel toggle is disabled with a tooltip while a peek is open (`isPanelBlocked`); the peek takes the panel's place.
- `failureText` exists twice (`CycleMenu`, `archive-rules`) with different signatures.
- Candidates are capped at 500 (`CANDIDATE_LIMIT`, duplicated in the module page) and archived work items at 2000; the dialog shows at most 500 rows (`MAX_ROWS`).
- A transfer only applies to completed cycles with open items; "Restore" of a cycle can fail with `CONFLICT` if its dates are taken now.
- The module page re-declares candidate loading instead of sharing `cycle-data.ts`.
- No `instant = false` is needed on any P3 page (acceptance step 15).

Open issues in docs/PLAN-STATUS.md (layout rework merge section, "Open, not fixed") that touch this area:
- Full detail page inside the project frame has two `h1`s.
- At 375px the project tabs show no cue that they scroll.
- The burnup chart's "Scope" label sits on the dotted line near the right end.
- A cycle route with an unknown id while cycles are off is recorded as "<project> · Cycle".
- An archived project's work items list still shows enabled controls (read-only UI is P4).
- App anchors carry a stray `to` attribute (Astryx `LinkProvider` with `next/link`); waits for an upstream fix.
- Dev-only console noise tolerated: the two Astryx Table `ContextMenu` warnings.

## 8. Where to read more

- docs/contracts/ui.md, "## P3: cycles, modules, archives", subsections: "Scope and deferrals", "Routes and data loading", "Lane A: engine additions", "Shared planning pieces", "Cycles (E1)", "Burndown and burnup chart (E1)", "Modules (E2)", "Archives (E3)", "Icons, CSS and conventions (all lanes)", "Integration (E4)", "Acceptance (P3)", "As built (integration, 2026-10-11)", "As built (fix round 1, 2026-10-11)", "As built (fix round 2, 2026-10-11)", "As built (review fixes, 2026-10-11)", "As built (layout rework merge, 2026-10-11)".
- docs/contracts/service-api.md "P3 additions (lane A)"; docs/contracts/tools.md "P3 changes"; docs/contracts/schema.md "Cycles" and "Modules".
- docs/PLAN.md: decisions 5, 6, 9, 15, 16, 21, 23, 26 and section 13 (Archives tab in the project panel header).
- docs/PLAN-STATUS.md: "P3 (integration, 2026-10-11)", "Layout rework merge (2026-10-11)".
- docs/field-guide/index.md: Next 16 (Cache Components), Astryx and theme, Shell.
