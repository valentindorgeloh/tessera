/**
 * Projects (docs/contracts/service-api.md, schema.md "Projects and states").
 * The identifier (`WEB`) is normalised and validated here and is unique among
 * non-deleted projects; `createProject` seeds the default states; feature
 * toggles live in `updateProjectFeatures` because enabling Intake creates the
 * hidden triage state and the default intake. Archived projects are read-only
 * except unarchive and delete, and a delete soft-deletes everything the
 * project owns in one transaction.
 */
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getActor } from "./actors";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, notFound, rule, validateInput, validation } from "./core/errors";
import { isId, newId } from "./core/ids";
import { nameKey, normalizeIdentifier } from "./core/keys";
import { lastSortOrder, sortOrderAfter } from "./core/order";
import { assertInTransaction, withTx } from "./core/tx";
import {
  activity,
  cycle,
  draft_work_item,
  estimate,
  estimate_point,
  intake,
  intake_item,
  label,
  moduleTable,
  project,
  state,
  view,
  work_item,
  work_item_assignee,
  work_item_label,
  work_item_module,
  work_item_subscriber,
} from "./db/schema";
import { IdSchema, LogoSchema, ProjectIdentifierSchema, StateGroupSchema } from "./schemas";
import { ensureTriageState, seedProjectStates } from "./states";
import type { EstimateType, ProjectRow, StateGroup } from "./types";

export type ProjectCounts = {
  /** Non-deleted, non-archived work items of the project outside the hidden triage state: the population getCounts and listWorkItems show. */
  total: number;
  /** `triage` is always 0; pending intake items are not accepted work yet. */
  by_state_group: Record<StateGroup, number>;
};

export type Project = ProjectRow & { counts: ProjectCounts; estimate_type: EstimateType | null };

export const DEFAULT_INTAKE_NAME = "Intake";

const PROJECT_NAME = z.string().trim().min(1).max(120);
const PROJECT_DESCRIPTION = z.string().max(100_000);
/** Raw identifier as typed; the service upper-cases it and checks the pattern. */
const PROJECT_IDENTIFIER = z.string().trim().min(1).max(20);
const MONTHS = z.number().int().min(1).max(12);

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Non-deleted project row by id; NOT_FOUND otherwise. */
export function getProjectRow(ctx: TesseraContext, id: string): ProjectRow {
  const row = ctx.db
    .select()
    .from(project)
    .where(and(eq(project.id, id), isNull(project.deleted_at)))
    .get();
  if (!row) throw notFound("project", id);
  return row;
}

/** Archived projects are read-only except unarchive and delete. */
function loadWritableProject(ctx: TesseraContext, id: string): ProjectRow {
  const row = getProjectRow(ctx, id);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  return row;
}

export type ProjectFeature = "cycles" | "modules" | "views";

const FEATURE_LABEL: Record<ProjectFeature, string> = { cycles: "Cycles", modules: "Modules", views: "Views" };

/** RULE feature_disabled while the project has the feature turned off: creates only, reads and data stay (decision 31). */
export function assertFeatureEnabled(
  project: Pick<ProjectRow, "cycles_enabled" | "modules_enabled" | "views_enabled">,
  feature: ProjectFeature,
): void {
  const enabled = feature === "cycles" ? project.cycles_enabled : feature === "modules" ? project.modules_enabled : project.views_enabled;
  if (!enabled) throw rule("feature_disabled", `${FEATURE_LABEL[feature]} are turned off for this project`);
}

function findByIdentifier(ctx: TesseraContext, identifier: string): ProjectRow | undefined {
  return ctx.db
    .select()
    .from(project)
    .where(and(eq(project.identifier, identifier), isNull(project.deleted_at)))
    .get();
}

/**
 * Project that held `identifier` before a rename (decision 29), found through
 * the newest `identifier` activity row whose old value is it. `undefined` when
 * a non-deleted project (archived or not) holds the identifier now: the live
 * holder always wins. No alias table. `diffFields` stores strings as-is, so
 * `old_value` equals the identifier.
 */
