/**
 * Cycles (docs/contracts/service-api.md, schema.md "Cycles", plan decision 16).
 * A cycle is a dated window of work inside one project: both dates or none,
 * start <= end, and no two non-archived cycles of a project overlap. The
 * status (current / upcoming / completed / draft) is derived from the dates
 * and ctx.today(), never stored. Completed cycles are read-only except
 * reorder, archive, transfer and deleting a member work item (as in Plane);
 * archived cycles are read-only except unarchive, delete and deleting a
 * member. Live progress reflects such a deletion, a frozen snapshot does
 * not. A work item belongs to at most one cycle, so joining
 * a cycle replaces the previous one. `progress_snapshot` is frozen on the
 * first transfer out of a cycle (or at archive when still null) and served by
 * getCycleProgress whenever it is non-null. Progress counts the population
 * the cycle list shows plus archived members (finished work keeps counting);
 * items waiting in the hidden triage state are not accepted work and stay out.
 */
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, conflict, locked, notFound, rule, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { addDays, isIsoDate, localDateOf } from "./core/time";
import { withTx } from "./core/tx";
import { cycle, estimate_point, project, state, work_item, work_item_assignee, work_item_label } from "./db/schema";
import { CycleProgressSchema, CycleStatusSchema, IdSchema, IsoDateSchema } from "./schemas";
import type { CycleProgress, CycleRow, CycleStatus, ProgressCounts, ProjectRow, StateGroup } from "./types";

export type CycleProgressSummary = { total: number; completed: number };

/** List view model: the row plus the derived status and a two-number progress summary. */
export type Cycle = CycleRow & { status: CycleStatus; progress: CycleProgressSummary };

/** Detail view model: the row plus the derived status and the full progress (the snapshot once frozen). */
export type CycleDetail = Omit<Cycle, "progress"> & { progress: CycleProgress };

export const CycleProgressModeSchema = z.enum(["issues", "points"]);

export type CycleProgressMode = z.infer<typeof CycleProgressModeSchema>;

const CYCLE_NAME = z.string().trim().min(1).max(120);
const CYCLE_DESCRIPTION = z.string().max(100_000);
/** `YYYY-MM-DD` naming a real calendar day. */
const CycleDateSchema = IsoDateSchema.refine(isIsoDate, "not a calendar date");
const MAX_ITEMS_PER_CALL = 500;

/** Items in these groups are closed: they never join a cycle and a transfer leaves them behind. */
const CLOSED_GROUPS: ReadonlySet<StateGroup> = new Set<StateGroup>(["completed", "cancelled"]);

type DateRange = { start_date: string | null; end_date: string | null };

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** current / upcoming / completed / draft from the dates and `today`; draft means no dates. */
export function deriveCycleStatus(range: DateRange, today: string): CycleStatus {
  if (range.start_date === null || range.end_date === null) return "draft";
  if (today < range.start_date) return "upcoming";
  if (today > range.end_date) return "completed";
  return "current";
}

// ---------------------------------------------------------------------------
// Row helpers and guards
// ---------------------------------------------------------------------------

function loadProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = ctx.db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deleted_at)))
    .get();
  if (!row) throw notFound("project", projectId);
  return row;
}

/** Archived projects are read-only except unarchive and delete of the project itself. */
function loadWritableProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = loadProject(ctx, projectId);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  return row;
}

/** Non-deleted cycle row by id; NOT_FOUND otherwise. */
export function getCycleRow(ctx: TesseraContext, id: string): CycleRow {
  const row = ctx.db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, id), isNull(cycle.deleted_at)))
    .get();
  if (!row) throw notFound("cycle", id);
  return row;
}

function assertNotArchived(row: CycleRow): void {
  if (row.archived_at !== null) throw archived(`cycle "${row.name}" is archived`);
}

function assertNotCompleted(ctx: TesseraContext, row: CycleRow): void {
  if (deriveCycleStatus(row, ctx.today()) === "completed") throw locked(`cycle "${row.name}" is completed and read-only`);
}

