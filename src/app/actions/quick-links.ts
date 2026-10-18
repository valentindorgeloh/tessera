"use server";

/** Home quick links (docs/drafts/p9-plan.md U1). Each wrapper keeps the tool name. */
import { toolAction } from "./_run";

export const listQuickLinksAction = toolAction("list_quick_links");
export const addQuickLinkAction = toolAction("add_quick_link");
export const updateQuickLinkAction = toolAction("update_quick_link");
export const moveQuickLinkAction = toolAction("move_quick_link");
export const removeQuickLinkAction = toolAction("remove_quick_link");
