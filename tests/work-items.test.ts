import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { setAssignees, subscribe, unsubscribe } from "@/lib/tessera/assignees";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { localDateOf } from "@/lib/tessera/core/time";
import { searchWorkItemIds } from "@/lib/tessera/db/fts";
import {
  activity,
  cycle,
  estimate,
  estimate_point,
  intake,
  intake_item,
  moduleTable,
  project,
  view,
  work_item,
  work_item_assignee,
  work_item_label,
  work_item_link,
  work_item_module,
  work_item_subscriber,
} from "@/lib/tessera/db/schema";
import { createLabel } from "@/lib/tessera/labels";
import { archiveProject, createProject, updateProject, updateProjectFeatures, type Project } from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import { createState, listStates } from "@/lib/tessera/states";
import type { Display, Filters, StateRow } from "@/lib/tessera/types";
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  copyWorkItem,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  getWorkItemByKey,
  listChildren,
  listWorkItems,
  moveWorkItem,
  moveWorkItemToProject,
  setLabels,
  setModules,
  unarchiveWorkItem,
  updateWorkItem,
  updateWorkItemDescription,
} from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles, type TesseraContext } from "./helpers/db";

type Fixture = { handles: DbHandles; ctx: TesseraContext; project: Project; states: Record<string, StateRow> };

function setup(): Fixture {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, p.id).map((s) => [s.name, s]));
  return { handles, ctx, project: p, states };
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

function ruleName(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError && err.code === "RULE") return (err.details as { rule: string }).rule;
    throw err;
  }
  return undefined;
}

function audit(ctx: TesseraContext) {
  const now = ctx.now();
  return { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function insertCycle(ctx: TesseraContext, projectId: string, name: string, extra: Partial<typeof cycle.$inferInsert> = {}) {
  return ctx.db
    .insert(cycle)
    .values({ id: newId(), project_id: projectId, name, sort_order: firstSortOrder(), ...audit(ctx), ...extra })
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

function insertEstimatePoint(ctx: TesseraContext, projectId: string, value = "3") {
  const est = ctx.db
    .insert(estimate)
    .values({ id: newId(), project_id: projectId, name: "Points", ...audit(ctx) })
    .returning()
    .get();
  return ctx.db
    .insert(estimate_point)
    .values({ id: newId(), estimate_id: est.id, position: 0, value, ...audit(ctx) })
    .returning()
    .get();
}

function insertLink(ctx: TesseraContext, workItemId: string, url: string) {
  return ctx.db
    .insert(work_item_link)
    .values({ id: newId(), work_item_id: workItemId, url, sort_order: firstSortOrder(), ...audit(ctx) })
    .returning()
    .get();
}

function insertView(ctx: TesseraContext, projectId: string | null, name: string, filters: Filters, display: Partial<Display> = {}) {
  return ctx.db
    .insert(view)
    .values({
      id: newId(),
      project_id: projectId,
      name,
      name_key: name.toLowerCase(),
      filters,
      display: { ...DEFAULT_DISPLAY, ...display },
      sort_order: firstSortOrder(),
      ...audit(ctx),
    })
    .returning()
    .get();
}

function labelIds(ctx: TesseraContext, workItemId: string): string[] {
  return ctx.db
    .select()
    .from(work_item_label)
    .where(eq(work_item_label.work_item_id, workItemId))
    .all()
    .map((r) => r.label_id);
}

function subscriberIds(ctx: TesseraContext, workItemId: string): string[] {
  return ctx.db
    .select()
    .from(work_item_subscriber)
    .where(eq(work_item_subscriber.work_item_id, workItemId))
    .all()
    .map((r) => r.actor_id);
}

function rawRow(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(work_item).where(eq(work_item.id, id)).get();
  if (!row) throw new Error("row missing");
  return row;
}

function agentContext(f: Fixture, name = "mcp:claude-code") {
  const agent = registerActor(f.ctx, { kind: "agent", name });
  return { agent, actx: createContext({ db: f.handles.db, sqlite: f.handles.sqlite, actorId: agent.id }) };
}

describe("createWorkItem", () => {
  it("allocates sequence ids inside the insert transaction and never reuses them", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B" });
    expect([a.sequence_id, b.sequence_id]).toEqual([1, 2]);
    expect([a.key, b.key]).toEqual(["WEB-1", "WEB-2"]);
    deleteWorkItem(ctx, b.id);
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    expect(c.sequence_id).toBe(3);
    expect(ctx.db.select().from(project).where(eq(project.id, p.id)).get()?.next_sequence).toBe(4);
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createWorkItem(ctx, { project_id: other.id, name: "X" }).key).toBe("OTH-1");
  });

  it("falls back to the project default state when state_id is missing", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    expect(item.state_id).toBe(states.Backlog.id);
    expect(item.priority).toBe("none");
    expect(item.completed_at).toBeNull();
    expect(item.description_version).toBe(0);
    const todo = createWorkItem(ctx, { project_id: p.id, name: "B", state_id: states.Todo.id });
    expect(todo.state_id).toBe(states.Todo.id);
  });

  it("sets completed_at when created directly in a completed state", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", state_id: states.Done.id });
    expect(item.completed_at).not.toBeNull();
  });

  it("rejects states, labels, parent, cycle, modules and estimate points of another project", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const otherStates = listStates(ctx, other.id);
    const otherLabel = createLabel(ctx, { project_id: other.id, name: "Bug" });
    const otherItem = createWorkItem(ctx, { project_id: other.id, name: "Elsewhere" });
    const otherCycle = insertCycle(ctx, other.id, "Sprint");
    const otherModule = insertModule(ctx, other.id, "Core");
    const otherPoint = insertEstimatePoint(ctx, other.id);
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", state_id: otherStates[0].id }))).toBe("state_project");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [otherLabel.id] }))).toBe("label_project");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", parent_id: otherItem.id }))).toBe("parent_project");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: otherCycle.id }))).toBe("cycle_project");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", module_ids: [otherModule.id] }))).toBe("module_project");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", estimate_point_id: otherPoint.id }))).toBe("estimate_point_project");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [newId()] }))).toBe("NOT_FOUND");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: newId() }))).toBe("NOT_FOUND");
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).total).toBe(0);
  });

  it("accepts labels, parent, cycle, modules and estimate point of its own project", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const core = insertModule(ctx, p.id, "Core");
    const point = insertEstimatePoint(ctx, p.id);
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const item = createWorkItem(ctx, {
      project_id: p.id,
      name: "Child",
      label_ids: [bug.id],
      parent_id: parent.id,
      cycle_id: sprint.id,
      module_ids: [core.id],
      estimate_point_id: point.id,
      start_date: "2026-10-01",
      target_date: "2026-10-10",
    });
    expect(item.label_ids).toEqual([bug.id]);
    expect(item.module_ids).toEqual([core.id]);
    expect(item.parent_id).toBe(parent.id);
    expect(item.cycle_id).toBe(sprint.id);
    expect(item.estimate_point_id).toBe(point.id);
    expect(getWorkItem(ctx, parent.id).sub_items_count).toBe(1);
  });

  it("requires start_date <= target_date", () => {
    const { ctx, project: p } = setup();
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", start_date: "2026-10-11", target_date: "2026-10-10" }))).toBe("date_order");
    expect(createWorkItem(ctx, { project_id: p.id, name: "A", start_date: "2026-10-10", target_date: "2026-10-10" }).target_date).toBe("2026-10-10");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", target_date: "10/10/2026" }))).toBe("VALIDATION");
  });

  it("requires assignees to be live actors and subscribes them together with the creator", () => {
    const { ctx, project: p } = setup();
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", assignee_ids: [newId()] }))).toBe("NOT_FOUND");
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", assignee_ids: [ASSISTANT_ACTOR_ID] });
    expect(item.assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(subscriberIds(ctx, item.id).sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID].sort());
  });

  it("applies the project default assignee when no assignees are given", () => {
    const { ctx, project: p } = setup();
    updateProject(ctx, p.id, { default_assignee_id: ASSISTANT_ACTOR_ID });
    expect(createWorkItem(ctx, { project_id: p.id, name: "A" }).assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(createWorkItem(ctx, { project_id: p.id, name: "B", assignee_ids: [USER_ACTOR_ID] }).assignee_ids).toEqual([USER_ACTOR_ID]);
  });

  it("writes the FTS row and one created activity row with the key", () => {
    const { ctx, project: p } = setup();
    const seqBefore = latestSeq(ctx);
    const item = createWorkItem(ctx, { project_id: p.id, name: "Login button", description_md: "Fix the **button** on checkout" });
    expect(searchWorkItemIds(ctx.sqlite, "checkout")).toEqual([item.id]);
    expect(searchWorkItemIds(ctx.sqlite, "login")).toEqual([item.id]);
    const rows = activityRows(ctx, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "created", entity_type: "work_item", work_item_id: item.id, project_id: p.id, new_identifier: "WEB-1", actor_id: ctx.actor.id });
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
  });

  it("validates input and refuses archived projects, unknown projects and the triage state", () => {
    const { ctx, project: p } = setup();
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "" }))).toBe("VALIDATION");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", priority: "critical" as "high" }))).toBe("VALIDATION");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => createWorkItem(ctx, { project_id: newId(), name: "A" }))).toBe("NOT_FOUND");
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    const triage = listStates(ctx, p.id).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", state_id: triage.id }))).toBe("triage_state");
    archiveProject(ctx, p.id);
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A" }))).toBe("ARCHIVED");
  });

  it("refuses to place a completed item into a cycle", () => {
    const { ctx, project: p, states } = setup();
    const sprint = insertCycle(ctx, p.id, "Sprint");
    expect(ruleName(() => createWorkItem(ctx, { project_id: p.id, name: "A", state_id: states.Done.id, cycle_id: sprint.id }))).toBe("cycle_closed_item");
  });
});

