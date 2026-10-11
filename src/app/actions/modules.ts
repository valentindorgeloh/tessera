"use server";

/**
 * Module mutations for the modules list, the module detail and its dialogs
 * (docs/contracts/ui.md "Modules (E2)", tools.md "Server Actions"). One typed
 * wrapper per registry tool; reads go through `readTessera` in Server
 * Components. `remove_work_items_from_module` has no wrapper: an item leaves a
 * module through its Modules property in P3 (deferral table).
 */
import { toolAction } from "./_run";

export const createModuleAction = toolAction("create_module");
export const updateModuleAction = toolAction("update_module");
export const archiveModuleAction = toolAction("archive_module");
export const unarchiveModuleAction = toolAction("unarchive_module");
export const deleteModuleAction = toolAction("delete_module");
export const addWorkItemsToModuleAction = toolAction("add_work_items_to_module");
export const setModuleMembersAction = toolAction("set_module_members");
export const addModuleLinkAction = toolAction("add_module_link");
export const updateModuleLinkAction = toolAction("update_module_link");
export const removeModuleLinkAction = toolAction("remove_module_link");
