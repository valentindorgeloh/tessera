/**
 * Estimate systems. A project has at most one active system. Replacing it
 * keeps item points whose value matches (same type only) and clears the rest.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { notFound, rule, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { assertInTransaction, withTx } from "./core/tx";
import { estimate, estimate_point, project, work_item } from "./db/schema";
import { ESTIMATE_POINTS_MAX, ESTIMATE_POINTS_MIN, IdSchema } from "./schemas";
import type { EstimatePointRow, EstimateRow, EstimateType } from "./types";
import { loadWritableProject } from "./work-items/model";

export type EstimateView = EstimateRow & { points: EstimatePointRow[] };

export const EstimatePointInput = z
  .object({
    id: IdSchema.optional().describe("Existing point id. Omit to add a point."),
    value: z.string().trim().min(1).max(24).describe("The value: a number, a category name, or whole minutes."),
    description: z.string().max(200).default("").describe("Short note shown next to the value."),
  })
  .strict();

export type EstimatePointInputType = z.output<typeof EstimatePointInput>;

const CreateInput = z
  .object({
    project_id: IdSchema.describe("Project the system belongs to."),
    name: z.string().trim().min(1).max(120).describe("Name of the estimate system."),
    type: z.enum(["points", "categories", "time"]).describe("points, categories or time."),
    points: z.array(EstimatePointInput).min(ESTIMATE_POINTS_MIN).max(ESTIMATE_POINTS_MAX).describe("Two to six values, lowest first. No ids on create."),
  })
  .strict();

const UpdateInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional().describe("New name."),
    points: z.array(EstimatePointInput).min(ESTIMATE_POINTS_MIN).max(ESTIMATE_POINTS_MAX).optional().describe("The full ordered point list. Omitted points are removed."),
    remap: z.record(z.string(), z.string().nullable()).optional().describe("Removed point id to a remaining point id, or null to clear the items that used it."),
  })
  .strict();

export function listEstimates(ctx: TesseraContext, input: { project_id: string; include_archived?: boolean }): EstimateView[] {
  const data = validateInput(
    z.object({
      project_id: IdSchema.describe("Project."),
      include_archived: z.boolean().optional().describe("Include archived systems."),
    }).strict(),
    input,
  );
  const filters = [eq(estimate.project_id, data.project_id), isNull(estimate.deleted_at)];
  if (data.include_archived !== true) filters.push(isNull(estimate.archived_at));
  const rows = ctx.db.select().from(estimate).where(and(...filters)).orderBy(asc(estimate.created_at)).all();
  return rows.map((row) => ({ ...row, points: pointsOf(ctx, row.id) }));
}

export function getEstimate(ctx: TesseraContext, id: string): EstimateView {
  const row = liveEstimate(ctx, id);
  return { ...row, points: pointsOf(ctx, row.id) };
}

export function getActiveEstimate(ctx: TesseraContext, projectId: string): EstimateView | null {
  const row = ctx.db
    .select()
    .from(estimate)
    .where(and(eq(estimate.project_id, projectId), isNull(estimate.archived_at), isNull(estimate.deleted_at)))
    .get();
  if (!row) return null;
  return { ...row, points: pointsOf(ctx, row.id) };
}

export function createEstimate(ctx: TesseraContext, input: z.input<typeof CreateInput>): EstimateView {
  const data = validateInput(CreateInput, input);
  if (data.points.some((point) => point.id !== undefined)) throw validation({ points: "ids" }, "New points do not take ids");
  validateEstimateValues(data.type, data.points.map((point) => point.value));
  return withTx(ctx, () => {
    const projectRow = loadWritableProject(ctx, data.project_id);
    const previous = getActiveEstimate(ctx, projectRow.id);
    const now = ctx.now();
    if (previous) {
      ctx.db.update(estimate).set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(estimate.id, previous.id)).run();
      logActivity(ctx, { project_id: projectRow.id, entity_type: "estimate", entity_id: previous.id, verb: "archived", old_identifier: previous.name });
    }
    const row = ctx.db
      .insert(estimate)
      .values({
        id: newId(),
        project_id: projectRow.id,
        name: data.name,
        type: data.type,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    const created = insertPoints(ctx, row.id, data.points, now);
    ctx.db.update(project).set({ estimate_id: row.id, updated_at: now, updated_by: ctx.actor.id }).where(eq(project.id, projectRow.id)).run();
    if (previous) remapByValue(ctx, previous, data.type, created);
    logActivity(ctx, { project_id: projectRow.id, entity_type: "estimate", entity_id: row.id, verb: "created", new_identifier: row.name });
    return { ...row, points: created };
  });
}

export function updateEstimate(ctx: TesseraContext, id: string, input: z.input<typeof UpdateInput>): EstimateView {
  const data = validateInput(UpdateInput, input);
  return withTx(ctx, () => {
    const before = liveEstimate(ctx, id);
    if (before.archived_at !== null) throw rule("estimate_archived", "An archived estimate system cannot be edited");
    loadWritableProject(ctx, before.project_id);
    const now = ctx.now();
    if (data.points) {
      validateEstimateValues(before.type, data.points.map((point) => point.value));
      replacePoints(ctx, before, data.points, data.remap ?? {}, now);
    }
    const after = ctx.db
      .update(estimate)
      .set({ name: data.name ?? before.name, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(estimate.id, id))
      .returning()
      .get();
    logActivity(ctx, { project_id: before.project_id, entity_type: "estimate", entity_id: id, verb: "updated", new_identifier: after.name });
    return { ...after, points: pointsOf(ctx, id) };
  });
}

export function deleteEstimate(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const before = liveEstimate(ctx, id);
    loadWritableProject(ctx, before.project_id);
    const now = ctx.now();
    const stamp = { deleted_at: now, updated_at: now, updated_by: ctx.actor.id };
    const pointIds = pointsOf(ctx, id).map((point) => point.id);
    if (pointIds.length > 0) {
      ctx.db.update(work_item).set({ estimate_point_id: null, updated_at: now, updated_by: ctx.actor.id }).where(inArray(work_item.estimate_point_id, pointIds)).run();
      ctx.db.update(estimate_point).set(stamp).where(inArray(estimate_point.id, pointIds)).run();
    }
    ctx.db.update(project).set({ estimate_id: null, updated_at: now, updated_by: ctx.actor.id }).where(eq(project.estimate_id, id)).run();
    ctx.db.update(estimate).set(stamp).where(eq(estimate.id, id)).run();
    logActivity(ctx, { project_id: before.project_id, entity_type: "estimate", entity_id: id, verb: "deleted", old_identifier: before.name });
  });
}

/** Throws VALIDATION when the values break the type's rules. */
export function validateEstimateValues(type: EstimateType, values: string[]): void {
  if (values.length < ESTIMATE_POINTS_MIN || values.length > ESTIMATE_POINTS_MAX) {
    throw validation({ points: values.length }, `An estimate system has ${ESTIMATE_POINTS_MIN} to ${ESTIMATE_POINTS_MAX} values`);
  }
  if (type === "categories") {
    const seen = new Set<string>();
    for (const value of values) {
      if (value.length < 1 || value.length > 24) throw validation({ value }, "A category is 1 to 24 characters");
      const key = value.toLowerCase();
      if (seen.has(key)) throw validation({ value }, `Duplicate category "${value}"`);
      seen.add(key);
    }
    return;
  }
  const numbers = values.map((value) => parseTyped(type, value));
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] <= numbers[i - 1]) throw validation({ value: values[i] }, "Values must be strictly ascending");
  }
}