describe("intake policy", () => {
  it("an agent's create lands in triage with a pending intake item when agent_intake_required is on", () => {
    const f = setup();
    const { ctx, project: p } = f;
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    const { agent, actx } = agentContext(f);
    const item = createWorkItem(actx, { project_id: p.id, name: "From an agent" });
    const triage = listStates(ctx, p.id).find((s) => s.state_group === "triage");
    expect(item.state_id).toBe(triage?.id);
    expect(item.intake).toEqual({ status: "pending" });
    expect(item.created_by).toBe(agent.id);
    const rows = ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, item.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", source: "mcp", created_by_actor_id: agent.id });
    const defaultIntake = ctx.db.select().from(intake).where(and(eq(intake.project_id, p.id), eq(intake.is_default, true))).get();
    expect(rows[0].intake_id).toBe(defaultIntake?.id);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).items.map((i) => i.id)).not.toContain(item.id);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, filters: { state_group: ["triage"] } }).items.map((i) => i.id)).toEqual([item.id]);
    expect(getWorkItem(ctx, item.id).intake).toEqual({ status: "pending" });
  });

  it("ignores a requested state and honours the source for intake creates", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    const { actx } = agentContext(f);
    const item = createWorkItem(actx, { project_id: p.id, name: "Routed", state_id: states.Todo.id, source: "assistant" });
    expect(item.state_id).not.toBe(states.Todo.id);
    expect(ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, item.id)).get()?.source).toBe("assistant");
  });

  it("creates the default intake row when it is missing", () => {
    const f = setup();
    const { ctx, project: p } = f;
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    ctx.db.update(intake).set({ deleted_at: ctx.now() }).where(eq(intake.project_id, p.id)).run();
    const { actx } = agentContext(f);
    const item = createWorkItem(actx, { project_id: p.id, name: "Needs an intake" });
    const live = ctx.db.select().from(intake).where(and(eq(intake.project_id, p.id), isNull(intake.deleted_at))).all();
    expect(live).toHaveLength(1);
    expect(live[0].is_default).toBe(true);
    expect(ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, item.id)).get()?.intake_id).toBe(live[0].id);
  });

  it("does not apply to users, nor to agents when the policy is off", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    const { actx } = agentContext(f);
    const direct = createWorkItem(actx, { project_id: p.id, name: "Direct" });
    expect(direct.state_id).toBe(states.Backlog.id);
    expect(direct.intake).toBeNull();
    updateProjectFeatures(ctx, p.id, { agent_intake_required: true });
    const byUser = createWorkItem(ctx, { project_id: p.id, name: "By the user" });
    expect(byUser.state_id).toBe(states.Backlog.id);
    expect(byUser.intake).toBeNull();
    expect(createWorkItem(actx, { project_id: p.id, name: "By the agent" }).intake).toEqual({ status: "pending" });
  });

  it("a pending intake item cannot leave triage via updateWorkItem, bulkUpdateWorkItems or moveWorkItem", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    const { actx } = agentContext(f);
    const item = createWorkItem(actx, { project_id: p.id, name: "Pending" });
    const triageId = item.state_id;
    const visible = () => listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).total;
    expect(visible()).toBe(0);
    expect(ruleName(() => updateWorkItem(actx, item.id, { state_id: states.Todo.id }))).toBe("intake_pending");
    expect(ruleName(() => updateWorkItem(ctx, item.id, { state_id: states.Todo.id }))).toBe("intake_pending");
    expect(ruleName(() => bulkUpdateWorkItems(actx, [item.id], { state_id: states.Done.id }))).toBe("intake_pending");
    expect(ruleName(() => moveWorkItem(actx, item.id, { group_by: "state", value: states.Todo.id }))).toBe("intake_pending");
    expect(getWorkItem(ctx, item.id)).toMatchObject({ state_id: triageId, intake: { status: "pending" } });
    expect(visible()).toBe(0);
    // Other fields stay editable while the item waits in Intake.
    expect(updateWorkItem(actx, item.id, { priority: "high" })).toMatchObject({ priority: "high", state_id: triageId });
  });

  it("an agent's copy into an intake-required project lands in triage with a pending intake item", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    updateProjectFeatures(ctx, other.id, { intake_enabled: true, agent_intake_required: true });
    const { agent, actx } = agentContext(f);
    const source = createWorkItem(ctx, { project_id: p.id, name: "Source", state_id: states.Todo.id });
    const copy = copyWorkItem(actx, source.id, { project_id: other.id });
    const otherTriage = listStates(ctx, other.id).find((s) => s.state_group === "triage");
    expect(copy.project_id).toBe(other.id);
    expect(copy.state_id).toBe(otherTriage?.id);
    expect(copy.intake).toEqual({ status: "pending" });
    const rows = ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, copy.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", source: "mcp", created_by_actor_id: agent.id });
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: other.id } }).items.map((i) => i.id)).not.toContain(copy.id);
    // Same-project copies are routed too, user copies are not.
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    expect(copyWorkItem(actx, source.id).intake).toEqual({ status: "pending" });
    const byUser = copyWorkItem(ctx, source.id, { project_id: other.id });
    expect(byUser.intake).toBeNull();
    expect(listStates(ctx, other.id).find((s) => s.id === byUser.state_id)?.name).toBe("Todo");
    expect(getWorkItem(ctx, source.id).intake).toBeNull();
  });

  it("copying a pending intake item is refused and an agent's move into an intake-required project lands in Intake", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    updateProjectFeatures(ctx, other.id, { intake_enabled: true, agent_intake_required: true });
    const { agent, actx } = agentContext(f);
    const pending = createWorkItem(actx, { project_id: other.id, name: "Pending" });
    expect(ruleName(() => copyWorkItem(actx, pending.id))).toBe("intake_pending");
    expect(ruleName(() => copyWorkItem(ctx, pending.id, { project_id: p.id }))).toBe("intake_pending");
    const source = createWorkItem(ctx, { project_id: p.id, name: "Source", state_id: states.Todo.id });
    const moved = moveWorkItemToProject(actx, source.id, { project_id: other.id });
    const otherTriage = listStates(ctx, other.id).find((s) => s.state_group === "triage");
    expect(moved.id).toBe(source.id);
    expect(moved.project_id).toBe(other.id);
    expect(moved.state_id).toBe(otherTriage?.id);
    expect(moved.intake).toEqual({ status: "pending" });
    const rows = ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, source.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", source: "mcp", created_by_actor_id: agent.id });
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: other.id } }).items.map((i) => i.id)).not.toContain(source.id);
    // A user's move keeps the mapped state and creates no intake item.
    const byUser = createWorkItem(ctx, { project_id: p.id, name: "By user", state_id: states.Todo.id });
    const userMoved = moveWorkItemToProject(ctx, byUser.id, { project_id: other.id });
    expect(userMoved.intake).toBeNull();
    expect(listStates(ctx, other.id).find((s) => s.id === userMoved.state_id)?.name).toBe("Todo");
  });
});

