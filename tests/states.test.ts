import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, state, work_item } from "@/lib/tessera/db/schema";
import { archiveProject, createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import {
  DEFAULT_STATES,
  createState,
  deleteState,
  getState,
  listStates,
  reorderState,
  setDefaultState,
  updateState,
} from "@/lib/tessera/states";
import type { StateRow } from "@/lib/tessera/types";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

type Fixture = { ctx: TesseraContext; projectId: string; states: StateRow[] };

function setup(): Fixture {
  const ctx = createTestContext(createTestDb());
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: p.id, states: listStates(ctx, p.id) };
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

function byName(states: StateRow[], name: string): StateRow {
  const found = states.find((s) => s.name === name);
  if (!found) throw new Error(`state ${name} missing`);
  return found;
}

let sequence = 0;

function insertWorkItem(ctx: TesseraContext, projectId: string, stateId: string, name: string, extra: Partial<typeof work_item.$inferInsert> = {}) {
  const now = ctx.now();
  sequence += 1;
  return ctx.db
    .insert(work_item)
    .values({
      id: newId(),
      project_id: projectId,
      sequence_id: sequence,
      name,
      state_id: stateId,
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
      ...extra,
    })
    .returning()
    .get();
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function defaults(ctx: TesseraContext, projectId: string): StateRow[] {
  return ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.is_default, true), isNull(state.deleted_at)))
    .all();
}

describe("listStates", () => {
  it("returns the seeded states in sort order and NOT_FOUND for an unknown project", () => {
    const { ctx, projectId, states } = setup();
    expect(states.map((s) => s.name)).toEqual(DEFAULT_STATES.map((s) => s.name));
    expect(errorCode(() => listStates(ctx, newId()))).toBe("NOT_FOUND");
    expect(getState(ctx, states[0].id).project_id).toBe(projectId);
    expect(errorCode(() => getState(ctx, newId()))).toBe("NOT_FOUND");
  });
});

describe("createState", () => {
  it("appends a state at the end with defaults and logs created", () => {
    const { ctx, projectId, states } = setup();
    const seqBefore = latestSeq(ctx);
    const qa = createState(ctx, { project_id: projectId, name: "  QA  ", state_group: "started" });
    expect(qa.name).toBe("QA");
    expect(qa.name_key).toBe("qa");
    expect(qa.color).toBe("gray");
    expect(qa.description).toBe("");
    expect(qa.is_default).toBe(false);
    expect(qa.sort_order > states[states.length - 1].sort_order).toBe(true);
    expect(listStates(ctx, projectId).map((s) => s.name).at(-1)).toBe("QA");
    const rows = activityRows(ctx, qa.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("created");
    expect(rows[0].new_identifier).toBe("QA");
    expect(rows[0].project_id).toBe(projectId);
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
    const review = createState(ctx, { project_id: projectId, name: "Review", state_group: "started", color: "purple", description: "Waiting for review" });
    expect(review.color).toBe("purple");
    expect(review.description).toBe("Waiting for review");
  });

  it("keeps names unique per project (case- and whitespace-insensitive) and reusable after delete", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createState(ctx, { project_id: projectId, name: "in   progress", state_group: "started" }))).toBe("CONFLICT");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createState(ctx, { project_id: other.id, name: "In Progress 2", state_group: "started" }).name).toBe("In Progress 2");
    const qa = createState(ctx, { project_id: projectId, name: "QA", state_group: "started" });
    deleteState(ctx, qa.id);
    expect(createState(ctx, { project_id: projectId, name: "qa", state_group: "started" }).name).toBe("qa");
  });

  it("rejects the triage group, bad colours, unknown projects and unknown keys", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createState(ctx, { project_id: projectId, name: "T", state_group: "triage" as "started" }))).toBe("VALIDATION");
    expect(errorCode(() => createState(ctx, { project_id: projectId, name: "T", state_group: "started", color: "neon" as "red" }))).toBe("VALIDATION");
    expect(errorCode(() => createState(ctx, { project_id: projectId, name: "T", state_group: "started", extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => createState(ctx, { project_id: newId(), name: "T", state_group: "started" }))).toBe("NOT_FOUND");
    expect(errorCode(() => createState(ctx, { project_id: "not-an-id", name: "T", state_group: "started" }))).toBe("VALIDATION");
  });

  it("with is_default swaps the default so exactly one default remains", () => {
    const { ctx, projectId } = setup();
    const triage = createState(ctx, { project_id: projectId, name: "Inbox", state_group: "unstarted", is_default: true });
    expect(triage.is_default).toBe(true);
    const rows = defaults(ctx, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(triage.id);
    expect(getState(ctx, byName(listStates(ctx, projectId), "Backlog").id).is_default).toBe(false);
  });
});

