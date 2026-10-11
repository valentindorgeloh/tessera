/**
 * Work items (docs/contracts/service-api.md, schema.md "Work items").
 *
 * The human key `WEB-12` is computed from the project identifier and the
 * sequence allocated inside the insert transaction (never reused). Every
 * mutation runs in withTx, validates its input with the schema exported next
 * to it, logs activity per changed field, keeps the FTS row in step and
 * returns the fresh view model. Archived items are read-only except unarchive
 * and delete. assignees.ts builds on the helpers exported here (it imports
 * this module, never the other way round).
 *
 * Intake policy (plan decision 27): when the acting actor is an agent and the
 * project has `intake_enabled` and `agent_intake_required`, every way an
 * agent can put an item into the project (`createWorkItem`, `copyWorkItem`,
 * `moveWorkItemToProject`) lands it in the hidden triage state with a pending
 * intake item, and no state change takes a pending item out of triage: only
 * Intake's accept / decline (P8) does. Cycle membership follows the cycle
 * rules: a completed cycle is read-only except transfer, an archived one
 * except unarchive and delete, so items neither join nor leave them here.
 * `deleteWorkItem` is the one exception: a member of a completed or archived
 * cycle can be deleted (live cycle progress drops, a frozen snapshot stays).
 * Archived modules are read-only too: `createWorkItem` and `syncModules`
 * refuse (ARCHIVED) to add an item to one or remove it from one, and keep the
 * memberships of archived modules that a call leaves unchanged.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getActor } from "./actors";
import { diffFields, latestSeq, logActivity, type IdentifierResolver } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, locked, notFound, rule, validateInput, validation } from "./core/errors";
import { isId, newId } from "./core/ids";
import { formatKey, normalizeIdentifier, parseKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderBetween } from "./core/order";
import { assertInTransaction, withTx } from "./core/tx";
import { deriveCycleStatus } from "./cycles";
import { deleteWorkItemFts, upsertWorkItemFts } from "./db/fts";
import {
  actor,
  cycle,
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
  work_item_link,
  work_item_module,
  work_item_subscriber,
} from "./db/schema";
import { buildOrder, buildWhere, groupItems, NONE_GROUP_ID, type Group } from "./filters";
import { DEFAULT_INTAKE_NAME, getProjectRow } from "./projects";
import { DisplaySchema, FiltersSchema, GroupBySchema, IdListSchema, IdSchema, IntakeSourceSchema, IsoDateSchema, PrioritySchema } from "./schemas";
import { ensureTriageState } from "./states";
import type {
  CycleRow,
  Display,
  Filters,
  IntakeStatus,
  LabelRow,
  ModuleRow,
  ProjectRow,
  StateRow,
  WorkItemLinkRow,
  WorkItemRow,
} from "./types";

export type { Group } from "./filters";

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export type WorkItemIntake = { status: IntakeStatus };

export type WorkItem = WorkItemRow & {
  /** `<identifier>-<sequence_id>`, computed at read time. */
  key: string;
  label_ids: string[];
  module_ids: string[];
  assignee_ids: string[];
  sub_items_count: number;
  links_count: number;
  /** Present when the item went through Intake; `pending` items are hidden from lists. */
  intake: WorkItemIntake | null;
};

export type WorkItemDetail = WorkItem & {
  subscriber_ids: string[];
  links: WorkItemLinkRow[];
};

export type ListResult<T> = {
  items: T[];
  total: number;
  /** `latestSeq()` at read time so a page can start the change poller without a second query. */
  cursor: number;
};

export type WorkItemListResult = ListResult<WorkItem> & { groups?: Group[] };

const WORK_ITEM_NAME = z.string().trim().min(1).max(255);
const DESCRIPTION = z.string().max(1_000_000);
/** Largest id list accepted by the set-style mutations. */
const MAX_IDS = 500;
/** Rows per `IN (...)` batch while hydrating view models (SQLite accepts far more, but keeps statements small). */
const CHUNK = 500;

const ENTITY = "work_item";

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Non-deleted work item row by id; NOT_FOUND otherwise. */
export function getWorkItemRow(ctx: TesseraContext, id: string): WorkItemRow {
  const row = ctx.db
    .select()
    .from(work_item)
    .where(and(eq(work_item.id, id), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound(ENTITY, id);
  return row;
}

export type LoadedWorkItem = { item: WorkItemRow; project: ProjectRow };

/** Archived projects are read-only except unarchive and delete. */
function loadWritableProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = getProjectRow(ctx, projectId);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  return row;
}

/** The item plus its project; refuses archived projects, and archived items unless `allowArchived`. */
export function loadWritableWorkItem(ctx: TesseraContext, id: string, options: { allowArchived?: boolean } = {}): LoadedWorkItem {
  const item = getWorkItemRow(ctx, id);
  const projectRow = loadWritableProject(ctx, item.project_id);
  if (item.archived_at !== null && options.allowArchived !== true) {
    throw archived(`work item ${formatKey(projectRow.identifier, item.sequence_id)} is archived`);
  }
  return { item, project: projectRow };
}

function itemKey(projectRow: ProjectRow, item: WorkItemRow): string {
  return formatKey(projectRow.identifier, item.sequence_id);
}

/** Human key for any item id, tolerating deleted rows (used for activity identifiers). */
function keyOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db
    .select({ identifier: project.identifier, sequence_id: work_item.sequence_id })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(eq(work_item.id, id))
    .get();
  return row ? formatKey(row.identifier, row.sequence_id) : id;
}

function cycleNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, id)).get();
  return row?.name ?? id;
}

function estimatePointValueOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ value: estimate_point.value }).from(estimate_point).where(eq(estimate_point.id, id)).get();
  return row?.value ?? id;
}

function actorNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: actor.name }).from(actor).where(eq(actor.id, id)).get();
  return row?.name ?? id;
}

function labelNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: label.name }).from(label).where(eq(label.id, id)).get();
  return row?.name ?? id;
}

function moduleNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: moduleTable.name }).from(moduleTable).where(eq(moduleTable.id, id)).get();
  return row?.name ?? id;
}

// ---------------------------------------------------------------------------
// Cross-project validation
// ---------------------------------------------------------------------------

function resolveState(ctx: TesseraContext, projectId: string, stateId: string): StateRow {
  const row = ctx.db
    .select()
    .from(state)
    .where(and(eq(state.id, stateId), isNull(state.deleted_at)))
    .get();
  if (!row) throw notFound("state", stateId);
  if (row.project_id !== projectId) throw rule("state_project", `State "${row.name}" belongs to another project`);
  return row;
}

function defaultState(ctx: TesseraContext, projectId: string): StateRow {
  const row = ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.is_default, true), isNull(state.deleted_at)))
    .get();
  if (!row) throw rule("no_default_state", "The project has no default state");
  return row;
}

function resolveCycle(ctx: TesseraContext, projectId: string, cycleId: string): CycleRow {
  const row = ctx.db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), isNull(cycle.deleted_at)))
    .get();
  if (!row) throw notFound("cycle", cycleId);
  if (row.project_id !== projectId) throw rule("cycle_project", `Cycle "${row.name}" belongs to another project`);
  return row;
}

/** The cycle row when it still exists; a deleted cycle has already detached its items, so a stale pointer is simply ignored. */
function cycleRowIfLive(ctx: TesseraContext, cycleId: string): CycleRow | null {
  return (
    ctx.db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, cycleId), isNull(cycle.deleted_at)))
      .get() ?? null
  );
}

/** Completed cycles are read-only except reorder, archive and transfer; archived ones except unarchive and delete (schema.md "Cycles"). */
function assertCycleOpen(ctx: TesseraContext, cycleRow: CycleRow): void {
  if (cycleRow.archived_at !== null) throw archived(`cycle "${cycleRow.name}" is archived`);
  if (deriveCycleStatus(cycleRow, ctx.today()) === "completed") {
    throw locked(`cycle "${cycleRow.name}" is completed and read-only; transfer its open items instead`);
  }
}

function resolveEstimatePoint(ctx: TesseraContext, projectId: string, pointId: string): string {
  const row = ctx.db
    .select({ value: estimate_point.value, project_id: estimate.project_id })
    .from(estimate_point)
    .innerJoin(estimate, eq(estimate_point.estimate_id, estimate.id))
    .where(and(eq(estimate_point.id, pointId), isNull(estimate_point.deleted_at), isNull(estimate.deleted_at)))
    .get();
  if (!row) throw notFound("estimate_point", pointId);
  if (row.project_id !== projectId) throw rule("estimate_point_project", "The estimate point belongs to another project");
  return row.value;
}

function resolveLabels(ctx: TesseraContext, projectId: string, ids: string[]): Map<string, LabelRow> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select()
    .from(label)
    .where(and(inArray(label.id, wanted), isNull(label.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) throw notFound("label", id);
    if (row.project_id !== projectId) throw rule("label_project", `Label "${row.name}" belongs to another project`);
  }
  return byId;
}

function resolveModules(ctx: TesseraContext, projectId: string, ids: string[]): Map<string, ModuleRow> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select()
    .from(moduleTable)
    .where(and(inArray(moduleTable.id, wanted), isNull(moduleTable.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) throw notFound("module", id);
    if (row.project_id !== projectId) throw rule("module_project", `Module "${row.name}" belongs to another project`);
  }
  return byId;
}

/**
 * Items neither join nor leave an archived module: ARCHIVED when one of `ids`
 * (the modules a call adds or removes) is archived. Memberships of archived
 * modules that the call leaves unchanged are kept.
 */
function assertModulesNotArchived(ctx: TesseraContext, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const row = ctx.db
    .select({ name: moduleTable.name })
    .from(moduleTable)
    .where(and(inArray(moduleTable.id, [...ids]), isNull(moduleTable.deleted_at), isNotNull(moduleTable.archived_at)))
    .orderBy(asc(moduleTable.sort_order), asc(moduleTable.created_at))
    .get();
  if (row) throw archived(`module "${row.name}" is archived`);
}

