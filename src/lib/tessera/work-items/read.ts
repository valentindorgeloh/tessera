import { z } from "zod";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getActor } from "../actors";
import { latestSeq } from "../activity";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { isId } from "../core/ids";
import { normalizeIdentifier, parseKey } from "../core/keys";
import { cycle, moduleTable, project, view, work_item, work_item_assignee, work_item_module, work_item_subscriber } from "../db/schema";
import { buildOrder, buildWhere, groupItems } from "../filters";
import { getProjectRow, resolveRetiredIdentifier } from "../projects";
import { buildRichWhere } from "../rich-filters";
import { DEFAULT_DISPLAY, DisplaySchema, FiltersSchema, IdSchema, RichFiltersSchema } from "../schemas";
import type { Display, Filters, RichFilters } from "../types";
import { DisplayPatchSchema, mergeDisplay } from "../view-settings";
import { ENTITY, type WorkItem, type WorkItemDetail, type WorkItemListResult, getWorkItemRow } from "./model";
import { hydrate, itemQuery, listLinks, listSubscriberIds, loadWorkItem } from "./hydrate";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getWorkItem(ctx: TesseraContext, id: string): WorkItemDetail {
  const item = loadWorkItem(ctx, id);
  return { ...item, subscriber_ids: listSubscriberIds(ctx, id), links: listLinks(ctx, id) };
}

/**
 * By key (`WEB-12`, any case) or by id. A key with a project's former
 * identifier still resolves to the item under its current key unless another
 * project uses that identifier now (decision 29).
 */
export function getWorkItemByKey(ctx: TesseraContext, keyOrId: string): WorkItemDetail {
  const raw = keyOrId.trim();
  if (isId(raw)) return getWorkItem(ctx, raw);
  const parsed = parseKey(raw);
  if (!parsed) throw notFound(ENTITY, raw);
  const identifier = normalizeIdentifier(parsed.identifier);
  const live = ctx.db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.identifier, identifier), isNull(project.deleted_at)))
    .get();
  const projectId = live?.id ?? resolveRetiredIdentifier(ctx, identifier)?.id;
  if (projectId === undefined) throw notFound(ENTITY, raw);
  const row = ctx.db
    .select({ id: work_item.id })
    .from(work_item)
    .where(and(eq(work_item.project_id, projectId), eq(work_item.sequence_id, parsed.sequenceId), isNull(work_item.deleted_at)))
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
    rich_filters: RichFiltersSchema.nullable().optional().describe("Rich filter tree ANDed with filters. Replaces a view's saved tree; null clears it."),
    // A patch, not DisplaySchema.partial(): zod 4 would still apply the defaults and wipe a view's saved keys (A1).
    display: DisplayPatchSchema.optional().describe("Ordering, grouping and layout keys; omitted keys keep a view's saved display or the defaults."),
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
  /** Null when the list has no rich tree. A view uses its saved tree unless the caller passed one, including null to clear it. */
  rich_filters: RichFilters | null;
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
  const callerDisplay = data.display ?? {};
  const callerRich = data.rich_filters === undefined ? null : data.rich_filters;
  const base = { filters: callerFilters, display: mergeDisplay(DEFAULT_DISPLAY, callerDisplay), rich_filters: callerRich };
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
      const display = mergeDisplay(DisplaySchema.parse(row.display), callerDisplay);
      const stored = row.rich_filters === null ? null : RichFiltersSchema.parse(row.rich_filters);
      const rich_filters = data.rich_filters === undefined ? stored : data.rich_filters;
      if (row.project_id !== null) {
        return { filters, display, rich_filters, where: eq(work_item.project_id, row.project_id), project_ids: [row.project_id], project_id: row.project_id };
      }
      return { filters, display, rich_filters, where: LIVE_PROJECT, project_ids: liveProjectIds(ctx), project_id: null };
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
  const rich = scope.rich_filters === null ? undefined : buildRichWhere(ctx, scope.rich_filters, { today: ctx.today() });
  const where = and(scope.where, buildWhere(ctx, filters, { project_id: scope.project_id }), rich);
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
