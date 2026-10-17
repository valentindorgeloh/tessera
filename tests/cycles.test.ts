import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID, registerActor, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { getCounts } from "@/lib/tessera/counts";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import {
  addWorkItemsToCycle,
  archiveCycle,
  createCycle,
  deleteCycle,
  deriveCycleStatus,
  getActiveCycles,
  getCycle,
  getCycleProgress,
  listCycles,
  removeWorkItemsFromCycle,
  reorderCycle,
  transferCycleWorkItems,
  unarchiveCycle,
  updateCycle,
} from "@/lib/tessera/cycles";
import { activity, cycle, estimate, estimate_point, project, view, work_item, work_item_assignee, work_item_label } from "@/lib/tessera/db/schema";
import { createLabel } from "@/lib/tessera/labels";
import { archiveProject, createProject, deleteProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { DEFAULT_DISPLAY, FiltersSchema } from "@/lib/tessera/schemas";
import type { CycleProgress, Filters, StateRow } from "@/lib/tessera/types";
import { getViewSettings, saveViewSettings } from "@/lib/tessera/view-settings";
import { createWorkItem, deleteWorkItem, listWorkItems, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles, type TesseraContext } from "./helpers/db";
import { withTimeZone } from "./helpers/time-zone";

const TODAY = "2026-03-10";

/** Date ranges relative to TODAY. */
const CURRENT = { start_date: "2026-03-01", end_date: "2026-03-14" };
const UPCOMING = { start_date: "2026-03-20", end_date: "2026-03-31" };
const COMPLETED = { start_date: "2026-02-01", end_date: "2026-02-28" };
const EARLIER = { start_date: "2026-01-01", end_date: "2026-01-31" };

type Fixture = { ctx: TesseraContext; handles: DbHandles; projectId: string; states: StateRow[] };

function contextAt(handles: DbHandles, today: string): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => today });
}

function setup(today: string = TODAY): Fixture {
  const handles = createTestDb();
  const ctx = contextAt(handles, today);
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, handles, projectId: p.id, states: listStates(ctx, p.id) };
}

function caught(fn: () => unknown): TrackerError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err;
    throw err;
  }
  return undefined;
}

function errorCode(fn: () => unknown): string | undefined {
  return caught(fn)?.code;
}

function ruleName(fn: () => unknown): string | undefined {
  const err = caught(fn);
  if (!err) return undefined;
  if (err.code !== "RULE") throw err;
  return (err.details as { rule: string }).rule;
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

function workItemRow(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(work_item).where(eq(work_item.id, id)).get();
  if (!row) throw new Error("work item missing");
  return row;
}

function cycleRow(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(cycle).where(eq(cycle.id, id)).get();
  if (!row) throw new Error("cycle missing");
  return row;
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function addLabel(ctx: TesseraContext, workItemId: string, labelId: string): void {
  ctx.db.insert(work_item_label).values({ work_item_id: workItemId, label_id: labelId }).run();
}

function assign(ctx: TesseraContext, workItemId: string, actorId: string): void {
  ctx.db.insert(work_item_assignee).values({ work_item_id: workItemId, actor_id: actorId }).run();
}

/** Makes `estimateId` the project's active estimate (estimates_enabled plus estimate_id). */
function activateEstimate(ctx: TesseraContext, projectId: string, estimateId: string): void {
  ctx.db.update(project).set({ estimates_enabled: true, estimate_id: estimateId }).where(eq(project.id, projectId)).run();
}

function estimateIdOf(ctx: TesseraContext, pointId: string): string {
  const row = ctx.db.select({ estimate_id: estimate_point.estimate_id }).from(estimate_point).where(eq(estimate_point.id, pointId)).get();
  if (!row) throw new Error("estimate point missing");
  return row.estimate_id;
}

/**
 * Creates a points estimate with one point per value, makes it the project's
 * active estimate unless `activate` is false (cycle points follow the active
 * estimate) and returns the point ids in order.
 */
function insertEstimatePoints(ctx: TesseraContext, projectId: string, values: string[], { activate = true }: { activate?: boolean } = {}): string[] {
  const now = ctx.now();
  const audit = { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
  const est = ctx.db
    .insert(estimate)
    .values({ id: newId(), project_id: projectId, name: "Points", type: "points", ...audit })
    .returning()
    .get();
  if (activate) activateEstimate(ctx, projectId, est.id);
  return values.map(
    (value, position) =>
      ctx.db
        .insert(estimate_point)
        .values({ id: newId(), estimate_id: est.id, position, value, ...audit })
        .returning()
        .get().id,
  );
}

describe("createCycle", () => {
  it("creates a draft cycle without dates, appends sort_order and logs created", () => {
    const { ctx, projectId } = setup();
    const seqBefore = latestSeq(ctx);
    const draft = createCycle(ctx, { project_id: projectId, name: "  Sprint 1  " });
    expect(draft.name).toBe("Sprint 1");
    expect(draft.status).toBe("draft");
    expect(draft.start_date).toBeNull();
    expect(draft.end_date).toBeNull();
    expect(draft.description_md).toBe("");
    expect(draft.progress_snapshot).toBeNull();
    expect(draft.archived_at).toBeNull();
    expect(draft.progress.total).toBe(0);
    expect(draft.open_count).toBe(0);
    expect(draft.created_by).toBe(ctx.actor.id);
    const second = createCycle(ctx, { project_id: projectId, name: "Sprint 1", description_md: "Goals", ...CURRENT });
    expect(second.status).toBe("current");
    expect(second.description_md).toBe("Goals");
    expect(draft.sort_order < second.sort_order).toBe(true);
    const rows = activityRows(ctx, draft.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "created", entity_type: "cycle", new_identifier: "Sprint 1", project_id: projectId });
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
  });

  it("requires both dates or none (VALIDATION)", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-03-01" }))).toBe("VALIDATION");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", end_date: "2026-03-01" }))).toBe("VALIDATION");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-03-01", end_date: null }))).toBe("VALIDATION");
    expect(listCycles(ctx, projectId)).toHaveLength(0);
    expect(createCycle(ctx, { project_id: projectId, name: "A", start_date: null, end_date: null }).status).toBe("draft");
  });

  it("requires start_date <= end_date (VALIDATION)", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-03-10", end_date: "2026-03-09" }))).toBe("VALIDATION");
    expect(createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-03-10", end_date: "2026-03-10" }).status).toBe("current");
  });

  it("rejects dates that are not calendar days, empty names and unknown keys before writing", () => {
    const { ctx, projectId } = setup();
    const seqBefore = latestSeq(ctx);
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-02-30", end_date: "2026-03-01" }))).toBe("VALIDATION");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-3-1", end_date: "2026-03-01" }))).toBe("VALIDATION");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "  " }))).toBe("VALIDATION");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A", bogus: 1 } as never))).toBe("VALIDATION");
    expect(listCycles(ctx, projectId)).toHaveLength(0);
    expect(latestSeq(ctx)).toBe(seqBefore);
  });

  it("refuses overlapping non-archived cycles in the same project, inclusive at both ends (CONFLICT)", () => {
    const { ctx, projectId } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "B", start_date: "2026-03-14", end_date: "2026-03-20" }))).toBe("CONFLICT");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "B", start_date: "2026-02-20", end_date: "2026-03-01" }))).toBe("CONFLICT");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "B", start_date: "2026-03-05", end_date: "2026-03-07" }))).toBe("CONFLICT");
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "B", start_date: "2026-02-01", end_date: "2026-04-01" }))).toBe("CONFLICT");
    const err = caught(() => createCycle(ctx, { project_id: projectId, name: "B", ...CURRENT }));
    expect(err?.details).toEqual({ ids: [a.id] });
    expect(createCycle(ctx, { project_id: projectId, name: "After", start_date: "2026-03-15", end_date: "2026-03-28" }).status).toBe("upcoming");
    expect(createCycle(ctx, { project_id: projectId, name: "Before", start_date: "2026-02-20", end_date: "2026-02-28" }).status).toBe("completed");
    expect(listCycles(ctx, projectId)).toHaveLength(3);
  });

  it("lets archived cycles and drafts share dates, and names repeat", () => {
    const { ctx, projectId } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    archiveCycle(ctx, done.id);
    expect(createCycle(ctx, { project_id: projectId, name: "Feb", start_date: "2026-02-05", end_date: "2026-02-08" }).name).toBe("Feb");
    expect(createCycle(ctx, { project_id: projectId, name: "Draft" }).status).toBe("draft");
    expect(createCycle(ctx, { project_id: projectId, name: "Draft" }).status).toBe("draft");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createCycle(ctx, { project_id: other.id, name: "Feb", ...COMPLETED }).project_id).toBe(other.id);
  });

  it("is NOT_FOUND for a missing project and ARCHIVED for an archived one", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createCycle(ctx, { project_id: newId(), name: "A" }))).toBe("NOT_FOUND");
    archiveProject(ctx, projectId);
    expect(errorCode(() => createCycle(ctx, { project_id: projectId, name: "A" }))).toBe("ARCHIVED");
  });
});

