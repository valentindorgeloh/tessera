/**
 * Workspace drafts. They never appear in search, lists, counts or the board.
 * Project-scoped fields need a project and are checked with the create rules.
 * Moving a draft creates a work item and soft-deletes the draft together.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { latestSeq, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { isTrackerError, notFound, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { withTx } from "./core/tx";
import { draft_work_item, project } from "./db/schema";
import { IdListSchema, IdSchema, IsoDateSchema, PrioritySchema } from "./schemas";
import type { DraftWorkItemRow, Priority } from "./types";
import { createWorkItem } from "./work-items/create";
import type { WorkItem } from "./work-items/model";
import {
  DESCRIPTION,
  MAX_IDS,
  assertCycleOpen,
  assertModulesNotArchived,
  assertNotTriage,
  checkDates,
  resolveActors,
  resolveCycle,
  resolveEstimatePoint,
  resolveLabels,
  resolveModules,
  resolveParent,
  resolveState,
} from "./work-items/model";
import { loadWritableProject } from "./work-items/model";

export type DraftView = DraftWorkItemRow & { project: { id: string; name: string; identifier: string } | null };

export const DraftFieldsInput = z
  .object({
    project_id: IdSchema.nullable().describe("Project, or null for a workspace draft."),
    name: z.string().trim().max(255).describe("Title. May be empty until the draft becomes a work item."),
    description_md: DESCRIPTION.describe("Markdown body."),
    state_id: IdSchema.nullable().describe("State in the draft's project, or null. Not the triage state."),
    priority: PrioritySchema.describe("urgent, high, medium, low or none."),
    parent_id: IdSchema.nullable().describe("Parent work item in the draft's project, or null."),
    cycle_id: IdSchema.nullable().describe("Open cycle in the draft's project, or null."),
    label_ids: IdListSchema.max(MAX_IDS).describe("Labels of the draft's project."),
    module_ids: IdListSchema.max(MAX_IDS).describe("Unarchived modules of the draft's project."),
    assignee_ids: IdListSchema.max(MAX_IDS).describe("Actors to assign when the draft becomes a work item."),
    estimate_point_id: IdSchema.nullable().describe("Point of the project's active estimate, or null."),
    start_date: IsoDateSchema.nullable().describe("YYYY-MM-DD, or null."),
    target_date: IsoDateSchema.nullable().describe("YYYY-MM-DD, not before start_date, or null."),
  })
  .partial()
  .strict();

export type DraftFieldsInputType = z.input<typeof DraftFieldsInput>;

const ListInput = z
  .object({
    project_id: IdSchema.optional().describe("Only drafts for this project."),
    limit: z.number().int().min(1).max(500).default(200).describe("How many drafts to return, newest first."),
  })
  .strict();

export function listDrafts(ctx: TesseraContext, input: z.input<typeof ListInput> = {}): { items: DraftView[]; total: number; cursor: number } {
  const data = validateInput(ListInput, input);
  const filters = [isNull(draft_work_item.deleted_at)];
  if (data.project_id !== undefined) filters.push(eq(draft_work_item.project_id, data.project_id));
  const rows = ctx.db
    .select()
    .from(draft_work_item)
    .where(and(...filters))
    .orderBy(desc(draft_work_item.updated_at), desc(draft_work_item.id))
    .limit(data.limit)
    .all();
  return { items: withProjects(ctx, rows), total: rows.length, cursor: latestSeq(ctx) };
}

export function getDraft(ctx: TesseraContext, id: string): DraftView {
  const row = liveRow(ctx, id);
  return withProjects(ctx, [row])[0];
}

export function countDrafts(ctx: TesseraContext): number {
  return ctx.db.select({ id: draft_work_item.id }).from(draft_work_item).where(isNull(draft_work_item.deleted_at)).all().length;
}

export function createDraft(ctx: TesseraContext, input: DraftFieldsInputType = {}): DraftView {
  const data = validateInput(DraftFieldsInput, input);
  return withTx(ctx, () => {
    const fields = resolveFields(ctx, null, data, true);
    const now = ctx.now();
    const row = ctx.db
      .insert(draft_work_item)
      .values({ id: newId(), ...fields, created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id })
      .returning()
      .get();
    logActivity(ctx, { project_id: row.project_id, entity_type: "draft", entity_id: row.id, verb: "created", new_identifier: row.name || "Untitled draft" });
    return withProjects(ctx, [row])[0];
  });
}

export function updateDraft(ctx: TesseraContext, id: string, patch: DraftFieldsInputType): DraftView {
  const data = validateInput(DraftFieldsInput, patch);
  return withTx(ctx, () => {
    const before = liveRow(ctx, id);
    const projectChanged = data.project_id !== undefined && data.project_id !== before.project_id;
    const base = projectChanged ? cleared(before) : before;
    const fields = resolveFields(ctx, base, data, projectChanged);
    const now = ctx.now();
    const after = ctx.db
      .update(draft_work_item)
      .set({ ...fields, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(draft_work_item.id, id))
      .returning()
      .get();
    logActivity(ctx, { project_id: after.project_id, entity_type: "draft", entity_id: id, verb: "updated", new_identifier: after.name || "Untitled draft" });
    return withProjects(ctx, [after])[0];
  });
}

export function deleteDraft(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const before = liveRow(ctx, id);
    const now = ctx.now();
    ctx.db.update(draft_work_item).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(draft_work_item.id, id)).run();
    logActivity(ctx, { project_id: before.project_id, entity_type: "draft", entity_id: id, verb: "deleted", old_identifier: before.name || "Untitled draft" });
  });
}

const MoveInput = z
  .object({
    project_id: IdSchema.optional().describe("Project to create the work item in, when the draft has none."),
  })
  .strict();

/** Creates the work item, drops stale project fields, and soft-deletes the draft in one transaction. */
export function moveDraftToProject(ctx: TesseraContext, id: string, input: z.input<typeof MoveInput> = {}): { work_item: WorkItem; dropped: string[] } {
  const data = validateInput(MoveInput, input);
  return withTx(ctx, () => {
    const draft = liveRow(ctx, id);
    const projectId = data.project_id ?? draft.project_id;
    if (projectId === null) throw validation({ project_id: "required" }, "Choose a project before creating the work item");
    if (draft.name.trim() === "") throw validation({ name: "required" }, "A draft needs a name before it becomes a work item");
    const dropped: string[] = [];
    const kept = keep(ctx, projectId, draft, dropped);
    const workItem = createWorkItem(ctx, {
      project_id: projectId,
      name: draft.name.trim(),
      description_md: draft.description_md,
      priority: draft.priority,
      ...kept,
    });
    const now = ctx.now();
    ctx.db.update(draft_work_item).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(draft_work_item.id, id)).run();
    logActivity(ctx, {
      project_id: projectId,
      entity_type: "draft",
      entity_id: id,
      work_item_id: workItem.id,
      verb: "moved",
      new_identifier: workItem.key,
    });
    return { work_item: workItem, dropped };
  });
}