/** Live actors by id; NOT_FOUND for a deleted or unknown one. */
function resolveActors(ctx: TesseraContext, ids: string[]): Map<string, string> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select({ id: actor.id, name: actor.name })
    .from(actor)
    .where(and(inArray(actor.id, wanted), isNull(actor.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  for (const id of wanted) if (!byId.has(id)) throw notFound("actor", id);
  return byId;
}

/** Same project, not the item itself, and the parent chain must not lead back to the item. */
function resolveParent(ctx: TesseraContext, projectId: string, parentId: string, selfId: string | null): WorkItemRow {
  if (parentId === selfId) throw rule("parent_self", "A work item cannot be its own parent");
  const parent = getWorkItemRow(ctx, parentId);
  if (parent.project_id !== projectId) throw rule("parent_project", "The parent must belong to the same project");
  if (selfId !== null) {
    let ancestor: string | null = parent.parent_id;
    const visited = new Set<string>([parent.id]);
    while (ancestor !== null) {
      if (ancestor === selfId) throw rule("parent_cycle", "The parent chain would form a cycle");
      if (visited.has(ancestor)) break;
      visited.add(ancestor);
      const row: { parent_id: string | null } | undefined = ctx.db
        .select({ parent_id: work_item.parent_id })
        .from(work_item)
        .where(eq(work_item.id, ancestor))
        .get();
      ancestor = row?.parent_id ?? null;
    }
  }
  return parent;
}

function checkDates(start: string | null, target: string | null): void {
  if (start !== null && target !== null && start > target) {
    throw rule("date_order", `start_date ${start} must not be after target_date ${target}`);
  }
}

function assertNotTriage(stateRow: StateRow): void {
  if (stateRow.state_group === "triage") throw rule("triage_state", "The triage state is reserved for Intake");
}

/** `completed_at` follows the state group: set on entering `completed`, cleared on leaving it. */
function nextCompletedAt(ctx: TesseraContext, before: StateRow | null, after: StateRow, current: string | null): string | null {
  const wasCompleted = before?.state_group === "completed";
  if (after.state_group === "completed") return wasCompleted && current !== null ? current : ctx.now();
  return null;
}

/** A completed or cancelled item cannot be moved into a cycle (schema.md "Cycles"). */
function assertCycleAllowed(stateRow: StateRow, cycleRow: CycleRow): void {
  if (stateRow.state_group === "completed" || stateRow.state_group === "cancelled") {
    throw rule("cycle_closed_item", `A ${stateRow.state_group} work item cannot be moved into cycle "${cycleRow.name}"`);
  }
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

type JoinedRow = { item: WorkItemRow; identifier: string };

function itemQuery(ctx: TesseraContext) {
  return ctx.db
    .select({ item: work_item, identifier: project.identifier })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .$dynamic();
}

function chunked<T>(values: T[]): T[][] {
  const slices: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) slices.push(values.slice(i, i + CHUNK));
  return slices;
}

function collectLists(ids: string[], fetch: (slice: string[]) => { k: string; v: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const slice of chunked(ids)) {
    for (const row of fetch(slice)) {
      const list = map.get(row.k);
      if (list) list.push(row.v);
      else map.set(row.k, [row.v]);
    }
  }
  return map;
}

function collectCounts(ids: string[], fetch: (slice: string[]) => { k: string | null; n: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const slice of chunked(ids)) {
    for (const row of fetch(slice)) if (row.k !== null) map.set(row.k, row.n);
  }
  return map;
}

function hydrate(ctx: TesseraContext, rows: JoinedRow[]): WorkItem[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.item.id);
  const labels = collectLists(ids, (slice) =>
    ctx.db.select({ k: work_item_label.work_item_id, v: work_item_label.label_id }).from(work_item_label).where(inArray(work_item_label.work_item_id, slice)).all(),
  );
  const modules = collectLists(ids, (slice) =>
    ctx.db.select({ k: work_item_module.work_item_id, v: work_item_module.module_id }).from(work_item_module).where(inArray(work_item_module.work_item_id, slice)).all(),
  );
  const assignees = collectLists(ids, (slice) =>
    ctx.db
      .select({ k: work_item_assignee.work_item_id, v: work_item_assignee.actor_id })
      .from(work_item_assignee)
      .where(inArray(work_item_assignee.work_item_id, slice))
      .all(),
  );
  const children = collectCounts(ids, (slice) =>
    ctx.db
      .select({ k: work_item.parent_id, n: count() })
      .from(work_item)
      .where(and(inArray(work_item.parent_id, slice), isNull(work_item.deleted_at)))
      .groupBy(work_item.parent_id)
      .all(),
  );
  const links = collectCounts(ids, (slice) =>
    ctx.db
      .select({ k: work_item_link.work_item_id, n: count() })
      .from(work_item_link)
      .where(and(inArray(work_item_link.work_item_id, slice), isNull(work_item_link.deleted_at)))
      .groupBy(work_item_link.work_item_id)
      .all(),
  );
  const intakes = new Map<string, IntakeStatus>();
  for (const slice of chunked(ids)) {
    const found = ctx.db
      .select({ k: intake_item.work_item_id, status: intake_item.status })
      .from(intake_item)
      .where(and(inArray(intake_item.work_item_id, slice), isNull(intake_item.deleted_at)))
      .all();
    for (const row of found) intakes.set(row.k, row.status);
  }
  return rows.map(({ item, identifier }) => {
    const status = intakes.get(item.id);
    return {
      ...item,
      key: formatKey(identifier, item.sequence_id),
      label_ids: labels.get(item.id) ?? [],
      module_ids: modules.get(item.id) ?? [],
      assignee_ids: assignees.get(item.id) ?? [],
      sub_items_count: children.get(item.id) ?? 0,
      links_count: links.get(item.id) ?? 0,
      intake: status === undefined ? null : { status },
    };
  });
}

/** Fresh list view model of one item (deleted rows are NOT_FOUND). */
export function loadWorkItem(ctx: TesseraContext, id: string): WorkItem {
  const row = itemQuery(ctx)
    .where(and(eq(work_item.id, id), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound(ENTITY, id);
  return hydrate(ctx, [row])[0];
}

export function listSubscriberIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ actor_id: work_item_subscriber.actor_id })
    .from(work_item_subscriber)
    .where(eq(work_item_subscriber.work_item_id, id))
    .all()
    .map((row) => row.actor_id);
}