describe("getWorkItem and getWorkItemByKey", () => {
  it("returns the detail view with key, ids, counts, subscribers and links", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const core = insertModule(ctx, p.id, "Core");
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic", label_ids: [bug.id], module_ids: [core.id], assignee_ids: [ASSISTANT_ACTOR_ID] });
    createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: parent.id });
    const link = insertLink(ctx, parent.id, "https://example.com");
    const detail = getWorkItem(ctx, parent.id);
    expect(detail.key).toBe("WEB-1");
    expect(detail.label_ids).toEqual([bug.id]);
    expect(detail.module_ids).toEqual([core.id]);
    expect(detail.assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(detail.sub_items_count).toBe(1);
    expect(detail.links_count).toBe(1);
    expect(detail.links.map((l) => l.id)).toEqual([link.id]);
    expect(detail.subscriber_ids.sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID].sort());
    expect(detail.intake).toBeNull();
    expect(errorCode(() => getWorkItem(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("getWorkItemByKey accepts a key in any case or an id and is NOT_FOUND otherwise", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    expect(getWorkItemByKey(ctx, "WEB-1").id).toBe(item.id);
    expect(getWorkItemByKey(ctx, " web-1 ").id).toBe(item.id);
    expect(getWorkItemByKey(ctx, item.id).key).toBe("WEB-1");
    expect(errorCode(() => getWorkItemByKey(ctx, "WEB-2"))).toBe("NOT_FOUND");
    expect(errorCode(() => getWorkItemByKey(ctx, "OTH-1"))).toBe("NOT_FOUND");
    expect(errorCode(() => getWorkItemByKey(ctx, "not a key"))).toBe("NOT_FOUND");
    deleteWorkItem(ctx, item.id);
    expect(errorCode(() => getWorkItemByKey(ctx, "WEB-1"))).toBe("NOT_FOUND");
  });
});

describe("updateWorkItem", () => {
  it("is field-scoped and logs one activity row per changed field with identifiers", () => {
    const { ctx, project: p, states } = setup();
    const sprint = insertCycle(ctx, p.id, "Sprint 1");
    const point = insertEstimatePoint(ctx, p.id, "5");
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", description_md: "keep me" });
    const seqBefore = latestSeq(ctx);
    const after = updateWorkItem(ctx, item.id, {
      name: "B",
      state_id: states.Todo.id,
      priority: "high",
      parent_id: parent.id,
      cycle_id: sprint.id,
      estimate_point_id: point.id,
      start_date: "2026-10-01",
      target_date: "2026-10-05",
    });
    expect(after).toMatchObject({ name: "B", priority: "high", parent_id: parent.id, cycle_id: sprint.id, estimate_point_id: point.id, description_md: "keep me" });
    const rows = activityRows(ctx, item.id).filter((r) => r.seq > seqBefore);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(Object.keys(byField).sort()).toEqual(["cycle_id", "estimate_point_id", "name", "parent_id", "priority", "start_date", "state_id", "target_date"]);
    expect(byField.state_id).toMatchObject({ verb: "updated", old_value: states.Backlog.id, new_value: states.Todo.id, old_identifier: "Backlog", new_identifier: "Todo" });
    expect(byField.priority).toMatchObject({ old_value: "none", new_value: "high", new_identifier: "high" });
    expect(byField.parent_id).toMatchObject({ old_value: null, new_value: parent.id, new_identifier: "WEB-1" });
    expect(byField.cycle_id).toMatchObject({ new_value: sprint.id, new_identifier: "Sprint 1" });
    expect(byField.estimate_point_id).toMatchObject({ new_identifier: "5" });
    expect(byField.name).toMatchObject({ old_value: "A", new_value: "B" });
    expect(updateWorkItem(ctx, item.id, {}).name).toBe("B");
    expect(latestSeq(ctx)).toBe(seqBefore + 8);
  });

  it("completed_at follows the state group", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const done = updateWorkItem(ctx, item.id, { state_id: states.Done.id });
    expect(done.completed_at).not.toBeNull();
    const stamp = done.completed_at;
    expect(updateWorkItem(ctx, item.id, { priority: "low" }).completed_at).toBe(stamp);
    const reopened = updateWorkItem(ctx, item.id, { state_id: states["In Progress"].id });
    expect(reopened.completed_at).toBeNull();
    expect(updateWorkItem(ctx, item.id, { state_id: states.Cancelled.id }).completed_at).toBeNull();
  });

  it("keeps the parent in the same project and the parent chain acyclic", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", parent_id: a.id });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C", parent_id: b.id });
    expect(ruleName(() => updateWorkItem(ctx, a.id, { parent_id: a.id }))).toBe("parent_self");
    expect(ruleName(() => updateWorkItem(ctx, a.id, { parent_id: c.id }))).toBe("parent_cycle");
    expect(ruleName(() => updateWorkItem(ctx, a.id, { parent_id: b.id }))).toBe("parent_cycle");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const elsewhere = createWorkItem(ctx, { project_id: other.id, name: "X" });
    expect(ruleName(() => updateWorkItem(ctx, a.id, { parent_id: elsewhere.id }))).toBe("parent_project");
    expect(errorCode(() => updateWorkItem(ctx, a.id, { parent_id: newId() }))).toBe("NOT_FOUND");
    expect(updateWorkItem(ctx, c.id, { parent_id: null }).parent_id).toBeNull();
    expect(updateWorkItem(ctx, c.id, { parent_id: a.id }).parent_id).toBe(a.id);
  });

  it("archived items are read-only (ARCHIVED) for every property write", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", state_id: states.Done.id });
    archiveWorkItem(ctx, item.id);
    expect(errorCode(() => updateWorkItem(ctx, item.id, { name: "B" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateWorkItemDescription(ctx, item.id, { description_md: "x", expected_description_version: 0 }))).toBe("ARCHIVED");
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "priority", value: "high" }))).toBe("ARCHIVED");
    expect(errorCode(() => setLabels(ctx, item.id, []))).toBe("ARCHIVED");
    expect(errorCode(() => setModules(ctx, item.id, []))).toBe("ARCHIVED");
    expect(errorCode(() => setAssignees(ctx, item.id, []))).toBe("ARCHIVED");
    expect(errorCode(() => bulkUpdateWorkItems(ctx, [item.id], { priority: "low" }))).toBe("ARCHIVED");
    expect(errorCode(() => moveWorkItemToProject(ctx, item.id, { project_id: createProject(ctx, { name: "O", identifier: "OTH" }).id }))).toBe("ARCHIVED");
    expect(errorCode(() => subscribe(ctx, item.id))).toBe("ARCHIVED");
    expect(errorCode(() => unsubscribe(ctx, item.id))).toBe("ARCHIVED");
    expect(getWorkItem(ctx, item.id).name).toBe("A");
  });

  it("refuses joining or leaving a completed cycle (LOCKED) and joining an archived cycle (ARCHIVED)", () => {
    const { ctx, project: p, states } = setup();
    const ended = insertCycle(ctx, p.id, "Ended", { start_date: "2020-01-01", end_date: "2020-01-31" });
    const gone = insertCycle(ctx, p.id, "Gone", { archived_at: ctx.now() });
    const open = insertCycle(ctx, p.id, "Open");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: ended.id }))).toBe("LOCKED");
    expect(errorCode(() => createWorkItem(ctx, { project_id: p.id, name: "A", cycle_id: gone.id }))).toBe("ARCHIVED");
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", state_id: states.Todo.id });
    expect(errorCode(() => updateWorkItem(ctx, item.id, { cycle_id: ended.id }))).toBe("LOCKED");
    expect(errorCode(() => updateWorkItem(ctx, item.id, { cycle_id: gone.id }))).toBe("ARCHIVED");
    expect(errorCode(() => bulkUpdateWorkItems(ctx, [item.id], { cycle_id: ended.id }))).toBe("LOCKED");
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "cycle", value: ended.id }))).toBe("LOCKED");
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "cycle", value: gone.id }))).toBe("ARCHIVED");
    expect(getWorkItem(ctx, item.id).cycle_id).toBeNull();
    expect(updateWorkItem(ctx, item.id, { cycle_id: open.id }).cycle_id).toBe(open.id);
    // Membership in a completed cycle is frozen: leaving it needs transferCycleWorkItems.
    ctx.db.update(work_item).set({ cycle_id: ended.id }).where(eq(work_item.id, item.id)).run();
    expect(errorCode(() => updateWorkItem(ctx, item.id, { cycle_id: null }))).toBe("LOCKED");
    expect(errorCode(() => updateWorkItem(ctx, item.id, { cycle_id: open.id }))).toBe("LOCKED");
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "cycle", value: null }))).toBe("LOCKED");
    expect(updateWorkItem(ctx, item.id, { cycle_id: ended.id, priority: "high" })).toMatchObject({ cycle_id: ended.id, priority: "high" });
    expect(activityRows(ctx, item.id).filter((r) => r.field === "cycle_id").map((r) => r.new_identifier)).toEqual(["Open"]);
  });

  it("property writes never bump description_version", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    updateWorkItemDescription(ctx, item.id, { description_md: "body", expected_description_version: 0 });
    const after = updateWorkItem(ctx, item.id, { name: "B", priority: "urgent" });
    expect(after.description_version).toBe(1);
    expect(after.description_md).toBe("body");
  });

  it("updates the FTS row on a name change", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "Alpha", description_md: "body text" });
    updateWorkItem(ctx, item.id, { name: "Bravo" });
    expect(searchWorkItemIds(ctx.sqlite, "alpha")).toEqual([]);
    expect(searchWorkItemIds(ctx.sqlite, "bravo")).toEqual([item.id]);
    expect(searchWorkItemIds(ctx.sqlite, "body")).toEqual([item.id]);
  });

  it("validates dates, the patch shape and refuses cycles for closed items", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", start_date: "2026-10-05" });
    expect(ruleName(() => updateWorkItem(ctx, item.id, { target_date: "2026-10-01" }))).toBe("date_order");
    expect(errorCode(() => updateWorkItem(ctx, item.id, { bogus: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateWorkItem(ctx, newId(), { name: "B" }))).toBe("NOT_FOUND");
    updateWorkItem(ctx, item.id, { state_id: states.Cancelled.id });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    expect(ruleName(() => updateWorkItem(ctx, item.id, { cycle_id: sprint.id }))).toBe("cycle_closed_item");
    expect(updateWorkItem(ctx, item.id, { state_id: states.Todo.id, cycle_id: sprint.id }).cycle_id).toBe(sprint.id);
  });
});

