/**
 * Group paging of `listWorkItems` (decisions 112, 113, 114): per-group pages
 * with exact counts over the whole filtered set.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { groupLimitKey } from "@/lib/tessera/core/group";
import { newId } from "@/lib/tessera/core/ids";
import { getCounts } from "@/lib/tessera/counts";
import { estimate, estimate_point, project } from "@/lib/tessera/db/schema";
import { NONE_GROUP_ID, type Group } from "@/lib/tessera/filters";
import { createLabel } from "@/lib/tessera/labels";
import { createModule } from "@/lib/tessera/modules";
import { createProject, updateProjectFeatures, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import type { Display, StateRow } from "@/lib/tessera/types";
import { createView } from "@/lib/tessera/views";
import { archiveWorkItem, createWorkItem, listWorkItems, moveWorkItem, type ListWorkItemsInputType, type WorkItem } from "@/lib/tessera/work-items";
import { describeFilters } from "@/lib/tessera/tools/describe-filters";
import { ListWorkItemsInput } from "@/lib/tessera/work-items/read";
import { pageGroups } from "@/lib/tessera/work-items/paging";
import { createTestDb } from "./helpers/db";

const TODAY = "2026-10-10";

type Fixture = { ctx: TesseraContext; project: Project; backlog: StateRow; todo: StateRow; started: StateRow; done: StateRow };

function setup(): Fixture {
  const handles = createTestDb();
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY });
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = listStates(ctx, p.id);
  const byGroup = (group: string) => {
    const found = states.find((state) => state.state_group === group);
    if (!found) throw new Error(`no ${group} state`);
    return found;
  };
  return { ctx, project: p, backlog: byGroup("backlog"), todo: byGroup("unstarted"), started: byGroup("started"), done: byGroup("completed") };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

function scope(f: Fixture) {
  return { type: "project" as const, project_id: f.project.id };
}

function list(f: Fixture, extra: Omit<ListWorkItemsInputType, "scope"> = {}) {
  return listWorkItems(f.ctx, { scope: scope(f), ...extra });
}

function groupOf(groups: Group[] | undefined, id: string): Group {
  const found = groups?.find((group) => group.id === id);
  if (!found) throw new Error(`no group ${id}`);
  return found;
}

function display(patch: Partial<Display>): Partial<Display> {
  return patch;
}

/** 7 backlog, 3 todo (exactly the page size below), 1 started, 0 done. */
function seedStates(f: Fixture): WorkItem[] {
  const items: WorkItem[] = [];
  for (let n = 1; n <= 7; n += 1) items.push(createWorkItem(f.ctx, { project_id: f.project.id, name: `Backlog ${n}`, state_id: f.backlog.id }));
  for (let n = 1; n <= 3; n += 1) items.push(createWorkItem(f.ctx, { project_id: f.project.id, name: `Todo ${n}`, state_id: f.todo.id }));
  items.push(createWorkItem(f.ctx, { project_id: f.project.id, name: "Started 1", state_id: f.started.id }));
  return items;
}

describe("listWorkItems without paging keys", () => {
  it("keeps today's shape: every item, groups from all of them, no has_more on the result", () => {
    const f = setup();
    seedStates(f);
    const result = list(f, { display: display({ group_by: "state" }) });
    expect(result.items).toHaveLength(11);
    expect(result.total).toBe(11);
    expect(result.has_more).toBeUndefined();
    expect(groupOf(result.groups, f.backlog.id)).toMatchObject({ count: 7, has_more: false });
    expect(groupOf(result.groups, f.backlog.id).item_ids).toHaveLength(7);
    expect(groupOf(result.groups, f.todo.id).estimate_points).toBeUndefined();
  });

  it("ignores per_group_limit on an ungrouped list and keeps limit / offset paging", () => {
    const f = setup();
    seedStates(f);
    const ungrouped = list(f, { per_group_limit: 2 });
    expect(ungrouped.items).toHaveLength(11);
    expect(ungrouped.groups).toBeUndefined();
    const page = list(f, { limit: 4, offset: 8 });
    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(11);
    expect(page.has_more).toBe(false);
    expect(list(f, { limit: 4, offset: 4 }).has_more).toBe(true);
    // limit / offset alone on a grouped list is today's path: groups are built from the page.
    const grouped = list(f, { display: display({ group_by: "state" }), limit: 2 });
    expect(grouped.items).toHaveLength(2);
    expect(grouped.groups?.reduce((sum, group) => sum + group.count, 0)).toBe(2);
  });
});

