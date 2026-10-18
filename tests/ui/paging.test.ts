/**
 * Pure client logic of list paging (decisions 112 to 114): page sizes by
 * layout, "Show more" text and footer state, merging fetched pages into the
 * loaded result, the re-request plan after a refresh, keeping expanded rows
 * across a refresh, and optimistic edits and moves on a list whose groups hold
 * only their first rows.
 */
import { describe, expect, it } from "vitest";
import { reduceOptimisticList } from "@/components/work-items/optimistic-list";
import {
  CALENDAR_CAP,
  calendarWindow,
  effectiveRichFilters,
  hasUnloaded,
  listPaging,
  keepLoaded,
  loadMoreSize,
  loadedIds,
  loadedOfTotal,
  mergeGroupPage,
  mergeRowsPage,
  pageSizeFor,
  pagesByGroup,
  refetchPlan,
  showMoreLabel,
} from "@/components/work-items/paging";
import { groupLimitKey } from "@/lib/tessera/core/group";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Group, RichFilters, State, StateGroup, WorkItem, WorkItemListResult } from "@/lib/tessera/types";

const noStates: ReadonlyMap<StateGroup, State> = new Map();
const stateGroupOf = () => undefined;

function item(id: string, priority: WorkItem["priority"] = "high", overrides: Partial<WorkItem> = {}): WorkItem {
  return { id, name: id, priority, state_id: "s1", label_ids: [], module_ids: [], assignee_ids: [], cycle_id: null, ...overrides } as WorkItem;
}

/** `n` ids `<prefix>1`..`<prefix>n`. */
function ids(prefix: string, n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, index) => `${prefix}${from + index}`);
}

function group(id: string, itemIds: string[], count: number, subGroups?: Group[]): Group {
  return { field: "priority", id, name: id, color: null, count, item_ids: itemIds, has_more: itemIds.length < count, sub_groups: subGroups };
}

function listOf(groups: Group[], total: number, priorityOf: (id: string) => WorkItem["priority"] = () => "high"): WorkItemListResult {
  const seen = new Set<string>();
  const items: WorkItem[] = [];
  for (const g of groups) {
    for (const id of g.item_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(item(id, priorityOf(id)));
    }
  }
  return { items, total, cursor: 1, groups, has_more: groups.some((g) => g.has_more) } as WorkItemListResult;
}

const grouped = (layout: Display["layout"] = "list"): Display => ({ ...DEFAULT_DISPLAY, layout, group_by: "priority" });
const flat = (layout: Display["layout"] = "list"): Display => ({ ...DEFAULT_DISPLAY, layout, group_by: null });

describe("page sizes", () => {
  it("pages per group for a grouped list, board and table and by rows otherwise", () => {
    expect(pageSizeFor(grouped("list"))).toEqual({ per_group_limit: 50 });
    expect(pageSizeFor(grouped("table"))).toEqual({ per_group_limit: 50 });
    expect(pageSizeFor(grouped("board"))).toEqual({ per_group_limit: 30 });
    expect(pageSizeFor(flat("list"))).toEqual({ limit: 200 });
    expect(pageSizeFor(flat("board"))).toEqual({ limit: 200 });
    expect(pageSizeFor(flat("table"))).toEqual({ limit: 200 });
    expect(pageSizeFor(flat("gantt"))).toEqual({ limit: 200 });
    expect(pageSizeFor(flat("calendar"))).toEqual({ limit: CALENDAR_CAP });
  });

  it("reads the gantt and the calendar as flat rows even when a grouping is saved", () => {
    expect(pagesByGroup(grouped("gantt"))).toBe(false);
    expect(pageSizeFor(grouped("gantt"))).toEqual({ limit: 200 });
    expect(pageSizeFor(grouped("calendar"))).toEqual({ limit: 1000 });
  });

  it("asks for one more page of the same size", () => {
    expect(loadMoreSize(grouped("list"))).toBe(50);
    expect(loadMoreSize(grouped("board"))).toBe(30);
    expect(loadMoreSize(flat("table"))).toBe(200);
  });
});