function listLinks(ctx: TesseraContext, id: string): WorkItemLinkRow[] {
  return ctx.db
    .select()
    .from(work_item_link)
    .where(and(eq(work_item_link.work_item_id, id), isNull(work_item_link.deleted_at)))
    .orderBy(asc(work_item_link.sort_order), asc(work_item_link.created_at))
    .all();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getWorkItem(ctx: TesseraContext, id: string): WorkItemDetail {
  const item = loadWorkItem(ctx, id);
  return { ...item, subscriber_ids: listSubscriberIds(ctx, id), links: listLinks(ctx, id) };
}

/** By key (`WEB-12`, any case) or by id. */
export function getWorkItemByKey(ctx: TesseraContext, keyOrId: string): WorkItemDetail {
  const raw = keyOrId.trim();
  if (isId(raw)) return getWorkItem(ctx, raw);
  const parsed = parseKey(raw);
  if (!parsed) throw notFound(ENTITY, raw);
  const row = ctx.db
    .select({ id: work_item.id })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(
      and(
        eq(project.identifier, normalizeIdentifier(parsed.identifier)),
        isNull(project.deleted_at),
        eq(work_item.sequence_id, parsed.sequenceId),
        isNull(work_item.deleted_at),
      ),
    )
    .get();
  if (!row) throw notFound(ENTITY, raw);
  return getWorkItem(ctx, row.id);
}

/** Non-deleted children of an item in sort order; NOT_FOUND when the parent does not exist. */
export function listChildren(ctx: TesseraContext, id: string): WorkItem[] {
  getWorkItemRow(ctx, id);
  const rows = itemQuery(ctx)
    .where(and(eq(work_item.parent_id, id), isNull(work_item.deleted_at)))
    .orderBy(asc(work_item.sort_order), asc(work_item.sequence_id))
    .all();
  return hydrate(ctx, rows);
}

export const ListScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), project_id: IdSchema.describe("Project whose items are listed.") }).strict(),
  z.object({ type: z.literal("cycle"), cycle_id: IdSchema.describe("Cycle whose items are listed.") }).strict(),
  z.object({ type: z.literal("module"), module_id: IdSchema.describe("Module whose items are listed.") }).strict(),
  z.object({ type: z.literal("view"), view_id: IdSchema.describe("Saved view whose filters and display apply under the caller's.") }).strict(),
  z.object({ type: z.literal("workspace") }).strict(),
  z
    .object({
      type: z.literal("profile"),
      actor_id: IdSchema.describe("Actor whose work is listed."),
      tab: z.enum(["assigned", "created", "subscribed"]).describe("Which relation to the actor."),
    })
    .strict(),
  z.object({ type: z.literal("archived"), project_id: IdSchema.describe("Project whose archived items are listed.") }).strict(),
  z.object({ type: z.literal("draft") }).strict(),
]);

export type ListScope = z.infer<typeof ListScopeSchema>;

export const ListWorkItemsInput = z
  .object({
    scope: ListScopeSchema.describe("Which list this is."),
    filters: FiltersSchema.optional().describe("Filters combined with AND; merged over a view's saved filters."),
    display: DisplaySchema.partial().optional().describe("Ordering, grouping and layout; merged over a view's saved display."),
    limit: z.number().int().min(1).max(5000).optional().describe("Page size; all items when omitted."),
    offset: z.number().int().min(0).optional().describe("Rows to skip."),
  })
  .strict();

export type ListWorkItemsInputType = z.input<typeof ListWorkItemsInput>;

type ResolvedScope = {
  where: SQL | undefined;
  project_ids: string[];
  /** The one project the list belongs to, for narrowing full-text search. */
  project_id: string | null;
  filters: Filters;
  display: Display;
  empty?: boolean;
};

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function liveProjectIds(ctx: TesseraContext): string[] {
  return ctx.db
    .select({ id: project.id })
    .from(project)
    .where(and(isNull(project.deleted_at), isNull(project.archived_at)))
    .all()
    .map((row) => row.id);
}

/** Workspace-wide lists only show items of live, non-archived projects. */
const LIVE_PROJECT = and(isNull(project.deleted_at), isNull(project.archived_at));