describe("per_group_limit (decisions 112, 113)", () => {
  it("pages every group but keeps count, total and has_more exact", () => {
    const f = setup();
    seedStates(f);
    const result = list(f, { display: display({ group_by: "state" }), per_group_limit: 3 });
    expect(result.total).toBe(11);
    const backlog = groupOf(result.groups, f.backlog.id);
    expect(backlog).toMatchObject({ count: 7, has_more: true });
    expect(backlog.item_ids).toHaveLength(3);
    // Exactly one page: nothing more.
    expect(groupOf(result.groups, f.todo.id)).toMatchObject({ count: 3, has_more: false });
    expect(groupOf(result.groups, f.todo.id).item_ids).toHaveLength(3);
    expect(groupOf(result.groups, f.started.id)).toMatchObject({ count: 1, has_more: false });
    expect(groupOf(result.groups, f.done.id)).toMatchObject({ count: 0, has_more: false, item_ids: [] });
    expect(result.has_more).toBe(true);
    // items is the loaded union and every item_id resolves in it.
    expect(result.items).toHaveLength(3 + 3 + 1);
    const loaded = new Set(result.items.map((item) => item.id));
    for (const group of result.groups ?? []) for (const id of group.item_ids) expect(loaded.has(id)).toBe(true);
  });

  it("puts the first items of each group in display order", () => {
    const f = setup();
    const items = seedStates(f);
    const result = list(f, { display: display({ group_by: "state" }), per_group_limit: 2 });
    const backlogIds = items.filter((item) => item.state_id === f.backlog.id).map((item) => item.id);
    expect(groupOf(result.groups, f.backlog.id).item_ids).toEqual(backlogIds.slice(0, 2));
    const reversed = list(f, { display: display({ group_by: "state", order_by: "-sequence_id" }), per_group_limit: 2 });
    expect(groupOf(reversed.groups, f.backlog.id).item_ids).toEqual([...backlogIds].reverse().slice(0, 2));
    // items follow the display order too.
    expect(reversed.items.map((item) => item.sequence_id)).toEqual([...reversed.items.map((item) => item.sequence_id)].sort((a, b) => b - a));
  });

  it("has_more flips exactly when a group holds more than the limit", () => {
    const f = setup();
    seedStates(f);
    expect(groupOf(list(f, { display: display({ group_by: "state" }), per_group_limit: 7 }).groups, f.backlog.id).has_more).toBe(false);
    expect(groupOf(list(f, { display: display({ group_by: "state" }), per_group_limit: 6 }).groups, f.backlog.id).has_more).toBe(true);
    const all = list(f, { display: display({ group_by: "state" }), per_group_limit: 500 });
    expect(all.has_more).toBe(false);
    expect(all.items).toHaveLength(11);
    expect(list(f, { display: display({ group_by: "state" }), per_group_limit: 1 }).items).toHaveLength(3);
  });

  it("drops empty groups without show_empty_groups and keeps them with it", () => {
    const f = setup();
    seedStates(f);
    const compact = list(f, { display: display({ group_by: "state", show_empty_groups: false }), per_group_limit: 2 });
    expect(compact.groups?.map((group) => group.id)).toEqual([f.backlog.id, f.todo.id, f.started.id]);
    const full = list(f, { display: display({ group_by: "state", show_empty_groups: true }), per_group_limit: 2 });
    expect(groupOf(full.groups, f.done.id)).toMatchObject({ count: 0, has_more: false });
  });

  it("rejects out-of-range limits", () => {
    const f = setup();
    expect(errorCode(() => list(f, { per_group_limit: 0 }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { per_group_limit: 501 }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { group_limits: { x: 0 } }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { group_limits: { x: 2001 } }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { group_limits: Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`g${n}`, 1])) }))).toBe("VALIDATION");
  });
});