describe("derived status", () => {
  it("derives current, upcoming, completed and draft from the dates and ctx.today()", () => {
    const { ctx, handles, projectId } = setup();
    const current = createCycle(ctx, { project_id: projectId, name: "Current", ...CURRENT });
    expect(current.status).toBe("current");
    expect(createCycle(ctx, { project_id: projectId, name: "Upcoming", ...UPCOMING }).status).toBe("upcoming");
    expect(createCycle(ctx, { project_id: projectId, name: "Completed", ...COMPLETED }).status).toBe("completed");
    expect(createCycle(ctx, { project_id: projectId, name: "Draft" }).status).toBe("draft");
    expect(getCycle(contextAt(handles, "2026-02-28"), current.id).status).toBe("upcoming");
    expect(getCycle(contextAt(handles, "2026-03-01"), current.id).status).toBe("current");
    expect(getCycle(contextAt(handles, "2026-03-14"), current.id).status).toBe("current");
    expect(getCycle(contextAt(handles, "2026-03-15"), current.id).status).toBe("completed");
    expect(deriveCycleStatus({ start_date: null, end_date: null }, TODAY)).toBe("draft");
    expect(deriveCycleStatus({ start_date: "2026-03-10", end_date: null }, TODAY)).toBe("draft");
  });
});

describe("listCycles and getCycle", () => {
  it("lists active cycles in sort order with status and a (total, completed, cancelled) summary; archived ones on request", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const b = createCycle(ctx, { project_id: projectId, name: "B", ...UPCOMING });
    const c = createCycle(ctx, { project_id: projectId, name: "C", ...COMPLETED });
    const d = createCycle(ctx, { project_id: projectId, name: "D" });
    archiveCycle(ctx, c.id);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: a.id });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "two", { cycle_id: a.id });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "three", { cycle_id: a.id });
    insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "four", { cycle_id: a.id });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "deleted", { cycle_id: a.id, deleted_at: ctx.now() });
    insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "deleted cancelled", { cycle_id: a.id, deleted_at: ctx.now() });
    const listed = listCycles(ctx, projectId);
    expect(listed.map((row) => row.id)).toEqual([a.id, b.id, d.id]);
    expect(listed.map((row) => row.status)).toEqual(["current", "upcoming", "draft"]);
    expect(listed[0].progress).toEqual({ total: 4, completed: 1, cancelled: 1 });
    // The summary counts the rows the progress panel counts, so a row's completed / (total - cancelled) matches it.
    expect(getCycleProgress(ctx, a.id)).toMatchObject(listed[0].progress);
    expect(listed[1].progress).toEqual({ total: 0, completed: 0, cancelled: 0 });
    expect(listCycles(ctx, projectId, { archived: true }).map((row) => row.id)).toEqual([c.id]);
    expect(errorCode(() => listCycles(ctx, newId()))).toBe("NOT_FOUND");
    expect(errorCode(() => listCycles(ctx, projectId, { archived: "yes" } as never))).toBe("VALIDATION");
  });

  it("filters by derived status", () => {
    const { ctx, projectId } = setup();
    createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const b = createCycle(ctx, { project_id: projectId, name: "B", ...UPCOMING });
    const c = createCycle(ctx, { project_id: projectId, name: "C", ...COMPLETED });
    const d = createCycle(ctx, { project_id: projectId, name: "D" });
    expect(listCycles(ctx, projectId, { status: "upcoming" }).map((row) => row.id)).toEqual([b.id]);
    expect(listCycles(ctx, projectId, { status: "completed" }).map((row) => row.id)).toEqual([c.id]);
    expect(listCycles(ctx, projectId, { status: "draft" }).map((row) => row.id)).toEqual([d.id]);
    archiveCycle(ctx, c.id);
    expect(listCycles(ctx, projectId, { status: "completed" })).toEqual([]);
    expect(listCycles(ctx, projectId, { status: "completed", archived: true }).map((row) => row.id)).toEqual([c.id]);
    expect(errorCode(() => listCycles(ctx, projectId, { status: "done" as "draft" }))).toBe("VALIDATION");
  });

  it("getCycle returns the full progress and is NOT_FOUND for deleted or unknown cycles", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const todo = byName(states, "Todo");
    insertWorkItem(ctx, projectId, todo.id, "one", { cycle_id: a.id });
    const detail = getCycle(ctx, a.id);
    expect(detail.status).toBe("current");
    expect(detail.progress).toMatchObject({ total: 1, unstarted: 1, completed: 0, by_state: { [todo.id]: 1 }, by_label: {}, by_assignee: {} });
    expect(detail.progress.points).toBeUndefined();
    expect(Object.keys(detail.progress.completion_chart)).toHaveLength(10);
    deleteCycle(ctx, a.id);
    expect(errorCode(() => getCycle(ctx, a.id))).toBe("NOT_FOUND");
    expect(errorCode(() => getCycle(ctx, newId()))).toBe("NOT_FOUND");
  });
});