/** A cycle open to ordinary edits: project writable, not archived, not completed. */
function loadEditableCycle(ctx: TesseraContext, id: string): { row: CycleRow; projectRow: ProjectRow } {
  const row = getCycleRow(ctx, id);
  const projectRow = loadWritableProject(ctx, row.project_id);
  assertNotArchived(row);
  assertNotCompleted(ctx, row);
  return { row, projectRow };
}

// ---------------------------------------------------------------------------
// Dates and overlap
// ---------------------------------------------------------------------------

function dateIssue(path: string, message: string): { code: "custom"; path: string[]; message: string }[] {
  return [{ code: "custom", path: [path], message }];
}

/** Both dates or none, and start_date <= end_date (VALIDATION). */
function checkDates(range: DateRange): void {
  const hasStart = range.start_date !== null;
  const hasEnd = range.end_date !== null;
  if (hasStart !== hasEnd) {
    const message = "start_date and end_date must be set together";
    throw validation(dateIssue(hasStart ? "end_date" : "start_date", message), `Invalid input: ${message}`);
  }
  if (range.start_date !== null && range.end_date !== null && range.start_date > range.end_date) {
    const message = "end_date must be on or after start_date";
    throw validation(dateIssue("end_date", message), `Invalid input: ${message}`);
  }
}

