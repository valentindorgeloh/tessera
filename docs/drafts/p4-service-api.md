## P4 additions (lane A)

Draft by the phase planner, 2026-10-17; lane A appends it to
docs/contracts/service-api.md. Consumers: docs/contracts/ui.md "P4: views,
settings, counts" (draft docs/drafts/p4-ui.md). Paths are after lane 0's splits
(`src/lib/tessera/work-items/`, `src/lib/tessera/tools/registry/`). One new
mutating export (`reorderView`, bound by the new tool `reorder_view`), no
migration, no new activity verb. Decisions 29–32 are defined in the P4 section of
ui.md and added to docs/PLAN.md by lane A.

### A0: land the public signatures first

UI lanes code against these names; lane A lands them (types, schemas, empty or
full implementations that typecheck) before any behaviour work, in this order:
`MoveWorkItemInput` sub-axis fields, `ReorderViewInput` / `reorderView` and the
`reorder_view` tool, `"view"` in `SEARCH_TYPES`, `TaxonomyUsage` /
`getTaxonomyUsage`, `ListWorkItemsInput.display`. Adding `"view"` to `SearchType`
breaks two `Record<SearchType, …>` literals in `src/components/shell/command-source.ts`
(`HIT_SECTION`) and `CommandBar.tsx` (`HIT_ICONS`); lane F3 fills them (its step
F3.9). Lane A lists them under `core_changes` and does not edit those files.

### A1 Partial display on a view (GAP 1, bug)

```ts
// work-items/read.ts
ListWorkItemsInput.display: DisplayPatchSchema.optional()   // was DisplaySchema.partial(): zod 4 still applied defaults
```
- Import `DisplayPatchSchema` and `mergeDisplay` from `../view-settings`.
- `resolveScope`: every non-view scope uses
  `mergeDisplay(DEFAULT_DISPLAY, data.display ?? {})`. The view scope uses
  `mergeDisplay(DisplaySchema.parse(row.display), data.display ?? {})`. Filters are
  unchanged: saved filters with the caller's defined keys replacing them.
- A full `Display` stays a valid input (callers that pass one today still work).
- Test `tests/work-items.test.ts` "view scope keeps saved display keys the caller
  omits": save a view with `{ layout: "board", order_by: "-priority", properties: { key: false } }`;
  `listWorkItems({ scope: { type: "view", view_id }, display: { group_by: "state" } })`
  returns the `-priority` order and groups by state.
- Test `tests/views.test.ts` "round-trip": `createView` with a partial display and
  filters → `getView` returns the merged display and the same filters →
  `updateView` with `{ display: { group_by: "labels" }, filters: { priority: ["high"] } }`
  → `getView` keeps the other display keys and replaces the filters →
  `listWorkItems` with the view scope and no caller display returns exactly the
  items `listWorkItems` with scope project and those filters returns, in the same
  order.

### A2 Retired identifiers (GAP 2, decision 29)

```ts
// projects.ts
export function resolveRetiredIdentifier(ctx: TesseraContext, identifier: string): ProjectRow | undefined
```
- `identifier` goes through `normalizeIdentifier` first.
- `undefined` when a non-deleted project (archived or not) holds the identifier now:
  the live holder always wins.
- Otherwise: the activity rows with `entity_type = 'project'`, `field =
  'identifier'` and `old_value` equal to the identifier in the stored form that
  `diffFields` writes (check whether it JSON-encodes strings and compare the same
  way), newest `seq` first. Return the first whose project is not deleted and whose
  current identifier differs; else `undefined`.
- `getProject(ctx, idOrIdentifier)`: when the argument is not an id and no project
  holds it, fall back to `resolveRetiredIdentifier`; `NOT_FOUND` as before when
  that is `undefined`.
- `getWorkItemByKey(ctx, keyOrId)` (`work-items/read.ts`): when the key parses and no
  project holds its identifier, look the sequence up in the project
  `resolveRetiredIdentifier` returns. The item carries its current key (`SITE-1`).
  `NOT_FOUND` otherwise.
- `/browse/[key]` needs no change: it redirects by the item's id.
- Test `tests/projects.test.ts` (replaces the assertion that `WEB-1` is `NOT_FOUND`
  after a rename, near lines 201–210) "retired identifier keeps old keys": rename
  WEB → SITE: `getWorkItemByKey("WEB-1").key === "SITE-1"` and `getProject("WEB").id`
  is SITE's; rename SITE → WEB2: `WEB-1` and `SITE-1` both resolve to `WEB2-1`; a new
  project WEB (no items): `WEB-1` is `NOT_FOUND`; after deleting WEB2, `SITE-1` is
  `NOT_FOUND`.