describe("updateCycle", () => {
  it("updates name, description and dates with one activity row per field", () => {
    const { ctx, projectId } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "Sprint 1" });
    const seqBefore = latestSeq(ctx);
    const updated = updateCycle(ctx, c.id, { name: "Sprint 2", description_md: "Goals", ...CURRENT });
    expect(updated.name).toBe("Sprint 2");
    expect(updated.description_md).toBe("Goals");
    expect(updated.status).toBe("current");
    const rows = activityRows(ctx, c.id).filter((row) => row.seq > seqBefore);
    expect(rows.map((row) => row.field)).toEqual(["name", "description_md", "start_date", "end_date"]);
    expect(rows[0]).toMatchObject({ verb: "updated", old_identifier: "Sprint 1", new_identifier: "Sprint 2", project_id: projectId });
    expect(rows[2]).toMatchObject({ old_value: null, new_value: "2026-03-01" });
    const seqAfter = latestSeq(ctx);
    expect(updateCycle(ctx, c.id, { name: "Sprint 2" }).name).toBe("Sprint 2");
    expect(latestSeq(ctx)).toBe(seqAfter);
    const cleared = updateCycle(ctx, c.id, { start_date: null, end_date: null });
    expect(cleared.status).toBe("draft");
    expect(activityRows(ctx, c.id).at(-1)).toMatchObject({ field: "end_date", old_value: "2026-03-14", new_value: null });
  });

  it("re-validates the merged dates and checks overlap excluding itself", () => {
    const { ctx, projectId } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    createCycle(ctx, { project_id: projectId, name: "B", start_date: "2026-03-15", end_date: "2026-03-28" });
    expect(errorCode(() => updateCycle(ctx, a.id, { end_date: "2026-03-15" }))).toBe("CONFLICT");
    expect(errorCode(() => updateCycle(ctx, a.id, { end_date: "2026-02-28" }))).toBe("VALIDATION");
    expect(errorCode(() => updateCycle(ctx, a.id, { start_date: null }))).toBe("VALIDATION");
    expect(updateCycle(ctx, a.id, { start_date: "2026-03-02" }).start_date).toBe("2026-03-02");
    expect(updateCycle(ctx, a.id, { name: "Renamed" }).name).toBe("Renamed");
    expect(errorCode(() => updateCycle(ctx, a.id, { project_id: projectId } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateCycle(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
  });

  it("completed cycles are read-only (LOCKED)", () => {
    const { ctx, projectId } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    expect(errorCode(() => updateCycle(ctx, c.id, { name: "March" }))).toBe("LOCKED");
    expect(errorCode(() => updateCycle(ctx, c.id, { end_date: "2026-03-31" }))).toBe("LOCKED");
    expect(getCycle(ctx, c.id).name).toBe("Feb");
  });

  it("archived cycles and cycles of archived projects are read-only (ARCHIVED)", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const item = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one");
    archiveCycle(ctx, c.id);
    expect(errorCode(() => updateCycle(ctx, c.id, { name: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => reorderCycle(ctx, c.id, { before_id: c.id }))).toBe("ARCHIVED");
    expect(errorCode(() => addWorkItemsToCycle(ctx, c.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => removeWorkItemsFromCycle(ctx, c.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => transferCycleWorkItems(ctx, c.id, { to_cycle_id: null }))).toBe("ARCHIVED");
    expect(errorCode(() => archiveCycle(ctx, c.id))).toBe("ARCHIVED");
    const draft = createCycle(ctx, { project_id: projectId, name: "Draft" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => updateCycle(ctx, draft.id, { name: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => deleteCycle(ctx, draft.id))).toBe("ARCHIVED");
    expect(getCycle(ctx, draft.id).name).toBe("Draft");
  });
});

describe("reorderCycle", () => {
  it("moves between neighbours, fills a missing side and is allowed on completed cycles", () => {
    const { ctx, projectId } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A" });
    const b = createCycle(ctx, { project_id: projectId, name: "B" });
    const c = createCycle(ctx, { project_id: projectId, name: "C", ...COMPLETED });
    const d = createCycle(ctx, { project_id: projectId, name: "D" });
    const names = () => listCycles(ctx, projectId).map((row) => row.name);
    reorderCycle(ctx, d.id, { before_id: a.id, after_id: b.id });
    expect(names()).toEqual(["A", "D", "B", "C"]);
    reorderCycle(ctx, a.id, { before_id: c.id });
    expect(names()).toEqual(["D", "B", "C", "A"]);
    expect(reorderCycle(ctx, c.id, { after_id: d.id }).status).toBe("completed");
    expect(names()).toEqual(["C", "D", "B", "A"]);
    expect(activityRows(ctx, c.id).at(-1)).toMatchObject({ field: "sort_order", old_identifier: "C", new_identifier: "C" });
    expect(errorCode(() => reorderCycle(ctx, c.id, {}))).toBe("VALIDATION");
    expect(errorCode(() => reorderCycle(ctx, c.id, { before_id: d.id, after_id: a.id }))).toBe("VALIDATION");
    expect(errorCode(() => reorderCycle(ctx, c.id, { before_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => reorderCycle(ctx, newId(), { before_id: a.id }))).toBe("NOT_FOUND");
    archiveCycle(ctx, c.id);
    expect(errorCode(() => reorderCycle(ctx, a.id, { after_id: c.id }))).toBe("NOT_FOUND");
    expect(names()).toEqual(["D", "B", "A"]);
  });

  it("computes keys across archived cycles so unarchiving never creates ties", () => {
    const { ctx, projectId } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A" });
    const b = createCycle(ctx, { project_id: projectId, name: "B" });
    const c = createCycle(ctx, { project_id: projectId, name: "C", ...COMPLETED });
    const names = () => listCycles(ctx, projectId).map((row) => row.name);
    const keys = () => [a, b, c].map((row) => cycleRow(ctx, row.id).sort_order);
    archiveCycle(ctx, c.id);
    reorderCycle(ctx, a.id, { before_id: b.id });
    expect(names()).toEqual(["B", "A"]);
    expect(new Set(keys()).size).toBe(3);
    unarchiveCycle(ctx, c.id);
    expect(names()).toEqual(["B", "A", "C"]);
    reorderCycle(ctx, c.id, { before_id: b.id, after_id: a.id });
    expect(names()).toEqual(["B", "C", "A"]);
    expect(new Set(keys()).size).toBe(3);
  });
});

describe("archiveCycle and unarchiveCycle", () => {
  it("archives only after end_date (RULE cycle_not_ended)", () => {
    const { ctx, handles, projectId } = setup();
    const current = createCycle(ctx, { project_id: projectId, name: "Current", ...CURRENT });
    const upcoming = createCycle(ctx, { project_id: projectId, name: "Upcoming", ...UPCOMING });
    const draft = createCycle(ctx, { project_id: projectId, name: "Draft" });
    const done = createCycle(ctx, { project_id: projectId, name: "Done", ...COMPLETED });
    expect(ruleName(() => archiveCycle(ctx, current.id))).toBe("cycle_not_ended");
    expect(ruleName(() => archiveCycle(ctx, upcoming.id))).toBe("cycle_not_ended");
    expect(ruleName(() => archiveCycle(ctx, draft.id))).toBe("cycle_not_ended");
    expect(ruleName(() => archiveCycle(contextAt(handles, CURRENT.end_date), current.id))).toBe("cycle_not_ended");
    const archivedCycle = archiveCycle(ctx, done.id);
    expect(archivedCycle.archived_at).not.toBeNull();
    expect(archivedCycle.status).toBe("completed");
    expect(activityRows(ctx, done.id).at(-1)).toMatchObject({ verb: "archived", old_identifier: "Done" });
    expect(listCycles(ctx, projectId).map((row) => row.id)).toEqual([current.id, upcoming.id, draft.id]);
    expect(archiveCycle(contextAt(handles, "2026-03-15"), current.id).archived_at).not.toBeNull();
    expect(errorCode(() => archiveCycle(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("freezes progress_snapshot at archive when it is still null", () => {
    const { ctx, projectId, states } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Done", ...COMPLETED });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: done.id });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "two", { cycle_id: done.id });
    const finished = insertWorkItem(ctx, projectId, byName(states, "Done").id, "three", { cycle_id: done.id, completed_at: "2026-02-10T12:00:00.000Z" });
    const archivedCycle = archiveCycle(ctx, done.id);
    expect(archivedCycle.progress_snapshot).toMatchObject({ total: 3, completed: 1, unstarted: 2, labels: [{ id: null, total: 3, completed: 1 }] });
    // No active estimate: neither point totals nor a points series are frozen.
    expect(archivedCycle.progress_snapshot?.points).toBeUndefined();
    expect(archivedCycle.progress_snapshot?.completion_chart_points).toBeUndefined();
    expect(archivedCycle.progress).toMatchObject({ total: 3, completed: 1, chart_mode: "issues" });
    expect(archivedCycle.progress.points).toBeUndefined();
    // The snapshot is served even after the underlying rows change.
    ctx.db.update(work_item).set({ deleted_at: ctx.now() }).where(eq(work_item.id, finished.id)).run();
    expect(getCycleProgress(ctx, done.id, { mode: "issues" })).toMatchObject({ total: 3, completed: 1 });
    expect(getCycleProgress(ctx, done.id, { mode: "points" })).toMatchObject({ total: 3, completed: 1, chart_mode: "issues" });
    expect(getCycleProgress(ctx, done.id, { mode: "points" }).points).toBeUndefined();
    expect(listCycles(ctx, projectId, { archived: true })[0].progress).toEqual({ total: 3, completed: 1, cancelled: 0 });
  });

  it("unarchive restores the cycle, refuses non-archived cycles (RULE) and overlapping dates (CONFLICT), keeps the snapshot", () => {
    const { ctx, projectId } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    expect(ruleName(() => unarchiveCycle(ctx, done.id))).toBe("not_archived");
    archiveCycle(ctx, done.id);
    const blocker = createCycle(ctx, { project_id: projectId, name: "Blocker", start_date: "2026-02-10", end_date: "2026-02-20" });
    expect(errorCode(() => unarchiveCycle(ctx, done.id))).toBe("CONFLICT");
    archiveCycle(ctx, blocker.id);
    const restored = unarchiveCycle(ctx, done.id);
    expect(restored.archived_at).toBeNull();
    expect(restored.status).toBe("completed");
    expect(restored.progress_snapshot).not.toBeNull();
    expect(activityRows(ctx, done.id).at(-1)).toMatchObject({ verb: "restored", new_identifier: "Feb" });
    expect(listCycles(ctx, projectId).map((row) => row.id)).toEqual([done.id]);
    expect(errorCode(() => unarchiveCycle(ctx, newId()))).toBe("NOT_FOUND");
  });
});

describe("addWorkItemsToCycle", () => {
  it("refuses to pull items out of a completed (LOCKED) or archived (ARCHIVED) cycle", () => {
    const { ctx, projectId, states } = setup();
    const ended = createCycle(ctx, { project_id: projectId, name: "Ended", ...COMPLETED });
    const gone = createCycle(ctx, { project_id: projectId, name: "Gone", ...EARLIER });
    archiveCycle(ctx, gone.id);
    const target = createCycle(ctx, { project_id: projectId, name: "Next", ...UPCOMING });
    const todo = byName(states, "Todo").id;
    const one = insertWorkItem(ctx, projectId, todo, "one", { cycle_id: ended.id });
    const two = insertWorkItem(ctx, projectId, todo, "two", { cycle_id: gone.id });
    const free = insertWorkItem(ctx, projectId, todo, "free");
    expect(errorCode(() => addWorkItemsToCycle(ctx, target.id, [free.id, one.id]))).toBe("LOCKED");
    expect(errorCode(() => addWorkItemsToCycle(ctx, target.id, [two.id]))).toBe("ARCHIVED");
    expect(workItemRow(ctx, one.id).cycle_id).toBe(ended.id);
    expect(workItemRow(ctx, two.id).cycle_id).toBe(gone.id);
    expect(workItemRow(ctx, free.id).cycle_id).toBeNull();
    expect(addWorkItemsToCycle(ctx, target.id, [free.id]).progress.total).toBe(1);
  });

  it("adds items, replaces the previous cycle and logs on the cycle and on each item with cycle names", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const b = createCycle(ctx, { project_id: projectId, name: "B", ...UPCOMING });
    const one = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one");
    const two = insertWorkItem(ctx, projectId, byName(states, "Backlog").id, "two");
    const seqBefore = latestSeq(ctx);
    const detail = addWorkItemsToCycle(ctx, a.id, [one.id, two.id]);
    expect(detail.id).toBe(a.id);
    expect(detail.progress.total).toBe(2);
    expect(workItemRow(ctx, one.id).cycle_id).toBe(a.id);
    expect(workItemRow(ctx, two.id).cycle_id).toBe(a.id);
    expect(workItemRow(ctx, one.id).updated_by).toBe(ctx.actor.id);
    const itemRows = activityRows(ctx, one.id);
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]).toMatchObject({
      entity_type: "work_item",
      work_item_id: one.id,
      verb: "updated",
      field: "cycle_id",
      old_value: null,
      new_value: a.id,
      old_identifier: null,
      new_identifier: "A",
      project_id: projectId,
    });
    const cycleRows = activityRows(ctx, a.id).filter((row) => row.seq > seqBefore);
    expect(cycleRows.map((row) => row.verb)).toEqual(["added", "added"]);
    expect(cycleRows[0]).toMatchObject({ entity_type: "cycle", new_value: one.id, new_identifier: `WEB-${one.sequence_id}`, work_item_id: null });
    expect(latestSeq(ctx)).toBe(seqBefore + 4);
    addWorkItemsToCycle(ctx, b.id, [one.id]);
    expect(workItemRow(ctx, one.id).cycle_id).toBe(b.id);
    expect(workItemRow(ctx, two.id).cycle_id).toBe(a.id);
    expect(activityRows(ctx, one.id).at(-1)).toMatchObject({ field: "cycle_id", old_value: a.id, new_value: b.id, old_identifier: "A", new_identifier: "B" });
    expect(activityRows(ctx, a.id).at(-1)).toMatchObject({ verb: "removed", old_value: one.id, old_identifier: `WEB-${one.sequence_id}` });
    expect(activityRows(ctx, b.id).at(-1)).toMatchObject({ verb: "added", new_value: one.id, new_identifier: `WEB-${one.sequence_id}` });
    expect(getCycle(ctx, a.id).progress.total).toBe(1);
    expect(getCycle(ctx, b.id).progress.total).toBe(1);
  });

  it("refuses completed or cancelled items (RULE work_item_closed) without moving the others", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const open = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "open");
    const done = insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { completed_at: ctx.now() });
    const cancelled = insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "cancelled");
    const seqBefore = latestSeq(ctx);
    expect(ruleName(() => addWorkItemsToCycle(ctx, a.id, [open.id, done.id]))).toBe("work_item_closed");
    expect(ruleName(() => addWorkItemsToCycle(ctx, a.id, [cancelled.id]))).toBe("work_item_closed");
    expect(workItemRow(ctx, open.id).cycle_id).toBeNull();
    expect(latestSeq(ctx)).toBe(seqBefore);
  });

  it("refuses items from another project (RULE), archived items (ARCHIVED) and unknown items (NOT_FOUND)", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = insertWorkItem(ctx, other.id, byName(listStates(ctx, other.id), "Todo").id, "foreign");
    const archivedItem = insertWorkItem(ctx, projectId, byName(states, "Done").id, "archived", { archived_at: ctx.now(), completed_at: ctx.now() });
    const deleted = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "deleted", { deleted_at: ctx.now() });
    expect(ruleName(() => addWorkItemsToCycle(ctx, a.id, [foreign.id]))).toBe("cycle_project_mismatch");
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, [archivedItem.id]))).toBe("ARCHIVED");
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, [deleted.id]))).toBe("NOT_FOUND");
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, [newId()]))).toBe("NOT_FOUND");
    expect(errorCode(() => addWorkItemsToCycle(ctx, newId(), [foreign.id]))).toBe("NOT_FOUND");
    expect(workItemRow(ctx, foreign.id).cycle_id).toBeNull();
  });

  it("is refused on completed cycles (LOCKED)", () => {
    const { ctx, projectId, states } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const item = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one");
    expect(errorCode(() => addWorkItemsToCycle(ctx, done.id, [item.id]))).toBe("LOCKED");
    expect(workItemRow(ctx, item.id).cycle_id).toBeNull();
  });

  it("ignores items already in the cycle, collapses duplicate ids and validates the id list", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const item = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one");
    const seqBefore = latestSeq(ctx);
    addWorkItemsToCycle(ctx, a.id, [item.id, item.id]);
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    addWorkItemsToCycle(ctx, a.id, [item.id]);
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, []))).toBe("VALIDATION");
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, ["WEB-1"]))).toBe("VALIDATION");
    expect(errorCode(() => addWorkItemsToCycle(ctx, a.id, "nope" as never))).toBe("VALIDATION");
  });
});

