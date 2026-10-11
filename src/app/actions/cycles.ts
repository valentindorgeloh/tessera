"use server";

/**
 * Cycle mutations for the cycles list, the cycle detail and its dialogs
 * (docs/contracts/tools.md "P3 changes", docs/contracts/ui.md "Cycles (E1)").
 * Every wrapper validates its input against the registry schema, runs as the
 * user, calls `refresh()` and returns an `ActionResult`; callers show a Toast
 * on `{ ok: false }`. Destructive tools (delete, transfer) are confirmed by
 * the UI itself; `confirm: true` is an MCP-only field. No wrapper for
 * `remove_work_items_from_cycle`: nothing in P3 calls it.
 */
import { toolAction } from "./_run";

export const createCycleAction = toolAction("create_cycle");
export const updateCycleAction = toolAction("update_cycle");
export const archiveCycleAction = toolAction("archive_cycle");
export const unarchiveCycleAction = toolAction("unarchive_cycle");
export const deleteCycleAction = toolAction("delete_cycle");
export const addWorkItemsToCycleAction = toolAction("add_work_items_to_cycle");
export const transferCycleWorkItemsAction = toolAction("transfer_cycle_work_items");