describe("group_value (page inside one group)", () => {
  it("pages with limit and offset and reports has_more at the boundaries", () => {
    const f = setup();
    const items = seedStates(f);
    const backlogIds = items.filter((item) => item.state_id === f.backlog.id).map((item) => item.id);
    const base = { display: display({ group_by: "state" }), group_value: f.backlog.id } as const;
    const first = list(f, { ...base, limit: 3 });
    expect(first.groups).toHaveLength(1);
    expect(first.groups?.[0]).toMatchObject({ id: f.backlog.id, count: 7, has_more: true });
    expect(first.groups?.[0].item_ids).toEqual(backlogIds.slice(0, 3));
    expect(first.items.map((item) => item.id)).toEqual(backlogIds.slice(0, 3));
    expect(first.total).toBe(11);
    const second = list(f, { ...base, limit: 3, offset: 3 });
    expect(second.groups?.[0].item_ids).toEqual(backlogIds.slice(3, 6));
    expect(second.groups?.[0].has_more).toBe(true);
    const last = list(f, { ...base, limit: 3, offset: 6 });
    expect(last.groups?.[0].item_ids).toEqual(backlogIds.slice(6));
    expect(last.groups?.[0].has_more).toBe(false);
    expect(last.has_more).toBe(false);
    // offset exactly at the end and beyond is an empty last page.
    expect(list(f, { ...base, limit: 3, offset: 7 }).items).toEqual([]);
    expect(list(f, { ...base, limit: 3, offset: 30 }).groups?.[0]).toMatchObject({ count: 7, has_more: false, item_ids: [] });
  });

  it("falls back to per_group_limit, then to the default page of 50", () => {
    const f = setup();
    seedStates(f);
    const base = { display: display({ group_by: "state" }), group_value: f.backlog.id } as const;
    expect(list(f, { ...base, per_group_limit: 2 }).items).toHaveLength(2);
    expect(list(f, base).items).toHaveLength(7);
  });

  it("returns no group for a value the grouping does not have", () => {
    const f = setup();
    seedStates(f);
    const result = list(f, { display: display({ group_by: "state" }), group_value: newId() });
    expect(result).toMatchObject({ items: [], groups: [], has_more: false, total: 11 });
  });

  it("is a VALIDATION error without group_by, and sub_group_value needs group_value and sub_group_by", () => {
    const f = setup();
    seedStates(f);
    expect(errorCode(() => list(f, { group_value: f.backlog.id }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { display: display({ group_by: null }), group_value: "high", sub_group_value: "x" }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { display: display({ group_by: "state" }), sub_group_value: "high" }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { display: display({ group_by: "state" }), group_value: f.backlog.id, sub_group_value: "high" }))).toBe("VALIDATION");
    expect(errorCode(() => list(f, { display: display({ group_by: "state" }), group_value: "" }))).toBe("VALIDATION");
  });

  it("takes group_by from a saved view's display", () => {
    const f = setup();
    seedStates(f);
    const saved = createView(f.ctx, { project_id: f.project.id, name: "By state", display: display({ group_by: "state" }) });
    const result = listWorkItems(f.ctx, { scope: { type: "view", view_id: saved.id }, group_value: f.backlog.id, limit: 2 });
    expect(result.groups?.[0]).toMatchObject({ id: f.backlog.id, count: 7, has_more: true });
    expect(errorCode(() => listWorkItems(f.ctx, { scope: scope(f), group_value: f.backlog.id }))).toBe("VALIDATION");
  });
});

