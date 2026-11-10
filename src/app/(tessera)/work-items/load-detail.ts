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
  agentRepoFor,
  countOpenIntake,
  getActiveEstimate,
  getProject,
  getState,
  getWorkItem,
  getWorkspaceSettings,
  isTrackerError,
  latestSeq,
  listActivity,
  listActors,
  listChildren,
  listComments,
  listCycles,
  listLabels,
  listModules,
  listPageBacklinks,
  listProjects,
  listRelations,
  listStates,
  reactionsFor,
  USER_ACTOR_ID,
  type TesseraContext,
  type WorkItem,
} from "@/lib/tessera/server";
import type { RelationRowView, WorkItemDetailData } from "@/components/detail";

/** One bundle per project id. A missing project is skipped; other failures propagate. */
export function loadProjectBundles(ctx: TesseraContext, projectIds: readonly string[]): Record<string, ProjectBundle> {
  const bundles: Record<string, ProjectBundle> = {};
  for (const projectId of projectIds) {
    if (bundles[projectId]) continue;
    try {
      bundles[projectId] = loadProjectBundle(ctx, projectId);
    } catch (err) {
      if (isTrackerError(err) && err.code === "NOT_FOUND") continue;
      throw err;
    }
  }
  return bundles;
}

/** Everything the property controls need for one project (same shape as the project layout). */
export function loadProjectBundle(ctx: TesseraContext, projectId: string): ProjectBundle {
  const project = getProject(ctx, projectId);
  return {
    project,
    states: listStates(ctx, projectId),
    labels: listLabels(ctx, projectId),
    cycles: listCycles(ctx, projectId, {}),
    modules: listModules(ctx, projectId, {}),
    actors: listActors(ctx),
    cursor: latestSeq(ctx),
    today: ctx.today(),
    estimate: project.estimates_enabled ? getActiveEstimate(ctx, project.id) : null,
    intake_open: countOpenIntake(ctx, project.id),
    projects: listProjects(ctx, {}).map((row) => ({ id: row.id, name: row.name, identifier: row.identifier })),
    // The repository the superagent works in for this project (decision 151); the detail's "Send to superagent" reads it.
    superagent_repo: agentRepoFor(getWorkspaceSettings(ctx).agents, project.id),
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

/**
 * The relations of an item with the other side resolved (key, name, project,
 * state): the Relations section lists them without a second read, across
 * projects. A relation whose other item is gone is left out. Rows sort by key,
 * so a group lists WEB-2 before WEB-10.
 */
function loadRelations(ctx: TesseraContext, id: string): RelationRowView[] {
  const rows: RelationRowView[] = [];
  for (const relation of listRelations(ctx, id)) {
    try {
      const other = getWorkItem(ctx, relation.related_work_item_id);
      const state = getState(ctx, other.state_id);
      rows.push({
        id: relation.id,
        relation_type: relation.relation_type,
        item: {
          id: other.id,
          key: other.key,
          name: other.name,
          project_id: other.project_id,
          archived: other.archived_at !== null,
          state: { name: state.name, state_group: state.state_group },
        },
      });
    } catch (err) {
      if (isTrackerError(err) && err.code === "NOT_FOUND") continue;
      throw err;
    }
  }
  return rows.sort((a, b) => a.item.key.localeCompare(b.item.key, undefined, { numeric: true }));
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
    // Threads for the timeline (decision 56) and the pages that embed the item for "Mentioned in" (decision 44).
    comments: listComments(ctx, id),
    backlinks: listPageBacklinks(ctx, { entity_type: "work_item", entity_id: id }),
    // Relations (decision 55) and the reactions under the description (decision 57).
    relations: loadRelations(ctx, id),
    reactions: reactionsFor(ctx, "work_item", [id]).get(id) ?? [],
    currentActorId: USER_ACTOR_ID,
    cursor: latestSeq(ctx),
  };
}
