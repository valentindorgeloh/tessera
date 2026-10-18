import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { diffFields, logActivity, type IdentifierResolver } from "../activity";
import type { TesseraContext } from "../core/context";
import { conflict, notFound, rule, validateInput } from "../core/errors";
import { assertInTransaction, withTx } from "../core/tx";
import { upsertWorkItemFts } from "../db/fts";
import { work_item, work_item_version } from "../db/schema";
import { IdSchema, IsoDateSchema, PrioritySchema } from "../schemas";
import type { WorkItemRow } from "../types";
import { RestoreWorkItemVersionInput, writeWorkItemVersion } from "./versions";
import {
  DESCRIPTION,
  ENTITY,
  type LoadedWorkItem,
  WORK_ITEM_NAME,
  type WorkItem,
  assertCycleAllowed,
  assertCycleOpen,
  assertNotTriage,
  checkDates,
  cycleNameOrId,
  cycleRowIfLive,
  estimatePointValueOrId,
  itemKey,
  keyOrId,
  loadWritableWorkItem,
  nextCompletedAt,
  resolveCycle,
  resolveEstimatePoint,
  resolveParent,
  resolveState,
} from "./model";
import { loadWorkItem } from "./hydrate";
import { hasOpenIntakeItem } from "./transfer";

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const UpdateWorkItemInput = z
  .object({
    name: WORK_ITEM_NAME.describe("New title."),
    state_id: IdSchema.describe("New state (same project); completed_at follows the state group."),
    priority: PrioritySchema.describe("New priority."),
    parent_id: IdSchema.nullable().describe("New parent (same project, acyclic) or null."),
    cycle_id: IdSchema.nullable().describe("New cycle (same project) or null."),
    estimate_point_id: IdSchema.nullable().describe("New estimate point or null."),
    start_date: IsoDateSchema.nullable().describe("New start date or null."),
    target_date: IsoDateSchema.nullable().describe("New target date (not before start_date) or null."),
  })
  .partial()
  .strict();

export type UpdateWorkItemInputType = z.input<typeof UpdateWorkItemInput>;
type UpdatePatch = z.output<typeof UpdateWorkItemInput>;

const UPDATE_FIELDS = ["name", "state_id", "priority", "parent_id", "cycle_id", "estimate_point_id", "start_date", "target_date"] as const;

/**
 * Validates and writes a field-scoped patch, logs one activity row per
 * changed field with human identifiers and refreshes the FTS row on a name
 * change. Shared by updateWorkItem, bulkUpdateWorkItems and moveWorkItem.
 */
export function applyPatch(ctx: TesseraContext, loaded: LoadedWorkItem, data: UpdatePatch): WorkItemRow {
  assertInTransaction(ctx, "applyPatch");
  const { item, project: projectRow } = loaded;
  const identifiers = new Map<string, string>();
  const beforeState = resolveState(ctx, projectRow.id, item.state_id);
  identifiers.set(beforeState.id, beforeState.name);
  let afterState = beforeState;
  if (data.state_id !== undefined && data.state_id !== item.state_id) {
    // Intake decides when a triage item reaches the board (accept / decline), never a plain state change.
    if (beforeState.state_group === "triage" && hasOpenIntakeItem(ctx, item.id)) {
      throw rule("intake_pending", `Accept or decline the intake item before changing the state of ${itemKey(projectRow, item)}`);
    }
    afterState = resolveState(ctx, projectRow.id, data.state_id);
    assertNotTriage(afterState);
    identifiers.set(afterState.id, afterState.name);
  }
  const parentId = data.parent_id === undefined ? item.parent_id : data.parent_id;
  if (parentId !== null && parentId !== item.parent_id) {
    const parent = resolveParent(ctx, projectRow.id, parentId, item.id);
    identifiers.set(parent.id, itemKey(projectRow, parent));
  }
  if (item.parent_id !== null) identifiers.set(item.parent_id, keyOrId(ctx, item.parent_id));
  const cycleId = data.cycle_id === undefined ? item.cycle_id : data.cycle_id;
  if (cycleId !== item.cycle_id) {
    // Membership of a completed or archived cycle only changes through transfer (schema.md "Cycles").
    const leaving = item.cycle_id === null ? null : cycleRowIfLive(ctx, item.cycle_id);
    if (leaving) assertCycleOpen(ctx, leaving);
    if (cycleId !== null) {
      const cycleRow = resolveCycle(ctx, projectRow.id, cycleId);
      assertCycleOpen(ctx, cycleRow);
      assertCycleAllowed(afterState, cycleRow);
      identifiers.set(cycleRow.id, cycleRow.name);
    }
  }
  if (item.cycle_id !== null) identifiers.set(item.cycle_id, cycleNameOrId(ctx, item.cycle_id));
  const pointId = data.estimate_point_id === undefined ? item.estimate_point_id : data.estimate_point_id;
  if (pointId !== null && pointId !== item.estimate_point_id) identifiers.set(pointId, resolveEstimatePoint(ctx, projectRow.id, pointId));
  if (item.estimate_point_id !== null) identifiers.set(item.estimate_point_id, estimatePointValueOrId(ctx, item.estimate_point_id));
  const start = data.start_date === undefined ? item.start_date : data.start_date;
  const target = data.target_date === undefined ? item.target_date : data.target_date;
  checkDates(start, target);
  const now = ctx.now();
  const after = ctx.db
    .update(work_item)
    .set({
      name: data.name ?? item.name,
      state_id: afterState.id,
      priority: data.priority ?? item.priority,
      parent_id: parentId,
      cycle_id: cycleId,
      estimate_point_id: pointId,
      start_date: start,
      target_date: target,
      completed_at: nextCompletedAt(ctx, beforeState, afterState, item.completed_at),
      updated_at: now,
      updated_by: ctx.actor.id,
    })
    .where(eq(work_item.id, item.id))
    .returning()
    .get();
  const resolve: IdentifierResolver = (field, value) => {
    if (typeof value !== "string") return null;
    if (field === "state_id" || field === "parent_id" || field === "cycle_id" || field === "estimate_point_id") return identifiers.get(value) ?? value;
    return value;
  };
  diffFields(ctx, { project_id: projectRow.id, entity_type: ENTITY, entity_id: item.id, work_item_id: item.id }, item, after, UPDATE_FIELDS, resolve);
  if (after.name !== item.name) {
    upsertWorkItemFts(ctx.sqlite, { id: after.id, project_id: after.project_id, name: after.name, body: after.description_md });
  }
  return after;
}

