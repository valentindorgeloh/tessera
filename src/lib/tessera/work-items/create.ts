import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { lastSortOrder, sortOrderAfter } from "../core/order";
import { assertInTransaction, withTx } from "../core/tx";
import { upsertWorkItemFts } from "../db/fts";
import { work_item, work_item_assignee, work_item_label, work_item_module } from "../db/schema";
import { intakeRequired, intakeSourceFor, recordIntakeItem } from "../intake-policy";
import { IdListSchema, IdSchema, IntakeSourceSchema, IsoDateSchema, PrioritySchema } from "../schemas";
import { ensureTriageState } from "../states";
import type { ProjectRow, StateRow, WorkItemRow } from "../types";
import {
  DESCRIPTION,
  ENTITY,
  MAX_IDS,
  WORK_ITEM_NAME,
  type WorkItem,
  assertCycleAllowed,
  assertCycleOpen,
  assertModulesNotArchived,
  assertNotTriage,
  checkDates,
  defaultState,
  itemKey,
  loadWritableProject,
  resolveActors,
  resolveCycle,
  resolveEstimatePoint,
  resolveLabels,
  resolveModules,
  resolveParent,
  resolveState,
} from "./model";
import { loadWorkItem } from "./hydrate";
import { addSubscribers } from "./membership";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateWorkItemInput = z
  .object({
    project_id: IdSchema.describe("Project the item belongs to."),
    name: WORK_ITEM_NAME.describe("Title."),
    description_md: DESCRIPTION.optional().describe("Markdown body."),
    state_id: IdSchema.optional().describe("State in the project; the project default when omitted."),
    priority: PrioritySchema.optional().describe("urgent, high, medium, low or none (default)."),
    parent_id: IdSchema.optional().describe("Parent work item in the same project."),
    cycle_id: IdSchema.optional().describe("Cycle in the same project."),
    label_ids: IdListSchema.max(MAX_IDS).optional().describe("Labels of the project."),
    module_ids: IdListSchema.max(MAX_IDS).optional().describe("Modules of the project."),
    assignee_ids: IdListSchema.max(MAX_IDS).optional().describe("Actors to assign; the project default assignee when omitted or empty."),
    estimate_point_id: IdSchema.optional().describe("Estimate point of the project's estimate system."),
    start_date: IsoDateSchema.optional().describe("YYYY-MM-DD."),
    target_date: IsoDateSchema.optional().describe("YYYY-MM-DD, not before start_date."),
    source: IntakeSourceSchema.optional().describe("Where an intake item came from (in_app, assistant, mcp); defaults to mcp for agents."),
  })
  .strict();

export type CreateWorkItemInputType = z.input<typeof CreateWorkItemInput>;

/** `UPDATE project SET next_sequence = next_sequence + 1 ... RETURNING`: numbers are never reused. */
export function allocateSequence(ctx: TesseraContext, projectId: string): number {
  assertInTransaction(ctx, "allocateSequence");
  const row = ctx.sqlite
    .prepare<[string], { next_sequence: number }>("UPDATE project SET next_sequence = next_sequence + 1 WHERE id = ? RETURNING next_sequence")
    .get(projectId);
  if (!row) throw notFound("project", projectId);
  return row.next_sequence - 1;
}

export function nextSortOrder(ctx: TesseraContext, projectId: string): string {
  return sortOrderAfter(lastSortOrder(ctx.db, work_item, and(eq(work_item.project_id, projectId), isNull(work_item.deleted_at))));
}

type NewItem = {
  name: string;
  description_md: string;
  state: StateRow;
  priority: WorkItemRow["priority"];
  parent_id: string | null;
  cycle_id: string | null;
  estimate_point_id: string | null;
  start_date: string | null;
  target_date: string | null;
  label_ids: string[];
  module_ids: string[];
  assignee_ids: string[];
};

