"use server";

/**
 * Intake mutations. Every wrapper validates against the registry, runs as the
 * user and calls refresh() through toolAction.
 */
import { toolAction } from "./_run";

export const createIntakeItemAction = toolAction("create_intake_item");
export const acceptIntakeItemAction = toolAction("accept_intake_item");
export const declineIntakeItemAction = toolAction("decline_intake_item");
export const snoozeIntakeItemAction = toolAction("snooze_intake_item");
export const unsnoozeIntakeItemAction = toolAction("unsnooze_intake_item");
export const markIntakeDuplicateAction = toolAction("mark_intake_duplicate");
export const deleteIntakeItemAction = toolAction("delete_intake_item");
