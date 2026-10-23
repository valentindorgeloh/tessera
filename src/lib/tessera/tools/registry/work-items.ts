import { z } from "zod";
import { IdListSchema } from "../../schemas";
import { MAX_IDS } from "../../work-items/model";
import { setAssignees, SetAssigneesInput, subscribe, SubscribeInput, unsubscribe } from "../../assignees";
import { listActivity, ListActivityInput } from "../../changes";
import {
  archiveWorkItem,
  bulkArchiveWorkItems,
  bulkTransferWorkItems,
  BulkTransferWorkItemsInput,
  bulkDeleteWorkItems,
  bulkUnarchiveWorkItems,
  bulkUpdateWorkItems,
  BulkUpdateWorkItemsInput,
  copyWorkItem,
  CopyWorkItemInput,
  createWorkItem,
  CreateWorkItemInput,
  deleteWorkItem,
  getWorkItem,
  getWorkItemByKey,
  listChildren,
  listWorkItems,
  ListWorkItemsInput,
  moveWorkItem,
  MoveWorkItemInput,
  moveWorkItemToProject,
  MoveWorkItemToProjectInput,
  setLabels,
  SetLabelsInput,
  setModules,
  SetModulesInput,
  unarchiveWorkItem,
  updateWorkItem,
  UpdateWorkItemInput,
  updateWorkItemDescription,
  UpdateWorkItemDescriptionInput,
} from "../../work-items";
import { defineTool } from "../define";
import { ProjectId, WorkItemId, WorkItemIdInput, deleted, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Work items (P1)
// ---------------------------------------------------------------------------

const GetWorkItemByKeyInput = z
  .object({
    key: z.string().trim().min(1).max(64).describe("Work item key such as WEB-12 (case-insensitive); an id is accepted too."),
  })
  .strict();

const SetLabelsToolInput = z
  .object({
    work_item_id: WorkItemId,
    label_ids: SetLabelsInput.describe("Label ids of the item's project; the item ends up with exactly these labels."),
  })
  .strict();

const SetModulesToolInput = z
  .object({
    work_item_id: WorkItemId,
    module_ids: SetModulesInput.describe("Module ids of the item's project; the item ends up in exactly these modules."),
  })
  .strict();

const SetAssigneesToolInput = z
  .object({
    work_item_id: WorkItemId,
    actor_ids: SetAssigneesInput.describe("Actor ids; the item ends up assigned to exactly these live actors."),
  })
  .strict();

const ListArchivedWorkItemsInput = ListWorkItemsInput.omit({ scope: true }).extend({
  project_id: ProjectId,
});

export const workItemTools = [
  defineTool({
    name: "list_work_items",
    title: "List work items",
    description:
      "Lists work items for a scope (project, cycle, module, saved view, workspace, profile tab, archived or draft) with Filters combined by AND and Display for ordering and grouping; a view scope merges the caller's filters over the saved ones. Returns items, total, the change cursor and groups when display.group_by is set. With display.group_by, per_group_limit pages every group (counts and has_more stay exact), group_value (and sub_group_value) pages inside one group with limit/offset. calendar_window keeps the items targeted inside a period plus the unscheduled ones. Use describe_filters for the vocabulary.",
    input: ListWorkItemsInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, input) => listWorkItems(ctx, input),
  }),
  defineTool({
    name: "get_work_item",
    title: "Get work item",
    description: "Returns the full work item by id: fields, labels, assignees, modules, parent, links, subscribers and the description with its version.",
    input: WorkItemIdInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id }) => getWorkItem(ctx, work_item_id),
  }),
  defineTool({
    name: "get_work_item_by_key",
    title: "Get work item by key",
    description: "Returns the full work item by its key such as WEB-12; the only tool that takes a key instead of an id. Ids are accepted as well. A key with a project's former identifier (before a rename), or the key the item had before it was moved to another project, still resolves; a former identifier loses to a project that uses it now.",
    input: GetWorkItemByKeyInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { key }) => getWorkItemByKey(ctx, key),
  }),
  defineTool({
    name: "create_work_item",
    title: "Create work item",
    description:
      "Creates a work item in a project and assigns the next key. State, labels, modules, cycle, parent and estimate must belong to the same project; the state defaults to the project default and the triage state is reserved for Intake. start_date must not be after target_date, closed items cannot join a cycle, and the parent chain must stay acyclic. When the project requires agent intake, items created by agents land in Intake. Mention an actor as [@Name](actor:<id>), with ids from list_actors; a newly mentioned actor is notified.",
    input: CreateWorkItemInput,
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, input) => createWorkItem(ctx, input),
  }),
  defineTool({
    name: "update_work_item",
    title: "Update work item",
    description:
      "Changes work item fields; only the keys sent change. state_id (same project) drives completed_at by state group and cannot take an item out of Intake while its intake item is pending (RULE intake_pending), parent_id must be in the same project and acyclic, cycle_id rejects completed or cancelled items and never joins or leaves a completed cycle (LOCKED) or an archived one (ARCHIVED), and start_date must not be after target_date. Archived items and items of archived projects are read-only (ARCHIVED). Use update_work_item_description for the body.",
    input: UpdateWorkItemInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id, ...patch }) => updateWorkItem(ctx, work_item_id, patch),
  }),
  defineTool({
    name: "update_work_item_description",
    title: "Update work item description",
    description:
      "Replaces the Markdown body with optimistic concurrency: expected_description_version is the description_version the client last read, and the call fails with CONFLICT when the body changed since. Re-read the item and retry on CONFLICT. Mention an actor as [@Name](actor:<id>), with ids from list_actors; a newly mentioned actor is notified.",
    input: UpdateWorkItemDescriptionInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id, ...input }) => updateWorkItemDescription(ctx, work_item_id, input),
  }),
  defineTool({
    name: "move_work_item",
    title: "Move work item",
    description:
      "Reorders a work item (before_id / after_id) and, with group_by and value, changes the grouped field as a board or list drop does. For labels, assignees and module, from_value is the value the item leaves and the others are kept; value null or \"none\" clears the field. sub_group_by, sub_value and sub_from_value change a second axis (a board swimlane) in the same call; both changes or neither are written.",
    input: MoveWorkItemInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id, ...input }) => moveWorkItem(ctx, work_item_id, input),
  }),
  defineTool({
    name: "bulk_update_work_items",
    title: "Bulk update work items",
    description:
      "Applies the same update_work_item patch to up to 500 items in one transaction, and can add or remove labels, assignees and modules without replacing the rest. An id in both add and remove is VALIDATION. One failure rolls back all of them. Destructive because it rewrites many items at once.",
    input: BulkUpdateWorkItemsInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, input) => bulkUpdateWorkItems(ctx, input),
  }),
  defineTool({
    name: "copy_work_item",
    title: "Copy work item",
    description:
      "Creates a copy named \"<name> (Copy)\" with a new key, in the item's own project or in project_id. The copy keeps description, priority, dates and labels (mapped by name across projects, unmapped ones dropped), the parent only within the same project and the state (mapped by name across projects, else the target default); cycle, modules, estimate and assignees are cleared and sub-items are never copied. When the target project requires agent intake, a copy made by an agent lands in Intake; an item still pending in Intake cannot be copied (RULE intake_pending).",
    input: CopyWorkItemInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id, ...input }) => copyWorkItem(ctx, work_item_id, input),
  }),
  defineTool({
    name: "move_work_item_to_project",
    title: "Move work item to project",
    description:
      "Moves a work item (same id) into another project: it gets a new key there, labels are mapped by name (unmapped ones dropped), the state is mapped by name or falls back to the target default, cycle, modules, estimate and parent are cleared, sub-items are detached and stay in the old project, assignees and subscribers are kept. When the target project requires agent intake, a move by an agent lands the item in that project's Intake. RULE for the same project or while an intake item is pending. Destructive because the old key stops resolving.",
    input: MoveWorkItemToProjectInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { work_item_id, ...input }) => moveWorkItemToProject(ctx, work_item_id, input),
  }),
  defineTool({
    name: "set_labels",
    title: "Set labels",
    description: "Replaces the item's labels with exactly label_ids (labels of the item's project; an empty list clears them). Added and removed labels are logged individually.",
    input: SetLabelsToolInput,
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id, label_ids }) => setLabels(ctx, work_item_id, label_ids),
  }),
  defineTool({
    name: "set_modules",
    title: "Set modules",
    description: "Replaces the item's module memberships with exactly module_ids (modules of the item's project; an empty list removes it from every module).",
    input: SetModulesToolInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id, module_ids }) => setModules(ctx, work_item_id, module_ids),
  }),
  defineTool({
    name: "set_assignees",
    title: "Set assignees",
    description: "Replaces the item's assignees with exactly actor_ids (live actors; an empty list unassigns). Newly assigned actors are subscribed to the item.",
    input: SetAssigneesToolInput,
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, { work_item_id, actor_ids }) => setAssignees(ctx, work_item_id, actor_ids),
  }),
  defineTool({
    name: "subscribe_work_item",
    title: "Subscribe to work item",
    description: "Subscribes an actor (the calling actor when actor_id is omitted) to a work item so it shows in their subscribed tab; subscribing twice is a no-op. Archived items are read-only (ARCHIVED).",
    input: SubscribeInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id, actor_id }) => subscribe(ctx, work_item_id, actor_id),
  }),
  defineTool({
    name: "unsubscribe_work_item",
    title: "Unsubscribe from work item",
    description: "Removes an actor's subscription (the calling actor when actor_id is omitted); unsubscribing when not subscribed is a no-op. Archived items are read-only (ARCHIVED).",
    input: SubscribeInput.extend({ work_item_id: WorkItemId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id, actor_id }) => unsubscribe(ctx, work_item_id, actor_id),
  }),
  defineTool({
    name: "archive_work_item",
    title: "Archive work item",
    description: "Archives a work item; only completed or cancelled items can be archived (RULE archive_open_item). Archived items are read-only and listed through the archived scope.",
    input: WorkItemIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id }) => archiveWorkItem(ctx, work_item_id),
  }),
  defineTool({
    name: "unarchive_work_item",
    title: "Unarchive work item",
    description: "Restores an archived work item to its project lists; RULE not_archived when it is not archived.",
    input: WorkItemIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { work_item_id }) => unarchiveWorkItem(ctx, work_item_id),
  }),
  defineTool({
    name: "list_archived_work_items",
    title: "List archived work items",
    description: "Lists the archived work items of a project with the same filters, display and paging as list_work_items (the archived scope).",
    input: ListArchivedWorkItemsInput,
    mutates: false,
    phase: "P1",
    run: (ctx, { project_id, ...rest }) => listWorkItems(ctx, { ...rest, scope: { type: "archived", project_id } }),
  }),
  defineTool({
    name: "delete_work_item",
    title: "Delete work item",
    description: "Soft-deletes a work item together with its whole sub-item tree, their label, module, assignee and subscriber rows and their intake items; keys are not reused. Works on archived items. Destructive.",
    input: WorkItemIdInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { work_item_id }) => {
      deleteWorkItem(ctx, work_item_id);
      return deleted(work_item_id);
    },
  }),
  defineTool({
    name: "list_children",
    title: "List sub-items",
    description: "Lists the direct sub-items of a work item (items whose parent_id is this item) in sequence order.",
    input: WorkItemIdInput,
    mutates: false,
    phase: "P1",
    run: (ctx, { work_item_id }) => toListResult(ctx, listChildren(ctx, work_item_id)),
  }),
  defineTool({
    name: "list_activity",
    title: "List activity",
    description:
      "Returns the activity feed of exactly one work item (its own rows plus memberships and relations logged on it) or one whole project, newest first, with consecutive description edits by the same actor collapsed. cycle_id or module_id returns the feed of a cycle or module and the work items in it. since_seq limits the feed to rows after a cursor.",
    input: ListActivityInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, input) => toListResult(ctx, listActivity(ctx, input)),
  }),
  defineTool({
    name: "bulk_transfer_work_items",
    title: "Bulk copy or move work items to a project",
    description:
      "Copies or moves up to 100 work items into project_id in one transaction, applying the single-item rules of copy_work_item and move_work_item_to_project to each; one refusal rolls back all of them. Returns { id, key } per resulting item. mode move needs confirm: true because the old keys stop resolving.",
    input: BulkTransferWorkItemsInput,
    mutates: true,
    phase: "P10",
    run: (ctx, input) => bulkTransferWorkItems(ctx, input),
  }),
  defineTool({
    name: "bulk_archive_work_items",
    title: "Bulk archive work items",
    description: "Archives up to 500 work items in one transaction, and only when every item is completed or cancelled. Otherwise RULE archive_open_item names the open keys and nothing is archived. Destructive.",
    input: z.object({ ids: IdListSchema.min(1).max(MAX_IDS).describe("Work items to archive, at most 500.") }).strict(),
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { ids }) => bulkArchiveWorkItems(ctx, ids),
  }),
  defineTool({
    name: "bulk_unarchive_work_items",
    title: "Bulk unarchive work items",
    description: "Restores up to 500 archived work items in one transaction. An item that is not archived fails the whole call and nothing is restored.",
    input: z.object({ ids: IdListSchema.min(1).max(MAX_IDS).describe("Archived work items to restore, at most 500.") }).strict(),
    mutates: true,
    phase: "P8",
    run: (ctx, { ids }) => bulkUnarchiveWorkItems(ctx, ids),
  }),
  defineTool({
    name: "bulk_delete_work_items",
    title: "Bulk delete work items",
    description: "Soft-deletes up to 500 work items and their sub-item trees in one transaction. A missing id rolls back the whole call. Works on archived items. Destructive.",
    input: z.object({ ids: IdListSchema.min(1).max(MAX_IDS).describe("Work items to delete, at most 500.") }).strict(),
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { ids }) => bulkDeleteWorkItems(ctx, ids),
  }),
];
