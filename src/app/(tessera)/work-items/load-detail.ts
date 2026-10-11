/**
 * Server loaders for the detail hosts (docs/contracts/ui.md "Routes and
 * modes"). `loadWorkItemDetail` builds the `WorkItemDetailData` the detail
 * component renders; `loadProjectBundle` is the project layout's bundle body
 * for routes outside the project segment (`/work-items/[workItemId]`), so
 * lane C can switch the layout to it later. Both take the engine context
 * and run inside `readTessera`.
 */
import type { ProjectBundle } from "@/components/work-items/types";
import {
  getProject,
  getWorkItem,
  isTrackerError,
  latestSeq,
  listActivity,
  listActors,
  listChildren,
  listCycles,
  listLabels,
  listModules,
  listStates,
  USER_ACTOR_ID,
  type TesseraContext,
  type WorkItem,
} from "@/lib/tessera/server";
import type { WorkItemDetailData } from "@/components/detail";

/** Everything the property controls need for one project (same shape as the project layout). */
export function loadProjectBundle(ctx: TesseraContext, projectId: string): ProjectBundle {
  return {
    project: getProject(ctx, projectId),
    states: listStates(ctx, projectId),
    labels: listLabels(ctx, projectId),
    cycles: listCycles(ctx, projectId, {}),
    modules: listModules(ctx, projectId, {}),
    actors: listActors(ctx),
    cursor: latestSeq(ctx),
  };
}

/** The parent's key and name, or null when the item has none or the parent is gone. */
function loadParent(ctx: TesseraContext, parentId: string | null): Pick<WorkItem, "id" | "key" | "name"> | null {
  if (!parentId) return null;
  try {
    const parent = getWorkItem(ctx, parentId);
    return { id: parent.id, key: parent.key, name: parent.name };
  } catch (err) {
    // A deleted parent leaves a dangling id behind; the detail shows no parent rather than failing.
    if (isTrackerError(err) && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

/** The detail view model of one item; NOT_FOUND propagates for a missing or deleted item. */
export function loadWorkItemDetail(ctx: TesseraContext, id: string): WorkItemDetailData {
  const item = getWorkItem(ctx, id);
  return {
    item,
    parent: loadParent(ctx, item.parent_id),
    children: listChildren(ctx, id),
    // listActivity returns the newest rows oldest first; the feed wants the newest on top.
    activity: listActivity(ctx, { work_item_id: id }).reverse(),
    currentActorId: USER_ACTOR_ID,
    cursor: latestSeq(ctx),
  };
}
