"use server";

/**
 * View mutations: the display menu remembers its choices per scope
 * (view_settings, decision 23), and the saved-view wrappers (create, update,
 * duplicate, lock, unlock, delete) serve the views screens (decision 32).
 */
import { quietToolAction, toolAction } from "./_run";

/** Quiet: the display menu writes the same display into the URL (`q`), so the page is already right. Reset drops `q`, so it keeps its refresh. */
export const saveViewSettingsAction = quietToolAction("save_view_settings");
export const resetViewSettingsAction = toolAction("reset_view_settings");

export const createViewAction = toolAction("create_view");
export const updateViewAction = toolAction("update_view");
export const duplicateViewAction = toolAction("duplicate_view");
export const lockViewAction = toolAction("lock_view");
export const unlockViewAction = toolAction("unlock_view");
export const deleteViewAction = toolAction("delete_view");
export const reorderViewAction = toolAction("reorder_view");
