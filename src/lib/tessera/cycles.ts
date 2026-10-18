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
 * Points follow the project's active estimate (as module progress does): the
 * snapshot keeps the items series and, with an active estimate, the points
 * series, and a returned progress says in `chart_mode` which one it serves.
 */
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { archived, locked, notFound, rule, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey } from "./core/keys";
import { lastSortOrder, sortOrderAfter, sortOrderForMove } from "./core/order";
import { addDays, isIsoDate, localDateOf } from "./core/time";
import { withTx } from "./core/tx";
import { assertNoOverlap, checkDates, dateIssue } from "./cycle-dates";
import { activeEstimateId, parsePointValue } from "./estimate-points";
import { cycle, estimate_point, project, state, work_item, work_item_assignee, work_item_label } from "./db/schema";
import { assertFeatureEnabled } from "./projects";
import { stripIdsFromSavedFilters } from "./saved-filters";
import { CycleProgressSchema, CycleStatusSchema, IdSchema, IsoDateSchema, ProgressModeSchema } from "./schemas";
import type { CycleProgress, CycleRow, CycleStatus, PointsCounts, ProgressBreakdownRow, ProgressCounts, ProgressMode, ProjectRow, StateGroup } from "./types";

/**
 * The list's progress summary: `total` items, of which `completed` and
 * `cancelled` (the same population as getCycleProgress), so a row can show
 * completed / (total - cancelled) like the progress panel.
 */
export type CycleProgressSummary = { total: number; completed: number; cancelled: number };

/**
 * List view model: the row plus the derived status, a (total, completed,
 * cancelled) progress summary and `open_count`, the live number of non-deleted members that are
 * neither completed nor cancelled (archived and triage members included),
 * which is exactly what transferCycleWorkItems would move. The row spread
 * includes the raw `progress_snapshot`; clients treat a cycle as frozen when
 * it is non-null and read progress only from `progress` / getCycleProgress.
 */
export type Cycle = CycleRow & { status: CycleStatus; progress: CycleProgressSummary; open_count: number };

/** Detail view model: the row plus the derived status, `open_count` and the full progress in issues mode (the snapshot once frozen). */
export type CycleDetail = Omit<Cycle, "progress"> & { progress: CycleProgress };

/** Alias of ProgressModeSchema kept for the existing imports. */
export const CycleProgressModeSchema = ProgressModeSchema;

export type CycleProgressMode = ProgressMode;

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
// Progress
// ---------------------------------------------------------------------------

type ProgressItem = {
  id: string;
  state_id: string;
  state_group: StateGroup;
  completed_at: string | null;
  /** Value of the item's point in the project's active estimate; null without an active estimate, without a point, or for an unusable value. */
  points: number | null;
};

export { activeEstimateId, parsePointValue };

/**
 * Every non-deleted item of the cycle outside triage, archived ones included
 * so finished work keeps counting. Points come only from non-deleted points
 * of `estimateId`.
 */
function loadProgressItems(ctx: TesseraContext, cycleId: string, estimateId: string | null): ProgressItem[] {
  const rows = ctx.db
    .select({
      id: work_item.id,
      state_id: work_item.state_id,
      state_group: state.state_group,
      completed_at: work_item.completed_at,
      point_estimate_id: estimate_point.estimate_id,
      point_value: estimate_point.value,
    })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .leftJoin(estimate_point, and(eq(work_item.estimate_point_id, estimate_point.id), isNull(estimate_point.deleted_at)))
    .where(and(eq(work_item.cycle_id, cycleId), isNull(work_item.deleted_at), ne(state.state_group, "triage")))
    .all();
  return rows.map((row) => ({
    id: row.id,
    state_id: row.state_id,
    state_group: row.state_group,
    completed_at: row.completed_at,
    points: estimateId !== null && row.point_estimate_id === estimateId ? parsePointValue(row.point_value) : null,
  }));
}

/** An item of a progress population, as the breakdowns need it. */
export type BreakdownItem = { id: string; state_group: StateGroup };

/** Assignee and label breakdowns of a progress population (shared with modules.ts). */
export type ProgressBreakdowns = {
  by_label: Record<string, number>;
  by_assignee: Record<string, number>;
  assignees: ProgressBreakdownRow[];
  labels: ProgressBreakdownRow[];
};

/**
 * One row per key with at least one item, sorted by total descending then id,
 * plus a last row with `id: null` for the items without any key (when there
 * are some). `completed` counts items in the completed group; an item with
 * two keys counts in both rows.
 */
