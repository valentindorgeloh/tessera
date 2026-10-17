import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, SYSTEM_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { subscribe, unsubscribe } from "@/lib/tessera/assignees";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { cycle, estimate, estimate_point, mention, moduleTable, project, work_item, work_item_assignee, work_item_label, work_item_module } from "@/lib/tessera/db/schema";
import { buildOrder, buildWhere, groupItems, relativeDate, resolveDateFilter, type GroupableItem } from "@/lib/tessera/filters";
import { createLabel } from "@/lib/tessera/labels";
import { createProject, updateProjectFeatures, type Project } from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import { listStates } from "@/lib/tessera/states";
import type { Display, Filters, StateRow } from "@/lib/tessera/types";
import { archiveWorkItem, createWorkItem, deleteWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb } from "./helpers/db";
import { withTimeZone } from "./helpers/time-zone";

const TODAY = "2026-10-10";

type Clock = { now: string };

type Fixture = { ctx: TesseraContext; clock: Clock; project: Project; states: Record<string, StateRow> };

/** Context with a frozen local date and a clock the test can move for created_at / updated_at. */
function setup(): Fixture {
  const handles = createTestDb();
  const clock: Clock = { now: "2026-10-01T10:00:00.000Z" };
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => clock.now, today: () => TODAY });
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.name, s]));
  return { ctx, clock, project: p, states };
}