function resolveScope(ctx: TesseraContext, data: z.output<typeof ListWorkItemsInput>): ResolvedScope {
  const scope = data.scope;
  const callerFilters = data.filters ?? {};
  const callerDisplay = stripUndefined(data.display ?? {});
  const base = { filters: callerFilters, display: DisplaySchema.parse(callerDisplay) };
  switch (scope.type) {
    case "project": {
      getProjectRow(ctx, scope.project_id);
      return { ...base, where: eq(work_item.project_id, scope.project_id), project_ids: [scope.project_id], project_id: scope.project_id };
    }
    case "archived": {
      getProjectRow(ctx, scope.project_id);
      return {
        ...base,
        filters: { ...callerFilters, archived: true },
        where: and(eq(work_item.project_id, scope.project_id), isNotNull(work_item.archived_at)),
        project_ids: [scope.project_id],
        project_id: scope.project_id,
      };
    }
    case "cycle": {
      const row = ctx.db
        .select({ project_id: cycle.project_id })
        .from(cycle)
        .where(and(eq(cycle.id, scope.cycle_id), isNull(cycle.deleted_at)))
        .get();
      if (!row) throw notFound("cycle", scope.cycle_id);
      return { ...base, where: eq(work_item.cycle_id, scope.cycle_id), project_ids: [row.project_id], project_id: row.project_id };
    }
    case "module": {
      const row = ctx.db
        .select({ project_id: moduleTable.project_id })
        .from(moduleTable)
        .where(and(eq(moduleTable.id, scope.module_id), isNull(moduleTable.deleted_at)))
        .get();
      if (!row) throw notFound("module", scope.module_id);
      const member = inArray(
        work_item.id,
        ctx.db.select({ id: work_item_module.work_item_id }).from(work_item_module).where(eq(work_item_module.module_id, scope.module_id)),
      );
      return { ...base, where: member, project_ids: [row.project_id], project_id: row.project_id };
    }
    case "view": {
      const row = ctx.db
        .select()
        .from(view)
        .where(and(eq(view.id, scope.view_id), isNull(view.deleted_at)))
        .get();
      if (!row) throw notFound("view", scope.view_id);
      const filters = { ...FiltersSchema.parse(row.filters), ...stripUndefined(callerFilters) };
      const display = DisplaySchema.parse({ ...DisplaySchema.parse(row.display), ...callerDisplay });
      if (row.project_id !== null) {
        return { filters, display, where: eq(work_item.project_id, row.project_id), project_ids: [row.project_id], project_id: row.project_id };
      }
      return { filters, display, where: LIVE_PROJECT, project_ids: liveProjectIds(ctx), project_id: null };
    }
    case "workspace":
      return { ...base, where: LIVE_PROJECT, project_ids: liveProjectIds(ctx), project_id: null };
    case "profile": {
      getActor(ctx, scope.actor_id);
      const relation =
        scope.tab === "assigned"
          ? inArray(
              work_item.id,
              ctx.db.select({ id: work_item_assignee.work_item_id }).from(work_item_assignee).where(eq(work_item_assignee.actor_id, scope.actor_id)),
            )
          : scope.tab === "subscribed"
            ? inArray(
                work_item.id,
                ctx.db
                  .select({ id: work_item_subscriber.work_item_id })
                  .from(work_item_subscriber)
                  .where(eq(work_item_subscriber.actor_id, scope.actor_id)),
              )
            : eq(work_item.created_by, scope.actor_id);
      return { ...base, where: and(LIVE_PROJECT, relation), project_ids: liveProjectIds(ctx), project_id: null };
    }
    case "draft":
      // Drafts live in draft_work_item (P8); the scope exists so the UI can address it today.
      return { ...base, where: sql`1 = 0`, project_ids: [], project_id: null, empty: true };
  }
}

/** `Display.type` and `Display.sub_items` act as filters when the filters do not say otherwise. */
function effectiveFilters(filters: Filters, display: Display): Filters {
  return {
    ...filters,
    type: filters.type !== undefined ? filters.type : display.type,
    sub_items: filters.sub_items !== undefined ? filters.sub_items : display.sub_items,
  };
}

export function listWorkItems(ctx: TesseraContext, input: ListWorkItemsInputType): WorkItemListResult {
  const data = validateInput(ListWorkItemsInput, input);
  const scope = resolveScope(ctx, data);
  if (scope.empty === true) return { items: [], total: 0, cursor: latestSeq(ctx) };
  const filters = effectiveFilters(scope.filters, scope.display);
  const where = and(scope.where, buildWhere(ctx, filters, { project_id: scope.project_id }));
  const total =
    ctx.db
      .select({ n: count() })
      .from(work_item)
      .innerJoin(project, eq(work_item.project_id, project.id))
      .where(where)
      .get()?.n ?? 0;
  let query = itemQuery(ctx)
    .where(where)
    .orderBy(...buildOrder(scope.display));
  if (data.limit !== undefined) query = query.limit(data.limit);
  if (data.offset !== undefined) query = query.offset(data.offset);
  const items = hydrate(ctx, query.all());
  const result: WorkItemListResult = { items, total, cursor: latestSeq(ctx) };
  if (scope.display.group_by !== null) result.groups = groupItems(ctx, items, scope.display, { project_ids: scope.project_ids });
  return result;
}

// ---------------------------------------------------------------------------
// Junction rows (labels, modules, assignees, subscribers)
// ---------------------------------------------------------------------------

function diffSets(current: string[], next: string[]): { added: string[]; removed: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return { added: [...nextSet].filter((id) => !currentSet.has(id)), removed: [...currentSet].filter((id) => !nextSet.has(id)) };
}

function currentLabelIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_label.label_id })
    .from(work_item_label)
    .where(eq(work_item_label.work_item_id, id))
    .all()
    .map((row) => row.v);
}

function currentModuleIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_module.module_id })
    .from(work_item_module)
    .where(eq(work_item_module.work_item_id, id))
    .all()
    .map((row) => row.v);
}

function currentAssigneeIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ v: work_item_assignee.actor_id })
    .from(work_item_assignee)
    .where(eq(work_item_assignee.work_item_id, id))
    .all()
    .map((row) => row.v);
}

type JunctionField = "labels" | "modules" | "assignees" | "subscribers";

