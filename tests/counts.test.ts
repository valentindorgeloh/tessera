import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { addDays } from "@/lib/tessera/core/time";
import { getCounts, type Counts, type CountsScope } from "@/lib/tessera/counts";
import { listCycles } from "@/lib/tessera/cycles";
import { estimate, estimate_point, project } from "@/lib/tessera/db/schema";
import { listLabels } from "@/lib/tessera/labels";
import { listModules } from "@/lib/tessera/modules";
import { archiveProject, createProject, listProjects, updateProjectFeatures } from "@/lib/tessera/projects";
import { PrioritySchema, StateGroupSchema } from "@/lib/tessera/schemas";
import { seedDemo } from "@/lib/tessera/seed";
import { listStates } from "@/lib/tessera/states";
import type { Priority, StateGroup } from "@/lib/tessera/types";
import { createView } from "@/lib/tessera/views";
import { archiveWorkItem, createWorkItem, deleteWorkItem, listWorkItems, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "./helpers/db";

const TODAY = "2026-10-10";

function contextFor(handles: DbHandles, actorId: string = USER_ACTOR_ID): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId, today: () => TODAY });
}

function setup(): { handles: DbHandles; ctx: TesseraContext } {
  const handles = createTestDb();
  return { handles, ctx: contextFor(handles) };
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

// ---------------------------------------------------------------------------
// Independent SQL over the same population: non-deleted, non-archived, non-triage.
// ---------------------------------------------------------------------------

const LIVE_PROJECT = "w.project_id IN (SELECT id FROM project WHERE deleted_at IS NULL AND archived_at IS NULL)";

function rawCounts(ctx: TesseraContext, extra: string, params: unknown[]): Counts {
  const base = `FROM work_item w JOIN state s ON s.id = w.state_id WHERE w.deleted_at IS NULL AND w.archived_at IS NULL AND s.state_group != 'triage' AND (${extra})`;
  const sqlite = ctx.sqlite;
  const total = sqlite.prepare<unknown[], { n: number }>(`SELECT count(*) AS n ${base}`).get(...params)?.n ?? 0;
  const by_state_group = Object.fromEntries(StateGroupSchema.options.map((group) => [group, 0])) as Record<StateGroup, number>;
  for (const row of sqlite.prepare<unknown[], { k: StateGroup; n: number }>(`SELECT s.state_group AS k, count(*) AS n ${base} GROUP BY k`).all(...params)) {
    by_state_group[row.k] = row.n;
  }
  const by_state: Record<string, number> = {};
  for (const row of sqlite.prepare<unknown[], { k: string; n: number }>(`SELECT w.state_id AS k, count(*) AS n ${base} GROUP BY k`).all(...params)) by_state[row.k] = row.n;
  const by_priority = Object.fromEntries(PrioritySchema.options.map((priority) => [priority, 0])) as Record<Priority, number>;
  for (const row of sqlite.prepare<unknown[], { k: Priority; n: number }>(`SELECT w.priority AS k, count(*) AS n ${base} GROUP BY k`).all(...params)) by_priority[row.k] = row.n;
  const by_assignee: Record<string, number> = {};
  for (const row of sqlite
    .prepare<unknown[], { k: string; n: number }>(`SELECT a.actor_id AS k, count(*) AS n FROM work_item_assignee a WHERE a.work_item_id IN (SELECT w.id ${base}) GROUP BY k`)
    .all(...params)) {
    by_assignee[row.k] = row.n;
  }
  const by_label: Record<string, number> = {};
  for (const row of sqlite
    .prepare<unknown[], { k: string; n: number }>(`SELECT l.label_id AS k, count(*) AS n FROM work_item_label l WHERE l.work_item_id IN (SELECT w.id ${base}) GROUP BY k`)
    .all(...params)) {
    by_label[row.k] = row.n;
  }
  const overdue =
    sqlite
      .prepare<unknown[], { n: number }>(`SELECT count(*) AS n ${base} AND w.target_date < ? AND s.state_group NOT IN ('completed', 'cancelled')`)
      .get(...params, TODAY)?.n ?? 0;
  const due_this_week =
    sqlite.prepare<unknown[], { n: number }>(`SELECT count(*) AS n ${base} AND w.target_date >= ? AND w.target_date <= ?`).get(...params, TODAY, addDays(TODAY, 6))?.n ?? 0;
  return { total, by_state_group, by_state, by_priority, by_assignee, by_label, overdue, due_this_week };
}

type SeededScope = { name: string; scope: CountsScope; extra: string; params: unknown[] };

function seededScopes(ctx: TesseraContext): SeededScope[] {
  const { project: web } = seedDemo(ctx);
  const cycles = listCycles(ctx, web.id);
  const modules = listModules(ctx, web.id);
  const bug = listLabels(ctx, web.id).find((label) => label.name === "Bug");
  if (!bug) throw new Error("seed has no Bug label");
  const projectView = createView(ctx, {
    project_id: web.id,
    name: "Open bugs (test)",
    filters: { labels: [bug.id], state_group: ["backlog", "unstarted", "started"] },
  });
  const workspaceView = createView(ctx, { project_id: null, name: "Urgent (test)", filters: { priority: ["urgent", "high"] } });
  return [
    { name: "workspace", scope: { type: "workspace" }, extra: LIVE_PROJECT, params: [] },
    { name: "project", scope: { type: "project", project_id: web.id }, extra: "w.project_id = ?", params: [web.id] },
    ...cycles.map((cycle) => ({ name: `cycle ${cycle.name}`, scope: { type: "cycle", cycle_id: cycle.id } as const, extra: "w.cycle_id = ?", params: [cycle.id] })),
    ...modules.map((module) => ({
      name: `module ${module.name}`,
      scope: { type: "module", module_id: module.id } as const,
      extra: "w.id IN (SELECT work_item_id FROM work_item_module WHERE module_id = ?)",
      params: [module.id],
    })),
    {
      name: "project view",
      scope: { type: "view", view_id: projectView.id },
      extra: "w.project_id = ? AND w.id IN (SELECT work_item_id FROM work_item_label WHERE label_id = ?) AND s.state_group IN ('backlog', 'unstarted', 'started')",
      params: [web.id, bug.id],
    },
    {
      name: "workspace view",
      scope: { type: "view", view_id: workspaceView.id },
      extra: `${LIVE_PROJECT} AND w.priority IN ('urgent', 'high')`,
      params: [],
    },
    ...[USER_ACTOR_ID, ASSISTANT_ACTOR_ID].map((actorId) => ({
      name: `profile ${actorId}`,
      scope: { type: "profile", actor_id: actorId } as const,
      extra: `${LIVE_PROJECT} AND w.id IN (SELECT work_item_id FROM work_item_assignee WHERE actor_id = ?)`,
      params: [actorId],
    })),
  ];
}

describe("getCounts on the seeded project", () => {
  it("equals independent SQL counts for every scope", () => {
    const { ctx } = setup();
    for (const { name, scope, extra, params } of seededScopes(ctx)) {
      const expected = rawCounts(ctx, extra, params);
      expect(getCounts(ctx, scope), name).toEqual(expected);
      expect(expected.total, `${name} is not empty`).toBeGreaterThan(0);
    }
  });

  it("agrees with listWorkItems totals for the same scope", () => {
    const { ctx } = setup();
    for (const { name, scope } of seededScopes(ctx)) {
      if (scope.type === "profile") continue;
      const listed = listWorkItems(ctx, { scope }).total;
      expect(getCounts(ctx, scope).total, name).toBe(listed);
    }
  });

  it("counts the seeded overdue and due-this-week items", () => {
    const { ctx } = setup();
    const { project: web } = seedDemo(ctx);
    const counts = getCounts(ctx, { type: "project", project_id: web.id });
    expect(counts.overdue).toBe(2);
    expect(counts.due_this_week).toBe(9);
    expect(counts.total_points).toBeUndefined();
    expect(counts.completed_points).toBeUndefined();
  });

  it("sums state groups, states and priorities to the total", () => {
    const { ctx } = setup();
    const { project: web } = seedDemo(ctx);
    const counts = getCounts(ctx, { type: "project", project_id: web.id });
    const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);
    expect(sum(counts.by_state_group)).toBe(counts.total);
    expect(sum(counts.by_state)).toBe(counts.total);
    expect(sum(counts.by_priority)).toBe(counts.total);
    expect(counts.by_state_group.triage).toBe(0);
  });
});

