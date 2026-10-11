"use server";

/**
 * Detail panel mutations (docs/contracts/ui.md "Detail components (D2)"):
 * subscriptions, copies and links. Every wrapper validates its input against
 * the registry schema, runs as the user, calls `refresh()` and returns an
 * `ActionResult`; callers show a Toast on `{ ok: false }`. The other detail
 * writes (fields, labels, assignees, modules, sub-items, delete) use the
 * wrappers in ./work-items.ts.
 */
import { toolAction } from "./_run";

export const subscribeWorkItemAction = toolAction("subscribe_work_item");
export const unsubscribeWorkItemAction = toolAction("unsubscribe_work_item");
export const copyWorkItemAction = toolAction("copy_work_item");
export const addLinkAction = toolAction("add_link");
export const updateLinkAction = toolAction("update_link");
export const removeLinkAction = toolAction("remove_link");
