# P4 plan notes: edits to docs/PLAN.md and docs/contracts/OWNERS.md

Draft by the phase planner, 2026-10-17. Lane A applies these edits during P4
(its row in docs/drafts/p4-ui.md "Lane split and file ownership"). Each item says
where the text goes and what it says.

## docs/PLAN.md

1. **Resolved design decisions**: append rows 29–32 after row 28 (the convention
   gate checks that every `decision N` cited in code exists here):
   - | 29 | **Retired identifiers**: after a project identifier changes, `/browse/OLD-n`, `work:OLD-n` links and `get_project("OLD")` resolve through the newest `identifier` activity row whose old value is `OLD`, unless a non-deleted project holds `OLD` now (the live holder wins). No alias table. |
   - | 30 | **Multi-valued group moves**: for labels, assignees and modules a move removes `from_value` and adds `value`, keeping the other values; a drop into None clears the field. On the board each copy of an item shown in several columns or lanes is its own drag source. |
   - | 31 | **Feature toggles**: turning cycles, modules or views off hides their tab, Power K entries, grouping and filter options, and the engine refuses `create_cycle`, `create_module`, `create_view` and `duplicate_view` (project views) with `RULE feature_disabled`; reads, data and memberships stay. |
   - | 32 | **Saved views**: changes on a view's page live in the URL until "Update view"; views have no `view_settings` scope (decision 23 does not apply to them). Deleting a state, label, cycle or module strips its id from every saved view, locked ones included, and every `view_settings` row. |
2. **§5 Routes**: replace `/views(/[viewId]|/new)` with `/views(/[viewId])` and add
   after the settings line: `/projects/[projectId]/settings` redirects to
   `settings/general`; P4 builds general, features, states, labels and agents;
   estimates is P8, automations P10. Note: "New view" is a dialog on the views list
   (`?create=1`, what `n v` pushes), so there is no `/views/new` route.
3. **§5 Components**: `views/` (ViewsScreen, ViewRow, ViewMenu, ViewDialog,
   ViewBar, SaveViewButton) and `project-settings/` (SettingsTabs and one screen per
   tab). The engine paths `tools/registry.ts` and `work-items.ts` become the folders
   `tools/registry/` and `work-items/` (§3 module map too).
4. **§6 Shell**: the project panel header tabs are Work items, Cycles, Modules,
   Views (each following its toggle), Archives and Settings; the project's
   "Project actions" menu starts with "Project settings". `g s` opens the current
   project's settings (outside a project: "Open a project first"); `n v` opens the
   New view dialog, `g v` the views list.
5. **§9 P4 row**, Scope column: "Project views (list, save from the work items
   list, update, save as new, duplicate, lock, delete, Move up/down), sidebar counts
   proven against `getCounts`, project settings (general with identifier rename,
   features, states, labels, agents: intake policy, default assignee, actor names),
   multi-valued grouping and board sub-groups (one-call two-axis drops), read-only
   archived projects; lane 0 splits the registry and work-items files first".
   Exit criteria unchanged.
6. **§9 later rows**, add the deferred items so each has a phase:
   - P6: the Pages feature switch.
   - P8: per-agent write permission (`actor.access`, a migration after splitting
     `db/schema.ts`), the Estimates tab, the Intake and Estimates switches,
     filters, display and layouts on Archives › Work items.
   - P9: workspace and static views, view favourites, the view logo picker, views
     list sort and filters, search/sort/filter on the cycles and modules lists, the
     actor activity feed (agent profiles), the sidebar project "…" menu and drag
     order, Power K key search by a retired identifier.
   - P10: pointer drag reorder for views, states and labels, changing a state's
     group, the automations tab, timezone, rich filter evaluation, view export.
   - P11: group counts beyond the loaded page and list paging.
7. **§10 lane table**:
   - Lane E's Owns cell adds `/projects/archives` and the alias routes
     `/cycles/[cycleId]`, `/modules/[moduleId]` (P3 built them; missing today).
   - Lane F's Owns cell adds `components/project-settings/**` (lane B keeps
     `components/settings/**` for workspace settings).
   - Below the table, one sentence: "From P4 a phase may start with a lane 0 that
     splits files on the file budget (`scripts/file-budget.json`) before other lanes
     add to them; it moves code verbatim and commits on its own
     (docs/process/swarm.md)."
8. **§13 Deviations**, append:
   - "Views are created from a dialog on the views list or with Save view on the
     work items list (no `/views/new` page)."
   - "Former project identifiers keep resolving (decision 29); Plane re-derives
     keys without aliases."
   - "Views, states and labels reorder through Move up / Move down in P4; pointer
     drag follows in P10."
   - "A drop into None on a multi-valued grouping clears the field (decision 30);
     Plane documents only label relabelling on the board."
   - "Settings is a project panel tab plus a Project actions menu item, not a
     sidebar project … menu (P9 sidebar pass)."

## docs/contracts/OWNERS.md

1. Lane F row, Owns: add `src/components/project-settings/**` after
   `src/components/{views,analytics}/**`.
2. Lane E row, Owns: add routes `/projects/archives`, `/cycles/[cycleId]` and
   `/modules/[moduleId]` (aliases).
3. Shared files table, add a row: `scripts/file-budget.json` | Q (gate) | a split
   (lane 0) removes or lowers entries; any lane lowers its own file's entry after
   shrinking it; nobody raises one.
4. Under the lane table, one sentence: "`src/lib/tessera/tools/registry/**` and
   `src/lib/tessera/work-items/**` (folders since P4) stay lane A's like the rest of
   `src/lib/tessera/**`."

## docs/PLAN-STATUS.md (the reconciler, not lane A)

- P4 row: status, agent counts per role, and the extension points P5–P10 inherit
  (views list for P5 "view from prompt", `ViewDialog` initial state, the
  `feature_disabled` rule, `saved-filters.ts`, settings tabs for P8/P10).
- Close the P3 "Known gaps" bullets fixed here (`formatShortDate`, Order by
  "Manual" twice, §10 lane table, read-only archived projects).
- Field guide: replace the file-budget line's file list (registry and work-items
  are folders now; CommandBar.tsx left the list).
