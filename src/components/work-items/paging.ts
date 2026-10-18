/**
 * Pure paging helpers for the work-items screen (decisions 112 to 114): page
 * sizes by layout, "Show more" labels, merging an extra page of a group or of
 * an ungrouped list into the loaded result, the plan `use-paged-list.ts`
 * re-requests expanded groups with after a refresh, and the bulk-selection text
 * for a list that is only partly loaded. No React, so Vitest covers it
 * (tests/ui/paging.test.ts).
 */
import { groupLimitKey } from "@/lib/tessera/core/group";
import { isIsoDate } from "@/lib/tessera/core/time";
import { WEEK_STARTS_ON, calendarWeeks, type WeekStart } from "./calendar-math";
import type { Display, Group, RichFilters, WorkItem, WorkItemListResult } from "@/lib/tessera/types";

/** Rows a first or "Show more" page of an ungrouped list, table or gantt holds (decision 112). */
export const ROW_PAGE = 200;
/** Cards per board column or lane cell. */
export const BOARD_GROUP_PAGE = 30;
/** Rows per list or table group. */
export const LIST_GROUP_PAGE = 50;
/** Items the calendar loads before it shows a banner. */
export const CALENDAR_CAP = 1000;
/** Loading key of the rows of an ungrouped list (the group keys are `groupLimitKey` values). */
export const UNGROUPED_KEY = "ungrouped";
/** The engine's `group_limits` caps: a value of at most 2000 rows, at most 100 entries. */
const MAX_LIMIT = 2000;
const MAX_ENTRIES = 100;
const MAX_ROWS = 5000;

/** Whether the layout pages per group. The gantt and the calendar read a flat list even when a grouping is set. */
export function pagesByGroup(display: Display): boolean {
  return display.group_by !== null && display.layout !== "gantt" && display.layout !== "calendar";
}

/** The paging keys of the first server page for a layout (decision 112). */
export function pageSizeFor(display: Display): { limit?: number; per_group_limit?: number } {
  if (pagesByGroup(display)) return { per_group_limit: display.layout === "board" ? BOARD_GROUP_PAGE : LIST_GROUP_PAGE };
  if (display.layout === "calendar") return { limit: CALENDAR_CAP };
  return { limit: ROW_PAGE };
}

/**
 * The first and last day the calendar shows around `?cal=` (any day inside the period, default today): the whole
 * weeks of a month, or the one week. The server loads only the items targeted in this window plus the unscheduled
 * ones (decision 112); the calendar draws items by target date only. `weekStartsOn` is the workspace `week_start`,
 * so the window matches the grid the client draws.
 */
export function calendarWindow(display: Display, cal: string | undefined, today: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): { from: string; to: string } {
  const anchor = cal !== undefined && isIsoDate(cal) ? cal : today;
  const weeks = calendarWeeks(anchor, display.calendar.layout, weekStartsOn, display.calendar.show_weekends);
  const first = weeks[0]?.[0] ?? anchor;
  const lastWeek = weeks[weeks.length - 1];
  return { from: first, to: lastWeek?.[lastWeek.length - 1] ?? anchor };
}

/** The paging keys of a loader's first read: `pageSizeFor`, plus the calendar's visible period (decision 112). */
export function listPaging(
  display: Display,
  cal: string | undefined,
  today: string,
  weekStartsOn: WeekStart = WEEK_STARTS_ON,
): { limit?: number; per_group_limit?: number; calendar_window?: { from: string; to: string } } {
  const size = pageSizeFor(display);
  return display.layout === "calendar" ? { ...size, calendar_window: calendarWindow(display, cal, today, weekStartsOn) } : size;
}

/**
 * The rich filter tree a paging request and an export send: the screen's explicit tree (a saved view's) when it has
 * one, else the URL's. A project, cycle, module or workspace list passes none, and its first page already applies
 * the URL tree, so "Show more" and the group re-request must send the same one.
 */
export function effectiveRichFilters(richFilters: RichFilters | null | undefined, urlRichFilters: RichFilters | null | undefined): RichFilters | null {
  return richFilters === undefined ? (urlRichFilters ?? null) : richFilters;
}

/** How many more rows a "Show more" click asks for. */
export function loadMoreSize(display: Display): number {
  if (pagesByGroup(display)) return display.layout === "board" ? BOARD_GROUP_PAGE : LIST_GROUP_PAGE;
  return ROW_PAGE;
}

export function showMoreLabel(loaded: number, total: number, step: number): string {
  const hidden = Math.max(0, total - loaded);
  const next = Math.min(step, hidden);
  return `Show ${next} more (${hidden} hidden)`;
}

/** Whether rows are still on the server: the footer renders only then. */
export function hasUnloaded(loaded: number, total: number): boolean {
  return loaded < total;
}

/** Loaded-of-total text for bulk selection and "Select all" (decision 114). */
export function loadedOfTotal(loaded: number, total: number): string {
  return `${loaded} loaded of ${total}`;
}

/** Row ids a selection of "all" can reach: the union of the loaded ids, once each. */
export function loadedIds(result: WorkItemListResult): string[] {
  return [...new Set(result.items.map((item) => item.id))];
}

function mergeItems(current: readonly WorkItem[], page: readonly WorkItem[]): WorkItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of page) byId.set(item.id, item);
  return [...byId.values()];
}

