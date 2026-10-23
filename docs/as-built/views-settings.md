# As-built map: views and settings (P4)

State described: the working tree after the fix-all round (2026-10-21) and the visual alignment round (2026-10-22, on HEAD 5f0cc7c: workspace views reorder, optimistic Move up/Move down, settings touch targets and tab strips). Line counts are tree counts. Decision numbers are rows of the "Resolved design decisions" table in docs/PLAN.md. Contract: docs/contracts/ui.md "Views" and "Project settings".

## 1. Purpose and boundaries

This area holds saved views (a named pair of filters and display, per project or for the workspace), the remembered display settings, the counts behind every badge, and the project settings screens: General, Features, States, Labels, Agents, plus the Estimates and Automations tabs that later phases added (mapped in planning-extras.md and operations.md). The engine owns the rules; the screens are thin Server Action clients.

Lives elsewhere (this area only calls it):
- The list screen a view renders (`WorkItemsScreen`, `FilterBar`, `DisplayMenu`, `url-state.ts`): work-items.md. The rich filter dialog (`filters/*`) and rich filter evaluation: operations.md.
- Project frame, tabs and project menu: `work-items/ProjectFrame.tsx`, `planning/ProjectArchive.tsx` (planning.md).
- Workspace settings (General, AI, Exports, Webhooks, Backups tabs): `workspace-settings/*`, mapped in workspace.md and operations.md.
- Tool registry, MCP and Server Action runner: engine.md.

## 2. File map

### Engine (`src/lib/tessera/`)

| File | Responsibility | Key exports |
|---|---|---|
| `views.ts` (417) | Saved views CRUD. Name unique per scope (`name_key`; workspace names checked in code because SQLite treats NULL `project_id` as distinct). Workspace views accept only `layout: "table"`. Locked views refuse every change but `unlockView`. | `listViews`, `getView`, `createView`, `updateView`, `reorderView`, `duplicateView` ("Copy of …"), `lockView`, `unlockView`, `deleteView`, `WORKSPACE_VIEW_LAYOUT` |
| `view-settings.ts` (269) | One `view_settings` row per (scope_type, scope_id); saves merge keys over stored ones; `DisplayPatchSchema` has no defaults so an omitted key never resets. | `getViewSettings`, `saveViewSettings`, `resetViewSettings`, `DisplayPatchSchema`, `mergeDisplay`, `mergeFilters`, `defaultViewSettings`, `WORKSPACE_SCOPE_ID` |
| `saved-filters.ts` (71) | Strips a deleted state, label, cycle or module id from every saved view (locked included) and every `view_settings` row. | `stripIdsFromSavedFilters` |
| `static-views.ts` (30) | The four virtual workspace views and their `view_settings` ids (`workspace`, `static:<key>`). | `staticViewScope`, `staticViewSettingsId` |
| `counts.ts` (383) | `getCounts(scope)`: workspace, project, cycle, module, view and profile scopes; counts the population `listWorkItems` shows (non-deleted, non-archived, outside triage). View scope applies the view's filters and rich tree through `buildWhere` and `buildRichWhere`. | `getCounts`, `getTaxonomyUsage`, `countsPopulation`, `CountsScopeSchema` |
| `states.ts` (436) | States per project; fractional `sort_order`; one default; hidden `triage` state owned by Intake. | `createState`, `updateState`, `reorderState`, `setDefaultState`, `deleteState`, `DEFAULT_STATES`, `ensureTriageState` |
| `labels.ts` (312) | Labels, one level deep. `reorderLabel` also reparents (`parent_id`) in one transaction and scopes neighbours to the target container. | `createLabel`, `updateLabel`, `reorderLabel`, `deleteLabel` |
| `projects.ts` (601), `projects-order.ts` (54) | Project CRUD, identifier rules, feature toggles (`updateProjectFeatures`), archive and restore, retired identifiers. | `updateProjectFeatures`, `assertFeatureEnabled`, `resolveRetiredIdentifier`, `reorderProject` |

Registry tools: `views.ts` (list/get/create/update/duplicate/lock/unlock/reorder/delete view, get/save/reset view settings), `states.ts`, `labels.ts`, `projects.ts` under `tools/registry/`. Server Action wrappers: `actions/{views,states-labels,settings,projects}.ts`.

