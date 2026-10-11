/**
 * The tool registry (docs/contracts/tools.md): one ToolDef per public
 * operation of the engine. Server Actions, MCP and the assistant all go
 * through `runToolWithContext`, so this file is the single place that maps a
 * tool name to a service function, its strict input schema and its flags.
 *
 * Conventions: inputs take ids (fields ending in `_id`), never keys, except
 * `get_work_item_by_key`; list tools return `ListResult`; delete tools return
 * `{ id, deleted: true }`; every mutating tool runs its service function,
 * which owns the transaction, the activity rows and the FTS updates.
 */
import { z } from "zod";
import { latestSeq } from "../activity";
import { listActors, registerActor, RegisterActorInput, updateActor, UpdateActorInput } from "../actors";
import { setAssignees, SetAssigneesInput, subscribe, SubscribeInput, unsubscribe } from "../assignees";
import { listActivity, ListActivityInput, listChanges, ListChangesInput } from "../changes";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { getCounts, GetCountsInput } from "../counts";
import {
  addWorkItemsToCycle,
  archiveCycle,
  createCycle,
  CreateCycleInput,
  CycleWorkItemIdsInput,
  deleteCycle,
  getActiveCycles,
  getCycle,
  getCycleProgress,
  GetCycleProgressInput,
  listCycles,
  ListCyclesInput,
  removeWorkItemsFromCycle,
  reorderCycle,
  ReorderCycleInput,
  transferCycleWorkItems,
  TransferCycleWorkItemsInput,
  unarchiveCycle,
  updateCycle,
  UpdateCycleInput,
} from "../cycles";
import { createLabel, CreateLabelInput, deleteLabel, listLabels, reorderLabel, ReorderLabelInput, updateLabel, UpdateLabelInput } from "../labels";
import { addLink, AddLinkInput, removeLink, updateLink, UpdateLinkInput } from "../links";
import {
  addModuleLink,
  AddModuleLinkInput,
  addWorkItemsToModule,
  archiveModule,
  createModule,
  CreateModuleInput,
  deleteModule,
  getModule,
  getModuleProgress,
  listModules,
  ListModulesInput,
  ModuleWorkItemIdsInput,
  removeModuleLink,
  removeWorkItemsFromModule,
  reorderModule,
  ReorderModuleInput,
  setModuleMembers,
  SetModuleMembersInput,
  unarchiveModule,
  updateModule,
  UpdateModuleInput,
  updateModuleLink,
  UpdateModuleLinkInput,
} from "../modules";
import {
  archiveProject,
  createProject,
  CreateProjectInput,
  deleteProject,
  getProject,
  listProjects,
  ListProjectsInput,
  unarchiveProject,
  updateProject,
  UpdateProjectInput,
  updateProjectFeatures,
  UpdateProjectFeaturesInput,
} from "../projects";
import { IdSchema } from "../schemas";
import { searchAll, SearchAllInput } from "../search";
import {
  createState,
  CreateStateInput,
  deleteState,
  DeleteStateInput,
  listStates,
  reorderState,
  ReorderStateInput,
  setDefaultState,
  updateState,
  UpdateStateInput,
} from "../states";
import { getViewSettings, resetViewSettings, saveViewSettings, SaveViewSettingsInput, ViewSettingsScopeInput } from "../view-settings";
import { createView, CreateViewInput, deleteView, duplicateView, getView, listViews, ListViewsInput, lockView, unlockView, updateView, UpdateViewInput } from "../views";
import {
  archiveWorkItem,
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
  type ListResult,
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
} from "../work-items";
import { defineTool, TOOL_PHASES, type ToolDef, type ToolPhase, type Toolset } from "./define";
import { describeFilters } from "./describe-filters";

// ---------------------------------------------------------------------------
// Shared input pieces and result shapes
// ---------------------------------------------------------------------------

const ProjectId = IdSchema.describe("Project id.");
const StateId = IdSchema.describe("State id.");
const LabelId = IdSchema.describe("Label id.");
const ActorId = IdSchema.describe("Actor id.");
const WorkItemId = IdSchema.describe("Work item id.");
const CycleId = IdSchema.describe("Cycle id.");
const ModuleId = IdSchema.describe("Module id.");
const ViewId = IdSchema.describe("View id.");
const LinkId = IdSchema.describe("Link id.");

