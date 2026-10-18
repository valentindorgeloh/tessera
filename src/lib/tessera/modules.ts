/**
 * Modules (docs/contracts/service-api.md "modules.ts", schema.md "Modules").
 * Names are unique per project (name_key), `status` defaults to planned,
 * `start_date <= target_date` when both are set, and a module can only be
 * archived while its status is completed or cancelled. Archived modules are
 * read-only except unarchive and delete; archived projects refuse every
 * module mutation. Membership (`work_item_module`, many modules per item)
 * logs activity on the module and on each item; `setModuleMembers` replaces
 * the member list; links go through links.ts.
 *
 * Progress counts non-deleted, non-archived work items in the module, the
 * same population as project counts; items in the hidden triage state are
 * left out because they are not accepted work yet.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getActor } from "./actors";
import { diffFields, logActivity, type ActivityTarget } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, notFound, rule, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey, nameKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { isIsoDate } from "./core/time";
import { withTx } from "./core/tx";
import { activeEstimateId, loadBreakdowns, parsePointValue } from "./cycles";
import { actor, estimate_point, moduleTable, module_member, project, state, work_item, work_item_module } from "./db/schema";
import { countLinks, listLinks, type Link } from "./links";
import { assertFeatureEnabled } from "./projects";
import { stripIdsFromSavedFilters } from "./saved-filters";
import { IdListSchema, IdSchema, IsoDateSchema, ModuleStatusSchema } from "./schemas";
import type { ActorRow, ModuleRow, ModuleStatus, PointsCounts, ProgressBreakdownRow, ProgressCounts, ProjectRow, StateGroup } from "./types";

/** Progress of a module: counts by state group, per state, label and assignee, and in estimate points when the project has an active estimate. */
export type ModuleProgress = ProgressCounts & {
  /** Item count per state id. */
  by_state: Record<string, number>;
  /** Item count per label id. */
  by_label: Record<string, number>;
  /** Item count per assignee actor id. */
  by_assignee: Record<string, number>;
  /** Items and completed items per assignee, sorted by total then id, the `id: null` row (no assignee) last. */
  assignees: ProgressBreakdownRow[];
  /** Items and completed items per label, sorted by total then id, the `id: null` row (no labels) last. */
  labels: ProgressBreakdownRow[];
  /** Same counts in estimate points (numeric `estimate_point.value` >= 0); only when the project has an active estimate. */
  points?: PointsCounts;
};

export type Module = ModuleRow & {
  member_ids: string[];
  links_count: number;
  progress: ProgressCounts;
};

export type ModuleDetail = Omit<Module, "progress"> & {
  progress: ModuleProgress;
  links: Link[];
  /** Non-deleted, non-archived work items in the module (the population `progress` counts). */
  work_item_ids: string[];
};

/** A module may be archived only while its status is one of these. */
export const ARCHIVABLE_MODULE_STATUSES: readonly ModuleStatus[] = ["completed", "cancelled"];

