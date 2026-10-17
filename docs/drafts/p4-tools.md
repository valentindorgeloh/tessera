## P4 changes (lane A, consumed by docs/contracts/ui.md "P4: views, settings, counts")

Draft by the phase planner, 2026-10-17; lane A appends it to
docs/contracts/tools.md. Service details: docs/drafts/p4-service-api.md.

- One new tool; the registry goes from 90 to 91. Tool definitions now live in
  `src/lib/tessera/tools/registry/<domain>.ts` (lane 0 split), `TOOLS` in
  `registry/index.ts`.
- `reorder_view` (`registry/views.ts`):
  - title "Reorder view"; description (exact): "Moves a view directly before or
    after another view of the same scope (the same project, or the workspace);
    before_id or after_id is required. Works on locked views: the order is not
    view content."
  - input `ReorderViewInput.extend({ view_id: ViewId })` (the `reorder_state`
    pattern); `mutates: true`; `phase: "P4"`; not core, not destructive;
    `run: (ctx, { view_id, ...input }) => reorderView(ctx, view_id, input)`.
  - Row in "Tools by domain", Views and settings: insert `reorder_view` after
    `unlock_view`.
- Changed inputs (picked up from the service schemas, no tool code change):
  - `list_work_items` / `list_archived_work_items`: `display` is a patch; omitted
    keys keep the saved view's (scope view) or the defaults.
  - `move_work_item`: `sub_group_by`, `sub_value`, `sub_from_value` (a drop that
    changes column and swimlane in one call); for labels, assignees and module a
    `value` of null or `"none"` now clears the field (decision 30).
  - `search_all`: `types` accepts `"view"`; hits of type `view`.
- Description text (exact), replacing the current one:
  - `move_work_item`: "Reorders a work item (before_id / after_id) and, with
    group_by and value, changes the grouped field as a board or list drop does. For
    labels, assignees and module, from_value is the value the item leaves and the
    others are kept; value null or \"none\" clears the field. sub_group_by,
    sub_value and sub_from_value change a second axis (a board swimlane) in the same
    call; both changes or neither are written."
  - `get_work_item_by_key`: the current text plus " A key with a project's former
    identifier (before a rename) still resolves, unless another project uses that
    identifier now."
  - `get_project`: the current text plus " A former identifier resolves the same
    way."
  - `create_cycle`, `create_module`, `create_view`, `duplicate_view`: the current
    text plus " RULE feature_disabled while the project has the feature turned off."
  - `delete_state`, `delete_label`, `delete_cycle`, `delete_module`: the current
    text plus " Its id is removed from every saved view and remembered view
    setting that filters on it."
  - `search_all`: unchanged; its text already names views, which it now returns.
- Errors: `RULE feature_disabled` (above); `move_work_item` `VALIDATION` at
  `sub_group_by` (needs group_by, must differ, needs sub_value).
- Registry test: `CONTRACT_PHASES` gains `reorder_view: "P4"`; any tool-count
  assertion becomes 91; "service coverage" binds `reorderView` to `reorder_view`.
  `stripIdsFromSavedFilters`, `resolveRetiredIdentifier`, `assertFeatureEnabled`
  and `getTaxonomyUsage` match no mutation prefix.
- Server Action wrappers added in P4 (file-level `"use server"`,
  `export const xAction = toolAction("tool_name")`):
  - `src/app/actions/views.ts` (lane F1): `createViewAction` (`create_view`),
    `updateViewAction` (`update_view`), `duplicateViewAction` (`duplicate_view`),
    `lockViewAction` (`lock_view`), `unlockViewAction` (`unlock_view`),
    `deleteViewAction` (`delete_view`), `reorderViewAction` (`reorder_view`).
  - `src/app/actions/settings.ts` (lane F2, new): `updateProjectFeaturesAction`
    (`update_project_features`), `updateActorAction` (`update_actor`).
  - `src/app/actions/states-labels.ts` (lane F2, additive): `updateStateAction`,
    `reorderStateAction`, `setDefaultStateAction`, `deleteStateAction`,
    `updateLabelAction`, `reorderLabelAction`, `deleteLabelAction`.
  - `updateProjectAction` (`projects.ts`) already exists; General uses it.
  The UI confirms destructive tools itself and never passes `confirm` (as
  `DeleteProjectDialog` calls `deleteProjectAction({ project_id })`).
- Not added: a tool for `getTaxonomyUsage` (server read only), `reorder_project`
  (P9), `list_activity` by actor (P9), an actor permission field (P8).
