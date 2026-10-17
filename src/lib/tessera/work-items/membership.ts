import { and, eq, inArray } from "drizzle-orm";
import { getActor } from "../actors";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { validateInput } from "../core/errors";
import { assertInTransaction, withTx } from "../core/tx";
import { work_item, work_item_assignee, work_item_label, work_item_module, work_item_subscriber } from "../db/schema";
import { IdListSchema } from "../schemas";
import {
  ENTITY,
  type LoadedWorkItem,
  MAX_IDS,
  type WorkItem,
  actorNameOrId,
  assertModulesNotArchived,
  labelNameOrId,
  loadWritableWorkItem,
  moduleNameOrId,
  resolveActors,
  resolveLabels,
  resolveModules,
} from "./model";
import { listSubscriberIds, loadWorkItem } from "./hydrate";

// ---------------------------------------------------------------------------
// Junction rows (labels, modules, assignees, subscribers)
// ---------------------------------------------------------------------------

function diffSets(current: string[], next: string[]): { added: string[]; removed: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return { added: [...nextSet].filter((id) => !currentSet.has(id)), removed: [...currentSet].filter((id) => !nextSet.has(id)) };
}

export function currentLabelIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_label.label_id })
    .from(work_item_label)
    .where(eq(work_item_label.work_item_id, id))
    .all()
    .map((row) => row.v);
}

export function currentModuleIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_module.module_id })
    .from(work_item_module)
    .where(eq(work_item_module.work_item_id, id))
    .all()
    .map((row) => row.v);
}

export function currentAssigneeIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_assignee.actor_id })
    .from(work_item_assignee)
    .where(eq(work_item_assignee.work_item_id, id))
    .all()
    .map((row) => row.v);
}

type JunctionField = "labels" | "modules" | "assignees" | "subscribers";

function logMembership(ctx: TesseraContext, loaded: LoadedWorkItem, field: JunctionField, verb: "added" | "removed", id: string, name: string): void {
  logActivity(ctx, {
    project_id: loaded.project.id,
    entity_type: ENTITY,
    entity_id: loaded.item.id,
    work_item_id: loaded.item.id,
    verb,
    field,
    old_value: verb === "removed" ? id : null,
    new_value: verb === "added" ? id : null,
    old_identifier: verb === "removed" ? name : null,
    new_identifier: verb === "added" ? name : null,
  });
}