const EmptyInput = z.object({}).strict();
const ProjectIdInput = z.object({ project_id: ProjectId }).strict();
/** get_project is the one tool that resolves a project identifier as well as an id (the service already does). */
const GetProjectInput = z.object({ project_id: z.string().min(1).describe("Project id, or the project identifier such as WEB.") }).strict();
const StateIdInput = z.object({ state_id: StateId }).strict();
const LabelIdInput = z.object({ label_id: LabelId }).strict();
const WorkItemIdInput = z.object({ work_item_id: WorkItemId }).strict();
const CycleIdInput = z.object({ cycle_id: CycleId }).strict();
const ModuleIdInput = z.object({ module_id: ModuleId }).strict();
const ViewIdInput = z.object({ view_id: ViewId }).strict();
const LinkIdInput = z.object({ link_id: LinkId }).strict();

/** What `delete_*` tools return: the soft-deleted entity's id. */
export type DeleteResult = { id: string; deleted: true };

/** What `remove_*` tools that drop a row (links) return. */
export type RemoveResult = { id: string; removed: true };

function deleted(id: string): DeleteResult {
  return { id, deleted: true };
}

function removed(id: string): RemoveResult {
  return { id, removed: true };
}

/** List tools return ListResult; the cursor lets a page start the change poller without a second query. */
function toListResult<T>(ctx: TesseraContext, items: T[]): ListResult<T> {
  return { items, total: items.length, cursor: latestSeq(ctx) };
}

// ---------------------------------------------------------------------------
// Projects (P1)
// ---------------------------------------------------------------------------

const projectTools = [
  defineTool({
    name: "list_projects",
    title: "List projects",
    description:
      "Lists the workspace's projects with their feature toggles. Active projects by default; pass archived: true to list archived ones instead. Deleted projects never appear.",
    input: ListProjectsInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, input) => toListResult(ctx, listProjects(ctx, input)),
  }),
  defineTool({
    name: "get_project",
    title: "Get project",
    description: "Returns one project by id or by its identifier such as WEB. NOT_FOUND for deleted projects.",
    input: GetProjectInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => getProject(ctx, project_id),
  }),
  defineTool({
    name: "create_project",
    title: "Create project",
    description:
      "Creates a project and seeds its default states. The name is unique across the workspace (case-insensitive) and the identifier (2 to 12 letters or digits starting with a letter, upper-cased) becomes the key prefix of its work items; both fail with CONFLICT when taken. Cycles, modules, views and pages are on unless features says otherwise.",
    input: CreateProjectInput,
    mutates: true,
    core: true,
    phase: "P1",
    run: (ctx, input) => createProject(ctx, input),
  }),
  defineTool({
    name: "update_project",
    title: "Update project",
    description:
      "Changes project fields. A new identifier renames every work item key with it; name and identifier stay unique across the workspace. close_state_id must belong to the project. Archived projects are read-only (ARCHIVED).",
    input: UpdateProjectInput.extend({ project_id: ProjectId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id, ...patch }) => updateProject(ctx, project_id, patch),
  }),
  defineTool({
    name: "update_project_features",
    title: "Update project features",
    description:
      "Toggles the project's features. Enabling intake creates the hidden triage state; intake cannot be disabled while intake items are pending (RULE intake_pending). agent_intake_required sends work items created by agents to Intake instead of the board.",
    input: UpdateProjectFeaturesInput.extend({ project_id: ProjectId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id, ...patch }) => updateProjectFeatures(ctx, project_id, patch),
  }),
  defineTool({
    name: "archive_project",
    title: "Archive project",
    description: "Archives a project: it and everything in it become read-only and leave the default lists until unarchive_project.",
    input: ProjectIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id }) => archiveProject(ctx, project_id),
  }),
  defineTool({
    name: "unarchive_project",
    title: "Unarchive project",
    description: "Restores an archived project to the active list; RULE not_archived when it is not archived.",
    input: ProjectIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { project_id }) => unarchiveProject(ctx, project_id),
  }),
  defineTool({
    name: "delete_project",
    title: "Delete project",
    description:
      "Soft-deletes a project together with its states, labels, work items, cycles, modules, views and intakes in one transaction; works on archived projects too. Destructive: the UI confirms, assistant proposals are confirmed before they run and MCP requires confirm: true.",
    input: ProjectIdInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { project_id }) => {
      deleteProject(ctx, project_id);
      return deleted(project_id);
    },
  }),
  defineTool({
    name: "list_archived_projects",
    title: "List archived projects",
    description: "Lists archived projects only; the same rows list_projects returns with archived: true.",
    input: EmptyInput,
    mutates: false,
    phase: "P1",
    run: (ctx) => toListResult(ctx, listProjects(ctx, { archived: true })),
  }),
];

// ---------------------------------------------------------------------------
// States (P1)
// ---------------------------------------------------------------------------