describe("multi-valued group_by", () => {
  function labelled(f: Fixture) {
    const bug = createLabel(f.ctx, { project_id: f.project.id, name: "bug" });
    const ui = createLabel(f.ctx, { project_id: f.project.id, name: "ui" });
    const empty = createLabel(f.ctx, { project_id: f.project.id, name: "empty" });
    const add = (name: string, label_ids: string[]) => createWorkItem(f.ctx, { project_id: f.project.id, name, label_ids });
    const both = [add("a", [bug.id, ui.id]), add("b", [bug.id, ui.id])];
    const bugOnly = [add("c", [bug.id]), add("d", [bug.id])];
    const plain = [add("e", []), add("f", [])];
    return { bug, ui, empty, both, bugOnly, plain };
  }

  it("labels: an item sits in every label group; counts equal getCounts; items are unique", () => {
    const f = setup();
    const { bug, ui, empty, both, plain } = labelled(f);
    const result = list(f, { display: display({ group_by: "labels" }), per_group_limit: 2 });
    expect(groupOf(result.groups, bug.id)).toMatchObject({ count: 4, has_more: true });
    expect(groupOf(result.groups, ui.id)).toMatchObject({ count: 2, has_more: false });
    expect(groupOf(result.groups, empty.id)).toMatchObject({ count: 0, has_more: false });
    expect(groupOf(result.groups, NONE_GROUP_ID)).toMatchObject({ count: 2, has_more: false });
    // a and b are in bug (first page) and ui; the union holds each once.
    const ids = result.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set([...both, ...plain].map((item) => item.id)));
    expect(result.total).toBe(6);
    const counts = getCounts(f.ctx, { type: "project", project_id: f.project.id });
    expect(groupOf(result.groups, bug.id).count).toBe(counts.by_label[bug.id]);
    expect(groupOf(result.groups, ui.id).count).toBe(counts.by_label[ui.id]);
    // The second page of the bug group continues where the first stopped.
    const next = list(f, { display: display({ group_by: "labels" }), group_value: bug.id, limit: 2, offset: 2 });
    expect(next.groups?.[0].has_more).toBe(false);
    expect(next.items).toHaveLength(2);
    expect(next.items.every((item) => item.label_ids.includes(bug.id))).toBe(true);
  });

  it("assignees and modules page the same way", () => {
    const f = setup();
    const ann = registerActor(f.ctx, { kind: "agent", name: "mcp:ann" });
    const bob = registerActor(f.ctx, { kind: "agent", name: "mcp:bob" });
    const mod = createModule(f.ctx, { project_id: f.project.id, name: "Core" });
    for (let n = 1; n <= 5; n += 1) {
      createWorkItem(f.ctx, {
        project_id: f.project.id,
        name: `Item ${n}`,
        assignee_ids: n <= 4 ? [ann.id] : [ann.id, bob.id],
        module_ids: n % 2 === 0 ? [mod.id] : [],
      });
    }
    const byAssignee = list(f, { display: display({ group_by: "assignees", show_empty_groups: false }), per_group_limit: 3 });
    const counts = getCounts(f.ctx, { type: "project", project_id: f.project.id });
    expect(groupOf(byAssignee.groups, ann.id)).toMatchObject({ count: counts.by_assignee[ann.id], has_more: true });
    expect(groupOf(byAssignee.groups, bob.id)).toMatchObject({ count: counts.by_assignee[bob.id], has_more: false });
    expect(byAssignee.total).toBe(5);
    const byModule = list(f, { display: display({ group_by: "module" }), per_group_limit: 1 });
    expect(groupOf(byModule.groups, mod.id)).toMatchObject({ count: 2, has_more: true });
    expect(groupOf(byModule.groups, NONE_GROUP_ID)).toMatchObject({ count: 3, has_more: true });
    expect(byModule.items).toHaveLength(2);
  });
});

