"use server";

/**
 * View settings mutations (the display menu remembers its choices per scope).
 * Lane F adds the saved-view wrappers (create_view, update_view, ...) here.
 */
import { toolAction } from "./_run";

export const saveViewSettingsAction = toolAction("save_view_settings");
export const resetViewSettingsAction = toolAction("reset_view_settings");
