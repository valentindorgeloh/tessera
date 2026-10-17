"use server";

/**
 * State and label mutations used by the work-items screens (lane C) and the
 * project settings screens (P4 lane F2): create, update, reorder, set default
 * and delete. Deletes are called without `confirm`; the UI confirms itself.
 */
import { toolAction } from "./_run";

export const createStateAction = toolAction("create_state");
export const createLabelAction = toolAction("create_label");

export const updateStateAction = toolAction("update_state");
export const reorderStateAction = toolAction("reorder_state");
export const setDefaultStateAction = toolAction("set_default_state");
export const deleteStateAction = toolAction("delete_state");

export const updateLabelAction = toolAction("update_label");
export const reorderLabelAction = toolAction("reorder_label");
export const deleteLabelAction = toolAction("delete_label");