describe("sub-groups (board cells)", () => {
  function board(f: Fixture) {
    const make = (name: string, state: StateRow, priority: "high" | "low") => createWorkItem(f.ctx, { project_id: f.project.id, name, state_id: state.id, priority });
    const items = [
      ...[1, 2, 3, 4].map((n) => make(`B-high ${n}`, f.backlog, "high")),
      ...[1, 2].map((n) => make(`B-low ${n}`, f.backlog, "low")),
      make("T-high 1", f.todo, "high"),
    ];
    return items;
  }

  it("pages every cell and rolls has_more up to the column", () => {
    const f = setup();
    board(f);
    const result = list(f, { display: display({ group_by: "state", sub_group_by: "priority" }), per_group_limit: 2 });
    const backlog = groupOf(result.groups, f.backlog.id);
    expect(backlog).toMatchObject({ count: 6, has_more: true });
    expect(groupOf(backlog.sub_groups, "high")).toMatchObject({ count: 4, has_more: true });
    expect(groupOf(backlog.sub_groups, "high").item_ids).toHaveLength(2);
    expect(groupOf(backlog.sub_groups, "low")).toMatchObject({ count: 2, has_more: false });
    expect(backlog.item_ids).toHaveLength(4);
    expect(groupOf(result.groups, f.todo.id).has_more).toBe(false);
    expect(result.total).toBe(7);
    expect(result.items).toHaveLength(4 + 1);
  });

  it("group_value alone pages that column's cells; with sub_group_value only one cell", () => {
    const f = setup();
    const items = board(f);
    const high = items.slice(0, 4).map((item) => item.id);
    const column = list(f, { display: display({ group_by: "state", sub_group_by: "priority" }), group_value: f.backlog.id, limit: 3 });
    expect(column.groups).toHaveLength(1);
    expect(groupOf(column.groups?.[0].sub_groups, "high").item_ids).toEqual(high.slice(0, 3));
    expect(groupOf(column.groups?.[0].sub_groups, "low").item_ids).toHaveLength(2);
    const cell = list(f, { display: display({ group_by: "state", sub_group_by: "priority" }), group_value: f.backlog.id, sub_group_value: "high", limit: 3, offset: 3 });
    expect(cell.groups?.[0].sub_groups).toHaveLength(1);
    expect(cell.groups?.[0].sub_groups?.[0]).toMatchObject({ id: "high", count: 4, has_more: false, item_ids: high.slice(3) });
    expect(cell.groups?.[0].has_more).toBe(false);
    expect(cell.items.map((item) => item.id)).toEqual(high.slice(3));
  });

  it("group_limits sizes a cell by its group/sub key and beats per_group_limit", () => {
    const f = setup();
    board(f);
    const input = { display: display({ group_by: "state", sub_group_by: "priority" }), per_group_limit: 1 } as const;
    const result = list(f, { ...input, group_limits: { [groupLimitKey(f.backlog.id, "high")]: 3 } });
    const backlog = groupOf(result.groups, f.backlog.id);
    expect(groupOf(backlog.sub_groups, "high").item_ids).toHaveLength(3);
    expect(groupOf(backlog.sub_groups, "low").item_ids).toHaveLength(1);
    // A group key sizes every cell of the column.
    const column = list(f, { ...input, group_limits: { [f.backlog.id]: 4 } });
    expect(groupOf(groupOf(column.groups, f.backlog.id).sub_groups, "high")).toMatchObject({ has_more: false });
    expect(groupOf(groupOf(column.groups, f.todo.id).sub_groups, "high").item_ids).toHaveLength(1);
  });
});

describe("group_limits (refetch expanded groups)", () => {
  it("loads an expanded group up to its previous length and the rest at the base size", () => {
    const f = setup();
    seedStates(f);
    const result = list(f, { display: display({ group_by: "state" }), per_group_limit: 2, group_limits: { [f.backlog.id]: 5 } });
    expect(groupOf(result.groups, f.backlog.id).item_ids).toHaveLength(5);
    expect(groupOf(result.groups, f.backlog.id).has_more).toBe(true);
    expect(groupOf(result.groups, f.todo.id).item_ids).toHaveLength(2);
    expect(result.items).toHaveLength(5 + 2 + 1);
    const full = list(f, { display: display({ group_by: "state" }), per_group_limit: 2, group_limits: { [f.backlog.id]: 7, unknown: 9 } });
    expect(groupOf(full.groups, f.backlog.id)).toMatchObject({ has_more: false, count: 7 });
  });

  it("works without per_group_limit (default page) and is ignored on an ungrouped list", () => {
    const f = setup();
    seedStates(f);
    expect(list(f, { display: display({ group_by: "state" }), group_limits: { [f.backlog.id]: 2 } }).items).toHaveLength(2 + 3 + 1);
    expect(list(f, { group_limits: { [f.backlog.id]: 2 } }).items).toHaveLength(11);
  });
});

