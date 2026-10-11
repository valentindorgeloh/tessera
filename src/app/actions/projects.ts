"use server";

/**
 * Project mutations for the UI (docs/contracts/tools.md "Server Actions").
 * One typed wrapper per registry tool; reads go through `readTessera` in
 * Server Components, so `list_projects` and `get_project` have no wrapper.
 */
import { toolAction } from "./_run";

export const createProjectAction = toolAction("create_project");
export const updateProjectAction = toolAction("update_project");

// P3 archives (docs/contracts/ui.md "Archives (E3)"): the UI confirms archive and delete
// itself (AlertDialog, the typed identifier); the `confirm: true` MCP needs for
// delete_project is not part of these calls.
export const archiveProjectAction = toolAction("archive_project");
export const unarchiveProjectAction = toolAction("unarchive_project");
export const deleteProjectAction = toolAction("delete_project");