/** Inserts a fully validated item: sequence, sort key, junction rows, subscribers, FTS row and the `created` activity row. */
export function insertWorkItem(ctx: TesseraContext, projectRow: ProjectRow, data: NewItem): WorkItemRow {
  assertInTransaction(ctx, "insertWorkItem");
  const now = ctx.now();
  const row = ctx.db
    .insert(work_item)
    .values({
      id: newId(),
      project_id: projectRow.id,
      sequence_id: allocateSequence(ctx, projectRow.id),
      name: data.name,
      description_md: data.description_md,
      state_id: data.state.id,
      priority: data.priority,
      parent_id: data.parent_id,
      cycle_id: data.cycle_id,
      estimate_point_id: data.estimate_point_id,
      start_date: data.start_date,
      target_date: data.target_date,
      completed_at: data.state.state_group === "completed" ? now : null,
      sort_order: nextSortOrder(ctx, projectRow.id),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get();
  if (data.label_ids.length > 0) {
    ctx.db
      .insert(work_item_label)
      .values(data.label_ids.map((label_id) => ({ work_item_id: row.id, label_id })))
      .run();
  }
  if (data.module_ids.length > 0) {
    ctx.db
      .insert(work_item_module)
      .values(data.module_ids.map((module_id) => ({ work_item_id: row.id, module_id })))
      .run();
  }
  if (data.assignee_ids.length > 0) {
    ctx.db
      .insert(work_item_assignee)
      .values(data.assignee_ids.map((actor_id) => ({ work_item_id: row.id, actor_id })))
      .run();
  }
  // The creator follows the item; assignees are auto-subscribed (schema.md "setAssignees").
  addSubscribers(ctx, row.id, [ctx.actor.id, ...data.assignee_ids]);
  upsertWorkItemFts(ctx.sqlite, { id: row.id, project_id: row.project_id, name: row.name, body: row.description_md });
  logActivity(ctx, { project_id: row.project_id, entity_type: ENTITY, entity_id: row.id, work_item_id: row.id, verb: "created", new_identifier: itemKey(projectRow, row) });
  return row;
}

export function createWorkItem(ctx: TesseraContext, input: CreateWorkItemInputType): WorkItem {
  const data = validateInput(CreateWorkItemInput, input);
  return withTx(ctx, () => {
    const projectRow = loadWritableProject(ctx, data.project_id);
    const viaIntake = intakeRequired(ctx, projectRow);
    let stateRow: StateRow;
    if (viaIntake) {
      stateRow = ensureTriageState(ctx, projectRow.id);
    } else if (data.state_id !== undefined) {
      stateRow = resolveState(ctx, projectRow.id, data.state_id);
      assertNotTriage(stateRow);
    } else {
      stateRow = defaultState(ctx, projectRow.id);
    }
    const start = data.start_date ?? null;
    const target = data.target_date ?? null;
    checkDates(start, target);
    const parent = data.parent_id === undefined ? null : resolveParent(ctx, projectRow.id, data.parent_id, null);
    const cycleRow = data.cycle_id === undefined ? null : resolveCycle(ctx, projectRow.id, data.cycle_id);
    if (cycleRow) {
      assertCycleOpen(ctx, cycleRow);
      assertCycleAllowed(stateRow, cycleRow);
    }
    const labelIds = [...new Set(data.label_ids ?? [])];
    resolveLabels(ctx, projectRow.id, labelIds);
    const moduleIds = [...new Set(data.module_ids ?? [])];
    resolveModules(ctx, projectRow.id, moduleIds);
    assertModulesNotArchived(ctx, moduleIds);
    if (data.estimate_point_id !== undefined) resolveEstimatePoint(ctx, projectRow.id, data.estimate_point_id);
    let assigneeIds = [...new Set(data.assignee_ids ?? [])];
    if (assigneeIds.length === 0 && projectRow.default_assignee_id !== null) assigneeIds = [projectRow.default_assignee_id];
    resolveActors(ctx, assigneeIds);
    const row = insertWorkItem(ctx, projectRow, {
      name: data.name,
      description_md: data.description_md ?? "",
      state: stateRow,
      priority: data.priority ?? "none",
      parent_id: parent?.id ?? null,
      cycle_id: cycleRow?.id ?? null,
      estimate_point_id: data.estimate_point_id ?? null,
      start_date: start,
      target_date: target,
      label_ids: labelIds,
      module_ids: moduleIds,
      assignee_ids: assigneeIds,
    });
    if (viaIntake) recordIntakeItem(ctx, projectRow, row, data.source ?? intakeSourceFor(ctx));
    return loadWorkItem(ctx, row.id);
  });
}