function parseTyped(type: EstimateType, value: string): number {
  if (type === "time") {
    if (!/^\d+$/.test(value)) throw validation({ value }, "Time values are whole minutes");
    const n = Number(value);
    if (n < 1 || n > 10_080) throw validation({ value }, "Time values are between 1 and 10080 minutes");
    return n;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw validation({ value }, "Point values are numbers with at most two decimals");
  return Number(value);
}

function pointsOf(ctx: TesseraContext, estimateId: string): EstimatePointRow[] {
  return ctx.db
    .select()
    .from(estimate_point)
    .where(and(eq(estimate_point.estimate_id, estimateId), isNull(estimate_point.deleted_at)))
    .orderBy(asc(estimate_point.position))
    .all();
}

function liveEstimate(ctx: TesseraContext, id: string): EstimateRow {
  const row = ctx.db.select().from(estimate).where(and(eq(estimate.id, id), isNull(estimate.deleted_at))).get();
  if (!row) throw notFound("estimate", id);
  return row;
}

function insertPoints(ctx: TesseraContext, estimateId: string, points: EstimatePointInputType[], now: string): EstimatePointRow[] {
  assertInTransaction(ctx, "insertPoints");
  const rows: EstimatePointRow[] = [];
  for (let position = 0; position < points.length; position += 1) {
    const point = points[position];
    rows.push(
      ctx.db
        .insert(estimate_point)
        .values({
          id: newId(),
          estimate_id: estimateId,
          position,
          value: point.value,
          description: point.description,
          created_at: now,
          updated_at: now,
          created_by: ctx.actor.id,
          updated_by: ctx.actor.id,
        })
        .returning()
        .get(),
    );
  }
  return rows;
}

function remapByValue(ctx: TesseraContext, previous: EstimateView, nextType: EstimateType, created: EstimatePointRow[]): void {
  const oldPoints = previous.points;
  if (oldPoints.length === 0) return;
  const sameType = previous.type === nextType;
  const byValue = new Map(created.map((point) => [point.value.trim().toLowerCase(), point.id]));
  const now = ctx.now();
  for (const old of oldPoints) {
    const nextId = sameType ? (byValue.get(old.value.trim().toLowerCase()) ?? null) : null;
    ctx.db
      .update(work_item)
      .set({ estimate_point_id: nextId, updated_at: now, updated_by: ctx.actor.id })
      .where(and(eq(work_item.estimate_point_id, old.id), isNull(work_item.deleted_at)))
      .run();
  }
}

function replacePoints(ctx: TesseraContext, before: EstimateRow, next: EstimatePointInputType[], remap: Record<string, string | null>, now: string): void {
  const current = pointsOf(ctx, before.id);
  const keptIds = new Set(next.map((point) => point.id).filter((id): id is string => id !== undefined));
  for (const id of keptIds) {
    if (!current.some((point) => point.id === id)) throw notFound("estimate_point", id);
  }
  const removed = current.filter((point) => !keptIds.has(point.id));
  for (const point of removed) {
    const uses = ctx.db
      .select({ id: work_item.id })
      .from(work_item)
      .where(and(eq(work_item.estimate_point_id, point.id), isNull(work_item.deleted_at)))
      .all();
    if (uses.length === 0) continue;
    if (!(point.id in remap)) throw rule("estimate_point_in_use", `${uses.length} work item(s) still use ${point.value}`);
    const target = remap[point.id];
    if (target !== null && !keptIds.has(target)) throw validation({ remap: point.id }, "Move items to a point that stays, or clear them");
    ctx.db
      .update(work_item)
      .set({ estimate_point_id: target, updated_at: now, updated_by: ctx.actor.id })
      .where(and(eq(work_item.estimate_point_id, point.id), isNull(work_item.deleted_at)))
      .run();
  }
  if (removed.length > 0) {
    ctx.db
      .update(estimate_point)
      .set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(inArray(estimate_point.id, removed.map((point) => point.id)))
      .run();
  }
  next.forEach((point, position) => {
    if (point.id) {
      ctx.db
        .update(estimate_point)
        .set({ position, value: point.value, description: point.description, updated_at: now, updated_by: ctx.actor.id })
        .where(eq(estimate_point.id, point.id))
        .run();
      return;
    }
    ctx.db
      .insert(estimate_point)
      .values({
        id: newId(),
        estimate_id: before.id,
        position,
        value: point.value,
        description: point.description,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .run();
  });
}