describe("removeWorkItemsFromCycle", () => {
  it("removes items and logs on both sides; items that are not members are skipped", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const b = createCycle(ctx, { project_id: projectId, name: "B", ...UPCOMING });
    const one = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: a.id });
    const two = insertWorkItem(ctx, projectId, byName(states, "Done").id, "two", { cycle_id: a.id, completed_at: ctx.now() });
    const three = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "three", { cycle_id: b.id });
    const seqBefore = latestSeq(ctx);
    const detail = removeWorkItemsFromCycle(ctx, a.id, [one.id, two.id, three.id]);
    expect(detail.progress.total).toBe(0);
    expect(workItemRow(ctx, one.id).cycle_id).toBeNull();
    expect(workItemRow(ctx, two.id).cycle_id).toBeNull();
    expect(workItemRow(ctx, three.id).cycle_id).toBe(b.id);
    expect(activityRows(ctx, one.id).at(-1)).toMatchObject({ field: "cycle_id", old_value: a.id, new_value: null, old_identifier: "A", new_identifier: null });
    const cycleRows = activityRows(ctx, a.id).filter((row) => row.seq > seqBefore);
    expect(cycleRows.map((row) => row.verb)).toEqual(["removed", "removed"]);
    expect(cycleRows[0]).toMatchObject({ old_value: one.id, old_identifier: `WEB-${one.sequence_id}` });
    expect(activityRows(ctx, three.id)).toHaveLength(0);
    expect(latestSeq(ctx)).toBe(seqBefore + 4);
    expect(errorCode(() => removeWorkItemsFromCycle(ctx, a.id, [newId()]))).toBe("NOT_FOUND");
    expect(errorCode(() => removeWorkItemsFromCycle(ctx, a.id, []))).toBe("VALIDATION");
  });

  it("is refused on completed cycles (LOCKED)", () => {
    const { ctx, projectId, states } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const item = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: done.id });
    expect(errorCode(() => removeWorkItemsFromCycle(ctx, done.id, [item.id]))).toBe("LOCKED");
    expect(workItemRow(ctx, item.id).cycle_id).toBe(done.id);
  });
});

