## P8: Intake, drafts, estimates, bulk (phase plan)

Draft by the phase planner, 2026-10-17, on `main` at `e03e664`. It assumes the P4
contract (docs/drafts/p4-ui.md, p4-service-api.md, p4-tools.md, p4-plan-notes.md)
and the P5, P6 and P7 plans (docs/drafts/p5-plan.md, p6-plan.md, p7-plan.md) are
delivered:
- the registry and work items are folders (`tools/registry/<domain>.ts`, `TOOLS` in
  `registry/index.ts`; `work-items/{index,model,hydrate,read,membership,create,update,move,transfer,lifecycle}.ts`);
- `db/schema.ts` is the folder `db/schema/` (P5 lane 0) and `db/schema/planning.ts`
  holds the four P8 tables that `0000_init` already created; migrations `0002_ai`,
  `0003_pages` and `0004_collaboration` exist;
- decisions 29–60 are in docs/PLAN.md;
- P4's project settings (General, Features, States, Labels, Agents), project tabs
  with Views and Settings, `update_actor` and `update_project_features` exist;
- P5's assistant panel with propose-then-Apply (`propose_*` stubs for every mutating
  tool) exists;
- P7's `notify()`, `NotificationKind` `intake_received`, relations
  (`addRelation`), the inbox, `SnoozeDialog` and `RelationPicker` exist.

This is a plan, one level lighter than a contract. A planner refreshes it into the
full P8 contract right before the build. Items marked **refresh before build**
depend on code that P4–P7 have not written yet, or on a line count only their
results can give.

