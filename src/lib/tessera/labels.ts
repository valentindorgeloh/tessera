/**
 * Labels (docs/contracts/service-api.md, schema.md "Labels"). Names are unique
 * per project (name_key); the hierarchy is one level deep: a label with a
 * parent can never be a parent itself. Deleting a parent deletes its children;
 * deleting any label removes it from work items and from saved filters
 * (saved-filters.ts, decision 32), all in one transaction.
 */
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, notFound, rule, validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { nameKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { withTx } from "./core/tx";
import { label, page_label, project, work_item_label } from "./db/schema";
import { stripIdsFromSavedFilters } from "./saved-filters";
import { IdSchema, PaletteColorSchema } from "./schemas";
import type { LabelRow, ProjectRow } from "./types";

export type Label = LabelRow;

const LABEL_NAME = z.string().trim().min(1).max(120);

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function activeInProject(projectId: string): SQL {
  return sql`${label.project_id} = ${projectId} AND ${label.deleted_at} IS NULL`;
}

function loadProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = ctx.db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deleted_at)))
    .get();
  if (!row) throw notFound("project", projectId);
  return row;
}

/** Archived projects are read-only except unarchive and delete. */
function loadWritableProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = loadProject(ctx, projectId);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  return row;
}

/** Non-deleted label by id; NOT_FOUND otherwise. */
export function getLabel(ctx: TesseraContext, id: string): Label {
  const row = ctx.db
    .select()
    .from(label)
    .where(and(eq(label.id, id), isNull(label.deleted_at)))
    .get();
  if (!row) throw notFound("label", id);
  return row;
}

function assertNameFree(ctx: TesseraContext, projectId: string, name: string, exceptId: string | null): string {
  const key = nameKey(name);
  const existing = ctx.db
    .select()
    .from(label)
    .where(and(eq(label.project_id, projectId), eq(label.name_key, key), isNull(label.deleted_at)))
    .get();
  if (existing && existing.id !== exceptId) {
    throw conflict(`A label named "${existing.name}" already exists in this project`, { id: existing.id });
  }
  return key;
}

function listChildren(ctx: TesseraContext, parentId: string): LabelRow[] {
  return ctx.db
    .select()
    .from(label)
    .where(and(eq(label.parent_id, parentId), isNull(label.deleted_at)))
    .orderBy(asc(label.sort_order))
    .all();
}