const stateTools = [
  defineTool({
    name: "list_states",
    title: "List states",
    description: "Lists the states of a project in sequence order with their group, colour and default flag.",
    input: ProjectIdInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => toListResult(ctx, listStates(ctx, project_id)),
  }),
  defineTool({
    name: "create_state",
    title: "Create state",
    description:
      "Creates a state in a project. Names are unique per project (case-insensitive, CONFLICT otherwise); the group is one of backlog, unstarted, started, completed or cancelled and cannot change later. is_default makes it the project default and clears the previous one. Archived projects reject changes.",
    input: CreateStateInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => createState(ctx, input),
  }),
  defineTool({
    name: "update_state",
    title: "Update state",
    description: "Renames, recolours or re-describes a state; the group is fixed at creation and the new name stays unique within the project.",
    input: UpdateStateInput.extend({ state_id: StateId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id, ...patch }) => updateState(ctx, state_id, patch),
  }),
  defineTool({
    name: "reorder_state",
    title: "Reorder state",
    description: "Moves a state directly before or after another state of the same project; before_id or after_id is required.",
    input: ReorderStateInput.extend({ state_id: StateId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id, ...input }) => reorderState(ctx, state_id, input),
  }),
  defineTool({
    name: "set_default_state",
    title: "Set default state",
    description: "Makes the state the project's default for new work items and clears the flag on the previous default. The triage state cannot be the default (RULE triage_default).",
    input: StateIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { state_id }) => setDefaultState(ctx, state_id),
  }),
  defineTool({
    name: "delete_state",
    title: "Delete state",
    description:
      "Soft-deletes a state. The default state, the triage state and the last state of a group cannot be deleted (RULE). When work items still sit in the state, move_to_state_id names a different visible state of the same project that receives them (never the triage state); without it the call fails with RULE state_not_empty. Destructive.",
    input: DeleteStateInput.extend({ state_id: StateId }),
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { state_id, ...options }) => {
      deleteState(ctx, state_id, options);
      return deleted(state_id);
    },
  }),
];

// ---------------------------------------------------------------------------
// Labels (P1)
// ---------------------------------------------------------------------------

const labelTools = [
  defineTool({
    name: "list_labels",
    title: "List labels",
    description: "Lists the labels of a project in sequence order; nested labels carry their parent_id.",
    input: ProjectIdInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { project_id }) => toListResult(ctx, listLabels(ctx, project_id)),
  }),
  defineTool({
    name: "create_label",
    title: "Create label",
    description:
      "Creates a label in a project. Names are unique per project (case-insensitive, CONFLICT otherwise). parent_id nests it under a top-level label of the same project; labels nest one level deep (RULE label_depth).",
    input: CreateLabelInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => createLabel(ctx, input),
  }),
  defineTool({
    name: "update_label",
    title: "Update label",
    description:
      "Renames, recolours or re-parents a label. A label cannot be its own parent, a label with children cannot be nested, and the parent must be a top-level label of the same project; null parent_id moves it to the top level.",
    input: UpdateLabelInput.extend({ label_id: LabelId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { label_id, ...patch }) => updateLabel(ctx, label_id, patch),
  }),
  defineTool({
    name: "reorder_label",
    title: "Reorder label",
    description: "Moves a label directly before or after another label of the same project; before_id or after_id is required.",
    input: ReorderLabelInput.extend({ label_id: LabelId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { label_id, ...input }) => reorderLabel(ctx, label_id, input),
  }),
  defineTool({
    name: "delete_label",
    title: "Delete label",
    description: "Soft-deletes a label and its child labels, detaches them from every work item and page, and strips them from the saved filters of the project's views, of workspace views and of remembered list settings. Destructive.",
    input: LabelIdInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { label_id }) => {
      deleteLabel(ctx, label_id);
      return deleted(label_id);
    },
  }),
];

// ---------------------------------------------------------------------------
// Actors (P1)
// ---------------------------------------------------------------------------

const actorTools = [
  defineTool({
    name: "list_actors",
    title: "List actors",
    description: "Lists every actor: the built-in user, assistant and system actors plus the registered agents, with kind, colour and last_seen.",
    input: EmptyInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx) => toListResult(ctx, listActors(ctx)),
  }),
  defineTool({
    name: "register_actor",
    title: "Register actor",
    description:
      "Registers an agent actor so its changes are attributed; only kind agent registers itself, the built-in actors are seeded. MCP clients use the name mcp:<client_name>. Registering a name that already exists updates that actor's last_seen and client name and returns it instead of creating a duplicate. Returns the actor row to pass as actorId on later calls.",
    input: RegisterActorInput.strict(),
    mutates: true,
    phase: "P1",
    run: (ctx, input) => registerActor(ctx, input),
  }),
  defineTool({
    name: "update_actor",
    title: "Update actor",
    description: "Renames or recolours an actor (display name and palette colour); the kind never changes.",
    input: UpdateActorInput.strict().extend({ actor_id: ActorId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { actor_id, ...patch }) => updateActor(ctx, actor_id, patch),
  }),
];

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