export function resolveRetiredIdentifier(ctx: TesseraContext, identifier: string): ProjectRow | undefined {
  const normalized = normalizeIdentifier(identifier);
  if (findByIdentifier(ctx, normalized)) return undefined;
  const rows = ctx.db
    .select({ project_id: activity.entity_id })
    .from(activity)
    .where(and(eq(activity.entity_type, "project"), eq(activity.field, "identifier"), eq(activity.old_value, normalized)))
    .orderBy(desc(activity.seq))
    .all();
  for (const row of rows) {
    const holder = ctx.db
      .select()
      .from(project)
      .where(and(eq(project.id, row.project_id), isNull(project.deleted_at)))
      .get();
    if (holder && holder.identifier !== normalized) return holder;
  }
  return undefined;
}

function findByNameKey(ctx: TesseraContext, key: string): ProjectRow | undefined {
  return ctx.db
    .select()
    .from(project)
    .where(and(eq(project.name_key, key), isNull(project.deleted_at)))
    .get();
}

/** Upper-cases the identifier and checks the `^[A-Z][A-Z0-9]{1,11}$` pattern (VALIDATION). */
function checkIdentifier(raw: string): string {
  const identifier = normalizeIdentifier(raw);
  const result = ProjectIdentifierSchema.safeParse(identifier);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ ...issue, path: ["identifier"] }));
    throw validation(issues, `Invalid input: identifier: ${issues.map((issue) => issue.message).join("; ")}`);
  }
  return identifier;
}

function assertIdentifierFree(ctx: TesseraContext, identifier: string, exceptId: string | null): void {
  const existing = findByIdentifier(ctx, identifier);
  if (existing && existing.id !== exceptId) {
    throw conflict(`Identifier ${identifier} is already used by project "${existing.name}"`, { id: existing.id });
  }
}

function assertNameFree(ctx: TesseraContext, name: string, exceptId: string | null): string {
  const key = nameKey(name);
  const existing = findByNameKey(ctx, key);
  if (existing && existing.id !== exceptId) {
    throw conflict(`A project named "${existing.name}" already exists`, { id: existing.id });
  }
  return key;
}

function assertStateInProject(ctx: TesseraContext, projectId: string, stateId: string): string {
  const row = ctx.db
    .select({ name: state.name, state_group: state.state_group })
    .from(state)
    .where(and(eq(state.id, stateId), eq(state.project_id, projectId), isNull(state.deleted_at)))
    .get();
  if (!row) throw notFound("state", stateId);
  if (row.state_group !== "completed" && row.state_group !== "cancelled") {
    throw rule("close_state_group", `Close state "${row.name}" is ${row.state_group}; pick a completed or cancelled state`);
  }
  return row.name;
}

// ---------------------------------------------------------------------------
// Counts (one grouped query for any number of projects, over the same
// population as counts.ts so sidebar badges and headers agree)
// ---------------------------------------------------------------------------

function emptyCounts(): ProjectCounts {
  const by_state_group = Object.fromEntries(StateGroupSchema.options.map((group) => [group, 0])) as Record<StateGroup, number>;
  return { total: 0, by_state_group };
}