describe("default state", () => {
  it("createProject leaves exactly one default state", () => {
    const { ctx, projectId, states } = setup();
    expect(defaults(ctx, projectId).map((s) => s.name)).toEqual(["Backlog"]);
    expect(states.filter((s) => s.is_default)).toHaveLength(1);
  });

  it("setDefaultState swaps atomically and logs both sides", () => {
    const { ctx, projectId, states } = setup();
    const todo = byName(states, "Todo");
    const backlog = byName(states, "Backlog");
    const seqBefore = latestSeq(ctx);
    const result = setDefaultState(ctx, todo.id);
    expect(result.is_default).toBe(true);
    expect(defaults(ctx, projectId).map((s) => s.id)).toEqual([todo.id]);
    expect(getState(ctx, backlog.id).is_default).toBe(false);
    const rows = ctx.db.select().from(activity).all().filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => [r.entity_id, r.field, r.new_value])).toEqual([
      [backlog.id, "is_default", "false"],
      [todo.id, "is_default", "true"],
    ]);
    expect(setDefaultState(ctx, todo.id).is_default).toBe(true);
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    expect(errorCode(() => setDefaultState(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("the triage state can never become the default", () => {
    const { ctx, projectId } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true });
    const triage = listStates(ctx, projectId).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    expect(ruleName(() => setDefaultState(ctx, triage.id))).toBe("triage_default");
    expect(defaults(ctx, projectId).map((s) => s.name)).toEqual(["Backlog"]);
  });
});

describe("updateState", () => {
  it("updates name, description and colour with one activity row per field carrying identifiers", () => {
    const { ctx, projectId, states } = setup();
    const todo = byName(states, "Todo");
    const seqBefore = latestSeq(ctx);
    const updated = updateState(ctx, todo.id, { name: "To Do", color: "teal", description: "Ready" });
    expect(updated.name).toBe("To Do");
    expect(updated.name_key).toBe("to do");
    expect(updated.color).toBe("teal");
    expect(updated.description).toBe("Ready");
    const rows = activityRows(ctx, todo.id).filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => r.field)).toEqual(["name", "description", "color"]);
    expect(rows[0]).toMatchObject({ old_value: "Todo", new_value: "To Do", old_identifier: "Todo", new_identifier: "To Do", project_id: projectId });
    expect(rows[2]).toMatchObject({ old_value: "blue", new_value: "teal", old_identifier: "blue", new_identifier: "teal" });
    const seqAfter = latestSeq(ctx);
    expect(updateState(ctx, todo.id, { color: "teal" }).color).toBe("teal");
    expect(latestSeq(ctx)).toBe(seqAfter);
  });

  it("refuses a name used by another state of the project and validates input", () => {
    const { ctx, states } = setup();
    const todo = byName(states, "Todo");
    expect(errorCode(() => updateState(ctx, todo.id, { name: " DONE " }))).toBe("CONFLICT");
    expect(updateState(ctx, todo.id, { name: "todo" }).name).toBe("todo");
    expect(errorCode(() => updateState(ctx, todo.id, { name: "" }))).toBe("VALIDATION");
    expect(errorCode(() => updateState(ctx, todo.id, { state_group: "completed" } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateState(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
  });
});

describe("reorderState", () => {
  it("places the state between before_id and after_id", () => {
    const { ctx, projectId, states } = setup();
    const [backlog, todo, inProgress, done] = states;
    const moved = reorderState(ctx, done.id, { before_id: backlog.id, after_id: todo.id });
    expect(moved.sort_order > backlog.sort_order && moved.sort_order < todo.sort_order).toBe(true);
    expect(listStates(ctx, projectId).map((s) => s.name)).toEqual(["Backlog", "Done", "Todo", "In Progress", "Cancelled"]);
    const rows = activityRows(ctx, done.id);
    expect(rows.at(-1)?.field).toBe("sort_order");
    reorderState(ctx, done.id, { before_id: inProgress.id, after_id: byName(states, "Cancelled").id });
    expect(listStates(ctx, projectId).map((s) => s.name)).toEqual(["Backlog", "Todo", "In Progress", "Done", "Cancelled"]);
  });

  it("fills the missing neighbour when only before_id or only after_id is given", () => {
    const { ctx, projectId, states } = setup();
    const [backlog, , , , cancelled] = states;
    reorderState(ctx, cancelled.id, { before_id: backlog.id });
    expect(listStates(ctx, projectId).map((s) => s.name)).toEqual(["Backlog", "Cancelled", "Todo", "In Progress", "Done"]);
    reorderState(ctx, backlog.id, { after_id: byName(states, "Done").id });
    expect(listStates(ctx, projectId).map((s) => s.name)).toEqual(["Cancelled", "Todo", "In Progress", "Backlog", "Done"]);
    reorderState(ctx, backlog.id, { after_id: cancelled.id });
    expect(listStates(ctx, projectId).map((s) => s.name)[0]).toBe("Backlog");
    reorderState(ctx, backlog.id, { before_id: byName(states, "Done").id });
    expect(listStates(ctx, projectId).map((s) => s.name).at(-1)).toBe("Backlog");
  });

  it("rejects empty input, non-adjacent neighbours and neighbours from another project", () => {
    const { ctx, states } = setup();
    const [backlog, todo, , done] = states;
    expect(errorCode(() => reorderState(ctx, done.id, {}))).toBe("VALIDATION");
    expect(errorCode(() => reorderState(ctx, done.id, { before_id: backlog.id, after_id: byName(states, "Cancelled").id }))).toBe("VALIDATION");
    expect(errorCode(() => reorderState(ctx, done.id, { before_id: todo.id, after_id: backlog.id }))).toBe("VALIDATION");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = listStates(ctx, other.id)[0];
    expect(errorCode(() => reorderState(ctx, done.id, { before_id: foreign.id }))).toBe("NOT_FOUND");
    expect(errorCode(() => reorderState(ctx, done.id, { after_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => reorderState(ctx, done.id, { before_id: done.id }))).toBe("NOT_FOUND");
  });
});

describe("deleteState", () => {
  it("refuses the default state", () => {
    const { ctx, states } = setup();
    expect(ruleName(() => deleteState(ctx, byName(states, "Backlog").id))).toBe("default_state");
  });

  it("refuses the triage state", () => {
    const { ctx, projectId } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true });
    const triage = listStates(ctx, projectId).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    expect(ruleName(() => deleteState(ctx, triage.id))).toBe("triage_state");
  });

  it("refuses the last state of its group", () => {
    const { ctx, projectId, states } = setup();
    expect(ruleName(() => deleteState(ctx, byName(states, "Done").id))).toBe("last_state_in_group");
    createState(ctx, { project_id: projectId, name: "Shipped", state_group: "completed" });
    expect(() => deleteState(ctx, byName(states, "Done").id)).not.toThrow();
    expect(listStates(ctx, projectId).map((s) => s.name)).not.toContain("Done");
  });

  it("refuses to move the items of a deleted state into the triage state", () => {
    const { ctx, projectId, states } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true });
    const triage = listStates(ctx, projectId).find((s) => s.state_group === "triage");
    if (!triage) throw new Error("triage missing");
    const inProgress = byName(states, "In Progress");
    createState(ctx, { project_id: projectId, name: "Review", state_group: "started" });
    const a = insertWorkItem(ctx, projectId, inProgress.id, "a");
    expect(ruleName(() => deleteState(ctx, inProgress.id, { move_to_state_id: triage.id }))).toBe("triage_state");
    expect(ctx.db.select().from(work_item).where(eq(work_item.id, a.id)).get()?.state_id).toBe(inProgress.id);
    expect(getState(ctx, inProgress.id).deleted_at).toBeNull();
  });

  it("refuses a non-empty state unless move_to_state_id is given, then moves the items and logs each", () => {
    const { ctx, projectId, states } = setup();
    const inProgress = byName(states, "In Progress");
    const todo = byName(states, "Todo");
    const review = createState(ctx, { project_id: projectId, name: "Review", state_group: "started" });
    const a = insertWorkItem(ctx, projectId, inProgress.id, "a");
    const b = insertWorkItem(ctx, projectId, inProgress.id, "b", { archived_at: ctx.now() });
    const gone = insertWorkItem(ctx, projectId, inProgress.id, "gone", { deleted_at: ctx.now() });
    expect(ruleName(() => deleteState(ctx, inProgress.id))).toBe("state_not_empty");
    const seqBefore = latestSeq(ctx);
    deleteState(ctx, inProgress.id, { move_to_state_id: todo.id });
    expect(ctx.db.select().from(work_item).where(eq(work_item.id, a.id)).get()?.state_id).toBe(todo.id);
    expect(ctx.db.select().from(work_item).where(eq(work_item.id, b.id)).get()?.state_id).toBe(todo.id);
    expect(ctx.db.select().from(work_item).where(eq(work_item.id, gone.id)).get()?.state_id).toBe(inProgress.id);
    expect(errorCode(() => getState(ctx, inProgress.id))).toBe("NOT_FOUND");
    const rows = ctx.db.select().from(activity).all().filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => [r.entity_type, r.verb])).toEqual([
      ["work_item", "updated"],
      ["work_item", "updated"],
      ["state", "deleted"],
    ]);
    expect(rows[0]).toMatchObject({ entity_id: a.id, work_item_id: a.id, field: "state_id", old_value: inProgress.id, new_value: todo.id, old_identifier: "In Progress", new_identifier: "Todo" });
    expect(rows[2]).toMatchObject({ entity_id: inProgress.id, old_identifier: "In Progress", project_id: projectId });
    expect(listStates(ctx, projectId).map((s) => s.name)).toContain(review.name);
  });

  it("keeps completed_at in step with the destination group when moving items", () => {
    const { ctx, projectId, states } = setup();
    const done = byName(states, "Done");
    const todo = byName(states, "Todo");
    const shipped = createState(ctx, { project_id: projectId, name: "Shipped", state_group: "completed" });
    const spare = createState(ctx, { project_id: projectId, name: "Spare", state_group: "unstarted" });
    const finished = insertWorkItem(ctx, projectId, done.id, "finished", { completed_at: "2026-01-01T00:00:00.000Z" });
    deleteState(ctx, done.id, { move_to_state_id: todo.id });
    expect(ctx.db.select().from(work_item).where(eq(work_item.id, finished.id)).get()?.completed_at).toBeNull();
    const pending = insertWorkItem(ctx, projectId, spare.id, "pending");
    deleteState(ctx, spare.id, { move_to_state_id: shipped.id });
    const movedIn = ctx.db.select().from(work_item).where(eq(work_item.id, pending.id)).get();
    expect(movedIn?.state_id).toBe(shipped.id);
    expect(movedIn?.completed_at).not.toBeNull();
  });

  it("validates the move target: same project, not deleted, not itself", () => {
    const { ctx, projectId, states } = setup();
    const inProgress = byName(states, "In Progress");
    createState(ctx, { project_id: projectId, name: "Review", state_group: "started" });
    insertWorkItem(ctx, projectId, inProgress.id, "a");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = listStates(ctx, other.id)[0];
    expect(ruleName(() => deleteState(ctx, inProgress.id, { move_to_state_id: foreign.id }))).toBe("move_target_project");
    expect(ruleName(() => deleteState(ctx, inProgress.id, { move_to_state_id: inProgress.id }))).toBe("move_target_self");
    expect(errorCode(() => deleteState(ctx, inProgress.id, { move_to_state_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => deleteState(ctx, inProgress.id, { move_to_state_id: "nope" }))).toBe("VALIDATION");
    expect(errorCode(() => deleteState(ctx, newId()))).toBe("NOT_FOUND");
    expect(getState(ctx, inProgress.id).deleted_at).toBeNull();
  });

  it("deletes an empty non-default state and logs deleted", () => {
    const { ctx, projectId, states } = setup();
    const qa = createState(ctx, { project_id: projectId, name: "QA", state_group: "started" });
    const seqBefore = latestSeq(ctx);
    deleteState(ctx, qa.id);
    expect(errorCode(() => getState(ctx, qa.id))).toBe("NOT_FOUND");
    expect(listStates(ctx, projectId)).toHaveLength(states.length);
    const rows = activityRows(ctx, qa.id).filter((r) => r.seq > seqBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("deleted");
    expect(rows[0].old_identifier).toBe("QA");
    expect(errorCode(() => deleteState(ctx, qa.id))).toBe("NOT_FOUND");
  });
});

describe("archived project", () => {
  it("every state mutation is refused with ARCHIVED", () => {
    const { ctx, projectId, states } = setup();
    const todo = byName(states, "Todo");
    const qa = createState(ctx, { project_id: projectId, name: "QA", state_group: "started" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => createState(ctx, { project_id: projectId, name: "X", state_group: "started" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateState(ctx, todo.id, { name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => reorderState(ctx, todo.id, { before_id: qa.id }))).toBe("ARCHIVED");
    expect(errorCode(() => setDefaultState(ctx, todo.id))).toBe("ARCHIVED");
    expect(errorCode(() => deleteState(ctx, qa.id))).toBe("ARCHIVED");
    expect(listStates(ctx, projectId)).toHaveLength(6);
  });
});