const workItemTools = [
  defineTool({
    name: "list_work_items",
    title: "List work items",
    description:
      "Lists work items for a scope (project, cycle, module, saved view, workspace, profile tab, archived or draft) with Filters combined by AND and Display for ordering and grouping; a view scope merges the caller's filters over the saved ones. Returns items, total, the change cursor and groups when display.group_by is set. Use describe_filters for the vocabulary.",
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
    description: "Returns the full work item by its key such as WEB-12; the only tool that takes a key instead of an id. Ids are accepted as well.",
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
      "Creates a work item in a project and assigns the next key. State, labels, modules, cycle, parent and estimate must belong to the same project; the state defaults to the project default and the triage state is reserved for Intake. start_date must not be after target_date, closed items cannot join a cycle, and the parent chain must stay acyclic. When the project requires agent intake, items created by agents land in Intake.",
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
      "Replaces the Markdown body with optimistic concurrency: expected_description_version is the description_version the client last read, and the call fails with CONFLICT when the body changed since. Re-read the item and retry on CONFLICT.",
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
      "Board and list move in one call: group_by with value changes the grouped field (state, priority, assignees, labels, modules, cycle, dates; null for the none group, from_value for multi-valued fields), and before_id or after_id places the item among neighbours of the same project. At least one of group_by, before_id and after_id is required; some groups such as created_by cannot be moved between (RULE group_not_movable).",
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
      "Applies the same update_work_item patch to up to 500 items in one transaction; the same rules apply to each item and one failure rolls back all of them. Destructive because it rewrites many items at once.",
    input: BulkUpdateWorkItemsInput,
    mutates: true,
    destructive: true,
    phase: "P1",
    run: (ctx, { ids, patch }) => bulkUpdateWorkItems(ctx, ids, patch),
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
      "Returns the activity feed of exactly one work item (its own rows plus memberships and relations logged on it) or one whole project, newest first, with consecutive description edits by the same actor collapsed. since_seq limits the feed to rows after a cursor.",
    input: ListActivityInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, input) => toListResult(ctx, listActivity(ctx, input)),
  }),
];

// ---------------------------------------------------------------------------
// Links (P1: the service shipped with the work items, so the tools do)
// ---------------------------------------------------------------------------

const linkTools = [
  defineTool({
    name: "add_link",
    title: "Add link",
    description: "Attaches an absolute http(s) URL to exactly one work item or module (one of work_item_id and module_id). The parent and its project must not be archived.",
    input: AddLinkInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => addLink(ctx, input),
  }),
  defineTool({
    name: "update_link",
    title: "Update link",
    description: "Changes a link's title, URL or metadata (null metadata clears it); the parent must not be archived.",
    input: UpdateLinkInput.extend({ link_id: LinkId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { link_id, ...patch }) => updateLink(ctx, link_id, patch),
  }),
  defineTool({
    name: "remove_link",
    title: "Remove link",
    description: "Removes a link from its work item or module; the parent must not be archived.",
    input: LinkIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { link_id }) => {
      removeLink(ctx, link_id);
      return removed(link_id);
    },
  }),
];

// ---------------------------------------------------------------------------
// Cycles (P3)
// ---------------------------------------------------------------------------

const CycleWorkItemsInput = z
  .object({
    cycle_id: CycleId,
    work_item_ids: CycleWorkItemIdsInput.describe("Work item ids of the cycle's project (1 to 500)."),
  })
  .strict();

