/**
 * Filters and display (docs/contracts/service-api.md "Filters and display").
 * `buildWhere` turns `Filters` into one Drizzle `where` fragment over
 * `work_item`, `buildOrder` turns `Display.order_by` into `order by` terms and
 * `groupItems` buckets a loaded page of items by `Display.group_by` (and one
 * nested level of `sub_group_by`). Multi-valued fields (labels, assignees,
 * modules) put an item into every matching group plus a "none" group when it
 * has no value. counts.ts reuses the same three functions so numbers never
 * disagree between lists, badges and analytics.
 */
import { and, asc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TesseraContext } from "./core/context";
import { PRIORITY_RANK, parseOrderBy, type GroupBy, type OrderableField } from "./core/group";
import { addDays, addMonthsIso, localDateOf, localDayStart } from "./core/time";
import { searchWorkItemIds } from "./db/fts";
import {
  actor,
  cycle,
  estimate_point,
  label,
  mention,
  moduleTable,
  project,
  state,
  work_item,
  work_item_assignee,
  work_item_label,
  work_item_module,
  work_item_subscriber,
} from "./db/schema";
import { PrioritySchema, StateGroupSchema } from "./schemas";
import type { DateFilter, Display, Filters, PaletteColor, StateGroup, WorkItemRow } from "./types";

// ---------------------------------------------------------------------------
// Date filters
// ---------------------------------------------------------------------------

/** Upper bound for a full-text search inside a list query; the FTS helper defaults to 50 hits. */
const SEARCH_LIMIT = 100_000;

/** What a `DateFilter` means once relative tokens are resolved against today. `before` and `after` are strict; `between` is inclusive. */
export type ResolvedDateFilter = { op: "before"; date: string } | { op: "after"; date: string } | { op: "between"; from: string; to: string };

/** The day a relative token points at: today, one or two weeks ahead, or one month ahead. */
export function relativeDate(relative: NonNullable<DateFilter["relative"]>, today: string): string {
  switch (relative) {
    case "today":
      return today;
    case "1w":
      return addDays(today, 7);
    case "2w":
      return addDays(today, 14);
    case "1m":
      return addMonthsIso(today, 1);
  }
}

/**
 * Resolves a `DateFilter` to concrete bounds. A relative token wins over
 * from/to: `before`/`after` compare against the resolved day and `between`
 * spans today and that day. Returns null when the filter has no usable bound,
 * in which case `buildWhere` ignores it (a saved view must never fail to load).
 */
export function resolveDateFilter(filter: DateFilter, today: string): ResolvedDateFilter | null {
  if (filter.relative !== undefined) {
    const anchor = relativeDate(filter.relative, today);
    if (filter.op === "before") return { op: "before", date: anchor };
    if (filter.op === "after") return { op: "after", date: anchor };
    return anchor < today ? { op: "between", from: anchor, to: today } : { op: "between", from: today, to: anchor };
  }
  const op: DateFilter["op"] = filter.op;
  if (op === "before") {
    const date = filter.to ?? filter.from;
    return date === undefined ? null : { op, date };
  }
  if (op === "after") {
    const date = filter.from ?? filter.to;
    return date === undefined ? null : { op, date };
  }
  if (filter.from !== undefined && filter.to !== undefined) {
    return filter.from <= filter.to ? { op, from: filter.from, to: filter.to } : { op, from: filter.to, to: filter.from };
  }
  if (filter.from !== undefined) return { op: "after", date: addDays(filter.from, -1) };
  if (filter.to !== undefined) return { op: "before", date: addDays(filter.to, 1) };
  return null;
}

/** `YYYY-MM-DD` columns compare as text: `before` and `after` are strict, `between` is inclusive. */
function dateColumnCondition(column: SQLiteColumn, resolved: ResolvedDateFilter): SQL | undefined {
  if (resolved.op === "before") return lt(column, resolved.date);
  if (resolved.op === "after") return gt(column, resolved.date);
  return and(gte(column, resolved.from), lte(column, resolved.to));
}

