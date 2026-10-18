import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { rule, validateInput } from "../core/errors";
import { withTx } from "../core/tx";
import { upsertWorkItemFts } from "../db/fts";
import { intake_item, label, state, work_item, work_item_label, work_item_module } from "../db/schema";
import { getProjectRow } from "../projects";
import { IdSchema } from "../schemas";
import { ensureTriageState } from "../states";
import type { StateRow } from "../types";
import {
  ENTITY,
  type LoadedWorkItem,
  type WorkItem,
  assertCycleOpen,
  cycleRowIfLive,
  defaultState,
  getWorkItemRow,
  itemKey,
  loadWritableProject,
  loadWritableWorkItem,
  nextCompletedAt,
  resolveState,
} from "./model";
import { loadWorkItem } from "./hydrate";
import { currentLabelIds } from "./membership";
import { intakeRequired, intakeSourceFor, recordIntakeItem } from "../intake-policy";
import { allocateSequence, insertWorkItem, nextSortOrder } from "./create";

// ---------------------------------------------------------------------------
// Copy and move between projects
// ---------------------------------------------------------------------------

export const CopyWorkItemInput = z
  .object({
    project_id: IdSchema.optional().describe("Target project; the item's own project when omitted."),
  })
  .strict();

export type CopyWorkItemInputType = z.input<typeof CopyWorkItemInput>;

/** Labels of `source` that exist (by name_key) in `targetProjectId`; unmapped ones are dropped. */
function mapLabelsByName(ctx: TesseraContext, sourceLabelIds: string[], targetProjectId: string): string[] {
  if (sourceLabelIds.length === 0) return [];
  const sourceKeys = ctx.db
    .select({ name_key: label.name_key })
    .from(label)
    .where(inArray(label.id, sourceLabelIds))
    .all()
    .map((row) => row.name_key);
  if (sourceKeys.length === 0) return [];
  return ctx.db
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.project_id, targetProjectId), inArray(label.name_key, sourceKeys), isNull(label.deleted_at)))
    .all()
    .map((row) => row.id);
}

/** The target project's state with the same name, else its default; triage never maps. */
function mapStateByName(ctx: TesseraContext, sourceState: StateRow, targetProjectId: string): StateRow {
  if (sourceState.state_group !== "triage") {
    const match = ctx.db
      .select()
      .from(state)
      .where(and(eq(state.project_id, targetProjectId), eq(state.name_key, sourceState.name_key), isNull(state.deleted_at)))
      .get();
    if (match && match.state_group !== "triage") return match;
  }
  return defaultState(ctx, targetProjectId);
}

/**
 * Copies clear cycle, modules, estimate and assignees, append " (Copy)" to
 * the name, keep labels (mapped by name across projects), parent (same
 * project only) and description, and never copy children. A copy made by an
 * agent in a project that requires agent intake lands in Intake like a create;
 * an item still waiting in Intake cannot be copied (RULE intake_pending).
 */
export function copyWorkItem(ctx: TesseraContext, id: string, input: CopyWorkItemInputType = {}): WorkItem {
  const data = validateInput(CopyWorkItemInput, input);
  return withTx(ctx, () => {
    const source = getWorkItemRow(ctx, id);
    const sourceProject = getProjectRow(ctx, source.project_id);
    if (hasOpenIntakeItem(ctx, id)) throw rule("intake_pending", "Accept or decline the intake item before copying it");
    const targetProject = data.project_id === undefined || data.project_id === source.project_id ? loadWritableProject(ctx, source.project_id) : loadWritableProject(ctx, data.project_id);
    const sameProject = targetProject.id === source.project_id;
    const viaIntake = intakeRequired(ctx, targetProject);
    const sourceState = resolveState(ctx, source.project_id, source.state_id);
    const stateRow = viaIntake
      ? ensureTriageState(ctx, targetProject.id)
      : sameProject && sourceState.state_group !== "triage"
        ? sourceState
        : mapStateByName(ctx, sourceState, targetProject.id);
    const sourceLabels = currentLabelIds(ctx, id);
    const row = insertWorkItem(ctx, targetProject, {
      name: `${source.name} (Copy)`,
      description_md: source.description_md,
      state: stateRow,
      priority: source.priority,
      parent_id: sameProject ? source.parent_id : null,
      cycle_id: null,
      estimate_point_id: null,
      start_date: source.start_date,
      target_date: source.target_date,
      label_ids: sameProject ? sourceLabels : mapLabelsByName(ctx, sourceLabels, targetProject.id),
      module_ids: [],
      assignee_ids: [],
    });
    logActivity(ctx, {
      project_id: targetProject.id,
      entity_type: ENTITY,
      entity_id: row.id,
      work_item_id: row.id,
      verb: "copied",
      old_value: source.id,
      new_value: row.id,
      old_identifier: itemKey(sourceProject, source),
      new_identifier: itemKey(targetProject, row),
    });
    if (viaIntake) recordIntakeItem(ctx, targetProject, row, intakeSourceFor(ctx));
    return loadWorkItem(ctx, row.id);
  });
}