const cycleTools = [
  defineTool({
    name: "list_cycles",
    title: "List cycles",
    description:
      "Lists the cycles of a project in sequence order with their derived status (current, upcoming, completed or draft for cycles without dates) and progress counts; filter by status, or pass archived: true for archived cycles. Each cycle carries open_count, the number of items transfer_cycle_work_items would move.",
    input: ListCyclesInput.extend({ project_id: ProjectId }),
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { project_id, ...input }) => toListResult(ctx, listCycles(ctx, project_id, input)),
  }),
  defineTool({
    name: "get_cycle",
    title: "Get cycle",
    description: "Returns one cycle with its derived status, dates, open_count and progress (issues mode).",
    input: CycleIdInput,
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => getCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "create_cycle",
    title: "Create cycle",
    description:
      "Creates a cycle in a project. Set start_date and end_date together (end on or after start) or leave both empty for a draft; the date range may not overlap another active cycle of the project (CONFLICT). Names need not be unique.",
    input: CreateCycleInput,
    mutates: true,
    phase: "P3",
    run: (ctx, input) => createCycle(ctx, input),
  }),
  defineTool({
    name: "update_cycle",
    title: "Update cycle",
    description:
      "Changes a cycle's name, description or dates; dates change together, must stay in order and may not overlap another active cycle. Completed cycles are read-only (LOCKED) and archived cycles reject changes (ARCHIVED).",
    input: UpdateCycleInput.extend({ cycle_id: CycleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...patch }) => updateCycle(ctx, cycle_id, patch),
  }),
  defineTool({
    name: "reorder_cycle",
    title: "Reorder cycle",
    description: "Moves a cycle directly before or after another active cycle of the same project; before_id or after_id is required. Allowed on completed cycles, refused on archived ones (ARCHIVED).",
    input: ReorderCycleInput.extend({ cycle_id: CycleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => reorderCycle(ctx, cycle_id, input),
  }),
  defineTool({
    name: "archive_cycle",
    title: "Archive cycle",
    description: "Archives a cycle; only cycles whose end date has passed can be archived (RULE cycle_not_ended). Archived cycles leave the default list and are read-only.",
    input: CycleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => archiveCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "unarchive_cycle",
    title: "Unarchive cycle",
    description: "Restores an archived cycle; RULE not_archived when it is not archived; CONFLICT when its dates now overlap another active cycle; the frozen snapshot stays.",
    input: CycleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => unarchiveCycle(ctx, cycle_id),
  }),
  defineTool({
    name: "delete_cycle",
    title: "Delete cycle",
    description: "Soft-deletes a cycle and detaches its work items (one activity row each), which stay in the project with no cycle. Allowed on archived cycles; a completed cycle must be archived first (LOCKED). Destructive.",
    input: CycleIdInput,
    mutates: true,
    destructive: true,
    phase: "P3",
    run: (ctx, { cycle_id }) => {
      deleteCycle(ctx, cycle_id);
      return deleted(cycle_id);
    },
  }),
  defineTool({
    name: "add_work_items_to_cycle",
    title: "Add work items to cycle",
    description:
      "Moves work items into a cycle (an item belongs to at most one cycle, so it leaves its previous one). Items must belong to the cycle's project, must not be archived and must not be completed or cancelled; neither the target cycle nor the cycle an item leaves may be completed (LOCKED) or archived (ARCHIVED); use transfer_cycle_work_items for a completed cycle.",
    input: CycleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, work_item_ids }) => addWorkItemsToCycle(ctx, cycle_id, work_item_ids),
  }),
  defineTool({
    name: "remove_work_items_from_cycle",
    title: "Remove work items from cycle",
    description: "Takes work items out of a cycle; items not in the cycle are ignored. The cycle must not be completed or archived.",
    input: CycleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { cycle_id, work_item_ids }) => removeWorkItemsFromCycle(ctx, cycle_id, work_item_ids),
  }),
  defineTool({
    name: "transfer_cycle_work_items",
    title: "Transfer open work items",
    description:
      "Moves the open (not completed or cancelled) items of a completed cycle into to_cycle_id, a cycle of the same project that is neither completed nor archived, or out of any cycle when to_cycle_id is null. Only completed cycles transfer (RULE cycle_not_completed). Returns the number moved. Destructive.",
    input: TransferCycleWorkItemsInput.extend({ cycle_id: IdSchema.describe("Completed cycle whose open items move.") }),
    mutates: true,
    destructive: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => transferCycleWorkItems(ctx, cycle_id, input),
  }),
  defineTool({
    name: "get_cycle_progress",
    title: "Get cycle progress",
    description:
      "Returns a cycle's progress: totals by state group, item counts per state, label and assignee (with completed counts per label and assignee), and the pending amount per day from start_date to min(end_date, today) for burndown and burnup charts. There is no ideal line and no scope-per-day series: derive the ideal line from the dates and total minus cancelled, and treat scope as today's total. mode issues counts items; mode points sums estimate point values when the project has an active estimate, and chart_mode says which unit the series uses. A cycle whose open items were transferred, or an archived one, returns its frozen snapshot.",
    input: GetCycleProgressInput.extend({ cycle_id: CycleId }),
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { cycle_id, ...input }) => getCycleProgress(ctx, cycle_id, input),
  }),
  defineTool({
    name: "list_active_cycles",
    title: "List active cycles",
    description: "Lists the current cycles (date range includes today) of every non-archived project, earliest start first, each with full progress.",
    input: EmptyInput,
    mutates: false,
    phase: "P3",
    run: (ctx) => toListResult(ctx, getActiveCycles(ctx)),
  }),
];

