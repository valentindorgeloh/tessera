import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject, updateProjectFeatures, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import type { StateRow } from "@/lib/tessera/types";
import { notificationPhrase } from "@/components/inbox/inbox-format";
import { listNotifications } from "@/lib/tessera/notifications";
import { listRelations } from "@/lib/tessera/relations";
import { createWorkItem, getWorkItem, listWorkItems } from "@/lib/tessera/work-items";
import {
  acceptIntakeItem,
  createIntakeItem,
  declineIntakeItem,
  deleteIntakeItem,
  listIntakeItems,
  markIntakeDuplicate,
  snoozeIntakeItem,
} from "@/lib/tessera/intake";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

function setup(): { ctx: TesseraContext; project: Project; states: Record<string, StateRow> } {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  updateProjectFeatures(ctx, project.id, { intake_enabled: true });
  const states = Object.fromEntries(listStates(ctx, project.id).map((state) => [state.name, state]));
  return { ctx, project, states };
}

function ruleOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError && err.code === "RULE") return (err.details as { rule: string }).rule;
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

describe("intake", () => {
  it("records in-app creates without a notification, and agent creates with one", () => {
    const { ctx, project } = setup();
    const mine = createIntakeItem(ctx, { project_id: project.id, name: "Spec review" });
    expect(mine.source).toBe("in_app");
    expect(listNotifications(ctx).some((row) => row.kind === "intake_received")).toBe(false);

    const handles = createTestDb();
    const user = createTestContext(handles);
    const again = createProject(user, { name: "Web", identifier: "WEB" });
    updateProjectFeatures(user, again.id, { intake_enabled: true, agent_intake_required: true });
    const agent = registerActor(user, { kind: "agent", name: "mcp:bot" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    const item = createWorkItem(actx, { project_id: again.id, name: "From mcp" });
    const notes = listNotifications(user);
    expect(notes.some((row) => row.kind === "intake_received" && row.snippet.includes("submitted") && row.snippet.includes(item.key))).toBe(true);

    const assistant = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
    createIntakeItem(assistant, { project_id: again.id, name: "From the assistant" });
    expect(listNotifications(user).filter((row) => row.kind === "intake_received")).toHaveLength(1);
    handles.sqlite.close();
  });

  it("accepts into the default or a chosen state, hides a decline, and accepts it later", () => {
    const { ctx, project, states } = setup();
    const item = createIntakeItem(ctx, { project_id: project.id, name: "Review" });
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: project.id } }).total).toBe(0);
    const accepted = acceptIntakeItem(ctx, item.id, {});
    expect(accepted.status).toBe("accepted");
    expect(getWorkItem(ctx, item.work_item_id).state_id).toBe(states.Backlog.id);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: project.id } }).total).toBe(1);
    expect(ruleOf(() => acceptIntakeItem(ctx, item.id, {}))).toBe("intake_closed");

    const triage = listStates(ctx, project.id).find((state) => state.state_group === "triage");
    const second = createIntakeItem(ctx, { project_id: project.id, name: "Chosen" });
    expect(ruleOf(() => acceptIntakeItem(ctx, second.id, { state_id: triage?.id }))).toBe("triage_state");
    expect(acceptIntakeItem(ctx, second.id, { state_id: states.Todo.id }).status).toBe("accepted");
    expect(getWorkItem(ctx, second.work_item_id).state_id).toBe(states.Todo.id);

    const third = createIntakeItem(ctx, { project_id: project.id, name: "No" });
    declineIntakeItem(ctx, third.id);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: project.id } }).items.map((row) => row.id)).not.toContain(third.work_item_id);
    expect(listIntakeItems(ctx, { project_id: project.id, tab: "closed" }).items.some((row) => row.id === third.id && row.status === "declined")).toBe(true);
    acceptIntakeItem(ctx, third.id, {});
    expect(getWorkItem(ctx, third.work_item_id).state_id).toBe(states.Backlog.id);
  });

  it("refuses a snooze in the past, wakes a passed snooze into Open, and marks a duplicate", () => {
    const { ctx, project } = setup();
    const item = createIntakeItem(ctx, { project_id: project.id, name: "Later" });
    expect(ruleOf(() => snoozeIntakeItem(ctx, item.id, { until: "2000-01-01T00:00:00.000Z" }))).toBe("VALIDATION");
    snoozeIntakeItem(ctx, item.id, { until: "2099-01-01T00:00:00.000Z" });
    expect(listIntakeItems(ctx, { project_id: project.id, tab: "snoozed" }).total).toBe(1);
    const later = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: USER_ACTOR_ID, now: () => "2099-06-01T00:00:00.000Z" });
    const woken = listIntakeItems(later, { project_id: project.id, tab: "open" });
    expect(woken.items.map((row) => row.id)).toContain(item.id);
    expect(woken.items.find((row) => row.id === item.id)?.is_open).toBe(true);

    const original = createWorkItem(ctx, { project_id: project.id, name: "Original" });
    const copy = createIntakeItem(ctx, { project_id: project.id, name: "Dupe" });
    expect(ruleOf(() => markIntakeDuplicate(ctx, copy.id, { duplicate_of_id: copy.work_item_id }))).toBe("VALIDATION");
    const marked = markIntakeDuplicate(ctx, copy.id, { duplicate_of_id: original.id });
    expect(marked.status).toBe("duplicate");
    expect(marked.duplicate_to?.id).toBe(original.id);
    expect(listRelations(ctx, original.id).some((row) => row.relation_type === "duplicate")).toBe(true);
  });

  it("deletes the work item, counts tabs, and refuses creates when Intake is off", () => {
    const { ctx, project } = setup();
    const item = createIntakeItem(ctx, { project_id: project.id, name: "Gone" });
    expect(listIntakeItems(ctx, { project_id: project.id }).counts.open).toBe(1);
    deleteIntakeItem(ctx, item.id);
    expect(() => getWorkItem(ctx, item.work_item_id)).toThrow(TrackerError);
    expect(listIntakeItems(ctx, { project_id: project.id }).counts).toEqual({ open: 0, snoozed: 0, closed: 0 });
    updateProjectFeatures(ctx, project.id, { intake_enabled: false });
    expect(ruleOf(() => createIntakeItem(ctx, { project_id: project.id, name: "Nope" }))).toBe("feature_disabled");
  });
});