export const MoveWorkItemToProjectInput = z
  .object({
    project_id: IdSchema.describe("Project the item moves to."),
  })
  .strict();

export type MoveWorkItemToProjectInputType = z.input<typeof MoveWorkItemToProjectInput>;

export function hasOpenIntakeItem(ctx: TesseraContext, itemId: string): boolean {
  const row = ctx.db
    .select({ id: intake_item.id })
    .from(intake_item)
    .where(and(eq(intake_item.work_item_id, itemId), isNull(intake_item.deleted_at), inArray(intake_item.status, ["pending", "snoozed"])))
    .get();
  return row !== undefined;
}

/** Children cannot follow their parent to another project, so they become top-level items of the old project. */
function detachChildren(ctx: TesseraContext, loaded: LoadedWorkItem): void {
  const children = ctx.db
    .select()
    .from(work_item)
    .where(and(eq(work_item.parent_id, loaded.item.id), isNull(work_item.deleted_at)))
    .all();
  if (children.length === 0) return;
  const now = ctx.now();
  ctx.db
    .update(work_item)
    .set({ parent_id: null, updated_at: now, updated_by: ctx.actor.id })
    .where(inArray(work_item.id, children.map((child) => child.id)))
    .run();
  for (const child of children) {
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: ENTITY,
      entity_id: child.id,
      work_item_id: child.id,
      verb: "updated",
      field: "parent_id",
      old_value: loaded.item.id,
      new_value: null,
      old_identifier: itemKey(loaded.project, loaded.item),
      new_identifier: null,
      comment: `Detached because ${itemKey(loaded.project, loaded.item)} moved to another project`,
    });
  }
}

/**
 * Moves the item (same id) to another project: new sequence, old key kept in
 * activity, labels mapped by name_key (unmapped dropped), state mapped by
 * name (else the target default), cycle, modules, estimate and parent cleared,
 * children detached, assignees and subscribers kept. An agent moving an item
 * into a project that requires agent intake lands it in that project's Intake.
 * Clearing the cycle is a membership change, so an item sitting in a
 * completed (LOCKED) or archived (ARCHIVED) cycle must be transferred first.
 */
export function moveWorkItemToProject(ctx: TesseraContext, id: string, input: MoveWorkItemToProjectInputType): WorkItem {
  const data = validateInput(MoveWorkItemToProjectInput, input);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    const { item, project: sourceProject } = loaded;
    if (data.project_id === sourceProject.id) throw rule("same_project", "The work item is already in that project");
    const targetProject = loadWritableProject(ctx, data.project_id);
    if (hasOpenIntakeItem(ctx, id)) throw rule("intake_pending", "Accept or decline the intake item before moving it");
    const leavingCycle = item.cycle_id === null ? null : cycleRowIfLive(ctx, item.cycle_id);
    if (leavingCycle) assertCycleOpen(ctx, leavingCycle);
    const viaIntake = intakeRequired(ctx, targetProject);
    const sourceState = resolveState(ctx, sourceProject.id, item.state_id);
    const targetState = viaIntake ? ensureTriageState(ctx, targetProject.id) : mapStateByName(ctx, sourceState, targetProject.id);
    const oldKey = itemKey(sourceProject, item);
    detachChildren(ctx, loaded);
    const mappedLabels = mapLabelsByName(ctx, currentLabelIds(ctx, id), targetProject.id);
    ctx.db.delete(work_item_label).where(eq(work_item_label.work_item_id, id)).run();
    if (mappedLabels.length > 0) {
      ctx.db
        .insert(work_item_label)
        .values(mappedLabels.map((label_id) => ({ work_item_id: id, label_id })))
        .run();
    }
    ctx.db.delete(work_item_module).where(eq(work_item_module.work_item_id, id)).run();
    const now = ctx.now();
    const after = ctx.db
      .update(work_item)
      .set({
        project_id: targetProject.id,
        sequence_id: allocateSequence(ctx, targetProject.id),
        state_id: targetState.id,
        completed_at: nextCompletedAt(ctx, sourceState, targetState, item.completed_at),
        parent_id: null,
        cycle_id: null,
        estimate_point_id: null,
        sort_order: nextSortOrder(ctx, targetProject.id),
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(work_item.id, id))
      .returning()
      .get();
    upsertWorkItemFts(ctx.sqlite, { id, project_id: targetProject.id, name: after.name, body: after.description_md });
    logActivity(ctx, {
      project_id: targetProject.id,
      entity_type: ENTITY,
      entity_id: id,
      work_item_id: id,
      verb: "moved",
      field: "project_id",
      old_value: sourceProject.id,
      new_value: targetProject.id,
      old_identifier: oldKey,
      new_identifier: itemKey(targetProject, after),
    });
    if (viaIntake) recordIntakeItem(ctx, targetProject, after, intakeSourceFor(ctx));
    return loadWorkItem(ctx, id);
  });
}