describe("transferCycleWorkItems", () => {
  it("moves incomplete items to the target cycle and logs on both cycles and on each item", () => {
    const { ctx, projectId, states } = setup();
    const source = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const target = createCycle(ctx, { project_id: projectId, name: "Mar", ...CURRENT });
    const todo = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "todo", { cycle_id: source.id });
    const started = insertWorkItem(ctx, projectId, byName(states, "In Progress").id, "started", { cycle_id: source.id });
    const done = insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { cycle_id: source.id, completed_at: "2026-02-20T10:00:00.000Z" });
    const cancelled = insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "cancelled", { cycle_id: source.id });
    const backlog = insertWorkItem(ctx, projectId, byName(states, "Backlog").id, "backlog", { cycle_id: source.id });
    const seqBefore = latestSeq(ctx);
    expect(transferCycleWorkItems(ctx, source.id, { to_cycle_id: target.id })).toEqual({ moved: 3 });
    for (const item of [todo, started, backlog]) expect(workItemRow(ctx, item.id).cycle_id).toBe(target.id);
    for (const item of [done, cancelled]) expect(workItemRow(ctx, item.id).cycle_id).toBe(source.id);
    expect(activityRows(ctx, todo.id).at(-1)).toMatchObject({ field: "cycle_id", old_value: source.id, new_value: target.id, old_identifier: "Feb", new_identifier: "Mar" });
    const sourceRows = activityRows(ctx, source.id).filter((row) => row.seq > seqBefore);
    expect(sourceRows.map((row) => row.verb)).toEqual(["removed", "removed", "removed"]);
    expect(sourceRows.map((row) => row.old_identifier)).toEqual([todo, started, backlog].map((item) => `WEB-${item.sequence_id}`));
    const targetRows = activityRows(ctx, target.id).filter((row) => row.seq > seqBefore);
    expect(targetRows.map((row) => row.verb)).toEqual(["added", "added", "added"]);
    expect(getCycle(ctx, target.id).progress).toMatchObject({ total: 3, unstarted: 1, started: 1, backlog: 1 });
  });

  it("moves incomplete items to no cycle when to_cycle_id is null", () => {
    const { ctx, projectId, states } = setup();
    const source = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const todo = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "todo", { cycle_id: source.id });
    const done = insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { cycle_id: source.id, completed_at: ctx.now() });
    expect(transferCycleWorkItems(ctx, source.id, { to_cycle_id: null })).toEqual({ moved: 1 });
    expect(workItemRow(ctx, todo.id).cycle_id).toBeNull();
    expect(workItemRow(ctx, done.id).cycle_id).toBe(source.id);
    expect(activityRows(ctx, todo.id).at(-1)).toMatchObject({ old_identifier: "Feb", new_value: null, new_identifier: null });
    expect(transferCycleWorkItems(ctx, source.id, { to_cycle_id: null })).toEqual({ moved: 0 });
  });

  it("freezes progress_snapshot on the source the first time only and serves it afterwards", () => {
    const { ctx, projectId, states } = setup();
    const source = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "todo", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { cycle_id: source.id, completed_at: "2026-02-15T10:00:00.000Z" });
    expect(cycleRow(ctx, source.id).progress_snapshot).toBeNull();
    transferCycleWorkItems(ctx, source.id, { to_cycle_id: null });
    const snapshot = cycleRow(ctx, source.id).progress_snapshot;
    expect(snapshot).toMatchObject({ total: 2, completed: 1, unstarted: 1 });
    expect(snapshot?.points).toBeUndefined();
    expect(Object.keys(snapshot?.completion_chart ?? {})).toHaveLength(28);
    expect(getCycleProgress(ctx, source.id, { mode: "issues" })).toMatchObject({ total: 2, completed: 1 });
    expect(getCycle(ctx, source.id).progress.total).toBe(2);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "late", { cycle_id: source.id });
    expect(transferCycleWorkItems(ctx, source.id, { to_cycle_id: null })).toEqual({ moved: 1 });
    expect(cycleRow(ctx, source.id).progress_snapshot).toEqual(snapshot);
    expect(getCycleProgress(ctx, source.id, { mode: "issues" }).total).toBe(2);
  });

  it("open_count is the number of items a transfer moves, archived and triage members included, and stays live after the freeze", () => {
    const { ctx, projectId } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true });
    const states = listStates(ctx, projectId);
    const triage = states.find((row) => row.state_group === "triage");
    if (!triage) throw new Error("triage state missing");
    const source = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const target = createCycle(ctx, { project_id: projectId, name: "Mar", ...CURRENT });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "todo", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, byName(states, "In Progress").id, "started", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, byName(states, "Backlog").id, "backlog", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, triage.id, "triage", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "archived open", { cycle_id: source.id, archived_at: ctx.now() });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { cycle_id: source.id, completed_at: "2026-02-20T10:00:00.000Z" });
    insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "cancelled", { cycle_id: source.id });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "deleted", { cycle_id: source.id, deleted_at: ctx.now() });
    const openCount = (id: string) => listCycles(ctx, projectId).find((row) => row.id === id)?.open_count;
    expect(openCount(source.id)).toBe(5);
    expect(getCycle(ctx, source.id)).toMatchObject({ open_count: 5, progress: { total: 6 } });
    expect(openCount(target.id)).toBe(0);
    const { moved } = transferCycleWorkItems(ctx, source.id, { to_cycle_id: target.id });
    expect(moved).toBe(5);
    expect(getCycle(ctx, source.id).open_count).toBe(0);
    expect(getCycle(ctx, target.id).open_count).toBe(moved);
    expect(cycleRow(ctx, source.id).progress_snapshot).not.toBeNull();
    // Live even when the snapshot is frozen: the progress stays frozen, the open count follows the members.
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "late", { cycle_id: source.id });
    expect(openCount(source.id)).toBe(1);
    expect(getCycle(ctx, source.id)).toMatchObject({ open_count: 1, progress: { total: 6 } });
    expect(listCycles(ctx, projectId).find((row) => row.id === source.id)?.progress).toEqual({ total: 6, completed: 1, cancelled: 1 });
    expect(transferCycleWorkItems(ctx, source.id, { to_cycle_id: null })).toEqual({ moved: 1 });
  });

  it("refuses a source that is not completed (RULE), a target that is completed, archived or foreign, and the same cycle", () => {
    const { ctx, projectId, states } = setup();
    const current = createCycle(ctx, { project_id: projectId, name: "Current", ...CURRENT });
    const upcoming = createCycle(ctx, { project_id: projectId, name: "Upcoming", ...UPCOMING });
    const draft = createCycle(ctx, { project_id: projectId, name: "Draft" });
    const source = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    const earlier = createCycle(ctx, { project_id: projectId, name: "Jan", ...EARLIER });
    const item = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "todo", { cycle_id: source.id });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = createCycle(ctx, { project_id: other.id, name: "Foreign", ...CURRENT });
    for (const notEnded of [current, upcoming, draft]) {
      expect(ruleName(() => transferCycleWorkItems(ctx, notEnded.id, { to_cycle_id: null }))).toBe("cycle_not_completed");
    }
    expect(errorCode(() => transferCycleWorkItems(ctx, source.id, { to_cycle_id: earlier.id }))).toBe("LOCKED");
    archiveCycle(ctx, earlier.id);
    expect(errorCode(() => transferCycleWorkItems(ctx, source.id, { to_cycle_id: earlier.id }))).toBe("ARCHIVED");
    expect(ruleName(() => transferCycleWorkItems(ctx, source.id, { to_cycle_id: foreign.id }))).toBe("cycle_project_mismatch");
    expect(errorCode(() => transferCycleWorkItems(ctx, source.id, { to_cycle_id: source.id }))).toBe("VALIDATION");
    expect(errorCode(() => transferCycleWorkItems(ctx, source.id, { to_cycle_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => transferCycleWorkItems(ctx, source.id, {} as never))).toBe("VALIDATION");
    expect(errorCode(() => transferCycleWorkItems(ctx, newId(), { to_cycle_id: null }))).toBe("NOT_FOUND");
    expect(workItemRow(ctx, item.id).cycle_id).toBe(source.id);
    expect(cycleRow(ctx, source.id).progress_snapshot).toBeNull();
  });
});