describe("counts agree with getCounts on the same filters", () => {
  it("project, filtered and view scopes", () => {
    const f = setup();
    const p = f.project;
    const mk = (n: number, state: StateRow, priority: "urgent" | "high" | "low") => createWorkItem(f.ctx, { project_id: p.id, name: `I${n}`, state_id: state.id, priority });
    let n = 0;
    for (const state of [f.backlog, f.todo, f.started, f.done]) {
      for (const priority of ["urgent", "high", "low"] as const) {
        for (let k = 0; k < 3; k += 1) mk((n += 1), state, priority);
      }
    }
    const scopes: { scope: ListWorkItemsInputType["scope"]; counts: Parameters<typeof getCounts>[1]; filters?: ListWorkItemsInputType["filters"] }[] = [
      { scope: { type: "project", project_id: p.id }, counts: { type: "project", project_id: p.id } },
      { scope: { type: "workspace" }, counts: { type: "workspace" } },
    ];
    for (const entry of scopes) {
      const result = listWorkItems(f.ctx, { scope: entry.scope, display: display({ group_by: "state" }), per_group_limit: 1 });
      const counts = getCounts(f.ctx, entry.counts);
      expect(result.total).toBe(counts.total);
      for (const [stateId, c] of Object.entries(counts.by_state)) expect(groupOf(result.groups, stateId).count).toBe(c);
      const byPriority = listWorkItems(f.ctx, { scope: entry.scope, display: display({ group_by: "priority" }), per_group_limit: 1 });
      for (const [priority, c] of Object.entries(counts.by_priority)) expect(groupOf(byPriority.groups, priority).count).toBe(c);
    }
    // A saved view's filters apply to the projection exactly as to getCounts.
    const saved = createView(f.ctx, { project_id: p.id, name: "Urgent", filters: { priority: ["urgent", "high"] }, display: display({ group_by: "state" }) });
    const viewList = listWorkItems(f.ctx, { scope: { type: "view", view_id: saved.id }, per_group_limit: 2 });
    const viewCounts = getCounts(f.ctx, { type: "view", view_id: saved.id });
    expect(viewList.total).toBe(viewCounts.total);
    expect(viewCounts.total).toBe(24);
    for (const [stateId, c] of Object.entries(viewCounts.by_state)) expect(groupOf(viewList.groups, stateId).count).toBe(c);
    // Caller filters merge over the view's and the counts follow.
    const narrowed = listWorkItems(f.ctx, { scope: { type: "view", view_id: saved.id }, filters: { priority: ["urgent"] }, per_group_limit: 2 });
    expect(narrowed.total).toBe(12);
    expect(groupOf(narrowed.groups, f.done.id).count).toBe(3);
  });

  it("rich filters apply to the projection unchanged", () => {
    const f = setup();
    for (let n = 0; n < 6; n += 1) createWorkItem(f.ctx, { project_id: f.project.id, name: `U${n}`, priority: "urgent" });
    for (let n = 0; n < 4; n += 1) createWorkItem(f.ctx, { project_id: f.project.id, name: `L${n}`, priority: "low" });
    const result = list(f, {
      display: display({ group_by: "priority", show_empty_groups: false }),
      rich_filters: { and: [{ field: "priority", op: "eq", value: "urgent" }] },
      per_group_limit: 4,
    });
    expect(result.total).toBe(6);
    expect(result.groups).toHaveLength(1);
    expect(result.groups?.[0]).toMatchObject({ id: "urgent", count: 6, has_more: true });
  });
});

