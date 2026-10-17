import { and, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { rule } from "../core/errors";
import { formatKey } from "../core/keys";
import { withTx } from "../core/tx";
import { deleteWorkItemFts } from "../db/fts";
import { intake_item, work_item, work_item_assignee, work_item_label, work_item_module, work_item_subscriber } from "../db/schema";
import { ENTITY, type WorkItem, itemKey, loadWritableWorkItem, resolveState } from "./model";
import { loadWorkItem } from "./hydrate";

// ---------------------------------------------------------------------------
// Archive, restore, delete
// ---------------------------------------------------------------------------

/** Archive only when the state group is completed or cancelled. */
export function archiveWorkItem(ctx: TesseraContext, id: string): WorkItem {
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    const stateRow = resolveState(ctx, loaded.project.id, loaded.item.state_id);
    if (stateRow.state_group !== "completed" && stateRow.state_group !== "cancelled") {
      throw rule("archive_open_item", `Only completed or cancelled work items can be archived ("${stateRow.name}" is ${stateRow.state_group})`);
    }
    const now = ctx.now();
    ctx.db.update(work_item).set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
    logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: id, work_item_id: id, verb: "archived", old_identifier: itemKey(loaded.project, loaded.item) });
    return loadWorkItem(ctx, id);
  });
}

export function unarchiveWorkItem(ctx: TesseraContext, id: string): WorkItem {
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id, { allowArchived: true });
    if (loaded.item.archived_at === null) throw rule("not_archived", `work item ${itemKey(loaded.project, loaded.item)} is not archived`);
    const now = ctx.now();
    ctx.db.update(work_item).set({ archived_at: null, updated_at: now, updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
    logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: id, work_item_id: id, verb: "restored", new_identifier: itemKey(loaded.project, loaded.item) });
    return loadWorkItem(ctx, id);
  });
}

/** The item and every non-deleted descendant, parents first. */
function collectSubtree(ctx: TesseraContext, rootId: string): string[] {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = ctx.db
      .select({ id: work_item.id })
      .from(work_item)
      .where(and(inArray(work_item.parent_id, frontier), isNull(work_item.deleted_at)))
      .all()
      .map((row) => row.id);
    ids.push(...children);
    frontier = children;
  }
  return ids;
}

/**
 * Soft-deletes the item and its children recursively with their junction,
 * intake and FTS rows; works on archived items and on members of completed
 * or archived cycles (the cycle lock covers membership changes, not deletion).
 */
export function deleteWorkItem(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id, { allowArchived: true });
    const ids = collectSubtree(ctx, id);
    const keys = new Map(
      ctx.db
        .select({ id: work_item.id, sequence_id: work_item.sequence_id })
        .from(work_item)
        .where(inArray(work_item.id, ids))
        .all()
        .map((row) => [row.id, formatKey(loaded.project.identifier, row.sequence_id)]),
    );
    ctx.db.delete(work_item_label).where(inArray(work_item_label.work_item_id, ids)).run();
    ctx.db.delete(work_item_module).where(inArray(work_item_module.work_item_id, ids)).run();
    ctx.db.delete(work_item_assignee).where(inArray(work_item_assignee.work_item_id, ids)).run();
    ctx.db.delete(work_item_subscriber).where(inArray(work_item_subscriber.work_item_id, ids)).run();
    for (const itemId of ids) deleteWorkItemFts(ctx.sqlite, itemId);
    const now = ctx.now();
    const stamp = { deleted_at: now, updated_at: now, updated_by: ctx.actor.id };
    ctx.db.update(intake_item).set(stamp).where(and(inArray(intake_item.work_item_id, ids), isNull(intake_item.deleted_at))).run();
    ctx.db.update(work_item).set(stamp).where(inArray(work_item.id, ids)).run();
    for (const itemId of ids) {
      logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: itemId, work_item_id: itemId, verb: "deleted", old_identifier: keys.get(itemId) ?? itemId });
    }
  });
}