### Routes (`src/app/(tessera)/`)

| Path | Responsibility |
|---|---|
| `projects/[projectId]/views/page.tsx` (70) | One `readTessera`: project, `listViews`, `getCounts` per view. `views_enabled` off gives `FeatureOffState`. `?create=1` opens New view. |
| `projects/[projectId]/views/[viewId]/page.tsx` (59), `view-list.tsx` (92) | View page. `view-list.tsx` lays `?q=` over the saved row (decision 32), reads through the `view` list scope and mounts `WorkItemsScreen` with `ViewBar` in the filters row and `ViewMenu` in the sub-header. A missing or malformed id calls `notFound()` (via `scope-lookup.ts`). |
| `projects/[projectId]/settings/layout.tsx` (60) | Panel header with `SettingsTabs` over a 960px reading column. No reads: screens use the project bundle. |
| `projects/[projectId]/settings/{general,features,states,labels,estimates,agents,automations}/page.tsx` | One screen each; states, labels and estimates pages read usage counts (`getTaxonomyUsage`). |
| `workspace-views/page.tsx` (40), `workspace-views/[viewId]/page.tsx` (88) | Static keys open virtual views (table only, Project column); a saved workspace view with a project redirects to its project route. |

### Components

| Path | Responsibility | Key exports |
|---|---|---|
| `views/ViewsScreen.tsx` (191) | Views list: search, New view, Describe a view (when the assistant is available), `?create=1` and `?describe=1` consumed once. Rows drag by pointer (decision 105) with optimistic order, toast and snap-back; drag off while search has text or the project is archived. The reorder wiring is `use-view-reorder.ts`, shared with the workspace list. | `ViewsScreen` |
| `views/ViewRow.tsx` (89), `ViewMenu.tsx` (129), `use-view-reorder.ts` (56) | Row links through ListItem's invisible anchor (`tessera-row-hit` gives a touch hit area); menu: Edit, Duplicate, Lock/Unlock, Move up/down (row only, optimistic through `onMove`), Delete. `useViewReorder` is the one reorder hook of both views lists: `useOptimistic` manual order (decision 13), `usePointerDrag` (decision 105) and the menu path; a refused move toasts the view's name and the reason. | `ViewRow`, `ViewLockIndicator`, `ViewMenu` |
| `views/ViewBar.tsx` (110) | "Modified" dot with Reset, Save as new view and Update view. A locked view disables Update with its reason; an archived project shows only Reset. Registers the view name for recents. | `ViewBar` |
| `views/ViewDialog.tsx` (175), `SaveViewButton.tsx` (32) | New, edit, "Save view" (from the project list) and "Save as new view" modes; logo through the shared picker (decision 85). | `ViewDialog`, `SaveViewButton` |
| `views/view-state.ts` (75, pure), `view-reorder.ts` (57, pure) | What counts as modified (`isViewModified`, stable JSON of normalised filters, display, rich tree), quick-add defaults a view implies, row summary ("List · 4 filters"); drop maths. | `isViewModified`, `normalizeFilters`, `viewScopeDefaults`, `viewSummary`, `moveView`, `viewDropInput` |
| `views/WorkspaceViewsScreen.tsx` (189) | Four static views, then saved workspace views; `?create=1`. The saved list has the project views list's structure and drag reorder (decisions 13 and 105). | `WorkspaceViewsScreen` |
| `project-settings/SettingsTabs.tsx`, `settings-tabs.ts` (pure) | Seven tabs; the palette builds its entries from `SETTINGS_TABS`. |
| `project-settings/SettingsRow.tsx` (30) | `SettingsTitle` (14/20/500) and `SettingsHelp` (supporting 12/20, secondary) for every settings row. | `SettingsTitle`, `SettingsHelp` | `SETTINGS_TABS`, `activeSettingsTab` |
| `project-settings/{General,Features,Agents}Settings.tsx` | General: name, identifier (old keys keep working, decision 29), description, logo, danger zone. Features: six switches (cycles, modules, views, pages, intake, estimates) through `updateProjectFeaturesAction`. Agents: intake policy switch, default assignee, actor list with `ActorDialog`. All disabled in an archived project. | `GeneralSettings`, `FeaturesSettings`, `AgentsSettings` |
| `project-settings/StatesSettings.tsx` (217), `StateDialog.tsx`, `DeleteStateDialog.tsx` | One list per group (triage never shown). Delete of a non-empty state asks where its items move. Drag stays inside one group; the call carries one neighbour (the flat sort order interleaves groups). | `StatesSettings`, `stateDrop`, `moveStateInGroup` |
| `project-settings/LabelsSettings.tsx` (265), `LabelDialog.tsx`, `reorder-drop.ts` (128, pure) | Top-level labels each followed by sub-labels; containers are the top level and each parent's children; an empty parent shows a "Drop to nest" zone; a label with children refuses nesting. Menu keeps Move to / up / down. | `LabelsSettings`, `labelDrop`, `labelDropRefusal`, `moveLabel` |
| `project-settings/sibling-moves.ts` (36), `palette-labels.ts`, `identifier.ts` | Menu moves name exactly one neighbour; palette names; identifier sanitising. | `siblingMove`, `sanitizeIdentifier` |
| `shared/RowDrag.tsx` (57) | Grip, lifted clone and dashed slot shared by every row-reorder surface. | `RowGrip`, `RowDragOverlay`, `RowSlot` |
| `projects/CreateProjectDialog.tsx` (206) | New project: name, suggested identifier, logo. | `CreateProjectDialog`, `NewProjectButton` |