describe("updateWorkItemDescription", () => {
  it("uses compare-and-set on description_version and bumps it on every change", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const v1 = updateWorkItemDescription(ctx, item.id, { description_md: "first", expected_description_version: 0 });
    expect(v1.description_version).toBe(1);
    expect(v1.description_md).toBe("first");
    const err = (() => {
      try {
        updateWorkItemDescription(ctx, item.id, { description_md: "stale", expected_description_version: 0 });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as TrackerError).code).toBe("CONFLICT");
    expect((err as TrackerError).details).toMatchObject({ current_version: 1 });
    expect(getWorkItem(ctx, item.id).description_md).toBe("first");
    const v2 = updateWorkItemDescription(ctx, item.id, { description_md: "second", expected_description_version: 1 });
    expect(v2.description_version).toBe(2);
    expect(updateWorkItemDescription(ctx, item.id, { description_md: "second", expected_description_version: 2 }).description_version).toBe(2);
    const rows = activityRows(ctx, item.id).filter((r) => r.field === "description_md");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ verb: "updated", old_value: "1", new_value: "2" });
  });

  it("writes the body to the FTS row", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    updateWorkItemDescription(ctx, item.id, { description_md: "unique zebra text", expected_description_version: 0 });
    expect(searchWorkItemIds(ctx.sqlite, "zebra")).toEqual([item.id]);
  });
});

describe("moveWorkItem", () => {
  function names(ctx: TesseraContext, projectId: string): string[] {
    return listWorkItems(ctx, { scope: { type: "project", project_id: projectId } }).items.map((i) => i.name);
  }

  it("writes a sort_order between the two neighbours and logs it", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B" });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    expect(names(ctx, p.id)).toEqual(["A", "B", "C"]);
    const moved = moveWorkItem(ctx, c.id, { before_id: a.id, after_id: b.id });
    expect(moved.sort_order > a.sort_order && moved.sort_order < b.sort_order).toBe(true);
    expect(names(ctx, p.id)).toEqual(["A", "C", "B"]);
    const rows = activityRows(ctx, c.id).filter((r) => r.field === "sort_order");
    expect(rows).toHaveLength(1);
    expect(rows[0].old_identifier).toBe("WEB-3");
  });

  it("with one neighbour uses the real project-wide neighbour so keys stay unique", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B" });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    const d = createWorkItem(ctx, { project_id: p.id, name: "D" });
    moveWorkItem(ctx, d.id, { before_id: a.id });
    expect(names(ctx, p.id)).toEqual(["A", "D", "B", "C"]);
    moveWorkItem(ctx, c.id, { after_id: a.id });
    expect(names(ctx, p.id)).toEqual(["C", "A", "D", "B"]);
    moveWorkItem(ctx, a.id, { after_id: b.id });
    expect(names(ctx, p.id)).toEqual(["C", "D", "A", "B"]);
    const keys = listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).items.map((i) => i.sort_order);
    expect(new Set(keys).size).toBe(4);
  });

  it("validates neighbours: same project, not itself, in order", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B" });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const x = createWorkItem(ctx, { project_id: other.id, name: "X" });
    expect(ruleName(() => moveWorkItem(ctx, a.id, { before_id: x.id }))).toBe("neighbour_project");
    expect(errorCode(() => moveWorkItem(ctx, a.id, { before_id: a.id }))).toBe("VALIDATION");
    expect(errorCode(() => moveWorkItem(ctx, a.id, { before_id: newId() }))).toBe("NOT_FOUND");
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    expect(errorCode(() => moveWorkItem(ctx, c.id, { before_id: b.id, after_id: a.id }))).toBe("VALIDATION");
    expect(errorCode(() => moveWorkItem(ctx, c.id, {}))).toBe("VALIDATION");
  });

  it("changes the grouped field for state, priority, cycle and dates (null = none)", () => {
    const { ctx, project: p, states } = setup();
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    expect(moveWorkItem(ctx, item.id, { group_by: "state", value: states.Done.id }).completed_at).not.toBeNull();
    expect(moveWorkItem(ctx, item.id, { group_by: "state", value: states.Todo.id }).state_id).toBe(states.Todo.id);
    expect(moveWorkItem(ctx, item.id, { group_by: "priority", value: "urgent" }).priority).toBe("urgent");
    expect(moveWorkItem(ctx, item.id, { group_by: "cycle", value: sprint.id }).cycle_id).toBe(sprint.id);
    expect(moveWorkItem(ctx, item.id, { group_by: "cycle", value: null }).cycle_id).toBeNull();
    expect(moveWorkItem(ctx, item.id, { group_by: "target_date", value: "2026-12-01" }).target_date).toBe("2026-12-01");
    expect(moveWorkItem(ctx, item.id, { group_by: "start_date", value: "2026-11-01" }).start_date).toBe("2026-11-01");
    expect(moveWorkItem(ctx, item.id, { group_by: "target_date", value: "none" }).target_date).toBeNull();
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "priority", value: "critical" }))).toBe("VALIDATION");
    expect(errorCode(() => moveWorkItem(ctx, item.id, { group_by: "state", value: null }))).toBe("VALIDATION");
    expect(activityRows(ctx, item.id).filter((r) => r.field === "state_id")).toHaveLength(2);
  });

  it("for labels, assignees and modules adds the value and removes from_value", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const core = insertModule(ctx, p.id, "Core");
    const api = insertModule(ctx, p.id, "API");
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [bug.id], module_ids: [core.id], assignee_ids: [USER_ACTOR_ID] });
    const relabelled = moveWorkItem(ctx, item.id, { group_by: "labels", value: ux.id, from_value: bug.id });
    expect(relabelled.label_ids).toEqual([ux.id]);
    expect(moveWorkItem(ctx, item.id, { group_by: "labels", value: bug.id }).label_ids.sort()).toEqual([bug.id, ux.id].sort());
    expect(moveWorkItem(ctx, item.id, { group_by: "labels", value: null, from_value: ux.id }).label_ids).toEqual([bug.id]);
    expect(moveWorkItem(ctx, item.id, { group_by: "module", value: api.id, from_value: core.id }).module_ids).toEqual([api.id]);
    expect(moveWorkItem(ctx, item.id, { group_by: "assignees", value: ASSISTANT_ACTOR_ID, from_value: USER_ACTOR_ID }).assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(moveWorkItem(ctx, item.id, { group_by: "assignees", value: "none", from_value: ASSISTANT_ACTOR_ID }).assignee_ids).toEqual([]);
    const labelRows = activityRows(ctx, item.id).filter((r) => r.field === "labels");
    expect(labelRows.map((r) => r.verb)).toEqual(["removed", "added", "added", "removed"]);
    expect(labelRows[1].new_identifier).toBe("UX");
  });

  it("refuses groups that are not a settable field", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    for (const group_by of ["state_group", "created_by", "created_at", "project"] as const) {
      expect(ruleName(() => moveWorkItem(ctx, item.id, { group_by, value: "x" }))).toBe("group_not_movable");
    }
  });
});