function logMembership(ctx: TesseraContext, loaded: LoadedWorkItem, field: JunctionField, verb: "added" | "removed", id: string, name: string): void {
  logActivity(ctx, {
    project_id: loaded.project.id,
    entity_type: ENTITY,
    entity_id: loaded.item.id,
    work_item_id: loaded.item.id,
    verb,
    field,
    old_value: verb === "removed" ? id : null,
    new_value: verb === "added" ? id : null,
    old_identifier: verb === "removed" ? name : null,
    new_identifier: verb === "added" ? name : null,
  });
}

/** Replaces the label set (same project only) and logs one row per added or removed label; inside withTx. */
export function syncLabels(ctx: TesseraContext, loaded: LoadedWorkItem, labelIds: string[]): void {
  assertInTransaction(ctx, "syncLabels");
  const names = resolveLabels(ctx, loaded.project.id, labelIds);
  const { added, removed } = diffSets(currentLabelIds(ctx, loaded.item.id), labelIds);
  if (removed.length > 0) {
    ctx.db.delete(work_item_label).where(and(eq(work_item_label.work_item_id, loaded.item.id), inArray(work_item_label.label_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_label)
      .values(added.map((label_id) => ({ work_item_id: loaded.item.id, label_id })))
      .run();
  }
  for (const id of removed) logMembership(ctx, loaded, "labels", "removed", id, labelNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "labels", "added", id, names.get(id)?.name ?? id);
}

/**
 * Replaces the module set (same project only) and logs one row per change;
 * inside withTx. ARCHIVED when a module being added or removed is archived;
 * archived modules the call keeps stay untouched.
 */
export function syncModules(ctx: TesseraContext, loaded: LoadedWorkItem, moduleIds: string[]): void {
  assertInTransaction(ctx, "syncModules");
  const names = resolveModules(ctx, loaded.project.id, moduleIds);
  const { added, removed } = diffSets(currentModuleIds(ctx, loaded.item.id), moduleIds);
  assertModulesNotArchived(ctx, [...added, ...removed]);
  if (removed.length > 0) {
    ctx.db.delete(work_item_module).where(and(eq(work_item_module.work_item_id, loaded.item.id), inArray(work_item_module.module_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_module)
      .values(added.map((module_id) => ({ work_item_id: loaded.item.id, module_id })))
      .run();
  }
  for (const id of removed) logMembership(ctx, loaded, "modules", "removed", id, moduleNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "modules", "added", id, names.get(id)?.name ?? id);
}

/** Adds subscriber rows that do not exist yet; returns the ids actually added. */
function addSubscribers(ctx: TesseraContext, itemId: string, actorIds: string[]): string[] {
  const existing = new Set(listSubscriberIds(ctx, itemId));
  const added = [...new Set(actorIds)].filter((id) => !existing.has(id));
  if (added.length > 0) {
    ctx.db
      .insert(work_item_subscriber)
      .values(added.map((actor_id) => ({ work_item_id: itemId, actor_id })))
      .run();
  }
  return added;
}

/** Replaces the assignee set (live actors only), auto-subscribes added actors and logs one row per change; inside withTx. */
export function syncAssignees(ctx: TesseraContext, loaded: LoadedWorkItem, actorIds: string[]): void {
  assertInTransaction(ctx, "syncAssignees");
  const names = resolveActors(ctx, actorIds);
  const { added, removed } = diffSets(currentAssigneeIds(ctx, loaded.item.id), actorIds);
  if (removed.length > 0) {
    ctx.db.delete(work_item_assignee).where(and(eq(work_item_assignee.work_item_id, loaded.item.id), inArray(work_item_assignee.actor_id, removed))).run();
  }
  if (added.length > 0) {
    ctx.db
      .insert(work_item_assignee)
      .values(added.map((actor_id) => ({ work_item_id: loaded.item.id, actor_id })))
      .run();
    addSubscribers(ctx, loaded.item.id, added);
  }
  for (const id of removed) logMembership(ctx, loaded, "assignees", "removed", id, actorNameOrId(ctx, id));
  for (const id of added) logMembership(ctx, loaded, "assignees", "added", id, names.get(id) ?? id);
}

/** Subscribes `actorId` (idempotent) and logs when a row was added; inside withTx. */
export function insertSubscriber(ctx: TesseraContext, loaded: LoadedWorkItem, actorId: string): boolean {
  assertInTransaction(ctx, "insertSubscriber");
  const name = getActor(ctx, actorId).name;
  const added = addSubscribers(ctx, loaded.item.id, [actorId]);
  if (added.length === 0) return false;
  logMembership(ctx, loaded, "subscribers", "added", actorId, name);
  return true;
}

/** Removes the subscription (idempotent) and logs when a row was removed; inside withTx. */
export function dropSubscriber(ctx: TesseraContext, loaded: LoadedWorkItem, actorId: string): boolean {
  assertInTransaction(ctx, "dropSubscriber");
  const result = ctx.db
    .delete(work_item_subscriber)
    .where(and(eq(work_item_subscriber.work_item_id, loaded.item.id), eq(work_item_subscriber.actor_id, actorId)))
    .run();
  if (result.changes === 0) return false;
  logMembership(ctx, loaded, "subscribers", "removed", actorId, actorNameOrId(ctx, actorId));
  return true;
}

export const SetLabelsInput = IdListSchema.max(MAX_IDS);
export const SetModulesInput = IdListSchema.max(MAX_IDS);

/** Replace semantics: the item ends up with exactly `label_ids`. */
export function setLabels(ctx: TesseraContext, id: string, label_ids: string[]): WorkItem {
  const ids = validateInput(SetLabelsInput, label_ids);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    syncLabels(ctx, loaded, ids);
    touch(ctx, loaded.item.id);
    return loadWorkItem(ctx, id);
  });
}

/** Replace semantics: the item ends up with exactly `module_ids`. */
export function setModules(ctx: TesseraContext, id: string, module_ids: string[]): WorkItem {
  const ids = validateInput(SetModulesInput, module_ids);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    syncModules(ctx, loaded, ids);
    touch(ctx, loaded.item.id);
    return loadWorkItem(ctx, id);
  });
}