## 3. Data and control flow

### Read path
1. A route `page.tsx` is a sync default export with `<Suspense>`; the async child awaits params, calls `await io()`, validates ids with `IdSchema`, then one `readTessera`.
2. Settings screens read nothing: the project layout loaded the `ProjectBundle` (project, states, labels, actors, estimate, features) once, and the screens take it from `useProject()`.
3. A view page decodes `q`, merges it over the saved view (`mergeFilters`, `mergeDisplay`), reads the list through `{ type: "view", view_id }` and recomputes `isModified` on every render. The URL is the only place unsaved changes live.
4. The views list takes each view's count from `getCounts({ type: "view" })`; the sidebar badges come from the same function (decision 21).

### Write path
1. A client component calls a Server Action (`toolAction("tool_name")`): validate against the registry schema, run as `user`, `refresh()`, return `ActionResult`. A failure shows a Toast and the optimistic value reverts.
2. Drags use `useOptimistic` inside `startTransition`: apply the move, call `reorderViewAction`, `reorderStateAction` or `reorderLabelAction`, toast on `{ ok: false }`.
3. The display menu writes `q` for the URL and `saveViewSettingsAction` for the remembered scope (decision 23); a saved view has no `view_settings` scope.
4. Deleting a state, label, cycle or module strips its id from saved filters inside the same transaction.

## 4. Invariants and rules the code enforces

