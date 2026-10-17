## P4: views, settings, counts

Draft by the phase planner, 2026-10-17, on `main` at `1b663c8`. To be appended to
docs/contracts/ui.md after review. Engine details: docs/drafts/p4-service-api.md and
docs/drafts/p4-tools.md (lane A copies them into docs/contracts/service-api.md and
tools.md). PLAN.md and OWNERS.md edits: docs/drafts/p4-plan-notes.md. Facts come
from docs/drafts/p4-research.md (file:line sources there); every Astryx prop named
here was re-read in `node_modules/@astryxdesign/core/dist/<Name>/<Name>.d.ts` on
2026-10-17 ("API verification" at the end).

Five lanes. **Lane 0** (splits and prep) runs first and alone; then **A** (engine),
**F1** (views), **F2** (project settings) and **F3** (integration: grouping,
tabs, recents, Power K, read-only archived projects, P3 leftovers) start together.
Workers are Sonnet: when this section and the code disagree, the worker follows
this section, keeps the smallest change that makes the wording true and marks it
`ASSUMPTION:` in its report (docs/process/swarm.md).

### Carried items (not P4 work)

- `npm run astryx -- doctor`: the documented `theme-fonts` warning stays.
- Tolerated dev-console entries: the two Astryx `Table` `tableContextMenu` warnings
  (`moveTo`; `start`/`cancel` props) and React's occasional "negative time stamp"
  performance error. Nothing else.
- `npm run lint` keeps the 3 pre-existing warnings in `src/app/page-body.tsx`.

### Scope and deferrals