/** Replaces the label set (same project only) and logs one row per added or removed label; inside withTx. */
export function syncLabels(ctx: TesseraContext, loaded: LoadedWorkItem, labelIds: string[]): void {
  assertInTransaction(ctx, "syncLabels");
  const names = resolveLabels(ctx, loaded.project.id, labelIds);
  const { added, removed } = diffSets(currentLabelIds(ctx, loaded.item.id), labelIds);
  if (removed.length > 0) {
    ctx.db.delete(work_item_label).where(and(eq(work_item_label.work_item_id, loaded.item.id), inArray(work_item_label.label_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_label)
      .values(added.map((label_id) => ({ work_item_id: loaded.item.id, label_id })))
      .run();
  }
  for (const id of removed) logMembership(ctx, loaded, "labels", "removed", id, labelNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "labels", "added", id, names.get(id)?.name ?? id);
}

/**
 * Replaces the module set (same project only) and logs one row per change;
 * inside withTx. ARCHIVED when a module being added or removed is archived;
 * archived modules the call keeps stay untouched.
 */
export function syncModules(ctx: TesseraContext, loaded: LoadedWorkItem, moduleIds: string[]): void {
  assertInTransaction(ctx, "syncModules");
  const names = resolveModules(ctx, loaded.project.id, moduleIds);
  const { added, removed } = diffSets(currentModuleIds(ctx, loaded.item.id), moduleIds);
  assertModulesNotArchived(ctx, [...added, ...removed]);
  if (removed.length > 0) {
    ctx.db.delete(work_item_module).where(and(eq(work_item_module.work_item_id, loaded.item.id), inArray(work_item_module.module_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_module)
      .values(added.map((module_id) => ({ work_item_id: loaded.item.id, module_id })))
      .run();
  }
  for (const id of removed) logMembership(ctx, loaded, "modules", "removed", id, moduleNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "modules", "added", id, names.get(id)?.name ?? id);
}

/** Adds subscriber rows that do not exist yet; returns the ids actually added. */
export function addSubscribers(ctx: TesseraContext, itemId: string, actorIds: string[]): string[] {
  const existing = new Set(listSubscriberIds(ctx, itemId));
  const added = [...new Set(actorIds)].filter((id) => !existing.has(id));
  if (added.length > 0) {
    ctx.db
      .insert(work_item_subscriber)
      .values(added.map((actor_id) => ({ work_item_id: itemId, actor_id })))
      .run();
  }
  return added;
}

/** Replaces the assignee set (live actors only), auto-subscribes added actors and logs one row per change; inside withTx. */
export function syncAssignees(ctx: TesseraContext, loaded: LoadedWorkItem, actorIds: string[]): void {
  assertInTransaction(ctx, "syncAssignees");
  const names = resolveActors(ctx, actorIds);
  const { added, removed } = diffSets(currentAssigneeIds(ctx, loaded.item.id), actorIds);
  if (removed.length > 0) {
    ctx.db.delete(work_item_assignee).where(and(eq(work_item_assignee.work_item_id, loaded.item.id), inArray(work_item_assignee.actor_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_assignee)
      .values(added.map((actor_id) => ({ work_item_id: loaded.item.id, actor_id })))
      .run();
    addSubscribers(ctx, loaded.item.id, added);
  }
  for (const id of removed) logMembership(ctx, loaded, "assignees", "removed", id, actorNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "assignees", "added", id, names.get(id) ?? id);
}

/** Subscribes `actorId` (idempotent) and logs when a row was added; inside withTx. */
export function insertSubscriber(ctx: TesseraContext, loaded: LoadedWorkItem, actorId: string): boolean {
  assertInTransaction(ctx, "insertSubscriber");
  const name = getActor(ctx, actorId).name;
  const added = addSubscribers(ctx, loaded.item.id, [actorId]);
  if (added.length === 0) return false;
  logMembership(ctx, loaded, "subscribers", "added", actorId, name);
  return true;
}

/** Removes the subscription (idempotent) and logs when a row was removed; inside withTx. */
export function dropSubscriber(ctx: TesseraContext, loaded: LoadedWorkItem, actorId: string): boolean {
  assertInTransaction(ctx, "dropSubscriber");
  const result = ctx.db
    .delete(work_item_subscriber)
    .where(and(eq(work_item_subscriber.work_item_id, loaded.item.id), eq(work_item_subscriber.actor_id, actorId)))
    .run();
  if (result.changes === 0) return false;
  logMembership(ctx, loaded, "subscribers", "removed", actorId, actorNameOrId(ctx, actorId));
  return true;
}

export const SetLabelsInput = IdListSchema.max(MAX_IDS);
export const SetModulesInput = IdListSchema.max(MAX_IDS);

/** Replace semantics: the item ends up with exactly `label_ids`. */
export function setLabels(ctx: TesseraContext, id: string, label_ids: string[]): WorkItem {
  const ids = validateInput(SetLabelsInput, label_ids);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    syncLabels(ctx, loaded, ids);
    touch(ctx, loaded.item.id);
    return loadWorkItem(ctx, id);
  });
}

/** Replace semantics: the item ends up with exactly `module_ids`. */
export function setModules(ctx: TesseraContext, id: string, module_ids: string[]): WorkItem {
  const ids = validateInput(SetModulesInput, module_ids);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    syncModules(ctx, loaded, ids);
    touch(ctx, loaded.item.id);
    return loadWorkItem(ctx, id);
  });
}

/** Moves updated_at / updated_by after a junction-only change. */
function touch(ctx: TesseraContext, id: string): void {
  ctx.db.update(work_item).set({ updated_at: ctx.now(), updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
}