const MODULE_NAME = z.string().trim().min(1).max(120);
const MODULE_DESCRIPTION = z.string().max(100_000);
/** `YYYY-MM-DD` that names a real calendar day. */
const MODULE_DATE = IsoDateSchema.refine(isIsoDate, { message: "expected a real calendar date" });

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function activeInProject(projectId: string): SQL {
  return sql`${moduleTable.project_id} = ${projectId} AND ${moduleTable.deleted_at} IS NULL`;
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

/** Non-deleted module by id; NOT_FOUND otherwise. */
export function getModuleRow(ctx: TesseraContext, id: string): ModuleRow {
  const row = ctx.db
    .select()
    .from(moduleTable)
    .where(and(eq(moduleTable.id, id), isNull(moduleTable.deleted_at)))
    .get();
  if (!row) throw notFound("module", id);
  return row;
}

type WritableModule = { row: ModuleRow; projectRow: ProjectRow };

/** Module and project that both accept writes: neither is archived. */
function loadWritableModule(ctx: TesseraContext, id: string): WritableModule {
  const row = getModuleRow(ctx, id);
  const projectRow = loadWritableProject(ctx, row.project_id);
  if (row.archived_at !== null) throw archived(`module "${row.name}" is archived`);
  return { row, projectRow };
}

function assertNameFree(ctx: TesseraContext, projectId: string, name: string, exceptId: string | null): string {
  const key = nameKey(name);
  const existing = ctx.db
    .select()
    .from(moduleTable)
    .where(and(eq(moduleTable.project_id, projectId), eq(moduleTable.name_key, key), isNull(moduleTable.deleted_at)))
    .get();
  if (existing && existing.id !== exceptId) {
    throw conflict(`A module named "${existing.name}" already exists in this project`, { id: existing.id });
  }
  return key;
}

function checkDateOrder(startDate: string | null, targetDate: string | null): void {
  if (startDate !== null && targetDate !== null && startDate > targetDate) {
    const message = "target_date must be on or after start_date";
    throw validation([{ code: "custom", path: ["target_date"], message }], `Invalid input: target_date: ${message}`);
  }
}

function moduleTarget(row: Pick<ModuleRow, "id" | "project_id">): ActivityTarget {
  return { project_id: row.project_id, entity_type: "module", entity_id: row.id };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function actorNameOrId(ctx: TesseraContext, actorId: string): string {
  const row = ctx.db.select({ name: actor.name }).from(actor).where(eq(actor.id, actorId)).get();
  return row?.name ?? actorId;
}

// ---------------------------------------------------------------------------
// Progress, members and view models
// ---------------------------------------------------------------------------

function emptyProgressCounts(): ProgressCounts {
  return { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
}

/** Adds `n` to the group's bucket and to the total; triage items are not counted. */
function addToCounts(counts: PointsCounts, group: StateGroup, n: number): void {
  if (group === "triage") return;
  counts.total += n;
  counts[group] += n;
}

function activeItemsInModules(moduleIds: readonly string[]): SQL | undefined {
  return and(inArray(work_item_module.module_id, moduleIds), isNull(work_item.deleted_at), isNull(work_item.archived_at));
}

/** One grouped query: counts by state group for any number of modules. */
function loadProgressSummaries(ctx: TesseraContext, moduleIds: string[]): Map<string, ProgressCounts> {
  const result = new Map(moduleIds.map((id) => [id, emptyProgressCounts()]));
  if (moduleIds.length === 0) return result;
  const rows = ctx.db
    .select({ module_id: work_item_module.module_id, state_group: state.state_group, n: count() })
    .from(work_item_module)
    .innerJoin(work_item, eq(work_item_module.work_item_id, work_item.id))
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(activeItemsInModules(moduleIds))
    .groupBy(work_item_module.module_id, state.state_group)
    .all();
  for (const row of rows) {
    const counts = result.get(row.module_id);
    if (counts) addToCounts(counts, row.state_group, row.n);
  }
  return result;
}

function loadMemberIds(ctx: TesseraContext, moduleIds: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>(moduleIds.map((id) => [id, []]));
  if (moduleIds.length === 0) return result;
  const rows = ctx.db
    .select({ module_id: module_member.module_id, actor_id: module_member.actor_id })
    .from(module_member)
    .where(inArray(module_member.module_id, moduleIds))
    .orderBy(asc(module_member.actor_id))
    .all();
  for (const row of rows) result.get(row.module_id)?.push(row.actor_id);
  return result;
}

function toModules(ctx: TesseraContext, rows: ModuleRow[]): Module[] {
  const ids = rows.map((row) => row.id);
  const progress = loadProgressSummaries(ctx, ids);
  const members = loadMemberIds(ctx, ids);
  const links = countLinks(ctx, "module", ids);
  return rows.map((row) => ({
    ...row,
    member_ids: members.get(row.id) ?? [],
    links_count: links.get(row.id) ?? 0,
    progress: progress.get(row.id) ?? emptyProgressCounts(),
  }));
}

function toModule(ctx: TesseraContext, row: ModuleRow): Module {
  return toModules(ctx, [row])[0];
}

function listActiveWorkItemIds(ctx: TesseraContext, moduleId: string): string[] {
  return ctx.db
    .select({ id: work_item.id })
    .from(work_item_module)
    .innerJoin(work_item, eq(work_item_module.work_item_id, work_item.id))
    .where(activeItemsInModules([moduleId]))
    .orderBy(asc(work_item.sort_order), asc(work_item.sequence_id))
    .all()
    .map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const ListModulesInput = z
  .object({
    archived: z.boolean().optional().describe("true lists archived modules only; default lists active ones."),
    status: ModuleStatusSchema.optional().describe("Only modules with this status."),
  })
  .strict();

export type ListModulesInputType = z.input<typeof ListModulesInput>;

/** Modules of a project in display order with member ids, link count and a progress summary; NOT_FOUND for an unknown project. */
export function listModules(ctx: TesseraContext, projectId: string, input: ListModulesInputType = {}): Module[] {
  const data = validateInput(ListModulesInput, input);
  loadProject(ctx, projectId);
  const conditions = [
    eq(moduleTable.project_id, projectId),
    isNull(moduleTable.deleted_at),
    data.archived === true ? isNotNull(moduleTable.archived_at) : isNull(moduleTable.archived_at),
  ];
  if (data.status !== undefined) conditions.push(eq(moduleTable.status, data.status));
  const rows = ctx.db
    .select()
    .from(moduleTable)
    .where(and(...conditions))
    .orderBy(asc(moduleTable.sort_order), asc(moduleTable.created_at))
    .all();
  return toModules(ctx, rows);
}

/** Archived modules are returned; deleted ones are NOT_FOUND. */
export function getModule(ctx: TesseraContext, id: string): ModuleDetail {
  const row = getModuleRow(ctx, id);
  return {
    ...toModule(ctx, row),
    progress: getModuleProgress(ctx, id),
    links: listLinks(ctx, { module_id: id }),
    work_item_ids: listActiveWorkItemIds(ctx, id),
  };
}

/**
 * Counts by state group, per state, label and assignee (with the breakdown
 * rows), over non-deleted, non-archived items outside triage; `points` sums
 * the numeric values >= 0 of non-deleted points of the project's active
 * estimate and is absent without one (the cycle rules, cycles.ts).
 */
export function getModuleProgress(ctx: TesseraContext, id: string): ModuleProgress {
  const row = getModuleRow(ctx, id);
  const estimateId = activeEstimateId(ctx, loadProject(ctx, row.project_id));
  const rows = ctx.db
    .select({
      id: work_item.id,
      state_id: work_item.state_id,
      state_group: state.state_group,
      estimate_id: estimate_point.estimate_id,
      value: estimate_point.value,
    })
    .from(work_item_module)
    .innerJoin(work_item, eq(work_item_module.work_item_id, work_item.id))
    .innerJoin(state, eq(work_item.state_id, state.id))
    .leftJoin(estimate_point, and(eq(work_item.estimate_point_id, estimate_point.id), isNull(estimate_point.deleted_at)))
    .where(activeItemsInModules([id]))
    .all();
  const items = rows.filter((item) => item.state_group !== "triage");
  const counts = emptyProgressCounts();
  const by_state: Record<string, number> = {};
  const points: PointsCounts | undefined = estimateId === null ? undefined : emptyProgressCounts();
  for (const item of items) {
    addToCounts(counts, item.state_group, 1);
    by_state[item.state_id] = (by_state[item.state_id] ?? 0) + 1;
    if (points && item.estimate_id === estimateId) addToCounts(points, item.state_group, parsePointValue(item.value) ?? 0);
  }
  const progress: ModuleProgress = { ...counts, by_state, ...loadBreakdowns(ctx, items) };
  return points ? { ...progress, points } : progress;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

type MemberRef = { id: string; name: string };

function loadMembers(ctx: TesseraContext, moduleId: string): MemberRef[] {
  return ctx.db
    .select({ id: module_member.actor_id, name: actor.name })
    .from(module_member)
    .innerJoin(actor, eq(module_member.actor_id, actor.id))
    .where(eq(module_member.module_id, moduleId))
    .orderBy(asc(module_member.actor_id))
    .all();
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Replaces the member rows and logs one `member_ids` row when the set changed; inside withTx only. */
function replaceMembers(ctx: TesseraContext, row: ModuleRow, before: MemberRef[], after: MemberRef[]): void {
  const beforeIds = before.map((member) => member.id);
  const afterIds = after.map((member) => member.id);
  if (sameIdSet(beforeIds, afterIds)) return;
  ctx.db.delete(module_member).where(eq(module_member.module_id, row.id)).run();
  if (after.length > 0) {
    ctx.db
      .insert(module_member)
      .values(after.map((member) => ({ module_id: row.id, actor_id: member.id })))
      .run();
  }
  logActivity(ctx, {
    ...moduleTarget(row),
    verb: "updated",
    field: "member_ids",
    old_value: JSON.stringify(beforeIds),
    new_value: JSON.stringify(afterIds),
    old_identifier: before.map((member) => member.name).join(", "),
    new_identifier: after.map((member) => member.name).join(", "),
  });
}

/** Every id must be a non-deleted actor (NOT_FOUND otherwise); duplicates collapse. */
function resolveMembers(ctx: TesseraContext, ids: readonly string[]): MemberRef[] {
  return uniqueIds(ids).map((id) => {
    const row: ActorRow = getActor(ctx, id);
    return { id: row.id, name: row.name };
  });
}

// ---------------------------------------------------------------------------
// Create, update, reorder
// ---------------------------------------------------------------------------

export const CreateModuleInput = z
  .object({
    project_id: IdSchema.describe("Project the module belongs to."),
    name: MODULE_NAME.describe("Module name, unique per project (case-insensitive)."),
    description_md: MODULE_DESCRIPTION.optional().describe("Markdown description."),
    status: ModuleStatusSchema.optional().describe("backlog, planned (default), in_progress, paused, completed or cancelled."),
    lead_actor_id: IdSchema.nullable().optional().describe("Actor leading the module, or null."),
    member_ids: IdListSchema.optional().describe("Actor ids of the members."),
    start_date: MODULE_DATE.nullable().optional().describe("Start date YYYY-MM-DD; must be on or before target_date."),
    target_date: MODULE_DATE.nullable().optional().describe("Target date YYYY-MM-DD."),
  })
  .strict();

export type CreateModuleInputType = z.input<typeof CreateModuleInput>;

export function createModule(ctx: TesseraContext, input: CreateModuleInputType): Module {
  const data = validateInput(CreateModuleInput, input);
  const startDate = data.start_date ?? null;
  const targetDate = data.target_date ?? null;
  checkDateOrder(startDate, targetDate);
  return withTx(ctx, () => {
    assertFeatureEnabled(loadWritableProject(ctx, data.project_id), "modules");
    const key = assertNameFree(ctx, data.project_id, data.name, null);
    const leadId = data.lead_actor_id ?? null;
    if (leadId !== null) getActor(ctx, leadId);
    const members = resolveMembers(ctx, data.member_ids ?? []);
    const now = ctx.now();
    const row = ctx.db
      .insert(moduleTable)
      .values({
        id: newId(),
        project_id: data.project_id,
        name: data.name,
        name_key: key,
        description_md: data.description_md ?? "",
        status: data.status ?? "planned",
        lead_actor_id: leadId,
        start_date: startDate,
        target_date: targetDate,
        sort_order: sortOrderAfter(lastSortOrder(ctx.db, moduleTable, activeInProject(data.project_id))),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { ...moduleTarget(row), verb: "created", new_identifier: row.name });
    replaceMembers(ctx, row, [], members);
    return toModule(ctx, row);
  });
}

export const UpdateModuleInput = z
  .object({
    name: MODULE_NAME.describe("New name, unique per project."),
    description_md: MODULE_DESCRIPTION.describe("New Markdown description."),
    status: ModuleStatusSchema.describe("New status; archive requires completed or cancelled."),
    lead_actor_id: IdSchema.nullable().describe("New lead actor, or null to clear."),
    start_date: MODULE_DATE.nullable().describe("New start date, or null to clear."),
    target_date: MODULE_DATE.nullable().describe("New target date, or null to clear."),
  })
  .partial()
  .strict();

export type UpdateModuleInputType = z.input<typeof UpdateModuleInput>;

const MODULE_UPDATE_FIELDS = ["name", "description_md", "status", "lead_actor_id", "start_date", "target_date"] as const;

/** Field-scoped update; membership and links have their own functions. */
export function updateModule(ctx: TesseraContext, id: string, patch: UpdateModuleInputType): Module {
  const data = validateInput(UpdateModuleInput, patch);
  return withTx(ctx, () => {
    const { row: before } = loadWritableModule(ctx, id);
    const name = data.name ?? before.name;
    const key = data.name === undefined ? before.name_key : assertNameFree(ctx, before.project_id, name, id);
    const startDate = data.start_date === undefined ? before.start_date : data.start_date;
    const targetDate = data.target_date === undefined ? before.target_date : data.target_date;
    checkDateOrder(startDate, targetDate);
    const leadId = data.lead_actor_id === undefined ? before.lead_actor_id : data.lead_actor_id;
    const actorNames = new Map<string, string>();
    if (leadId !== null) actorNames.set(leadId, getActor(ctx, leadId).name);
    if (before.lead_actor_id !== null && !actorNames.has(before.lead_actor_id)) {
      actorNames.set(before.lead_actor_id, actorNameOrId(ctx, before.lead_actor_id));
    }
    const now = ctx.now();
    const after = ctx.db
      .update(moduleTable)
      .set({
        name,
        name_key: key,
        description_md: data.description_md ?? before.description_md,
        status: data.status ?? before.status,
        lead_actor_id: leadId,
        start_date: startDate,
        target_date: targetDate,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(moduleTable.id, id))
      .returning()
      .get();
    diffFields(ctx, moduleTarget(before), before, after, MODULE_UPDATE_FIELDS, (field, value) => {
      if (field === "name" || field === "status") return typeof value === "string" ? value : null;
      if (field === "lead_actor_id") return typeof value === "string" ? (actorNames.get(value) ?? value) : null;
      return null;
    });
    return toModule(ctx, after);
  });
}

export const ReorderModuleInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the module that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the module that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderModuleInputType = z.input<typeof ReorderModuleInput>;

/**
 * Moves the module among the project's active (non-archived) modules; the
 * neighbours must be among them. The key is chosen among every live module,
 * archived ones included, so it stays unique when an archived neighbour is
 * restored later.
 */
export function reorderModule(ctx: TesseraContext, id: string, input: ReorderModuleInputType): Module {
  const data = validateInput(ReorderModuleInput, input);
  return withTx(ctx, () => {
    const { row: before } = loadWritableModule(ctx, id);
    const ordered = ctx.db
      .select({ id: moduleTable.id, sort_order: moduleTable.sort_order, archived_at: moduleTable.archived_at })
      .from(moduleTable)
      .where(activeInProject(before.project_id))
      .orderBy(asc(moduleTable.sort_order), asc(moduleTable.created_at))
      .all();
    const sortOrder = sortOrderForMove(ordered, id, data.before_id, data.after_id, "module");
    const now = ctx.now();
    const after = ctx.db
      .update(moduleTable)
      .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(moduleTable.id, id))
      .returning()
      .get();
    diffFields(ctx, moduleTarget(before), before, after, ["sort_order"], () => before.name);
    return toModule(ctx, after);
  });
}

// ---------------------------------------------------------------------------
// Archive, restore, delete
// ---------------------------------------------------------------------------

/** RULE unless the status is completed or cancelled; ARCHIVED when already archived. */
export function archiveModule(ctx: TesseraContext, id: string): Module {
  return withTx(ctx, () => {
    const { row: before } = loadWritableModule(ctx, id);
    if (!ARCHIVABLE_MODULE_STATUSES.includes(before.status)) {
      throw rule("module_status", `"${before.name}" can only be archived when its status is completed or cancelled (it is ${before.status})`);
    }
    const now = ctx.now();
    const after = ctx.db
      .update(moduleTable)
      .set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(moduleTable.id, id))
      .returning()
      .get();
    logActivity(ctx, { ...moduleTarget(before), verb: "archived", old_identifier: before.name });
    return toModule(ctx, after);
  });
}

export function unarchiveModule(ctx: TesseraContext, id: string): Module {
  return withTx(ctx, () => {
    const before = getModuleRow(ctx, id);
    loadWritableProject(ctx, before.project_id);
    if (before.archived_at === null) throw rule("not_archived", `module "${before.name}" is not archived`);
    const now = ctx.now();
    const after = ctx.db
      .update(moduleTable)
      .set({ archived_at: null, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(moduleTable.id, id))
      .returning()
      .get();
    logActivity(ctx, { ...moduleTarget(before), verb: "restored", new_identifier: before.name });
    return toModule(ctx, after);
  });
}

/** Soft-deletes the module and removes its member and work item junction rows; works on archived modules. */
export function deleteModule(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const before = getModuleRow(ctx, id);
    loadWritableProject(ctx, before.project_id);
    ctx.db.delete(work_item_module).where(eq(work_item_module.module_id, id)).run();
    ctx.db.delete(module_member).where(eq(module_member.module_id, id)).run();
    const now = ctx.now();
    ctx.db.update(moduleTable).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(moduleTable.id, id)).run();
    logActivity(ctx, { ...moduleTarget(before), verb: "deleted", old_identifier: before.name });
    stripIdsFromSavedFilters(ctx, { key: "module", ids: new Set([id]), project_id: before.project_id });
  });
}

// ---------------------------------------------------------------------------
// Work item membership
// ---------------------------------------------------------------------------

export const ModuleWorkItemIdsInput = z.array(IdSchema).min(1).describe("Work item ids; every item must belong to the module's project.");

export type ModuleWorkItemIdsInputType = z.input<typeof ModuleWorkItemIdsInput>;

type ItemRef = { id: string; key: string };

/** Every id must be a non-deleted, non-archived item of `projectRow`, in input order. */
function loadItemRefs(ctx: TesseraContext, projectRow: ProjectRow, ids: string[]): ItemRef[] {
  const rows = ctx.db
    .select({
      id: work_item.id,
      project_id: work_item.project_id,
      sequence_id: work_item.sequence_id,
      archived_at: work_item.archived_at,
      identifier: project.identifier,
    })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(and(inArray(work_item.id, ids), isNull(work_item.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw notFound("work_item", id);
    const key = formatKey(row.identifier, row.sequence_id);
    if (row.project_id !== projectRow.id) throw rule("work_item_project", `${key} belongs to another project`);
    if (row.archived_at !== null) throw archived(`work item ${key} is archived`);
    return { id, key };
  });
}

function currentMemberItemIds(ctx: TesseraContext, moduleId: string, ids: string[]): Set<string> {
  const rows = ctx.db
    .select({ id: work_item_module.work_item_id })
    .from(work_item_module)
    .where(and(eq(work_item_module.module_id, moduleId), inArray(work_item_module.work_item_id, ids)))
    .all();
  return new Set(rows.map((row) => row.id));
}

/** Logs membership on both sides: the item's key on the module, the module's name on the item. */
function logMembership(ctx: TesseraContext, row: ModuleRow, item: ItemRef, verb: "added" | "removed"): void {
  const valueField = verb === "added" ? "new_value" : "old_value";
  const identifierField = verb === "added" ? "new_identifier" : "old_identifier";
  logActivity(ctx, { ...moduleTarget(row), verb, field: "work_item", [valueField]: item.id, [identifierField]: item.key });
  logActivity(ctx, {
    project_id: row.project_id,
    entity_type: "work_item",
    entity_id: item.id,
    work_item_id: item.id,
    verb,
    field: "modules",
    [valueField]: row.id,
    [identifierField]: row.name,
  });
}

/** Adds the items to the module (many modules per item); items already in it are skipped. */
export function addWorkItemsToModule(ctx: TesseraContext, moduleId: string, workItemIds: ModuleWorkItemIdsInputType): Module {
  const ids = uniqueIds(validateInput(ModuleWorkItemIdsInput, workItemIds));
  return withTx(ctx, () => {
    const { row, projectRow } = loadWritableModule(ctx, moduleId);
    const items = loadItemRefs(ctx, projectRow, ids);
    const present = currentMemberItemIds(ctx, moduleId, ids);
    const added = items.filter((item) => !present.has(item.id));
    if (added.length > 0) {
      ctx.db
        .insert(work_item_module)
        .values(added.map((item) => ({ work_item_id: item.id, module_id: moduleId })))
        .run();
      for (const item of added) logMembership(ctx, row, item, "added");
    }
    return toModule(ctx, row);
  });
}

/** Removes the items from the module; items that are not in it are skipped. */
export function removeWorkItemsFromModule(ctx: TesseraContext, moduleId: string, workItemIds: ModuleWorkItemIdsInputType): Module {
  const ids = uniqueIds(validateInput(ModuleWorkItemIdsInput, workItemIds));
  return withTx(ctx, () => {
    const { row, projectRow } = loadWritableModule(ctx, moduleId);
    const items = loadItemRefs(ctx, projectRow, ids);
    const present = currentMemberItemIds(ctx, moduleId, ids);
    const removed = items.filter((item) => present.has(item.id));
    if (removed.length > 0) {
      ctx.db
        .delete(work_item_module)
        .where(
          and(
            eq(work_item_module.module_id, moduleId),
            inArray(
              work_item_module.work_item_id,
              removed.map((item) => item.id),
            ),
          ),
        )
        .run();
      for (const item of removed) logMembership(ctx, row, item, "removed");
    }
    return toModule(ctx, row);
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const SetModuleMembersInput = IdListSchema.describe("Actor ids that make up the member list; replaces the current members.");

export type SetModuleMembersInputType = z.input<typeof SetModuleMembersInput>;

/** Replace semantics: the module's members become exactly `actorIds` (deduplicated; every id must be a non-deleted actor). */
export function setModuleMembers(ctx: TesseraContext, id: string, actorIds: SetModuleMembersInputType): Module {
  const data = validateInput(SetModuleMembersInput, actorIds);
  return withTx(ctx, () => {
    const { row } = loadWritableModule(ctx, id);
    replaceMembers(ctx, row, loadMembers(ctx, id), resolveMembers(ctx, data));
    return toModule(ctx, row);
  });
}

export { AddModuleLinkInput, UpdateModuleLinkInput, addModuleLink, updateModuleLink, removeModuleLink, type AddModuleLinkInputType, type UpdateModuleLinkInputType } from "./module-links";