/** CONFLICT when a non-archived cycle of the project intersects `range` (inclusive at both ends). */
function assertNoOverlap(ctx: TesseraContext, projectId: string, range: DateRange, exceptId: string | null): void {
  if (range.start_date === null || range.end_date === null) return;
  const rows = ctx.db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(
      and(
        eq(cycle.project_id, projectId),
        isNull(cycle.deleted_at),
        isNull(cycle.archived_at),
        isNotNull(cycle.start_date),
        isNotNull(cycle.end_date),
        lte(cycle.start_date, range.end_date),
        gte(cycle.end_date, range.start_date),
        exceptId === null ? undefined : ne(cycle.id, exceptId),
      ),
    )
    .orderBy(asc(cycle.start_date))
    .all();
  if (rows.length > 0) {
    throw conflict(`The dates overlap cycle "${rows[0].name}"`, { ids: rows.map((row) => row.id) });
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

type ProgressItem = {
  id: string;
  state_id: string;
  state_group: StateGroup;
  completed_at: string | null;
  /** Numeric estimate_point.value; null when the item has no point or the value is not a number. */
  points: number | null;
};

function parsePoints(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Every non-deleted item of the cycle outside triage, archived ones included so finished work keeps counting. */
function loadProgressItems(ctx: TesseraContext, cycleId: string): ProgressItem[] {
  const rows = ctx.db
    .select({
      id: work_item.id,
      state_id: work_item.state_id,
      state_group: state.state_group,
      completed_at: work_item.completed_at,
      point_value: estimate_point.value,
    })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .leftJoin(estimate_point, eq(work_item.estimate_point_id, estimate_point.id))
    .where(and(eq(work_item.cycle_id, cycleId), isNull(work_item.deleted_at), ne(state.state_group, "triage")))
    .all();
  return rows.map((row) => ({
    id: row.id,
    state_id: row.state_id,
    state_group: row.state_group,
    completed_at: row.completed_at,
    points: parsePoints(row.point_value),
  }));
}

function countByLabel(ctx: TesseraContext, itemIds: string[]): Record<string, number> {
  if (itemIds.length === 0) return {};
  const rows = ctx.db
    .select({ key: work_item_label.label_id, n: count() })
    .from(work_item_label)
    .where(inArray(work_item_label.work_item_id, itemIds))
    .groupBy(work_item_label.label_id)
    .all();
  return Object.fromEntries(rows.map((row) => [row.key, row.n]));
}

function countByAssignee(ctx: TesseraContext, itemIds: string[]): Record<string, number> {
  if (itemIds.length === 0) return {};
  const rows = ctx.db
    .select({ key: work_item_assignee.actor_id, n: count() })
    .from(work_item_assignee)
    .where(inArray(work_item_assignee.work_item_id, itemIds))
    .groupBy(work_item_assignee.actor_id)
    .all();
  return Object.fromEntries(rows.map((row) => [row.key, row.n]));
}

function emptyCounts(): ProgressCounts {
  return { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
}

function addToCounts(counts: ProgressCounts, group: StateGroup, weight: number): void {
  // Triage items are filtered out of the population; the guard keeps the buckets summing to total should one slip through.
  if (group === "triage") return;
  counts.total += weight;
  counts[group] += weight;
}

function itemWeight(item: ProgressItem, mode: CycleProgressMode): number {
  return mode === "points" ? (item.points ?? 0) : 1;
}

/**
 * Pending work per day from start_date to min(end_date, today), inclusive.
 * An item is pending on a day until the local calendar date of its
 * completed_at (the same calendar `today` uses) is on or before that day;
 * cancelled items are left out so the curve can reach zero. Empty for drafts
 * and upcoming cycles.
 */
function buildCompletionChart(items: ProgressItem[], range: DateRange, today: string, mode: CycleProgressMode): Record<string, number> {
  const chart: Record<string, number> = {};
  if (range.start_date === null || range.end_date === null) return chart;
  const lastDay = range.end_date < today ? range.end_date : today;
  const open = items.filter((item) => item.state_group !== "cancelled");
  for (let day = range.start_date; day <= lastDay; day = addDays(day, 1)) {
    let pending = 0;
    for (const item of open) {
      const doneByDay = item.completed_at !== null && localDateOf(item.completed_at) <= day;
      if (!doneByDay) pending += itemWeight(item, mode);
    }
    chart[day] = pending;
  }
  return chart;
}

/**
 * Live progress with item counts, point totals and the completion chart in
 * `chartMode` units (items or points). by_state / by_label / by_assignee are
 * always item counts.
 */
function computeProgress(ctx: TesseraContext, row: CycleRow, today: string, chartMode: CycleProgressMode): CycleProgress {
  const items = loadProgressItems(ctx, row.id);
  const counts = emptyCounts();
  const points = emptyCounts();
  const by_state: Record<string, number> = {};
  for (const item of items) {
    addToCounts(counts, item.state_group, 1);
    addToCounts(points, item.state_group, item.points ?? 0);
    by_state[item.state_id] = (by_state[item.state_id] ?? 0) + 1;
  }
  const itemIds = items.map((item) => item.id);
  return {
    ...counts,
    by_state,
    by_label: countByLabel(ctx, itemIds),
    by_assignee: countByAssignee(ctx, itemIds),
    points,
    completion_chart: buildCompletionChart(items, row, today, chartMode),
  };
}

/** Issues mode hides the point totals; points mode returns them. */
function forMode(progress: CycleProgress, mode: CycleProgressMode): CycleProgress {
  if (mode === "points") return progress;
  const copy = { ...progress };
  delete copy.points;
  return copy;
}

/** The frozen progress parsed through its schema; null when absent or unreadable (then progress is computed live). */
function readSnapshot(row: CycleRow): CycleProgress | null {
  if (row.progress_snapshot === null) return null;
  const parsed = CycleProgressSchema.safeParse(row.progress_snapshot);
  return parsed.success ? parsed.data : null;
}

/** Stores the live progress (item chart plus point totals) as progress_snapshot when it is still null. */
function freezeSnapshot(ctx: TesseraContext, row: CycleRow): CycleRow {
  if (readSnapshot(row) !== null) return row;
  const snapshot = computeProgress(ctx, row, ctx.today(), "issues");
  const now = ctx.now();
  return ctx.db
    .update(cycle)
    .set({ progress_snapshot: snapshot, updated_at: now, updated_by: ctx.actor.id })
    .where(eq(cycle.id, row.id))
    .returning()
    .get();
}

function progressOf(ctx: TesseraContext, row: CycleRow, mode: CycleProgressMode): CycleProgress {
  const snapshot = readSnapshot(row);
  return forMode(snapshot ?? computeProgress(ctx, row, ctx.today(), mode), mode);
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/** One grouped query for the (total, completed) summary of cycles without a snapshot. */
function loadLiveSummaries(ctx: TesseraContext, cycleIds: string[]): Map<string, CycleProgressSummary> {
  const result = new Map(cycleIds.map((id) => [id, { total: 0, completed: 0 }]));
  if (cycleIds.length === 0) return result;
  const rows = ctx.db
    .select({ cycle_id: work_item.cycle_id, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(inArray(work_item.cycle_id, cycleIds), isNull(work_item.deleted_at), ne(state.state_group, "triage")))
    .groupBy(work_item.cycle_id, state.state_group)
    .all();
  for (const row of rows) {
    const summary = row.cycle_id === null ? undefined : result.get(row.cycle_id);
    if (!summary) continue;
    summary.total += row.n;
    if (row.state_group === "completed") summary.completed += row.n;
  }
  return result;
}

function toCycles(ctx: TesseraContext, rows: CycleRow[]): Cycle[] {
  const today = ctx.today();
  const snapshots = new Map(rows.map((row) => [row.id, readSnapshot(row)]));
  const live = loadLiveSummaries(
    ctx,
    rows.filter((row) => snapshots.get(row.id) === null).map((row) => row.id),
  );
  return rows.map((row) => {
    const snapshot = snapshots.get(row.id) ?? null;
    const progress = snapshot ? { total: snapshot.total, completed: snapshot.completed } : (live.get(row.id) ?? { total: 0, completed: 0 });
    return { ...row, status: deriveCycleStatus(row, today), progress };
  });
}

function toCycleDetail(ctx: TesseraContext, row: CycleRow): CycleDetail {
  return { ...row, status: deriveCycleStatus(row, ctx.today()), progress: progressOf(ctx, row, "issues") };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const ListCyclesInput = z
  .object({
    status: CycleStatusSchema.optional().describe("Only cycles with this derived status (current, upcoming, completed, draft)."),
    archived: z.boolean().optional().describe("true lists archived cycles only; default lists active ones."),
  })
  .strict();

export type ListCyclesInputType = z.input<typeof ListCyclesInput>;

/** Cycles of a project in display order with derived status and a progress summary; NOT_FOUND for an unknown project. */
export function listCycles(ctx: TesseraContext, projectId: string, input: ListCyclesInputType = {}): Cycle[] {
  const data = validateInput(ListCyclesInput, input);
  loadProject(ctx, projectId);
  const archivedFilter = data.archived === true ? isNotNull(cycle.archived_at) : isNull(cycle.archived_at);
  const rows = ctx.db
    .select()
    .from(cycle)
    .where(and(eq(cycle.project_id, projectId), isNull(cycle.deleted_at), archivedFilter))
    .orderBy(asc(cycle.sort_order), asc(cycle.created_at))
    .all();
  const cycles = toCycles(ctx, rows);
  return data.status === undefined ? cycles : cycles.filter((row) => row.status === data.status);
}

export function getCycle(ctx: TesseraContext, id: string): CycleDetail {
  return toCycleDetail(ctx, getCycleRow(ctx, id));
}

export const GetCycleProgressInput = z
  .object({
    mode: CycleProgressModeSchema.default("issues").describe("issues counts items; points also sums numeric estimate point values and draws the chart in points."),
  })
  .strict();

export type GetCycleProgressInputType = z.input<typeof GetCycleProgressInput>;

/** The frozen snapshot whenever it is non-null, otherwise the live progress in the requested mode. */
export function getCycleProgress(ctx: TesseraContext, id: string, input: GetCycleProgressInputType = {}): CycleProgress {
  const data = validateInput(GetCycleProgressInput, input);
  return progressOf(ctx, getCycleRow(ctx, id), data.mode);
}

/** Current (non-archived) cycles across non-archived projects, earliest start first, each with its full progress. */
export function getActiveCycles(ctx: TesseraContext): CycleDetail[] {
  const today = ctx.today();
  const liveProjects = ctx.db
    .select({ id: project.id })
    .from(project)
    .where(and(isNull(project.deleted_at), isNull(project.archived_at)));
  const rows = ctx.db
    .select()
    .from(cycle)
    .where(
      and(
        inArray(cycle.project_id, liveProjects),
        isNull(cycle.deleted_at),
        isNull(cycle.archived_at),
        lte(cycle.start_date, today),
        gte(cycle.end_date, today),
      ),
    )
    .orderBy(asc(cycle.start_date), asc(cycle.sort_order), asc(cycle.created_at))
    .all();
  return rows.map((row) => toCycleDetail(ctx, row));
}

// ---------------------------------------------------------------------------
// Create, update, reorder
// ---------------------------------------------------------------------------

export const CreateCycleInput = z
  .object({
    project_id: IdSchema.describe("Project the cycle belongs to."),
    name: CYCLE_NAME.describe("Cycle name; names do not need to be unique."),
    description_md: CYCLE_DESCRIPTION.optional().describe("Markdown description."),
    start_date: CycleDateSchema.nullable().optional().describe("First day, YYYY-MM-DD; set together with end_date or leave both empty for a draft."),
    end_date: CycleDateSchema.nullable().optional().describe("Last day, YYYY-MM-DD, on or after start_date; the range may not overlap another active cycle."),
  })
  .strict();

export type CreateCycleInputType = z.input<typeof CreateCycleInput>;

export function createCycle(ctx: TesseraContext, input: CreateCycleInputType): CycleDetail {
  const data = validateInput(CreateCycleInput, input);
  const range: DateRange = { start_date: data.start_date ?? null, end_date: data.end_date ?? null };
  checkDates(range);
  return withTx(ctx, () => {
    loadWritableProject(ctx, data.project_id);
    assertNoOverlap(ctx, data.project_id, range, null);
    const now = ctx.now();
    const row = ctx.db
      .insert(cycle)
      .values({
        id: newId(),
        project_id: data.project_id,
        name: data.name,
        description_md: data.description_md ?? "",
        start_date: range.start_date,
        end_date: range.end_date,
        sort_order: sortOrderAfter(lastSortOrder(ctx.db, cycle, and(eq(cycle.project_id, data.project_id), isNull(cycle.deleted_at)))),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: row.project_id, entity_type: "cycle", entity_id: row.id, verb: "created", new_identifier: row.name });
    return toCycleDetail(ctx, row);
  });
}

export const UpdateCycleInput = z
  .object({
    name: CYCLE_NAME.describe("New name."),
    description_md: CYCLE_DESCRIPTION.describe("New Markdown description."),
    start_date: CycleDateSchema.nullable().describe("New first day, or null to clear both dates (together with end_date)."),
    end_date: CycleDateSchema.nullable().describe("New last day, or null to clear both dates (together with start_date)."),
  })
  .partial()
  .strict();

export type UpdateCycleInputType = z.input<typeof UpdateCycleInput>;

const CYCLE_UPDATE_FIELDS = ["name", "description_md", "start_date", "end_date"] as const;

/** Field-scoped update; refused on completed (LOCKED) and archived (ARCHIVED) cycles. */
export function updateCycle(ctx: TesseraContext, id: string, patch: UpdateCycleInputType): CycleDetail {
  const data = validateInput(UpdateCycleInput, patch);
  return withTx(ctx, () => {
    const { row: before } = loadEditableCycle(ctx, id);
    const range: DateRange = {
      start_date: data.start_date === undefined ? before.start_date : data.start_date,
      end_date: data.end_date === undefined ? before.end_date : data.end_date,
    };
    checkDates(range);
    if (range.start_date !== before.start_date || range.end_date !== before.end_date) {
      assertNoOverlap(ctx, before.project_id, range, id);
    }
    const now = ctx.now();
    const after = ctx.db
      .update(cycle)
      .set({
        name: data.name ?? before.name,
        description_md: data.description_md ?? before.description_md,
        start_date: range.start_date,
        end_date: range.end_date,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(cycle.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: before.project_id, entity_type: "cycle", entity_id: id }, before, after, CYCLE_UPDATE_FIELDS, (field, value) =>
      field === "name" && typeof value === "string" ? value : null,
    );
    return toCycleDetail(ctx, after);
  });
}

export const ReorderCycleInput = z
  .object({
    before_id: IdSchema.optional().describe("Id of the cycle that will come directly before this one."),
    after_id: IdSchema.optional().describe("Id of the cycle that will come directly after this one."),
  })
  .strict()
  .refine((value) => value.before_id !== undefined || value.after_id !== undefined, { message: "before_id or after_id is required" });

export type ReorderCycleInputType = z.input<typeof ReorderCycleInput>;

/**
 * Moves the cycle among the project's non-archived cycles (the neighbours must
 * be active); allowed on completed cycles, refused on archived ones. The key
 * is chosen among every live cycle, archived ones included, so it stays unique
 * when an archived neighbour is restored later.
 */
export function reorderCycle(ctx: TesseraContext, id: string, input: ReorderCycleInputType): CycleDetail {
  const data = validateInput(ReorderCycleInput, input);
  return withTx(ctx, () => {
    const before = getCycleRow(ctx, id);
    loadWritableProject(ctx, before.project_id);
    assertNotArchived(before);
    const ordered = ctx.db
      .select({ id: cycle.id, sort_order: cycle.sort_order, archived_at: cycle.archived_at })
      .from(cycle)
      .where(and(eq(cycle.project_id, before.project_id), isNull(cycle.deleted_at)))
      .orderBy(asc(cycle.sort_order), asc(cycle.created_at))
      .all();
    const sortOrder = sortOrderForMove(ordered, id, data.before_id, data.after_id, "cycle");
    const now = ctx.now();
    const after = ctx.db
      .update(cycle)
      .set({ sort_order: sortOrder, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(cycle.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: before.project_id, entity_type: "cycle", entity_id: id }, before, after, ["sort_order"], () => before.name);
    return toCycleDetail(ctx, after);
  });
}

// ---------------------------------------------------------------------------
// Archive, restore, delete
// ---------------------------------------------------------------------------

/** Archives a cycle whose end_date has passed, freezing progress_snapshot first when it is still null. */
export function archiveCycle(ctx: TesseraContext, id: string): CycleDetail {
  return withTx(ctx, () => {
    const before = getCycleRow(ctx, id);
    loadWritableProject(ctx, before.project_id);
    assertNotArchived(before);
    if (deriveCycleStatus(before, ctx.today()) !== "completed") {
      throw rule("cycle_not_ended", `cycle "${before.name}" can only be archived after its end date`);
    }
    const frozen = freezeSnapshot(ctx, before);
    const now = ctx.now();
    const after = ctx.db
      .update(cycle)
      .set({ archived_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(cycle.id, frozen.id))
      .returning()
      .get();
    logActivity(ctx, { project_id: before.project_id, entity_type: "cycle", entity_id: id, verb: "archived", old_identifier: before.name });
    return toCycleDetail(ctx, after);
  });
}

/** Restores an archived cycle; its dates must still be free of overlaps (CONFLICT). The snapshot stays. */
export function unarchiveCycle(ctx: TesseraContext, id: string): CycleDetail {
  return withTx(ctx, () => {
    const before = getCycleRow(ctx, id);
    loadWritableProject(ctx, before.project_id);
    if (before.archived_at === null) throw rule("not_archived", `cycle "${before.name}" is not archived`);
    assertNoOverlap(ctx, before.project_id, before, id);
    const now = ctx.now();
    const after = ctx.db
      .update(cycle)
      .set({ archived_at: null, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(cycle.id, id))
      .returning()
      .get();
    logActivity(ctx, { project_id: before.project_id, entity_type: "cycle", entity_id: id, verb: "restored", new_identifier: before.name });
    return toCycleDetail(ctx, after);
  });
}

/**
 * Soft-deletes the cycle and detaches its work items (one activity row per
 * item). Allowed on archived cycles; a completed cycle must be archived first
 * (LOCKED).
 */
export function deleteCycle(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const target = getCycleRow(ctx, id);
    const projectRow = loadWritableProject(ctx, target.project_id);
    if (target.archived_at === null) assertNotCompleted(ctx, target);
    const ref: CycleRef = { id: target.id, name: target.name };
    for (const item of listCycleMembers(ctx, id, false)) moveItemToCycle(ctx, projectRow, item, ref, null);
    const now = ctx.now();
    ctx.db.update(cycle).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(cycle.id, id)).run();
    logActivity(ctx, { project_id: target.project_id, entity_type: "cycle", entity_id: id, verb: "deleted", old_identifier: target.name });
  });
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export const CycleWorkItemIdsInput = z.array(IdSchema).min(1).max(MAX_ITEMS_PER_CALL).describe("Work item ids (same project as the cycle).");

export type CycleWorkItemIdsInputType = z.input<typeof CycleWorkItemIdsInput>;

type MemberItem = {
  id: string;
  project_id: string;
  sequence_id: number;
  cycle_id: string | null;
  archived_at: string | null;
  state_group: StateGroup;
};

type CycleRef = { id: string; name: string };

const MEMBER_COLUMNS = {
  id: work_item.id,
  project_id: work_item.project_id,
  sequence_id: work_item.sequence_id,
  cycle_id: work_item.cycle_id,
  archived_at: work_item.archived_at,
  state_group: state.state_group,
};

/** Non-deleted items by id in the order given; NOT_FOUND for the first id that does not exist. */
function loadMemberItems(ctx: TesseraContext, ids: string[]): MemberItem[] {
  const rows = ctx.db
    .select(MEMBER_COLUMNS)
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(inArray(work_item.id, ids), isNull(work_item.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw notFound("work_item", id);
    return row;
  });
}

/** Non-deleted members of a cycle by sequence; `openOnly` keeps the items that are neither completed nor cancelled. */
function listCycleMembers(ctx: TesseraContext, cycleId: string, openOnly: boolean): MemberItem[] {
  const rows = ctx.db
    .select(MEMBER_COLUMNS)
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(eq(work_item.cycle_id, cycleId), isNull(work_item.deleted_at)))
    .orderBy(asc(work_item.sequence_id))
    .all();
  return openOnly ? rows.filter((row) => !CLOSED_GROUPS.has(row.state_group)) : rows;
}

/** Items only leave a completed or archived cycle through transfer (LOCKED / ARCHIVED otherwise). */
function assertSourceCyclesOpen(ctx: TesseraContext, cycleIds: string[]): void {
  const unique = [...new Set(cycleIds)];
  if (unique.length === 0) return;
  const rows = ctx.db
    .select()
    .from(cycle)
    .where(and(inArray(cycle.id, unique), isNull(cycle.deleted_at)))
    .all();
  for (const row of rows) {
    assertNotArchived(row);
    assertNotCompleted(ctx, row);
  }
}

/** Names of cycles by id for activity identifiers, whatever their state; a missing name falls back to the id. */
function loadCycleRefs(ctx: TesseraContext, ids: string[]): Map<string, CycleRef> {
  const unique = [...new Set(ids)];
  const refs = new Map(unique.map((id) => [id, { id, name: id }]));
  if (unique.length === 0) return refs;
  const rows = ctx.db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, unique)).all();
  for (const row of rows) refs.set(row.id, row);
  return refs;
}

/** Points `item` at `to` (or no cycle) and logs the change on the item and on both cycles. */
function moveItemToCycle(ctx: TesseraContext, projectRow: ProjectRow, item: MemberItem, from: CycleRef | null, to: CycleRef | null): void {
  const now = ctx.now();
  ctx.db
    .update(work_item)
    .set({ cycle_id: to?.id ?? null, updated_at: now, updated_by: ctx.actor.id })
    .where(eq(work_item.id, item.id))
    .run();
  const key = formatKey(projectRow.identifier, item.sequence_id);
  logActivity(ctx, {
    project_id: projectRow.id,
    entity_type: "work_item",
    entity_id: item.id,
    work_item_id: item.id,
    verb: "updated",
    field: "cycle_id",
    old_value: from?.id ?? null,
    new_value: to?.id ?? null,
    old_identifier: from?.name ?? null,
    new_identifier: to?.name ?? null,
  });
  if (from) {
    logActivity(ctx, { project_id: projectRow.id, entity_type: "cycle", entity_id: from.id, verb: "removed", old_value: item.id, old_identifier: key });
  }
  if (to) {
    logActivity(ctx, { project_id: projectRow.id, entity_type: "cycle", entity_id: to.id, verb: "added", new_value: item.id, new_identifier: key });
  }
}

/**
 * Adds items to the cycle, replacing the cycle they were in. Refused for items
 * of another project (RULE), archived items (ARCHIVED), completed or
 * cancelled items (RULE) and items that would leave a completed or archived
 * cycle (LOCKED / ARCHIVED); items already in the cycle are left untouched.
 */
export function addWorkItemsToCycle(ctx: TesseraContext, cycleId: string, ids: CycleWorkItemIdsInputType): CycleDetail {
  const data = validateInput(CycleWorkItemIdsInput, ids);
  return withTx(ctx, () => {
    const { row: target, projectRow } = loadEditableCycle(ctx, cycleId);
    const items = loadMemberItems(ctx, [...new Set(data)]);
    for (const item of items) {
      const key = formatKey(projectRow.identifier, item.sequence_id);
      if (item.project_id !== target.project_id) throw rule("cycle_project_mismatch", `work item ${item.id} belongs to another project`);
      if (item.archived_at !== null) throw archived(`work item ${key} is archived`);
      if (CLOSED_GROUPS.has(item.state_group)) throw rule("work_item_closed", `work item ${key} is ${item.state_group} and cannot join a cycle`);
    }
    const moving = items.filter((item) => item.cycle_id !== target.id);
    const fromIds = moving.flatMap((item) => (item.cycle_id === null ? [] : [item.cycle_id]));
    assertSourceCyclesOpen(ctx, fromIds);
    const refs = loadCycleRefs(ctx, fromIds);
    const to: CycleRef = { id: target.id, name: target.name };
    for (const item of moving) {
      const from = item.cycle_id === null ? null : (refs.get(item.cycle_id) ?? null);
      moveItemToCycle(ctx, projectRow, item, from, to);
    }
    return toCycleDetail(ctx, target);
  });
}

/** Removes the given items from the cycle; items that are not members are skipped, unknown ids are NOT_FOUND. */
export function removeWorkItemsFromCycle(ctx: TesseraContext, cycleId: string, ids: CycleWorkItemIdsInputType): CycleDetail {
  const data = validateInput(CycleWorkItemIdsInput, ids);
  return withTx(ctx, () => {
    const { row: target, projectRow } = loadEditableCycle(ctx, cycleId);
    const from: CycleRef = { id: target.id, name: target.name };
    for (const item of loadMemberItems(ctx, [...new Set(data)])) {
      if (item.cycle_id === target.id) moveItemToCycle(ctx, projectRow, item, from, null);
    }
    return toCycleDetail(ctx, target);
  });
}

export const TransferCycleWorkItemsInput = z
  .object({
    to_cycle_id: IdSchema.nullable().describe("Cycle (same project, not completed or archived) that receives the open items, or null to send them back to no cycle."),
  })
  .strict();

export type TransferCycleWorkItemsInputType = z.input<typeof TransferCycleWorkItemsInput>;

/**
 * Moves the items of a completed cycle that are neither completed nor
 * cancelled to `to_cycle_id` (or to no cycle) and freezes the source's
 * progress_snapshot the first time. The source must be completed (RULE
 * cycle_not_completed) so the snapshot never freezes a running cycle.
 */
export function transferCycleWorkItems(ctx: TesseraContext, fromCycleId: string, input: TransferCycleWorkItemsInputType): { moved: number } {
  const data = validateInput(TransferCycleWorkItemsInput, input);
  return withTx(ctx, () => {
    const source = getCycleRow(ctx, fromCycleId);
    const projectRow = loadWritableProject(ctx, source.project_id);
    assertNotArchived(source);
    if (deriveCycleStatus(source, ctx.today()) !== "completed") {
      throw rule("cycle_not_completed", `cycle "${source.name}" has not ended; only completed cycles transfer their open items`);
    }
    let to: CycleRef | null = null;
    if (data.to_cycle_id !== null) {
      if (data.to_cycle_id === fromCycleId) {
        throw validation(dateIssue("to_cycle_id", "to_cycle_id must differ from the source cycle"), "Invalid input: to_cycle_id must differ from the source cycle");
      }
      const target = getCycleRow(ctx, data.to_cycle_id);
      if (target.project_id !== source.project_id) throw rule("cycle_project_mismatch", `cycle "${target.name}" belongs to another project`);
      assertNotArchived(target);
      assertNotCompleted(ctx, target);
      to = { id: target.id, name: target.name };
    }
    freezeSnapshot(ctx, source);
    const from: CycleRef = { id: source.id, name: source.name };
    const open = listCycleMembers(ctx, source.id, true);
    for (const item of open) moveItemToCycle(ctx, projectRow, item, from, to);
    return { moved: open.length };
  });
}