describe("getCycleProgress", () => {
  it("computes counts by state group, by_state, by_label, by_assignee and the breakdown rows live", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const backlog = byName(states, "Backlog");
    const todo = byName(states, "Todo");
    const started = byName(states, "In Progress");
    const done = byName(states, "Done");
    const cancelled = byName(states, "Cancelled");
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    const feature = createLabel(ctx, { project_id: projectId, name: "Feature" });
    const one = insertWorkItem(ctx, projectId, backlog.id, "one", { cycle_id: c.id });
    const two = insertWorkItem(ctx, projectId, backlog.id, "two", { cycle_id: c.id });
    const three = insertWorkItem(ctx, projectId, todo.id, "three", { cycle_id: c.id });
    const four = insertWorkItem(ctx, projectId, started.id, "four", { cycle_id: c.id });
    insertWorkItem(ctx, projectId, started.id, "five", { cycle_id: c.id });
    const six = insertWorkItem(ctx, projectId, done.id, "six", { cycle_id: c.id, completed_at: ctx.now() });
    insertWorkItem(ctx, projectId, cancelled.id, "seven", { cycle_id: c.id });
    insertWorkItem(ctx, projectId, done.id, "archived", { cycle_id: c.id, completed_at: ctx.now(), archived_at: ctx.now() });
    insertWorkItem(ctx, projectId, todo.id, "deleted", { cycle_id: c.id, deleted_at: ctx.now() });
    insertWorkItem(ctx, projectId, todo.id, "elsewhere");
    addLabel(ctx, one.id, bug.id);
    addLabel(ctx, two.id, bug.id);
    addLabel(ctx, two.id, feature.id);
    addLabel(ctx, six.id, bug.id);
    assign(ctx, one.id, USER_ACTOR_ID);
    assign(ctx, three.id, USER_ACTOR_ID);
    assign(ctx, four.id, USER_ACTOR_ID);
    assign(ctx, four.id, ASSISTANT_ACTOR_ID);
    const progress = getCycleProgress(ctx, c.id, { mode: "issues" });
    expect(progress).toMatchObject({ total: 8, backlog: 2, unstarted: 1, started: 2, completed: 2, cancelled: 1 });
    expect(progress.by_state).toEqual({ [backlog.id]: 2, [todo.id]: 1, [started.id]: 2, [done.id]: 2, [cancelled.id]: 1 });
    expect(progress.by_label).toEqual({ [bug.id]: 3, [feature.id]: 1 });
    expect(progress.by_assignee).toEqual({ [USER_ACTOR_ID]: 3, [ASSISTANT_ACTOR_ID]: 1 });
    // Rows by total, the id: null row (no labels / no assignee) last; archived members count, an item with two assignees counts twice.
    expect(progress.labels).toEqual([
      { id: bug.id, total: 3, completed: 1 },
      { id: feature.id, total: 1, completed: 0 },
      { id: null, total: 5, completed: 1 },
    ]);
    expect(progress.assignees).toEqual([
      { id: USER_ACTOR_ID, total: 3, completed: 0 },
      { id: ASSISTANT_ACTOR_ID, total: 1, completed: 0 },
      { id: null, total: 5, completed: 2 },
    ]);
    expect(progress.points).toBeUndefined();
    expect(progress.chart_mode).toBe("issues");
    expect(progress.completion_chart_points).toBeUndefined();
    expect(getCycleProgress(ctx, c.id)).toEqual(progress);
    expect(errorCode(() => getCycleProgress(ctx, c.id, { mode: "hours" as "issues" }))).toBe("VALIDATION");
    expect(errorCode(() => getCycleProgress(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("orders breakdown rows by total, then id: a larger total with a larger id comes first, and equal totals follow the id, not the row order", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const todo = byName(states, "Todo");
    // Created in this order, so the ids sort Feature < Bug < Chore; Bug has the largest total.
    const feature = createLabel(ctx, { project_id: projectId, name: "Feature" });
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    const chore = createLabel(ctx, { project_id: projectId, name: "Chore" });
    expect([chore.id, bug.id, feature.id].sort()).toEqual([feature.id, bug.id, chore.id]);
    const [one, two, three] = ["one", "two", "three"].map((name) => insertWorkItem(ctx, projectId, todo.id, name, { cycle_id: c.id }));
    expect([two.id, one.id].sort()).toEqual([one.id, two.id]);
    for (const item of [one, two, three]) addLabel(ctx, item.id, bug.id);
    // The tied labels reach the breakdown in the opposite order of their ids: Chore sits on the first item (smaller id,
    // inserted first), Feature on the second, so the junction rows yield Chore before Feature in key order and in
    // insertion order alike. A sort by total alone would keep Chore first; only the id tie-break puts Feature first.
    addLabel(ctx, one.id, chore.id);
    addLabel(ctx, two.id, feature.id);
    // Total first: Bug (3) leads although its id is larger than Feature's; equal totals fall back to the id (Feature before Chore).
    expect(getCycleProgress(ctx, c.id).labels).toEqual([
      { id: bug.id, total: 3, completed: 0 },
      { id: feature.id, total: 1, completed: 0 },
      { id: chore.id, total: 1, completed: 0 },
    ]);
  });

  it("points mode sums numeric estimate_point values of the active estimate and skips non-numeric ones", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const [one, three, xl, five] = insertEstimatePoints(ctx, projectId, ["1", "3", "XL", " 5 "]);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "a", { cycle_id: c.id, estimate_point_id: one });
    insertWorkItem(ctx, projectId, byName(states, "In Progress").id, "b", { cycle_id: c.id, estimate_point_id: three });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "c", { cycle_id: c.id, estimate_point_id: xl, completed_at: ctx.now() });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "d", { cycle_id: c.id, estimate_point_id: five, completed_at: ctx.now() });
    insertWorkItem(ctx, projectId, byName(states, "Backlog").id, "e", { cycle_id: c.id });
    const progress = getCycleProgress(ctx, c.id, { mode: "points" });
    expect(progress).toMatchObject({ total: 5, unstarted: 1, started: 1, completed: 2, backlog: 1, cancelled: 0 });
    expect(progress.points).toEqual({ total: 9, completed: 5, cancelled: 0, started: 3, unstarted: 1, backlog: 0 });
    expect(progress.chart_mode).toBe("points");
    expect(progress.completion_chart_points).toBeUndefined();
    const issues = getCycleProgress(ctx, c.id, { mode: "issues" });
    expect(issues.points).toBeUndefined();
    expect(issues.chart_mode).toBe("issues");
  });

  it("counts points only with an active estimate, only for live points of that estimate, values >= 0 including fractions", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const [half, oneAndHalf, negative, gone] = insertEstimatePoints(ctx, projectId, ["0.5", "1.5", "-2", "4"], { activate: false });
    const [foreignPoint] = insertEstimatePoints(ctx, projectId, ["7"], { activate: false });
    ctx.db.update(estimate_point).set({ deleted_at: ctx.now() }).where(eq(estimate_point.id, gone)).run();
    const todo = byName(states, "Todo").id;
    insertWorkItem(ctx, projectId, todo, "half", { cycle_id: c.id, estimate_point_id: half });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "done", { cycle_id: c.id, estimate_point_id: oneAndHalf, completed_at: "2026-03-05T12:00:00.000Z" });
    insertWorkItem(ctx, projectId, todo, "negative", { cycle_id: c.id, estimate_point_id: negative });
    insertWorkItem(ctx, projectId, todo, "deleted point", { cycle_id: c.id, estimate_point_id: gone });
    insertWorkItem(ctx, projectId, todo, "other estimate", { cycle_id: c.id, estimate_point_id: foreignPoint });
    withTimeZone("UTC", () => {
      // No active estimate: no point totals and no points series, even in points mode.
      const none = getCycleProgress(ctx, c.id, { mode: "points" });
      expect(none.points).toBeUndefined();
      expect(none.chart_mode).toBe("issues");
      expect(none.completion_chart[TODAY]).toBe(4);
      // An estimate that is set but switched off does not count either.
      ctx.db.update(project).set({ estimate_id: estimateIdOf(ctx, half), estimates_enabled: false }).where(eq(project.id, projectId)).run();
      expect(getCycleProgress(ctx, c.id, { mode: "points" }).points).toBeUndefined();
      activateEstimate(ctx, projectId, estimateIdOf(ctx, half));
      const on = getCycleProgress(ctx, c.id, { mode: "points" });
      expect(on.points).toEqual({ total: 2, completed: 1.5, cancelled: 0, started: 0, unstarted: 0.5, backlog: 0 });
      expect(on.chart_mode).toBe("points");
      expect(on.completion_chart["2026-03-04"]).toBe(2);
      expect(on.completion_chart[TODAY]).toBe(0.5);
      expect(on.total).toBe(5);
      const issues = getCycleProgress(ctx, c.id, { mode: "issues" });
      expect(issues.chart_mode).toBe("issues");
      expect(issues.completion_chart[TODAY]).toBe(4);
      expect(issues.points).toBeUndefined();
    });
  });

  it("freezes both series with an active estimate and serves each by mode, fractional points included", () => {
    const { ctx, projectId, states } = setup();
    const sprint = createCycle(ctx, { project_id: projectId, name: "Sprint", start_date: "2026-03-01", end_date: "2026-03-05" });
    const [half, three] = insertEstimatePoints(ctx, projectId, ["0.5", "3"]);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "open", { cycle_id: sprint.id, estimate_point_id: three });
    insertWorkItem(ctx, projectId, byName(states, "Done").id, "finished", { cycle_id: sprint.id, estimate_point_id: half, completed_at: "2026-03-03T12:00:00.000Z" });
    withTimeZone("UTC", () => transferCycleWorkItems(ctx, sprint.id, { to_cycle_id: null }));
    const snapshot = cycleRow(ctx, sprint.id).progress_snapshot;
    expect(snapshot).toMatchObject({
      total: 2,
      completed: 1,
      points: { total: 3.5, completed: 0.5, unstarted: 3 },
      completion_chart: { "2026-03-01": 2, "2026-03-02": 2, "2026-03-03": 1, "2026-03-04": 1, "2026-03-05": 1 },
      completion_chart_points: { "2026-03-01": 3.5, "2026-03-02": 3.5, "2026-03-03": 3, "2026-03-04": 3, "2026-03-05": 3 },
    });
    expect(snapshot?.chart_mode).toBeUndefined();
    // The open item left with the transfer; the fractional snapshot still parses and is served instead of live progress.
    const issues = getCycleProgress(ctx, sprint.id, { mode: "issues" });
    expect(issues).toMatchObject({ total: 2, chart_mode: "issues", completion_chart: snapshot?.completion_chart });
    expect(issues.points).toBeUndefined();
    expect(issues.completion_chart_points).toBeUndefined();
    const points = getCycleProgress(ctx, sprint.id, { mode: "points" });
    expect(points).toMatchObject({ total: 2, chart_mode: "points", points: { total: 3.5 }, completion_chart: snapshot?.completion_chart_points });
    expect(points.completion_chart_points).toBeUndefined();
    // get_cycle serves issues mode; the raw progress_snapshot column (spread from the row) still shows both series.
    const detail = getCycle(ctx, sprint.id);
    expect(detail.progress).toEqual(issues);
    expect(detail.progress_snapshot?.completion_chart_points).toEqual(snapshot?.completion_chart_points);
    expect(listCycles(ctx, projectId)[0].progress_snapshot).toEqual(snapshot);
    // Frozen means frozen: switching the estimate off later changes nothing.
    ctx.db.update(project).set({ estimates_enabled: false }).where(eq(project.id, projectId)).run();
    expect(getCycleProgress(ctx, sprint.id, { mode: "points" })).toEqual(points);
  });

  it("excludes items waiting in triage, matching getCounts and listWorkItems", () => {
    const { ctx, handles, projectId, states } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true, agent_intake_required: true });
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "visible", { cycle_id: c.id });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:test" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id, today: () => TODAY });
    const pending = createWorkItem(actx, { project_id: projectId, name: "pending", cycle_id: c.id });
    expect(pending.cycle_id).toBe(c.id);
    expect(pending.intake).toEqual({ status: "pending" });
    const progress = getCycleProgress(ctx, c.id);
    expect(progress).toMatchObject({ total: 1, unstarted: 1, backlog: 0, started: 0, completed: 0, cancelled: 0 });
    expect(Object.values(progress.by_state).reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(progress.by_state[pending.state_id]).toBeUndefined();
    expect(progress.total).toBe(getCounts(ctx, { type: "cycle", cycle_id: c.id }).total);
    expect(progress.total).toBe(listWorkItems(ctx, { scope: { type: "cycle", cycle_id: c.id } }).total);
    expect(listCycles(ctx, projectId)[0].progress.total).toBe(1);
    expect(getCycleProgress(ctx, c.id).completion_chart[TODAY]).toBe(1);
  });

  it("builds the completion chart per day up to today from completed_at, in items or points", () => {
    const { ctx, projectId, states } = setup("2026-03-05");
    const c = createCycle(ctx, { project_id: projectId, name: "A", start_date: "2026-03-01", end_date: "2026-03-10" });
    const [two, three, five, eight] = insertEstimatePoints(ctx, projectId, ["2", "3", "5", "8"]);
    expect(getCycleProgress(ctx, c.id, { mode: "points" }).chart_mode).toBe("points");
    const done = byName(states, "Done");
    insertWorkItem(ctx, projectId, done.id, "first", { cycle_id: c.id, estimate_point_id: two, completed_at: "2026-03-02T10:00:00.000Z" });
    insertWorkItem(ctx, projectId, done.id, "second", { cycle_id: c.id, estimate_point_id: three, completed_at: "2026-03-04T23:59:59.000Z" });
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "open", { cycle_id: c.id, estimate_point_id: five });
    insertWorkItem(ctx, projectId, byName(states, "Cancelled").id, "dropped", { cycle_id: c.id, estimate_point_id: eight });
    withTimeZone("UTC", () => {
      expect(getCycleProgress(ctx, c.id, { mode: "issues" }).completion_chart).toEqual({
        "2026-03-01": 3,
        "2026-03-02": 2,
        "2026-03-03": 2,
        "2026-03-04": 1,
        "2026-03-05": 1,
      });
      expect(getCycleProgress(ctx, c.id, { mode: "points" }).completion_chart).toEqual({
        "2026-03-01": 10,
        "2026-03-02": 8,
        "2026-03-03": 8,
        "2026-03-04": 5,
        "2026-03-05": 5,
      });
    });
    // Days are the server's local calendar days: 23:59:59Z is already the 5th in Tokyo.
    withTimeZone("Asia/Tokyo", () => {
      expect(getCycleProgress(ctx, c.id, { mode: "issues" }).completion_chart).toEqual({
        "2026-03-01": 3,
        "2026-03-02": 2,
        "2026-03-03": 2,
        "2026-03-04": 2,
        "2026-03-05": 1,
      });
    });
    const upcoming = createCycle(ctx, { project_id: projectId, name: "Later", start_date: "2026-03-11", end_date: "2026-03-20" });
    expect(getCycleProgress(ctx, upcoming.id).completion_chart).toEqual({});
    const draft = createCycle(ctx, { project_id: projectId, name: "Draft" });
    expect(getCycleProgress(ctx, draft.id).completion_chart).toEqual({});
    const ended = createCycle(ctx, { project_id: projectId, name: "Ended", start_date: "2026-02-26", end_date: "2026-02-28" });
    expect(Object.keys(getCycleProgress(ctx, ended.id).completion_chart)).toEqual(["2026-02-26", "2026-02-27", "2026-02-28"]);
  });

  it("serves the snapshot whenever it is non-null and computes live when it is unreadable", () => {
    const { ctx, projectId, states } = setup();
    const c = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    // An active estimate does not matter for a snapshot frozen before P3: it has no points series.
    const [one] = insertEstimatePoints(ctx, projectId, ["1"]);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: c.id, estimate_point_id: one });
    const frozen: CycleProgress = {
      total: 9,
      completed: 4,
      cancelled: 1,
      started: 2,
      unstarted: 1,
      backlog: 1,
      by_state: { x: 9 },
      by_label: {},
      by_assignee: {},
      points: { total: 20, completed: 10, cancelled: 0, started: 5, unstarted: 3, backlog: 2 },
      completion_chart: { "2026-03-01": 9 },
    };
    ctx.db.update(cycle).set({ progress_snapshot: frozen }).where(eq(cycle.id, c.id)).run();
    const issues = getCycleProgress(ctx, c.id, { mode: "issues" });
    expect(issues).toEqual({ ...frozen, points: undefined, chart_mode: "issues" });
    expect(issues.points).toBeUndefined();
    // Pre-P3 snapshot: points mode keeps its point totals and falls back to the items series.
    expect(getCycleProgress(ctx, c.id, { mode: "points" })).toEqual({ ...frozen, chart_mode: "issues" });
    expect(getCycle(ctx, c.id).progress.total).toBe(9);
    expect(listCycles(ctx, projectId)[0].progress).toEqual({ total: 9, completed: 4, cancelled: 1 });
    ctx.db.update(cycle).set({ progress_snapshot: { bogus: true } as never }).where(eq(cycle.id, c.id)).run();
    expect(getCycleProgress(ctx, c.id).total).toBe(1);
    expect(getCycleProgress(ctx, c.id, { mode: "points" })).toMatchObject({ chart_mode: "points", points: { total: 1, unstarted: 1 } });
    expect(listCycles(ctx, projectId)[0].progress).toEqual({ total: 1, completed: 0, cancelled: 0 });
  });
});