function breakdownRows(items: readonly BreakdownItem[], pairs: readonly { work_item_id: string; key: string }[]): ProgressBreakdownRow[] {
  const groupOf = new Map(items.map((item) => [item.id, item.state_group]));
  const rows = new Map<string, { id: string; total: number; completed: number }>();
  const keyed = new Set<string>();
  for (const pair of pairs) {
    const group = groupOf.get(pair.work_item_id);
    if (group === undefined) continue;
    keyed.add(pair.work_item_id);
    const row = rows.get(pair.key) ?? { id: pair.key, total: 0, completed: 0 };
    row.total += 1;
    if (group === "completed") row.completed += 1;
    rows.set(pair.key, row);
  }
  const sorted: ProgressBreakdownRow[] = [...rows.values()].sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const none = { id: null, total: 0, completed: 0 };
  for (const item of items) {
    if (keyed.has(item.id)) continue;
    none.total += 1;
    if (item.state_group === "completed") none.completed += 1;
  }
  if (none.total > 0) sorted.push(none);
  return sorted;
}

function countsOf(rows: readonly ProgressBreakdownRow[]): Record<string, number> {
  return Object.fromEntries(rows.flatMap((row) => (row.id === null ? [] : [[row.id, row.total]])));
}

/** by_label / by_assignee item counts and the assignee and label rows over `items` (two junction queries). */
export function loadBreakdowns(ctx: TesseraContext, items: readonly BreakdownItem[]): ProgressBreakdowns {
  const itemIds = items.map((item) => item.id);
  const labelPairs =
    itemIds.length === 0
      ? []
      : ctx.db
          .select({ work_item_id: work_item_label.work_item_id, key: work_item_label.label_id })
          .from(work_item_label)
          .where(inArray(work_item_label.work_item_id, itemIds))
          .all();
  const assigneePairs =
    itemIds.length === 0
      ? []
      : ctx.db
          .select({ work_item_id: work_item_assignee.work_item_id, key: work_item_assignee.actor_id })
          .from(work_item_assignee)
          .where(inArray(work_item_assignee.work_item_id, itemIds))
          .all();
  const labels = breakdownRows(items, labelPairs);
  const assignees = breakdownRows(items, assigneePairs);
  return { by_label: countsOf(labels), by_assignee: countsOf(assignees), assignees, labels };
}