function audit(ctx: TesseraContext) {
  const now = ctx.now();
  return { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
}

function insertCycle(ctx: TesseraContext, projectId: string, name: string, sortOrder = firstSortOrder()) {
  return ctx.db
    .insert(cycle)
    .values({ id: newId(), project_id: projectId, name, sort_order: sortOrder, ...audit(ctx) })
    .returning()
    .get();
}

function insertModule(ctx: TesseraContext, projectId: string, name: string) {
  return ctx.db
    .insert(moduleTable)
    .values({ id: newId(), project_id: projectId, name, name_key: name.toLowerCase(), sort_order: firstSortOrder(), ...audit(ctx) })
    .returning()
    .get();
}

function insertEstimatePoints(ctx: TesseraContext, projectId: string, values: string[]) {
  const est = ctx.db
    .insert(estimate)
    .values({ id: newId(), project_id: projectId, name: "Points", ...audit(ctx) })
    .returning()
    .get();
  return values.map((value, position) =>
    ctx.db
      .insert(estimate_point)
      .values({ id: newId(), estimate_id: est.id, position, value, ...audit(ctx) })
      .returning()
      .get(),
  );
}

/** Ids matching `filters` in project creation then sequence order, through the same join listWorkItems uses. */
function idsWhere(ctx: TesseraContext, filters: Filters, options: Parameters<typeof buildWhere>[2] = {}): string[] {
  return ctx.db
    .select({ id: work_item.id })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(buildWhere(ctx, filters, options))
    .orderBy(asc(work_item.project_id), asc(work_item.sequence_id))
    .all()
    .map((row) => row.id);
}

function namesOrdered(ctx: TesseraContext, projectId: string, display: Partial<Display>): string[] {
  return ctx.db
    .select({ name: work_item.name })
    .from(work_item)
    .where(and(eq(work_item.project_id, projectId)))
    .orderBy(...buildOrder({ ...DEFAULT_DISPLAY, ...display }))
    .all()
    .map((row) => row.name);
}

function display(patch: Partial<Display>): Display {
  return { ...DEFAULT_DISPLAY, ...patch };
}

describe("resolveDateFilter", () => {
  it("resolves relative tokens today, 1w, 2w and 1m against today", () => {
    expect(relativeDate("today", TODAY)).toBe("2026-10-10");
    expect(relativeDate("1w", TODAY)).toBe("2026-10-17");
    expect(relativeDate("2w", TODAY)).toBe("2026-10-24");
    expect(relativeDate("1m", TODAY)).toBe("2026-11-10");
    expect(relativeDate("1m", "2026-01-31")).toBe("2026-02-28");
    expect(relativeDate("1m", "2026-12-15")).toBe("2027-01-15");
  });

  it("before and after with a relative token compare against the resolved day", () => {
    expect(resolveDateFilter({ op: "before", relative: "1w" }, TODAY)).toEqual({ op: "before", date: "2026-10-17" });
    expect(resolveDateFilter({ op: "after", relative: "today", from: "2020-01-01" }, TODAY)).toEqual({ op: "after", date: "2026-10-10" });
  });

  it("between with a relative token spans today and the resolved day inclusively", () => {
    expect(resolveDateFilter({ op: "between", relative: "2w" }, TODAY)).toEqual({ op: "between", from: "2026-10-10", to: "2026-10-24" });
    expect(resolveDateFilter({ op: "between", relative: "today" }, TODAY)).toEqual({ op: "between", from: "2026-10-10", to: "2026-10-10" });
  });

  it("uses absolute bounds, orders a reversed between and turns one-sided betweens into inclusive bounds", () => {
    expect(resolveDateFilter({ op: "before", to: "2026-10-05" }, TODAY)).toEqual({ op: "before", date: "2026-10-05" });
    expect(resolveDateFilter({ op: "before", from: "2026-10-05" }, TODAY)).toEqual({ op: "before", date: "2026-10-05" });
    expect(resolveDateFilter({ op: "after", from: "2026-10-05" }, TODAY)).toEqual({ op: "after", date: "2026-10-05" });
    expect(resolveDateFilter({ op: "between", from: "2026-10-20", to: "2026-10-01" }, TODAY)).toEqual({ op: "between", from: "2026-10-01", to: "2026-10-20" });
    expect(resolveDateFilter({ op: "between", from: "2026-10-05" }, TODAY)).toEqual({ op: "after", date: "2026-10-04" });
    expect(resolveDateFilter({ op: "between", to: "2026-10-05" }, TODAY)).toEqual({ op: "before", date: "2026-10-06" });
  });

  it("returns null when no bound can be derived", () => {
    expect(resolveDateFilter({ op: "before" }, TODAY)).toBeNull();
    expect(resolveDateFilter({ op: "after" }, TODAY)).toBeNull();
    expect(resolveDateFilter({ op: "between" }, TODAY)).toBeNull();
  });
});

describe("buildWhere", () => {
  it("always excludes deleted rows and excludes archived rows unless archived is true", () => {
    const { ctx, project: p, states } = setup();
    const live = createWorkItem(ctx, { project_id: p.id, name: "Live" });
    const gone = createWorkItem(ctx, { project_id: p.id, name: "Gone" });
    const done = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: states.Done.id });
    deleteWorkItem(ctx, gone.id);
    archiveWorkItem(ctx, done.id);
    expect(idsWhere(ctx, {})).toEqual([live.id]);
    expect(idsWhere(ctx, { archived: true })).toEqual([live.id, done.id]);
    expect(idsWhere(ctx, { archived: false })).toEqual([live.id]);
  });

  it("filters by state ids and by state_group", () => {
    const { ctx, project: p, states } = setup();
    const backlog = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const todo = createWorkItem(ctx, { project_id: p.id, name: "B", state_id: states.Todo.id });
    const doing = createWorkItem(ctx, { project_id: p.id, name: "C", state_id: states["In Progress"].id });
    expect(idsWhere(ctx, { state: [states.Todo.id] })).toEqual([todo.id]);
    expect(idsWhere(ctx, { state: [states.Todo.id, states.Backlog.id] })).toEqual([backlog.id, todo.id]);
    expect(idsWhere(ctx, { state_group: ["started"] })).toEqual([doing.id]);
    expect(idsWhere(ctx, { state_group: ["unstarted", "started"] })).toEqual([todo.id, doing.id]);
    expect(idsWhere(ctx, { state: [] })).toEqual([backlog.id, todo.id, doing.id]);
  });

  it("filters by priority", () => {
    const { ctx, project: p } = setup();
    const high = createWorkItem(ctx, { project_id: p.id, name: "A", priority: "high" });
    createWorkItem(ctx, { project_id: p.id, name: "B" });
    const low = createWorkItem(ctx, { project_id: p.id, name: "C", priority: "low" });
    expect(idsWhere(ctx, { priority: ["high", "low"] })).toEqual([high.id, low.id]);
    expect(idsWhere(ctx, { priority: ["urgent"] })).toEqual([]);
  });

  it("matches any of the given labels, assignees and modules through the junction tables", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const core = insertModule(ctx, p.id, "Core");
    const api = insertModule(ctx, p.id, "API");
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [bug.id], module_ids: [core.id], assignee_ids: [USER_ACTOR_ID] });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", label_ids: [ux.id], module_ids: [api.id], assignee_ids: [ASSISTANT_ACTOR_ID] });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C", label_ids: [bug.id, ux.id] });
    expect(idsWhere(ctx, { labels: [bug.id] })).toEqual([a.id, c.id]);
    expect(idsWhere(ctx, { labels: [bug.id, ux.id] })).toEqual([a.id, b.id, c.id]);
    expect(idsWhere(ctx, { labels: [newId()] })).toEqual([]);
    expect(idsWhere(ctx, { assignees: [ASSISTANT_ACTOR_ID] })).toEqual([b.id]);
    expect(idsWhere(ctx, { assignees: [USER_ACTOR_ID, ASSISTANT_ACTOR_ID] })).toEqual([a.id, b.id]);
    expect(idsWhere(ctx, { module: [core.id] })).toEqual([a.id]);
    expect(idsWhere(ctx, { module: [api.id, core.id] })).toEqual([a.id, b.id]);
    expect(idsWhere(ctx, { labels: [bug.id], assignees: [ASSISTANT_ACTOR_ID] })).toEqual([]);
  });

  it("filters by cycle, parent, created_by, subscriber, mentions and project", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const child = createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: parent.id, cycle_id: sprint.id });
    const elsewhere = createWorkItem(ctx, { project_id: other.id, name: "Elsewhere" });
    unsubscribe(ctx, parent.id);
    subscribe(ctx, parent.id, ASSISTANT_ACTOR_ID);
    ctx.db.insert(mention).values({ entity_type: "work_item", entity_id: child.id, actor_id: SYSTEM_ACTOR_ID, created_at: ctx.now() }).run();
    ctx.db.insert(mention).values({ entity_type: "comment", entity_id: parent.id, actor_id: SYSTEM_ACTOR_ID, created_at: ctx.now() }).run();
    expect(idsWhere(ctx, { cycle: [sprint.id] })).toEqual([child.id]);
    expect(idsWhere(ctx, { parent: [parent.id] })).toEqual([child.id]);
    expect(idsWhere(ctx, { created_by: [USER_ACTOR_ID] })).toEqual([parent.id, child.id, elsewhere.id]);
    expect(idsWhere(ctx, { created_by: [ASSISTANT_ACTOR_ID] })).toEqual([]);
    expect(idsWhere(ctx, { subscriber: [ASSISTANT_ACTOR_ID] })).toEqual([parent.id]);
    expect(idsWhere(ctx, { subscriber: [USER_ACTOR_ID] })).toEqual([child.id, elsewhere.id]);
    expect(idsWhere(ctx, { mentions: [SYSTEM_ACTOR_ID] })).toEqual([child.id]);
    expect(idsWhere(ctx, { project: [other.id] })).toEqual([elsewhere.id]);
  });

  it("searches name and body through FTS, narrowed to a project when one is given", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const a = createWorkItem(ctx, { project_id: p.id, name: "Checkout button", description_md: "The payment form" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "Login page", description_md: "Also mentions checkout" });
    const c = createWorkItem(ctx, { project_id: other.id, name: "Checkout in the other project" });
    expect(idsWhere(ctx, { search: "checkout" })).toEqual([a.id, b.id, c.id]);
    expect(idsWhere(ctx, { search: "checkout" }, { project_id: p.id })).toEqual([a.id, b.id]);
    expect(idsWhere(ctx, { search: "payment" })).toEqual([a.id]);
    expect(idsWhere(ctx, { search: "nothing-like-this" })).toEqual([]);
    expect(idsWhere(ctx, { search: "   " })).toEqual([a.id, b.id, c.id]);
    expect(idsWhere(ctx, { search: '"(checkout' })).toEqual([a.id, b.id, c.id]);
  });

  it("applies before, after and between on date columns with absolute and relative bounds", () => {
    const { ctx, project: p } = setup();
    const early = createWorkItem(ctx, { project_id: p.id, name: "Early", target_date: "2026-10-05" });
    const today = createWorkItem(ctx, { project_id: p.id, name: "Today", target_date: TODAY });
    const soon = createWorkItem(ctx, { project_id: p.id, name: "Soon", target_date: "2026-10-15" });
    const late = createWorkItem(ctx, { project_id: p.id, name: "Late", target_date: "2026-11-30" });
    createWorkItem(ctx, { project_id: p.id, name: "Undated" });
    expect(idsWhere(ctx, { target_date: { op: "before", relative: "today" } })).toEqual([early.id]);
    expect(idsWhere(ctx, { target_date: { op: "after", relative: "today" } })).toEqual([soon.id, late.id]);
    expect(idsWhere(ctx, { target_date: { op: "between", relative: "1w" } })).toEqual([today.id, soon.id]);
    expect(idsWhere(ctx, { target_date: { op: "between", relative: "1m" } })).toEqual([today.id, soon.id]);
    expect(idsWhere(ctx, { target_date: { op: "between", from: "2026-10-01", to: "2026-10-10" } })).toEqual([early.id, today.id]);
    expect(idsWhere(ctx, { target_date: { op: "after", from: "2026-10-15" } })).toEqual([late.id]);
    expect(idsWhere(ctx, { target_date: { op: "before" } })).toHaveLength(5);
  });

  it("compares timestamp columns on their local date part", () => {
    withTimeZone("UTC", () => {
      const { ctx, clock, project: p, states } = setup();
      clock.now = "2026-10-01T23:59:00.000Z";
      const first = createWorkItem(ctx, { project_id: p.id, name: "First" });
      clock.now = "2026-10-09T08:00:00.000Z";
      const second = createWorkItem(ctx, { project_id: p.id, name: "Second" });
      clock.now = "2026-10-10T08:00:00.000Z";
      const third = createWorkItem(ctx, { project_id: p.id, name: "Third", state_id: states.Done.id });
      expect(idsWhere(ctx, { created_at: { op: "before", to: "2026-10-09" } })).toEqual([first.id]);
      expect(idsWhere(ctx, { created_at: { op: "between", from: "2026-10-09", to: "2026-10-09" } })).toEqual([second.id]);
      expect(idsWhere(ctx, { created_at: { op: "between", relative: "today" } })).toEqual([third.id]);
      expect(idsWhere(ctx, { completed_at: { op: "after", from: "2026-10-01" } })).toEqual([third.id]);
      clock.now = "2026-10-12T08:00:00.000Z";
      updateWorkItem(ctx, first.id, { priority: "high" });
      expect(idsWhere(ctx, { updated_at: { op: "after", relative: "today" } })).toEqual([first.id]);
    });
  });

  it("timestamp filters use the server's local calendar day, not the UTC date", () => {
    const { ctx, clock, project: p } = setup();
    // 05:30 on the 10th in Tokyo, still the 9th in UTC.
    clock.now = "2026-10-09T20:30:00.000Z";
    const item = createWorkItem(ctx, { project_id: p.id, name: "Late" });
    withTimeZone("Asia/Tokyo", () => {
      expect(idsWhere(ctx, { created_at: { op: "between", relative: "today" } })).toEqual([item.id]);
      expect(idsWhere(ctx, { created_at: { op: "between", from: "2026-10-09", to: "2026-10-09" } })).toEqual([]);
      expect(idsWhere(ctx, { created_at: { op: "before", to: "2026-10-10" } })).toEqual([]);
      expect(idsWhere(ctx, { created_at: { op: "after", from: "2026-10-09" } })).toEqual([item.id]);
    });
    withTimeZone("UTC", () => {
      expect(idsWhere(ctx, { created_at: { op: "between", relative: "today" } })).toEqual([]);
      expect(idsWhere(ctx, { created_at: { op: "between", from: "2026-10-09", to: "2026-10-09" } })).toEqual([item.id]);
      expect(idsWhere(ctx, { created_at: { op: "before", to: "2026-10-10" } })).toEqual([item.id]);
      expect(idsWhere(ctx, { created_at: { op: "after", from: "2026-10-09" } })).toEqual([]);
    });
  });

  it("type active keeps unstarted and started items, type backlog keeps the backlog group", () => {
    const { ctx, project: p, states } = setup();
    const backlog = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const todo = createWorkItem(ctx, { project_id: p.id, name: "B", state_id: states.Todo.id });
    const doing = createWorkItem(ctx, { project_id: p.id, name: "C", state_id: states["In Progress"].id });
    createWorkItem(ctx, { project_id: p.id, name: "D", state_id: states.Done.id });
    expect(idsWhere(ctx, { type: "active" })).toEqual([todo.id, doing.id]);
    expect(idsWhere(ctx, { type: "backlog" })).toEqual([backlog.id]);
    expect(idsWhere(ctx, { type: null })).toHaveLength(4);
  });

  it("sub_items false hides children and start_target_date keeps only fully dated items", () => {
    const { ctx, project: p } = setup();
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic", start_date: "2026-10-01", target_date: "2026-10-05" });
    const child = createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: parent.id, start_date: "2026-10-01" });
    expect(idsWhere(ctx, { sub_items: false })).toEqual([parent.id]);
    expect(idsWhere(ctx, { sub_items: true })).toEqual([parent.id, child.id]);
    expect(idsWhere(ctx, { start_target_date: true })).toEqual([parent.id]);
  });

  it("hides triage items unless targeted by state, state_group or include_triage", () => {
    const { ctx, project: p } = setup();
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    const triage = listStates(ctx, p.id).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    const visible = createWorkItem(ctx, { project_id: p.id, name: "Visible" });
    const hidden = createWorkItem(ctx, { project_id: p.id, name: "Hidden" });
    ctx.db.update(work_item).set({ state_id: triage.id }).where(eq(work_item.id, hidden.id)).run();
    expect(idsWhere(ctx, {})).toEqual([visible.id]);
    expect(idsWhere(ctx, { state_group: ["triage"] })).toEqual([hidden.id]);
    expect(idsWhere(ctx, { state: [triage.id] })).toEqual([hidden.id]);
    expect(idsWhere(ctx, {}, { include_triage: true })).toEqual([visible.id, hidden.id]);
  });
});

