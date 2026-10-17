import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { diffFields } from "../activity";
import type { TesseraContext } from "../core/context";
import { rule, validateInput, validation } from "../core/errors";
import { sortOrderBetween } from "../core/order";
import { withTx } from "../core/tx";
import { work_item } from "../db/schema";
import { NONE_GROUP_ID } from "../filters";
import { GroupBySchema, IdSchema, IsoDateSchema, PrioritySchema } from "../schemas";
import type { GroupBy, WorkItemRow } from "../types";
import { ENTITY, type LoadedWorkItem, type WorkItem, getWorkItemRow, itemKey, loadWritableWorkItem } from "./model";
import { loadWorkItem } from "./hydrate";
import { currentAssigneeIds, currentLabelIds, currentModuleIds, syncAssignees, syncLabels, syncModules } from "./membership";
import { applyPatch } from "./update";

// ---------------------------------------------------------------------------
// Move (reorder and change the grouped field)
// ---------------------------------------------------------------------------

/**
 * `before_id` / `after_id` are the neighbours in the list the item was dropped
 * into. `group_by` + `value` change the grouped field: a state, priority,
 * cycle or date value (null = the "none" group). For labels, assignees and
 * modules the item gains `value` and loses `from_value` (the group it was
 * dragged out of) instead of being replaced; a `value` of null or "none"
 * clears the field (decision 30). `sub_group_by` + `sub_value` +
 * `sub_from_value` change a second axis (a board swimlane) in the same
 * transaction. They are checked in `moveWorkItem`, not in a schema refine, so
 * the tool's `.extend` keeps working.
 */