/**
 * ISO timestamp columns are compared against the UTC instants that bound the
 * local calendar days, so "today" names the same day as ctx.today() whatever
 * the server's time zone (an item created at 00:30 local time was created today).
 */
function timestampColumnCondition(column: SQLiteColumn, resolved: ResolvedDateFilter): SQL | undefined {
  if (resolved.op === "before") return lt(column, localDayStart(resolved.date));
  if (resolved.op === "after") return gte(column, localDayStart(addDays(resolved.date, 1)));
  return and(gte(column, localDayStart(resolved.from)), lt(column, localDayStart(addDays(resolved.to, 1))));
}

export function dateCondition(column: SQLiteColumn, timestamp: boolean, filter: DateFilter | undefined, today: string): SQL | undefined {
  if (filter === undefined) return undefined;
  const resolved = resolveDateFilter(filter, today);
  if (resolved === null) return undefined;
  return timestamp ? timestampColumnCondition(column, resolved) : dateColumnCondition(column, resolved);
}

// ---------------------------------------------------------------------------
// Where
// ---------------------------------------------------------------------------

export type WhereOptions = {
  /** Narrows the full-text search to one project when the scope has exactly one. */
  project_id?: string | null;
  /** Items in the hidden triage state are excluded unless the filters target it by state or state_group, or this is true. */
  include_triage?: boolean;
};

const ACTIVE_GROUPS: StateGroup[] = ["unstarted", "started"];

export function stateIdsInGroups(ctx: TesseraContext, groups: StateGroup[]): SQL {
  return inArray(
    work_item.state_id,
    ctx.db
      .select({ id: state.id })
      .from(state)
      .where(inArray(state.state_group, groups)),
  );
}

export function hasAnyLabel(ctx: TesseraContext, ids: string[]): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(work_item_label)
      .where(and(eq(work_item_label.work_item_id, work_item.id), inArray(work_item_label.label_id, ids))),
  );
}

export function hasAnyModule(ctx: TesseraContext, ids: string[]): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(work_item_module)
      .where(and(eq(work_item_module.work_item_id, work_item.id), inArray(work_item_module.module_id, ids))),
  );
}

export function hasAnyAssignee(ctx: TesseraContext, ids: string[]): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(work_item_assignee)
      .where(and(eq(work_item_assignee.work_item_id, work_item.id), inArray(work_item_assignee.actor_id, ids))),
  );
}

export function hasAnySubscriber(ctx: TesseraContext, ids: string[]): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(work_item_subscriber)
      .where(and(eq(work_item_subscriber.work_item_id, work_item.id), inArray(work_item_subscriber.actor_id, ids))),
  );
}

export function mentionsAny(ctx: TesseraContext, ids: string[]): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(mention)
      .where(and(eq(mention.entity_type, "work_item"), eq(mention.entity_id, work_item.id), inArray(mention.actor_id, ids))),
  );
}

/** Full-text hits become an id list; no hit means no row (`1 = 0`). */
function matchesSearch(ctx: TesseraContext, q: string, projectId: string | null): SQL {
  const ids = searchWorkItemIds(ctx.sqlite, q, { project_id: projectId, limit: SEARCH_LIMIT });
  return ids.length === 0 ? sql`1 = 0` : inArray(work_item.id, ids);
}

function nonEmpty<T>(values: T[] | undefined): values is T[] {
  return values !== undefined && values.length > 0;
}

/**
 * One `where` fragment for `work_item` rows that match `filters`. Always
 * excludes soft-deleted rows; excludes archived rows unless
 * `filters.archived` is true; hides triage (intake) items unless targeted.
 */