Sources: docs/PLAN.md decision 5 (intake statuses, estimate types), decision 27
(intake policy), §1 rows "Drafts", "Intake", "Estimates", "Bulk operations", "Copy
and move across projects" and "Project settings … Agents tab (which actors may
write, intake policy)", §2 "Planning extras (P8)" and the invariants (Intake,
Estimates, Drafts), §4 "Drafts, intake, estimates" and the destructive list, §8
"Intake triage help", §9 P8 row, §12 browser step 9; docs/drafts/p4-ui.md deferrals
(per-agent write permission, research GAP 7; Estimates tab and the Intake and
Estimates switches; filters on Archives › Work items "with the bulk bar"; engine
refusal for the intake toggle); docs/drafts/p5-plan.md deferral (intake triage
proposals); docs/drafts/p7-plan.md decision 51 (`intake_received`). Astryx props were
checked in `node_modules/@astryxdesign/core/dist/*/*.d.ts` 0.6.8 ("Astryx
verification" in §6).

What already exists (verified on `e03e664`):
- Tables `draft_work_item`, `intake`, `intake_item`, `estimate`, `estimate_point`
  (`db/schema.ts` lines 587–678, created by `0000_init`), row types in `types.ts`
  (`DraftWorkItemRow`, `IntakeRow`, `IntakeItemRow`, `EstimateRow`,
  `EstimatePointRow`), `IntakeStatusSchema`, `IntakeSourceSchema`,
  `EstimateTypeSchema` in `schemas.ts`, `ViewSettingsScopeSchema` value `draft`.
- `project.intake_enabled`, `estimates_enabled`, `agent_intake_required`,
  `estimate_id`; `updateProjectFeatures` creates the hidden triage state and the
  default intake (`enableIntake`, projects.ts:245) and refuses to turn Intake off
  while items are pending or snoozed (`intake_pending`, projects.ts:422).
- The intake policy (decision 27) on the create path: `intakeRequired`,
  `ensureDefaultIntake`, `recordIntakeItem` in `work-items.ts` (lines 993–1056; after
  P4 in `work-items/create.ts`); `copyWorkItem` and `moveWorkItemToProject` follow it;
  pending items are hidden from lists and counts (`WorkItem.intake`); no state change
  takes a pending item out of triage (`assertNotTriage`, `triage_state`).
- `estimate_point_id` on work items with `resolveEstimatePoint` (same project);
  points progress in cycles and modules (`activeEstimateId`, `parsePointValue` in
  cycles.ts:192–205, used by modules.ts:290) and `sumPoints` in counts.ts; the cycle
  pages show points when `hasActiveEstimate` (cycle-data.ts:14).
- `bulkUpdateWorkItems(ids, patch)` and tool `bulk_update_work_items` (scalar
  fields only, one transaction); `copy_work_item` and `move_work_item_to_project`
  (engine and tools; the UI has "Copy" in the detail only, `copyWorkItemAction`).
- UI placeholders: PropertyRail's disabled Estimate selector ("Arrives in P8"),
  `item.estimate` (`shift+e`) and `nav.intake` (`g x`) marked `arrives: "P8"` in
  `shortcuts.ts`; P4's Features rows for Intake and Estimates disabled, the Agents tab
  line "Per-agent write permissions arrive in P8."
- `CreateWorkItemDialog` asks "discard this work item?" when a dirty dialog closes.
- `scripts/mcp-call.ts` always connects as client `p3-acceptance`.

Exit criteria (PLAN §9 P8) and where they are proven:
- "Intake policy test: MCP create lands in triage when required": Vitest
  `tests/intake-policy.test.ts` "MCP create lands in triage when required" (through
  `InMemoryTransport`) and acceptance steps 5–7.
- "Bulk archive refuses mixed groups": Vitest `tests/bulk.test.ts` "bulk archive
  refuses mixed groups and archives nothing" and acceptance step 21.

### 1. Scope and deferrals

In scope:
- **Intake**: project Intake tab (two panes: Open / Snoozed / Closed list, the
  selected item's detail with Accept, Decline, Snooze, Mark duplicate, Delete), "New
  intake item" in the app, the Intake feature switch live, MCP and assistant tools,
  the `intake_received` inbox notification, assistant triage proposals.
- **Per-agent write permission** (P4 deferral, GAP 7): `actor.access`
  `write | intake | read`, enforced for every adapter, set on the Agents tab.
- **Drafts**: workspace `/drafts` list, draft dialog, "Save this draft?" when a dirty
  create dialog closes, "Move to project", sidebar Drafts item with a count, `g y`.
- **Estimates**: project settings Estimates tab (create from a template, edit values,
  replace, delete), the Estimates feature switch live, `EstimateControl` in the
  property rail, create dialog, table column, list and board chips, `shift+e`, Power K
  "Estimate…", points-mode progress for `points` systems.
- **Bulk**: row selection in the List and Table layouts, a bulk bar (state, priority,
  assignees, labels, cycle, modules, dates, estimate, archive, delete), bulk restore
  and delete on Archives › Work items with its filter bar (P4 deferral).
- **Copy and move across projects**: "Copy to project…" and "Move to project…"
  dialogs in the detail's menu and the list row menu.

| Deferred | Phase | Note |
|---|---|---|
| Sidebar project `…` menu "Draft work item" | P9 (sidebar pass) | `/drafts` "New draft" covers it |
| Estimate totals in group headers and analytics by points | P9 (analytics) | Cycle and module progress show points in P8 |
| Time estimates in progress charts (hours burndown) | not planned | `time` systems show values only (decision 66) |
| Bulk selection on the board, calendar and gantt | not planned | Plane selects in list and spreadsheet only |
| Bulk "Move to project" and bulk copy | P10 (remaining operations) | One item at a time in P8 |
| Layout switch and display menu on Archives › Work items | P10 | P8 adds filters and the bulk bar on the list (decision 71) |
| Multiple intakes per project (`intake.is_default` false rows) | not planned | One default intake per project, as Plane CE |
| Intake email or form sources | never | U8 (no publishing, no accounts) |
| Intake filters beyond tab, search and source | P10 (rich filters) | |
| Per-project access overrides (an agent writes in one project only) | P10 (remaining settings) | `actor.access` is workspace-wide (decision 63) |
| Automations acting on snoozed intake items | P10 | Snooze wakes at read time (decision 61) |
| Keyboard range selection beyond shift+click | P11 (hardening) | |

### 2. New decisions (lane A writes them into docs/PLAN.md after row 60)

| # | Decision |
|---|---|
| 61 | **Intake lifecycle.** One live `intake_item` per work item (partial unique index). The item stays in the hidden triage state until accepted. Status moves: `pending` → `accepted` / `declined` / `snoozed` / `duplicate`; `snoozed` → any of the others, or back to `pending` by `unsnooze`; `declined` and `duplicate` → `accepted` (reconsider) or `declined` (there is no reopen tool); `accepted` is final (RULE `intake_closed`). A snoozed item whose `snoozed_till` ≤ now counts as open at read time (no job writes it back). Tabs: **Open** = pending plus woken snoozed, **Snoozed** = snoozed in the future, **Closed** = accepted, declined, duplicate; each newest first by `intake_item.created_at`. Accept moves the work item to `state_id` (same project, not triage) or the project default state, sets `accepted`, logs `intake_accepted` on the item and makes it visible in lists and counts. Decline and duplicate keep the item in triage, hidden. Duplicate sets `duplicate_to_id` (any project, not itself, not a pending intake item) and adds a P7 `duplicate` relation between the two items. Delete (`delete_intake_item`) soft-deletes a non-accepted intake item with its work item (`deleteWorkItem`); an accepted one is RULE `intake_closed` (delete the work item instead). Accepted, declined and duplicate items cannot be snoozed. |
| 62 | **Intake sources and announcements.** `create_intake_item` puts an item straight into Intake for any actor; `source` = `in_app` for `user`, `assistant` for `assistant`, `mcp` for agents (input `source` is ignored except in tests). `create_work_item`, `copy_work_item` and `move_work_item_to_project` keep decision 27. Every new intake item created by an actor other than `user` sends `notify` kind `intake_received` to `user` inside the same transaction (P7 rules 50–51 apply: never for `assistant`). Activity: `entity_type "intake_item"`, verbs `created`, `accepted`, `declined`, `snoozed`, `unsnoozed`, `marked_duplicate`, `deleted`, with `work_item_id` set, so the changes poller refreshes open tabs. Intake turned off (`intake_enabled` false) makes `create_intake_item` RULE `feature_disabled` (decision 31 pattern); reads and existing rows stay. |
| 63 | **Per-agent write permission.** `actor.access` = `write` (default) / `intake` / `read`, meaningful only for kind `agent` (others always `write`). Enforced once in `runToolWithContext` before `def.run`: a mutating tool called by an agent with `read` → RULE `actor_read_only`; with `intake` → only `create_work_item`, `create_intake_item` and self-scoped tools pass (others RULE `actor_intake_only`), and `create_work_item` lands in Intake whatever the project policy (`intakeRequired` ORs `access === "intake"`); into a project with Intake off it is RULE `intake_disabled`. Self-scoped tools (`ToolDef.selfScoped: true`: the seven P7 notification tools) pass for every access. Only `user` may change `access` (`update_actor` by any other actor with `access` → RULE `actor_access_forbidden`); changing it logs `updated` field `access` on the actor. MCP adapters, the assistant's Apply and Server Actions all go through `runToolWithContext`, so no adapter needs its own check. |
| 64 | **Intake switch and policy.** Turning Intake on creates the triage state and default intake (as today). Turning it off is refused while open or snoozed items exist (`intake_pending`, as today) and then also sets `agent_intake_required` false in the same write. Turning `agent_intake_required` on while Intake is off → RULE `intake_disabled`. The project tab "Intake" shows when `intake_enabled`, with the open count as a `Badge`. |
| 65 | **Estimate systems.** At most one active estimate per project (`archived_at` null and not deleted; partial unique index on `project_id`), referenced by `project.estimate_id`. 2–6 points per system, stored in `position` order 0…n−1. Values: `points` = numbers ≥ 0 with at most two decimals, strictly ascending; `categories` = 1–24 characters, unique case-insensitively, in the given order; `time` = whole minutes 1–10,080, strictly ascending. `create_estimate` with an active system present archives it and remaps every work item's point to the new point with the same value (case-insensitive, same type only), clearing the rest; it is destructive. `update_estimate` takes the full ordered point list (ids keep their identity, new entries get ids, omitted ones are removed); a removed point that items use needs an entry in `remap` (`{ [removed_id]: new_point_id | null }`), else RULE `estimate_point_in_use` with the count. `delete_estimate` clears the points of every item that uses it and `project.estimate_id`. `estimates_enabled` off hides the estimate UI and points progress; the system and the items' points stay. `estimate_point_id` on a work item or draft must belong to the project's active system (`resolveEstimatePoint` gains that check: RULE `estimate_point_inactive`). Templates (client-safe `ESTIMATE_TEMPLATES`): points Fibonacci 1, 2, 3, 5, 8, 13; Linear 1–6; Squares 1, 4, 9, 16, 25, 36; categories T-shirt XS, S, M, L, XL, XXL; Easy to hard Easy, Medium, Hard, Very hard; time 30m, 1h, 2h, 4h, 8h, 16h (stored 30, 60, 120, 240, 480, 960); Custom = two blank rows. |
| 66 | **Points-mode progress** counts only an active system of type `points`: `activeEstimateId(ctx, projectRow)` returns null for `categories` and `time`, and counts' `pointsEnabled`/`sumPoints` add `estimate.type = 'points'`. The `Project` view model gains `estimate_type: EstimateType | null` (the active system's type) so `hasActiveEstimate` reads it. `time` values display as `1h 30m`, categories as their text, points as the number. |
| 67 | **Drafts.** Workspace-level rows (decision 1), newest `updated_at` first, never in search, lists, counts, notifications or the board. `project_id` is optional; the project-scoped fields (`state_id`, `parent_id`, `cycle_id`, `label_ids`, `module_ids`, `estimate_point_id`) need a project and are validated against it on every save with the create rules (no triage state, open cycle, unarchived modules); changing `project_id` clears them. `name` may be empty in a draft (shown "Untitled draft"); dates follow start ≤ target. `move_draft_to_project` (optional `project_id` when the draft has none) creates the work item through `createWorkItem` (so decisions 27 and 63 apply), drops ids that became stale (deleted or archived) and reports them as `dropped`, refuses an empty name (VALIDATION), and soft-deletes the draft in the same transaction. Activity rows `entity_type "draft"`, `entity_id` = draft id, `project_id` = the draft's project or null, verbs `created`, `updated`, `deleted`, `moved` (with `work_item_id` of the new item). Closing a dirty create dialog asks "Save this draft?" (Save draft / Discard / Keep editing). |
| 68 | **Bulk operations.** Selection lives in client state of the List and Table layouts (not the URL), at most 500 ids (`MAX_IDS`), cleared by Escape, by navigation and after a successful bulk write; rows that disappear after a refresh drop out. `bulk_update_work_items` gains optional `add_label_ids`, `remove_label_ids`, `add_assignee_ids`, `remove_assignee_ids`, `add_module_ids`, `remove_module_ids` beside `patch` (an id in both add and remove is VALIDATION); multi-valued edits in the bulk bar add or remove, never replace. `bulk_archive_work_items` archives only when every item is in a `completed` or `cancelled` group: otherwise RULE `archive_open_item` naming up to 5 keys and nothing changes. `bulk_unarchive_work_items` and `bulk_delete_work_items` act on archived or live items respectively (delete works on both, as `deleteWorkItem`). Every bulk tool is one transaction; one failure rolls back all. The UI confirms bulk delete only (AlertDialog); archive and edits are undoable by hand. |
| 69 | **Copy and move across projects** in the UI: "Copy to project…" and "Move to project…" open `ProjectTransferDialog` (project `Selector` of live projects; move excludes the current one; the dialog states the mapping rules of the tools) and run `copy_work_item` / `move_work_item_to_project`. After a move the detail navigates to the item's new route; after a copy a Toast offers "Open". Both are hidden for a pending intake item (the engine refuses, `intake_pending`) and for archived items. |
| 70 | **Assistant triage.** The Intake screen's "Triage with assistant" opens the P5 panel with scope `{ project_id }` and the prompt "Triage the open intake items: for each, propose accept, decline or mark as duplicate, with a one-line reason." `docs/contracts/ai.md` gains the rule: the assistant proposes intake actions only through `propose_accept_intake_item`, `propose_decline_intake_item`, `propose_mark_intake_duplicate` (which exist because the tools mutate), with the reason in the proposal text; it never proposes `delete_intake_item`. Apply follows U2 (all three are destructive, so Apply confirms). |
| 71 | **Archives › Work items** gets the work items `FilterBar` (filters in the URL `q`, same schema) and List-layout selection with a bulk bar of Restore and Delete; no layout switch or display menu (P10). |

### 3. Data model changes

All in `src/lib/tessera/db/schema/` after the P5 split (`core.ts` for `actor`,
`planning.ts` for the rest), one generated migration `drizzle/0005_planning.sql`
(+ `drizzle/meta/*`). It is `0005` because P5–P7 own `0002`–`0004` (**refresh before
build**: take the next free number).

| Table | Change | Why |
|---|---|---|
| `actor` | add `access text NOT NULL DEFAULT 'write'` (`$type<ActorAccess>()`) | decision 63 |
| `intake_item` | replace `intake_item_work_item_idx` with `intake_item_work_item_uq` = `uniqueIndex().on(t.work_item_id).where(DELETED_AT_IS_NULL)` | one live intake item per work item (decision 61) |
| `intake_item` | add index `intake_item_status_snooze_idx` on (`intake_id`, `status`, `snoozed_till`) | Open/Snoozed tabs and counts |
| `estimate` | add `estimate_active_uq` = `uniqueIndex().on(t.project_id).where(sql\`archived_at IS NULL AND deleted_at IS NULL\`)` | one active system (decision 65) |
| `estimate_point` | none (positions are rewritten in one transaction; a unique index on position would trip mid-rewrite) | service rule |
| `draft_work_item` | add index `draft_work_item_updated_idx` on (`updated_at`) | newest-first list |
| `estimate.last_used` | none; documented as unused (Plane column, kept for import compatibility) | |

Existing databases: every P8 table is empty in `data/tessera.db` except
`intake`/`intake_item` rows created by P1–P7 agents under the policy; the unique index
on `intake_item.work_item_id` cannot fail because the service has only ever written
one row per item (lane A asserts this with a pre-migration `SELECT work_item_id,
count(*) … HAVING count(*) > 1` in the migration test). No FTS table changes, so no
`db:fts-rebuild`. `drizzle-kit generate` must produce `ALTER TABLE actor ADD
COLUMN` (no rebuild of `actor`, which every table references): **refresh before
build**: run generate once and read the SQL; if it rebuilds `actor`, hand-write the
`ADD COLUMN` and the index statements.

Client-safe additions (lane 0, `schemas.ts` / `types.ts`):
- `ActorAccessSchema = z.enum(["write", "intake", "read"])`, type `ActorAccess`.
- `IntakeTabSchema = z.enum(["open", "snoozed", "closed"])`, type `IntakeTab`.
- `EstimateTemplateKeySchema` and `ESTIMATE_TEMPLATES: readonly { key; type: EstimateType; label: string; values: string[] }[]`
  (decision 65), `ESTIMATE_POINTS_MIN = 2`, `ESTIMATE_POINTS_MAX = 6`.
- Types: `IntakeItemView = { id; work_item_id; key; name; priority: Priority; label_ids: string[]; status: IntakeStatus; is_open: boolean; snoozed_till: string | null; duplicate_to: { id; key; name } | null; source: IntakeSource; created_by: { id; name; kind: ActorKind }; created_at; updated_at }`;
  `IntakeCounts = { open: number; snoozed: number; closed: number }`;
  `EstimateView = EstimateRow & { points: EstimatePointRow[] }`;
  `DraftView = DraftWorkItemRow & { project: { id; name; identifier } | null }`;
  `Project` gains `estimate_type: EstimateType | null` (decision 66).

### 4. Engine additions (lane A)

Files (each under 600 lines; folder only if a file would pass 500):

| File | Content |
|---|---|
| `src/lib/tessera/intake-policy.ts` | moved by lane 0 from `work-items/create.ts` (`findDefaultIntake`, `ensureDefaultIntake`, `recordIntakeItem`, `intakeRequired`); lane A extends `intakeRequired` (access), `recordIntakeItem` (notify, decision 62) |
| `src/lib/tessera/intake.ts` | list, get, create, accept, decline, snooze, unsnooze, mark duplicate, delete, counts |
| `src/lib/tessera/drafts.ts` | draft CRUD and move to project |
| `src/lib/tessera/estimates.ts` | estimate systems |
| `src/lib/tessera/estimate-points.ts` | moved by lane 0 from cycles.ts (`activeEstimateId`, `parsePointValue`); lane A changes `activeEstimateId` to `(ctx, projectRow)` |
| `src/lib/tessera/work-items/bulk.ts` | `bulkUpdateWorkItems` (moved from `update.ts` by lane A) with the add/remove sets, `bulkArchiveWorkItems`, `bulkUnarchiveWorkItems`, `bulkDeleteWorkItems` |
| `src/lib/tessera/tools/registry/{intake,drafts,estimates}.ts` | tools below; `registry/index.ts` adds them to `TOOLS` |
| `src/lib/tessera/tools/registry/access.ts` | `assertToolAllowed(ctx, def)` (decision 63), called from `runToolWithContext` |

Signatures (inputs are strict zod objects exported beside each function; ids are
`IdSchema`):

```ts
// intake.ts
export const ListIntakeItemsInput = z.object({ project_id: IdSchema, tab: IntakeTabSchema.default("open"), search: z.string().trim().max(200).optional(), source: IntakeSourceSchema.optional(), limit: z.number().int().min(1).max(500).default(200) }).strict();
export function listIntakeItems(ctx, input): ListResult<IntakeItemView> & { counts: IntakeCounts };
export function getIntakeItem(ctx, id: string): IntakeItemView;               // by intake_item id
export function getIntakeItemForWorkItem(ctx, workItemId: string): IntakeItemView | null;
export function countOpenIntake(ctx, projectId: string): number;               // project tab badge
export const CreateIntakeItemInput = CreateWorkItemInput.pick({ project_id, name, description_md, priority, label_ids, assignee_ids, start_date, target_date }).strict();
export function createIntakeItem(ctx, input): IntakeItemView;                  // RULE feature_disabled when intake is off
export function acceptIntakeItem(ctx, id, input: { state_id?: string }): IntakeItemView;
export function declineIntakeItem(ctx, id): IntakeItemView;
export function snoozeIntakeItem(ctx, id, input: { until: string /* ISO datetime, future */ }): IntakeItemView;
export function unsnoozeIntakeItem(ctx, id): IntakeItemView;
export function markIntakeDuplicate(ctx, id, input: { duplicate_of_id: string }): IntakeItemView;
export function deleteIntakeItem(ctx, id): void;

// drafts.ts
export const DraftFieldsInput = z.object({ project_id: IdSchema.nullable(), name: z.string().trim().max(255), description_md, state_id: IdSchema.nullable(), priority: PrioritySchema, parent_id: IdSchema.nullable(), cycle_id: IdSchema.nullable(), label_ids: IdListSchema.max(MAX_IDS), module_ids: IdListSchema.max(MAX_IDS), assignee_ids: IdListSchema.max(MAX_IDS), estimate_point_id: IdSchema.nullable(), start_date: IsoDateSchema.nullable(), target_date: IsoDateSchema.nullable() }).partial().strict();
export function listDrafts(ctx, input: { project_id?: string; limit?: number }): ListResult<DraftView>;
export function getDraft(ctx, id): DraftView;
export function countDrafts(ctx): number;                                        // sidebar badge
export function createDraft(ctx, input: DraftFieldsInputType): DraftView;
export function updateDraft(ctx, id, patch: DraftFieldsInputType): DraftView;
export function deleteDraft(ctx, id): void;
export function moveDraftToProject(ctx, id, input: { project_id?: string }): { work_item: WorkItem; dropped: string[] };

// estimates.ts
export const EstimatePointInput = z.object({ id: IdSchema.optional(), value: z.string().trim().min(1).max(24), description: z.string().max(200).default("") }).strict();
export function listEstimates(ctx, input: { project_id: string; include_archived?: boolean }): EstimateView[];
export function getEstimate(ctx, id): EstimateView;
export function getActiveEstimate(ctx, projectId): EstimateView | null;
export function createEstimate(ctx, input: { project_id; name; type: EstimateType; points: EstimatePointInput[] /* 2–6, no ids */ }): EstimateView;
export function updateEstimate(ctx, id, input: { name?; points?: EstimatePointInput[]; remap?: Record<string, string | null> }): EstimateView;
export function deleteEstimate(ctx, id): void;
export function validateEstimateValues(type: EstimateType, values: string[]): void; // exported for tests

// work-items/bulk.ts
export const BulkUpdateWorkItemsInput = z.object({ ids, patch: UpdateWorkItemInput.default({}), add_label_ids, remove_label_ids, add_assignee_ids, remove_assignee_ids, add_module_ids, remove_module_ids }).strict();
export function bulkUpdateWorkItems(ctx, input): WorkItem[];                     // signature changes from (ids, patch): refresh callers
export function bulkArchiveWorkItems(ctx, ids: string[]): WorkItem[];
export function bulkUnarchiveWorkItems(ctx, ids: string[]): WorkItem[];
export function bulkDeleteWorkItems(ctx, ids: string[]): { ids: string[]; deleted: true };
```

Edits to existing engine files:
- `actors.ts`: `UpdateActorInput` gains `access: ActorAccessSchema`; `updateActor` refuses
  `access` for non-agent targets (RULE `builtin_actor`) and from a caller other than
  `user` (RULE `actor_access_forbidden`).
- `projects.ts`: decision 64 in `updateProjectFeatures`; `Project` view model
  `estimate_type` (join on `project.estimate_id`); `deleteProject` keeps the project's
  drafts but sets their `project_id` to null and clears their project-scoped fields in
  the same transaction (the FK `set null` covers hard deletes only); it soft-deletes
  the project's estimates with their points.
- `work-items/create.ts`: `resolveEstimatePoint` requires the active system (decision 65).
- `work-items/update.ts`: `bulkUpdateWorkItems` moves to `bulk.ts`; `applyPatch` exported.
- `cycles.ts`, `modules.ts`: one-line call changes to `activeEstimateId(ctx, projectRow)`
  (no growth; lower their budget entries).
- `counts.ts`: `pointsEnabled` and `sumPoints` join `estimate` with `type = 'points'`.
- `notifications.ts` (P7): `notificationText` for `intake_received` = "{actor} submitted
  {key} to Intake".
- `ai/prompts.ts` (P5): the triage rule (decision 70); `describeScope` for a project adds
  "N open intake items".
- `tools/define.ts`: `ToolDef.selfScoped?: true`; the P7 notification tools set it.
- `tools/registry/index.ts`: `runToolWithContext` calls `assertToolAllowed(ctx, def)`.
- `tools/mcp.ts`: tool descriptions only (no logic; access is enforced in the registry).
- `scripts/mcp-call.ts`: `--client <name>` flag (default `p3-acceptance`) so acceptance
  can act as two agents.

Tools (23 new; MCP names get the `tessera_` prefix):

| Tool | Flags | Notes |
|---|---|---|
| `list_intake_items`, `get_intake_item` | read | `get` by intake item id |
| `create_intake_item` | mutates | decision 62 |
| `accept_intake_item` | mutates, destructive | optional `state_id` |
| `decline_intake_item` | mutates, destructive | |
| `snooze_intake_item`, `unsnooze_intake_item` | mutates | `until` ISO datetime in the future (VALIDATION otherwise) |
| `mark_intake_duplicate` | mutates, destructive | `duplicate_of_id` |
| `delete_intake_item` | mutates, destructive | |
| `list_drafts`, `get_draft` | read | |
| `create_draft`, `update_draft` | mutates | |
| `delete_draft` | mutates, destructive | |
| `move_draft_to_project` | mutates | returns `{ work_item, dropped }` |
| `list_estimates`, `get_estimate` | read | |
| `create_estimate` | mutates, destructive | may replace the active system |
| `update_estimate` | mutates, destructive | may remove points |
| `delete_estimate` | mutates, destructive | |
| `bulk_archive_work_items` | mutates, destructive | |
| `bulk_unarchive_work_items` | mutates | |
| `bulk_delete_work_items` | mutates, destructive | |
| `bulk_update_work_items` (changed) | as before | input gains the add/remove sets; `patch` becomes optional |
| `update_actor` (changed) | as before | input gains `access` |

`registry.test.ts` keeps the one-to-one rule: every new mutating export
(`createIntakeItem` … `bulkDeleteWorkItems`) is bound by exactly one tool; helpers
(`countOpenIntake`, `countDrafts`, `getActiveEstimate`, `validateEstimateValues`,
`getIntakeItemForWorkItem`) are read-only names outside the mutation prefixes
(**refresh before build**: check the prefix list in `registry.test.ts`).

Tests (Vitest, in-memory SQLite with all migrations):
- `tests/intake.test.ts`: create in app (`in_app`, no notification), by an agent
  (`mcp`, `intake_received` to user), by the assistant (no notification); accept into
  default and into a chosen state (triage refused); decline hides; reconsider a
  declined item; snooze in the past is VALIDATION; snoozed item wakes at read time into
  Open; duplicate adds a `duplicate` relation and refuses itself; accepted is final;
  delete removes the work item; tab counts; `feature_disabled` with Intake off.
- `tests/intake-policy.test.ts`: the exit criterion through `InMemoryTransport` (MCP
  `create_work_item` with the policy on lands in triage, absent from
  `list_work_items` and `get_counts`, present in `list_intake_items`); with the policy
  off it lands on the board; copy and move by an agent follow the policy.
- `tests/actor-access.test.ts`: `read` agent's mutating call → `actor_read_only`
  through MCP and through `runToolWithContext`; `read` agent may still mark its own
  notifications read; `intake` agent's `create_work_item` lands in triage with the
  project policy off and is `intake_disabled` with Intake off; `intake` agent's
  `update_work_item` → `actor_intake_only`; an agent changing any `access` →
  `actor_access_forbidden`; `user` changing `assistant` access → `builtin_actor`.
- `tests/drafts.test.ts`: workspace draft without project; project fields refused
  without a project; changing project clears them; move creates the item with labels,
  cycle and modules and deletes the draft in one transaction; stale label dropped and
  reported; empty name refused at move; intake agent's move lands in Intake.
- `tests/estimates.test.ts`: 1 and 7 points refused; value rules per type; one active
  system (second create archives the first, same-type remap by value, cross-type
  clear); update keeps ids, removes with and without remap; delete clears items;
  inactive point refused on update; points progress ignores `categories` and `time`.
- `tests/bulk.test.ts`: the exit criterion "bulk archive refuses mixed groups and
  archives nothing"; add/remove labels keep other labels; an id in add and remove is
  VALIDATION; bulk delete deletes subtrees; one bad id rolls back all; 501 ids refused.
- `tests/migrations.test.ts` (or the existing foundation test): `0005` applies on a
  copy of a P7-era database with intake rows; `actor.access` defaults to `write`.

### 5. Routes and data loading

Every page: synchronous shell → `<Suspense fallback={<Skeleton …/>}>` → async child
that awaits `params` / `searchParams`, `await io()`, then `readTessera(fn)` from
`@/lib/tessera/server` (field guide "Next 16").

| Route | Loads | Notes |
|---|---|---|
| `(tessera)/projects/[projectId]/intake/page.tsx` | `listIntakeItems({ project_id, tab, search })`, and when `item` is set `getWorkItem(item)` + `getIntakeItemForWorkItem(item)` | `?tab=open|snoozed|closed&q=<search>&item=<workItemId>`; two Suspense boundaries (list, detail) like P7's inbox; the project bundle comes from the project layout; `FeatureOffState` when `intake_enabled` is false (P4 pattern) |
| `(tessera)/drafts/page.tsx` | `listDrafts({})`, `listProjects({})`; when `draft` is set: `getDraft(draft)` and the project bundle of `project ?? draft.project_id` (the builder used by `work-items/load-detail.ts`) | `?draft=<id>|new&project=<projectId>`; the dialog sits inside a `ProjectProvider` when a project is chosen |
| `(tessera)/projects/[projectId]/settings/estimates/page.tsx` | `listEstimates({ project_id, include_archived: true })` | P4 settings frame |
| `(tessera)/projects/[projectId]/archives/work-items/page.tsx` (changed) | `listWorkItems({ scope: archived, filters from q })` | decision 71 |
| `(tessera)/projects/[projectId]/layout.tsx` (changed) | bundle gains `estimate: getActiveEstimate()` (null when estimates are off) and `intake_open: countOpenIntake()` (0 when intake is off) | also the two bundles in `work-items/load-detail.ts` and the drafts page builder |
| `(tessera)/layout.tsx` sidebar data (changed) | `countDrafts()` for the Drafts item | **refresh before build**: where P7 put the inbox unread count, add drafts beside it |

Server Actions (`toolAction` wrappers; one file per owner):
- `src/app/actions/intake.ts`: `createIntakeItemAction`, `acceptIntakeItemAction`,
  `declineIntakeItemAction`, `snoozeIntakeItemAction`, `unsnoozeIntakeItemAction`,
  `markIntakeDuplicateAction`, `deleteIntakeItemAction`.
- `src/app/actions/drafts.ts`: `createDraftAction`, `updateDraftAction`,
  `deleteDraftAction`, `moveDraftToProjectAction`.
- `src/app/actions/estimates.ts`: `createEstimateAction`, `updateEstimateAction`,
  `deleteEstimateAction`.
- `src/app/actions/work-items.ts` (changed): `bulkArchiveWorkItemsAction`,
  `bulkUnarchiveWorkItemsAction`, `bulkDeleteWorkItemsAction`,
  `moveWorkItemToProjectAction`.
- `src/app/actions/settings.ts` (P4, changed): `updateActorAction` already exists; the
  access selector uses it.
(PLAN §5 lists `actions/drafts-intake.ts`; P8 splits it in two so each lane owns one
file. Lane A updates the PLAN line.)

Recents (`recents.ts` `resolveRoute`, `shell-icons.ROUTE_ICONS`):
- `/drafts` → "Drafts", icon `drafts` (`DraftIcon`).
- `/projects/<p>/intake` → "<project> · Intake", icon `intake` (`IntakeIcon`).
- `/projects/<p>/settings/estimates` → already "<project> · Settings · Estimates" (P4 rule).
- Query params (`item`, `draft`) never create separate entries (paths only, as today).
- `forgetRecentsUnder` is not needed: no P8 route is deleted.

Shortcuts and Power K (`shortcuts.ts`, `command-source.ts`):
- `g x` Intake (current project; disabled with "Turn on Intake in Features" when off),
  `g y` Drafts (moves from P9 to P8), `shift+e` Estimate… (needs an item and an active
  estimate; otherwise a Toast "Turn on estimates in project settings").
- Power K: "Estimate…" on an open item (options from the bundle), "Go to Intake",
  "Go to Drafts", "New draft" (opens `/drafts?draft=new`).

### 6. Screens and components

Astryx verification (0.6.8, `dist/*/*.d.ts`): `ListItem { label, description,
startContent, endContent, href, isSelected, isDisabled, onClick, interactiveRef }`;
`CheckboxInput { label, isLabelHidden, value: boolean | "indeterminate", onChange,
isDisabled, size }`; `useTableSelection({ getIsItemSelected, onSelectItem,
onSelectAll, getIsAllSelected, getIsIndeterminate?, getRowLabel?, hasRowHighlight? })`
and `useTableSelectionState({ data, idKey, selectedKeys, setSelectedKeys })` →
`{ selectionConfig, selectionState }` (Table plugins); `Toolbar` requires `label` and
has a roving tabindex (not used, field guide); `DropdownMenuCheckboxItem { label,
value: boolean, onChange, hasCloseOnSelect, icon }`; `Selector { label, options,
value, onChange, hasClear, placeholder, isDisabled, disabledMessage, size, variant,
renderOption, renderValue }`; `RadioList { label, value, onChange, orientation }` with
`RadioListItem { label, value, description, startContent }`; `DateTimeInput { label,
value, onChange, min, hasClear }`; `Tab { value, label, href, icon, endContent }`;
`Dialog { isOpen, onOpenChange, width, purpose, padding, children }` and
`AlertDialog { isOpen, onOpenChange, title, description, actionLabel, actionVariant,
cancelLabel, isActionLoading, onAction }` imported from `@/components/shell/dialogs`;
`Banner { status, title, description, endContent }`; `EmptyState { title,
description, icon, actions }`; `TextInput { label, value, onChange, onEnter }`;
`SegmentedControl { value, onChange, label, size }`.

Icons (lane 0, `src/themes/catppuccin/icons.tsx`, after a `// P8 intake, drafts,
estimates, bulk.` comment; all Phosphor names verified in
`node_modules/@phosphor-icons/react/dist/csr/`): `IntakeIcon` changes from `Tray` to
`duotoneIcon(TrayArrowDown)` (P7's `InboxIcon` keeps `Tray`; the two must differ),
`DraftIcon = duotoneIcon(NotePencil)`, `AcceptIcon = duotoneIcon(CheckCircle)`,
`DeclineIcon = duotoneIcon(XCircle)`, `DuplicateIcon = duotoneIcon(CopySimple)`,
`SelectIcon = duotoneIcon(CheckSquare)`, `MoveToProjectIcon = duotoneIcon(ArrowBendDownRight)`.
`EstimateIcon`, `ArchiveIcon`, `TrashIcon`, `RestoreIcon` and P7's `SnoozeIcon` exist.

Stylesheets (lane 0, imported once from `globals.css`): `styles/intake.css`,
`styles/drafts.css`, `styles/estimates.css`, `styles/bulk.css`. Tokens only.

#### U1 Intake (`src/components/intake/`)

- `IntakeScreen` (`"use client"`): `Layout` with a start `LayoutPanel width={360}
  hasDivider label="Intake items"` and the content. List panel: `PanelBar` with
  `TabList` Open / Snoozed / Closed (`Tab endContent={<Badge>}` counts, `href` keeps
  `q`), a `TextInput label="Search intake" isLabelHidden hasClear`
  (debounced 300 ms into `q`), "New intake item" (`Button size="sm"`, opens
  `CreateWorkItemDialog mode="intake"`), "Triage with assistant" (`Button
  variant="ghost" size="sm" icon={<SparkleIcon/>}`, hidden when the assistant status is
  off; decision 70). List: `List hasDividers density="balanced"` of `IntakeRow`;
  `EmptyState` per tab ("Nothing waiting" / "Nothing snoozed" / "Nothing closed yet").
- `IntakeRow`: `ListItem href="?tab=…&item=<work_item_id>" isSelected`, `startContent`
  the priority icon, `label` name, `description` "`KEY` · `<actor>` via
  `<In app|Assistant|MCP>` · `<RelativeTime hasTooltip={false}>`", `endContent` a
  `Token size="sm"`: "Snoozed until <date>", "Declined", "Duplicate of KEY", "Accepted"
  (none for pending).
- `IntakeDetailPane`: `IntakeActionBar` above P2b's `WorkItemDetail` in its embedded
  mode (**refresh before build**: the prop P7's inbox detail uses). `EmptyState` "Select
  an intake item" when `item` is missing.
- `IntakeActionBar`: `Banner status="info" title="In Intake" description="Submitted by
  <actor> via <source> <RelativeTime>"` (status "Declined" / "Duplicate of KEY" /
  "Snoozed until …" when not pending) and `endContent`: Accept (`Button
  variant="primary" size="sm" icon={<AcceptIcon/>}` → `acceptIntakeItemAction`, then a
  Toast "Accepted KEY into <state>" with "Open" and selection of the next open item),
  Decline (→ `AlertDialog` "Decline this work item?" / "It moves to Closed. You can
  still accept it later." / actionLabel "Decline"), Snooze… (P7 `SnoozeDialog`,
  **refresh before build**: its props; if it is notification-specific, U1 adds an
  `onSnooze(untilIso)` prop in a core change), Mark duplicate… (`DuplicateDialog`),
  and a `MoreMenu` with Delete (`AlertDialog`, actionVariant destructive). Accepted
  items show only "Open in project". All buttons disabled for an archived project.
- `DuplicateDialog`: `Dialog width={480}` with P7's `RelationPicker` (ComplexSelector
  over `/api/search`, excluding the item itself and pending intake items) and "Mark
  duplicate".
- `intake-format.ts` (no directive): `sourceLabel`, `statusToken(view, today)`, `nextOpenItem(list, id)`;
  test `tests/ui/intake-format.test.ts`.
- Project frame: `project-tabs.ts` adds `intake` (segment `intake`, after Pages, shown
  when `intake_enabled`); `ProjectFrame.tsx` maps it to `IntakeIcon` and passes
  `endContent={<Badge>}` when `bundle.intake_open > 0`. Tests
  `tests/ui/project-tabs.test.ts`.
- Settings (P4 files): `FeaturesSettings` makes the Intake switch live; turning it off
  with open items shows the engine's message in the Toast. `AgentsSettings`: the
  intake-policy switch live (disabled with "Turn on Intake first" while off); each
  agent row gets an access `Selector size="sm" label="Access" isLabelHidden` with
  options "Can write", "Intake only", "Read only" → `updateActorAction({ actor_id,
  access })`; the "Per-agent write permissions arrive in P8." line goes; the
  description under the Actors heading says "Read-only agents can still read and
  manage their own inbox."

#### U2 Estimates (`src/components/estimates/`, settings, properties)

- `settings-tabs.ts` (P4) adds `estimates` ("Estimates") after Labels;
  `FeaturesSettings` Estimates switch live (owned by U1, which edits that file once
  for both switches; U2 only reads it).
- `EstimatesSettings`: with no active system an `EmptyState` "No estimate system"
  with "Create estimate system"; otherwise a section with `Heading level={5}` the
  system name, a `Token` of its type, a `List density="compact" hasDividers` of the
  points (`label` formatted value, `description` the point's description), and
  buttons "Edit values" and a `MoreMenu` with "Replace…" and "Delete…". Archived
  systems below under "Previous systems" (read-only rows with archived date).
- `EstimateDialog` (`Dialog width={560}`): step 1 (create/replace only) `RadioList
  label="Type"` Points / Categories / Time with descriptions, then `RadioList
  label="Template"` from `ESTIMATE_TEMPLATES` of that type plus Custom; step 2 a
  `TextInput label="Name"` and 2–6 rows of `TextInput` (value) + `TextInput`
  (description) with "Move up"/"Move down"/"Remove" in a `MoreMenu`, "Add value"
  (disabled at 6). Client validation mirrors decision 65 (`estimate-rules.ts`, pure,
  shared with tests); replace shows a `Banner status="warning"` "Items keep their
  value when the new system has the same value; others lose their estimate."
  Removing a used point in edit mode asks for a replacement point in a `Selector`
  ("Move items to…", options the remaining points and "No estimate") → `remap`.
- `estimate-format.ts` (lane 0, no directive): `formatEstimateValue(type, value)`
  (`time` → `1h 30m`), `estimateOptions(estimate)`; test
  `tests/ui/estimate-format.test.ts`.
- `properties/EstimateControl.tsx` (lane 0): `Selector label="Estimate" hasClear`
  over `bundle.estimate.points` (`renderValue` formatted), hidden when
  `!bundle.project.estimates_enabled || !bundle.estimate`.
- Placement (U2 owns these files): `PropertyRail.tsx` replaces the disabled Estimate
  selector with `EstimateControl` → `updateWorkItemAction({ estimate_point_id })`; for
  an item in the triage state the state control is disabled with "Accept it in Intake
  to choose a state"; `WorkItemDetail.tsx` wires `shift+e` to open the estimate
  selector; `command-source.ts` adds the "Estimate…" command; `cycle-data.ts`
  `hasActiveEstimate` reads `project.estimate_type === "points"`.

#### U3 Bulk, copy and move (`src/components/work-items/`, detail header, archives)

- `selection.ts` (no directive): `type Selection = ReadonlySet<string>`;
  `toggle(sel, id)`, `selectRange(sel, orderedIds, anchorId, id)`,
  `selectAll(orderedIds)`, `prune(sel, presentIds)`, `MAX_SELECTION = 500`; test
  `tests/ui/selection.test.ts`. `use-selection.ts` (`"use client"`): state, the shift
  anchor, Escape to clear (`useHotkeys`), prune on `result` change, clear on pathname
  change.
- `ListLayout.tsx`: each row's `startContent` gains a `CheckboxInput size="sm"
  isLabelHidden label={`Select ${key}`}` (visible on row hover or focus and always
  while any row is selected, via `bulk.css`); group headers get a select-group
  checkbox (`"indeterminate"` when partial). Not in a read-only layout.
- `TableLayout.tsx`: `useTableSelectionState` + `useTableSelection({ …selectionConfig,
  getRowLabel: (item) => item.key, hasRowHighlight: true })` with the shared selection
  state; the estimate column (P4 left `bundle` reserved for it) renders
  `formatEstimateValue`, editable through `EstimateControl` in the cell.
- `ListLayout.tsx`, `BoardLayout.tsx`: the estimate property chip when the display
  property `estimate` is on and the item has a point.
- `BulkBar` (`"use client"`): an `HStack className="tessera-bulk-bar" role="region"
  aria-label="Bulk actions"` pinned to the bottom of the work items content (not an
  Astryx `Toolbar`: field guide), shown while the selection is non-empty: `Text`
  "`n` selected", "Clear" (`Button variant="ghost" size="sm"`), then `size="sm"`
  controls: `StateControl`, `PriorityControl`, `CycleControl` (when cycles are on),
  `DateControl` start and target, `EstimateControl` (when on) — each applies on change
  through `bulkUpdateWorkItemsAction({ ids, patch })`; Labels, Assignees, Modules as
  `DropdownMenu` buttons whose `DropdownMenuCheckboxItem value` is true when every
  selected item has the value (`hasCloseOnSelect={false}`; toggling true removes from
  all, false adds to all → `add_*` / `remove_*`); Archive (`ArchiveIcon`) →
  `bulkArchiveWorkItemsAction` (engine refusal shows its message in a Toast and the
  selection stays); Delete (`TrashIcon`) → `AlertDialog` "Delete n work items?" →
  `bulkDeleteWorkItemsAction`. Success: Toast "Updated n work items" and clear.
- `WorkItemsScreen.tsx`: owns the selection hook, passes it to List/Table, renders
  `BulkBar`; selection disabled for board, read-only layouts and views that are locked
  (**refresh before build**: P4's locked-view rule). If the file passes 560 lines,
  U3 extracts the selection wiring into `use-bulk.ts` first.
- Archives › Work items (`planning/ArchivedWorkItems.tsx` and its page): the
  `FilterBar` with filters in `q` (decision 71), row checkboxes and a `BulkBar
  variant="archived"` with Restore (`bulkUnarchiveWorkItemsAction`) and Delete.
- `ProjectTransferDialog` (`src/components/detail/`): `Dialog width={480}`, `Selector
  label="Project"` of live projects (move excludes the current one), a `Text
  type="supporting"` with the rules (copy: "The copy keeps description, priority, dates
  and labels with the same name; cycle, modules, estimate and assignees are cleared."
  move: "The item gets a new key. Labels and the state are matched by name; cycle,
  modules, estimate and parent are cleared; sub-items stay."), primary "Copy" / "Move".
  Opened from the detail header's menu ("Copy to project…", "Move to project…";
  `DetailHeader.tsx`) and from the list row's menu (**refresh before build**: whether
  the list row has a `MoreMenu` after P4–P7; if not, the detail only).

#### U4 Drafts and shell (`src/components/drafts/`, create dialog, sidebar)

- `DraftsScreen`: `PanelHeader label="Drafts"` with "New draft" (`Button size="sm"` →
  `?draft=new`); `List hasDividers density="balanced"` of `DraftRow`: `ListItem
  onClick` → `?draft=<id>`, `startContent` `DraftIcon`, `label` name or "Untitled
  draft", `description` "<Project name> · edited <RelativeTime>" ("No project" when
  null), `endContent` a `MoreMenu` Edit / Move to project / Delete (`AlertDialog`).
  `EmptyState` "No drafts" ("Drafts you save from the create dialog show up here.").
- `DraftDialog` (`Dialog width={640}`): the create dialog's fields over a draft (a
  `Selector label="Project" hasClear` first; changing it calls `updateDraftAction({
  project_id })` and navigates to `?draft=<id>&project=<pid>` so the server loads the
  bundle), autosave of name and description on blur and Enter, the property controls
  only when a project is chosen; footer "Delete draft" (ghost), "Save draft", "Create
  work item" (primary, disabled without a project or name) → `moveDraftToProjectAction`
  → Toast "Created KEY" with "Open" (and "Dropped: …" when `dropped` is non-empty), then
  back to `/drafts`. "New draft" creates on first save (no row until then).
- `CreateWorkItemDialog.tsx`: closing a dirty dialog opens `SaveDraftDialog` (`Dialog
  width={420}`, title "Save this draft?", body "You can finish it later from Drafts.",
  buttons "Keep editing", "Discard", "Save draft" → `createDraftAction` with every
  filled field → Toast "Draft saved" with "Open drafts"). New prop `mode?: "work_item"
  | "intake"`: `intake` hides state, cycle, modules and estimate, titles the dialog "New
  intake item" and submits `createIntakeItemAction`; "Save this draft?" is offered in
  `work_item` mode only. Adds `EstimateControl` beside the date controls.
- Shell: `Sidebar.tsx` "Drafts" item (`DraftIcon`, `href="/drafts"`, `Badge` count when
  > 0) after Inbox; `shortcuts.ts` drops `arrives` for `item.estimate`, `nav.intake`,
  `nav.drafts` (and `nav.settings` if P4 left it); `recents.ts` + `shell-icons.ts` as in
  §5; `useShortcuts.ts` handlers for `g x` and `g y`.

### 7. Lane split for swarm workers

| Lane | Starts | Owns (one owner per file) |
|---|---|---|
| **0 prep** (alone, mechanical) | first | `src/lib/tessera/intake-policy.ts` (moved from `work-items/create.ts`: `findDefaultIntake`, `ensureDefaultIntake`, `recordIntakeItem`, `intakeRequired`, verbatim, create.ts imports them); `src/lib/tessera/estimate-points.ts` (moved from cycles.ts: `activeEstimateId`, `parsePointValue`; cycles.ts and modules.ts import from it; lower the cycles.ts budget entry to its new length); `schemas.ts`/`types.ts` additions of §3; `components/work-items/types.ts` (`ProjectBundle.estimate: EstimateView \| null`, `intake_open: number`; every builder sets `null`/`0` for now); `properties/EstimateControl.tsx` + `properties/index.ts` export; `components/estimates/estimate-format.ts`; icons; the four stylesheets and their `globals.css` imports. Gate: `npm run check` green, no behaviour change, every new file ≤ 600 lines. **Refresh before build**: re-read `scripts/file-budget.json` after P7; if `work-items/create.ts`, `work-items/update.ts`, `WorkItemsScreen.tsx`, `TableLayout.tsx` or `ListLayout.tsx` is within 40 lines of 600 or listed, lane 0 splits it first (cut at section comments, verbatim). |
| **A engine** | after 0 | `src/lib/tessera/{intake,drafts,estimates,intake-policy,estimate-points,actors,projects,counts}.ts`, `work-items/{bulk,create,update}.ts`, the one-line edits in `cycles.ts`/`modules.ts`, `notifications.ts` (`intake_received` text), `ai/prompts.ts` (decision 70 rule and the scope line), `db/schema/{core,planning}.ts`, `drizzle/0005_*`, `tools/{define,registry/*}.ts`, `tools/mcp.ts` (descriptions), `scripts/mcp-call.ts`, every `tests/*.test.ts` of §4, `docs/contracts/{schema,service-api,tools,ai}.md`, decisions 61–71 into `docs/PLAN.md` (and the §5 actions line). Hands off the action-facing tool names on day 1 (they are fixed in this plan), so UI lanes can write wrappers against them. |
| **U1 intake and access** | after 0 (wires actions as A lands) | `src/app/(tessera)/projects/[projectId]/intake/**`, `src/components/intake/**`, `src/app/actions/intake.ts`, `components/work-items/project-tabs.ts`, `ProjectFrame.tsx`, P4's `project-settings/{FeaturesSettings,AgentsSettings}.tsx`, `tests/ui/{intake-format,project-tabs}.test.ts`; core change if needed: P7 `SnoozeDialog` `onSnooze` prop |
| **U2 estimates** | after 0 | `src/components/estimates/**` (except `estimate-format.ts` after lane 0 hands it over: U2 then owns it), `projects/[projectId]/settings/estimates/**`, P4's `settings-tabs.ts`, `src/app/actions/estimates.ts`, `detail/PropertyRail.tsx`, `detail/WorkItemDetail.tsx`, `shell/command-source.ts`, `projects/[projectId]/layout.tsx`, `work-items/load-detail.ts` (bundle `estimate` and `intake_open`), `cycles/cycle-data.ts`, `tests/ui/{estimate-format,estimate-rules}.test.ts` |
| **U3 bulk, copy, move** | after 0 | `components/work-items/{selection,use-selection,BulkBar,ListLayout,TableLayout,BoardLayout,WorkItemsScreen}.ts(x)` (+ `use-bulk.ts` if split), `detail/{ProjectTransferDialog,DetailHeader}.tsx`, `planning/ArchivedWorkItems.tsx`, `projects/[projectId]/archives/work-items/**`, `src/app/actions/work-items.ts`, `tests/ui/selection.test.ts` |
| **U4 drafts and shell** | after 0 | `src/app/(tessera)/drafts/**`, `src/components/drafts/**`, `src/app/actions/drafts.ts`, `work-items/CreateWorkItemDialog.tsx`, `shell/{Sidebar,shortcuts,useShortcuts,recents,shell-icons}.ts(x)`, the sidebar data loader in `(tessera)/layout.tsx` (or wherever P7 loads the inbox count), `tests/ui/recents.test.ts` additions |

Cross-lane contracts fixed here so no two lanes decide the same question: tool names
and inputs (§4), `ProjectBundle` fields (lane 0), `EstimateControl` props
(`{ value: string | null; onChange(value: string | null); size?: "sm" | "md"; isLabelHidden?: boolean }`),
`CreateWorkItemDialog` `mode` prop (U4 builds it, U1 calls it), `BulkBar` `variant:
"active" | "archived"` (U3).

### 8. New dependencies

None. Every API comes from installed packages (Astryx 0.6.8, Drizzle 0.45.4,
drizzle-kit 0.31.11, zod 4, `@phosphor-icons/react` already in use). The licence gate
is unchanged.

### 9. Acceptance (on a fresh `data/p8-acceptance.db` after `next build`)

Stop the dev server, `next build`, move any old `data/p8-acceptance.db*` to the
scratchpad, then start `next start -H 127.0.0.1 -p 3000` (or `next dev`, field guide)
with `TESSERA_DB_PATH=data/p8-acceptance.db`. MCP calls:
`TESSERA_DB_PATH=data/p8-acceptance.db npx tsx scripts/mcp-call.ts --client <name> <tool> '<json>'`.
Check the console on every screen (only the known Astryx Table warnings), Frappé and
Latte at 1440 and 375.

1. Create project `WEB` in the app. Settings › Features: turn on Intake and
   Estimates. The Intake tab appears (no badge); the Estimates settings tab shows "No
   estimate system".
2. Settings › Agents: the intake-policy switch is enabled; turn it on.
3. MCP as `bot-a`: `list_projects` (registers `mcp:bot-a`). Agents tab lists it with
   access "Can write".
4. Estimates: "Create estimate system" → Points → Fibonacci → name "Story points" →
   Create. The list shows 1, 2, 3, 5, 8, 13.
5. MCP as `bot-a`: `create_work_item { project_id, name: "Fix login" }`. The board does
   not show it; the Intake tab shows badge 1; Inbox shows "mcp:bot-a submitted WEB-1
   to Intake" (unread badge +1).
6. Open Intake › Open › "Fix login": the action bar says "Submitted by mcp:bot-a via
   MCP"; the state control is disabled with the triage message.
7. Accept. Toast "Accepted WEB-1 into Backlog"; the item is in Closed as Accepted;
   Work items shows WEB-1 at the bottom of Backlog; counts +1 (PLAN §12 step 9).
8. MCP as `bot-a`: create "Dark mode" and "Login broken". In the app, Mark "Login
   broken" duplicate of WEB-1 → Closed shows "Duplicate of WEB-1"; WEB-1's detail
   shows the duplicate relation.
9. Snooze "Dark mode" to a time 2 minutes ahead → it moves to Snoozed; after it passes
   and the page refreshes it is back in Open.
10. Decline "Dark mode" (confirm) → Closed "Declined"; then Accept it from Closed →
    it lands in Backlog.
11. "New intake item" in the app: "Spec review" → Open shows it with "via In app"; no
    inbox notification. Delete it from the menu (confirm) → gone from every tab.
12. Agents tab: set `mcp:bot-a` to "Read only". MCP `update_work_item` on WEB-1 →
    `RULE actor_read_only`; MCP `list_notifications` still works.
13. Set `mcp:bot-a` to "Intake only"; turn the project policy off. MCP
    `create_work_item` → lands in Intake anyway; MCP `update_work_item` →
    `RULE actor_intake_only`.
14. MCP as `bot-a`: `update_actor { actor_id: <bot-a>, access: "write" }` →
    `RULE actor_access_forbidden`.
15. Detail of WEB-1: Estimate selector shows the six values; pick 5; `shift+e` opens
    it again; Power K "Estimate…" lists them. Table layout shows the Estimate column.
16. Create cycle "Sprint 1" with WEB-1 and WEB-2; set WEB-2 to 3 and move WEB-1 to
    Done → cycle progress shows "5 of 8 points".
17. Estimates › Edit values: remove 13 (unused) and save → five values, no prompt;
    then remove 5 → the dialog asks where its items go; choose 3 → WEB-1 shows 3.
18. Replace… with Categories › T-shirt → Banner warning; confirm → WEB-1 and WEB-2
    lose their estimate; the cycle shows no points line; the old system is under
    "Previous systems".
19. List layout: hover a row → checkbox; select three items (click, shift+click) →
    bulk bar "3 selected". Set priority High → all three High, selection clears.
20. Select two, Labels menu → tick "bug" → both get "bug", other labels stay; untick
    → removed from both.
21. Select one Done and one Backlog item → Archive → Toast "Only completed or cancelled
    work items can be archived (WEB-…)"; nothing archived (exit criterion). Select only
    the Done item → Archive → it moves to Archives.
22. Archives › Work items: filter by label, select it, Restore → back in the list.
    Select two items in the Table layout → Delete → confirm → gone; Escape clears a
    selection.
23. Detail menu "Copy to project…" → project `OPS` (create it first) → Toast "Copied as
    OPS-1" → Open shows "(Copy)". "Move to project…" on WEB-2 → navigates to its
    `OPS-2` route; `/browse/WEB-2` no longer resolves.
24. Drafts: open "New work item", type a name, press Escape → "Save this draft?" →
    Save draft. Sidebar Drafts badge 1; `g y` opens Drafts; the row shows WEB.
25. Open the draft, add label "bug" and cycle "Sprint 1", Save; then "Create work item"
    → Toast "Created WEB-n"; the draft is gone; the item has the label and the cycle.
26. "New draft" with no project → name only → Save; "Create work item" is disabled
    until a project is chosen; choosing WEB reloads the fields; Delete draft → gone.
27. Intake turned off with open items → Toast with "Intake cannot be disabled while 1
    intake item(s) are pending"; accept it, then turn Intake off → the tab disappears
    and the policy switch is off and disabled.
28. Assistant on (P5): Intake › "Triage with assistant" with two open items → the
    panel shows proposals (accept or decline with reasons); Apply asks to confirm;
    nothing changes before Apply.
29. Recents: Intake, Drafts and Settings › Estimates appear with their labels and
    icons; `/projects/<WEB>/intake?item=…` does not add a second entry.
30. `npm run check` green; `grep -r "Arrives in P8" src` empty.

### 10. Risks

| Risk | Mitigation |
|---|---|
| The access check misses an adapter (assistant Apply, a Server Action calling a service directly) | Enforced in `runToolWithContext`, the single entry; `actor-access.test.ts` covers MCP and the registry; a convention grep that `src/app/actions/*.ts` call only `toolAction`/`runTool` (exists for P1) |
| An agent locks itself out or escalates | Only `user` changes `access` (decision 63); self-scoped tools keep the inbox usable |
| The `intake_item` unique index fails on an old database | Migration test on a P7-era copy; the service never wrote two rows per item; backup before migrate (PLAN §2) |
| drizzle-kit rebuilds `actor` for `ADD COLUMN` | Hand-write the migration (§3); `foreign_keys=ON` during a rebuild would cascade |
| `bulkUpdateWorkItems` signature change breaks callers (P5 Apply previews, actions) | `tsc` lists them; lane A fixes engine callers, U3 the action wrapper; tool input stays a superset (`patch` optional) |
| Estimate replace silently wipes points users relied on | Same-type value remap; destructive flag (assistant confirm, MCP `confirm`); warning Banner |
| Selection state leaks across Activity-hidden routes (Next keeps routes mounted) | Clear on pathname change and on `hidden` (field guide "Activity") |
| `WorkItemsScreen.tsx` and the layouts pass the file budget | Lane 0 checks and splits; U3 extracts `use-bulk.ts` at 560 lines |
| Snooze wake-up is read-time only, so the Intake badge lags until the next refresh | The changes poller refreshes on any activity; acceptance step 9 reloads; P10 automations may add a timer |
| `IntakeIcon` change collides with P7's `InboxIcon` (both `Tray`) | Lane 0 changes `IntakeIcon` to `TrayArrowDown` |
| Drafts page needs a project bundle the global shell does not have | Server-loaded via `?project=` (no client fetch of bundles); one builder shared with `load-detail.ts` |

### 11. Open questions for the user (each with the default the plan uses)

1. **Default access for new MCP agents**: keep "Can write" (default), or start every
   new agent as "Intake only"? Default: "Can write", so existing agent setups keep
   working; the project policy covers the cautious case.
2. **Reconsidering closed intake items**: may a declined or duplicate item still be
   accepted later? Default: yes (decision 61); accepted stays final.
3. **Mark duplicate also adds a `duplicate` relation**: default yes, so the original
   shows it. Alternative: only set `duplicate_to_id`.
4. **Replacing an estimate system**: keep points whose value matches (default), or
   always clear every item's estimate (the strict PLAN invariant)?
5. **Time estimates**: keep the `time` type with minutes and no progress charts
   (default), or drop it from the type picker until hours burndown exists?
6. **Drafts without a project**: allowed (default), or must every draft belong to a
   project as in Plane's create flow?
7. **Bulk on the board**: not planned (default, as Plane). Want selection on board
   cards too?
8. **Accept goes to the project default state** with no state picker in the UI
   (default; the tool takes `state_id` for agents). Want an "Accept into…" menu?

### Refresh before build (checklist for the contract planner)

- Next free migration number and decision number (here 0005 and 61–71).
- `db/schema/` file names from P5 lane 0; generate once and read the `actor` SQL.
- `work-items/create.ts` names and lines of the intake helpers; `update.ts` `applyPatch`.
- `registry.test.ts` mutation prefixes; `ToolDef` shape after P5 (`selfScoped`).
- P7 `SnoozeDialog`, `RelationPicker`, the inbox's embedded detail prop, the sidebar
  count loader, `notify` signature; P5 `AssistantProvider` open API.
- P4 `project-tabs.ts` order after P6 (Pages); P4 settings file names; locked-view rule.
- Line counts of `WorkItemsScreen.tsx`, `ListLayout.tsx`, `TableLayout.tsx`,
  `BoardLayout.tsx`, `CreateWorkItemDialog.tsx`, `PropertyRail.tsx` against 600.
- Whether the list row has a `MoreMenu` (copy/move entry point).