Ships in P4:
- Project views: list (search by name, manual order with Move up/down), create
  (dialog, or "Save view" from the work items list), view page (the work items
  list in the view's layout with its filters and display), unsaved edits held in
  the URL with "Update view", "Save as new view" and "Reset", edit name and
  description, duplicate ("Copy of …"), lock and unlock, delete, `n v` / `g v`,
  view hits in Power K, recents.
- Project settings under a Settings tab: General (name, identifier rename,
  description, logo, archive and delete), Features (cycles, modules, views),
  States, Labels, Agents (intake policy, default assignee, actor names and
  colours).
- Engine: the partial-display bug (GAP 1), retired identifiers for `/browse`
  (GAP 2), `reorder_view` (GAP 3), one-call sub-grouped board drops (GAP 4),
  saved-filter cleanup on delete (GAP 5), taxonomy usage counts (GAP 6), view
  search hits (GAP 9), feature toggles refuse creates (GAP 10, ui.md P3 row 23),
  `sub_group_by` normalisation and empty sub-groups (GAP 12).
- Multi-valued grouping on the board (an item in two label columns drags as two
  independent cards) and sub-groups as collapsible board swimlanes; the
  multi-valued None-drop rule (decision 30).
- Sidebar counts proven equal to `getCounts` (Vitest plus acceptance), view row
  counts from `getCounts({ type: "view" })`.
- P3 leftovers: read-only UI for archived projects; "Manual" twice in Order by;
  `formatShortDate`'s argless `new Date()`; cycle and module pickers offering
  closed targets (pinned by tests); PLAN.md §10 missing the P3 routes.

| Deferred | Phase | Note |
|---|---|---|
| Workspace views (`/workspace-views`), the four static views, view favourites (star) | P9 | Engine has workspace views already; `search_all` returns them, Power K says "Workspace views arrive in P9" |
| View logo picker (icon and colour) | P9 (with favourites) | Rows draw `view.logo` when an agent set one (MCP `update_view`) |
| Views list sort and filter controls beyond name search; search, sort and filter on the cycles and modules lists (P3 deferral) | P9 | Manual order (`sort_order`) |
| Pointer drag to reorder views, states and labels | P10 (remaining settings) | P4 reorders with "Move up" / "Move down" menu items |
| Changing a state's group by drag | P10 | `state_group` stays immutable (engine) |
| Per-agent write permission (`actor.access`, research GAP 7) | P8 (with intake policy) | Needs a migration; `db/schema.ts` is on the file budget and must be split first |
| Actor activity feed (`list_activity` by `actor_id`, GAP 8) | P9 (agent profiles) | |
| Estimates tab; the Intake and Estimates switches | P8 | Shown disabled with "Arrives in P8" |
| The Pages switch | P6 | Shown disabled with "Arrives in P6" |
| Automations tab | P10 | Engine fields exist (`archive_in_months`, `close_in_months`) |
| Timezone | P10 (remaining settings) | Decision 6: today is the server's local date |
| Cover image, access, sharing, publishing | never | U8 (no attachments, single user) |
| Rich filter tree (AND/OR/NOT) evaluation (GAP 10 drift) | P10 | P4 documents `rich_filters` as stored only |
| Group counts beyond the loaded page (GAP 11), list paging | P11 (10k items pass) | Lists load 2000 rows; headers count the loaded rows |
| Sidebar project drag (`reorderProject`) and the sidebar project "…" menu | P9 (sidebar pass) | |
| Power K key search by a retired identifier | P9 | `/browse/OLD-n` and `work:OLD-n` links resolve in P4 |
| Filters, display and layouts on Archives › Work items (P3 deferral) | P8 (with the bulk bar) | |
| View export | P10 (exports) | |
| Sub-groups in the List layout | not planned | Plane documents sub-groups for the board only |
| Engine refusal for pages and intake toggles | P6 / P8 | Their features do not exist yet |

Exit criteria (docs/PLAN.md §9 P4) and where they are proven:
- Views round-trip: Vitest `tests/views.test.ts` "round-trip" and
  `tests/work-items.test.ts` "view scope keeps saved display keys"; acceptance
  steps 12–14 and 17.
- Counts match `getCounts`: Vitest `tests/counts.test.ts` "listProjects counts
  equal getCounts"; acceptance steps 2, 13 and 20.
- Identifier rename keeps `/browse`: Vitest `tests/projects.test.ts` "retired
  identifier"; acceptance step 4.

### Decisions added by P4 (lane A writes them into docs/PLAN.md, see docs/drafts/p4-plan-notes.md)

- **29 Retired identifiers.** After a project's identifier changes, `/browse/OLD-n`,
  `work:OLD-n` links and `get_project("OLD")` resolve through the newest
  `identifier` activity row whose `old_value` is `OLD`, unless a non-deleted
  project holds `OLD` now (the live holder always wins). No alias table, no
  migration.
- **30 Multi-valued group moves.** For labels, assignees and modules a move removes
  `from_value` and adds `value`, keeping the other values; a drop into None
  (`value` null or `"none"`) clears the field. On the board each copy of an item
  in several columns is its own drag source.
- **31 Feature toggles.** Turning cycles, modules or views off hides their tab,
  Power K entries, group-by, sub-group-by and filter options, and makes the
  engine refuse `create_cycle`, `create_module`, `create_view` and
  `duplicate_view` (project views) with `RULE feature_disabled`. Reads, existing
  data and memberships stay.
- **32 Saved views.** Changes made on a view's page live only in the URL `q` until
  "Update view"; views have no `view_settings` scope (decision 23 does not apply
  to them). Deleting a state, label, cycle or module strips its id from every
  saved view (locked ones too) and every `view_settings` row.

### Lane split and file ownership

Order: **lane 0** alone (one Sonnet worker, effort high). The root planner runs the
gate on it and commits it on its own ("The split commits on its own",
docs/process/swarm.md). Then **A, F1, F2 and F3** start together in the shared
checkout, as in P3: a lane edits only the files in its row; a file another lane
owns is read, never written. UI lanes never stub `src/lib/tessera/**`. Each UI
lane's steps that need lane A are marked **[needs A]** and come last in its list;
lane A lands its public signatures first (its step A0), so a UI lane that reaches
an **[needs A]** step before A0 is in does its other steps first and re-checks. No
UI-to-UI stubs are expected (lane 0 lands every shared UI type). If one is needed
anyway, the P3 rule applies with the first line `// STUB(P4): replaced by lane <X>`,
and `grep -rn "STUB(P4)" src` must be empty at the gate.

`icons.tsx`, `globals.css`, the two new stylesheets, `types.ts` and
`scripts/file-budget.json` (except lane A's final lowering of two entries) are done
by lane 0; no other lane edits them.

| Lane | Creates | Edits (only these) | Must not touch |
|---|---|---|---|
| 0 splits and prep | `src/lib/tessera/tools/registry/{index,shared,projects,states,labels,actors,work-items,links,cycles,modules,views,meta}.ts`; `src/lib/tessera/work-items/{index,model,hydrate,read,membership,create,update,move,transfer,lifecycle}.ts`; `src/lib/tessera/{cycle-dates,module-links}.ts`; `src/components/shell/ShortcutsDialog.tsx`; `src/components/work-items/optimistic-list.ts`; `src/components/styles/{views,project-settings}.css` (header comment only) | deletes `src/lib/tessera/tools/registry.ts` and `src/lib/tessera/work-items.ts`; `src/lib/tessera/{cycles,modules}.ts` (the moved blocks only); `src/components/shell/CommandBar.tsx` (the moved dialog only); `src/components/work-items/WorkItemsScreen.tsx` (the moved reducer only); `src/components/work-items/types.ts`; `src/app/(tessera)/projects/[projectId]/layout.tsx` and `src/app/(tessera)/work-items/load-detail.ts` (`today`); tests that build a `ProjectBundle` (add `today`); `src/themes/catppuccin/icons.tsx`; `src/app/globals.css`; `scripts/file-budget.json`; path mentions in `docs/contracts/*.md` | any behaviour; every test assertion |
| A engine | `src/lib/tessera/saved-filters.ts` | `src/lib/tessera/work-items/{read,move}.ts`, `src/lib/tessera/{projects,views,view-settings,states,labels,cycles,modules,counts,search,types,filters}.ts`, `src/lib/tessera/tools/registry/{projects,states,labels,work-items,cycles,modules,views,meta}.ts` (the new tool and the description texts of docs/drafts/p4-tools.md), `tests/{work-items,projects,views,view-settings,states,labels,cycles,modules,counts,search,filters,registry}.test.ts`, `docs/contracts/{service-api,tools,schema}.md` (append the drafts), `docs/PLAN.md` (the edits in docs/drafts/p4-plan-notes.md), `docs/contracts/OWNERS.md` (same), `scripts/file-budget.json` (lower the `cycles.ts` and `modules.ts` entries to their final line counts at hand-off) | `src/app/**`, `src/components/**`, migrations, `db/schema.ts` |
| F1 views | `src/app/(tessera)/projects/[projectId]/views/page.tsx`, `views/[viewId]/page.tsx`, `views/[viewId]/view-list.tsx`; `src/components/views/{ViewsScreen,ViewRow,ViewMenu,ViewDialog,ViewBar,SaveViewButton}.tsx`; `src/components/views/view-state.ts`; `src/components/work-items/display-options.ts`; `tests/ui/{view-state,display-options}.test.ts` | `src/app/actions/views.ts`; `src/components/work-items/{WorkItemsScreen,DisplayMenu}.tsx`, `src/components/work-items/quick-add.ts`; `src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx` (one prop); `src/components/planning/FeatureOffState.tsx` and its six call sites (`projects/[projectId]/{cycles,cycles/[cycleId],modules,modules/[moduleId],archives/cycles,archives/modules}/page.tsx`, one prop each); `src/components/styles/views.css`; `tests/ui/{work-items-screen,quick-add}.test.ts` | `optimistic-list.ts`, layouts, `src/components/shell/**`, `src/lib/tessera/**` |
| F2 settings | `src/app/(tessera)/projects/[projectId]/settings/{layout,page}.tsx`, `settings/{general,features,states,labels,agents}/page.tsx`; `src/components/project-settings/{SettingsTabs,GeneralSettings,FeaturesSettings,StatesSettings,StateDialog,DeleteStateDialog,LabelsSettings,LabelDialog,AgentsSettings,ActorDialog,PaletteColorSelector}.tsx`; `src/components/project-settings/{settings-tabs,identifier,palette-labels,sibling-moves}.ts`; `src/app/actions/settings.ts`; `tests/ui/{settings-tabs,project-identifier,sibling-moves}.test.ts` | `src/app/actions/states-labels.ts`; `src/components/planning/ProjectArchive.tsx`; `src/components/shell/entity-labels.ts` (one additive export); `src/components/styles/project-settings.css`; `tests/ui/entity-labels.test.ts` | `src/components/work-items/**`, other shell files, `src/lib/tessera/**` |
| F3 integration | `src/components/work-items/board-keys.ts`; `tests/ui/{board-keys,optimistic-list}.test.ts` | `src/components/work-items/{BoardLayout,ListLayout,TableLayout,ProjectFrame}.tsx`, `src/components/work-items/{moves,optimistic-list,project-tabs}.ts`; `src/components/work-items/properties/{CycleControl,ModuleControl,DateControl}.tsx`, `properties/{membership-rules,date-format}.ts`; `src/components/shell/{recents,shell-icons,shortcuts,useShortcuts,command-source}.ts`, `src/components/shell/CommandBar.tsx`; `src/components/detail/{peek-url.ts,WorkItemDetail.tsx}`; `src/components/planning/{CyclesScreen,ModulesScreen,CycleDetailScreen,ModuleDetailScreen,BurndownChart}.tsx`, `src/components/planning/{cycle-format,module-format,burndown}.ts`; `src/components/styles/{board,work-items}.css` (lane rules); `src/components/shell/Sidebar.tsx` (only if acceptance shows a stale count); `tests/ui/{project-tabs,project-frame,recents,shortcuts,peek-url,moves,property-controls,cycle-format,module-format,burndown}.test.ts` | `WorkItemsScreen.tsx`, `DisplayMenu.tsx`, `quick-add.ts`, `ProjectArchive.tsx`, `src/lib/tessera/**` |

Who decides what (no two lanes decide one question): the engine's move, search
and refusal rules are A's; the URL-held view state, the Display menu and quick-add
defaults are F1's; settings screens and the project menu are F2's; how the board,
list and table draw and drop (including read-only), navigation, recents and Power
K are F3's. `WorkItemsScreen` (F1) computes `readOnly` and passes it in
`LayoutProps`; the layouts (F3) honour it.

#### Lane 0: splits and prep (runs alone)

Moves are verbatim: no renamed functions, no changed behaviour, no test assertion
changed. Gate for lane 0: `npm run check` green (tsc, lint, Vitest, conventions,
licences, theme) and `wc -l` of every new file at most 600.

0.1 **Registry split.** `src/lib/tessera/tools/registry.ts` (1259 lines) becomes the
folder `src/lib/tessera/tools/registry/`; every importer keeps importing
`.../tools/registry` (moduleResolution `bundler` resolves the folder's
`index.ts`; importers today: `src/lib/tessera/{index,types}.ts`,
`src/app/actions/_run.ts`, `scripts/mcp-call.ts`, `tests/{registry,mcp,mcp-stdio}.test.ts`).
- `shared.ts`: the "Shared input pieces and result shapes" block (`ProjectId` …
  `LinkIdInput`, `EmptyInput`, `ProjectIdInput`, `GetProjectInput`, `DeleteResult`,
  `RemoveResult`, `deleted`, `removed`, `toListResult`), each exported.
- One file per domain block, exporting its array under the same name:
  `projects.ts` (`projectTools`), `states.ts` (`stateTools`), `labels.ts`
  (`labelTools`), `actors.ts` (`actorTools`), `work-items.ts` (`workItemTools` with
  `GetWorkItemByKeyInput`, `SetLabelsToolInput`, `SetModulesToolInput`,
  `SetAssigneesToolInput`, `ListArchivedWorkItemsInput`), `links.ts` (`linkTools`),
  `cycles.ts` (`cycleTools`, `CycleWorkItemsInput`), `modules.ts` (`moduleTools`,
  `ModuleWorkItemsInput`, `SetModuleMembersToolInput`), `views.ts` (`viewTools`,
  `SaveViewSettingsToolInput`), `meta.ts` (`metaTools`).
- `index.ts`: the file's doc comment, the "Registry" block (`TOOLS` in the same
  order, `Tool`, `ToolName`, `ToolByName`, `ToolInput`, `ToolOutput`, `ToolResult`,
  `ListToolsOptions`, `registry`, `getTool`, `listTools`, `runToolWithContext`) and
  `export type { DeleteResult, RemoveResult } from "./shared"`. `index.ts` exports
  exactly the names the old file exported, no more: `src/lib/tessera/index.ts`
  re-exports it with `export *`.
- Domain files import services from `../../<module>` and define/describe helpers
  from `../define` and `../describe-filters`.

0.2 **Work items split.** `src/lib/tessera/work-items.ts` (1719 lines) becomes the
folder `src/lib/tessera/work-items/` (importers keep `./work-items`), cut at its
section comments (line numbers as of `1b663c8`):

| File | Old lines | Content |
|---|---|---|
| `model.ts` | 74–368 | `export type { Group }`, view models (`WorkItem`, `WorkItemDetail`, `ListResult`, `WorkItemListResult`, `WorkItemIntake`), the constants (`WORK_ITEM_NAME`, `DESCRIPTION`, `MAX_IDS`, `CHUNK`, `ENTITY`), row helpers, cross-project validation |
| `hydrate.ts` | 370–491 | hydration (`itemQuery` … `listLinks`, `loadWorkItem`, `listSubscriberIds`) |
| `read.ts` | 493–706 | reads (`getWorkItem`, `getWorkItemByKey`, `listChildren`, `ListScopeSchema`, `ListWorkItemsInput`, `resolveScope`, `listWorkItems`) |
| `membership.ts` | 708–885 | junction rows, `SetLabelsInput`, `SetModulesInput`, `setLabels`, `setModules`, `touch` |
| `create.ts` | 887–1109 | create and intake |
| `update.ts` | 1111–1279 | update, bulk update, description |
| `move.ts` | 1281–1428 | `MoveWorkItemInput`, `applyGroupChange`, `moveWorkItem` |
| `transfer.ts` | 1430–1641 | copy and move between projects |
| `lifecycle.ts` | 1643–1719 | archive, restore, delete |

Private helpers a sibling needs become named exports of their file. `index.ts`
holds the old header comment and **explicit** named re-exports of exactly the
names `work-items.ts` exports today (`grep -n '^export' src/lib/tessera/work-items.ts`
before the move); never `export *` from a sibling, because the barrel feeds
`src/lib/tessera/index.ts` (`export * from "./work-items"`) and
`tests/registry.test.ts` scans it for the mutation prefix (`touch`,
`addSubscribers` and other helpers must stay out of the barrel).

0.3 **cycles.ts and modules.ts make room.** Move the "Dates and overlap" block of
`cycles.ts` (lines 132–177: `dateIssue`, `checkDates`, `assertNoOverlap`) verbatim
into `src/lib/tessera/cycle-dates.ts` (exports `checkDates`, `assertNoOverlap`;
`cycles.ts` imports them). Move the "Links" block of `modules.ts` (lines 703–735:
`AddModuleLinkInput` … `removeModuleLink`) into `src/lib/tessera/module-links.ts`;
`modules.ts` re-exports all seven names in one statement
(`export { AddModuleLinkInput, UpdateModuleLinkInput, addModuleLink, updateModuleLink, removeModuleLink, type AddModuleLinkInputType, type UpdateModuleLinkInputType } from "./module-links";`)
so the registry and its test see them unchanged. Drop imports that become unused.
Neither new file is exported from `src/lib/tessera/index.ts`.

0.4 **CommandBar.tsx.** Move `kbdKeys`, `ShortcutKeys`, `GROUP_ORDER`, `EXTRA_GLOBAL`
and `ShortcutsDialog` (lines 547–end) into `src/components/shell/ShortcutsDialog.tsx`
(`"use client"`, exports `ShortcutsDialog`); `CommandBar.tsx` imports it.

0.5 **WorkItemsScreen.tsx.** Move the pure optimistic helpers (`NONE_GROUP_ID`,
`STATE_GROUPS`, `isStateGroup`, `OptimisticAction`, `StateGroupOf`,
`stripUndefined`, `groupValues`, `targetsOf`, `placeIn`, `regroupItem`, `reorder`,
`applyGroupValue`, `realNeighbour`) and the body of the `useOptimistic` reducer into
`src/components/work-items/optimistic-list.ts` (no directive). It exports
`OptimisticAction`, `realNeighbour` and
`reduceOptimisticList(state: WorkItemListResult, action: OptimisticAction, deps: { display: Display; stateGroupOf: (stateId: string) => string | undefined; firstStateByGroup: ReadonlyMap<StateGroup, State> }): WorkItemListResult`.
`WorkItemsScreen` calls `useOptimistic(result, (state, action) => reduceOptimisticList(state, action, { display, stateGroupOf, firstStateByGroup }))`.

0.6 **Shared UI types** (`src/components/work-items/types.ts`):
- `ProjectBundle` gains `today: string` ("server local date at load, decision 6;
  `formatShortDate` reads it"). Every builder sets `today: ctx.today()`: the
  project layout and the two bundles in `work-items/load-detail.ts` (`tsc` lists any
  other); test fixtures that build a bundle add `today: "2026-10-17"`.
- `LayoutProps` gains `readOnly?: boolean` ("archived project: no create, no drag,
  read-only controls; default false").
- `MoveInput` gains `sub_group_by?: GroupBy; sub_value?: string | null; sub_from_value?: string | null`.
- `ScopeDefaults` becomes `{ cycle_id?: string; module_ids?: string[]; state_id?: string; priority?: Priority; label_ids?: string[]; assignee_ids?: string[] }`.

0.7 **Icons** (`src/themes/catppuccin/icons.tsx`): after the `Triangle,` import add
`// P4 views and settings.` and `ArrowUUpLeft, FloppyDisk, LockSimple, LockSimpleOpen, Robot, Stack, ToggleRight, Tray`;
exports `ViewIcon = duotoneIcon(Stack)`, `LockIcon = duotoneIcon(LockSimple)`,
`UnlockIcon = duotoneIcon(LockSimpleOpen)`, `SaveIcon = duotoneIcon(FloppyDisk)`,
`ResetIcon = duotoneIcon(ArrowUUpLeft)`, `FeaturesIcon = duotoneIcon(ToggleRight)`,
`IntakeIcon = duotoneIcon(Tray)`, `AgentIcon = duotoneIcon(Robot)`,
`MoveUpIcon = duotoneIcon(ArrowUp)`, `MoveDownIcon = duotoneIcon(ArrowDown)` (ArrowUp
and ArrowDown are already imported). All eight Phosphor names exist in
`node_modules/@phosphor-icons/react/dist/csr/` (research).

0.8 **Stylesheets.** `src/components/styles/views.css` and `project-settings.css`
with a one-line header comment; `src/app/globals.css` appends
`@import "../components/styles/views.css";` and
`@import "../components/styles/project-settings.css";`.

0.9 **File budget.** In `scripts/file-budget.json` remove the entries of
`src/lib/tessera/tools/registry.ts` and `src/lib/tessera/work-items.ts` (deleted)
and of `src/components/shell/CommandBar.tsx` (now under 600). Leave
`src/lib/tessera/cycles.ts` at 925 and `src/lib/tessera/modules.ts` at 735: lane A
adds a few lines to each inside that room and lowers both entries to the final
counts at its hand-off. `db/schema.ts` stays at 857 (P4 adds no column).

0.10 **Docs.** Replace the paths `src/lib/tessera/tools/registry.ts` and
`src/lib/tessera/work-items.ts` in `docs/contracts/*.md` with the folder paths
(text only). The reconciler updates the field guide's "File budget" line at the end
of the phase.

### Routes and data loading

| Route | File (lane) | Reads |
|---|---|---|
| `/projects/[projectId]/views` | `src/app/(tessera)/projects/[projectId]/views/page.tsx` (F1) | one `readTessera`: `getProject`; when `views_enabled`: `listViews(ctx, { project_id })` and, per view, `getCounts(ctx, { type: "view", view_id }).total` |
| `/projects/[projectId]/views/[viewId]` | `.../views/[viewId]/page.tsx` (F1) + `view-list.tsx` (F1) | `getProject`, `getView`; then `ViewWorkItems` reads `listWorkItems` (scope view) and the peek |
| `/projects/[projectId]/settings` | `.../settings/page.tsx` (F2) | none: after `await params` it redirects to `/projects/<projectId>/settings/general` |
| (layout) | `.../settings/layout.tsx` (F2) | none: a copy of `archives/layout.tsx` with `PanelHeader label="Settings"` and `<SettingsTabs projectId>` |
| `/projects/[projectId]/settings/general` | `.../settings/general/page.tsx` (F2) | none (the project comes from `useProject()`) |
| `/projects/[projectId]/settings/features` | `.../settings/features/page.tsx` (F2) | none |
| `/projects/[projectId]/settings/states` | `.../settings/states/page.tsx` (F2) | `getTaxonomyUsage(ctx, projectId).states` **[needs A]** |
| `/projects/[projectId]/settings/labels` | `.../settings/labels/page.tsx` (F2) | `getTaxonomyUsage(ctx, projectId).labels` **[needs A]** |
| `/projects/[projectId]/settings/agents` | `.../settings/agents/page.tsx` (F2) | none (actors and project from `useProject()`) |

- Every page with reads follows the P3 pattern ("Routes and data loading" in P3):
  sync default export → `<Suspense fallback={…}>` → async child that awaits
  `params` / `searchParams`, `await io()`, `IdSchema.safeParse` → `notFound()`, one
  `readTessera` in a `try` (`NOT_FOUND` / `VALIDATION` → `notFound()`), `redirect()`
  outside the `try`. A view whose `project_id !== projectId` → `notFound()`.
- Pages without reads render their client screen directly; the project layout has
  already validated the project and loaded the bundle (`states`, `labels`,
  `actors`, `project` are current after every `refresh()`).
- `views_enabled` off: both views routes render
  `<FeatureOffState feature="views" projectId={projectId} />` and skip the other
  reads. The settings routes ignore toggles.
- Each new page adds `export const instant = false` when the dev validator reports
  an insight for it (P3 rule); the lane names it in its hand-off. Acceptance step
  21 walks the sibling navigations.
- `?create=1` on `/views` opens the New view dialog once and is then dropped with
  `router.replace` (what `n v` pushes).
- Fallbacks: the views list uses a `ListSkeleton`-like `Skeleton` stack of four
  rows; the view page uses `ListSkeleton` from `scoped-list.tsx`; the
  states/labels pages use five `Skeleton height={36}` rows.

### Lane A: engine additions

All of it is in docs/drafts/p4-service-api.md (A0–A11) and docs/drafts/p4-tools.md.
What the UI lanes rely on, by name:

| Name | Used by |
|---|---|
| `listWorkItems` scope `{ type: "view", view_id }` with a full `display` and `filters` (works before and after A1) | F1 `view-list.tsx` |
| `reorderViewAction` → `reorder_view` `{ view_id, before_id? , after_id? }` | F1 `ViewsScreen` **[needs A]** |
| `move_work_item` `{ sub_group_by, sub_value, sub_from_value }`, None clears (decision 30) | F3 `moves.ts`, `optimistic-list.ts` **[needs A]** |
| `SearchType` `"view"`, hits `{ type: "view", id, project_id }` | F3 `command-source.ts`, `CommandBar.tsx` **[needs A]** |
| `getTaxonomyUsage(ctx, projectId): { states, labels }` | F2 states and labels pages **[needs A]** |
| `RULE feature_disabled`, `RULE state_not_empty`, `CONFLICT` | F1/F2 toasts and field statuses |
| `getProject("OLD")`, `getWorkItemByKey("OLD-1")` after a rename | `/browse` (no UI change), acceptance step 4 |

### Views (F1): `src/components/views/`, the views routes, the work items screen

#### Pure helpers: `src/components/views/view-state.ts` (no directive)

```ts
export type ViewState = { filters: Filters; display: Display };
/** Drops keys whose value is undefined, null, "" or []; sorts every string array (filters are "any of" sets). */
export function normalizeFilters(filters: Filters): Filters;
/** JSON with object keys sorted at every level; arrays keep their order (after normalizeFilters). */
export function stableJson(value: unknown): string;
/** True when the effective state differs from the saved one (decision 32). */
export function isViewModified(saved: ViewState, effective: ViewState): boolean;
/** Quick-add and dialog defaults implied by a view's filters. */
export function viewScopeDefaults(filters: Filters): ScopeDefaults;
/** "Board · grouped by State · 2 filters" for a row without a description. */
export function viewSummary(view: Pick<View, "filters" | "display">): string;
```
- `isViewModified`: `stableJson(normalizeFilters(saved.filters)) !== stableJson(normalizeFilters(effective.filters)) || stableJson(saved.display) !== stableJson(effective.display)`.
  Both displays are complete (`mergeDisplay(DEFAULT_DISPLAY, …)` from
  `url-state.ts`). The FilterBar writes `[]` / `""` for a removed token
  (`withExplicitClears`); `normalizeFilters` makes that equal to "no key".
- `viewScopeDefaults`: `state` with exactly one id → `state_id`; `priority` with
  exactly one → `priority`; `cycle` with exactly one → `cycle_id`; `labels` →
  `label_ids`, `assignees` → `assignee_ids`, `module` → `module_ids` (all ids). Any
  other filter adds nothing.
- `viewSummary`: layout label (`list` "List", `board` "Board", `table` "Table",
  `calendar` "Calendar", `gantt` "Gantt"), then " · grouped by <label>" when
  `group_by` is set (labels: a `Record<GroupBy, string>` in this file, the same
  words as DisplayMenu's group labels), then " · 1 filter" / " · N filters"
  (normalised keys) or " · no filters".
- Tests `tests/ui/view-state.test.ts`: `[]` and `""` equal a missing key; id order
  does not matter; a display order or property change is a modification; the
  defaults table above; three summary strings.

#### Pure helpers: `src/components/work-items/display-options.ts` (no directive)

```ts
export function orderByChoices(): { value: OrderBy; label: string }[];
export function subGroupChoices(display: Display, project: Pick<Project, "cycles_enabled" | "modules_enabled">, hidden: readonly GroupBy[]): { value: SubGroupBy | null; label: string }[];
export function groupByPatch(display: Display, next: GroupBy | null): DisplayPatch;
```
- `orderByChoices` ("Manual" once, P3 leftover): `sort_order` "Manual";
  `-created_at` "Created (newest first)", `created_at` "Created (oldest first)";
  `-updated_at` "Updated (newest first)", `updated_at` "Updated (oldest first)";
  `priority` "Priority (urgent first)", `-priority` "Priority (none first)";
  `start_date` "Start date (earliest first)", `-start_date` "Start date (latest
  first)"; `target_date` "Target date (earliest first)", `-target_date` "Target
  date (latest first)"; `name` "Name (A–Z)", `-name` "Name (Z–A)"; `sequence_id`
  "Key (oldest first)", `-sequence_id` "Key (newest first)"; `estimate` "Estimate
  (smallest first)", `-estimate` "Estimate (largest first)". `-sort_order` is not
  offered (a stored `-sort_order` still applies and reads "Manual"). Values not in
  `ORDER_BY_VALUES` are skipped, so the list follows the schema.
- `subGroupChoices`: `null` "None" first, then `SubGroupBySchema.options` minus
  `display.group_by`, minus `hidden`, minus `cycle` when cycles are off and
  `module` when modules are off, labelled like the group labels.
- `groupByPatch`: `{ group_by: next }`, plus `sub_group_by: null` when `next` is
  null or equals `display.sub_group_by`.
- Tests `tests/ui/display-options.test.ts`: "Manual" exactly once; a
  `-sort_order` display keeps the Manual label; sub-group choices drop the group
  field and turned-off features; `groupByPatch` clears the sub-group.

#### `DisplayMenu.tsx` and `LayoutSwitch` (F1)

- `settingsScope: SettingsScope | null` on `LayoutSwitch`, `DisplayMenu` and
  `useDisplayWriter`. `null` = URL only: `apply()` writes the `q` display patch and
  saves nothing; `reset()` removes `display` from `q` (filters kept) and the menu
  item reads "Reset to view". With a scope, behaviour is unchanged ("Reset to
  defaults").
- The Order by `Selector` takes `orderByChoices()`; the Sub-group `Selector` (board
  only, as today) takes `subGroupChoices(...)`; changing Group by applies
  `groupByPatch(display, value)`.

#### `WorkItemsScreen.tsx` (F1)

New and changed props (all optional; existing callers unchanged):

```ts
settingsScope?: SettingsScope | null;  // undefined → { "project", projectId } as today; null → URL-only (a view)
titleAdornment?: ReactNode;            // after the count Badge in the sub-header start (the view's lock icon)
subheaderEnd?: ReactNode;              // last item of the sub-header end, after "New work item" (the view's menu)
filtersEnd?: ReactNode;                // the filters PanelBar's end slot (ViewBar)
saveView?: boolean;                    // show SaveViewButton in the filters row end (project list only)
```
- `readOnly = bundle.project.archived_at !== null` (P3 leftover). When true:
  "New work item", the `c` hotkey, `?create=1` and quick-add are off (as
  `canCreate={false}`), `SaveViewButton` is hidden, and every layout gets
  `readOnly` in `LayoutProps`; `onMove`, `onUpdate` and `onQuickAdd` return early.
- `SaveViewButton` renders when `saveView && bundle.project.views_enabled && !readOnly && (Object.keys(normalizeFilters(filters)).length > 0 || urlState.display !== undefined)`;
  `filtersEnd` wins when both are given.
- "New work item" passes `createDefaultsFromScope(scopeDefaults)` (quick-add.ts) to
  the create dialog, so a view's filters prefill it as a cycle list prefills its
  cycle.
- Tests `tests/ui/work-items-screen.test.ts`: with `settingsScope={null}` a display
  change calls no `saveViewSettingsAction`; with an archived project bundle there is
  no "New work item" button and the layout receives `readOnly`.

#### `quick-add.ts` (F1)

- `withScopeDefaults` applies the widened `ScopeDefaults` after the group's own
  field: `state_id`, `priority` and `cycle_id` only when the group did not set them
  (`??=`); `label_ids`, `assignee_ids` and `module_ids` united with the group's
  value (no duplicates).
- `export function createDefaultsFromScope(scope: ScopeDefaults | undefined): Partial<Omit<CreateWorkItemInputType, "project_id">> | undefined`
  maps the same fields one to one (`undefined` for an empty or missing scope).
- Tests `tests/ui/quick-add.test.ts`: a labels group plus view labels unite; a
  state group keeps its state over a view's single state; priority from the view
  when the group is not priority.

#### `scoped-list.tsx` (F1, one prop)

`ScopedWorkItems` passes `saveView={scope.type === "project"}` to `WorkItemsScreen`.
Nothing else changes; views have their own loader (`view-list.tsx`).

#### `FeatureOffState.tsx` (F1)

- Props `{ feature: "cycles" | "modules" | "views"; projectId: string }`. Titles
  "Cycles are turned off for this project" / "Modules …" / "Views …"; description
  "Turn them on in Settings › Features."; `actions` = secondary sm `Button`
  "Open Features settings" with `href={`/projects/${projectId}/settings/features`}`.
- The six existing call sites pass `projectId` (they have it from `params`).

#### Views list: `views/page.tsx` → `ViewsScreen`

```ts
export type ViewsScreenProps = { projectId: string; views: View[]; counts: Record<string, number>; createOnOpen: boolean };
```
- `PanelPage width="full"` (as `CyclesScreen`): sub-header `PanelBar
  size="subheader"`; start: `Heading level={4} accessibilityLevel={2}` "Views" and
  the count `Badge variant="purple"` (number of views); end: `TextInput size="sm"
  label="Search views" isLabelHidden placeholder="Search views" hasClear`
  (class `tessera-views-search`) and the primary sm `Button` "New view"
  (`PlusIcon`; hidden when `readOnly`).
- Rows: `List density="compact" hasDividers` of `ViewRow`, filtered by a
  case-insensitive name match. Empty project: `EmptyState` title "No views yet",
  description "Save filters and display options as a view.", actions the New view
  button. No match: `EmptyState isCompact` "No views match".
- `?create=1` (`createOnOpen`) opens `ViewDialog` (title "New view") once and drops
  the param with `router.replace`.
- `readOnly = useProject().bundle.project.archived_at !== null`: no "New view", no
  `?create=1`, row menus disabled.

`SaveViewButton` props `{ projectId: string; filters: Filters; display: Display }`:
secondary sm `Button` "Save view" (`SaveIcon`) that opens `ViewDialog mode="create"
title="Save view" initial={{ filters: normalizeFilters(filters), display }}`.

`ViewRow.tsx` also exports `ViewLockIndicator()`: the `Tooltip` and lock `Icon`
below, used by the row and as the view page's `titleAdornment`.

`ViewRow` props `{ projectId: string; view: View; count: number; previousId?: string; nextId?: string; canReorder: boolean }`:
`ListItem href={`/projects/${projectId}/views/${view.id}`}`, `startContent`
`<Icon icon={view.logo ? resolveLogoIcon(view.logo.icon) : ViewIcon} color={view.logo?.color ?? "secondary"} size="sm" />`,
`label` the name, `description` `view.description` (first line) or
`viewSummary(view)`, `endContent` an `HStack gap={2}` of: the lock indicator when
locked (`Tooltip content="Locked: unlock to edit"` around
`<Icon icon={LockIcon} color="secondary" size="sm" label="Locked" />`), the count
`Text type="supporting" color="secondary" hasTabularNumbers` "N work items"
("1 work item"), and `ViewMenu`. `canReorder` is false while the search field has
text.

#### `ViewMenu` (row and view header)

Props `{ projectId: string; view: View; placement: "row" | "header"; previousId?: string; nextId?: string; canReorder?: boolean }` (`previousId` / `nextId`: the neighbouring rows' ids in the shown order).
`MoreMenu label="View actions" size="sm" alignment="end"`, `isDisabled` when the
project is archived. Items in order:
1. "Edit…" (`PencilIcon`): `ViewDialog` mode edit; `isDisabled` with description
   "Unlock the view to edit it" while locked.
2. "Duplicate" (`CopyIcon`): `duplicateViewAction({ view_id })` → Toast
   `Duplicated as ${copy.name}` → `router.push` to the copy.
3. "Lock view" (`LockIcon`) / "Unlock view" (`UnlockIcon`): `lockViewAction` /
   `unlockViewAction`.
4. Row placement and `canReorder` only: "Move up" (`MoveUpIcon`, `isDisabled`
   without `previousId`) → `reorderViewAction({ view_id, after_id: previousId })`;
   "Move down" (`MoveDownIcon`, `isDisabled` without `nextId`) →
   `reorderViewAction({ view_id, before_id: nextId })`. One neighbour only
   (engine adjacency rule). **[needs A]**
5. `{ type: "divider" }`, then "Delete…" (`TrashIcon`, `variant: "destructive"`;
   `isDisabled` with "Unlock the view to delete it" while locked): `AlertDialog`
   title `Delete ${view.name}?`, description "The saved filters and display are
   removed. Work items are not affected.", `actionLabel="Delete"` →
   `deleteViewAction({ view_id })` → `forgetRecentsUnder(`/projects/${projectId}/views/${view.id}`)`,
   Toast `Deleted ${view.name}`, and in the header placement `router.push` to the
   views list.

Every failure shows a Toast `Could not <verb> ${view.name}: <message>` (`LOCKED`,
`ARCHIVED`, `RULE feature_disabled`).

#### `ViewDialog`

```ts
export type ViewDialogProps = {
  isOpen: boolean; onOpenChange: (isOpen: boolean) => void; projectId: string;
  mode: "create" | "edit";
  title: string;            // "New view" (list), "Save view" (SaveViewButton), "Save as new view" (ViewBar), `Edit ${view.name}` (ViewMenu)
  view?: View;              // edit
  initial?: ViewState;      // create from Save view / Save as new view; absent = no filters and the default display
};
```
Structure of `CreateProjectDialog`: `Dialog purpose="form" width={520}`
(from `@/components/shell/dialogs`) with `aria-label={title}`. `Layout` header `DialogHeader title={title}
hasDivider`, `LayoutContent` with `FormLayout`, `LayoutFooter` with ghost "Cancel"
and primary "Create view" / "Save". Fields: `TextInput label="Name" isRequired
hasAutoFocus` (trimmed, 1–120; `CONFLICT` → `status={{ type: "error", message: "A view with this name exists" }}`),
`TextArea label="Description" isOptional rows={3} maxLength={2000}`. With
`initial`: a `Text type="supporting"` line "Uses the current filters and display."
Create → `createViewAction({ project_id, name, description, filters: normalizeFilters(initial.filters), display: initial.display })`
→ `router.push` to the new view (no Toast). Edit →
`updateViewAction({ view_id, name, description })` with changed fields only →
Toast "Saved". Other errors: `FieldStatus type="error"` under the form.

#### View page: `views/[viewId]/page.tsx` and `view-list.tsx`

```ts
// view-list.tsx (async Server Component, no directive, like scoped-list.tsx)
export async function ViewWorkItems({ projectId, view, query }: { projectId: string; view: View; query: Record<string, string | string[] | undefined> }): Promise<React.JSX.Element>
```
1. `urlState = decodeUrlState(q)`;
   `saved = { filters: view.filters, display: mergeDisplay(DEFAULT_DISPLAY, view.display) }`;
   `effective = { filters: mergeFilters({}, view.filters, urlState.filters), display: mergeDisplay(DEFAULT_DISPLAY, view.display, urlState.display) }`.
2. `await io()`; `readTessera((ctx) => listWorkItems(ctx, { scope: { type: "view", view_id: view.id }, filters: effective.filters, display: effective.display, limit: 2000 }))`;
   `NOT_FOUND` / `VALIDATION` → `notFound()`. The peek through `loadPeek`.
3. Renders `<PeekHost projectId peek>` around `WorkItemsScreen` with
   `display={effective.display}`, `filters={effective.filters}`,
   `settingsDisplay={saved.display}`, `settingsScope={null}`,
   `scopeDefaults={viewScopeDefaults(effective.filters)}`, `title={view.name}`,
   `createOnOpen={query.create === "1"}`,
   `titleAdornment={view.is_locked ? <ViewLockIndicator /> : undefined}`,
   `subheaderEnd={<ViewMenu projectId view placement="header" />}` and
   `filtersEnd={<ViewBar projectId view isModified={isViewModified(saved, effective)} effective={effective} />}`.

`ViewBar` (`"use client"`) props `{ projectId: string; view: View; isModified: boolean; effective: ViewState }`:
- Always: `registerEntityLabel(view.id, view.name)` in an effect (recents label).
- Not modified: renders nothing else.
- Modified (`HStack gap={2}`): `StatusDot variant="accent" label="Unsaved changes" tooltip="Filters or display differ from the saved view"`,
  `Text type="supporting" color="secondary"` "Modified"; ghost sm `Button`
  "Reset" (`ResetIcon`) → `router.replace` to the path without `q` (keeping
  `peek`); secondary sm "Save as new view" → `ViewDialog mode="create"
  initial={effective}`; primary sm "Update view" →
  `updateViewAction({ view_id, filters: normalizeFilters(effective.filters), display: effective.display })`
  → on success `router.replace` without `q`. While locked, "Update view" has
  `isDisabled` and `tooltip="Unlock the view to update it"` (Button then uses
  `aria-disabled`). Archived project: only "Reset" shows.

#### Modified-state rules (decision 32)

- The saved state is the view row; the URL `q` holds every unsaved change. The
  layout switch, Display, filters, Reset to view and the FilterBar all write `q`
  only (`settingsScope={null}`); nothing writes `view_settings` for a view.
- Leaving the page discards the changes (the URL goes with it); Back returns to
  them. A reload keeps them (same URL).
- "Update view" replaces the filters and merges the display, then drops `q`;
  "Save as new view" creates a view from the effective state and opens it (the
  source keeps its saved state); "Reset" drops `q`.
- A locked view still accepts local changes (Plane is silent; Tessera allows them)
  and offers "Save as new view"; Update, Edit and Delete stay disabled.
- An MCP `update_view` while the page is open arrives with the change poller: the
  saved state changes under the URL changes, and `isModified` is recomputed on the
  server.

#### `src/app/actions/views.ts` (F1)

Add the seven wrappers listed in docs/drafts/p4-tools.md ("Server Action
wrappers"); `reorderViewAction` is **[needs A]**.

#### `views.css` (F1)

`.tessera-views-search { width: min(calc(var(--spacing-12) * 4), 40vw); }` (tokens
only). Rows inherit the 16px inset from `List`
inside `PanelPage` as the cycles list does.

### Project settings (F2): `src/components/project-settings/`, the settings routes

#### Frame

- `settings/layout.tsx` is `archives/layout.tsx` with `PanelHeader label="Settings"`
  and `<SettingsTabs projectId={projectId} />` in the sub-header's `start`;
  content `LayoutContent padding={0} isScrollable` holding
  `<VStack className="tessera-reading tessera-settings-body" gap={6}>{children}</VStack>`
  (the 960px reading column of `PanelPage width="reading"`).
- `settings/page.tsx`: `redirect(`/projects/${projectId}/settings/general`)` after
  `await params` (an `IdSchema` miss → `notFound()`), like `archives/page.tsx`.
- `settings-tabs.ts` (no directive):
  `export type SettingsTabKey = "general" | "features" | "states" | "labels" | "agents";`
  `export const SETTINGS_TABS: readonly { key: SettingsTabKey; label: string }[]` in
  that order with labels "General", "Features", "States", "Labels", "Agents";
  `export function activeSettingsTab(pathname: string, projectId: string): SettingsTabKey | null`
  (the segment after `/projects/<id>/settings/`). Test `tests/ui/settings-tabs.test.ts`.
- `SettingsTabs` (`"use client"`): `TabList aria-label="Project settings"
  value={active ?? "general"} onChange={() => {}} size="sm" layout="hug"
  className="tessera-settings-tabs"` with `Tab value={key} label={label}
  href={`/projects/${projectId}/settings/${key}`}` (navigation pattern, no
  `panelId`, as `ArchivesTabs`).
- No page adds a heading row: the tab names the screen. A list screen's primary
  action sits in an `HStack justify="end"` above its list.
- Archived project (`bundle.project.archived_at !== null`): every input,
  selector, switch and menu on these screens is disabled (`isDisabled`;
  `disabledMessage="Restore the project to change it"` where the component has
  one); the frame's archived Banner explains why. The danger zone's "Restore
  project" stays enabled.
- `project-settings.css`: `.tessera-settings-tabs` and its
  `.tessera-panel-bar-start:has(> …)` rule copy the two `tessera-archives-tabs`
  rules of `archives.css`; `.tessera-settings-body { padding-block: var(--spacing-5) var(--spacing-8); }`;
  `.tessera-settings-child { padding-inline-start: var(--spacing-6); }` (nested
  label rows).

#### Shared pieces

- `palette-labels.ts`: `export const PALETTE_COLOR_LABELS: Record<PaletteColor, string>`
  (`red` "Red", `orange` "Orange", `yellow` "Yellow", `green` "Green", `teal`
  "Teal", `cyan` "Cyan", `blue` "Blue", `purple` "Purple", `pink` "Pink", `gray`
  "Gray").
- `PaletteColorSelector` (`"use client"`): props
  `{ label: string; value: PaletteColor; onChange: (value: PaletteColor) => void; isDisabled?: boolean; size?: "sm" | "md" }`
  → `Selector` over `PaletteColorSchema.options` with
  `renderOption` and `renderValue` = `<Token label={PALETTE_COLOR_LABELS[v]} color={v} size="sm" />`
  (CreateProjectDialog's pattern).
- `sibling-moves.ts` (no directive):
  `export function siblingMove(siblingIds: readonly string[], id: string, direction: "up" | "down"): { after_id: string } | { before_id: string } | null`
  — up → `{ after_id: <previous id> }`, down → `{ before_id: <next id> }`, `null`
  at an edge or for an unknown id. One neighbour only, because states and labels
  are shown grouped while the engine's adjacency check reads the flat order.
  Test `tests/ui/sibling-moves.test.ts`.
- `identifier.ts` (no directive): `export function sanitizeIdentifier(input: string): string`
  (upper-case, drop everything but `A–Z0–9`, cap 12, as `CreateProjectDialog`) and
  `export function identifierError(value: string): string | null`
  ("Use 2–12 letters or digits, starting with a letter" unless
  `PROJECT_IDENTIFIER_PATTERN` matches). Test `tests/ui/project-identifier.test.ts`.

#### General (`GeneralSettings`)

- `FormLayout` with: `TextInput label="Name" isRequired`; `TextInput
  label="Identifier" isRequired` (onChange through `sanitizeIdentifier`,
  `status` from `identifierError`, `CONFLICT` → "Another project uses <ID>",
  description "Work items are keyed like <ID>-12."); while the identifier differs
  from the saved one a `Banner status="info" container="section"` title `Keys
  become ${next}-12` and description `Old ${saved}- links and /browse addresses
  keep working.`; `TextArea label="Description" isOptional rows={4}`
  (`description_md`); an `HStack gap={3}` of a `Selector label="Icon"` over
  `PROJECT_LOGO_ICON_NAMES` (each option a `Token` with
  `icon={<Icon icon={resolveLogoIcon(name)} />}`, as CreateProjectDialog) and a
  `PaletteColorSelector label="Colour"`.
- Footer `HStack justify="end"`: primary `Button` "Save changes", `isDisabled`
  until a field changed and while invalid, `isLoading` while pending →
  `updateProjectAction({ project_id, ...changedFields })` → Toast "Project
  saved". When the identifier changed, also
  `renameEntityLabelKeys(saved, next)` (below).
- Danger zone: `Heading level={5}` "Danger zone" and `<ProjectDangerZone project={bundle.project} />`.

`ProjectArchive.tsx` (F2):
- Extract the archive, restore and delete state and dialogs of `ProjectMenu`
  into a file-local hook `useProjectActions(project)` returning
  `{ items, dialogs }` pieces both components render.
- `ProjectMenu` items start with
  `{ id: "settings", label: "Project settings", icon: GearIcon, href: `/projects/${project.id}/settings/general` }`
  and a `{ type: "divider" }`, then Archive or Restore, Delete… as today.
- New `export function ProjectDangerZone({ project }: ProjectMenuProps)`: a
  `List hasDividers` of two `ListItem`s: "Archive project" (description "It leaves
  the sidebar and becomes read-only until restored.", `endContent` secondary sm
  `Button` "Archive" / "Restore" when archived) and "Delete project" (description
  "Deletes its work items, cycles, modules and views.", `endContent` destructive
  sm `Button` "Delete project…"), with the same dialogs and side effects as the
  menu.

`entity-labels.ts` (F2, additive):
`export function withRenamedKeys(labels: ReadonlyMap<string, string>, oldIdentifier: string, newIdentifier: string): ReadonlyMap<string, string>`
(labels starting with `${old}-<digits> ` get `${new}-` instead) and
`export function renameEntityLabelKeys(oldIdentifier: string, newIdentifier: string): void`
(reads, rewrites and writes `tessera.entityLabels.v1` like `registerEntityLabel`).
Test in `tests/ui/entity-labels.test.ts`. Other tabs of the browser keep the old
labels until they navigate (accepted).

#### Features (`FeaturesSettings`)

`List hasDividers density="balanced"`; one `ListItem` per feature with `label`,
`description`, `startContent` icon and `endContent`
`<Switch label={label} isLabelHidden size="sm" value={…} changeAction={…} ref={rowRef} />`
plus `interactiveRef={rowRef}` (the P3 checkbox row pattern):

| Feature | Icon | Description | Switch |
|---|---|---|---|
| Cycles | `CycleIcon` | "Time-boxed iterations with burndown and burnup." | `cycles_enabled` |
| Modules | `ModuleIcon` | "Group work items into larger pieces of work." | `modules_enabled` |
| Views | `ViewIcon` | "Saved filters and display options." | `views_enabled` |
| Pages | `PageIcon` | "Documents for the project." | `isDisabled`, `disabledMessage="Pages arrive in P6"` |
| Intake | `IntakeIcon` | "Review work items from agents before they enter the project." | `isDisabled`, `disabledMessage="Intake arrives in P8"` |
| Estimates | `SlidersIcon` | "Points or sizes on work items." | `isDisabled`, `disabledMessage="Estimates arrive in P8"` |

`changeAction(next)` → `updateProjectFeaturesAction({ project_id, [key]: next })`;
on `{ ok: false }` a Toast `Could not change <Feature>: <message>` (the Switch
reverts). Turning a feature off hides its tab, Power K items and options at once
(the bundle refreshes); the data stays (decision 31).

#### States (`StatesSettings`, page passes `usage: Record<string, number>`)

- One `List density="compact" hasDividers` per group in the order backlog,
  unstarted, started, completed, cancelled (triage is never shown), from
  `bundle.states` in their order. `List header`: an `HStack gap={2}` of
  `StatusDot variant={stateGroupVariant(group)} label={groupLabel}`, `Text
  weight="medium"` group label ("Backlog", "Unstarted", "Started", "Completed",
  "Cancelled"), and a ghost sm `IconButton label={`Add ${groupLabel} state`}
  icon={PlusIcon}` → `StateDialog` create.
- Row (`ListItem`, no `href`): `startContent`
  `<Icon icon={StateIcon} color={state.color} size="sm" />`, `label` the name,
  `description` the state's description, `endContent` an `HStack gap={2}` of a
  `Token label="Default" size="sm"` when `is_default`, `Text type="supporting"
  color="secondary" hasTabularNumbers` "N work items", and a `MoreMenu
  label={`Actions for ${state.name}`} size="sm" alignment="end"`:
  "Edit…" (`PencilIcon`), "Set as default" (`isDisabled` when default) →
  `setDefaultStateAction({ state_id })`, "Move up" / "Move down" (`MoveUpIcon` /
  `MoveDownIcon`, `siblingMove` over the group's ids, `isDisabled` at an edge) →
  `reorderStateAction({ state_id, ...move })`, divider, "Delete…" (`TrashIcon`,
  destructive; `isDisabled` with description "The default state can't be
  deleted" for the default, "Each group keeps at least one state" for a group's
  only state).
- `StateDialog` props `{ isOpen; onOpenChange; projectId: string; group: StateGroup; state?: State }`:
  `Dialog purpose="form" width={480} aria-label={title}` (title `New
  ${groupLabel} state` or `Edit ${state.name}`); `TextInput label="Name"
  isRequired hasAutoFocus` (`CONFLICT` → "A state with this name exists"),
  `PaletteColorSelector label="Colour"` (create default `gray`), `TextArea
  label="Description" isOptional rows={2}`; footer Cancel and "Create state" /
  "Save" → `createStateAction({ project_id, name, state_group: group, color, description })`
  or `updateStateAction({ state_id, ...changed })`.
- Delete with `usage[id] ?? 0` of 0: `AlertDialog` title `Delete ${name}?`,
  description "This can't be undone.", `actionLabel="Delete"` →
  `deleteStateAction({ state_id })`. With N > 0: `DeleteStateDialog` props
  `{ isOpen; onOpenChange; state: State; count: number }`: `Dialog
  purpose="form" width={480} aria-label={`Delete ${state.name}?`}`, text `${N} work
  item(s) are in ${name}, archived ones included. Move them to:`, `Selector
  label="Move to"` with one `{ type: "section", title: groupLabel, options }` per
  group (every other non-triage state; default value the project's default state),
  footer Cancel and destructive `Button` "Delete state" →
  `deleteStateAction({ state_id, move_to_state_id })`. Errors (`RULE
  state_not_empty` when usage was stale, and the others) → Toast.

#### Labels (`LabelsSettings`, page passes `usage: Record<string, number>`)

- Above the list: primary sm `Button` "New label" (`PlusIcon`) → `LabelDialog`
  create.
- One `List density="compact" hasDividers`: each top-level label (`parent_id`
  null, bundle order) followed by its children, a child row carrying
  `className="tessera-settings-child"`. Empty: `EmptyState isCompact` "No labels
  yet".
- Row: `startContent` `<Icon icon={TagIcon} color={label.color} size="sm" />`,
  `label` the name, `endContent` "N work items" (as states) and a `MoreMenu`:
  "Edit…", "Add sub-label" (top-level rows only; `LabelDialog` create with
  `parentId`), "Move to" (`items` submenu: "Top level" for a child, then every other
  top-level label; the whole submenu `isDisabled` with "Labels with sub-labels stay
  top level" for a parent that has children) → `updateLabelAction({ label_id, parent_id })`,
  "Move up" / "Move down" (`siblingMove` over its siblings: the top-level labels or
  the parent's children) → `reorderLabelAction`, divider, "Delete…" →
  `AlertDialog` title `Delete ${name}?` and description `Removes it from N work
  items and from saved views.` plus ` Its K sub-labels are deleted too.` when it
  has children → `deleteLabelAction({ label_id })`.
- `LabelDialog` props `{ isOpen; onOpenChange; projectId: string; label?: Label; parentId?: string | null }`:
  `TextInput label="Name"` (`CONFLICT` → "A label with this name exists"),
  `PaletteColorSelector label="Colour"`, `Selector label="Parent"` ("None" plus the
  top-level labels other than itself; disabled for a label with children) → 
  `createLabelAction({ project_id, name, color, parent_id })` or
  `updateLabelAction({ label_id, ...changed })`.

#### Agents (`AgentsSettings`)

- "Intake policy": a `List hasDividers` with one `ListItem` "Agents submit through
  Intake", description "Work items created by MCP clients wait in Intake until you
  accept them.", `endContent` `Switch` on `agent_intake_required` (row pattern as
  Features), `isDisabled` with `disabledMessage="Turn on Intake first (arrives in
  P8)"` while `intake_enabled` is false → `updateProjectFeaturesAction`.
- "Default assignee": `Selector label="Default assignee" description="New work items
  without an assignee get this actor."` with options "Nobody" (`__none__`) and every
  actor except `system` (`user` "You", the assistant, agents by name) →
  `updateProjectAction({ project_id, default_assignee_id: v === "__none__" ? null : v })`.
- "Actors": a `List density="compact" hasDividers` of actors except `system`:
  `startContent` `<Avatar name={actor.name} size="sm" />`, `label` the name,
  `description` "You" (user), "Built-in assistant" (assistant), or
  `${actor.client_name ?? "MCP client"} · last active ` + `<RelativeTime>`
  (`@/components/detail/RelativeTime`) or "never" (agents); `endContent` a `Token
  size="sm"` "You" / "Assistant" / "Agent" and, for agents, a `MoreMenu` "Edit…" →
  `ActorDialog` (`TextInput label="Name"`, `PaletteColorSelector label="Colour"`)
  → `updateActorAction({ actor_id, ...changed })`.
- Under the list: `Text type="supporting" color="secondary"` "Per-agent write
  permissions arrive in P8."
- Section titles in this tab are `Heading level={5}`.

#### `src/app/actions/settings.ts` and `states-labels.ts` (F2)

The wrappers listed in docs/drafts/p4-tools.md. Destructive wrappers are called
without `confirm`.

### Integration (F3): grouping, sub-groups, read-only, tabs, recents, Power K

Steps in order; F3.6 and F3.9 are **[needs A]**.

#### F3.1 Board: one drag source per copy (decision 30)

- `board-keys.ts` (no directive):
  `export function dragKey(container: string, itemId: string): string` →
  `${container}|${itemId}` and `export function itemIdOf(key: string): string`
  (the part after the last `|`; ids, group values and container ids contain no
  `|`). Test `tests/ui/board-keys.test.ts` (round trip, a `cell:<lane>::<col>`
  container).
- `BoardLayout` registers every card with `registerItem(dragKey(container, item.id))`
  and `itemHandlers(dragKey(container, item.id), container)`; `itemsOf(container)`
  returns the composite keys; `onDrop` maps `id`, `before_id` and `after_id`
  through `itemIdOf`; the card hidden while dragging is the one whose composite key
  equals `drag.id` (only the dragged copy). `use-pointer-drag.ts` is unchanged.
- Drops: a multi-valued column the item already belongs to accepts the drop (the
  source value goes, decision 30); the None column accepts it and the item ends in
  None (engine clears the field). `acceptsGroupMove` keeps refusing closed cycle
  and archived module columns and lanes.

#### F3.2 Board swimlanes (sub-groups)

- Each lane is a controlled `Collapsible` (`trigger` = the lane's `GroupTitle
  level={5}` and its count `Badge`, `chevronPosition="start"`,
  `className="tessera-board-lane"`), collapsed lane ids in `useState` (as
  `ListLayout` groups). A closed lane's cells stay mounted but hidden and take no
  drops.
- `show_empty_groups: false` hides empty lanes (the engine leaves them out, A9).
- Lane rules in `board.css` under `.tessera-board-lane`, tokens only.

#### F3.3 Group header counts

Board column headers, lane triggers and `ListLayout` group headers show the
group's `count` in a neutral `Badge` (counts only); keep any that exist. The count
covers the loaded rows (deferral to P11).

#### F3.4 Read-only layouts (archived project)

With `readOnly`: `ListLayout`, `BoardLayout` and `TableLayout` render no quick-add
row or "+" button, register no drag items (`BoardLayout`) and no row reorder,
leave "Move to" out of card menus, and pass `readOnly` to every property control
(`StateControl`, `PriorityControl`, `AssigneeControl`, `LabelControl`,
`DateControl`, `CycleControl`, `ModuleControl` already take it).

Other screens: the expression that already makes a screen read-only for an
archived entity gains `|| bundle.project.archived_at !== null` in
`WorkItemDetail.tsx` (the property rail and description), `CycleDetailScreen.tsx`
and `ModuleDetailScreen.tsx`; `CyclesScreen.tsx` and `ModulesScreen.tsx` hide "New
cycle" / "New module" and disable the row menus. If one of these files has no such
expression, the worker adds `const isReadOnly = bundle.project.archived_at !== null`
next to its existing archived check and reports `ASSUMPTION:`.

#### F3.5 Sub-axis moves in the client

- `moves.ts` `toEngineMove(input, …)` forwards `sub_group_by`, `sub_value` and
  `sub_from_value`, translating a `state_group` value to the group's first state
  on either axis; a non-movable field on either axis (`created_by`, `created_at`,
  `project`) returns `null` (the card snaps back, no request).
- `BoardLayout.onDrop` from `cell:<laneA>::<colX>` to `cell:<laneB>::<colY>`:
  - column and lane both changed → `{ group_by, value: colY, from_value: colX, sub_group_by, sub_value: laneB, sub_from_value: laneA, before_id, after_id }`;
  - only the lane changed → `{ group_by: display.sub_group_by, value: laneB, from_value: laneA, before_id, after_id }`
    (one axis, no sub fields);
  - only the column changed → as today; neither → a reorder.
  (`from_value` / `sub_from_value` only for labels, assignees and module, as today.)
- `optimistic-list.ts`: the "move" case applies `applyGroupValue` for the sub axis
  too; `applyGroupValue` for labels, assignees and module sets `[]` when `value` is
  null or `"none"` (decision 30). Tests `tests/ui/optimistic-list.test.ts`: a
  two-axis move regroups column and lane; a None drop empties the labels; a labels
  move keeps the other labels.

#### F3.6 Sub-axis requests **[needs A]**

`moveWorkItemAction` gets the fields through `toEngineMove`; `tests/ui/moves.test.ts`
covers the three drop cases above and the `state_group` translation on the sub
axis.

#### F3.7 Project tabs

- `project-tabs.ts`: `ProjectTabKey = "work-items" | "cycles" | "modules" | "views" | "archives" | "settings"`;
  `projectTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled" | "views_enabled">)`
  returns Work items, Cycles (when on), Modules (when on), Views (when on, segment
  `views`), Archives, Settings (segment `settings`; the index redirects to
  General). `activeProjectTab` then matches `/projects/<id>/settings/...`.
- `ProjectFrame.tsx` `TAB_ICONS` adds `views: <ViewIcon />` and `settings: <GearIcon />`.
- Tests: `tests/ui/project-tabs.test.ts` (the tab arrays for each toggle
  combination; `/settings/general` → settings) and `project-frame.test.ts`.

#### F3.8 Recents

- `RouteIconKey` adds `"views" | "view" | "settings"`; `shell-icons.ROUTE_ICONS`
  maps them to `ViewIcon`, `ViewIcon`, `GearIcon`.
- `resolveRoute`: `/projects/<p>/views` → "<project> · Views" (`views`);
  `/projects/<p>/views/<v>` → "<project> · <view name>" from `entityLabel(v)`, else
  "<project> · View" (`view`); `/projects/<p>/settings/<tab>` → "<project> ·
  Settings · <Tab>" with `<Tab>` the title-cased segment (`settings`); any other path
  under `/settings` → "<project> · Settings".
- `isTransientPath` adds the settings index `/projects/<p>/settings`.
- Tests `tests/ui/recents.test.ts` (the generic-section case at line ~102 moves from
  `/settings` to another unknown segment such as `/intake`).

#### F3.9 Power K and shortcuts **[needs A for the view hits]**

- `shortcuts.ts`: `create.view` (`n v`), `nav.views` (`g v`) and `nav.settings`
  (`g s`) lose `arrives`. `useShortcuts` `PROJECT_ROUTES` adds
  `"nav.views": "views"`, `"create.view": "views?create=1"`,
  `"nav.settings": "settings/general"`; outside a project they say "Open a project
  first" like `g c`. Test `tests/ui/shortcuts.test.ts` (lines ~464–465 change: no
  "Arrives in P4" hint is left).
- `command-source.ts`: `CommandSection` gains "Views"; `SECTION_ORDER` puts
  "Views" after "Modules"; `HIT_SECTION.view = "Views"`; the local `SEARCH_TYPES` set
  adds `"view"`; `export function buildProjectSettingsCommands(projectId: string | null): CommandSearchItem[]`
  returns `[]` without a project, else five items with ids
  `projectSettings.general` … `projectSettings.agents`, labels "Settings: General",
  "Settings: Features", "Settings: States", "Settings: Labels", "Settings: Agents",
  section "Settings" (the shape `THEME_COMMANDS` uses). Test in
  `tests/ui/shortcuts.test.ts` (command-source cases).
- `CommandBar.tsx`: merges `buildProjectSettingsCommands(scope.projectId)` into the
  palette items; `handleSelect` routes `projectSettings.<tab>` to
  `/projects/<projectId>/settings/<tab>`; `HIT_ICONS.view = ViewIcon`; `openHit` case
  `"view"`: with `project_id` → `/projects/<project_id>/views/<id>`, without (a
  workspace view) → notify "Workspace views arrive in P9".
- `peek-url.ts` `mountsPeek` accepts `/projects/<p>/views/<id>` (two segments after
  `views`), so a work item hit on a view page opens in the peek. Test
  `tests/ui/peek-url.test.ts`.

#### F3.10 P3 leftovers

- `formatShortDate(value: string, today: string)`: the year comparison uses
  `today` (`YYYY-MM-DD`) instead of `new Date()`. Callers pass
  `useProject().bundle.today` (`DateControl`) or their existing `today` prop
  (`burndown.ts`, `BurndownChart.tsx`, `cycle-format.ts`, `module-format.ts`; a pure
  helper without one gains a `today` parameter its callers fill). `DateControl`'s
  re-export keeps the new signature. Tests: `cycle-format`, `module-format`,
  `burndown` and `property-controls` pass `today`; one case shows the year for a
  date outside `today`'s year.
- Cycle and module pickers offer open targets only: `cycleControlModel` leaves out
  cycles whose `status` is `completed` or whose `archived_at` is set; `ModuleControl`
  options come from a new `export function moduleControlOptions(modules: readonly Pick<Module, "id" | "name" | "archived_at">[]): { value: string; label: string }[]`
  in `membership-rules.ts` that drops archived modules. Tests in
  `tests/ui/property-controls.test.ts` (a completed, an archived and an open cycle;
  an archived and an open module). If the current code already satisfies a rule, the
  test pins it.

#### Sidebar counts and their refresh (F3 checks, no code expected)

- The flat project rows keep `<Text type="supporting" color="secondary" hasTabularNumbers>{project.counts.total}</Text>`
  in `SideNavItem endContent` (`Sidebar.tsx`; plain text, not a Badge). The source
  stays `listProjects` counts (one grouped query); lane A's A10 test proves it
  equals `getCounts({ type: "project" }).total` (decision 21).
- Refresh: a mutation through a `toolAction` wrapper calls `refresh()`, which
  re-renders `(tessera)/layout.tsx` and its `SidebarData`; an MCP write reaches it
  through `ChangesPoller` → `refreshAction()` within one poll (5 s). Views list
  counts refresh the same way. Nothing caches counts on the client.
- If acceptance step 2 or 20 shows a stale sidebar count, F3 fixes it in
  `Sidebar.tsx` (additive) and reports it.

### Icons, CSS and conventions (all lanes)

- Icons only from `src/themes/catppuccin/icons.tsx` (lane 0's patch plus the
  existing `GearIcon`, `StateIcon`, `TagIcon`, `CopyIcon`, `PencilIcon`,
  `TrashIcon`, `PlusIcon`, `PageIcon`, `CycleIcon`, `ModuleIcon`, `SlidersIcon`).
- `Dialog` and `AlertDialog` from `@/components/shell/dialogs` (lint-enforced).
  Every form dialog has `aria-label` equal to its title, as the P3 dialogs do.
- Status is `StatusDot` or `Token`, counts are `Badge` or plain tabular `Text`,
  never a Badge for "Locked", "Default" or "Modified".
- Header controls are size sm; rows keep the 16px inline inset; no Astryx
  `Toolbar` in panel headers; no second title row inside the project frame.
- CSS only in `views.css` (F1), `project-settings.css` (F2), `board.css` and
  `work-items.css` (F3), tokens only. No theme change: P4 adds no colour pair, so
  the contrast test is unchanged.
- "use client" files import engine code only from
  `@/lib/tessera/{types,schemas,core/keys,core/time,core/group}`; `view-state.ts`,
  `display-options.ts`, `settings-tabs.ts`, `sibling-moves.ts`, `identifier.ts`,
  `palette-labels.ts`, `board-keys.ts` and `optimistic-list.ts` have no directive
  and are covered by Vitest.
- No `Date.now()`, `Math.random()` or argless `new Date()` in render.
- Code that depends on decisions 29–32 cites them (`decision 30`); lane A adds the
  rows to docs/PLAN.md before any lane's hand-off (the convention gate checks them).

### Acceptance (P4)

Setup, as in P3 ("Acceptance (P3)"), with the user's `data/tessera.db` never
touched:
- After `next build` (dev server stopped), run `rm -rf .next/dev` and start the
  dev server from Bash with `TESSERA_DB_PATH=<repo>/data/p4-acceptance.db` (a new
  file; an older copy is moved to the scratchpad, never deleted):
  `nohup node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 > <log> 2>&1 &`.
- Load `http://127.0.0.1:3000/home` once (the server creates and migrates the
  file), then export the same `TESSERA_DB_PATH` in the shell that runs MCP:
  "MCP" below is `npx tsx scripts/mcp-call.ts <tool> '<json>'`; its stderr names
  the database (record it).
- At the end stop the server, `rm -rf .next/dev`, and restart it with the
  `TESSERA_DB_PATH` it had before the run; leave `data/p4-acceptance.db` in place.
- Browser: the in-app browser, or a Chrome DevTools session at
  `http://127.0.0.1:3000`. Wait 2–3 s after a dialog opens before a screenshot.
  Read the console on every screen.

Steps in order (ids from the URL or from MCP `get_work_item_by_key`):

1. `/projects` → New project "P4 Acceptance" (`P4A`) → the panel header tabs read
   Work items, Cycles, Modules, Views, Archives, Settings; the sidebar row shows
   `0`. MCP `list_projects` lists P4 Acceptance (same database; if not, stop).
2. Counts: Work items → quick-add "Alpha", "Beta", "Gamma", "Delta" (`P4A-1`…`4`) →
   the sidebar row reads `4`; MCP `get_counts '{"scope":{"type":"project","project_id":"<id>"}}'`
   returns `total: 4`. MCP `create_work_item` "Echo" → within 5 s the sidebar reads
   `5` and the list shows `P4A-5`. Archive `P4A-5` from its peek → the sidebar reads
   `4`, equal to MCP `get_counts` again.
3. Settings tab (and Project actions → "Project settings" leads to the same page)
   → `/settings/general` with the tabs General, Features, States, Labels, Agents.
   Rename the project "P4 Accepted", add a description, pick another icon and
   colour → Save changes → Toast "Project saved"; the sidebar row and the frame show
   the new name and icon. In Identifier type `p4 b!` → the field reads `P4B` and the
   Banner says "Keys become P4B-12"; type `1X` → the field shows the format error;
   set `P4B` → Save changes.
4. Identifier rename keeps `/browse` (exit criterion): the list shows `P4B-1`…;
   open `/browse/P4A-1` (typed) → `P4B-1`'s page; `/browse/P4B-2` → `P4B-2`. MCP
   `get_work_item_by_key '{"key":"P4A-3"}'` returns `key: "P4B-3"`; MCP
   `get_project '{"project_id":"P4A"}'` returns P4 Accepted. In `P4B-4`'s
   description (source mode) add `[old](work:P4A-1)` → back in rich mode the chip
   opens `P4B-1`. New project "P4 Throwaway" with identifier `P4A` →
   `/browse/P4A-1` shows not-found (the live holder wins); delete P4 Throwaway
   (type `P4A`) → `/browse/P4A-1` opens `P4B-1` again.
5. Features: Views off → the Views tab disappears; `/projects/<id>/views` shows
   "Views are turned off for this project" and "Open Features settings" leads back;
   MCP `create_view '{"project_id":"<id>","name":"X"}'` fails with `RULE` and
   `feature_disabled`; Views on → the tab is back. Cycles off → no Cycles tab, no
   Cycle in Display › Group by or in the filter field; MCP `create_cycle` fails with
   `feature_disabled`; Cycles on. Pages, Intake and Estimates switches are disabled
   and say when they arrive.
6. States: Started "+" → "Review", purple → listed under Started; Edit → description
   "Waiting for review"; Move up → above In Progress; reload → the order holds. Set
   as default → the Default token moves to Review and its Delete is disabled with
   the reason; set Backlog default again. Set `P4B-1` to Review (peek). Delete
   Review → the dialog says 1 work item and offers Move to; pick In Progress →
   Delete state → `P4B-1` shows In Progress. Cancelled's only state has Delete
   disabled ("Each group keeps at least one state").
7. Labels: New label "bug" (red), New label "ux" (blue), ux → Add sub-label
   "ux-copy" → indented under ux. ux → Move up → above bug; reload → kept.
   ux-copy → Move to → Top level → not indented; Move to → ux → indented again; ux's
   Move to is disabled ("Labels with sub-labels stay top level"). In peeks give
   `P4B-1` bug and ux, `P4B-2` bug; the label rows count 2 and 1.
8. Agents: MCP `register_actor '{"kind":"agent","name":"p4-agent","client_name":"acceptance"}'`
   → after the next refresh (5 s poll or reload) the list shows p4-agent, "acceptance
   · last active …" and the Agent token; Edit → "P4 Agent", teal → MCP
   `list_actors` shows the name. The Intake switch is disabled ("Turn on Intake
   first …"). Default assignee → P4 Agent; MCP `create_work_item` "Foxtrot" (no
   assignees) → `get_work_item_by_key` lists P4 Agent's id in `assignee_ids`; set
   Default assignee back to Nobody.
9. Multi-valued grouping: Work items → Board, Group by Labels → `P4B-1` is in the bug
   and the ux columns, `P4B-2` in bug, the rest in None, each column header with its
   count. Start dragging `P4B-1`'s ux card → only that card lifts. Drop it on None
   → `P4B-1` leaves both columns and sits in None; MCP shows `label_ids: []`. Drag it
   from None to ux → only in ux. Drag `P4B-2` from bug to ux → only in ux.
10. Sub-groups: Display → Sub-group by Priority → swimlanes with counts; collapse
    the "None" lane → its cards hide; expand it. Drag `P4B-3` from (lane None, column
    None) to (lane High, column bug) → it shows there after the refresh; MCP returns
    `priority: "high"` and bug's id in `label_ids`. Display → Show empty groups off
    → empty columns and lanes disappear; on again. Order by lists "Manual" once.
11. List layout grouped by Labels → each group header shows its count; the
    Sub-group control is absent outside the board; set the board back.
12. Views round-trip, save from the list (exit criterion): board grouped by
    Labels, filter Labels = ux → "Save view" in the filters row → dialog "Save view"
    → name "UX work" → Create view → `/views/<id>` titled "UX work" with the same
    board, grouping and filter, and no "Modified". MCP `get_view` returns
    `filters.labels` with ux's id, `display.layout: "board"`, `group_by: "labels"`.
13. Views list: the Views tab → row "UX work", description "Board · grouped by
    Labels · 1 filter", count equal to MCP `get_counts '{"scope":{"type":"view","view_id":"<id>"}}'`
    `total`. New view → "Everything" → Create view → its page lists every work item;
    back on Views: two rows.
14. Modified state: on UX work switch to List → "Modified" with Reset, Save as new
    view and Update view; reload → still modified; Reset → board, not modified.
    Order by "Priority (urgent first)" and add filter Priority = High → Update view
    → not modified; reload → kept; MCP `get_view` shows `order_by: "priority"` and
    both filters. MCP `update_view '{"view_id":"<id>","name":"UX work!"}'` → within
    5 s the title reads "UX work!"; Edit… → "UX work" → Save.
15. Save as new view: switch to Table → Save as new view → "UX table" → its page
    opens in Table; UX work still opens as a board.
16. Lock: UX work → View actions → Lock view → the lock icon in its header and row;
    switch to List → Modified, Update view disabled with "Unlock the view to update
    it", Save as new view enabled; Edit… and Delete… disabled with their reasons;
    MCP `update_view` answers `LOCKED`. Unlock view.
17. Duplicate, reorder, delete: Views → UX work → Duplicate → Toast "Duplicated as
    Copy of UX work" and its page; Views lists it last; its Move up → one place up;
    reload → kept and MCP `list_views` has the same order. Delete… "Copy of UX work"
    → confirm → gone, Toast. Search "table" → only UX table, and its menu has no Move
    items.
18. Saved-filter cleanup: Settings › Labels → ux → Delete… (the text names work
    items and saved views; ux-copy is deleted too) → MCP `get_view` UX work: no
    `labels` key in `filters`, `priority` kept; the row reads "Board · grouped by
    Labels · 1 filter".
19. Power K, shortcuts, recents: in the project `g v` → Views; `n v` → the New view
    dialog (Cancel); `g s` → Settings › General; `mod+k` "UX work" → a hit under
    "Views" → its page; `mod+k` "Settings: Labels" → the Labels tab; on UX work
    `mod+k` "Alpha" → `P4B-1` opens in the peek. On `/projects`, `g s` says "Open a
    project first". The help dialog (`mod+/`) shows no "Arrives in P4". Home's
    Recent list holds "P4 Accepted · UX work" (view icon) and "P4 Accepted ·
    Settings · Labels" (gear) and no entry for `/settings`.
20. Archived project is read-only: Project actions → Archive project → open it from
    `/projects/archives` → the Banner; Work items: no New work item, no quick-add,
    board cards do not move, peek properties read-only; Views: no New view, row
    menus disabled; Settings: inputs and switches disabled, Danger zone "Restore" →
    restored; the sidebar row is back with a count equal to MCP `get_counts`.
21. Sibling navigations by clicking only: Work items → Views → UX work → Settings →
    Features → States → Labels → Agents → General → Archives → Cycles → Work items.
    Each screen renders; no dev overlay, error or instant-navigation insight.
22. Themes and sizes: at 1440×900 and 375×812, in Frappé and Latte, check the views
    list, UX work while modified (the ViewBar), Settings General with the identifier
    Banner, States, Labels, Agents, the board with swimlanes, and the ViewDialog and
    the state delete dialog open. No horizontal page scroll; at 375 the frame tabs
    scroll, the ViewBar's actions wrap under the filter field, dialogs fit; text and
    icons legible. Screenshots for the report.
23. The dev console shows no errors and no hydration warnings on any screen of steps
    1–22 (only the tolerated entries under "Carried items").
24. Clean-up: Settings › General → Delete project… → type `P4B` → it leaves the
    sidebar, `/projects` and `/projects/archives`; MCP `list_projects` and
    `list_projects '{"archived":true}'` lack it.

Gate: `npm run check` green (typecheck, lint, Vitest with the new and updated
tests, conventions including the file budget and decision references, licences,
theme); `next build` green; `grep -rn "STUB(P4)" src` empty; every file under
`src/` and `scripts/` at most 600 lines except the ratchet list; exit criteria met
(steps 4, 12–14, 17 and 2, 13, 20).

### API verification and mismatches found while writing this section

Astryx 0.6.8 declarations under `node_modules/@astryxdesign/core/dist/`, read
2026-10-17 (prop names grepped from each `.d.ts`):

| Component | File | Props this section uses | Note |
|---|---|---|---|
| `Switch` | `Switch/Switch.d.ts` | `label`, `isLabelHidden`, `size`, `value`, `changeAction`, `isDisabled`, `disabledMessage`, `ref` | no `isReadOnly`: archived screens use `isDisabled` |
| `ListItem` | `List/ListItem.d.ts` | `label` (ReactNode), `description`, `startContent`, `endContent`, `href`, `interactiveRef`, `isDisabled` | `className` comes from the base props (*check* on first use; else wrap the label) |
| `List` | `List/List.d.ts` | `density`, `hasDividers`, `header`, `edgeCompensation` | |
| `MoreMenu` | `MoreMenu/MoreMenu.d.ts` | `label`, `items`, `size`, `alignment`, `isDisabled` | |
| `DropdownMenuItemData` | `DropdownMenu/DropdownMenu.d.ts` | `id`, `label`, `icon`, `onClick`, `isDisabled`, `variant`, `description`, `href`, `items` (submenu); `{ type: "divider" }` | |
| `AlertDialog` | `AlertDialog/AlertDialog.d.ts` | `isOpen`, `onOpenChange`, `title`, `description` (string), `actionLabel`, `actionVariant`, `isActionLoading`, `onAction` | imported from `@/components/shell/dialogs`; delete-with-move is a form `Dialog` |
| `Dialog`, `DialogHeader` | `Dialog/` (via `@/components/shell/dialogs`) | `isOpen`, `onOpenChange`, `width`, `purpose`, `aria-label`; `title`, `hasDivider` | no `DialogFooter`: `Layout` + `LayoutFooter` |
| `Selector` | `Selector/Selector.d.ts` | `label`, `options` (incl. sections), `value`, `onChange`, `renderOption`, `renderValue`, `isDisabled`, `isReadOnly`, `description`, `size`, `variant` | |
| `TextInput` | `TextInput/TextInput.d.ts` | `label`, `value`, `onChange`, `isRequired`, `hasAutoFocus`, `status`, `description`, `isDisabled`, `isLabelHidden`, `placeholder`, `hasClear`, `size` | no `maxLength` |
| `TextArea` | `TextArea/TextArea.d.ts` | `label`, `rows`, `maxLength`, `isOptional`, `isDisabled` | |
| `Token` | `Token/Token.d.ts` | `label`, `color`, `size`, `icon`, `isLabelHidden` | |
| `Icon` | `Icon/Icon.d.ts` | `icon`, `color` (semantic or a palette key), `size`, `label` | palette colours draw view, state and label glyphs |
| `StatusDot` | `StatusDot/StatusDot.d.ts` | `variant`, `label`, `tooltip` | |
| `Button` | `Button/Button.d.ts` | `label`, `variant`, `size`, `icon`, `isDisabled`, `tooltip`, `isLoading`, `clickAction`, `href` | with `tooltip`, disabled uses `aria-disabled` |
| `IconButton` | `IconButton/IconButton.d.ts` | `label`, `icon`, `variant`, `size` | |
| `Collapsible` | `Collapsible/Collapsible.d.ts` | `trigger`, `isOpen`, `onOpenChange`, `chevronPosition`, `children` | closed content stays mounted |
| `Banner` | `Banner/Banner.d.ts` | `status`, `title`, `description`, `container` | |
| `EmptyState` | `EmptyState/EmptyState.d.ts` | `title`, `description`, `actions`, `isCompact` | |
| `Tooltip` | `Tooltip/Tooltip.d.ts` | `content`, `children` | |
| `TabList`, `Tab` | `TabList/TabList.d.ts`, `TabList/Tab.d.ts` | `value`, `onChange`, `size`, `layout`, `aria-label`; `value`, `label`, `href` | navigation pattern without `panelId` (P3 row 31) |
| `Avatar` | `Avatar/Avatar.d.ts` | `name`, `size` (`xsm`…`xl`) | |
| `Text`, `Heading` | `Text/Text.d.ts` | `type`, `color`, `weight`, `hasTabularNumbers`; `level`, `accessibilityLevel` | |
| `HStack`, `VStack` | `Stack/Stack.d.ts` | `gap`, `justify`, `className` | |

Repo APIs: `RelativeTime` (`src/components/detail/RelativeTime.tsx`),
`registerEntityLabel` / `entityLabel` (`src/components/shell/entity-labels.ts`,
`recents-store.ts`), `forgetRecentsUnder` (`recents-store.ts`),
`resolveLogoIcon`, `PROJECT_LOGO_ICON_NAMES` (`icons.tsx`),
`PROJECT_IDENTIFIER_PATTERN`, `PaletteColorSchema`, `SubGroupBySchema`,
`ORDER_BY_VALUES`, `DEFAULT_DISPLAY` (`src/lib/tessera/schemas.ts`), `decodeUrlState`,
`mergeDisplay`, `mergeFilters` (`src/components/work-items/url-state.ts`),
`usePointerDrag` (`src/components/dnd/use-pointer-drag.ts`, unchanged),
`toolAction` (`src/app/actions/_run.ts`). Next: `io()`, `redirect()`,
`notFound()` as in P3 (bundled docs under `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/`).

| # | Source says | Installed code or research says | P4 resolution |
|---|---|---|---|
| 1 | PLAN §5: `/views(/[viewId]|/new)` | A dialog matches Plane's "Add view" and the cycles/modules `?create=1` pattern | No `/views/new`; PLAN §5 edited (plan notes 2) |
| 2 | Decision 23: remembered settings per scope | `ViewSettingsScopeSchema` has no `view` (`schemas.ts:44`) | Decision 32: a view's edits stay in the URL until Update view |
| 3 | `ListWorkItemsInput.display` is `DisplaySchema.partial()` | zod 4 fills defaults under `partial()` (probe, research GAP 1) | A1: `DisplayPatchSchema`; F1 sends a full display anyway |
| 4 | Exit criterion "identifier rename keeps /browse" | `getWorkItemByKey` matches the current identifier only; `tests/projects.test.ts` asserts `NOT_FOUND` | A2 / decision 29; the test changes |
| 5 | Decision 4: views have `sort_order` | No `reorderView` (`views.ts`) | A3: `reorder_view` |
| 6 | Board drops change one axis | `moveWorkItem` takes one `group_by` (research GAP 4) | A4 sub-axis fields; F3 sends one call |
| 7 | A None drop on labels leaves the item in None | The engine removes only `from_value` (`tests/work-items.test.ts:746`) | Decision 30: None clears the field |
| 8 | `usePointerDrag` items keyed by id | An item in two columns collides (`use-pointer-drag.ts:132-160`) | F3.1 composite keys in `BoardLayout`; the hook unchanged |
| 9 | ui.md P3 row 23: toggles enforced later | The engine never checks `*_enabled` | Decision 31 / A7: creates refused |
| 10 | P3 deferral: saved-filter cleanup in P4 | Only `deleteLabel` strips ids | A5 `stripIdsFromSavedFilters` |
| 11 | The settings screens could use `getCounts.by_state` for delete guards | `getCounts` excludes archived items, `deleteState` moves them | A6 `getTaxonomyUsage` |
| 12 | `search_all` describes views | `SEARCH_TYPES` has no `view` (`search.ts:20`) | A8 |
| 13 | schema.md: `rich_filters` evaluated in P1 | Stored, never applied (`filters.ts`, `counts.ts`) | A11 doc fix; evaluation P10 |
| 14 | PLAN Agents tab: "which actors may write" | No permission column; a migration needs `db/schema.ts` (on the budget) | Deferred to P8 |
| 15 | `formatShortDate` is pure | It reads `new Date()` (`properties/date-format.ts:11`) | `ProjectBundle.today` (lane 0), F3.10 |
| 16 | Order by offers each order once | `sort_order` and `-sort_order` both read "Manual" (`DisplayMenu.tsx` `orderLabel`) | `orderByChoices()` (F1) |
| 17 | `registry.ts`, `work-items.ts`, `CommandBar.tsx` may not grow | P4 adds tools, move fields and view hits there | Lane 0 splits them first |
| 18 | `cycles.ts`, `modules.ts` may not grow | GAP 5 and decision 31 add calls | Lane 0 moves two blocks out; lane A lowers the ratchet |
| 19 | States and labels drag reorder (Plane) | `ListItem href` rows and the hook's ignore list; `sortOrderForMove` adjacency across interleaved groups | Menu Move up/down with one neighbour (`siblingMove`); drag in P10 |
| 20 | Switch rows could be read-only | `Switch` has no `isReadOnly` | `isDisabled` with a `disabledMessage` |
| 21 | Delete-with-move in an AlertDialog | `AlertDialog.description` is a string | `DeleteStateDialog` is a form `Dialog` (TransferDialog precedent) |
| 22 | `components/settings/**` for settings | Lane B owns it for workspace settings (OWNERS.md) | `src/components/project-settings/**` (F); OWNERS.md edit |
| 23 | PLAN §10 lane table lists every route | `/projects/archives` and the `/cycles/[id]`, `/modules/[id]` aliases are missing | Plan notes 7 |