export function buildWhere(ctx: TesseraContext, filters: Filters, options: WhereOptions = {}): SQL {
  const today = ctx.today();
  const parts: (SQL | undefined)[] = [isNull(work_item.deleted_at)];
  if (nonEmpty(filters.state)) parts.push(inArray(work_item.state_id, filters.state));
  if (nonEmpty(filters.state_group)) parts.push(stateIdsInGroups(ctx, filters.state_group));
  if (nonEmpty(filters.priority)) parts.push(inArray(work_item.priority, filters.priority));
  if (nonEmpty(filters.labels)) parts.push(hasAnyLabel(ctx, filters.labels));
  if (nonEmpty(filters.cycle)) parts.push(inArray(work_item.cycle_id, filters.cycle));
  if (nonEmpty(filters.module)) parts.push(hasAnyModule(ctx, filters.module));
  if (nonEmpty(filters.parent)) parts.push(inArray(work_item.parent_id, filters.parent));
  if (nonEmpty(filters.assignees)) parts.push(hasAnyAssignee(ctx, filters.assignees));
  if (nonEmpty(filters.created_by)) parts.push(inArray(work_item.created_by, filters.created_by));
  if (nonEmpty(filters.subscriber)) parts.push(hasAnySubscriber(ctx, filters.subscriber));
  if (nonEmpty(filters.mentions)) parts.push(mentionsAny(ctx, filters.mentions));
  if (nonEmpty(filters.project)) parts.push(inArray(work_item.project_id, filters.project));
  if (filters.search !== undefined && filters.search.trim() !== "") parts.push(matchesSearch(ctx, filters.search, options.project_id ?? null));
  parts.push(dateCondition(work_item.start_date, false, filters.start_date, today));
  parts.push(dateCondition(work_item.target_date, false, filters.target_date, today));
  parts.push(dateCondition(work_item.created_at, true, filters.created_at, today));
  parts.push(dateCondition(work_item.updated_at, true, filters.updated_at, today));
  parts.push(dateCondition(work_item.completed_at, true, filters.completed_at, today));
  if (filters.type === "active") parts.push(stateIdsInGroups(ctx, ACTIVE_GROUPS));
  if (filters.type === "backlog") parts.push(stateIdsInGroups(ctx, ["backlog"]));
  if (filters.sub_items === false) parts.push(isNull(work_item.parent_id));
  if (filters.archived !== true) parts.push(isNull(work_item.archived_at));
  if (filters.start_target_date === true) parts.push(and(isNotNull(work_item.start_date), isNotNull(work_item.target_date)));
  const targetsTriage = nonEmpty(filters.state) || (filters.state_group ?? []).includes("triage");
  if (!targetsTriage && options.include_triage !== true) {
    parts.push(
      sql`${work_item.state_id} NOT IN ${ctx.db
        .select({ id: state.id })
        .from(state)
        .where(eq(state.state_group, "triage"))}`,
    );
  }
  return and(...parts) ?? sql`1 = 1`;
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** Fields whose column can be NULL; those rows sort last in either direction. */
const NULLABLE_ORDER_FIELDS = new Set<OrderableField>(["start_date", "target_date", "estimate"]);

function priorityRank(): SQL {
  const branches = Object.entries(PRIORITY_RANK).map(([value, rank]) => sql`WHEN ${value} THEN ${rank}`);
  return sql`CASE ${work_item.priority} ${sql.join(branches, sql` `)} ELSE ${PRIORITY_RANK.none + 1} END`;
}

function orderExpression(field: OrderableField): SQL {
  switch (field) {
    case "sort_order":
      return sql`${work_item.sort_order}`;
    case "created_at":
      return sql`${work_item.created_at}`;
    case "updated_at":
      return sql`${work_item.updated_at}`;
    case "priority":
      return priorityRank();
    case "start_date":
      return sql`${work_item.start_date}`;
    case "target_date":
      return sql`${work_item.target_date}`;
    case "name":
      return sql`${work_item.name} COLLATE NOCASE`;
    case "sequence_id":
      return sql`${work_item.sequence_id}`;
    case "estimate":
      return sql`(SELECT ${estimate_point.position} FROM ${estimate_point} WHERE ${estimate_point.id} = ${work_item.estimate_point_id})`;
  }
}

/** `order by` terms for `display.order_by`, with the project-wide sort key and the sequence as tie-breakers. */
export function buildOrder(display: Display): SQL[] {
  const { field, direction } = parseOrderBy(display.order_by);
  const dir = direction === "asc" ? sql.raw("ASC") : sql.raw("DESC");
  const primary = NULLABLE_ORDER_FIELDS.has(field)
    ? sql`${orderExpression(field)} ${dir} NULLS LAST`
    : sql`${orderExpression(field)} ${dir}`;
  return [primary, asc(work_item.sort_order), asc(work_item.sequence_id)];
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** Id of the group holding items without a value for the grouped field. */
export const NONE_GROUP_ID = "none";

export type Group = {
  field: GroupBy;
  /** Raw group value (an id, an enum value or a date) or NONE_GROUP_ID. */
  id: string;
  name: string;
  color: PaletteColor | null;
  /** Items in the group. On a group-paged list (decision 113) this is the full count over the whole filtered set, not the loaded page. */
  count: number;
  /** Ids into the list's `items`; multi-valued fields repeat an id across groups. On a group-paged list only the loaded page. */
  item_ids: string[];
  /** True when the group holds more items than `item_ids` lists. Always false outside group paging (decision 113). */
  has_more: boolean;
  /** Sum of the numeric points estimates over the whole group; set only on a group-paged list whose items carry a points estimate (decision 113). */
  estimate_points?: number;
  sub_groups?: Group[];
};

/** What `groupItems` needs from an item; `WorkItem` satisfies it. */
export type GroupableItem = Pick<WorkItemRow, "id" | "project_id" | "state_id" | "priority" | "cycle_id" | "created_by" | "start_date" | "target_date" | "created_at"> & {
  label_ids: string[];
  module_ids: string[];
  assignee_ids: string[];
};

export type GroupOptions = {
  /** Projects whose states, labels, cycles and modules form the empty groups. */
  project_ids: string[];
};

type VocabEntry = { id: string; name: string; color: PaletteColor | null };

type Vocabulary = {
  states: VocabEntry[];
  stateGroupById: Map<string, StateGroup>;
  labels: VocabEntry[];
  modules: VocabEntry[];
  cycles: VocabEntry[];
  actors: VocabEntry[];
  projects: VocabEntry[];
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function loadStates(ctx: TesseraContext, projectIds: string[], items: GroupableItem[]): { entries: VocabEntry[]; groupById: Map<string, StateGroup> } {
  const referenced = unique(items.map((item) => item.state_id));
  const conditions: SQL[] = [];
  if (projectIds.length > 0) conditions.push(inArray(state.project_id, projectIds));
  if (referenced.length > 0) conditions.push(inArray(state.id, referenced));
  if (conditions.length === 0) return { entries: [], groupById: new Map() };
  const rows = ctx.db
    .select({ id: state.id, name: state.name, color: state.color, state_group: state.state_group })
    .from(state)
    .where(and(isNull(state.deleted_at), or(...conditions)))
    .orderBy(asc(state.project_id), asc(state.sort_order), asc(state.created_at))
    .all();
  return {
    entries: rows.map((row) => ({ id: row.id, name: row.name, color: row.color })),
    groupById: new Map(rows.map((row) => [row.id, row.state_group])),
  };
}

function loadLabels(ctx: TesseraContext, projectIds: string[]): VocabEntry[] {
  if (projectIds.length === 0) return [];
  return ctx.db
    .select({ id: label.id, name: label.name, color: label.color })
    .from(label)
    .where(and(inArray(label.project_id, projectIds), isNull(label.deleted_at)))
    .orderBy(asc(label.project_id), asc(label.sort_order), asc(label.created_at))
    .all();
}

function loadModules(ctx: TesseraContext, projectIds: string[]): VocabEntry[] {
  if (projectIds.length === 0) return [];
  return ctx.db
    .select({ id: moduleTable.id, name: moduleTable.name })
    .from(moduleTable)
    .where(and(inArray(moduleTable.project_id, projectIds), isNull(moduleTable.deleted_at)))
    .orderBy(asc(moduleTable.project_id), asc(moduleTable.sort_order), asc(moduleTable.created_at))
    .all()
    .map((row) => ({ ...row, color: null }));
}

function loadCycles(ctx: TesseraContext, projectIds: string[]): VocabEntry[] {
  if (projectIds.length === 0) return [];
  return ctx.db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(and(inArray(cycle.project_id, projectIds), isNull(cycle.deleted_at)))
    .orderBy(asc(cycle.project_id), asc(cycle.sort_order), asc(cycle.created_at))
    .all()
    .map((row) => ({ ...row, color: null }));
}

function loadActors(ctx: TesseraContext): VocabEntry[] {
  return ctx.db
    .select({ id: actor.id, name: actor.name, color: actor.color })
    .from(actor)
    .where(isNull(actor.deleted_at))
    .orderBy(asc(actor.name_key), asc(actor.created_at))
    .all();
}

function loadProjects(ctx: TesseraContext, projectIds: string[]): VocabEntry[] {
  if (projectIds.length === 0) return [];
  return ctx.db
    .select({ id: project.id, name: project.name, logo: project.logo })
    .from(project)
    .where(and(inArray(project.id, projectIds), isNull(project.deleted_at)))
    .orderBy(asc(project.sort_order), asc(project.name_key))
    .all()
    .map((row) => ({ id: row.id, name: row.name, color: row.logo?.color ?? null }));
}

/** Loads only the vocabularies the requested fields need. */
function loadVocabulary(ctx: TesseraContext, fields: GroupBy[], projectIds: string[], items: GroupableItem[]): Vocabulary {
  const needs = (...wanted: GroupBy[]) => wanted.some((field) => fields.includes(field));
  const states = needs("state", "state_group") ? loadStates(ctx, projectIds, items) : { entries: [], groupById: new Map<string, StateGroup>() };
  return {
    states: states.entries,
    stateGroupById: states.groupById,
    labels: needs("labels") ? loadLabels(ctx, projectIds) : [],
    modules: needs("module") ? loadModules(ctx, projectIds) : [],
    cycles: needs("cycle") ? loadCycles(ctx, projectIds) : [],
    actors: needs("assignees", "created_by") ? loadActors(ctx) : [],
    projects: needs("project") ? loadProjects(ctx, projectIds) : [],
  };
}

/** Group ids an item belongs to for `field`; multi-valued fields yield several, an empty value yields the none group. */
function groupKeys(item: GroupableItem, field: GroupBy, vocab: Vocabulary): string[] {
  switch (field) {
    case "state":
      return [item.state_id];
    case "state_group":
      return [vocab.stateGroupById.get(item.state_id) ?? NONE_GROUP_ID];
    case "priority":
      return [item.priority];
    case "labels":
      return item.label_ids.length > 0 ? item.label_ids : [NONE_GROUP_ID];
    case "assignees":
      return item.assignee_ids.length > 0 ? item.assignee_ids : [NONE_GROUP_ID];
    case "module":
      return item.module_ids.length > 0 ? item.module_ids : [NONE_GROUP_ID];
    case "cycle":
      return [item.cycle_id ?? NONE_GROUP_ID];
    case "created_by":
      return [item.created_by];
    case "start_date":
      return [item.start_date ?? NONE_GROUP_ID];
    case "target_date":
      return [item.target_date ?? NONE_GROUP_ID];
    case "created_at":
      return [localDateOf(item.created_at)];
    case "project":
      return [item.project_id];
  }
}

/** Fields whose "none" group exists even when empty (the field is optional on the item). */
const NONE_GROUP_FIELDS = new Set<GroupBy>(["labels", "assignees", "module", "cycle", "start_date", "target_date"]);

/** Ordered candidate groups for `field`: the vocabulary, or the distinct values present for date fields. */
function groupEntries(field: GroupBy, vocab: Vocabulary, items: GroupableItem[], showTriage: boolean): VocabEntry[] {
  switch (field) {
    case "state":
      return vocab.states.filter((entry) => showTriage || vocab.stateGroupById.get(entry.id) !== "triage");
    case "state_group":
      return StateGroupSchema.options
        .filter((group) => group !== "triage" || showTriage)
        .map((group) => ({ id: group, name: capitalize(group), color: null }));
    case "priority":
      return PrioritySchema.options.map((priority) => ({ id: priority, name: capitalize(priority), color: null }));
    case "labels":
      return vocab.labels;
    case "assignees":
    case "created_by":
      return vocab.actors;
    case "module":
      return vocab.modules;
    case "cycle":
      return vocab.cycles;
    case "project":
      return vocab.projects;
    case "start_date":
    case "target_date":
    case "created_at": {
      const dates = unique(items.flatMap((item) => groupKeys(item, field, vocab)).filter((key) => key !== NONE_GROUP_ID)).sort();
      return dates.map((date) => ({ id: date, name: date, color: null }));
    }
  }
}

function bucketItems(items: GroupableItem[], field: GroupBy, vocab: Vocabulary): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    for (const key of groupKeys(item, field, vocab)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item.id);
      else buckets.set(key, [item.id]);
    }
  }
  return buckets;
}