// ---------------------------------------------------------------------------
// Modules (P3)
// ---------------------------------------------------------------------------

const ModuleWorkItemsInput = z
  .object({
    module_id: ModuleId,
    work_item_ids: ModuleWorkItemIdsInput.describe("Work item ids of the module's project (at least one)."),
  })
  .strict();

const SetModuleMembersToolInput = z
  .object({
    module_id: ModuleId,
    actor_ids: SetModuleMembersInput.describe("Actor ids; the module ends up with exactly these members."),
  })
  .strict();

const moduleTools = [
  defineTool({
    name: "list_modules",
    title: "List modules",
    description: "Lists the modules of a project in sequence order with status, lead, members, dates and progress counts; filter by status, or pass archived: true for archived modules.",
    input: ListModulesInput.extend({ project_id: ProjectId }),
    mutates: false,
    core: true,
    phase: "P3",
    run: (ctx, { project_id, ...input }) => toListResult(ctx, listModules(ctx, project_id, input)),
  }),
  defineTool({
    name: "get_module",
    title: "Get module",
    description: "Returns one module with its members, links and progress counts.",
    input: ModuleIdInput,
    mutates: false,
    phase: "P3",
    run: (ctx, { module_id }) => getModule(ctx, module_id),
  }),
  defineTool({
    name: "create_module",
    title: "Create module",
    description:
      "Creates a module in a project. Names are unique per project (case-insensitive, CONFLICT otherwise); status defaults to planned; start_date must be on or before target_date; lead and members are actor ids.",
    input: CreateModuleInput,
    mutates: true,
    phase: "P3",
    run: (ctx, input) => createModule(ctx, input),
  }),
  defineTool({
    name: "update_module",
    title: "Update module",
    description: "Changes a module's name, description, status, lead or dates; the name stays unique per project and dates stay in order. Archived modules reject changes.",
    input: UpdateModuleInput.extend({ module_id: ModuleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, ...patch }) => updateModule(ctx, module_id, patch),
  }),
  defineTool({
    name: "reorder_module",
    title: "Reorder module",
    description: "Moves a module directly before or after another active module of the same project; before_id or after_id is required. Archived modules are read-only (ARCHIVED).",
    input: ReorderModuleInput.extend({ module_id: ModuleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, ...input }) => reorderModule(ctx, module_id, input),
  }),
  defineTool({
    name: "archive_module",
    title: "Archive module",
    description: "Archives a module; only modules whose status is completed or cancelled can be archived (RULE module_status). Archived modules leave the default list and are read-only.",
    input: ModuleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id }) => archiveModule(ctx, module_id),
  }),
  defineTool({
    name: "unarchive_module",
    title: "Unarchive module",
    description: "Restores an archived module; RULE not_archived when it is not archived.",
    input: ModuleIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id }) => unarchiveModule(ctx, module_id),
  }),
  defineTool({
    name: "delete_module",
    title: "Delete module",
    description: "Soft-deletes a module and removes its member list and work item memberships; its work items stay in the project. Works on archived modules. Destructive.",
    input: ModuleIdInput,
    mutates: true,
    destructive: true,
    phase: "P3",
    run: (ctx, { module_id }) => {
      deleteModule(ctx, module_id);
      return deleted(module_id);
    },
  }),
  defineTool({
    name: "add_work_items_to_module",
    title: "Add work items to module",
    description: "Adds work items to a module (an item may be in several modules). Items must belong to the module's project and must not be archived; items already in the module are ignored.",
    input: ModuleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, work_item_ids }) => addWorkItemsToModule(ctx, module_id, work_item_ids),
  }),
  defineTool({
    name: "remove_work_items_from_module",
    title: "Remove work items from module",
    description: "Removes work items from a module; items not in the module are ignored.",
    input: ModuleWorkItemsInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, work_item_ids }) => removeWorkItemsFromModule(ctx, module_id, work_item_ids),
  }),
  defineTool({
    name: "set_module_members",
    title: "Set module members",
    description: "Replaces the module's member list with exactly actor_ids (an empty list clears it).",
    input: SetModuleMembersToolInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, actor_ids }) => setModuleMembers(ctx, module_id, actor_ids),
  }),
  defineTool({
    name: "add_module_link",
    title: "Add module link",
    description: "Attaches an absolute http(s) URL to a module; the module and its project must not be archived.",
    input: AddModuleLinkInput.extend({ module_id: ModuleId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { module_id, ...fields }) => addModuleLink(ctx, module_id, fields),
  }),
  defineTool({
    name: "update_module_link",
    title: "Update module link",
    description: "Changes a module link's title, URL or metadata (null metadata clears it).",
    input: UpdateModuleLinkInput.extend({ link_id: LinkId }),
    mutates: true,
    phase: "P3",
    run: (ctx, { link_id, ...patch }) => updateModuleLink(ctx, link_id, patch),
  }),
  defineTool({
    name: "remove_module_link",
    title: "Remove module link",
    description: "Removes a link from its module.",
    input: LinkIdInput,
    mutates: true,
    phase: "P3",
    run: (ctx, { link_id }) => {
      removeModuleLink(ctx, link_id);
      return removed(link_id);
    },
  }),
  defineTool({
    name: "get_module_progress",
    title: "Get module progress",
    description:
      "Returns a module's progress: item totals by state group, item counts per state, label and assignee (with completed counts per label and assignee), and the same totals in estimate points when the project has an active estimate.",
    input: ModuleIdInput,
    mutates: false,
    phase: "P3",
    run: (ctx, { module_id }) => getModuleProgress(ctx, module_id),
  }),
];