describe("createIntakeItem assignees (decisions 50, 51)", () => {
  it("gives an agent assignee an assigned row, subscribes creator and assignee once, and logs the assignment once", () => {
    const { ctx, project } = setup();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:assignee" });
    const view = createIntakeItem(ctx, { project_id: project.id, name: "Triage me", assignee_ids: [agent.id] });
    const agentCtx = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: agent.id });
    const rows = listNotifications(agentCtx).filter((note) => note.kind === "assigned");
    expect(rows.map((note) => note.work_item_id)).toEqual([view.work_item_id]);
    const detail = getWorkItem(ctx, view.work_item_id);
    expect([...detail.subscriber_ids].sort()).toEqual([USER_ACTOR_ID, agent.id].sort());
    expect(detail.assignee_ids).toEqual([agent.id]);
    const logged = ctx.sqlite
      .prepare<[string], { verb: string }>("SELECT verb FROM activity WHERE work_item_id = ? AND field = 'assignees'")
      .all(view.work_item_id);
    expect(logged).toEqual([{ verb: "added" }]);
  });

  it("an agent's submission assigned to the user is one row, 'assigned you · +1 more' (assigned outranks intake_received)", () => {
    const { ctx, project } = setup();
    updateProjectFeatures(ctx, project.id, { agent_intake_required: true });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:bot" });
    const agentCtx = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: agent.id });
    createIntakeItem(agentCtx, { project_id: project.id, name: "For you", assignee_ids: [USER_ACTOR_ID] });
    const rows = listNotifications(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "assigned", event_count: 2 });
    expect(notificationPhrase(rows[0]!.kind, rows[0]!.kind_count, rows[0]!.event_count)).toBe("assigned you · +1 more");
  });

  it("the assistant's submission assigned to the user gives the user no row (decision 50)", () => {
    const { ctx, project } = setup();
    const assistant = createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId: ASSISTANT_ACTOR_ID });
    createIntakeItem(assistant, { project_id: project.id, name: "From assistant", assignee_ids: [USER_ACTOR_ID] });
    expect(listNotifications(ctx)).toHaveLength(0);
  });
});