describe("other scopes and filters page through the same WHERE", () => {
  it("workspace grouped by project, archived scope, profile scope and full-text search", () => {
    const f = setup();
    const other = createProject(f.ctx, { name: "Docs", identifier: "DOC" });
    for (let n = 1; n <= 4; n += 1) createWorkItem(f.ctx, { project_id: f.project.id, name: `Web ${n}`, state_id: f.backlog.id });
    for (let n = 1; n <= 3; n += 1) createWorkItem(f.ctx, { project_id: other.id, name: `Doc ${n} zebra` });
    const workspace = listWorkItems(f.ctx, { scope: { type: "workspace" }, display: display({ group_by: "project" }), per_group_limit: 2 });
    expect(workspace.total).toBe(7);
    expect(groupOf(workspace.groups, f.project.id)).toMatchObject({ count: 4, has_more: true });
    expect(groupOf(workspace.groups, other.id)).toMatchObject({ count: 3, has_more: true });
    const searched = list(f, { display: display({ group_by: "state" }), filters: { search: "Web" }, per_group_limit: 1 });
    expect(groupOf(searched.groups, f.backlog.id)).toMatchObject({ count: 4, has_more: true });
    const crossSearch = listWorkItems(f.ctx, { scope: { type: "workspace" }, display: display({ group_by: "project" }), filters: { search: "zebra" }, per_group_limit: 1 });
    expect(crossSearch.total).toBe(3);
    // Archived scope lists archived items only.
    for (const name of ["Old 1", "Old 2"]) archiveWorkItem(f.ctx, createWorkItem(f.ctx, { project_id: f.project.id, name, state_id: f.done.id }).id);
    const archived = listWorkItems(f.ctx, { scope: { type: "archived", project_id: f.project.id }, display: display({ group_by: "state" }), per_group_limit: 1 });
    expect(archived.total).toBe(2);
    expect(groupOf(archived.groups, f.done.id)).toMatchObject({ count: 2, has_more: true });
    // Profile scope: items assigned to the actor.
    const agent = registerActor(f.ctx, { kind: "agent", name: "mcp:pro" });
    for (let n = 1; n <= 3; n += 1) createWorkItem(f.ctx, { project_id: f.project.id, name: `Mine ${n}`, assignee_ids: [agent.id] });
    const profile = listWorkItems(f.ctx, { scope: { type: "profile", actor_id: agent.id, tab: "assigned" }, display: display({ group_by: "assignees" }), per_group_limit: 2 });
    expect(profile.total).toBe(3);
    expect(groupOf(profile.groups, agent.id)).toMatchObject({ count: 3, has_more: true });
  });
});

describe("describe_filters names the paging keys (decision 112)", () => {
  it("documents every paging key of list_work_items, and only keys the input accepts", () => {
    const documented = Object.keys(describeFilters().paging).sort();
    const accepted = Object.keys(ListWorkItemsInput.shape);
    for (const key of documented) expect(accepted, key).toContain(key);
    for (const key of ["limit", "offset", "per_group_limit", "group_value", "sub_group_value", "group_limits", "calendar_window"]) expect(documented, key).toContain(key);
    expect(describeFilters().paging.per_group_limit).toMatch(/1 to 500/);
  });
});

describe("calendar_window (decision 112)", () => {
  it("keeps the items targeted inside the period and the unscheduled ones, under a limit", () => {
    const f = setup();
    const make = (name: string, target_date?: string) => createWorkItem(f.ctx, { project_id: f.project.id, name, state_id: f.backlog.id, ...(target_date ? { target_date } : {}) });
    make("Before", "2026-09-30");
    make("First day", "2026-10-01");
    make("Mid", "2026-10-15");
    make("Last day", "2026-10-31");
    make("After", "2026-11-01");
    make("Loose 1");
    make("Loose 2");
    const window = { from: "2026-10-01", to: "2026-10-31" };
    const result = list(f, { calendar_window: window, limit: 1000 });
    expect(result.items.map((item) => item.name).sort()).toEqual(["First day", "Last day", "Loose 1", "Loose 2", "Mid"]);
    expect(result.total).toBe(5);
    expect(result.has_more).toBe(false);
    // The cap cuts the windowed set, not the whole project.
    const cut = list(f, { calendar_window: window, limit: 2 });
    expect(cut.items).toHaveLength(2);
    expect(cut.total).toBe(5);
    expect(cut.has_more).toBe(true);
    // Without the key every item loads.
    expect(list(f).total).toBe(7);
    expect(errorCode(() => list(f, { calendar_window: { from: "2026-11-01", to: "2026-10-01" } }))).toBe("VALIDATION");
  });
});