describe("bulkUpdateWorkItems", () => {
  it("applies the patch to every item in one transaction, all or nothing", () => {
    const { ctx, project: p, states } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B" });
    const done = bulkUpdateWorkItems(ctx, [a.id, b.id, a.id], { state_id: states.Done.id, priority: "low" });
    expect(done.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(done.every((i) => i.completed_at !== null && i.priority === "low")).toBe(true);
    archiveWorkItem(ctx, b.id);
    const seqBefore = latestSeq(ctx);
    expect(errorCode(() => bulkUpdateWorkItems(ctx, [a.id, b.id], { priority: "urgent" }))).toBe("ARCHIVED");
    expect(getWorkItem(ctx, a.id).priority).toBe("low");
    expect(latestSeq(ctx)).toBe(seqBefore);
    expect(errorCode(() => bulkUpdateWorkItems(ctx, [], { priority: "urgent" }))).toBe("VALIDATION");
  });
});

describe("copyWorkItem", () => {
  it("appends (Copy), keeps labels, parent and description, clears cycle, modules, estimate, assignees and skips children", () => {
    const { ctx, project: p, states } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const core = insertModule(ctx, p.id, "Core");
    const point = insertEstimatePoint(ctx, p.id);
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const source = createWorkItem(ctx, {
      project_id: p.id,
      name: "Source",
      description_md: "body",
      state_id: states.Todo.id,
      priority: "high",
      parent_id: parent.id,
      cycle_id: sprint.id,
      label_ids: [bug.id],
      module_ids: [core.id],
      assignee_ids: [ASSISTANT_ACTOR_ID],
      estimate_point_id: point.id,
      target_date: "2026-12-01",
    });
    createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: source.id });
    const copy = copyWorkItem(ctx, source.id);
    expect(copy.id).not.toBe(source.id);
    expect(copy.key).toBe("WEB-4");
    expect(copy).toMatchObject({ name: "Source (Copy)", description_md: "body", state_id: states.Todo.id, priority: "high", parent_id: parent.id, target_date: "2026-12-01" });
    expect(copy.label_ids).toEqual([bug.id]);
    expect(copy.cycle_id).toBeNull();
    expect(copy.module_ids).toEqual([]);
    expect(copy.assignee_ids).toEqual([]);
    expect(copy.estimate_point_id).toBeNull();
    expect(copy.sub_items_count).toBe(0);
    expect(getWorkItem(ctx, source.id).sub_items_count).toBe(1);
    const rows = activityRows(ctx, copy.id);
    expect(rows.map((r) => r.verb)).toEqual(["created", "copied"]);
    expect(rows[1]).toMatchObject({ old_identifier: "WEB-2", new_identifier: "WEB-4" });
  });

  it("into another project maps labels by name, drops the parent and uses a matching or default state", () => {
    const { ctx, project: p, states } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const otherBug = createLabel(ctx, { project_id: other.id, name: "bug" });
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const source = createWorkItem(ctx, { project_id: p.id, name: "S", parent_id: parent.id, label_ids: [bug.id, ux.id], state_id: states.Done.id });
    const copy = copyWorkItem(ctx, source.id, { project_id: other.id });
    expect(copy.key).toBe("OTH-1");
    expect(copy.project_id).toBe(other.id);
    expect(copy.label_ids).toEqual([otherBug.id]);
    expect(copy.parent_id).toBeNull();
    const otherDone = listStates(ctx, other.id).find((s) => s.name === "Done");
    expect(copy.state_id).toBe(otherDone?.id);
    expect(copy.completed_at).not.toBeNull();
    const custom = createState(ctx, { project_id: p.id, name: "Review", state_group: "started" });
    const inReview = createWorkItem(ctx, { project_id: p.id, name: "R", state_id: custom.id });
    const fallback = copyWorkItem(ctx, inReview.id, { project_id: other.id });
    expect(fallback.state_id).toBe(listStates(ctx, other.id).find((s) => s.is_default)?.id);
    archiveProject(ctx, other.id);
    expect(errorCode(() => copyWorkItem(ctx, source.id, { project_id: other.id }))).toBe("ARCHIVED");
  });
});

describe("moveWorkItemToProject", () => {
  it("allocates a new sequence, keeps the old key in activity, maps labels by name and clears cycle, modules and estimate", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const core = insertModule(ctx, p.id, "Core");
    const point = insertEstimatePoint(ctx, p.id);
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const otherBug = createLabel(ctx, { project_id: other.id, name: "BUG" });
    createWorkItem(ctx, { project_id: other.id, name: "Existing" });
    const item = createWorkItem(ctx, {
      project_id: p.id,
      name: "Mover",
      label_ids: [bug.id, ux.id],
      cycle_id: sprint.id,
      module_ids: [core.id],
      estimate_point_id: point.id,
      assignee_ids: [ASSISTANT_ACTOR_ID],
    });
    const moved = moveWorkItemToProject(ctx, item.id, { project_id: other.id });
    expect(moved.id).toBe(item.id);
    expect(moved.key).toBe("OTH-2");
    expect(moved.project_id).toBe(other.id);
    expect(moved.label_ids).toEqual([otherBug.id]);
    expect(moved.cycle_id).toBeNull();
    expect(moved.module_ids).toEqual([]);
    expect(moved.estimate_point_id).toBeNull();
    expect(moved.assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(moved.state_id).toBe(listStates(ctx, other.id).find((s) => s.name === "Backlog")?.id);
    expect(getWorkItemByKey(ctx, "OTH-2").id).toBe(item.id);
    expect(errorCode(() => getWorkItemByKey(ctx, "WEB-1"))).toBe("NOT_FOUND");
    expect(createWorkItem(ctx, { project_id: p.id, name: "Next in WEB" }).key).toBe("WEB-2");
    const row = activityRows(ctx, item.id).at(-1);
    expect(row).toMatchObject({ verb: "moved", field: "project_id", old_value: p.id, new_value: other.id, old_identifier: "WEB-1", new_identifier: "OTH-2", project_id: other.id });
    expect(searchWorkItemIds(ctx.sqlite, "mover", { project_id: other.id })).toEqual([item.id]);
    expect(searchWorkItemIds(ctx.sqlite, "mover", { project_id: p.id })).toEqual([]);
  });

  it("detaches children, refuses the same project and pending intake items", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const child = createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: parent.id });
    expect(ruleName(() => moveWorkItemToProject(ctx, parent.id, { project_id: p.id }))).toBe("same_project");
    moveWorkItemToProject(ctx, parent.id, { project_id: other.id });
    expect(getWorkItem(ctx, child.id).parent_id).toBeNull();
    expect(getWorkItem(ctx, child.id).project_id).toBe(p.id);
    expect(activityRows(ctx, child.id).at(-1)).toMatchObject({ field: "parent_id", old_identifier: "WEB-1", new_value: null });
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:x" });
    const actx = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: agent.id });
    const pending = createWorkItem(actx, { project_id: p.id, name: "Pending" });
    expect(ruleName(() => moveWorkItemToProject(ctx, pending.id, { project_id: other.id }))).toBe("intake_pending");
  });

  it("refuses to pull an item out of a completed cycle (LOCKED) or an archived cycle (ARCHIVED)", () => {
    const { ctx, project: p, states } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const ended = insertCycle(ctx, p.id, "Ended", { start_date: "2020-01-01", end_date: "2020-01-31" });
    const gone = insertCycle(ctx, p.id, "Gone", { archived_at: ctx.now() });
    const inEnded = createWorkItem(ctx, { project_id: p.id, name: "In ended", state_id: states.Todo.id });
    const inGone = createWorkItem(ctx, { project_id: p.id, name: "In gone", state_id: states.Todo.id });
    // Membership is seeded directly: joining a completed or archived cycle through the service is refused.
    ctx.db.update(work_item).set({ cycle_id: ended.id }).where(eq(work_item.id, inEnded.id)).run();
    ctx.db.update(work_item).set({ cycle_id: gone.id }).where(eq(work_item.id, inGone.id)).run();
    const membersOf = (cycleId: string) => ctx.db.select({ id: work_item.id }).from(work_item).where(eq(work_item.cycle_id, cycleId)).all().length;
    expect(errorCode(() => moveWorkItemToProject(ctx, inEnded.id, { project_id: other.id }))).toBe("LOCKED");
    expect(errorCode(() => moveWorkItemToProject(ctx, inGone.id, { project_id: other.id }))).toBe("ARCHIVED");
    expect(getWorkItem(ctx, inEnded.id)).toMatchObject({ cycle_id: ended.id, project_id: p.id, key: "WEB-1" });
    expect(getWorkItem(ctx, inGone.id)).toMatchObject({ cycle_id: gone.id, project_id: p.id, key: "WEB-2" });
    expect(membersOf(ended.id)).toBe(1);
    expect(membersOf(gone.id)).toBe(1);
    expect(activityRows(ctx, inEnded.id).some((r) => r.verb === "moved")).toBe(false);
    // A deleted cycle no longer freezes anything: its stale pointer is cleared by the move.
    ctx.db.update(cycle).set({ deleted_at: ctx.now() }).where(eq(cycle.id, ended.id)).run();
    expect(moveWorkItemToProject(ctx, inEnded.id, { project_id: other.id })).toMatchObject({ cycle_id: null, project_id: other.id });
  });
});