### A3 Reorder views (GAP 3)

```ts
// views.ts
export const ReorderViewInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the view that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the view that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });
export type ReorderViewInputType = z.input<typeof ReorderViewInput>;
export function reorderView(ctx: TesseraContext, id: string, input: ReorderViewInputType): View
```
- Mirrors `reorderState`: `validateInput`, `withTx`, the new key from
  `sortOrderForMove` over `listViews(ctx, { project_id: view.project_id })`.
- `NOT_FOUND` for an unknown or deleted view and for a neighbour outside the view's
  scope (another project, or project vs workspace); `VALIDATION` for non-adjacent
  neighbours (from `sortOrderForMove`); `ARCHIVED` when the project is archived.
- Allowed on a locked view: `sort_order` is placement, not view content (schema.md
  "Views" gets this sentence). Allowed while `views_enabled` is off (decision 31
  refuses creates only).
- Activity: verb `updated`, field `sort_order`, identifier the view name (as
  `reorderState`).
- Test `tests/views.test.ts` "reorderView moves a view within its scope": three
  views A, B, C → `reorderView(C, { after_id: A })` lists C, A, B; a workspace view
  as neighbour is `NOT_FOUND`; `{ before_id: A, after_id: C }` when not adjacent is
  `VALIDATION`; a locked view moves; an archived project answers `ARCHIVED`.

### A4 Sub-grouped board drops and the None rule (GAP 4, decision 30)

```ts
// work-items/move.ts: MoveWorkItemInput gains
sub_group_by: GroupBySchema.optional().describe("Second grouping axis changed by the same drop (a board swimlane). Needs group_by and must differ from it."),
sub_value: z.string().nullable().optional().describe("Target value on sub_group_by; null or \"none\" = the none group."),
sub_from_value: z.string().nullable().optional().describe("For labels, assignees and module on sub_group_by: the value the item leaves."),
```
- Checked inside `moveWorkItem` with `validation(...)` (not a schema refine, so the
  tool's `.extend` keeps working): `sub_group_by` without `group_by` ("sub_group_by
  needs group_by"), equal to `group_by` ("sub_group_by must differ from
  group_by"), or without `sub_value` ("sub_value is required with
  sub_group_by"), each at path `sub_group_by`.
- `applyGroupChange(ctx, loaded, axis: { group_by: GroupBy; value: string | null | undefined; from_value: string | null | undefined })`
  runs for the main axis, then for the sub axis, in the same transaction, then
  the sort order. Non-movable sub fields answer `RULE group_not_movable`; any
  failure (an archived module, a completed cycle) rolls both back.
- None rule: for `labels`, `assignees` and `module`, `value` null or `"none"` sets
  the field to `[]` (was: removed `from_value` only). Otherwise `from_value` is
  removed and `value` added when absent, other values kept. `state`, `priority`,
  `cycle` and the dates replace as before.
- Tests `tests/work-items.test.ts`: the existing case "for labels, assignees and
  modules adds the value and removes from_value" changes its none expectation
  (around line 746) from `[bug.id]` to `[]`; new "a drop into none clears a
  multi-valued field"; "a board drop across column state and swimlane labels
  changes both in one call" (state and labels both change, one activity row per
  field); "a two-axis drop is atomic" (sub value an archived module → `ARCHIVED`,
  state unchanged); "sub_group_by needs group_by and must differ" (`VALIDATION`).

### A5 Saved-filter cleanup (GAP 5, decision 32)

```ts
// saved-filters.ts (new; not exported from src/lib/tessera/index.ts)
export type SavedFilterKey = "state" | "labels" | "cycle" | "module";
export function stripIdsFromSavedFilters(ctx: TesseraContext, input: { key: SavedFilterKey; ids: ReadonlySet<string>; project_id: string }): void
```
- Runs inside the caller's transaction (`assertInTransaction`).
- Views: every non-deleted view whose `project_id` is `input.project_id` or null
  (workspace views), locked ones included, whose `filters[key]` holds one of the
  ids: drop the ids, delete the key when the list is empty, write `filters`,
  `updated_at`, `updated_by`, and log what `labels.ts` logs for a view today (verb
  `updated`, field `filters`).
- `view_settings`: every row whose `filters[key]` holds one of the ids, same
  rewrite and the activity row `labels.ts` writes for a settings row today.
- `labels.ts` replaces its own view and view_settings strip helpers with
  `stripIdsFromSavedFilters({ key: "labels", ids: <label and child ids>, project_id })`.
- Called by `deleteState` (`"state"`), `deleteLabel` (`"labels"`), `deleteCycle`
  (`"cycle"`) and `deleteModule` (`"module"`), inside their transactions.
