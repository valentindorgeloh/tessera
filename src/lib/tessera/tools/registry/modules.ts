import { z } from "zod";
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
} from "../../modules";
import { defineTool } from "../define";
import { ProjectId, ModuleId, LinkId, ModuleIdInput, LinkIdInput, deleted, removed, toListResult } from "./shared";

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

export const moduleTools = [
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
      "Creates a module in a project. Names are unique per project (case-insensitive, CONFLICT otherwise); status defaults to planned; start_date must be on or before target_date; lead and members are actor ids. RULE feature_disabled while the project has the feature turned off.",
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
    description: "Soft-deletes a module and removes its member list and work item memberships; its work items stay in the project. Works on archived modules. Destructive. Its id is removed from every saved view and remembered view setting that filters on it.",
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
