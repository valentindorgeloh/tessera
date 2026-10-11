"use server";

/**
 * State and label mutations used by the work-items screens (lane C). Later
 * lanes add the update, reorder and delete wrappers next to these.
 */
import { toolAction } from "./_run";

export const createStateAction = toolAction("create_state");
export const createLabelAction = toolAction("create_label");