/** A parent must be a top-level label of the same project. */
function resolveParent(ctx: TesseraContext, projectId: string, parentId: string): LabelRow {
  const parent = getLabel(ctx, parentId);
  if (parent.project_id !== projectId) throw rule("label_parent_project", "The parent label must belong to the same project");
  if (parent.parent_id !== null) throw rule("label_depth", `"${parent.name}" is itself a child label; labels nest one level deep`);
  return parent;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Non-deleted labels of a project in display order (flat; nest by parent_id); NOT_FOUND when the project does not exist. */
export function listLabels(ctx: TesseraContext, projectId: string): Label[] {
  loadProject(ctx, projectId);
  return ctx.db
    .select()
    .from(label)
    .where(and(eq(label.project_id, projectId), isNull(label.deleted_at)))
    .orderBy(asc(label.sort_order), asc(label.created_at))
    .all();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateLabelInput = z
  .object({
    project_id: IdSchema.describe("Project the label belongs to."),
    name: LABEL_NAME.describe("Label name, unique per project (case-insensitive)."),
    color: PaletteColorSchema.optional().describe("Palette colour; defaults to gray."),
    parent_id: IdSchema.optional().describe("Top-level label to nest under (one level deep)."),
  })
  .strict();

export type CreateLabelInputType = z.input<typeof CreateLabelInput>;

export function createLabel(ctx: TesseraContext, input: CreateLabelInputType): Label {
  const data = validateInput(CreateLabelInput, input);
  return withTx(ctx, () => {
    loadWritableProject(ctx, data.project_id);
    const key = assertNameFree(ctx, data.project_id, data.name, null);
    const parent = data.parent_id === undefined ? null : resolveParent(ctx, data.project_id, data.parent_id);
    const now = ctx.now();
    const row = ctx.db
      .insert(label)
      .values({
        id: newId(),
        project_id: data.project_id,
        parent_id: parent?.id ?? null,
        name: data.name,
        name_key: key,
        color: data.color ?? "gray",
        sort_order: sortOrderAfter(lastSortOrder(ctx.db, label, activeInProject(data.project_id))),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: row.project_id, entity_type: "label", entity_id: row.id, verb: "created", new_identifier: row.name });
    return row;
  });
}

export const UpdateLabelInput = z
  .object({
    name: LABEL_NAME.describe("New name, unique per project."),
    color: PaletteColorSchema.describe("New palette colour."),
    parent_id: IdSchema.nullable().describe("New parent (a top-level label of the same project) or null for top level."),
  })
  .partial()
  .strict();

export type UpdateLabelInputType = z.input<typeof UpdateLabelInput>;

const LABEL_UPDATE_FIELDS = ["name", "color", "parent_id"] as const;

export function updateLabel(ctx: TesseraContext, id: string, patch: UpdateLabelInputType): Label {
  const data = validateInput(UpdateLabelInput, patch);
  return withTx(ctx, () => {
    const before = getLabel(ctx, id);
    loadWritableProject(ctx, before.project_id);
    const name = data.name ?? before.name;
    const key = data.name === undefined ? before.name_key : assertNameFree(ctx, before.project_id, name, id);
    let parentName: string | null = null;
    let parentId = before.parent_id;
    if (data.parent_id !== undefined && data.parent_id !== before.parent_id) {
      if (data.parent_id === null) {
        parentId = null;
      } else {
        if (data.parent_id === id) throw rule("label_self_parent", "A label cannot be its own parent");
        if (listChildren(ctx, id).length > 0) {
          throw rule("label_has_children", `"${before.name}" has child labels and cannot be nested under another label`);
        }
        const parent = resolveParent(ctx, before.project_id, data.parent_id);
        parentId = parent.id;
        parentName = parent.name;
      }
    }
    const now = ctx.now();
    const after = ctx.db
      .update(label)
      .set({
        name,
        name_key: key,
        color: data.color ?? before.color,
        parent_id: parentId,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(label.id, id))
      .returning()
      .get();
    const oldParentName = before.parent_id === null ? null : labelNameOrNull(ctx, before.parent_id);
    diffFields(ctx, { project_id: before.project_id, entity_type: "label", entity_id: id }, before, after, LABEL_UPDATE_FIELDS, (field, value) => {
      if (field === "parent_id") return value === before.parent_id ? oldParentName : parentName;
      return field === "name" || field === "color" ? String(value) : null;
    });
    return after;
  });
}

function labelNameOrNull(ctx: TesseraContext, id: string): string | null {
  const row = ctx.db.select({ name: label.name }).from(label).where(eq(label.id, id)).get();
  return row?.name ?? null;
}

export const ReorderLabelInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the label that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the label that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderLabelInputType = z.input<typeof ReorderLabelInput>;

export function reorderLabel(ctx: TesseraContext, id: string, input: ReorderLabelInputType): Label {
  const data = validateInput(ReorderLabelInput, input);
  return withTx(ctx, () => {
    const before = getLabel(ctx, id);
    loadWritableProject(ctx, before.project_id);
    const ordered = listLabels(ctx, before.project_id);
    const sortOrder = sortOrderForMove(ordered, id, data.before_id, data.after_id, "label");
    const now = ctx.now();
    const after = ctx.db
      .update(label)
      .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(label.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: before.project_id, entity_type: "label", entity_id: id }, before, after, ["sort_order"], () => before.name);
    return after;
  });
}

/**
 * Soft-deletes a label and its children, removes the junction rows that
 * reference them and strips their ids from the filters of the project's
 * views, of workspace views and of remembered list settings.
 */
export function deleteLabel(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const target = getLabel(ctx, id);
    loadWritableProject(ctx, target.project_id);
    const doomed = [target, ...listChildren(ctx, id)];
    const ids = doomed.map((row) => row.id);
    ctx.db.delete(work_item_label).where(inArray(work_item_label.label_id, ids)).run();
    ctx.db.delete(page_label).where(inArray(page_label.label_id, ids)).run();
    const now = ctx.now();
    ctx.db.update(label).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(inArray(label.id, ids)).run();
    for (const row of doomed) {
      logActivity(ctx, { project_id: row.project_id, entity_type: "label", entity_id: row.id, verb: "deleted", old_identifier: row.name });
    }
    const removed = new Set(ids);
    stripIdsFromSavedFilters(ctx, { key: "labels", ids: removed, project_id: target.project_id });
  });
}