function appendIds(ids: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(ids);
  const next = [...ids];
  for (const id of added) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/** A group's page in a `group_value` response: the one group, or the cell inside it when `subGroupId` is set. */
function pageLeaf(page: WorkItemListResult, groupId: string, subGroupId?: string): Group | undefined {
  const group = page.groups?.find((candidate) => candidate.id === groupId);
  if (!group || subGroupId === undefined) return group;
  return group.sub_groups?.find((candidate) => candidate.id === subGroupId);
}

function mergeLeaf(group: Group, added: Group | undefined): Group {
  if (!added) return group;
  const item_ids = appendIds(group.item_ids, added.item_ids);
  // The page reports the group's count as of its own read. Judging "more" by the loaded length keeps Show more
  // reachable when a shifted page repeated a row, because the next request starts at the loaded length.
  const count = added.count;
  return { ...group, count, item_ids, has_more: item_ids.length < count };
}

/**
 * Merges one fetched page of a group (or lane cell) into the loaded result:
 * the new items join the union, the page's ids go to the end of the group's
 * loaded ids, and the group's count and `has_more` follow the page.
 */
export function mergeGroupPage(result: WorkItemListResult, groupId: string, page: WorkItemListResult, subGroupId?: string): WorkItemListResult {
  const added = pageLeaf(page, groupId, subGroupId);
  const groups = (result.groups ?? []).map((group) => {
    if (group.id !== groupId) return group;
    if (subGroupId === undefined) return mergeLeaf(group, added);
    const cells = (group.sub_groups ?? []).map((cell) => (cell.id === subGroupId ? mergeLeaf(cell, added) : cell));
    return {
      ...group,
      item_ids: appendIds(group.item_ids, added?.item_ids ?? []),
      has_more: cells.some((cell) => cell.has_more),
      sub_groups: cells,
    };
  });
  return { ...result, items: mergeItems(result.items, page.items), total: page.total, groups, has_more: groups.some((group) => group.has_more) };
}

/** Merges the next page of an ungrouped list (rows `offset` to `offset + limit`). */
export function mergeRowsPage(result: WorkItemListResult, page: WorkItemListResult): WorkItemListResult {
  const items = mergeItems(result.items, page.items);
  return { ...result, items, total: page.total, has_more: items.length < page.total };
}

/**
 * What the hook re-requests after a refresh (decision 112): the loaded result
 * shows which leaves were expanded, those holding more rows than a first page.
 * Grouped lists answer with `group_limits` (a board cell by its
 * `groupLimitKey`, a group without cells by its id), a flat list with `limit`.
 * Null when nothing was expanded, so the server's first page stands.
 */
export type RefetchPlan = { group_limits?: Record<string, number>; limit?: number };

export function refetchPlan(result: WorkItemListResult, display: Display): RefetchPlan | null {
  if (pagesByGroup(display)) {
    const first = loadMoreSize(display);
    const limits: Record<string, number> = {};
    for (const group of result.groups ?? []) {
      const leaves = group.sub_groups && group.sub_groups.length > 0 ? group.sub_groups.map((cell) => [groupLimitKey(group.id, cell.id), cell] as const) : [[group.id, group] as const];
      for (const [key, leaf] of leaves) {
        if (leaf.item_ids.length > first) limits[key] = Math.min(leaf.item_ids.length, MAX_LIMIT);
      }
    }
    const entries = Object.entries(limits);
    return entries.length === 0 ? null : { group_limits: Object.fromEntries(entries.slice(-MAX_ENTRIES)) };
  }
  const first = pageSizeFor(display).limit ?? ROW_PAGE;
  return result.items.length > first ? { limit: Math.min(result.items.length, MAX_ROWS) } : null;
}

/**
 * The result to show the moment a new server result arrives while groups are
 * expanded (decision 112). The server's first pages are fresh; the rows an
 * expanded group had loaded beyond its first page stay below them until the
 * re-request (`refetchPlan`) lands, so the list does not collapse, the scroll
 * position holds and a selection of those rows survives. Without an expanded
 * group the server result is returned as is.
 */
export function keepLoaded(server: WorkItemListResult, previous: WorkItemListResult, display: Display): WorkItemListResult {
  if (refetchPlan(previous, display) === null) return server;
  const known = new Map(previous.items.map((item) => [item.id, item]));
  const fresh = new Set(server.items.map((item) => item.id));
  const extra = new Map<string, WorkItem>();
  const keep = (ids: readonly string[]): string[] => {
    const kept = ids.filter((id) => known.has(id));
    for (const id of kept) {
      const item = known.get(id);
      if (item && !fresh.has(id)) extra.set(id, item);
    }
    return kept;
  };
  if (!pagesByGroup(display)) {
    const items = [...server.items, ...previous.items.filter((item) => !fresh.has(item.id))];
    return { ...server, items, has_more: items.length < server.total };
  }
  const first = loadMoreSize(display);
  const previousGroups = new Map((previous.groups ?? []).map((group) => [group.id, group]));
  const keepLeaf = (leaf: Group, was: Group | undefined): Group => {
    if (!was || was.item_ids.length <= first) return leaf;
    const item_ids = appendIds(leaf.item_ids, keep(was.item_ids));
    return { ...leaf, item_ids, has_more: item_ids.length < leaf.count };
  };
  const groups = (server.groups ?? []).map((group) => {
    const was = previousGroups.get(group.id);
    if (!group.sub_groups || group.sub_groups.length === 0) return keepLeaf(group, was);
    const wasCells = new Map((was?.sub_groups ?? []).map((cell) => [cell.id, cell]));
    const sub_groups = group.sub_groups.map((cell) => keepLeaf(cell, wasCells.get(cell.id)));
    return {
      ...group,
      item_ids: appendIds(group.item_ids, sub_groups.flatMap((cell) => cell.item_ids)),
      has_more: sub_groups.some((cell) => cell.has_more),
      sub_groups,
    };
  });
  return { ...server, items: [...server.items, ...extra.values()], groups, has_more: groups.some((group) => group.has_more) };
}