export const MoveWorkItemInput = z
  .object({
    group_by: GroupBySchema.optional().describe("Grouped field to change; omit for a pure reorder."),
    value: z.string().nullable().optional().describe("Target group value (id, priority, date); null for the none group."),
    from_value: z.string().nullable().optional().describe("For labels, assignees and modules: the group value the item left."),
    sub_group_by: GroupBySchema.optional().describe("Second grouping axis changed by the same drop (a board swimlane). Needs group_by and must differ from it."),
    sub_value: z.string().nullable().optional().describe('Target value on sub_group_by; null or "none" = the none group.'),
    sub_from_value: z.string().nullable().optional().describe("For labels, assignees and module on sub_group_by: the value the item leaves."),
    before_id: IdSchema.optional().describe("Item that will come directly before this one."),
    after_id: IdSchema.optional().describe("Item that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.group_by !== undefined || value.before_id !== undefined || value.after_id !== undefined, {
    message: "group_by, before_id or after_id is required",
  });

export type MoveWorkItemInputType = z.input<typeof MoveWorkItemInput>;

function loadNeighbour(ctx: TesseraContext, loaded: LoadedWorkItem, id: string): WorkItemRow {
  if (id === loaded.item.id) throw validation({ id }, "An item cannot be its own neighbour");
  const row = getWorkItemRow(ctx, id);
  if (row.project_id !== loaded.project.id) throw rule("neighbour_project", "Neighbours must belong to the same project");
  return row;
}

/** Nearest existing key strictly after (or before) `sortOrder` in the project, ignoring the moved item; null at the edge. */
function adjacentKey(ctx: TesseraContext, loaded: LoadedWorkItem, sortOrder: string, direction: "after" | "before"): string | null {
  const column = work_item.sort_order;
  const row = ctx.db
    .select({ key: direction === "after" ? sql<string | null>`min(${column})` : sql<string | null>`max(${column})` })
    .from(work_item)
    .where(
      and(
        eq(work_item.project_id, loaded.project.id),
        isNull(work_item.deleted_at),
        sql`${work_item.id} != ${loaded.item.id}`,
        direction === "after" ? sql`${column} > ${sortOrder}` : sql`${column} < ${sortOrder}`,
      ),
    )
    .get();
  return row?.key ?? null;
}

/** Key between the given neighbour and its real project-wide neighbour so the new key is unique. */
function sortOrderForDrop(ctx: TesseraContext, loaded: LoadedWorkItem, beforeId: string | undefined, afterId: string | undefined): string {
  const before = beforeId === undefined ? null : loadNeighbour(ctx, loaded, beforeId);
  const after = afterId === undefined ? null : loadNeighbour(ctx, loaded, afterId);
  if (before && after && before.sort_order >= after.sort_order) {
    throw validation({ before_id: beforeId, after_id: afterId }, "before_id must come before after_id");
  }
  if (before) return sortOrderBetween(before.sort_order, adjacentKey(ctx, loaded, before.sort_order, "after"));
  if (after) return sortOrderBetween(adjacentKey(ctx, loaded, after.sort_order, "before"), after.sort_order);
  return loaded.item.sort_order;
}

function parseGroupValue<S extends z.ZodType>(schema: S, value: string | null | undefined, field: string): z.output<S> {
  const result = schema.safeParse(value ?? null);
  if (!result.success) throw validation(result.error.issues, `Invalid value for ${field}`);
  return result.data;
}

const NULLABLE_ID = IdSchema.nullable();
const NULLABLE_DATE = IsoDateSchema.nullable();

type GroupAxis = { group_by: GroupBy; value: string | null | undefined; from_value: string | null | undefined };

/** Applies a group change on one axis (decision 30). Writes through the caller's transaction. */
function applyGroupChange(ctx: TesseraContext, loaded: LoadedWorkItem, axis: GroupAxis): void {
  const field = axis.group_by;
  const value = axis.value === NONE_GROUP_ID ? null : (axis.value ?? null);
  const fromValue = axis.from_value === NONE_GROUP_ID ? null : (axis.from_value ?? null);
  switch (field) {
    case "state":
      applyPatch(ctx, loaded, { state_id: parseGroupValue(IdSchema, value, field) });
      return;
    case "priority":
      applyPatch(ctx, loaded, { priority: parseGroupValue(PrioritySchema, axis.value, field) });
      return;
    case "cycle":
      applyPatch(ctx, loaded, { cycle_id: parseGroupValue(NULLABLE_ID, value, field) });
      return;
    case "start_date":
      applyPatch(ctx, loaded, { start_date: parseGroupValue(NULLABLE_DATE, value, field) });
      return;
    case "target_date":
      applyPatch(ctx, loaded, { target_date: parseGroupValue(NULLABLE_DATE, value, field) });
      return;
    case "labels": {
      const next = withValue(currentLabelIds(ctx, loaded.item.id), parseGroupValue(NULLABLE_ID, value, field), fromValue);
      syncLabels(ctx, loaded, next);
      return;
    }
    case "assignees": {
      const next = withValue(currentAssigneeIds(ctx, loaded.item.id), parseGroupValue(NULLABLE_ID, value, field), fromValue);
      syncAssignees(ctx, loaded, next);
      return;
    }
    case "module": {
      const next = withValue(currentModuleIds(ctx, loaded.item.id), parseGroupValue(NULLABLE_ID, value, field), fromValue);
      syncModules(ctx, loaded, next);
      return;
    }
    case "state_group":
    case "created_by":
    case "created_at":
    case "project":
      throw rule("group_not_movable", `Items cannot be moved between ${field} groups`);
  }
}

/** Multi-valued group move: a drop into none (`value` null) clears the field; otherwise gain `value`, lose `fromValue`, keep the rest. */
function withValue(current: string[], value: string | null, fromValue: string | null): string[] {
  if (value === null) return [];
  const next = current.filter((id) => id !== fromValue);
  if (!next.includes(value)) next.push(value);
  return next;
}

function subAxisError(message: string): ReturnType<typeof validation> {
  return validation([{ code: "custom", path: ["sub_group_by"], message }], `Invalid input: sub_group_by: ${message}`);
}

/** The sub-axis rules of the input; at path `sub_group_by`. */
function assertSubAxis(data: z.output<typeof MoveWorkItemInput>): void {
  if (data.sub_group_by === undefined) return;
  if (data.group_by === undefined) throw subAxisError("sub_group_by needs group_by");
  if (data.sub_group_by === data.group_by) throw subAxisError("sub_group_by must differ from group_by");
  if (data.sub_value === undefined) throw subAxisError("sub_value is required with sub_group_by");
}

export function moveWorkItem(ctx: TesseraContext, id: string, input: MoveWorkItemInputType): WorkItem {
  const data = validateInput(MoveWorkItemInput, input);
  assertSubAxis(data);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    if (data.group_by !== undefined) {
      applyGroupChange(ctx, loaded, { group_by: data.group_by, value: data.value, from_value: data.from_value });
      if (data.sub_group_by !== undefined) {
        // The main axis may have rewritten the row; the sub axis must patch from its current state, not the loaded snapshot.
        const fresh: LoadedWorkItem = { ...loaded, item: getWorkItemRow(ctx, id) };
        applyGroupChange(ctx, fresh, { group_by: data.sub_group_by, value: data.sub_value, from_value: data.sub_from_value });
      }
    }
    if (data.before_id !== undefined || data.after_id !== undefined) {
      const before = getWorkItemRow(ctx, id);
      const sortOrder = sortOrderForDrop(ctx, loaded, data.before_id, data.after_id);
      if (sortOrder !== before.sort_order) {
        const now = ctx.now();
        const after = ctx.db
          .update(work_item)
          .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
          .where(eq(work_item.id, id))
          .returning()
          .get();
        diffFields(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: id, work_item_id: id }, before, after, ["sort_order"], () =>
          itemKey(loaded.project, before),
        );
      }
    }
    return loadWorkItem(ctx, id);
  });
}
