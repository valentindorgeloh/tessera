"use server";

/** Workspace settings (docs/drafts/p9-plan.md U1). Each wrapper keeps the tool name. */
import { toolAction } from "./_run";

export const getWorkspaceSettingsAction = toolAction("get_workspace_settings");
export const updateWorkspaceSettingsAction = toolAction("update_workspace_settings");