describe("buildOrder", () => {
  it("defaults to the project-wide sort_order with the sequence as tie-breaker", () => {
    const { ctx, project: p } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "A" });
    createWorkItem(ctx, { project_id: p.id, name: "B" });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    ctx.db.update(work_item).set({ sort_order: "a" }).where(eq(work_item.id, c.id)).run();
    expect(namesOrdered(ctx, p.id, {})).toEqual(["C", "A", "B"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-sort_order" })).toEqual(["B", "A", "C"]);
  });

  it("orders by priority rank: urgent first ascending, none first descending", () => {
    const { ctx, project: p } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "none" });
    createWorkItem(ctx, { project_id: p.id, name: "low", priority: "low" });
    createWorkItem(ctx, { project_id: p.id, name: "urgent", priority: "urgent" });
    createWorkItem(ctx, { project_id: p.id, name: "medium", priority: "medium" });
    createWorkItem(ctx, { project_id: p.id, name: "high", priority: "high" });
    expect(namesOrdered(ctx, p.id, { order_by: "priority" })).toEqual(["urgent", "high", "medium", "low", "none"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-priority" })).toEqual(["none", "low", "medium", "high", "urgent"]);
  });

  it("orders by name case-insensitively and by sequence_id", () => {
    const { ctx, project: p } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "banana" });
    createWorkItem(ctx, { project_id: p.id, name: "Apple" });
    createWorkItem(ctx, { project_id: p.id, name: "cherry" });
    expect(namesOrdered(ctx, p.id, { order_by: "name" })).toEqual(["Apple", "banana", "cherry"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-name" })).toEqual(["cherry", "banana", "Apple"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-sequence_id" })).toEqual(["cherry", "Apple", "banana"]);
  });

  it("puts items without a date last in both directions", () => {
    const { ctx, project: p } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "undated" });
    createWorkItem(ctx, { project_id: p.id, name: "late", target_date: "2026-12-01", start_date: "2026-11-01" });
    createWorkItem(ctx, { project_id: p.id, name: "early", target_date: "2026-10-01", start_date: "2026-09-01" });
    expect(namesOrdered(ctx, p.id, { order_by: "target_date" })).toEqual(["early", "late", "undated"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-target_date" })).toEqual(["late", "early", "undated"]);
    expect(namesOrdered(ctx, p.id, { order_by: "start_date" })).toEqual(["early", "late", "undated"]);
  });

  it("orders by estimate point position, created_at and updated_at", () => {
    const { ctx, clock, project: p } = setup();
    const [one, three, eight] = insertEstimatePoints(ctx, p.id, ["1", "3", "8"]);
    clock.now = "2026-10-02T00:00:00.000Z";
    createWorkItem(ctx, { project_id: p.id, name: "eight", estimate_point_id: eight.id });
    clock.now = "2026-10-03T00:00:00.000Z";
    createWorkItem(ctx, { project_id: p.id, name: "one", estimate_point_id: one.id });
    clock.now = "2026-10-04T00:00:00.000Z";
    const three_ = createWorkItem(ctx, { project_id: p.id, name: "three", estimate_point_id: three.id });
    clock.now = "2026-10-05T00:00:00.000Z";
    createWorkItem(ctx, { project_id: p.id, name: "unestimated" });
    expect(namesOrdered(ctx, p.id, { order_by: "estimate" })).toEqual(["one", "three", "eight", "unestimated"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-estimate" })).toEqual(["eight", "three", "one", "unestimated"]);
    expect(namesOrdered(ctx, p.id, { order_by: "created_at" })).toEqual(["eight", "one", "three", "unestimated"]);
    expect(namesOrdered(ctx, p.id, { order_by: "-created_at" })).toEqual(["unestimated", "three", "one", "eight"]);
    clock.now = "2026-10-06T00:00:00.000Z";
    updateWorkItem(ctx, three_.id, { priority: "high" });
    expect(namesOrdered(ctx, p.id, { order_by: "-updated_at" })[0]).toBe("three");
  });
});