describe("archive and unarchive", () => {
  it("archives only completed or cancelled items and lists them under the archived scope", () => {
    const { ctx, project: p, states } = setup();
    const open = createWorkItem(ctx, { project_id: p.id, name: "Open" });
    const done = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: states.Done.id });
    const cancelled = createWorkItem(ctx, { project_id: p.id, name: "Cancelled", state_id: states.Cancelled.id });
    expect(ruleName(() => archiveWorkItem(ctx, open.id))).toBe("archive_open_item");
    expect(archiveWorkItem(ctx, done.id).archived_at).not.toBeNull();
    expect(archiveWorkItem(ctx, cancelled.id).archived_at).not.toBeNull();
    expect(errorCode(() => archiveWorkItem(ctx, done.id))).toBe("ARCHIVED");
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).items.map((i) => i.name)).toEqual(["Open"]);
    expect(listWorkItems(ctx, { scope: { type: "archived", project_id: p.id } }).items.map((i) => i.name)).toEqual(["Done", "Cancelled"]);
    expect(activityRows(ctx, done.id).at(-1)).toMatchObject({ verb: "archived", old_identifier: "WEB-2" });
  });

  it("unarchive restores the item and refuses items that are not archived", () => {
    const { ctx, project: p, states } = setup();
    const done = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: states.Done.id });
    expect(ruleName(() => unarchiveWorkItem(ctx, done.id))).toBe("not_archived");
    archiveWorkItem(ctx, done.id);
    const restored = unarchiveWorkItem(ctx, done.id);
    expect(restored.archived_at).toBeNull();
    expect(updateWorkItem(ctx, done.id, { name: "Editable again" }).name).toBe("Editable again");
    expect(activityRows(ctx, done.id).filter((r) => r.verb === "restored")).toHaveLength(1);
  });
});

describe("deleteWorkItem", () => {
  it("soft-deletes the item and its children recursively with junction, intake and FTS rows", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const core = insertModule(ctx, p.id, "Core");
    const root = createWorkItem(ctx, { project_id: p.id, name: "Root", label_ids: [bug.id], module_ids: [core.id], assignee_ids: [ASSISTANT_ACTOR_ID] });
    const child = createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: root.id });
    const grandchild = createWorkItem(ctx, { project_id: p.id, name: "Grandchild", parent_id: child.id });
    const sibling = createWorkItem(ctx, { project_id: p.id, name: "Sibling" });
    deleteWorkItem(ctx, root.id);
    for (const id of [root.id, child.id, grandchild.id]) {
      expect(rawRow(ctx, id).deleted_at).not.toBeNull();
      expect(errorCode(() => getWorkItem(ctx, id))).toBe("NOT_FOUND");
      expect(activityRows(ctx, id).at(-1)?.verb).toBe("deleted");
    }
    expect(rawRow(ctx, sibling.id).deleted_at).toBeNull();
    expect(labelIds(ctx, root.id)).toEqual([]);
    expect(ctx.db.select().from(work_item_module).where(eq(work_item_module.work_item_id, root.id)).all()).toHaveLength(0);
    expect(ctx.db.select().from(work_item_assignee).where(eq(work_item_assignee.work_item_id, root.id)).all()).toHaveLength(0);
    expect(subscriberIds(ctx, root.id)).toEqual([]);
    expect(searchWorkItemIds(ctx.sqlite, "grandchild")).toEqual([]);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).items.map((i) => i.name)).toEqual(["Sibling"]);
    expect(errorCode(() => deleteWorkItem(ctx, root.id))).toBe("NOT_FOUND");
  });

  it("deletes archived items and their pending intake rows", () => {
    const f = setup();
    const { ctx, project: p, states } = f;
    const done = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: states.Done.id });
    archiveWorkItem(ctx, done.id);
    deleteWorkItem(ctx, done.id);
    expect(rawRow(ctx, done.id).deleted_at).not.toBeNull();
    updateProjectFeatures(ctx, p.id, { intake_enabled: true, agent_intake_required: true });
    const { actx } = agentContext(f);
    const pending = createWorkItem(actx, { project_id: p.id, name: "Pending" });
    deleteWorkItem(ctx, pending.id);
    expect(ctx.db.select().from(intake_item).where(eq(intake_item.work_item_id, pending.id)).get()?.deleted_at).not.toBeNull();
    expect(updateProjectFeatures(ctx, p.id, { intake_enabled: false }).intake_enabled).toBe(false);
  });
});

describe("listChildren", () => {
  it("returns non-deleted children in sort order and NOT_FOUND for an unknown parent", () => {
    const { ctx, project: p } = setup();
    const parent = createWorkItem(ctx, { project_id: p.id, name: "Epic" });
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", parent_id: parent.id });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", parent_id: parent.id });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C", parent_id: parent.id });
    moveWorkItem(ctx, c.id, { before_id: a.id, after_id: b.id });
    deleteWorkItem(ctx, b.id);
    expect(listChildren(ctx, parent.id).map((i) => i.name)).toEqual(["A", "C"]);
    expect(listChildren(ctx, a.id)).toEqual([]);
    expect(errorCode(() => listChildren(ctx, newId()))).toBe("NOT_FOUND");
  });
});

describe("setLabels, setModules, setAssignees", () => {
  it("setLabels replaces the set and logs added and removed rows", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const docs = createLabel(ctx, { project_id: p.id, name: "Docs" });
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [bug.id, ux.id] });
    const seqBefore = latestSeq(ctx);
    const after = setLabels(ctx, item.id, [ux.id, docs.id, docs.id]);
    expect(after.label_ids.sort()).toEqual([ux.id, docs.id].sort());
    expect(labelIds(ctx, item.id).sort()).toEqual([ux.id, docs.id].sort());
    const rows = activityRows(ctx, item.id).filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => [r.verb, r.field, r.old_identifier ?? r.new_identifier])).toEqual([
      ["removed", "labels", "Bug"],
      ["added", "labels", "Docs"],
    ]);
    expect(setLabels(ctx, item.id, []).label_ids).toEqual([]);
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = createLabel(ctx, { project_id: other.id, name: "Foreign" });
    expect(ruleName(() => setLabels(ctx, item.id, [foreign.id]))).toBe("label_project");
    expect(errorCode(() => setLabels(ctx, item.id, ["nope"]))).toBe("VALIDATION");
  });

  it("setModules replaces the set and validates the project", () => {
    const { ctx, project: p } = setup();
    const core = insertModule(ctx, p.id, "Core");
    const api = insertModule(ctx, p.id, "API");
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", module_ids: [core.id] });
    expect(setModules(ctx, item.id, [api.id]).module_ids).toEqual([api.id]);
    const rows = activityRows(ctx, item.id).filter((r) => r.field === "modules");
    expect(rows.map((r) => [r.verb, r.old_identifier ?? r.new_identifier])).toEqual([
      ["removed", "Core"],
      ["added", "API"],
    ]);
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(ruleName(() => setModules(ctx, item.id, [insertModule(ctx, other.id, "X").id]))).toBe("module_project");
    expect(errorCode(() => setModules(ctx, item.id, [newId()]))).toBe("NOT_FOUND");
  });

  it("setAssignees has replace semantics, needs live actors and auto-subscribes added actors", () => {
    const { ctx, project: p } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A", assignee_ids: [USER_ACTOR_ID] });
    unsubscribe(ctx, item.id, ASSISTANT_ACTOR_ID);
    const after = setAssignees(ctx, item.id, [ASSISTANT_ACTOR_ID]);
    expect(after.assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(subscriberIds(ctx, item.id)).toContain(ASSISTANT_ACTOR_ID);
    expect(subscriberIds(ctx, item.id)).toContain(USER_ACTOR_ID);
    const rows = activityRows(ctx, item.id).filter((r) => r.field === "assignees");
    expect(rows.map((r) => [r.verb, r.old_identifier ?? r.new_identifier])).toEqual([
      ["removed", "You"],
      ["added", "Assistant"],
    ]);
    expect(errorCode(() => setAssignees(ctx, item.id, [newId()]))).toBe("NOT_FOUND");
    expect(getWorkItem(ctx, item.id).assignee_ids).toEqual([ASSISTANT_ACTOR_ID]);
    expect(setAssignees(ctx, item.id, []).assignee_ids).toEqual([]);
  });
});