describe("calendar period and rich filters", () => {
  const month: Display = { ...DEFAULT_DISPLAY, layout: "calendar" };
  const week: Display = { ...month, calendar: { layout: "week", show_weekends: true } };

  it("windows the whole weeks of the month around ?cal= (Monday first), default today", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(calendarWindow(month, "2026-10-14", "2026-01-01")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(calendarWindow(month, undefined, "2026-10-10")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(calendarWindow(month, "not-a-date", "2026-10-10")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });

  it("windows one week in the week layout and skips weekend columns in the bounds", () => {
    expect(calendarWindow(week, "2026-10-14", "2026-01-01")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    const weekdays: Display = { ...week, calendar: { layout: "week", show_weekends: false } };
    expect(calendarWindow(weekdays, "2026-10-14", "2026-01-01")).toEqual({ from: "2026-10-12", to: "2026-10-16" });
  });

  it("follows the workspace week start so the window matches the grid", () => {
    expect(calendarWindow(month, "2026-10-14", "2026-01-01", 0)).toEqual({ from: "2026-09-27", to: "2026-10-31" });
    expect(calendarWindow(week, "2026-10-14", "2026-01-01", 0)).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    // January 2026 starts on a Thursday: a Sunday start reaches back to Dec 28 and stops at Sat Jan 31.
    expect(calendarWindow(week, "2026-01-07", "2026-01-01", 0)).toEqual({ from: "2026-01-04", to: "2026-01-10" });
    expect(calendarWindow(month, "2026-01-07", "2026-01-01", 0)).toEqual({ from: "2025-12-28", to: "2026-01-31" });
    expect(listPaging(month, "2026-10-14", "2026-10-10", 0)).toEqual({ limit: CALENDAR_CAP, calendar_window: { from: "2026-09-27", to: "2026-10-31" } });
  });

  it("sends the window only for the calendar", () => {
    expect(listPaging(month, "2026-10-14", "2026-10-10")).toEqual({ limit: CALENDAR_CAP, calendar_window: { from: "2026-09-28", to: "2026-11-01" } });
    expect(listPaging({ ...DEFAULT_DISPLAY, layout: "table", group_by: null }, "2026-10-14", "2026-10-10")).toEqual({ limit: 200 });
  });

  it("falls back to the URL rich filters unless the screen has its own tree", () => {
    const tree = { op: "and", conditions: [] } as unknown as RichFilters;
    const other = { op: "or", conditions: [] } as unknown as RichFilters;
    expect(effectiveRichFilters(undefined, tree)).toBe(tree);
    expect(effectiveRichFilters(undefined, undefined)).toBeNull();
    expect(effectiveRichFilters(null, tree)).toBeNull();
    expect(effectiveRichFilters(other, tree)).toBe(other);
  });
});

describe("footer state and text", () => {
  it("names the next page and the hidden remainder", () => {
    expect(showMoreLabel(50, 120, 50)).toBe("Show 50 more (70 hidden)");
    expect(showMoreLabel(100, 120, 50)).toBe("Show 20 more (20 hidden)");
    expect(showMoreLabel(120, 120, 50)).toBe("Show 0 more (0 hidden)");
  });

  it("shows the footer only while rows are unloaded", () => {
    expect(hasUnloaded(50, 120)).toBe(true);
    expect(hasUnloaded(120, 120)).toBe(false);
    expect(hasUnloaded(130, 120)).toBe(false);
  });

  it("says how much of the list a selection can reach", () => {
    expect(loadedOfTotal(50, 120)).toBe("50 loaded of 120");
  });

  it("counts a row once when a multi-valued grouping lists it in several groups", () => {
    const result = listOf([group("high", ["a", "b"], 2), group("low", ["b", "c"], 2)], 3);
    expect(loadedIds(result)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeGroupPage", () => {
  const first = listOf([group("high", ids("h", 50), 120), group("low", ids("l", 10), 10)], 130);

  it("appends the page to its group and keeps the others", () => {
    const page = listOf([group("high", ids("h", 50, 51), 120)], 130);
    const next = mergeGroupPage(first, "high", page);
    const high = next.groups?.find((g) => g.id === "high");
    expect(high?.item_ids).toHaveLength(100);
    expect(high?.item_ids.at(-1)).toBe("h100");
    expect(high?.count).toBe(120);
    expect(high?.has_more).toBe(true);
    expect(next.groups?.find((g) => g.id === "low")).toBe(first.groups?.[1]);
    expect(next.items).toHaveLength(110);
    expect(next.has_more).toBe(true);
  });

  it("clears has_more on the last page and on the result", () => {
    const page = listOf([group("high", ids("h", 70, 51), 120)], 130);
    const next = mergeGroupPage(first, "high", page);
    expect(next.groups?.[0]?.item_ids).toHaveLength(120);
    expect(next.groups?.[0]?.has_more).toBe(false);
    expect(next.has_more).toBe(false);
  });

  it("does not repeat a row a shifted page returned twice, and keeps Show more reachable", () => {
    const page = listOf([group("high", ["h50", ...ids("h", 49, 51)], 120)], 130);
    const next = mergeGroupPage(first, "high", page);
    const high = next.groups?.[0];
    expect(high?.item_ids).toHaveLength(99);
    expect(new Set(high?.item_ids).size).toBe(99);
    expect(high?.has_more).toBe(true);
  });

  it("takes the fresher count and total from the page", () => {
    const page = listOf([group("high", ids("h", 50, 51), 118)], 128);
    const next = mergeGroupPage(first, "high", page);
    expect(next.groups?.[0]?.count).toBe(118);
    expect(next.total).toBe(128);
  });

  it("merges the page of one lane cell and rolls has_more up to its column", () => {
    const cell = (id: string, itemIds: string[], count: number): Group => ({ ...group(id, itemIds, count), field: "state" });
    const board = listOf(
      [
        group("high", [...ids("a", 30), ...ids("b", 5)], 80, [cell("s1", ids("a", 30), 60), cell("s2", ids("b", 5), 20)]),
        group("low", ids("c", 3), 3, [cell("s1", ids("c", 3), 3), cell("s2", [], 0)]),
      ],
      83,
    );
    const page = listOf([group("high", ids("a", 30, 31), 80, [cell("s1", ids("a", 30, 31), 60)])], 83);
    const next = mergeGroupPage(board, "high", page, "s1");
    const high = next.groups?.[0];
    const s1 = high?.sub_groups?.find((sub) => sub.id === "s1");
    expect(s1?.item_ids).toHaveLength(60);
    expect(s1?.has_more).toBe(false);
    expect(high?.sub_groups?.find((sub) => sub.id === "s2")?.item_ids).toHaveLength(5);
    expect(high?.item_ids).toHaveLength(65);
    // The other cell (5 of 20 loaded) still has more, so the column does too.
    expect(high?.has_more).toBe(true);
    expect(next.groups?.[1]).toBe(board.groups?.[1]);
  });

  it("leaves the result alone when the page does not carry the group", () => {
    const next = mergeGroupPage(first, "high", { items: [], total: 130, groups: [], cursor: 1 } as WorkItemListResult);
    expect(next.groups?.[0]).toBe(first.groups?.[0]);
  });
});

describe("mergeRowsPage", () => {
  it("appends rows of an ungrouped list and ends at the total", () => {
    const first = { items: ids("r", 200).map((id) => item(id)), total: 450, cursor: 1, has_more: true } as WorkItemListResult;
    const second = mergeRowsPage(first, { items: ids("r", 200, 201).map((id) => item(id)), total: 450, cursor: 1, has_more: true } as WorkItemListResult);
    expect(second.items).toHaveLength(400);
    expect(second.has_more).toBe(true);
    const third = mergeRowsPage(second, { items: ids("r", 50, 401).map((id) => item(id)), total: 450, cursor: 1, has_more: false } as WorkItemListResult);
    expect(third.items).toHaveLength(450);
    expect(third.has_more).toBe(false);
  });
});

describe("refetchPlan", () => {
  it("is null while no group holds more than its first page", () => {
    expect(refetchPlan(listOf([group("high", ids("h", 50), 120)], 120), grouped())).toBeNull();
    expect(refetchPlan({ items: ids("r", 200).map((id) => item(id)), total: 450, cursor: 1 } as WorkItemListResult, flat())).toBeNull();
  });

  it("asks for each expanded group up to its loaded length in one call", () => {
    const result = listOf([group("high", ids("h", 100), 120), group("low", ids("l", 50), 80), group("none", ids("n", 3), 3)], 203);
    expect(refetchPlan(result, grouped())).toEqual({ group_limits: { high: 100 } });
  });

  it("keys a board cell by group and sub-group and ignores the unexpanded cells", () => {
    const cell = (id: string, n: number): Group => ({ ...group(id, ids(id, n), 90), field: "state" });
    const result = listOf([group("high", ids("x", 60), 180, [cell("s1", 60), cell("s2", 30)])], 180);
    expect(refetchPlan(result, { ...grouped("board"), sub_group_by: "state" })).toEqual({ group_limits: { [groupLimitKey("high", "s1")]: 60 } });
  });

  it("caps a limit at the engine's 2000 and the entries at 100", () => {
    const big = listOf([group("high", ids("h", 2500), 3000)], 3000);
    expect(refetchPlan(big, grouped())).toEqual({ group_limits: { high: 2000 } });
    const many = listOf(
      Array.from({ length: 120 }, (_, index) => group(`g${index}`, ids(`g${index}-`, 51), 80)),
      9600,
    );
    expect(Object.keys(refetchPlan(many, grouped())?.group_limits ?? {})).toHaveLength(100);
  });

  it("re-requests a flat list by its loaded rows", () => {
    const result = { items: ids("r", 400).map((id) => item(id)), total: 900, cursor: 1, has_more: true } as WorkItemListResult;
    expect(refetchPlan(result, flat("table"))).toEqual({ limit: 400 });
  });
});

describe("keepLoaded", () => {
  it("keeps the rows an expanded group had loaded below the server's fresh first page", () => {
    const previous = listOf([group("high", ids("h", 100), 120)], 120);
    const server = listOf([group("high", ids("h", 50), 119)], 119);
    const shown = keepLoaded(server, previous, grouped());
    const high = shown.groups?.[0];
    expect(high?.item_ids).toHaveLength(100);
    expect(high?.count).toBe(119);
    expect(high?.has_more).toBe(true);
    expect(shown.items).toHaveLength(100);
    expect(shown.total).toBe(119);
  });

  it("takes the server's fresh copy of a row both lists hold", () => {
    const previous = listOf([group("high", ids("h", 100), 120)], 120);
    const server = listOf([group("high", ids("h", 50), 120)], 120);
    server.items[0] = item("h1", "high", { name: "renamed" });
    const shown = keepLoaded(server, previous, grouped());
    expect(shown.items.find((entry) => entry.id === "h1")?.name).toBe("renamed");
  });

  it("returns the server result when nothing was expanded", () => {
    const previous = listOf([group("high", ids("h", 50), 120)], 120);
    const server = listOf([group("high", ids("h", 50), 121)], 121);
    expect(keepLoaded(server, previous, grouped())).toBe(server);
  });

  it("keeps a flat list's loaded rows", () => {
    const previous = { items: ids("r", 400).map((id) => item(id)), total: 900, cursor: 1, has_more: true } as WorkItemListResult;
    const server = { items: ids("r", 200).map((id) => item(id)), total: 901, cursor: 2, has_more: true } as WorkItemListResult;
    const shown = keepLoaded(server, previous, flat());
    expect(shown.items).toHaveLength(400);
    expect(shown.total).toBe(901);
    expect(shown.has_more).toBe(true);
  });
});

describe("optimistic edits on a paged list (decision 114)", () => {
  const display: Display = { ...DEFAULT_DISPLAY, group_by: "priority" };
  const reduce = (state: WorkItemListResult, action: Parameters<typeof reduceOptimisticList>[1]) =>
    reduceOptimisticList(state, action, { display, stateGroupOf, firstStateByGroup: noStates });
  const byId = (result: WorkItemListResult, id: string) => result.groups?.find((entry) => entry.id === id);

  /** high holds 50 of 120, low holds 10 of 10. */
  const state = listOf([group("high", ids("h", 50), 120), group("low", ids("l", 10), 10)], 130, (id) => (id.startsWith("l") ? "low" : "high"));

  it("moves the counts by one between groups and not by the loaded length", () => {
    const next = reduce(state, { type: "move", input: { id: "h3", group_by: "priority", value: "low", from_value: "high" } });
    expect(byId(next, "high")?.count).toBe(119);
    expect(byId(next, "high")?.item_ids).not.toContain("h3");
    expect(byId(next, "high")?.has_more).toBe(true);
    expect(byId(next, "low")?.count).toBe(11);
    expect(byId(next, "low")?.item_ids).toContain("h3");
    expect(next.total).toBe(130);
  });

  it("puts a card dropped at the end of a group with more rows right after the last loaded card", () => {
    const next = reduce(state, { type: "move", input: { id: "l4", group_by: "priority", value: "high", from_value: "low", before_id: "h50" } });
    const high = byId(next, "high");
    expect(high?.item_ids.slice(-2)).toEqual(["h50", "l4"]);
    expect(high?.item_ids).toHaveLength(51);
    expect(high?.count).toBe(121);
    expect(high?.has_more).toBe(true);
    expect(byId(next, "low")?.count).toBe(9);
  });

  it("places a drop between two loaded neighbours of the same group", () => {
    const next = reduce(state, { type: "move", input: { id: "h40", before_id: "h2", after_id: "h3" } });
    expect(byId(next, "high")?.item_ids.slice(0, 5)).toEqual(["h1", "h2", "h40", "h3", "h4"]);
    expect(byId(next, "high")?.count).toBe(120);
  });

  it("places a drop at the top of a group before its first card", () => {
    const next = reduce(state, { type: "move", input: { id: "l4", group_by: "priority", value: "high", from_value: "low", after_id: "h1" } });
    expect(byId(next, "high")?.item_ids.slice(0, 2)).toEqual(["l4", "h1"]);
  });

  it("ignores a neighbour that is not loaded", () => {
    const next = reduce(state, { type: "move", input: { id: "l4", group_by: "priority", value: "high", from_value: "low", before_id: "h99" } });
    expect(byId(next, "high")?.item_ids.at(-1)).toBe("l4");
    expect(byId(next, "high")?.count).toBe(121);
  });

  it("moves the counts of an inline edit and leaves the others alone", () => {
    const next = reduce(state, { type: "update", id: "h5", patch: { priority: "low" } });
    expect(byId(next, "high")?.count).toBe(119);
    expect(byId(next, "low")?.count).toBe(11);
    const same = reduce(state, { type: "update", id: "h5", patch: { name: "renamed" } });
    expect(byId(same, "high")?.count).toBe(120);
    expect(byId(same, "low")?.count).toBe(10);
  });

  it("counts a quick-added row in its group and in the total", () => {
    const created = item("optimistic-1", "high");
    const next = reduce(state, { type: "create", item: created, group: { field: "priority", value: "high" } });
    expect(byId(next, "high")?.count).toBe(121);
    expect(byId(next, "high")?.item_ids.at(-1)).toBe("optimistic-1");
    expect(next.total).toBe(131);
  });

  it("moves a lane cell's count with the card", () => {
    const sub = (id: string, itemIds: string[], count: number): Group => ({ ...group(id, itemIds, count), field: "state" });
    const board = listOf(
      [
        group("high", ["x1", "x2"], 40, [sub("s1", ["x1"], 25), sub("s2", ["x2"], 15)]),
        group("low", ["y1"], 5, [sub("s1", ["y1"], 5), sub("s2", [], 0)]),
      ],
      45,
      () => "high",
    );
    board.items = board.items.map((entry) => ({ ...entry, state_id: entry.id === "x1" ? "s1" : entry.id === "x2" ? "s2" : "s1" }));
    const boardDisplay: Display = { ...DEFAULT_DISPLAY, layout: "board", group_by: "priority", sub_group_by: "state" };
    const next = reduceOptimisticList(
      board,
      { type: "move", input: { id: "x1", group_by: "state", value: "s2", from_value: "s1" } },
      { display: boardDisplay, stateGroupOf, firstStateByGroup: noStates },
    );
    const high = byId(next, "high");
    expect(high?.count).toBe(40);
    expect(high?.sub_groups?.find((entry) => entry.id === "s1")?.count).toBe(24);
    expect(high?.sub_groups?.find((entry) => entry.id === "s2")?.count).toBe(16);
  });
});