// ---------------------------------------------------------------------------
// Views and view settings (P4)
// ---------------------------------------------------------------------------

const SaveViewSettingsToolInput = ViewSettingsScopeInput.extend(SaveViewSettingsInput.shape);

const viewTools = [
  defineTool({
    name: "list_views",
    title: "List views",
    description: "Lists the saved views of a project, or the workspace views when project_id is null, with their filters, display and lock state.",
    input: ListViewsInput,
    mutates: false,
    core: true,
    phase: "P4",
    run: (ctx, input) => toListResult(ctx, listViews(ctx, input)),
  }),
  defineTool({
    name: "get_view",
    title: "Get view",
    description: "Returns one saved view with its filters, rich filters, display settings and lock state.",
    input: ViewIdInput,
    mutates: false,
    phase: "P4",
    run: (ctx, { view_id }) => getView(ctx, view_id),
  }),
  defineTool({
    name: "create_view",
    title: "Create view",
    description:
      "Saves a view in a project or, with project_id null, in the workspace. Names are unique within the project or among workspace views (case-insensitive, CONFLICT otherwise); display is merged over the defaults and workspace views accept only the table layout. Use describe_filters for the filter and display vocabulary.",
    input: CreateViewInput,
    mutates: true,
    phase: "P4",
    run: (ctx, input) => createView(ctx, input),
  }),
  defineTool({
    name: "update_view",
    title: "Update view",
    description: "Changes a view's name, description, filters, rich filters, display or logo. Locked views reject changes (LOCKED); unlock first. filters replaces the saved filters while display merges over them.",
    input: UpdateViewInput.extend({ view_id: ViewId }),
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id, ...patch }) => updateView(ctx, view_id, patch),
  }),
  defineTool({
    name: "duplicate_view",
    title: "Duplicate view",
    description: "Creates an unlocked copy at the end of the same scope with a derived unique name and the same filters, rich filters, display and logo; the source may be locked.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => duplicateView(ctx, view_id),
  }),
  defineTool({
    name: "lock_view",
    title: "Lock view",
    description: "Locks a view so its filters and display cannot change until unlock_view; locking a locked view fails with LOCKED.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => lockView(ctx, view_id),
  }),
  defineTool({
    name: "unlock_view",
    title: "Unlock view",
    description: "Unlocks a locked view; RULE not_locked when it is not locked.",
    input: ViewIdInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { view_id }) => unlockView(ctx, view_id),
  }),
  defineTool({
    name: "delete_view",
    title: "Delete view",
    description: "Soft-deletes a saved view; locked views must be unlocked first. Destructive.",
    input: ViewIdInput,
    mutates: true,
    destructive: true,
    phase: "P4",
    run: (ctx, { view_id }) => {
      deleteView(ctx, view_id);
      return deleted(view_id);
    },
  }),
  defineTool({
    name: "get_view_settings",
    title: "Get view settings",
    description:
      "Returns the filters and display the UI applies for a scope (project, cycle, module, workspace, profile, archived or draft list, identified by scope_id; the workspace scope uses scope_id workspace); the defaults when nothing was saved.",
    input: ViewSettingsScopeInput,
    mutates: false,
    phase: "P4",
    run: (ctx, { scope_type, scope_id }) => getViewSettings(ctx, scope_type, scope_id),
  }),
  defineTool({
    name: "save_view_settings",
    title: "Save view settings",
    description:
      "Merges filter keys and display keys over the settings stored for a scope and returns the result; an empty filter list clears that key. Saved settings are per scope, not per view.",
    input: SaveViewSettingsToolInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { scope_type, scope_id, ...input }) => saveViewSettings(ctx, scope_type, scope_id, input),
  }),
  defineTool({
    name: "reset_view_settings",
    title: "Reset view settings",
    description: "Drops the settings stored for a scope so the defaults apply again, and returns those defaults.",
    input: ViewSettingsScopeInput,
    mutates: true,
    phase: "P4",
    run: (ctx, { scope_type, scope_id }) => resetViewSettings(ctx, scope_type, scope_id),
  }),
];

