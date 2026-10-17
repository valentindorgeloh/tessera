"use server";

/**
 * Page mutations and the list read the move dialog uses (docs/drafts/p6-plan.md
 * "Routes and data loading"). One typed wrapper per registry tool. Screen
 * reads go through `readTessera` in the route files.
 */
import { toolAction } from "./_run";

export const listPagesAction = toolAction("list_pages");
export const getPageAction = toolAction("get_page");
export const createPageAction = toolAction("create_page");
export const updatePageAction = toolAction("update_page");
export const updatePageBodyAction = toolAction("update_page_body");
export const movePageAction = toolAction("move_page");
export const duplicatePageAction = toolAction("duplicate_page");
export const lockPageAction = toolAction("lock_page");
export const unlockPageAction = toolAction("unlock_page");
export const archivePageAction = toolAction("archive_page");
export const unarchivePageAction = toolAction("unarchive_page");
export const deletePageAction = toolAction("delete_page");
