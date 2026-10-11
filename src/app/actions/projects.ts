"use server";

/**
 * Project mutations for the UI (docs/contracts/tools.md "Server Actions").
 * One typed wrapper per registry tool; reads go through `readTessera` in
 * Server Components, so `list_projects` and `get_project` have no wrapper.
 */
import { toolAction } from "./_run";

export const createProjectAction = toolAction("create_project");
export const updateProjectAction = toolAction("update_project");