/** Moves updated_at / updated_by after a junction-only change. */
function touch(ctx: TesseraContext, id: string): void {
  ctx.db.update(work_item).set({ updated_at: ctx.now(), updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
}

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
function allocateSequence(ctx: TesseraContext, projectId: string): number {
  assertInTransaction(ctx, "allocateSequence");
  const row = ctx.sqlite
    .prepare<[string], { next_sequence: number }>("UPDATE project SET next_sequence = next_sequence + 1 WHERE id = ? RETURNING next_sequence")
    .get(projectId);
  if (!row) throw notFound("project", projectId);
  return row.next_sequence - 1;
}

function nextSortOrder(ctx: TesseraContext, projectId: string): string {
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
function insertWorkItem(ctx: TesseraContext, projectRow: ProjectRow, data: NewItem): WorkItemRow {
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

function findDefaultIntake(ctx: TesseraContext, projectId: string): { id: string } | undefined {
  return ctx.db
    .select({ id: intake.id })
    .from(intake)
    .where(and(eq(intake.project_id, projectId), eq(intake.is_default, true), isNull(intake.deleted_at)))
    .get();
}

/** The project's default intake, created on demand (updateProjectFeatures normally creates it with the triage state). */
function ensureDefaultIntake(ctx: TesseraContext, projectId: string): string {
  const existing = findDefaultIntake(ctx, projectId);
  if (existing) return existing.id;
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
    .returning({ id: intake.id })
    .get();
  logActivity(ctx, { project_id: projectId, entity_type: "intake", entity_id: row.id, verb: "created", new_identifier: DEFAULT_INTAKE_NAME });
  return row.id;
}

function recordIntakeItem(ctx: TesseraContext, projectRow: ProjectRow, item: WorkItemRow, source: NewItemSource): void {
  const now = ctx.now();
  const row = ctx.db
    .insert(intake_item)
    .values({
      id: newId(),
      intake_id: ensureDefaultIntake(ctx, projectRow.id),
      work_item_id: item.id,
      status: "pending",
      source,
      created_by_actor_id: ctx.actor.id,
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning({ id: intake_item.id })
    .get();
  logActivity(ctx, {
    project_id: projectRow.id,
    entity_type: "intake_item",
    entity_id: row.id,
    work_item_id: item.id,
    verb: "created",
    new_identifier: itemKey(projectRow, item),
  });
}

type NewItemSource = z.infer<typeof IntakeSourceSchema>;

/** True when this call must land in Intake instead of the board. */
function intakeRequired(ctx: TesseraContext, projectRow: ProjectRow): boolean {
  return ctx.actor.kind === "agent" && projectRow.intake_enabled && projectRow.agent_intake_required;
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
    if (viaIntake) recordIntakeItem(ctx, projectRow, row, data.source ?? "mcp");
    return loadWorkItem(ctx, row.id);
  });
}

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
function applyPatch(ctx: TesseraContext, loaded: LoadedWorkItem, data: UpdatePatch): WorkItemRow {
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

export const BulkUpdateWorkItemsInput = z
  .object({
    ids: IdListSchema.min(1).max(MAX_IDS).describe("Work items to change."),
    patch: UpdateWorkItemInput.describe("Fields applied to every item."),
  })
  .strict();

/** Applies the same patch to every item in one transaction: one failure rolls back all of them. */
export function bulkUpdateWorkItems(ctx: TesseraContext, ids: string[], patch: UpdateWorkItemInputType): WorkItem[] {
  const data = validateInput(BulkUpdateWorkItemsInput, { ids, patch });
  return withTx(ctx, () => {
    const unique = [...new Set(data.ids)];
    for (const id of unique) applyPatch(ctx, loadWritableWorkItem(ctx, id), data.patch);
    return unique.map((id) => loadWorkItem(ctx, id));
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
    // Bodies are not copied into the log; versions.ts (P10) keeps the snapshots.
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

// ---------------------------------------------------------------------------
// Move (reorder and change the grouped field)
// ---------------------------------------------------------------------------

/**
 * `before_id` / `after_id` are the neighbours in the list the item was dropped
 * into. `group_by` + `value` change the grouped field: a state, priority,
 * cycle or date value (null = the "none" group). For labels, assignees and
 * modules the item gains `value` and loses `from_value` (the group it was
 * dragged out of) instead of being replaced.
 */
export const MoveWorkItemInput = z
  .object({
    group_by: GroupBySchema.optional().describe("Grouped field to change; omit for a pure reorder."),
    value: z.string().nullable().optional().describe("Target group value (id, priority, date); null for the none group."),
    from_value: z.string().nullable().optional().describe("For labels, assignees and modules: the group value the item left."),
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

/** Applies a group change; returns true when something was written. */
function applyGroupChange(ctx: TesseraContext, loaded: LoadedWorkItem, data: z.output<typeof MoveWorkItemInput>): void {
  const field = data.group_by;
  if (field === undefined) return;
  const value = data.value === NONE_GROUP_ID ? null : (data.value ?? null);
  const fromValue = data.from_value === NONE_GROUP_ID ? null : (data.from_value ?? null);
  switch (field) {
    case "state":
      applyPatch(ctx, loaded, { state_id: parseGroupValue(IdSchema, value, field) });
      return;
    case "priority":
      applyPatch(ctx, loaded, { priority: parseGroupValue(PrioritySchema, value, field) });
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

/** Multi-valued group move: gain `value`, lose `fromValue`, keep the rest. */
function withValue(current: string[], value: string | null, fromValue: string | null): string[] {
  const next = current.filter((id) => id !== fromValue);
  if (value !== null && !next.includes(value)) next.push(value);
  return next;
}

export function moveWorkItem(ctx: TesseraContext, id: string, input: MoveWorkItemInputType): WorkItem {
  const data = validateInput(MoveWorkItemInput, input);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    applyGroupChange(ctx, loaded, data);
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
    if (viaIntake) recordIntakeItem(ctx, targetProject, row, "mcp");
    return loadWorkItem(ctx, row.id);
  });
}

export const MoveWorkItemToProjectInput = z
  .object({
    project_id: IdSchema.describe("Project the item moves to."),
  })
  .strict();

export type MoveWorkItemToProjectInputType = z.input<typeof MoveWorkItemToProjectInput>;

function hasOpenIntakeItem(ctx: TesseraContext, itemId: string): boolean {
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
    if (viaIntake) recordIntakeItem(ctx, targetProject, after, "mcp");
    return loadWorkItem(ctx, id);
  });
}

// ---------------------------------------------------------------------------
// Archive, restore, delete
// ---------------------------------------------------------------------------

/** Archive only when the state group is completed or cancelled. */
export function archiveWorkItem(ctx: TesseraContext, id: string): WorkItem {
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    const stateRow = resolveState(ctx, loaded.project.id, loaded.item.state_id);
    if (stateRow.state_group !== "completed" && stateRow.state_group !== "cancelled") {
      throw rule("archive_open_item", `Only completed or cancelled work items can be archived ("${stateRow.name}" is ${stateRow.state_group})`);
    }
    const now = ctx.now();
    ctx.db.update(work_item).set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
    logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: id, work_item_id: id, verb: "archived", old_identifier: itemKey(loaded.project, loaded.item) });
    return loadWorkItem(ctx, id);
  });
}

export function unarchiveWorkItem(ctx: TesseraContext, id: string): WorkItem {
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id, { allowArchived: true });
    if (loaded.item.archived_at === null) throw rule("not_archived", `work item ${itemKey(loaded.project, loaded.item)} is not archived`);
    const now = ctx.now();
    ctx.db.update(work_item).set({ archived_at: null, updated_at: now, updated_by: ctx.actor.id }).where(eq(work_item.id, id)).run();
    logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: id, work_item_id: id, verb: "restored", new_identifier: itemKey(loaded.project, loaded.item) });
    return loadWorkItem(ctx, id);
  });
}