describe("subscribe and unsubscribe", () => {
  it("default to the calling actor, are idempotent and refuse archived items", () => {
    const { ctx, project: p, states } = setup();
    const item = createWorkItem(ctx, { project_id: p.id, name: "A" });
    unsubscribe(ctx, item.id);
    expect(subscriberIds(ctx, item.id)).toEqual([]);
    const seqBefore = latestSeq(ctx);
    subscribe(ctx, item.id);
    subscribe(ctx, item.id);
    expect(subscriberIds(ctx, item.id)).toEqual([USER_ACTOR_ID]);
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
    subscribe(ctx, item.id, ASSISTANT_ACTOR_ID);
    expect(getWorkItem(ctx, item.id).subscriber_ids.sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID].sort());
    expect(errorCode(() => subscribe(ctx, item.id, newId()))).toBe("NOT_FOUND");
    updateWorkItem(ctx, item.id, { state_id: states.Done.id });
    archiveWorkItem(ctx, item.id);
    expect(errorCode(() => unsubscribe(ctx, item.id, ASSISTANT_ACTOR_ID))).toBe("ARCHIVED");
    expect(errorCode(() => subscribe(ctx, item.id, ASSISTANT_ACTOR_ID))).toBe("ARCHIVED");
    expect(subscriberIds(ctx, item.id).sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID].sort());
    expect(activityRows(ctx, item.id).filter((r) => r.field === "subscribers").map((r) => r.verb)).toEqual(["removed", "added", "added"]);
  });
});

describe("listWorkItems scopes", () => {
  it("project scope lists live items in sort order with total and cursor, honouring limit and offset", () => {
    const { ctx, project: p } = setup();
    const names = ["A", "B", "C", "D"].map((name) => createWorkItem(ctx, { project_id: p.id, name }));
    deleteWorkItem(ctx, names[3].id);
    const result = listWorkItems(ctx, { scope: { type: "project", project_id: p.id } });
    expect(result.items.map((i) => i.name)).toEqual(["A", "B", "C"]);
    expect(result.total).toBe(3);
    expect(result.cursor).toBe(latestSeq(ctx));
    expect(result.groups).toBeUndefined();
    const page = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, limit: 1, offset: 1 });
    expect(page.items.map((i) => i.name)).toEqual(["B"]);
    expect(page.total).toBe(3);
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "project", project_id: newId() } }))).toBe("NOT_FOUND");
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "bogus" } } as never))).toBe("VALIDATION");
  });

  it("cycle and module scopes list members of that cycle or module", () => {
    const { ctx, project: p } = setup();
    const sprint = insertCycle(ctx, p.id, "Sprint");
    const core = insertModule(ctx, p.id, "Core");
    createWorkItem(ctx, { project_id: p.id, name: "Plain" });
    const inSprint = createWorkItem(ctx, { project_id: p.id, name: "In sprint", cycle_id: sprint.id });
    const inCore = createWorkItem(ctx, { project_id: p.id, name: "In core", module_ids: [core.id] });
    expect(listWorkItems(ctx, { scope: { type: "cycle", cycle_id: sprint.id } }).items.map((i) => i.id)).toEqual([inSprint.id]);
    expect(listWorkItems(ctx, { scope: { type: "module", module_id: core.id } }).items.map((i) => i.id)).toEqual([inCore.id]);
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "cycle", cycle_id: newId() } }))).toBe("NOT_FOUND");
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "module", module_id: newId() } }))).toBe("NOT_FOUND");
  });

  it("view scope merges the view's filters and display under the caller's", () => {
    const { ctx, project: p } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", priority: "high" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", priority: "high" });
    createWorkItem(ctx, { project_id: p.id, name: "C", priority: "low" });
    const saved = insertView(ctx, p.id, "High", { priority: ["high"] }, { order_by: "-sequence_id", group_by: "priority" });
    const fromView = listWorkItems(ctx, { scope: { type: "view", view_id: saved.id } });
    expect(fromView.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(fromView.groups?.map((g) => [g.id, g.count])).toEqual([
      ["urgent", 0],
      ["high", 2],
      ["medium", 0],
      ["low", 0],
      ["none", 0],
    ]);
    const overridden = listWorkItems(ctx, { scope: { type: "view", view_id: saved.id }, filters: { priority: ["low"] }, display: { order_by: "name", group_by: null } });
    expect(overridden.items.map((i) => i.name)).toEqual(["C"]);
    expect(overridden.groups).toBeUndefined();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    createWorkItem(ctx, { project_id: other.id, name: "Elsewhere", priority: "high" });
    const workspaceView = insertView(ctx, null, "All high", { priority: ["high"], project: [p.id] });
    expect(listWorkItems(ctx, { scope: { type: "view", view_id: workspaceView.id } }).total).toBe(2);
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "view", view_id: newId() } }))).toBe("NOT_FOUND");
  });

  it("workspace scope spans live projects and narrows with filters.project", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const parked = createProject(ctx, { name: "Parked", identifier: "PRK" });
    createWorkItem(ctx, { project_id: p.id, name: "A" });
    createWorkItem(ctx, { project_id: other.id, name: "B" });
    createWorkItem(ctx, { project_id: parked.id, name: "Hidden" });
    archiveProject(ctx, parked.id);
    const all = listWorkItems(ctx, { scope: { type: "workspace" }, display: { order_by: "name" } });
    expect(all.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(listWorkItems(ctx, { scope: { type: "workspace" }, filters: { project: [other.id] } }).items.map((i) => i.name)).toEqual(["B"]);
  });

  it("profile scope lists assigned, created and subscribed items of an actor", () => {
    const { ctx, project: p } = setup();
    const assigned = createWorkItem(ctx, { project_id: p.id, name: "Assigned", assignee_ids: [ASSISTANT_ACTOR_ID] });
    const created = createWorkItem(ctx, { project_id: p.id, name: "Created" });
    const subscribedOnly = createWorkItem(ctx, { project_id: p.id, name: "Subscribed" });
    unsubscribe(ctx, created.id);
    unsubscribe(ctx, subscribedOnly.id);
    subscribe(ctx, subscribedOnly.id, ASSISTANT_ACTOR_ID);
    const ids = (tab: "assigned" | "created" | "subscribed", actorId: string) =>
      listWorkItems(ctx, { scope: { type: "profile", actor_id: actorId, tab } }).items.map((i) => i.id);
    expect(ids("assigned", ASSISTANT_ACTOR_ID)).toEqual([assigned.id]);
    expect(ids("assigned", USER_ACTOR_ID)).toEqual([]);
    expect(ids("created", USER_ACTOR_ID)).toEqual([assigned.id, created.id, subscribedOnly.id]);
    expect(ids("created", ASSISTANT_ACTOR_ID)).toEqual([]);
    expect(ids("subscribed", ASSISTANT_ACTOR_ID)).toEqual([assigned.id, subscribedOnly.id]);
    expect(ids("subscribed", USER_ACTOR_ID)).toEqual([assigned.id]);
    expect(errorCode(() => listWorkItems(ctx, { scope: { type: "profile", actor_id: newId(), tab: "assigned" } }))).toBe("NOT_FOUND");
  });

  it("archived scope lists archived items only and draft returns an empty result", () => {
    const { ctx, project: p, states } = setup();
    createWorkItem(ctx, { project_id: p.id, name: "Open" });
    const done = createWorkItem(ctx, { project_id: p.id, name: "Done", state_id: states.Done.id });
    archiveWorkItem(ctx, done.id);
    const archivedList = listWorkItems(ctx, { scope: { type: "archived", project_id: p.id } });
    expect(archivedList.items.map((i) => i.id)).toEqual([done.id]);
    expect(archivedList.total).toBe(1);
    const drafts = listWorkItems(ctx, { scope: { type: "draft" } });
    expect(drafts).toEqual({ items: [], total: 0, cursor: latestSeq(ctx) });
  });

  it("display.type and display.sub_items act as filters", () => {
    const { ctx, project: p, states } = setup();
    const backlog = createWorkItem(ctx, { project_id: p.id, name: "Backlog" });
    const active = createWorkItem(ctx, { project_id: p.id, name: "Active", state_id: states["In Progress"].id });
    const child = createWorkItem(ctx, { project_id: p.id, name: "Child", parent_id: active.id, state_id: states.Todo.id });
    const scope = { type: "project" as const, project_id: p.id };
    expect(listWorkItems(ctx, { scope, display: { type: "backlog" } }).items.map((i) => i.id)).toEqual([backlog.id]);
    expect(listWorkItems(ctx, { scope, display: { type: "active" } }).items.map((i) => i.id)).toEqual([active.id, child.id]);
    expect(listWorkItems(ctx, { scope, display: { sub_items: false } }).items.map((i) => i.id)).toEqual([backlog.id, active.id]);
    expect(listWorkItems(ctx, { scope, display: { sub_items: false }, filters: { sub_items: true } }).total).toBe(3);
  });
});