function emptyCounts(): ProgressCounts {
  return { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
}

function addToCounts(counts: PointsCounts, group: StateGroup, weight: number): void {
  // Triage items are filtered out of the population; the guard keeps the buckets summing to total should one slip through.
  if (group === "triage") return;
  counts.total += weight;
  counts[group] += weight;
}

/**
 * Pending work per day from start_date to min(end_date, today), inclusive,
 * each item weighing `weight(item)`. An item is pending on a day until the
 * local calendar date of its completed_at (the same calendar `today` uses) is
 * on or before that day; cancelled items are left out so the curve can reach
 * zero. Empty for drafts and upcoming cycles.
 */
function buildCompletionChart(items: ProgressItem[], range: DateRange, today: string, weight: (item: ProgressItem) => number): Record<string, number> {
  const chart: Record<string, number> = {};
  if (range.start_date === null || range.end_date === null) return chart;
  const lastDay = range.end_date < today ? range.end_date : today;
  const open = items.filter((item) => item.state_group !== "cancelled");
  for (let day = range.start_date; day <= lastDay; day = addDays(day, 1)) {
    let pending = 0;
    for (const item of open) {
      const doneByDay = item.completed_at !== null && localDateOf(item.completed_at) <= day;
      if (!doneByDay) pending += weight(item);
    }
    chart[day] = pending;
  }
  return chart;
}

/**
 * Live progress in its stored form: item counts, the breakdowns, the items
 * series as `completion_chart` and, only when the project has an active
 * estimate, `points` and the points series as `completion_chart_points`.
 * by_state / by_label / by_assignee and the breakdown rows are always item
 * counts. forMode turns it into a returned progress.
 */
function computeProgress(ctx: TesseraContext, row: CycleRow, today: string): CycleProgress {
  const estimateId = activeEstimateId(ctx, loadProject(ctx, row.project_id));
  const items = loadProgressItems(ctx, row.id, estimateId);
  const counts = emptyCounts();
  const points: PointsCounts = emptyCounts();
  const by_state: Record<string, number> = {};
  for (const item of items) {
    addToCounts(counts, item.state_group, 1);
    addToCounts(points, item.state_group, item.points ?? 0);
    by_state[item.state_id] = (by_state[item.state_id] ?? 0) + 1;
  }
  const breakdowns = loadBreakdowns(ctx, items);
  const progress: CycleProgress = {
    ...counts,
    by_state,
    by_label: breakdowns.by_label,
    by_assignee: breakdowns.by_assignee,
    assignees: breakdowns.assignees,
    labels: breakdowns.labels,
    completion_chart: buildCompletionChart(items, row, today, () => 1),
  };
  if (estimateId === null) return progress;
  return { ...progress, points, completion_chart_points: buildCompletionChart(items, row, today, (item) => item.points ?? 0) };
}

/**
 * A returned progress from the stored form: `chart_mode` always set and
 * `completion_chart_points` never present. Issues mode drops `points` and
 * serves the items series. Points mode keeps `points` when present and serves
 * the points series, falling back to the items series (`chart_mode: "issues"`)
 * when there is none (no active estimate, or a snapshot frozen before P3).
 */
function forMode(progress: CycleProgress, mode: ProgressMode): CycleProgress {
  const { completion_chart_points, points, ...rest } = progress;
  if (mode === "issues") return { ...rest, chart_mode: "issues" };
  const withPoints = points === undefined ? rest : { ...rest, points };
  if (completion_chart_points === undefined) return { ...withPoints, chart_mode: "issues" };
  return { ...withPoints, completion_chart: completion_chart_points, chart_mode: "points" };
}

/** The frozen progress parsed through its schema; null when absent or unreadable (then progress is computed live). */
function readSnapshot(row: CycleRow): CycleProgress | null {
  if (row.progress_snapshot === null) return null;
  const parsed = CycleProgressSchema.safeParse(row.progress_snapshot);
  return parsed.success ? parsed.data : null;
}

/** Stores the live progress in its stored form (both series, counts, points and breakdowns) as progress_snapshot when it is still null. */
function freezeSnapshot(ctx: TesseraContext, row: CycleRow): CycleRow {
  if (readSnapshot(row) !== null) return row;
  const snapshot = computeProgress(ctx, row, ctx.today());
  const now = ctx.now();
  return ctx.db
    .update(cycle)
    .set({ progress_snapshot: snapshot, updated_at: now, updated_by: ctx.actor.id })
    .where(eq(cycle.id, row.id))
    .returning()
    .get();
}

function progressOf(ctx: TesseraContext, row: CycleRow, mode: ProgressMode): CycleProgress {
  return forMode(readSnapshot(row) ?? computeProgress(ctx, row, ctx.today()), mode);
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

type LiveSummary = { progress: CycleProgressSummary; open_count: number };

function emptySummary(): CycleProgressSummary {
  return { total: 0, completed: 0, cancelled: 0 };
}

/**
 * One grouped query over every non-deleted member of the cycles: the live
 * (total, completed, cancelled) summary over the progress population (triage left out)
 * and `open_count` over all members (triage and archived included) that are
 * neither completed nor cancelled, the set a transfer moves.
 */
function loadLiveSummaries(ctx: TesseraContext, cycleIds: string[]): Map<string, LiveSummary> {
  const result = new Map(cycleIds.map((id) => [id, { progress: emptySummary(), open_count: 0 }]));
  if (cycleIds.length === 0) return result;
  const rows = ctx.db
    .select({ cycle_id: work_item.cycle_id, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(and(inArray(work_item.cycle_id, cycleIds), isNull(work_item.deleted_at)))
    .groupBy(work_item.cycle_id, state.state_group)
    .all();
  for (const row of rows) {
    const summary = row.cycle_id === null ? undefined : result.get(row.cycle_id);
    if (!summary) continue;
    if (!CLOSED_GROUPS.has(row.state_group)) summary.open_count += row.n;
    if (row.state_group === "triage") continue;
    summary.progress.total += row.n;
    if (row.state_group === "completed") summary.progress.completed += row.n;
    if (row.state_group === "cancelled") summary.progress.cancelled += row.n;
  }
  return result;
}

function toCycles(ctx: TesseraContext, rows: CycleRow[]): Cycle[] {
  const today = ctx.today();
  const live = loadLiveSummaries(ctx, rows.map((row) => row.id));
  return rows.map((row) => {
    const snapshot = readSnapshot(row);
    const summary = live.get(row.id) ?? { progress: emptySummary(), open_count: 0 };
    const progress = snapshot ? { total: snapshot.total, completed: snapshot.completed, cancelled: snapshot.cancelled } : summary.progress;
    return { ...row, status: deriveCycleStatus(row, today), progress, open_count: summary.open_count };
  });
}

function toCycleDetail(ctx: TesseraContext, row: CycleRow): CycleDetail {
  const open_count = loadLiveSummaries(ctx, [row.id]).get(row.id)?.open_count ?? 0;
  return { ...row, status: deriveCycleStatus(row, ctx.today()), open_count, progress: progressOf(ctx, row, "issues") };
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
    mode: CycleProgressModeSchema.default("issues").describe(
      "issues counts items; points also returns estimate point totals and the series in points when the project has an active estimate (chart_mode says which unit the series uses).",
    ),
  })
  .strict();

export type GetCycleProgressInputType = z.input<typeof GetCycleProgressInput>;

/** The frozen snapshot whenever it is non-null, otherwise the live progress, served in the requested mode with `chart_mode` set. */
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
    assertFeatureEnabled(loadWritableProject(ctx, data.project_id), "cycles");
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
    stripIdsFromSavedFilters(ctx, { key: "cycle", ids: new Set([id]), project_id: target.project_id });
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
