/**
 * Workflow states (docs/contracts/service-api.md, schema.md "Projects and states").
 * Every project owns its states; names are unique per project (name_key),
 * exactly one state is the default, and `sort_order` is a fractional key.
 * The hidden `triage` state is created by `ensureTriageState` when Intake is
 * enabled and can neither be created nor made the default through the API.
 */
import { and, asc, count, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, notFound, rule, validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { nameKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { assertInTransaction, withTx } from "./core/tx";
import { project, state, work_item } from "./db/schema";
import { IdSchema, PaletteColorSchema, StateGroupSchema } from "./schemas";
import type { PaletteColor, ProjectRow, StateGroup, StateRow } from "./types";

export type State = StateRow;

export const TRIAGE_STATE_NAME = "Triage";

/** Seeded by createProject, in this order; Backlog is the default. */
export const DEFAULT_STATES: readonly { name: string; color: PaletteColor; state_group: StateGroup; is_default: boolean }[] = [
  { name: "Backlog", color: "gray", state_group: "backlog", is_default: true },
  { name: "Todo", color: "blue", state_group: "unstarted", is_default: false },
  { name: "In Progress", color: "yellow", state_group: "started", is_default: false },
  { name: "Done", color: "green", state_group: "completed", is_default: false },
  { name: "Cancelled", color: "red", state_group: "cancelled", is_default: false },
];

/** Groups a user may create states in; `triage` is reserved for Intake. */
export const UserStateGroupSchema = StateGroupSchema.exclude(["triage"]);

const STATE_NAME = z.string().trim().min(1).max(120);
const STATE_DESCRIPTION = z.string().trim().max(2000);

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function activeInProject(projectId: string): SQL {
  return sql`${state.project_id} = ${projectId} AND ${state.deleted_at} IS NULL`;
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

/** Non-deleted state by id; NOT_FOUND otherwise. */
export function getState(ctx: TesseraContext, id: string): State {
  const row = ctx.db
    .select()
    .from(state)
    .where(and(eq(state.id, id), isNull(state.deleted_at)))
    .get();
  if (!row) throw notFound("state", id);
  return row;
}

function findStateByNameKey(ctx: TesseraContext, projectId: string, key: string): StateRow | undefined {
  return ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.name_key, key), isNull(state.deleted_at)))
    .get();
}

function findDefaultState(ctx: TesseraContext, projectId: string): StateRow | undefined {
  return ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.is_default, true), isNull(state.deleted_at)))
    .get();
}

function findTriageState(ctx: TesseraContext, projectId: string): StateRow | undefined {
  return ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.state_group, "triage"), isNull(state.deleted_at)))
    .get();
}

function assertNameFree(ctx: TesseraContext, projectId: string, name: string, exceptId: string | null): string {
  const key = nameKey(name);
  const existing = findStateByNameKey(ctx, projectId, key);
  if (existing && existing.id !== exceptId) {
    throw conflict(`A state named "${existing.name}" already exists in this project`, { id: existing.id });
  }
  return key;
}

function countStatesInGroup(ctx: TesseraContext, projectId: string, group: StateGroup): number {
  const row = ctx.db
    .select({ n: count() })
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.state_group, group), isNull(state.deleted_at)))
    .get();
  return row?.n ?? 0;
}

/** Clears the current default so a new one can be set without tripping the partial unique index. */
function clearDefault(ctx: TesseraContext, projectId: string, exceptId: string | null): StateRow | undefined {
  const current = findDefaultState(ctx, projectId);
  if (!current || current.id === exceptId) return undefined;
  const now = ctx.now();
  ctx.db.update(state).set({ is_default: false, updated_at: now, updated_by: ctx.actor.id }).where(eq(state.id, current.id)).run();
  logActivity(ctx, {
    project_id: projectId,
    entity_type: "state",
    entity_id: current.id,
    verb: "updated",
    field: "is_default",
    old_value: "true",
    new_value: "false",
    old_identifier: current.name,
    new_identifier: current.name,
  });
  return current;
}

type InsertStateData = {
  project_id: string;
  name: string;
  state_group: StateGroup;
  color: PaletteColor;
  description: string;
  is_default: boolean;
};