describe("getActiveCycles", () => {
  it("lists current cycles across non-archived projects with their progress, earliest start first", () => {
    const { ctx, handles, projectId, states } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const third = createProject(ctx, { name: "Third", identifier: "THR" });
    const gone = createProject(ctx, { name: "Gone", identifier: "GON" });
    const web = createCycle(ctx, { project_id: projectId, name: "Web now", start_date: "2026-03-05", end_date: "2026-03-14" });
    createCycle(ctx, { project_id: projectId, name: "Web later", ...UPCOMING });
    createCycle(ctx, { project_id: projectId, name: "Web before", ...COMPLETED });
    createCycle(ctx, { project_id: projectId, name: "Web draft" });
    const oth = createCycle(ctx, { project_id: other.id, name: "Other now", start_date: "2026-03-01", end_date: "2026-03-20" });
    createCycle(ctx, { project_id: third.id, name: "Third now", ...CURRENT });
    createCycle(ctx, { project_id: gone.id, name: "Gone now", ...CURRENT });
    archiveProject(ctx, third.id);
    deleteProject(ctx, gone.id);
    insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: web.id });
    const active = getActiveCycles(ctx);
    expect(active.map((row) => row.id)).toEqual([oth.id, web.id]);
    expect(active.every((row) => row.status === "current")).toBe(true);
    expect(active[1].progress).toMatchObject({ total: 1, unstarted: 1 });
    expect(Object.keys(active[1].progress.completion_chart)).toHaveLength(6);
    expect(getActiveCycles(contextAt(handles, "2026-04-01"))).toEqual([]);
  });
});

describe("deleteCycle", () => {
  it("soft-deletes the cycle and clears cycle_id on its items with one activity row per item", () => {
    const { ctx, projectId, states } = setup();
    const a = createCycle(ctx, { project_id: projectId, name: "A", ...CURRENT });
    const one = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "one", { cycle_id: a.id });
    const two = insertWorkItem(ctx, projectId, byName(states, "Done").id, "two", { cycle_id: a.id, completed_at: ctx.now() });
    const elsewhere = insertWorkItem(ctx, projectId, byName(states, "Todo").id, "elsewhere");
    const seqBefore = latestSeq(ctx);
    deleteCycle(ctx, a.id);
    expect(errorCode(() => getCycle(ctx, a.id))).toBe("NOT_FOUND");
    expect(listCycles(ctx, projectId)).toEqual([]);
    expect(cycleRow(ctx, a.id).deleted_at).not.toBeNull();
    expect(workItemRow(ctx, one.id).cycle_id).toBeNull();
    expect(workItemRow(ctx, two.id).cycle_id).toBeNull();
    expect(workItemRow(ctx, elsewhere.id).deleted_at).toBeNull();
    expect(activityRows(ctx, one.id)).toHaveLength(1);
    expect(activityRows(ctx, one.id)[0]).toMatchObject({ field: "cycle_id", old_value: a.id, old_identifier: "A", new_value: null, new_identifier: null });
    const cycleRows = activityRows(ctx, a.id).filter((row) => row.seq > seqBefore);
    expect(cycleRows.map((row) => row.verb)).toEqual(["removed", "removed", "deleted"]);
    expect(cycleRows[2]).toMatchObject({ old_identifier: "A", project_id: projectId });
    expect(latestSeq(ctx)).toBe(seqBefore + 5);
    expect(createCycle(ctx, { project_id: projectId, name: "Again", ...CURRENT }).status).toBe("current");
    expect(errorCode(() => deleteCycle(ctx, a.id))).toBe("NOT_FOUND");
  });

  it("is allowed on archived, current, upcoming and draft cycles but LOCKED on completed non-archived ones", () => {
    const { ctx, projectId } = setup();
    const done = createCycle(ctx, { project_id: projectId, name: "Feb", ...COMPLETED });
    expect(errorCode(() => deleteCycle(ctx, done.id))).toBe("LOCKED");
    archiveCycle(ctx, done.id);
    deleteCycle(ctx, done.id);
    expect(errorCode(() => getCycle(ctx, done.id))).toBe("NOT_FOUND");
    for (const input of [CURRENT, UPCOMING, {}]) {
      const row = createCycle(ctx, { project_id: projectId, name: "x", ...input });
      deleteCycle(ctx, row.id);
      expect(errorCode(() => getCycle(ctx, row.id))).toBe("NOT_FOUND");
    }
    expect(listCycles(ctx, projectId)).toEqual([]);
    expect(listCycles(ctx, projectId, { archived: true })).toEqual([]);
  });
});