// ---------------------------------------------------------------------------
// Meta (P1)
// ---------------------------------------------------------------------------

const metaTools = [
  defineTool({
    name: "get_counts",
    title: "Get counts",
    description:
      "Counts the work items of a scope (workspace, project, cycle, module, saved view or an actor's profile): total, by state group, state, priority, assignee and label, overdue and due this week, plus points when estimates are enabled.",
    input: GetCountsInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { scope }) => getCounts(ctx, scope),
  }),
  defineTool({
    name: "search_all",
    title: "Search",
    description:
      "Searches projects, work items, cycles, modules, views and pages by free text or a work item key such as WEB-12; a key hit ranks first, then exact names, then full-text relevance. Narrow with scope.project_id or types; archived entities are left out unless include_archived is true. Returns hits ordered by score.",
    input: SearchAllInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx, { q, ...options }) => searchAll(ctx, q, options),
  }),
  defineTool({
    name: "list_changes",
    title: "List changes",
    description:
      "Polling feed for the UI and agents: activity rows with seq greater than since_seq, oldest first, without values; exclude_actors drops the caller's own changes. The returned cursor is the next since_seq.",
    input: ListChangesInput,
    mutates: false,
    phase: "P1",
    run: (ctx, { since_seq, exclude_actors, limit }) => listChanges(ctx, since_seq, { excludeActors: exclude_actors, limit }),
  }),
  defineTool({
    name: "describe_filters",
    title: "Describe filters",
    description:
      "Returns the enums, the type of every Filters field (ids with the entity kind, enum, date, text, boolean), the allowed values of every Display key, the default display and worked examples, so an agent can build list_work_items and view inputs without reading the schema.",
    input: EmptyInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: () => describeFilters(),
  }),
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOLS = [...projectTools, ...stateTools, ...labelTools, ...actorTools, ...workItemTools, ...linkTools, ...cycleTools, ...moduleTools, ...viewTools, ...metaTools];

export type Tool = (typeof TOOLS)[number];
export type ToolName = Tool["name"];
export type ToolByName<N extends ToolName> = Extract<Tool, { name: N }>;
/** What a caller passes (zod input type, defaults optional). */
export type ToolInput<N extends ToolName> = z.input<ToolByName<N>["input"]>;
/** What the tool's `run` resolves to. */
export type ToolOutput<N extends ToolName> = Awaited<ReturnType<ToolByName<N>["run"]>>;

export type ToolResult<T = unknown> = { data: T; cursor: number };

export type ListToolsOptions = { toolset?: Toolset; phase?: ToolPhase };

function buildRegistry(): ReadonlyMap<string, ToolDef> {
  const map = new Map<string, ToolDef>();
  for (const def of TOOLS) {
    if (map.has(def.name)) throw new Error(`duplicate tool name ${def.name}`);
    map.set(def.name, def);
  }
  return map;
}

/** Every tool by name, in contract order. */
export const registry: ReadonlyMap<string, ToolDef> = buildRegistry();

/** NOT_FOUND for unknown names, so adapters report a bad tool name the same way as a bad id. */
export function getTool(name: string): ToolDef {
  const def = registry.get(name);
  if (!def) throw notFound("tool", name);
  return def;
}

/** `toolset: "core"` keeps the assistant's default set; `phase` keeps the tools shipping in or before that phase. */
export function listTools(options: ListToolsOptions = {}): ToolDef[] {
  const maxPhase = options.phase === undefined ? TOOL_PHASES.length - 1 : TOOL_PHASES.indexOf(options.phase);
  return [...registry.values()].filter((def) => {
    if (options.toolset === "core" && def.core !== true) return false;
    return TOOL_PHASES.indexOf(def.phase) <= maxPhase;
  });
}

/** Validates the input against the tool's schema, runs it and returns the data with the change cursor after the call. */
export function runToolWithContext<N extends ToolName>(ctx: TesseraContext, name: N, input: ToolInput<N>): Promise<ToolResult<ToolOutput<N>>>;
export function runToolWithContext(ctx: TesseraContext, name: string, input: unknown): Promise<ToolResult>;
export async function runToolWithContext(ctx: TesseraContext, name: string, input: unknown): Promise<ToolResult> {
  const def = getTool(name);
  const data = validateInput(def.input, input);
  const result = await def.run(ctx, data);
  return { data: result, cursor: latestSeq(ctx) };
}