/** Inserts one state at the end of the project's order and logs `created`; inside withTx only. */
function insertState(ctx: TesseraContext, data: InsertStateData): StateRow {
  assertInTransaction(ctx, "insertState");
  const key = assertNameFree(ctx, data.project_id, data.name, null);
  if (data.is_default) clearDefault(ctx, data.project_id, null);
  const now = ctx.now();
  const row = ctx.db
    .insert(state)
    .values({
      id: newId(),
      project_id: data.project_id,
      name: data.name,
      name_key: key,
      description: data.description,
      color: data.color,
      state_group: data.state_group,
      is_default: data.is_default,
      sort_order: sortOrderAfter(lastSortOrder(ctx.db, state, activeInProject(data.project_id))),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get();
  logActivity(ctx, { project_id: row.project_id, entity_type: "state", entity_id: row.id, verb: "created", new_identifier: row.name });
  return row;
}

/** Seeds the five default states of a new project (called by createProject inside its transaction). */
export function seedProjectStates(ctx: TesseraContext, projectId: string): StateRow[] {
  assertInTransaction(ctx, "seedProjectStates");
  return DEFAULT_STATES.map((seed) =>
    insertState(ctx, {
      project_id: projectId,
      name: seed.name,
      state_group: seed.state_group,
      color: seed.color,
      description: "",
      is_default: seed.is_default,
    }),
  );
}

/** Creates the hidden triage state once; later calls return the existing one. */
export function ensureTriageState(ctx: TesseraContext, projectId: string): StateRow {
  assertInTransaction(ctx, "ensureTriageState");
  const existing = findTriageState(ctx, projectId);
  if (existing) return existing;
  return insertState(ctx, {
    project_id: projectId,
    name: TRIAGE_STATE_NAME,
    state_group: "triage",
    color: "gray",
    description: "Hidden state for intake items awaiting triage.",
    is_default: false,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Non-deleted states of a project in display order; NOT_FOUND when the project does not exist. */
export function listStates(ctx: TesseraContext, projectId: string): State[] {
  loadProject(ctx, projectId);
  return ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), isNull(state.deleted_at)))
    .orderBy(asc(state.sort_order), asc(state.created_at))
    .all();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateStateInput = z
  .object({
    project_id: IdSchema.describe("Project the state belongs to."),
    name: STATE_NAME.describe("State name, unique per project (case-insensitive)."),
    state_group: UserStateGroupSchema.describe("backlog, unstarted, started, completed or cancelled."),
    color: PaletteColorSchema.optional().describe("Palette colour; defaults to gray."),
    description: STATE_DESCRIPTION.optional().describe("Short description shown in settings."),
    is_default: z.boolean().optional().describe("Make this the project's default state (swaps the current default)."),
  })
  .strict();

export type CreateStateInputType = z.input<typeof CreateStateInput>;

export function createState(ctx: TesseraContext, input: CreateStateInputType): State {
  const data = validateInput(CreateStateInput, input);
  return withTx(ctx, () => {
    loadWritableProject(ctx, data.project_id);
    return insertState(ctx, {
      project_id: data.project_id,
      name: data.name,
      state_group: data.state_group,
      color: data.color ?? "gray",
      description: data.description ?? "",
      is_default: data.is_default ?? false,
    });
  });
}

export const UpdateStateInput = z
  .object({
    name: STATE_NAME.describe("New name, unique per project."),
    description: STATE_DESCRIPTION.describe("New description."),
    color: PaletteColorSchema.describe("New palette colour."),
  })
  .partial()
  .strict();

export type UpdateStateInputType = z.input<typeof UpdateStateInput>;

const STATE_UPDATE_FIELDS = ["name", "description", "color"] as const;

export function updateState(ctx: TesseraContext, id: string, patch: UpdateStateInputType): State {
  const data = validateInput(UpdateStateInput, patch);
  return withTx(ctx, () => {
    const before = getState(ctx, id);
    loadWritableProject(ctx, before.project_id);
    const name = data.name ?? before.name;
    const key = data.name === undefined ? before.name_key : assertNameFree(ctx, before.project_id, name, id);
    const now = ctx.now();
    const after = ctx.db
      .update(state)
      .set({
        name,
        name_key: key,
        description: data.description ?? before.description,
        color: data.color ?? before.color,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(state.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: before.project_id, entity_type: "state", entity_id: id }, before, after, STATE_UPDATE_FIELDS, (field, value) =>
      field === "name" || field === "color" ? String(value) : null,
    );
    return after;
  });
}

export const ReorderStateInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the state that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the state that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderStateInputType = z.input<typeof ReorderStateInput>;

export function reorderState(ctx: TesseraContext, id: string, input: ReorderStateInputType): State {
  const data = validateInput(ReorderStateInput, input);
  return withTx(ctx, () => {
    const before = getState(ctx, id);
    loadWritableProject(ctx, before.project_id);
    const ordered = listStates(ctx, before.project_id);
    const sortOrder = sortOrderForMove(ordered, id, data.before_id, data.after_id, "state");
    const now = ctx.now();
    const after = ctx.db
      .update(state)
      .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(state.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: before.project_id, entity_type: "state", entity_id: id }, before, after, ["sort_order"], () => before.name);
    return after;
  });
}

/** Makes `id` the project's default state and clears the previous one in the same transaction. */
export function setDefaultState(ctx: TesseraContext, id: string): State {
  return withTx(ctx, () => {
    const target = getState(ctx, id);
    loadWritableProject(ctx, target.project_id);
    if (target.state_group === "triage") throw rule("triage_default", "The triage state cannot be the default state");
    if (target.is_default) return target;
    clearDefault(ctx, target.project_id, id);
    const now = ctx.now();
    const after = ctx.db
      .update(state)
      .set({ is_default: true, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(state.id, id))
      .returning()
      .get();
    logActivity(ctx, {
      project_id: target.project_id,
      entity_type: "state",
      entity_id: id,
      verb: "updated",
      field: "is_default",
      old_value: "false",
      new_value: "true",
      old_identifier: target.name,
      new_identifier: target.name,
    });
    return after;
  });
}

export const DeleteStateInput = z
  .object({
    move_to_state_id: IdSchema.optional().describe("State (same project) that receives the work items currently in the deleted state."),
  })
  .strict();

export type DeleteStateInputType = z.input<typeof DeleteStateInput>;

type MovableItem = { id: string; name: string; sequence_id: number };

function listItemsInState(ctx: TesseraContext, stateId: string): MovableItem[] {
  return ctx.db
    .select({ id: work_item.id, name: work_item.name, sequence_id: work_item.sequence_id })
    .from(work_item)
    .where(and(eq(work_item.state_id, stateId), isNull(work_item.deleted_at)))
    .orderBy(asc(work_item.sequence_id))
    .all();
}

/** Moves every item of `from` into `to`, keeps `completed_at` in step with the group and logs one row per item. */
function moveItemsBetweenStates(ctx: TesseraContext, projectRow: ProjectRow, items: MovableItem[], from: StateRow, to: StateRow): void {
  const now = ctx.now();
  const completedPatch =
    to.state_group === "completed" && from.state_group !== "completed"
      ? { completed_at: now }
      : from.state_group === "completed" && to.state_group !== "completed"
        ? { completed_at: null }
        : {};
  ctx.db
    .update(work_item)
    .set({ state_id: to.id, ...completedPatch, updated_at: now, updated_by: ctx.actor.id })
    .where(and(eq(work_item.state_id, from.id), isNull(work_item.deleted_at)))
    .run();
  for (const item of items) {
    logActivity(ctx, {
      project_id: projectRow.id,
      entity_type: "work_item",
      entity_id: item.id,
      work_item_id: item.id,
      verb: "updated",
      field: "state_id",
      old_value: from.id,
      new_value: to.id,
      old_identifier: from.name,
      new_identifier: to.name,
      comment: `Moved because state "${from.name}" was deleted`,
    });
  }
}

/**
 * Soft-deletes a state. Refused for the default state, the triage state, the
 * last state of its group and a non-empty state without a move target.
 */
export function deleteState(ctx: TesseraContext, id: string, options: DeleteStateInputType = {}): void {
  const data = validateInput(DeleteStateInput, options);
  withTx(ctx, () => {
    const target = getState(ctx, id);
    const projectRow = loadWritableProject(ctx, target.project_id);
    if (target.is_default) throw rule("default_state", "The default state cannot be deleted; choose another default first");
    if (target.state_group === "triage") throw rule("triage_state", "The triage state cannot be deleted; disable Intake instead");
    if (countStatesInGroup(ctx, target.project_id, target.state_group) <= 1) {
      throw rule("last_state_in_group", `"${target.name}" is the last ${target.state_group} state of this project`);
    }
    const items = listItemsInState(ctx, id);
    if (items.length > 0) {
      if (data.move_to_state_id === undefined) {
        throw rule("state_not_empty", `"${target.name}" still holds ${items.length} work item(s); pass move_to_state_id`);
      }
      const destination = getState(ctx, data.move_to_state_id);
      if (destination.id === target.id) throw rule("move_target_self", "move_to_state_id must be a different state");
      if (destination.project_id !== target.project_id) throw rule("move_target_project", "move_to_state_id must belong to the same project");
      // Items moved into triage without an intake row would vanish from every list, Intake included.
      if (destination.state_group === "triage") throw rule("triage_state", "Work items cannot be moved into the triage state; pick a visible state");
      moveItemsBetweenStates(ctx, projectRow, items, target, destination);
    }
    const now = ctx.now();
    ctx.db.update(state).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(state.id, id)).run();
    logActivity(ctx, { project_id: target.project_id, entity_type: "state", entity_id: id, verb: "deleted", old_identifier: target.name });
  });
}