describe("getCounts population rules", () => {
  it("returns zeros with every state group and priority key for an empty project", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Empty", identifier: "EMP" });
    const counts = getCounts(ctx, { type: "project", project_id: p.id });
    expect(counts.total).toBe(0);
    expect(Object.keys(counts.by_state_group).sort()).toEqual([...StateGroupSchema.options].sort());
    expect(Object.keys(counts.by_priority).sort()).toEqual([...PrioritySchema.options].sort());
    expect(counts.by_state).toEqual({});
    expect(counts.by_assignee).toEqual({});
    expect(counts.by_label).toEqual({});
    expect(counts.overdue).toBe(0);
    expect(counts.due_this_week).toBe(0);
    expect("total_points" in counts).toBe(false);
  });

  it("excludes archived and deleted items", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const done = listStates(ctx, p.id).find((s) => s.state_group === "completed");
    if (!done) throw new Error("no completed state");
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", state_id: done.id });
    createWorkItem(ctx, { project_id: p.id, name: "B" });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    const scope: CountsScope = { type: "project", project_id: p.id };
    expect(getCounts(ctx, scope).total).toBe(3);
    archiveWorkItem(ctx, a.id);
    expect(getCounts(ctx, scope).total).toBe(2);
    expect(getCounts(ctx, scope).by_state_group.completed).toBe(0);
    deleteWorkItem(ctx, c.id);
    expect(getCounts(ctx, scope).total).toBe(1);
  });

  it("excludes items waiting in the hidden triage state", () => {
    const { handles, ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true, agent_intake_required: true } });
    createWorkItem(ctx, { project_id: p.id, name: "Visible" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:test" });
    createWorkItem(contextFor(handles, agent.id), { project_id: p.id, name: "Via intake" });
    const counts = getCounts(ctx, { type: "project", project_id: p.id });
    expect(counts.total).toBe(1);
    expect(counts.by_state_group.triage).toBe(0);
  });

  it("listProjects counts equal getCounts", () => {
    const { handles, ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true, agent_intake_required: true } });
    const live = createWorkItem(ctx, { project_id: p.id, name: "Live" });
    createWorkItem(ctx, { project_id: p.id, name: "Sub", parent_id: live.id });
    const done = listStates(ctx, p.id).find((row) => row.state_group === "completed");
    const old = createWorkItem(ctx, { project_id: p.id, name: "Archived", state_id: done?.id });
    const gone = createWorkItem(ctx, { project_id: p.id, name: "Deleted" });
    archiveWorkItem(ctx, old.id);
    deleteWorkItem(ctx, gone.id);
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:parity" });
    createWorkItem(contextFor(handles, agent.id), { project_id: p.id, name: "Via intake" });
    const listed = listProjects(ctx, {}).find((row) => row.id === p.id);
    const counts = getCounts(ctx, { type: "project", project_id: p.id });
    expect(counts.total).toBe(2);
    expect(listed?.counts.total).toBe(counts.total);
    expect(listed?.counts.by_state_group).toEqual(counts.by_state_group);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).total).toBe(counts.total);
  });

  it("workspace and profile scopes skip archived projects", () => {
    const { ctx } = setup();
    const live = createProject(ctx, { name: "Live", identifier: "LIVE" });
    const old = createProject(ctx, { name: "Old", identifier: "OLD" });
    createWorkItem(ctx, { project_id: live.id, name: "Keep", assignee_ids: [USER_ACTOR_ID] });
    createWorkItem(ctx, { project_id: old.id, name: "Gone", assignee_ids: [USER_ACTOR_ID] });
    expect(getCounts(ctx, { type: "workspace" }).total).toBe(2);
    expect(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID }).total).toBe(2);
    archiveProject(ctx, old.id);
    expect(getCounts(ctx, { type: "workspace" }).total).toBe(1);
    expect(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID }).total).toBe(1);
  });

  it("profile scope counts only items assigned to the actor", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const mine = createWorkItem(ctx, { project_id: p.id, name: "Mine", assignee_ids: [USER_ACTOR_ID] });
    createWorkItem(ctx, { project_id: p.id, name: "Theirs", assignee_ids: [ASSISTANT_ACTOR_ID] });
    createWorkItem(ctx, { project_id: p.id, name: "Nobody" });
    expect(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID }).total).toBe(1);
    expect(getCounts(ctx, { type: "profile", actor_id: ASSISTANT_ACTOR_ID }).total).toBe(1);
    setAssignees(ctx, mine.id, [USER_ACTOR_ID, ASSISTANT_ACTOR_ID]);
    expect(getCounts(ctx, { type: "profile", actor_id: ASSISTANT_ACTOR_ID }).total).toBe(2);
    expect(getCounts(ctx, { type: "profile", actor_id: ASSISTANT_ACTOR_ID }).by_assignee).toEqual({ [USER_ACTOR_ID]: 1, [ASSISTANT_ACTOR_ID]: 2 });
  });

  it("overdue needs a past target date and an open state; due_this_week is [today, today + 6] whatever the state", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.state_group, s]));
    const make = (name: string, group: StateGroup, target: number) =>
      createWorkItem(ctx, { project_id: p.id, name, state_id: states[group].id, target_date: addDays(TODAY, target) });
    make("overdue todo", "unstarted", -1);
    make("overdue started", "started", -30);
    make("past but done", "completed", -1);
    make("past but cancelled", "cancelled", -1);
    make("due today", "backlog", 0);
    make("due in six days", "unstarted", 6);
    make("due in seven days", "unstarted", 7);
    make("done this week", "completed", 2);
    createWorkItem(ctx, { project_id: p.id, name: "no date" });
    const counts = getCounts(ctx, { type: "project", project_id: p.id });
    expect(counts.overdue).toBe(2);
    expect(counts.due_this_week).toBe(3);
    expect(counts.total).toBe(9);
  });

  it("counts by assignee and by label once per membership", () => {
    const { ctx } = setup();
    const { project: web } = seedDemo(ctx);
    const counts = getCounts(ctx, { type: "project", project_id: web.id });
    const labels = listLabels(ctx, web.id);
    const items = listWorkItems(ctx, { scope: { type: "project", project_id: web.id } }).items;
    for (const label of labels) {
      const expected = items.filter((item) => item.label_ids.includes(label.id)).length;
      if (expected === 0) expect(counts.by_label[label.id]).toBeUndefined();
      else expect(counts.by_label[label.id]).toBe(expected);
    }
    expect(counts.by_assignee[USER_ACTOR_ID]).toBe(items.filter((item) => item.assignee_ids.includes(USER_ACTOR_ID)).length);
    expect(counts.by_assignee[ASSISTANT_ACTOR_ID]).toBe(items.filter((item) => item.assignee_ids.includes(ASSISTANT_ACTOR_ID)).length);
  });

  it("view scope applies the saved display type and sub_items like the list does", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.state_group, s]));
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Parent", state_id: states.unstarted.id });
    createWorkItem(ctx, { project_id: p.id, name: "Child", state_id: states.unstarted.id, parent_id: parent.id });
    createWorkItem(ctx, { project_id: p.id, name: "Backlog item", state_id: states.backlog.id });
    const active = createView(ctx, { project_id: p.id, name: "Active", display: { type: "active" } });
    const topLevel = createView(ctx, { project_id: p.id, name: "Top", display: { sub_items: false } });
    expect(getCounts(ctx, { type: "view", view_id: active.id }).total).toBe(2);
    expect(getCounts(ctx, { type: "view", view_id: topLevel.id }).total).toBe(2);
    expect(getCounts(ctx, { type: "view", view_id: active.id }).total).toBe(listWorkItems(ctx, { scope: { type: "view", view_id: active.id } }).total);
    expect(getCounts(ctx, { type: "view", view_id: topLevel.id }).total).toBe(listWorkItems(ctx, { scope: { type: "view", view_id: topLevel.id } }).total);
  });

  it("view scope never counts archived items even when the view asks for them", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const done = listStates(ctx, p.id).find((s) => s.state_group === "completed");
    if (!done) throw new Error("no completed state");
    const item = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: done.id });
    archiveWorkItem(ctx, item.id);
    const archived = createView(ctx, { project_id: p.id, name: "Archived", filters: { archived: true } });
    expect(getCounts(ctx, { type: "view", view_id: archived.id }).total).toBe(0);
  });

  it("cycle scope follows the item's current cycle", () => {
    const { ctx } = setup();
    const { project: web } = seedDemo(ctx);
    const [first, second] = listCycles(ctx, web.id);
    const before = getCounts(ctx, { type: "cycle", cycle_id: first.id }).total;
    const item = listWorkItems(ctx, { scope: { type: "cycle", cycle_id: first.id } }).items[0];
    updateWorkItem(ctx, item.id, { cycle_id: second.id });
    expect(getCounts(ctx, { type: "cycle", cycle_id: first.id }).total).toBe(before - 1);
  });

  it("reports point totals only when the project has an active estimate system", () => {
    const { ctx } = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.state_group, s]));
    const now = ctx.now();
    const audit = { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
    const est = ctx.db.insert(estimate).values({ id: newId(), project_id: p.id, name: "Points", ...audit }).returning().get();
    const points = ["1", "3", "5"].map((value, position) =>
      ctx.db.insert(estimate_point).values({ id: newId(), estimate_id: est.id, position, value, ...audit }).returning().get(),
    );
    ctx.db.update(project).set({ estimate_id: est.id }).where(eq(project.id, p.id)).run();
    createWorkItem(ctx, { project_id: p.id, name: "One", estimate_point_id: points[0].id });
    createWorkItem(ctx, { project_id: p.id, name: "Three done", state_id: states.completed.id, estimate_point_id: points[1].id });
    createWorkItem(ctx, { project_id: p.id, name: "Five done", state_id: states.completed.id, estimate_point_id: points[2].id });
    createWorkItem(ctx, { project_id: p.id, name: "Unestimated" });
    const scope: CountsScope = { type: "project", project_id: p.id };
    expect(getCounts(ctx, scope).total_points).toBeUndefined();
    updateProjectFeatures(ctx, p.id, { estimates_enabled: true });
    const counts = getCounts(ctx, scope);
    expect(counts.total_points).toBe(9);
    expect(counts.completed_points).toBe(8);
    expect(getCounts(ctx, { type: "workspace" }).total_points).toBe(9);
  });

  it("NOT_FOUND for unknown scoped entities and VALIDATION for a malformed scope", () => {
    const { ctx } = setup();
    expect(errorCode(() => getCounts(ctx, { type: "project", project_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getCounts(ctx, { type: "cycle", cycle_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getCounts(ctx, { type: "module", module_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getCounts(ctx, { type: "view", view_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getCounts(ctx, { type: "profile", actor_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getCounts(ctx, { type: "project", project_id: "nope" }))).toBe("VALIDATION");
    expect(errorCode(() => getCounts(ctx, { type: "team" } as never))).toBe("VALIDATION");
  });
});