export function updateWorkItem(ctx: TesseraContext, id: string, patch: UpdateWorkItemInputType): WorkItem {
  const data = validateInput(UpdateWorkItemInput, patch);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    applyPatch(ctx, loaded, data);
    return loadWorkItem(ctx, id);
  });
}

export const UpdateWorkItemDescriptionInput = z
  .object({
    description_md: DESCRIPTION.describe("New Markdown body."),
    expected_description_version: z.number().int().min(0).describe("description_version the client last read; CONFLICT when it moved."),
  })
  .strict();

export type UpdateWorkItemDescriptionInputType = z.input<typeof UpdateWorkItemDescriptionInput>;

/** Compare-and-set on description_version: a stale version is CONFLICT with the current one in details. An unchanged body is a no-op. */
export function updateWorkItemDescription(ctx: TesseraContext, id: string, input: UpdateWorkItemDescriptionInputType): WorkItem {
  const data = validateInput(UpdateWorkItemDescriptionInput, input);
  return withTx(ctx, () => {
    const { item, project: projectRow } = loadWritableWorkItem(ctx, id);
    if (item.description_version !== data.expected_description_version) {
      throw conflict(`Description changed since version ${data.expected_description_version} (now ${item.description_version})`, {
        id,
        current_version: item.description_version,
      });
    }
    if (item.description_md === data.description_md) return loadWorkItem(ctx, id);
    const now = ctx.now();
    const result = ctx.db
      .update(work_item)
      .set({ description_md: data.description_md, description_version: item.description_version + 1, updated_at: now, updated_by: ctx.actor.id })
      .where(and(eq(work_item.id, id), eq(work_item.description_version, data.expected_description_version)))
      .run();
    if (result.changes === 0) throw conflict("Description changed concurrently", { id });
    upsertWorkItemFts(ctx.sqlite, { id, project_id: item.project_id, name: item.name, body: data.description_md });
    writeWorkItemVersion(ctx, { id, name: item.name, description_md: data.description_md, description_version: item.description_version + 1 });
    logActivity(ctx, {
      project_id: projectRow.id,
      entity_type: ENTITY,
      entity_id: id,
      work_item_id: id,
      verb: "updated",
      field: "description_md",
      old_value: String(item.description_version),
      new_value: String(item.description_version + 1),
    });
    return loadWorkItem(ctx, id);
  });
}

/** Compare-and-set of a stored description. The name stays. The description write records the snapshot; this adds the `restored` activity row. */
export function restoreWorkItemVersion(ctx: TesseraContext, input: z.input<typeof RestoreWorkItemVersionInput>): WorkItem {
  const data = validateInput(RestoreWorkItemVersionInput, input);
  return withTx(ctx, () => {
    const { item, project: projectRow } = loadWritableWorkItem(ctx, data.work_item_id);
    const version = ctx.db
      .select()
      .from(work_item_version)
      .where(and(eq(work_item_version.id, data.version_id), eq(work_item_version.work_item_id, item.id)))
      .get();
    if (!version) throw notFound("work_item_version", data.version_id);
    const updated = updateWorkItemDescription(ctx, item.id, {
      description_md: version.description_md,
      expected_description_version: data.expected_description_version,
    });
    logActivity(ctx, {
      project_id: projectRow.id,
      entity_type: ENTITY,
      entity_id: item.id,
      work_item_id: item.id,
      verb: "restored",
      field: "description",
      new_value: String(version.version),
    });
    return updated;
  });
}
