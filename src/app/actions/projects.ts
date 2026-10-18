"use server";

/**
 * Project mutations for the UI (docs/contracts/tools.md "Server Actions").
 * One typed wrapper per registry tool; reads go through `readTessera` in
 * Server Components, so `list_projects` and `get_project` have no wrapper.
 */
import { toolAction, type ActionResult } from "./_run";

export const createProjectAction = toolAction("create_project");
export const updateProjectAction = toolAction("update_project");

// P3 archives (docs/contracts/ui.md "Archives (E3)"): the UI confirms archive and delete
// itself (AlertDialog, the typed identifier); the `confirm: true` MCP needs for
// delete_project is not part of these calls.
export const archiveProjectAction = toolAction("archive_project");
export const unarchiveProjectAction = toolAction("unarchive_project");
export const deleteProjectAction = toolAction("delete_project");

export type ReorderProjectInput = { project_id: string; before_id?: string; after_id?: string };

/**
 * `reorder_project` is not in the registry until the workspace lane lands.
 * `toolAction` runs at load; a missing tool becomes `{ ok: false }` instead
 * of taking the project menus down with it.
 */
export const reorderProjectAction = (() => {
  try {
    return toolAction("reorder_project" as unknown as Parameters<typeof toolAction>[0]) as (input: ReorderProjectInput) => Promise<ActionResult>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool reorder_project is not registered";
    return async (input: ReorderProjectInput): Promise<ActionResult> => {
      void input;
      return { ok: false, code: "NOT_FOUND", message };
    };
  }
})();