/** The item and every non-deleted descendant, parents first. */
function collectSubtree(ctx: TesseraContext, rootId: string): string[] {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = ctx.db
      .select({ id: work_item.id })
      .from(work_item)
      .where(and(inArray(work_item.parent_id, frontier), isNull(work_item.deleted_at)))
      .all()
      .map((row) => row.id);
    ids.push(...children);
    frontier = children;
  }
  return ids;
}

/**
 * Soft-deletes the item and its children recursively with their junction,
 * intake and FTS rows; works on archived items and on members of completed
 * or archived cycles (the cycle lock covers membership changes, not deletion).
 */
export function deleteWorkItem(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id, { allowArchived: true });
    const ids = collectSubtree(ctx, id);
    const keys = new Map(
      ctx.db
        .select({ id: work_item.id, sequence_id: work_item.sequence_id })
        .from(work_item)
        .where(inArray(work_item.id, ids))
        .all()
        .map((row) => [row.id, formatKey(loaded.project.identifier, row.sequence_id)]),
    );
    ctx.db.delete(work_item_label).where(inArray(work_item_label.work_item_id, ids)).run();
    ctx.db.delete(work_item_module).where(inArray(work_item_module.work_item_id, ids)).run();
    ctx.db.delete(work_item_assignee).where(inArray(work_item_assignee.work_item_id, ids)).run();
    ctx.db.delete(work_item_subscriber).where(inArray(work_item_subscriber.work_item_id, ids)).run();
    for (const itemId of ids) deleteWorkItemFts(ctx.sqlite, itemId);
    const now = ctx.now();
    const stamp = { deleted_at: now, updated_at: now, updated_by: ctx.actor.id };
    ctx.db.update(intake_item).set(stamp).where(and(inArray(intake_item.work_item_id, ids), isNull(intake_item.deleted_at))).run();
    ctx.db.update(work_item).set(stamp).where(inArray(work_item.id, ids)).run();
    for (const itemId of ids) {
      logActivity(ctx, { project_id: loaded.project.id, entity_type: ENTITY, entity_id: itemId, work_item_id: itemId, verb: "deleted", old_identifier: keys.get(itemId) ?? itemId });
    }
  });
}