| Rule | Decision | Enforced in | Test |
|---|---|---|---|
| View names unique per scope, case-insensitive; duplicate gets "Copy of …" | 20 | `views.ts` | `tests/views.test.ts` |
| Workspace views are table-only (VALIDATION on other layouts) | 18, 20 | `views.ts` | `tests/views.test.ts` |
| Locked view refuses edits except unlock (LOCKED); `not_locked` on a stray unlock | 20, 32 | `views.ts` | `tests/views.test.ts` |
| Changes on a view page stay in the URL until Update view | 32 | `view-list.tsx`, `ViewBar.tsx`, `view-state.ts` | `tests/ui/view-state.test.ts` |
| Deleting a state, label, cycle or module strips saved filters and `view_settings` | 32 | `saved-filters.ts` | `tests/{states,labels,cycles,modules}.test.ts` |
| Remembered display merges per key; URL params override at read time | 23 | `view-settings.ts` | `tests/view-settings.test.ts` |
| Static workspace views are virtual: not renamed, locked, deleted or favourited | 77 | `static-views.ts`, `schemas.ts` | `tests/static-views.test.ts` |
| One `getCounts` for sidebar, headers, progress, analytics, MCP | 21 | `counts.ts` | `tests/counts.test.ts`, `tests/analytics/counts-parity.test.ts` |
| Features off: creates refuse with `feature_disabled`; reads and data stay | 31 | `projects.ts` `assertFeatureEnabled` | `tests/{cycles,modules,views,intake}.test.ts` |
| Identifier rename keeps old keys working; the live holder wins | 29 | `projects.ts` `resolveRetiredIdentifier` | `tests/projects.test.ts` |
| Intake cannot be disabled with pending items; requiring it needs Intake on | 64 | `projects.ts` (`intake_pending`, `intake_disabled`) | `tests/projects.test.ts` |
| State: one default, triage neither default nor deletable, last state of a group stays, a non-empty state needs `move_to_state_id` | schema.md | `states.ts` | `tests/states.test.ts` |
| Labels nest one level; a label with children cannot nest; neighbours of `reorder_label` must be in the target container | 105 | `labels.ts` | `tests/labels.test.ts` |
| Every list drag has a menu path (Move up/down) | 14, 105 | the screens above | `tests/ui/reorder-drop.test.ts`, `view-reorder.test.ts`, `sibling-moves.test.ts` |
| Archived project: settings and views read-only (ARCHIVED) | schema.md | engine `archived()` plus disabled controls | `tests/projects.test.ts`, `tests/states.test.ts` |

## 5. Tests that guard this area

- Engine: `tests/{views,view-settings,static-views,states,labels,projects,projects-reorder,counts}.test.ts`, `tests/analytics/counts-parity.test.ts`.
- UI (pure maths and render): `tests/ui/{view-state,view-reorder,views-menu-move,reorder-drop,settings-tabs,settings-css,sibling-moves,project-identifier,project-tabs,url-state,filter-state}.test.ts` (`settings-css` reads the settings, estimates and profile stylesheets; `views-menu-move` covers Move up/Move down on both views lists).
- Playwright: `tests/e2e/views-settings.spec.ts` (save a list as a view, lock it, a state and a label added in settings reach the work items screen), `tests/e2e/drag-surfaces.spec.ts` (menu paths and pointer drags of views, states, labels).
- No Vitest: `ViewDialog`, `ViewMenu`, `GeneralSettings`, `FeaturesSettings`, `AgentsSettings`, `ActorDialog`, `WorkspaceViewsScreen`.

## 6. Extension points

- New settings tab: add a key to `SETTINGS_TABS` and a folder under `settings/<key>/page.tsx`; the command palette picks it up with no further edit.
- New feature toggle: a column plus a row in `FEATURES` (`FeaturesSettings.tsx`); engine creates call `assertFeatureEnabled`.
- New reorder surface: pure drop maths beside the screen, `usePointerDrag` plus `RowGrip`/`RowSlot`, an action that takes one or two neighbours, and a menu path.
- New remembered scope: `ViewSettingsScopeInput` accepts a fixed set of scope types; extend it with the matching `view_settings` id rule.

## 7. Known debt and quirks

- Touch (decision 14): settings and dialog fields (text inputs, selectors, switch labels, dialog item rows) are visible 44 px boxes under `(pointer: coarse), (max-width: 480px)` through `.tessera-settings-body` and `.tessera-settings-fields` in `project-settings.css`; the 1440 field height (32 px) stays. All Switches in settings and dialogs are Astryx size `sm` (32x20).
- Move up/down in the views, states and labels menus are optimistic like the drags (decision 13).
- A drop the surface refuses (another state group, a label that would nest two levels) snaps back with no toast.
- `reorder_state` is not scoped by group in the engine, which is why the UI sends one neighbour.
- A label drag hides its children with it while held.
- Touch drag: only the grip has `touch-action: none` (44px at coarse pointer); the rest of a row still scrolls.
- No Latte screenshot of a mid-drag state; styles use tokens only.

## 8. Where to read more

| Topic | Read |
|---|---|
| Views, display, counts contracts | docs/contracts/service-api.md, schema.md "Views" |
| Screens | docs/contracts/ui.md "Views", "Project settings"; docs/drafts/p4-ui.md |
| Decisions | docs/PLAN.md 20–23, 29, 31–32, 77, 85, 105 |