describe("groupItems", () => {
  /** GroupableItems straight from the tables (including triage and archived rows), in sequence order. */
  function items(ctx: TesseraContext, projectId: string): GroupableItem[] {
    const rows = ctx.db.select().from(work_item).where(eq(work_item.project_id, projectId)).orderBy(asc(work_item.sequence_id)).all();
    const ids = (table: typeof work_item_label | typeof work_item_module | typeof work_item_assignee, itemId: string): string[] =>
      ctx.db
        .select()
        .from(table)
        .where(eq(table.work_item_id, itemId))
        .all()
        .map((row) => Object.values(row).find((value) => value !== itemId) as string);
    return rows.map((row) => ({
      ...row,
      label_ids: ids(work_item_label, row.id),
      module_ids: ids(work_item_module, row.id),
      assignee_ids: ids(work_item_assignee, row.id),
    }));
  }

  it("returns no groups when group_by is null", () => {
    const { ctx, project: p } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "A" });
    expect(groupItems(ctx, items(ctx, p.id), display({ group_by: null }), { project_ids: [p.id] })).toEqual([]);
  });

  it("groups by state in state order with names, colours and counts, and never invents a none group", () => {
    const { ctx, project: p, states } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", state_id: states.Cancelled.id });
    const groups = groupItems(ctx, items(ctx, p.id), display({ group_by: "state" }), { project_ids: [p.id] });
    expect(groups.map((g) => [g.id, g.name, g.color, g.count, g.item_ids])).toEqual([
      [states.Backlog.id, "Backlog", "gray", 1, [a.id]],
      [states.Todo.id, "Todo", "blue", 0, []],
      [states["In Progress"].id, "In Progress", "yellow", 0, []],
      [states.Done.id, "Done", "green", 0, []],
      [states.Cancelled.id, "Cancelled", "red", 1, [b.id]],
    ]);
    const compact = groupItems(ctx, items(ctx, p.id), display({ group_by: "state", show_empty_groups: false }), { project_ids: [p.id] });
    expect(compact.map((g) => g.name)).toEqual(["Backlog", "Cancelled"]);
  });

  it("duplicates an item into every label group and collects unlabelled items under none", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const both = createWorkItem(ctx, { project_id: p.id, name: "Both", label_ids: [bug.id, ux.id] });
    const plain = createWorkItem(ctx, { project_id: p.id, name: "Plain" });
    const groups = groupItems(ctx, items(ctx, p.id), display({ group_by: "labels" }), { project_ids: [p.id] });
    expect(groups.map((g) => [g.name, g.item_ids])).toEqual([
      ["Bug", [both.id]],
      ["UX", [both.id]],
      ["None", [plain.id]],
    ]);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(3);
  });

  it("treats the priority value none as a real group, not the synthetic none group", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", priority: "urgent" });
    const groups = groupItems(ctx, items(ctx, p.id), display({ group_by: "priority" }), { project_ids: [p.id] });
    expect(groups.map((g) => [g.id, g.name, g.item_ids])).toEqual([
      ["urgent", "Urgent", [b.id]],
      ["high", "High", []],
      ["medium", "Medium", []],
      ["low", "Low", []],
      ["none", "None", [a.id]],
    ]);
  });

  it("shows the triage state group only when an item is in it", () => {
    const { ctx, project: p } = setup();
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    const triage = listStates(ctx, p.id).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    createWorkItem(ctx, { project_id: p.id, name: "A" });
    expect(groupItems(ctx, items(ctx, p.id), display({ group_by: "state_group" }), { project_ids: [p.id] }).map((g) => g.id)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
    expect(groupItems(ctx, items(ctx, p.id), display({ group_by: "state" }), { project_ids: [p.id] }).map((g) => g.name)).not.toContain("Triage");
    const hidden = createWorkItem(ctx, { project_id: p.id, name: "Hidden" });
    ctx.db.update(work_item).set({ state_id: triage.id }).where(eq(work_item.id, hidden.id)).run();
    const withTriage = groupItems(ctx, items(ctx, p.id), display({ group_by: "state_group", show_empty_groups: false }), { project_ids: [p.id] });
    expect(withTriage.map((g) => [g.id, g.count])).toEqual([
      ["backlog", 1],
      ["triage", 1],
    ]);
  });

  it("keeps items whose value is outside the vocabulary under the raw id", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: insertCycle(ctx, p.id, "Sprint").id });
    const foreign: GroupableItem = { ...item, cycle_id: "ghost-cycle" };
    const groups = groupItems(ctx, [foreign], display({ group_by: "cycle", show_empty_groups: false }), { project_ids: [p.id] });
    expect(groups.map((g) => [g.id, g.name, g.item_ids])).toEqual([["ghost-cycle", "ghost-cycle", [item.id]]]);
  });

  it("orders cycle groups by sort order, actor groups by name and date groups ascending", () => {
    const { ctx, project: p } = setup();
    const second = insertCycle(ctx, p.id, "Second", "a1");
    const first = insertCycle(ctx, p.id, "First", "a0");
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: second.id, assignee_ids: [USER_ACTOR_ID], target_date: "2026-12-01" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", cycle_id: first.id, assignee_ids: [ASSISTANT_ACTOR_ID], target_date: "2026-11-01" });
    const all = items(ctx, p.id);
    expect(groupItems(ctx, all, display({ group_by: "cycle" }), { project_ids: [p.id] }).map((g) => [g.name, g.item_ids])).toEqual([
      ["First", [b.id]],
      ["Second", [a.id]],
      ["None", []],
    ]);
    expect(groupItems(ctx, all, display({ group_by: "assignees", show_empty_groups: false }), { project_ids: [p.id] }).map((g) => [g.name, g.color, g.item_ids])).toEqual([
      ["Assistant", "purple", [b.id]],
      ["You", "blue", [a.id]],
    ]);
    expect(groupItems(ctx, all, display({ group_by: "target_date" }), { project_ids: [p.id] }).map((g) => [g.id, g.item_ids])).toEqual([
      ["2026-11-01", [b.id]],
      ["2026-12-01", [a.id]],
      ["none", []],
    ]);
  });

  it("nests sub_group_by one level and repeats duplicated items in each parent group", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const both = createWorkItem(ctx, { project_id: p.id, name: "Both", label_ids: [bug.id, ux.id], priority: "high" });
    const low = createWorkItem(ctx, { project_id: p.id, name: "Low", label_ids: [bug.id], priority: "low" });
    const groups = groupItems(ctx, items(ctx, p.id), display({ group_by: "labels", sub_group_by: "priority", show_empty_groups: false }), { project_ids: [p.id] });
    expect(groups.map((g) => [g.name, g.sub_groups?.map((s) => [s.id, s.item_ids])])).toEqual([
      [
        "Bug",
        [
          ["high", [both.id]],
          ["low", [low.id]],
        ],
      ],
      ["UX", [["high", [both.id]]]],
    ]);
    const flat = groupItems(ctx, items(ctx, p.id), display({ group_by: "labels" }), { project_ids: [p.id] });
    expect(flat.every((g) => g.sub_groups === undefined)).toBe(true);
  });

  it("show_empty_groups false hides empty sub-groups", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const only = createWorkItem(ctx, { project_id: p.id, name: "Only", label_ids: [bug.id], priority: "high" });
    const hidden = groupItems(ctx, items(ctx, p.id), display({ group_by: "labels", sub_group_by: "priority", show_empty_groups: false }), { project_ids: [p.id] });
    expect(hidden.map((g) => [g.name, g.sub_groups?.map((s) => [s.id, s.item_ids])])).toEqual([["Bug", [["high", [only.id]]]]]);
    const shown = groupItems(ctx, items(ctx, p.id), display({ group_by: "labels", sub_group_by: "priority", show_empty_groups: true }), { project_ids: [p.id] });
    const bugGroup = shown.find((g) => g.name === "Bug");
    expect(bugGroup?.sub_groups?.map((s) => s.id)).toEqual(["urgent", "high", "medium", "low", "none"]);
    expect(bugGroup?.sub_groups?.filter((s) => s.item_ids.length === 0)).toHaveLength(4);
  });
});
