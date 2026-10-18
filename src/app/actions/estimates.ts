"use server";

/**
 * Estimate system mutations. Every wrapper validates against the registry,
 * runs as the user and calls refresh() through toolAction.
 */
import { toolAction } from "./_run";

export const createEstimateAction = toolAction("create_estimate");
export const updateEstimateAction = toolAction("update_estimate");
export const deleteEstimateAction = toolAction("delete_estimate");
