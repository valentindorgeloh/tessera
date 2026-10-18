import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { getCounts, type Counts } from "@/lib/tessera/counts";
import { createProject, type Project } from "@/lib/tessera/projects";
import { getAnalytics } from "@/lib/tessera/analytics";
import type { StateGroup } from "@/lib/tessera/types";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "../helpers/db";

const TODAY = "2026-10-18";

function setup(): { handles: DbHandles; ctx: TesseraContext; web: Project; ops: Project } {
  const handles = createTestDb();
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => TODAY, now: () => "2026-10-18T12:00:00.000Z" });
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  const ops = createProject(ctx, { name: "Ops", identifier: "OPS" });
  const first = createWorkItem(ctx, { project_id: web.id, name: "Login", priority: "high" });
  createWorkItem(ctx, { project_id: web.id, name: "Signup", priority: "low" });
  const third = createWorkItem(ctx, { project_id: ops.id, name: "Deploy", priority: "urgent" });
  setAssignees(ctx, first.id, [USER_ACTOR_ID]);
  setAssignees(ctx, third.id, [USER_ACTOR_ID]);
  return { handles, ctx, web, ops };
}

function openOf(counts: Counts): number {
  return counts.total - counts.by_state_group.completed - counts.by_state_group.cancelled;
}

function expectShared(ctx: TesseraContext, projectIds: string[] | undefined, counts: Counts) {
  const overview = getAnalytics(ctx, { tab: "overview", project_ids: projectIds, range: "30d" });
  if (overview.tab !== "overview") throw new Error("overview");
  expect(overview.kpis.work_items).toBe(counts.total);
  expect(overview.kpis.open).toBe(openOf(counts));
  expect(overview.kpis.completed).toBe(counts.by_state_group.completed);
  expect(overview.kpis.overdue).toBe(counts.overdue);
  expect(overview.kpis.due_this_week).toBe(counts.due_this_week);
  expect(overview.by_state_group).toEqual(counts.by_state_group);
  expect(overview.by_priority).toEqual(counts.by_priority);
  const work = getAnalytics(ctx, { tab: "work-items", project_ids: projectIds, x_axis: "state_group", range: "30d" });
  if (work.tab !== "work-items") throw new Error("work-items");
  const byGroup = Object.fromEntries(work.buckets.map((bucket) => [bucket.key, bucket.total])) as Record<StateGroup, number>;
  expect(byGroup).toEqual(counts.by_state_group);
  const priority = getAnalytics(ctx, { tab: "work-items", project_ids: projectIds, x_axis: "priority", range: "30d" });
  if (priority.tab !== "work-items") throw new Error("priority");
  expect(Object.fromEntries(priority.buckets.map((bucket) => [bucket.key, bucket.total]))).toEqual(counts.by_priority);
  const assignees = getAnalytics(ctx, { tab: "work-items", project_ids: projectIds, x_axis: "assignee", range: "30d" });
  if (assignees.tab !== "work-items") throw new Error("assignee");
  const byAssignee = Object.fromEntries(assignees.buckets.filter((bucket) => bucket.key !== "none").map((bucket) => [bucket.key, bucket.total]));
  expect(byAssignee).toEqual(counts.by_assignee);
  expect(work.total).toBe(counts.total);
}

describe("analytics counts parity", () => {
  it("matches getCounts for the workspace, one project and two projects", () => {
    const { ctx, web, ops } = setup();
    expectShared(ctx, undefined, getCounts(ctx, { type: "workspace" }));
    expectShared(ctx, [web.id], getCounts(ctx, { type: "project", project_id: web.id }));
    expectShared(ctx, [web.id, ops.id], getCounts(ctx, { type: "workspace", project_ids: [web.id, ops.id] }));
  });
});
