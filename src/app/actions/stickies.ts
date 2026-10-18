"use server";

/** Sticky notes (docs/drafts/p9-plan.md U1). Each wrapper keeps the tool name. */
import { toolAction } from "./_run";

export const listStickiesAction = toolAction("list_stickies");
export const createStickyAction = toolAction("create_sticky");
export const updateStickyAction = toolAction("update_sticky");
export const moveStickyAction = toolAction("move_sticky");
export const deleteStickyAction = toolAction("delete_sticky");