- Tests in `tests/{states,cycles,modules}.test.ts` "delete strips the id from saved
  filters": a project view, a locked project view, a workspace view and a
  `view_settings` row filtering on the id plus another id → the id is gone, the
  other kept; a key left empty is removed. `tests/labels.test.ts` keeps its current
  cases green.

### A6 Taxonomy usage (GAP 6)

```ts
// counts.ts
export type TaxonomyUsage = { states: Record<string, number>; labels: Record<string, number> };
export function getTaxonomyUsage(ctx: TesseraContext, projectId: string): TaxonomyUsage
```
- Counts the project's non-deleted work items, archived and triage included (the
  population `deleteState` moves and `deleteLabel` strips); an id with no items is
  absent. Two grouped queries. `NOT_FOUND` for an unknown project. Read-only, no
  tool: the settings screens read it through `readTessera`.
- Test `tests/states.test.ts` "usage counts archived items": a state whose only item
  is archived has usage 1, and `deleteState` without a target answers
  `RULE state_not_empty`; with usage 0 it deletes.

### A7 Feature toggles refuse creates (GAP 10, decision 31; ui.md P3 row 23)

```ts
// projects.ts
export type ProjectFeature = "cycles" | "modules" | "views";
export function assertFeatureEnabled(project: Pick<ProjectRow, "cycles_enabled" | "modules_enabled" | "views_enabled">, feature: ProjectFeature): void
// RULE feature_disabled: "Cycles are turned off for this project" | "Modules are …" | "Views are …"
```
- Called by `createCycle`, `createModule`, `createView` and `duplicateView` when the
  view's `project_id` is not null, right after the project row is loaded.
- Tests in `tests/{cycles,modules,views}.test.ts` "create refuses while the feature
  is off": `RULE feature_disabled`; list and get still work; turning it on again
  allows the create.

### A8 View search hits (GAP 9)

- `search.ts`: `SEARCH_TYPES` gains `"view"` (last); `SearchType` follows.
- `viewHits`: the same name matching as the cycle hits; non-deleted views of
  non-deleted, non-archived projects with `views_enabled`, plus workspace views
  (`project_id` null) when the search is not scoped to a project; the hit has
  `type: "view"`, `id`, `project_id` (null for a workspace view), the view name as
  the title and the other fields cycle hits set.
- Test `tests/search.test.ts` "search_all finds views": a project view and a
  workspace view match by name; a deleted view, a view of an archived project and a
  view of a project with views off do not.

### A9 Display normalisation and empty sub-groups (GAP 12)

- `view-settings.ts` `mergeDisplay`: after the merge, `sub_group_by` becomes `null`
  when `group_by` is `null` or equals `sub_group_by`. Test
  `tests/view-settings.test.ts` "mergeDisplay drops a sub-group equal to the group
  or without a group".
- `filters.ts` `groupItems`: with `show_empty_groups: false`, empty `sub_groups` are
  left out as empty groups are. Test `tests/filters.test.ts` "show_empty_groups false
  hides empty sub-groups" (if it already holds, the test pins it).

### A10 Counts parity (decision 21; exit criterion)

- Test `tests/counts.test.ts` "listProjects counts equal getCounts": a project with
  a live item, a sub-item, an archived item, a deleted item and (intake on) a triage
  item → `listProjects(ctx, {})` count `total` equals `getCounts({ type: "project" }).total`
  and equals `listWorkItems` scope project `total`.

### A11 Docs

- `rich_filters` (GAP 10 drift): the `.describe()` text of `rich_filters` in
  `CreateViewInput` and `UpdateViewInput` becomes "Stored only; lists and counts do
  not apply it until P10. Use filters." and docs/contracts/schema.md line ~101 says
  "stored since P1, evaluated from P10".
- docs/contracts/service-api.md: append this section. docs/contracts/tools.md:
  append docs/drafts/p4-tools.md. docs/PLAN.md and OWNERS.md: the edits in
  docs/drafts/p4-plan-notes.md.
- `scripts/file-budget.json`: lower `cycles.ts` and `modules.ts` to their final
  `wc -l` counts.

### Budget check for lane A

`cycles.ts` gains about 3 lines (two imports widened, one strip call, one feature
check) inside the room lane 0 made (about 45); `modules.ts` about 3 inside about
28. `projects.ts` (513) grows by about 45; `views.ts` (366) by about 45;
`search.ts` (357) by about 30; `counts.ts` (304) by about 30; all stay under 600.
`work-items/move.ts` and `work-items/read.ts` start at about 150 and 215 lines.
