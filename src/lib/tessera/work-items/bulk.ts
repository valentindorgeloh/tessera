/**
 * Bulk edits. Every call is one transaction: one failure rolls the whole
 * set back. Archive runs only when every item is completed or cancelled.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { notFound, rule, validateInput, validation } from "../core/errors";
import { withTx } from "../core/tx";
import { work_item } from "../db/schema";
import { IdListSchema } from "../schemas";
import { archiveWorkItem, deleteWorkItem, unarchiveWorkItem } from "./lifecycle";
import { loadWorkItem } from "./hydrate";
import {
  MAX_IDS,
  type WorkItem,
  itemKey,
  loadWritableWorkItem,
  resolveState,
} from "./model";
import { currentAssigneeIds, currentLabelIds, currentModuleIds, syncAssignees, syncLabels, syncModules } from "./membership";
import { UpdateWorkItemInput, applyPatch } from "./update";

const IdSet = IdListSchema.max(MAX_IDS).optional();

export const BulkUpdateWorkItemsInput = z
  .object({
    ids: IdListSchema.min(1).max(MAX_IDS).describe("Work items to change, at most 500."),
    patch: UpdateWorkItemInput.default({}).describe("Fields applied to every item. Omit it to change only memberships."),
    add_label_ids: IdSet.describe("Labels added to every item. An id in both add and remove is refused."),
    remove_label_ids: IdSet.describe("Labels removed from every item. Other labels stay."),
    add_assignee_ids: IdSet.describe("Assignees added to every item."),
    remove_assignee_ids: IdSet.describe("Assignees removed from every item."),
    add_module_ids: IdSet.describe("Modules added to every item."),
    remove_module_ids: IdSet.describe("Modules removed from every item."),
  })
  .strict();

export type BulkUpdateWorkItemsInputType = z.input<typeof BulkUpdateWorkItemsInput>;

const IdsInput = z.object({ ids: IdListSchema.min(1).max(MAX_IDS).describe("Work items to change, at most 500.") }).strict();

/** Applies one patch and add/remove membership edits to every item. One failure rolls back all of them. */
export function bulkUpdateWorkItems(ctx: TesseraContext, input: BulkUpdateWorkItemsInputType): WorkItem[] {
  const data = validateInput(BulkUpdateWorkItemsInput, input);
  refuseOverlap(data.add_label_ids, data.remove_label_ids, "label_ids");
  refuseOverlap(data.add_assignee_ids, data.remove_assignee_ids, "assignee_ids");
  refuseOverlap(data.add_module_ids, data.remove_module_ids, "module_ids");
  return withTx(ctx, () => {
    const unique = [...new Set(data.ids)];
    for (const id of unique) {
      const loaded = loadWritableWorkItem(ctx, id);
      applyPatch(ctx, loaded, data.patch);
      const fresh = loadWritableWorkItem(ctx, id);
      applySet(currentLabelIds(ctx, id), data.add_label_ids ?? [], data.remove_label_ids ?? [], (ids) => syncLabels(ctx, fresh, ids));
      applySet(currentAssigneeIds(ctx, id), data.add_assignee_ids ?? [], data.remove_assignee_ids ?? [], (ids) => syncAssignees(ctx, fresh, ids));
      applySet(currentModuleIds(ctx, id), data.add_module_ids ?? [], data.remove_module_ids ?? [], (ids) => syncModules(ctx, fresh, ids));
    }
    return unique.map((id) => loadWorkItem(ctx, id));
  });
}

/** Archives every item, or none of them when any item is still open. */
export function bulkArchiveWorkItems(ctx: TesseraContext, ids: string[]): WorkItem[] {
  const data = validateInput(IdsInput, { ids });
  return withTx(ctx, () => {
    const unique = [...new Set(data.ids)];
    const open: string[] = [];
    for (const id of unique) {
      const loaded = loadWritableWorkItem(ctx, id);
      const stateRow = resolveState(ctx, loaded.project.id, loaded.item.state_id);
      if (stateRow.state_group !== "completed" && stateRow.state_group !== "cancelled") open.push(itemKey(loaded.project, loaded.item));
    }
    if (open.length > 0) {
      const shown = open.slice(0, 5).join(", ");
      throw rule("archive_open_item", `Only completed or cancelled work items can be archived (${shown})`);
    }
    for (const id of unique) archiveWorkItem(ctx, id);
    return unique.map((id) => loadWorkItem(ctx, id));
  });
}

export function bulkUnarchiveWorkItems(ctx: TesseraContext, ids: string[]): WorkItem[] {
  const data = validateInput(IdsInput, { ids });
  return withTx(ctx, () => {
    const unique = [...new Set(data.ids)];
    for (const id of unique) unarchiveWorkItem(ctx, id);
    return unique.map((id) => loadWorkItem(ctx, id));
  });
}

/** Soft-deletes every item and its subtree. A missing id rolls the whole call back. */
export function bulkDeleteWorkItems(ctx: TesseraContext, ids: string[]): { ids: string[]; deleted: true } {
  const data = validateInput(IdsInput, { ids });
  return withTx(ctx, () => {
    const unique = [...new Set(data.ids)];
    const existing = ctx.db
      .select({ id: work_item.id })
      .from(work_item)
      .where(and(inArray(work_item.id, unique), isNull(work_item.deleted_at)))
      .all()
      .map((row) => row.id);
    const missing = unique.find((id) => !existing.includes(id));
    if (missing) throw notFound("work_item", missing);
    for (const id of unique) {
      const still = ctx.db.select({ id: work_item.id }).from(work_item).where(and(eq(work_item.id, id), isNull(work_item.deleted_at))).get();
      if (!still) continue;
      deleteWorkItem(ctx, id);
    }
    return { ids: unique, deleted: true };
  });
}

function refuseOverlap(add: string[] | undefined, remove: string[] | undefined, field: string): void {
  const both = (add ?? []).filter((id) => (remove ?? []).includes(id));
  if (both.length > 0) throw validation({ [field]: both }, "An id cannot be both added and removed");
}

function applySet(current: string[], add: string[], remove: string[], sync: (ids: string[]) => void): void {
  if (add.length === 0 && remove.length === 0) return;
  const next = new Set(current);
  for (const id of remove) next.delete(id);
  for (const id of add) next.add(id);
  sync([...next]);
}