function buildGroups(items: GroupableItem[], field: GroupBy, vocab: Vocabulary, showEmpty: boolean): Group[] {
  const buckets = bucketItems(items, field, vocab);
  const triageUsed = field === "state_group" ? buckets.has("triage") : [...buckets.keys()].some((key) => vocab.stateGroupById.get(key) === "triage");
  const groups: Group[] = [];
  const seen = new Set<string>();
  for (const entry of groupEntries(field, vocab, items, triageUsed)) {
    seen.add(entry.id);
    const ids = buckets.get(entry.id) ?? [];
    if (ids.length === 0 && !showEmpty) continue;
    groups.push({ field, id: entry.id, name: entry.name, color: entry.color, count: ids.length, item_ids: ids, has_more: false });
  }
  // "none" is a real priority value, not the synthetic group; every other field may yield the none group.
  const noneCapable = field !== "priority";
  // Values outside the vocabulary (a deleted actor, a state of another project) keep their items visible under the raw id.
  for (const [key, ids] of buckets) {
    if (seen.has(key) || (noneCapable && key === NONE_GROUP_ID)) continue;
    groups.push({ field, id: key, name: key, color: null, count: ids.length, item_ids: ids, has_more: false });
  }
  const none = noneCapable ? (buckets.get(NONE_GROUP_ID) ?? []) : [];
  if (none.length > 0 || (showEmpty && NONE_GROUP_FIELDS.has(field))) {
    groups.push({ field, id: NONE_GROUP_ID, name: "None", color: null, count: none.length, item_ids: none, has_more: false });
  }
  return groups;
}

/**
 * Groups `items` by `display.group_by` (and nests `display.sub_group_by` one
 * level). Returns an empty list when `group_by` is null. Group order follows
 * the vocabulary (state and label sort order, priority rank, actor name,
 * dates ascending) with the none group last; `show_empty_groups` keeps groups
 * without items.
 */
export function groupItems(ctx: TesseraContext, items: GroupableItem[], display: Display, options: GroupOptions): Group[] {
  const field = display.group_by;
  if (field === null) return [];
  const subField: GroupBy | null = display.sub_group_by;
  const fields: GroupBy[] = subField === null ? [field] : [field, subField];
  const vocab = loadVocabulary(ctx, fields, options.project_ids, items);
  const groups = buildGroups(items, field, vocab, display.show_empty_groups);
  if (subField === null) return groups;
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const group of groups) {
    const members = group.item_ids.map((id) => byId.get(id)).filter((item): item is GroupableItem => item !== undefined);
    group.sub_groups = buildGroups(members, subField, vocab, display.show_empty_groups);
  }
  return groups;
}
