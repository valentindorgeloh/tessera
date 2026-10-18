"use server";

/**
 * Draft mutations. Every wrapper validates against the registry, runs as the
 * user and calls refresh() through toolAction.
 */
import { toolAction } from "./_run";

export const createDraftAction = toolAction("create_draft");
export const updateDraftAction = toolAction("update_draft");
export const deleteDraftAction = toolAction("delete_draft");
export const moveDraftToProjectAction = toolAction("move_draft_to_project");