describe("estimate totals over the full group (decision 113)", () => {
  it("sums the points of the whole group, not the loaded page", () => {
    const f = setup();
    const audit = { created_at: f.ctx.now(), updated_at: f.ctx.now(), created_by: USER_ACTOR_ID, updated_by: USER_ACTOR_ID };
    const est = f.ctx.db.insert(estimate).values({ id: newId(), project_id: f.project.id, name: "Points", ...audit }).returning().get();
    const pts = ["1", "2", "5"].map((value, position) => f.ctx.db.insert(estimate_point).values({ id: newId(), estimate_id: est.id, position, value, ...audit }).returning().get());
    f.ctx.db.update(project).set({ estimate_id: est.id }).where(eq(project.id, f.project.id)).run();
    updateProjectFeatures(f.ctx, f.project.id, { estimates_enabled: true });
    for (const point of pts) createWorkItem(f.ctx, { project_id: f.project.id, name: `P${point.value}`, state_id: f.backlog.id, estimate_point_id: point.id });
    createWorkItem(f.ctx, { project_id: f.project.id, name: "Unestimated", state_id: f.backlog.id });
    const result = list(f, { display: display({ group_by: "state" }), per_group_limit: 1 });
    expect(groupOf(result.groups, f.backlog.id)).toMatchObject({ count: 4, has_more: true, estimate_points: 8 });
    expect(groupOf(result.groups, f.todo.id).estimate_points).toBe(0);
    expect(getCounts(f.ctx, { type: "project", project_id: f.project.id }).total_points).toBe(8);
  });
});

describe("pageGroups", () => {
  const group = (id: string, ids: string[], sub?: Group[]): Group => ({ field: "state", id, name: id, color: null, count: ids.length, item_ids: ids, has_more: false, sub_groups: sub });

  it("slices without mutating the input and returns each loaded id once", () => {
    const groups = [group("a", ["1", "2", "3"]), group("b", ["3", "4"])];
    const paged = pageGroups(groups, 2);
    expect(paged.groups.map((g) => [g.id, g.count, g.item_ids, g.has_more])).toEqual([
      ["a", 3, ["1", "2"], true],
      ["b", 2, ["3", "4"], false],
    ]);
    expect(paged.ids).toEqual(["1", "2", "3", "4"]);
    expect(groups[0].item_ids).toEqual(["1", "2", "3"]);
    expect(groups[0].has_more).toBe(false);
  });

  it("keeps one group or cell with `only` and honours offset", () => {
    const groups = [group("a", ["1", "2", "3"]), group("b", ["4"], [group("x", ["4"])])];
    expect(pageGroups(groups, 2, {}, 2, { group: "a" })).toMatchObject({ ids: ["3"], groups: [{ id: "a", item_ids: ["3"], has_more: false }] });
    expect(pageGroups(groups, 1, {}, 0, { group: "b", sub: "missing" }).groups[0]).toMatchObject({ item_ids: [], has_more: false, sub_groups: [] });
  });
});

describe("moves on a paged list (decision 114)", () => {
  it("a drop after the last loaded item lands directly behind it, before the unloaded rest", () => {
    const f = setup();
    const items = seedStates(f);
    const backlog = items.filter((item) => item.state_id === f.backlog.id);
    const mover = items.find((item) => item.state_id === f.started.id);
    if (!mover) throw new Error("no mover");
    const input = { display: display({ group_by: "state" }), per_group_limit: 3 } as const;
    const before = groupOf(list(f, input).groups, f.backlog.id);
    const lastLoaded = before.item_ids[before.item_ids.length - 1];
    expect(before.has_more).toBe(true);
    moveWorkItem(f.ctx, mover.id, { group_by: "state", value: f.backlog.id, before_id: lastLoaded });
    const after = list(f, input);
    const backlogAfter = groupOf(after.groups, f.backlog.id);
    expect(backlogAfter).toMatchObject({ count: 8, has_more: true });
    expect(backlogAfter.item_ids).toEqual([backlog[0].id, backlog[1].id, backlog[2].id]);
    // The unloaded rest still follows the moved item in order.
    const whole = list(f, { display: display({ group_by: "state" }), group_value: f.backlog.id, limit: 20 }).groups?.[0].item_ids;
    expect(whole).toEqual([backlog[0].id, backlog[1].id, backlog[2].id, mover.id, ...backlog.slice(3).map((item) => item.id)]);
    expect(groupOf(after.groups, f.started.id)).toMatchObject({ count: 0, has_more: false });
  });
});