type Fields = {
  project_id: string | null;
  name: string;
  description_md: string;
  state_id: string | null;
  priority: Priority;
  parent_id: string | null;
  cycle_id: string | null;
  label_ids: string[];
  module_ids: string[];
  assignee_ids: string[];
  estimate_point_id: string | null;
  start_date: string | null;
  target_date: string | null;
};

function cleared(row: DraftWorkItemRow): DraftWorkItemRow {
  return { ...row, state_id: null, parent_id: null, cycle_id: null, label_ids: [], module_ids: [], assignee_ids: [], estimate_point_id: null };
}

function resolveFields(ctx: TesseraContext, before: DraftWorkItemRow | null, patch: DraftFieldsInputType, projectChanged: boolean): Fields {
  const projectId = patch.project_id !== undefined ? patch.project_id : (before?.project_id ?? null);
  const name = patch.name !== undefined ? patch.name : (before?.name ?? "");
  const description_md = patch.description_md !== undefined ? patch.description_md : (before?.description_md ?? "");
  const priority = patch.priority !== undefined ? patch.priority : (before?.priority ?? "none");
  const start_date = patch.start_date !== undefined ? patch.start_date : (before?.start_date ?? null);
  const target_date = patch.target_date !== undefined ? patch.target_date : (before?.target_date ?? null);
  checkDates(start_date, target_date);
  const pick = <T>(key: keyof DraftFieldsInputType, fallback: T): T => {
    if (patch[key] !== undefined) return patch[key] as T;
    return fallback;
  };
  const state_id = pick("state_id", projectChanged ? null : (before?.state_id ?? null));
  const parent_id = pick("parent_id", projectChanged ? null : (before?.parent_id ?? null));
  const cycle_id = pick("cycle_id", projectChanged ? null : (before?.cycle_id ?? null));
  const label_ids = pick("label_ids", projectChanged ? [] : (before?.label_ids ?? []));
  const module_ids = pick("module_ids", projectChanged ? [] : (before?.module_ids ?? []));
  const assignee_ids = pick("assignee_ids", projectChanged ? [] : (before?.assignee_ids ?? []));
  const estimate_point_id = pick("estimate_point_id", projectChanged ? null : (before?.estimate_point_id ?? null));
  const scoped = [state_id, parent_id, cycle_id, estimate_point_id].some((value) => value !== null) || label_ids.length + module_ids.length + assignee_ids.length > 0;
  if (projectId === null) {
    if (scoped) throw validation({ project_id: "required" }, "Choose a project before setting project fields");
    return { project_id: projectId, name, description_md, state_id, priority, parent_id, cycle_id, label_ids, module_ids, assignee_ids, estimate_point_id, start_date, target_date };
  }
  loadWritableProject(ctx, projectId);
  if (state_id !== null) assertNotTriage(resolveState(ctx, projectId, state_id));
  if (parent_id !== null) resolveParent(ctx, projectId, parent_id, null);
  if (cycle_id !== null) assertCycleOpen(ctx, resolveCycle(ctx, projectId, cycle_id));
  resolveLabels(ctx, projectId, label_ids);
  resolveModules(ctx, projectId, module_ids);
  assertModulesNotArchived(ctx, module_ids);
  resolveActors(ctx, assignee_ids);
  if (estimate_point_id !== null) resolveEstimatePoint(ctx, projectId, estimate_point_id);
  return { project_id: projectId, name, description_md, state_id, priority, parent_id, cycle_id, label_ids, module_ids, assignee_ids, estimate_point_id, start_date, target_date };
}