describe("listWorkItems grouping", () => {
  it("returns groups when display.group_by is set, in state order with names and colours", () => {
    const { ctx, project: p, states } = setup();
    const a = createWorkItem(ctx, { project_id: p.id, name: "A" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", state_id: states.Done.id });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C" });
    const result = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, display: { group_by: "state" } });
    expect(result.items).toHaveLength(3);
    expect(result.groups?.map((g) => [g.name, g.color, g.count])).toEqual([
      ["Backlog", "gray", 2],
      ["Todo", "blue", 0],
      ["In Progress", "yellow", 0],
      ["Done", "green", 1],
      ["Cancelled", "red", 0],
    ]);
    expect(result.groups?.[0].item_ids).toEqual([a.id, c.id]);
    expect(result.groups?.[3].item_ids).toEqual([b.id]);
    expect(result.groups?.[0].field).toBe("state");
  });

  it("duplicates items into every multi-valued group and adds a none group", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const ux = createLabel(ctx, { project_id: p.id, name: "UX" });
    const both = createWorkItem(ctx, { project_id: p.id, name: "Both", label_ids: [bug.id, ux.id] });
    const onlyBug = createWorkItem(ctx, { project_id: p.id, name: "Bug only", label_ids: [bug.id] });
    const none = createWorkItem(ctx, { project_id: p.id, name: "Plain" });
    const result = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, display: { group_by: "labels" } });
    expect(result.total).toBe(3);
    expect(result.groups?.map((g) => [g.id, g.name, g.item_ids])).toEqual([
      [bug.id, "Bug", [both.id, onlyBug.id]],
      [ux.id, "UX", [both.id]],
      ["none", "None", [none.id]],
    ]);
    const byAssignee = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, display: { group_by: "assignees", show_empty_groups: false } });
    expect(byAssignee.groups?.map((g) => [g.id, g.count])).toEqual([["none", 3]]);
    setAssignees(ctx, both.id, [USER_ACTOR_ID, ASSISTANT_ACTOR_ID]);
    const assigned = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, display: { group_by: "assignees", show_empty_groups: false } });
    expect(assigned.groups?.map((g) => [g.name, g.item_ids])).toEqual([
      ["Assistant", [both.id]],
      ["You", [both.id]],
      ["None", [onlyBug.id, none.id]],
    ]);
  });

  it("show_empty_groups adds empty groups from the project's vocabulary and hides them when off", () => {
    const { ctx, project: p } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    createLabel(ctx, { project_id: p.id, name: "Unused" });
    const sprint = insertCycle(ctx, p.id, "Sprint");
    insertCycle(ctx, p.id, "Empty sprint", { sort_order: "a1" });
    createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [bug.id], cycle_id: sprint.id });
    const scope = { type: "project" as const, project_id: p.id };
    const labels = listWorkItems(ctx, { scope, display: { group_by: "labels", show_empty_groups: true } });
    expect(labels.groups?.map((g) => [g.name, g.count])).toEqual([
      ["Bug", 1],
      ["Unused", 0],
      ["None", 0],
    ]);
    expect(listWorkItems(ctx, { scope, display: { group_by: "labels", show_empty_groups: false } }).groups?.map((g) => g.name)).toEqual(["Bug"]);
    const cycles = listWorkItems(ctx, { scope, display: { group_by: "cycle", show_empty_groups: true } });
    expect(cycles.groups?.map((g) => [g.name, g.count])).toEqual([
      ["Sprint", 1],
      ["Empty sprint", 0],
      ["None", 0],
    ]);
    const stateGroups = listWorkItems(ctx, { scope, display: { group_by: "state_group", show_empty_groups: true } });
    expect(stateGroups.groups?.map((g) => g.id)).toEqual(["backlog", "unstarted", "started", "completed", "cancelled"]);
  });

  it("sub_group_by nests one level inside every group", () => {
    const { ctx, project: p, states } = setup();
    const bug = createLabel(ctx, { project_id: p.id, name: "Bug" });
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", label_ids: [bug.id], priority: "high" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", label_ids: [bug.id], priority: "low", state_id: states.Todo.id });
    const c = createWorkItem(ctx, { project_id: p.id, name: "C", priority: "high" });
    const result = listWorkItems(ctx, {
      scope: { type: "project", project_id: p.id },
      display: { group_by: "labels", sub_group_by: "priority", show_empty_groups: false },
    });
    expect(result.groups?.map((g) => g.name)).toEqual(["Bug", "None"]);
    expect(result.groups?.[0].sub_groups?.map((g) => [g.field, g.id, g.item_ids])).toEqual([
      ["priority", "high", [a.id]],
      ["priority", "low", [b.id]],
    ]);
    expect(result.groups?.[1].sub_groups?.map((g) => [g.id, g.item_ids])).toEqual([["high", [c.id]]]);
    const byState = listWorkItems(ctx, { scope: { type: "project", project_id: p.id }, display: { group_by: "priority", sub_group_by: "state", show_empty_groups: false } });
    expect(byState.groups?.map((g) => [g.id, g.sub_groups?.map((s) => [s.name, s.count])])).toEqual([
      ["high", [["Backlog", 2]]],
      ["low", [["Todo", 1]]],
    ]);
  });

  it("groups by created_at date, target_date, created_by and project", () => {
    const { ctx, project: p } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const a = createWorkItem(ctx, { project_id: p.id, name: "A", target_date: "2026-11-02" });
    const b = createWorkItem(ctx, { project_id: p.id, name: "B", target_date: "2026-11-01" });
    const c = createWorkItem(ctx, { project_id: other.id, name: "C" });
    const scope = { type: "workspace" as const };
    const byTarget = listWorkItems(ctx, { scope, display: { group_by: "target_date" } });
    expect(byTarget.groups?.map((g) => [g.id, g.item_ids])).toEqual([
      ["2026-11-01", [b.id]],
      ["2026-11-02", [a.id]],
      ["none", [c.id]],
    ]);
    const byCreated = listWorkItems(ctx, { scope, display: { group_by: "created_at" } });
    expect(byCreated.groups).toHaveLength(1);
    expect(byCreated.groups?.[0].id).toBe(localDateOf(ctx.now()));
    expect(byCreated.groups?.[0].count).toBe(3);
    const byCreator = listWorkItems(ctx, { scope, display: { group_by: "created_by", show_empty_groups: false } });
    expect(byCreator.groups?.map((g) => [g.name, g.count])).toEqual([["You", 3]]);
    const byProject = listWorkItems(ctx, { scope, display: { group_by: "project" } });
    expect(byProject.groups?.map((g) => [g.name, g.count])).toEqual([
      ["Web", 2],
      ["Other", 1],
    ]);
  });
});