/** A work item created open in the (current) cycle and then moved to Done: completed items cannot join a cycle directly. */
/** Saved filters on `key`: a project view, a locked one, a workspace view and a view_settings row hold [id, other]; one view holds only `id`. */
function seedSavedFilters(ctx: TesseraContext, projectId: string, key: "state" | "cycle" | "module", id: string, other: string) {
  const insertView = (scope: string | null, name: string, filters: Filters, isLocked = false) => {
    const now = ctx.now();
    return ctx.db
      .insert(view)
      .values({
        id: newId(),
        project_id: scope,
        name,
        name_key: name.toLowerCase(),
        filters,
        display: DEFAULT_DISPLAY,
        is_locked: isLocked,
        sort_order: firstSortOrder(),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
  };
  const both = { [key]: [id, other] } as Filters;
  const views = {
    project: insertView(projectId, "Project view", both),
    locked: insertView(projectId, "Locked view", both, true),
    workspace: insertView(null, "Workspace view", both),
    only: insertView(projectId, "Only view", { [key]: [id] } as Filters),
  };
  saveViewSettings(ctx, "project", projectId, { filters: both });
  return views;
}

function storedFilters(ctx: TesseraContext, viewId: string): Filters {
  const row = ctx.db.select().from(view).where(eq(view.id, viewId)).get();
  if (!row) throw new Error("view missing");
  return FiltersSchema.parse(row.filters);
}

function finishInCycle(ctx: TesseraContext, projectId: string, states: StateRow[], cycleId: string, name: string) {
  const item = createWorkItem(ctx, { project_id: projectId, name, cycle_id: cycleId });
  return updateWorkItem(ctx, item.id, { state_id: byName(states, "Done").id });
}

// D1: deleting a member is the fourth exception to "completed cycles are read-only" (next to reorder, archive and transfer).
describe("deleteCycle and saved filters", () => {
  it("delete strips the id from saved filters", () => {
    const { ctx, projectId } = setup();
    const target = createCycle(ctx, { project_id: projectId, name: "Target" });
    const keep = createCycle(ctx, { project_id: projectId, name: "Keep" });
    const views = seedSavedFilters(ctx, projectId, "cycle", target.id, keep.id);
    const seqBefore = latestSeq(ctx);
    deleteCycle(ctx, target.id);
    const keptOnly = { cycle: [keep.id] };
    expect(storedFilters(ctx, views.project.id)).toEqual(keptOnly);
    expect(storedFilters(ctx, views.locked.id)).toEqual(keptOnly);
    expect(storedFilters(ctx, views.workspace.id)).toEqual(keptOnly);
    expect(storedFilters(ctx, views.only.id)).toEqual({});
    expect(getViewSettings(ctx, "project", projectId).filters).toEqual(keptOnly);
    const rows = ctx.db.select().from(activity).all().filter((r) => r.seq > seqBefore && r.field === "filters");
    expect(rows.map((r) => r.entity_type).sort()).toEqual(["view", "view", "view", "view", "view_settings"]);
  });
});

describe("Cycles feature toggle", () => {
  it("create refuses while the feature is off", () => {
    const { ctx, projectId } = setup();
    const existing = createCycle(ctx, { project_id: projectId, name: "Existing", ...CURRENT });
    updateProjectFeatures(ctx, projectId, { cycles_enabled: false });
    expect(ruleName(() => createCycle(ctx, { project_id: projectId, name: "Blocked", ...UPCOMING }))).toBe("feature_disabled");
    expect(listCycles(ctx, projectId).map((row) => row.id)).toEqual([existing.id]);
    expect(getCycle(ctx, existing.id).id).toBe(existing.id);
    updateProjectFeatures(ctx, projectId, { cycles_enabled: true });
    expect(createCycle(ctx, { project_id: projectId, name: "Blocked", ...UPCOMING }).id).toBeTruthy();
  });
});

describe("deleteWorkItem on cycle members", () => {
  it("is allowed in a completed cycle: live progress drops, a frozen snapshot does not move", () => {
    const { ctx, handles, projectId, states } = setup();
    const sprint = createCycle(ctx, { project_id: projectId, name: "Sprint", ...CURRENT });
    const todo = createWorkItem(ctx, { project_id: projectId, name: "todo", state_id: byName(states, "Todo").id, cycle_id: sprint.id });
    const doneA = finishInCycle(ctx, projectId, states, sprint.id, "done a");
    const doneB = finishInCycle(ctx, projectId, states, sprint.id, "done b");
    const later = contextAt(handles, "2026-03-20");
    expect(getCycle(later, sprint.id).status).toBe("completed");
    expect(errorCode(() => removeWorkItemsFromCycle(later, sprint.id, [todo.id]))).toBe("LOCKED");
    expect(getCycleProgress(later, sprint.id)).toMatchObject({ total: 3, completed: 2, unstarted: 1 });

    deleteWorkItem(later, todo.id);
    expect(workItemRow(later, todo.id).deleted_at).not.toBeNull();
    expect(activityRows(later, todo.id).at(-1)?.verb).toBe("deleted");
    expect(cycleRow(later, sprint.id).progress_snapshot).toBeNull();
    expect(getCycleProgress(later, sprint.id)).toMatchObject({ total: 2, completed: 2, unstarted: 0 });
    expect(getCycle(later, sprint.id).progress).toMatchObject({ total: 2, completed: 2 });

    // Freeze the snapshot (nothing is open, so the transfer moves nothing) and delete again: the snapshot stays.
    expect(transferCycleWorkItems(later, sprint.id, { to_cycle_id: null })).toEqual({ moved: 0 });
    const snapshot = cycleRow(later, sprint.id).progress_snapshot;
    expect(snapshot).toMatchObject({ total: 2, completed: 2 });
    deleteWorkItem(later, doneA.id);
    expect(workItemRow(later, doneA.id).deleted_at).not.toBeNull();
    expect(cycleRow(later, sprint.id).progress_snapshot).toEqual(snapshot);
    expect(getCycleProgress(later, sprint.id)).toMatchObject({ total: 2, completed: 2 });
    expect(listWorkItems(later, { scope: { type: "cycle", cycle_id: sprint.id } }).items.map((item) => item.id)).toEqual([doneB.id]);
  });

  it("is allowed in an archived cycle and leaves the snapshot frozen at archive", () => {
    const { ctx, handles, projectId, states } = setup();
    const sprint = createCycle(ctx, { project_id: projectId, name: "Sprint", ...CURRENT });
    const todo = createWorkItem(ctx, { project_id: projectId, name: "todo", state_id: byName(states, "Todo").id, cycle_id: sprint.id });
    const done = finishInCycle(ctx, projectId, states, sprint.id, "done");
    const later = contextAt(handles, "2026-03-20");
    const archivedCycle = archiveCycle(later, sprint.id);
    expect(archivedCycle.progress_snapshot).toMatchObject({ total: 2, completed: 1, unstarted: 1 });
    expect(errorCode(() => removeWorkItemsFromCycle(later, sprint.id, [todo.id]))).toBe("ARCHIVED");

    deleteWorkItem(later, done.id);
    expect(workItemRow(later, done.id).deleted_at).not.toBeNull();
    expect(cycleRow(later, sprint.id).progress_snapshot).toEqual(archivedCycle.progress_snapshot);
    expect(getCycleProgress(later, sprint.id)).toMatchObject({ total: 2, completed: 1 });
    expect(listCycles(later, projectId, { archived: true })[0].progress).toEqual({ total: 2, completed: 1, cancelled: 0 });
    expect(listWorkItems(later, { scope: { type: "cycle", cycle_id: sprint.id } }).items.map((item) => item.id)).toEqual([todo.id]);
  });
});