function loadCounts(ctx: TesseraContext, projectIds: string[]): Map<string, ProjectCounts> {
  const result = new Map(projectIds.map((id) => [id, emptyCounts()]));
  if (projectIds.length === 0) return result;
  const rows = ctx.db
    .select({ project_id: work_item.project_id, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(inArray(work_item.project_id, projectIds), isNull(work_item.deleted_at), isNull(work_item.archived_at), ne(state.state_group, "triage")))
    .groupBy(work_item.project_id, state.state_group)
    .all();
  for (const row of rows) {
    const counts = result.get(row.project_id);
    if (!counts) continue;
    counts.total += row.n;
    counts.by_state_group[row.state_group] += row.n;
  }
  return result;
}

function toProjects(ctx: TesseraContext, rows: ProjectRow[]): Project[] {
  const counts = loadCounts(
    ctx,
    rows.map((row) => row.id),
  );
  const types = estimateTypes(ctx, rows);
  return rows.map((row) => ({
    ...row,
    counts: counts.get(row.id) ?? emptyCounts(),
    estimate_type: row.estimates_enabled && row.estimate_id !== null ? (types.get(row.estimate_id) ?? null) : null,
  }));
}

function estimateTypes(ctx: TesseraContext, rows: ProjectRow[]): Map<string, EstimateType> {
  const ids = rows.map((row) => row.estimate_id).filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const found = ctx.db
    .select({ id: estimate.id, type: estimate.type })
    .from(estimate)
    .where(and(inArray(estimate.id, ids), isNull(estimate.deleted_at), isNull(estimate.archived_at)))
    .all();
  return new Map(found.map((row) => [row.id, row.type]));
}

function toProject(ctx: TesseraContext, row: ProjectRow): Project {
  return toProjects(ctx, [row])[0];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const ListProjectsInput = z
  .object({
    archived: z.boolean().optional().describe("true lists archived projects only; default lists active ones."),
  })
  .strict();

export type ListProjectsInputType = z.input<typeof ListProjectsInput>;

export function listProjects(ctx: TesseraContext, input: ListProjectsInputType = {}): Project[] {
  const data = validateInput(ListProjectsInput, input);
  const archivedFilter = data.archived === true ? isNotNull(project.archived_at) : isNull(project.archived_at);
  const rows = ctx.db
    .select()
    .from(project)
    .where(and(isNull(project.deleted_at), archivedFilter))
    .orderBy(asc(project.sort_order), asc(project.name_key))
    .all();
  return toProjects(ctx, rows);
}

/** By id or by identifier (any case); archived projects are returned, deleted ones are NOT_FOUND. */
export function getProject(ctx: TesseraContext, idOrIdentifier: string): Project {
  const raw = idOrIdentifier.trim();
  const row = isId(raw) ? getProjectRow(ctx, raw) : (findByIdentifier(ctx, normalizeIdentifier(raw)) ?? resolveRetiredIdentifier(ctx, raw));
  if (!row) throw notFound("project", raw);
  return toProject(ctx, row);
}

// ---------------------------------------------------------------------------
// Create and update
// ---------------------------------------------------------------------------

export const ProjectFeaturesInput = z
  .object({
    cycles_enabled: z.boolean().describe("Show cycles in this project."),
    modules_enabled: z.boolean().describe("Show modules in this project."),
    views_enabled: z.boolean().describe("Show saved views in this project."),
    pages_enabled: z.boolean().describe("Show pages in this project."),
    intake_enabled: z.boolean().describe("Enable Intake; creates the hidden triage state. Cannot be disabled while intake items are pending."),
    estimates_enabled: z.boolean().describe("Enable estimates in this project."),
    agent_intake_required: z.boolean().describe("Work items created by agents land in Intake instead of the board."),
  })
  .partial()
  .strict();

export type ProjectFeaturesInputType = z.input<typeof ProjectFeaturesInput>;

const FEATURE_FIELDS = [
  "cycles_enabled",
  "modules_enabled",
  "views_enabled",
  "pages_enabled",
  "intake_enabled",
  "estimates_enabled",
  "agent_intake_required",
] as const;

export const CreateProjectInput = z
  .object({
    name: PROJECT_NAME.describe("Project name, unique across the workspace (case-insensitive)."),
    identifier: PROJECT_IDENTIFIER.describe("Key prefix such as WEB: 2 to 12 letters or digits, starting with a letter; upper-cased."),
    description_md: PROJECT_DESCRIPTION.optional().describe("Markdown description."),
    logo: LogoSchema.optional().describe("Icon and palette colour."),
    features: ProjectFeaturesInput.optional().describe("Feature toggles; cycles, modules, views and pages default on."),
  })
  .strict();

export type CreateProjectInputType = z.input<typeof CreateProjectInput>;

/** Creates the triage state and the default intake once; safe to call again. */
function enableIntake(ctx: TesseraContext, projectId: string): void {
  assertInTransaction(ctx, "enableIntake");
  ensureTriageState(ctx, projectId);
  const existing = ctx.db
    .select({ id: intake.id })
    .from(intake)
    .where(and(eq(intake.project_id, projectId), eq(intake.is_default, true), isNull(intake.deleted_at)))
    .get();
  if (existing) return;
  const now = ctx.now();
  const row = ctx.db
    .insert(intake)
    .values({
      id: newId(),
      project_id: projectId,
      name: DEFAULT_INTAKE_NAME,
      is_default: true,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get();
  logActivity(ctx, { project_id: projectId, entity_type: "intake", entity_id: row.id, verb: "created", new_identifier: row.name });
}

/** Intake items still waiting for a decision (pending or snoozed). */
function countOpenIntakeItems(ctx: TesseraContext, projectId: string): number {
  const row = ctx.db
    .select({ n: count() })
    .from(intake_item)
    .innerJoin(intake, eq(intake_item.intake_id, intake.id))
    .where(and(eq(intake.project_id, projectId), isNull(intake_item.deleted_at), inArray(intake_item.status, ["pending", "snoozed"])))
    .get();
  return row?.n ?? 0;
}

export function createProject(ctx: TesseraContext, input: CreateProjectInputType): Project {
  const data = validateInput(CreateProjectInput, input);
  const identifier = checkIdentifier(data.identifier);
  return withTx(ctx, () => {
    assertIdentifierFree(ctx, identifier, null);
    const key = assertNameFree(ctx, data.name, null);
    const features = data.features ?? {};
    const now = ctx.now();
    const row = ctx.db
      .insert(project)
      .values({
        id: newId(),
        name: data.name,
        name_key: key,
        identifier,
        description_md: data.description_md ?? "",
        logo: data.logo ?? null,
        cycles_enabled: features.cycles_enabled ?? true,
        modules_enabled: features.modules_enabled ?? true,
        views_enabled: features.views_enabled ?? true,
        pages_enabled: features.pages_enabled ?? true,
        intake_enabled: features.intake_enabled ?? false,
        estimates_enabled: features.estimates_enabled ?? false,
        agent_intake_required: features.agent_intake_required ?? false,
        sort_order: sortOrderAfter(lastSortOrder(ctx.db, project, isNull(project.deleted_at))),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: row.id, entity_type: "project", entity_id: row.id, verb: "created", new_identifier: row.identifier });
    seedProjectStates(ctx, row.id);
    if (row.intake_enabled) enableIntake(ctx, row.id);
    return toProject(ctx, row);
  });
}

export const UpdateProjectInput = z
  .object({
    name: PROJECT_NAME.describe("New name, unique across the workspace."),
    identifier: PROJECT_IDENTIFIER.describe("New key prefix; existing keys change with it."),
    description_md: PROJECT_DESCRIPTION.describe("New Markdown description."),
    logo: LogoSchema.nullable().describe("Icon and colour, or null to clear."),
    default_assignee_id: IdSchema.nullable().describe("Actor new work items are assigned to, or null."),
    archive_in_months: MONTHS.nullable().describe("Auto-archive closed items after this many months, or null to disable."),
    close_in_months: MONTHS.nullable().describe("Auto-close inactive items after this many months, or null to disable."),
    close_state_id: IdSchema.nullable().describe("State auto-closed items move to (must belong to the project), or null."),
  })
  .partial()
  .strict();

export type UpdateProjectInputType = z.input<typeof UpdateProjectInput>;

const PROJECT_UPDATE_FIELDS = [
  "name",
  "identifier",
  "description_md",
  "logo",
  "default_assignee_id",
  "archive_in_months",
  "close_in_months",
  "close_state_id",
] as const;

/** Field-scoped update; the identifier may be renamed (keys are computed at read time). */
export function updateProject(ctx: TesseraContext, id: string, patch: UpdateProjectInputType): Project {
  const data = validateInput(UpdateProjectInput, patch);
  return withTx(ctx, () => {
    const before = loadWritableProject(ctx, id);
    const identifier = data.identifier === undefined ? before.identifier : checkIdentifier(data.identifier);
    if (identifier !== before.identifier) assertIdentifierFree(ctx, identifier, id);
    const name = data.name ?? before.name;
    const key = data.name === undefined ? before.name_key : assertNameFree(ctx, name, id);
    const names = new Map<string, string>();
    const assigneeId = data.default_assignee_id === undefined ? before.default_assignee_id : data.default_assignee_id;
    if (assigneeId !== null) names.set(assigneeId, getActor(ctx, assigneeId).name);
    if (before.default_assignee_id !== null && !names.has(before.default_assignee_id)) {
      names.set(before.default_assignee_id, actorNameOrId(ctx, before.default_assignee_id));
    }
    const closeStateId = data.close_state_id === undefined ? before.close_state_id : data.close_state_id;
    if (closeStateId !== null) names.set(closeStateId, assertStateInProject(ctx, id, closeStateId));
    if (before.close_state_id !== null && !names.has(before.close_state_id)) {
      names.set(before.close_state_id, stateNameOrId(ctx, before.close_state_id));
    }
    const now = ctx.now();
    const after = ctx.db
      .update(project)
      .set({
        name,
        name_key: key,
        identifier,
        description_md: data.description_md ?? before.description_md,
        logo: data.logo === undefined ? before.logo : data.logo,
        default_assignee_id: assigneeId,
        archive_in_months: data.archive_in_months === undefined ? before.archive_in_months : data.archive_in_months,
        close_in_months: data.close_in_months === undefined ? before.close_in_months : data.close_in_months,
        close_state_id: closeStateId,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(project.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: id, entity_type: "project", entity_id: id }, before, after, PROJECT_UPDATE_FIELDS, (field, value) => {
      if (field === "name" || field === "identifier") return typeof value === "string" ? value : null;
      if (field === "default_assignee_id" || field === "close_state_id") return typeof value === "string" ? (names.get(value) ?? value) : null;
      return null;
    });
    return toProject(ctx, after);
  });
}

function actorNameOrId(ctx: TesseraContext, actorId: string): string {
  try {
    return getActor(ctx, actorId).name;
  } catch {
    return actorId;
  }
}

function stateNameOrId(ctx: TesseraContext, stateId: string): string {
  const row = ctx.db.select({ name: state.name }).from(state).where(eq(state.id, stateId)).get();
  return row?.name ?? stateId;
}

export const UpdateProjectFeaturesInput = ProjectFeaturesInput;

export function updateProjectFeatures(ctx: TesseraContext, id: string, patch: ProjectFeaturesInputType): Project {
  const data = validateInput(UpdateProjectFeaturesInput, patch);
  return withTx(ctx, () => {
    const before = loadWritableProject(ctx, id);
    const changes: Partial<Record<(typeof FEATURE_FIELDS)[number], boolean>> = {};
    for (const field of FEATURE_FIELDS) {
      const value = data[field];
      if (value !== undefined && value !== before[field]) changes[field] = value;
    }
    const intakeOn = (changes.intake_enabled ?? before.intake_enabled) === true;
    if (changes.agent_intake_required === true && !intakeOn) {
      throw rule("intake_disabled", "Turn Intake on before requiring it for agents");
    }
    if (changes.intake_enabled === false) {
      const open = countOpenIntakeItems(ctx, id);
      if (open > 0) throw rule("intake_pending", `Intake cannot be disabled while ${open} intake item(s) are pending`);
      if (before.agent_intake_required) changes.agent_intake_required = false;
    }
    let after = before;
    if (Object.keys(changes).length > 0) {
      const now = ctx.now();
      after = ctx.db
        .update(project)
        .set({ ...changes, updated_at: now, updated_by: ctx.actor.id })
        .where(eq(project.id, id))
        .returning()
        .get();
      diffFields(ctx, { project_id: id, entity_type: "project", entity_id: id }, before, after, FEATURE_FIELDS);
    }
    if (data.intake_enabled === true) enableIntake(ctx, id);
    return toProject(ctx, after);
  });
}

// ---------------------------------------------------------------------------
// Archive, restore, delete
// ---------------------------------------------------------------------------

export function archiveProject(ctx: TesseraContext, id: string): Project {
  return withTx(ctx, () => {
    const before = loadWritableProject(ctx, id);
    const now = ctx.now();
    const after = ctx.db
      .update(project)
      .set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(project.id, id))
      .returning()
      .get();
    logActivity(ctx, { project_id: id, entity_type: "project", entity_id: id, verb: "archived", old_identifier: before.identifier });
    return toProject(ctx, after);
  });
}

export function unarchiveProject(ctx: TesseraContext, id: string): Project {
  return withTx(ctx, () => {
    const before = getProjectRow(ctx, id);
    if (before.archived_at === null) throw rule("not_archived", `project ${before.identifier} is not archived`);
    const now = ctx.now();
    const after = ctx.db
      .update(project)
      .set({ archived_at: null, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(project.id, id))
      .returning()
      .get();
    logActivity(ctx, { project_id: id, entity_type: "project", entity_id: id, verb: "restored", new_identifier: before.identifier });
    return toProject(ctx, after);
  });
}

/**
 * Soft-deletes the project together with its states, labels, work items (plus
 * their junction and FTS rows), cycles, modules, views and intakes in one
 * transaction. Works on archived projects too.
 */
export function deleteProject(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const before = getProjectRow(ctx, id);
    const now = ctx.now();
    const stamp = { deleted_at: now, updated_at: now, updated_by: ctx.actor.id };
    const liveItems = ctx.db
      .select({ id: work_item.id })
      .from(work_item)
      .where(and(eq(work_item.project_id, id), isNull(work_item.deleted_at)));
    ctx.db.delete(work_item_label).where(inArray(work_item_label.work_item_id, liveItems)).run();
    ctx.db.delete(work_item_module).where(inArray(work_item_module.work_item_id, liveItems)).run();
    ctx.db.delete(work_item_assignee).where(inArray(work_item_assignee.work_item_id, liveItems)).run();
    ctx.db.delete(work_item_subscriber).where(inArray(work_item_subscriber.work_item_id, liveItems)).run();
    ctx.sqlite
      .prepare("DELETE FROM work_item_fts WHERE work_item_id IN (SELECT id FROM work_item WHERE project_id = ? AND deleted_at IS NULL)")
      .run(id);
    const liveIntakes = ctx.db
      .select({ id: intake.id })
      .from(intake)
      .where(and(eq(intake.project_id, id), isNull(intake.deleted_at)));
    ctx.db.update(intake_item).set(stamp).where(and(inArray(intake_item.intake_id, liveIntakes), isNull(intake_item.deleted_at))).run();
    ctx.db.update(intake).set(stamp).where(and(eq(intake.project_id, id), isNull(intake.deleted_at))).run();
    ctx.db
      .update(draft_work_item)
      .set({
        project_id: null,
        state_id: null,
        parent_id: null,
        cycle_id: null,
        label_ids: [],
        module_ids: [],
        assignee_ids: [],
        estimate_point_id: null,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(and(eq(draft_work_item.project_id, id), isNull(draft_work_item.deleted_at)))
      .run();
    const liveEstimates = ctx.db.select({ id: estimate.id }).from(estimate).where(and(eq(estimate.project_id, id), isNull(estimate.deleted_at)));
    ctx.db.update(estimate_point).set(stamp).where(and(inArray(estimate_point.estimate_id, liveEstimates), isNull(estimate_point.deleted_at))).run();
    ctx.db.update(estimate).set(stamp).where(and(eq(estimate.project_id, id), isNull(estimate.deleted_at))).run();
    ctx.db.update(work_item).set(stamp).where(and(eq(work_item.project_id, id), isNull(work_item.deleted_at))).run();
    ctx.db.update(state).set(stamp).where(and(eq(state.project_id, id), isNull(state.deleted_at))).run();
    ctx.db.update(label).set(stamp).where(and(eq(label.project_id, id), isNull(label.deleted_at))).run();
    ctx.db.update(cycle).set(stamp).where(and(eq(cycle.project_id, id), isNull(cycle.deleted_at))).run();
    ctx.db.update(moduleTable).set(stamp).where(and(eq(moduleTable.project_id, id), isNull(moduleTable.deleted_at))).run();
    ctx.db.update(view).set(stamp).where(and(eq(view.project_id, id), isNull(view.deleted_at))).run();
    ctx.db.update(project).set(stamp).where(eq(project.id, id)).run();
    logActivity(ctx, { project_id: id, entity_type: "project", entity_id: id, verb: "deleted", old_identifier: before.identifier });
  });
}
