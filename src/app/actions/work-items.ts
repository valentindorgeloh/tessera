"use server";

/**
 * Work item mutations for the list, board, table, dialog and detail screens
 * (docs/contracts/tools.md "Server Actions"). Every wrapper validates its
 * input against the registry schema, runs as the user, calls `refresh()` and
 * returns an `ActionResult`; callers show a Toast on `{ ok: false }`.
 */
import { toolAction } from "./_run";

export const createWorkItemAction = toolAction("create_work_item");
export const updateWorkItemAction = toolAction("update_work_item");
export const updateWorkItemDescriptionAction = toolAction("update_work_item_description");
export const moveWorkItemAction = toolAction("move_work_item");
export const bulkUpdateWorkItemsAction = toolAction("bulk_update_work_items");
export const bulkArchiveWorkItemsAction = toolAction("bulk_archive_work_items");
export const bulkUnarchiveWorkItemsAction = toolAction("bulk_unarchive_work_items");
export const bulkDeleteWorkItemsAction = toolAction("bulk_delete_work_items");
export const moveWorkItemToProjectAction = toolAction("move_work_item_to_project");
export const archiveWorkItemAction = toolAction("archive_work_item");
export const unarchiveWorkItemAction = toolAction("unarchive_work_item");
export const deleteWorkItemAction = toolAction("delete_work_item");
export const setLabelsAction = toolAction("set_labels");
export const setAssigneesAction = toolAction("set_assignees");
export const setModulesAction = toolAction("set_modules");