function keep(ctx: TesseraContext, projectId: string, draft: DraftWorkItemRow, dropped: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.project_id !== null && draft.project_id !== projectId) {
    for (const id of [draft.state_id, draft.parent_id, draft.cycle_id, draft.estimate_point_id, ...draft.label_ids, ...draft.module_ids]) {
      if (id !== null) dropped.push(id);
    }
  }
  const tryField = (field: string, id: string | null, apply: () => void) => {
    if (id === null) return;
    try {
      apply();
      out[field] = id;
    } catch (err) {
      if (!isTrackerError(err)) throw err;
      dropped.push(id);
    }
  };
  tryField("state_id", draft.project_id === projectId ? draft.state_id : null, () => {
    if (draft.state_id) assertNotTriage(resolveState(ctx, projectId, draft.state_id));
  });
  tryField("parent_id", draft.project_id === projectId ? draft.parent_id : null, () => {
    if (draft.parent_id) resolveParent(ctx, projectId, draft.parent_id, null);
  });
  tryField("cycle_id", draft.project_id === projectId ? draft.cycle_id : null, () => {
    if (draft.cycle_id) assertCycleOpen(ctx, resolveCycle(ctx, projectId, draft.cycle_id));
  });
  tryField("estimate_point_id", draft.project_id === projectId ? draft.estimate_point_id : null, () => {
    if (draft.estimate_point_id) resolveEstimatePoint(ctx, projectId, draft.estimate_point_id);
  });
  const labels = draft.project_id === projectId ? draft.label_ids : [];
  const keptLabels: string[] = [];
  for (const id of labels) {
    try {
      resolveLabels(ctx, projectId, [id]);
      keptLabels.push(id);
    } catch (err) {
      if (!isTrackerError(err)) throw err;
      dropped.push(id);
    }
  }
  if (keptLabels.length > 0) out.label_ids = keptLabels;
  const modules = draft.project_id === projectId ? draft.module_ids : [];
  const keptModules: string[] = [];
  for (const id of modules) {
    try {
      resolveModules(ctx, projectId, [id]);
      assertModulesNotArchived(ctx, [id]);
      keptModules.push(id);
    } catch (err) {
      if (!isTrackerError(err)) throw err;
      dropped.push(id);
    }
  }
  if (keptModules.length > 0) out.module_ids = keptModules;
  if (draft.assignee_ids.length > 0) {
    resolveActors(ctx, draft.assignee_ids);
    out.assignee_ids = draft.assignee_ids;
  }
  if (draft.start_date) out.start_date = draft.start_date;
  if (draft.target_date) out.target_date = draft.target_date;
  return out;
}

function liveRow(ctx: TesseraContext, id: string): DraftWorkItemRow {
  const row = ctx.db.select().from(draft_work_item).where(and(eq(draft_work_item.id, id), isNull(draft_work_item.deleted_at))).get();
  if (!row) throw notFound("draft", id);
  return row;
}

function withProjects(ctx: TesseraContext, rows: DraftWorkItemRow[]): DraftView[] {
  const ids = [...new Set(rows.map((row) => row.project_id).filter((id): id is string => id !== null))];
  const projects = new Map<string, { id: string; name: string; identifier: string }>();
  if (ids.length > 0) {
    for (const row of ctx.db.select({ id: project.id, name: project.name, identifier: project.identifier }).from(project).where(and(isNull(project.deleted_at))).all()) {
      if (ids.includes(row.id)) projects.set(row.id, row);
    }
  }
  return rows.map((row) => ({ ...row, project: row.project_id === null ? null : (projects.get(row.project_id) ?? null) }));
}
