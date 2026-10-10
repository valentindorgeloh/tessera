import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID, registerActor, SYSTEM_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, estimate, estimate_point, moduleTable, module_member, project, work_item, work_item_module } from "@/lib/tessera/db/schema";
import { addLink, getLink, listLinks } from "@/lib/tessera/links";
import {
  addModuleLink,
  addWorkItemsToModule,
  ARCHIVABLE_MODULE_STATUSES,
  archiveModule,
  createModule,
  deleteModule,
  getModule,
  getModuleProgress,
  listModules,
  removeModuleLink,
  removeWorkItemsFromModule,
  reorderModule,
  setModuleMembers,
  unarchiveModule,
  updateModule,
  updateModuleLink,
} from "@/lib/tessera/modules";
import { archiveProject, createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { ModuleStatusSchema } from "@/lib/tessera/schemas";
import { listStates } from "@/lib/tessera/states";
import type { StateGroup } from "@/lib/tessera/types";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

type Fixture = { ctx: TesseraContext; projectId: string; states: Record<StateGroup, string> };

function setup(): Fixture {
  const ctx = createTestContext(createTestDb());
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: p.id, states: stateIds(ctx, p.id) };
}

/** State id per group; `triage` is only present once Intake is enabled. */
function stateIds(ctx: TesseraContext, projectId: string): Record<StateGroup, string> {
  const result = {} as Record<StateGroup, string>;
  for (const row of listStates(ctx, projectId)) result[row.state_group] = row.id;
  return result;
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

function audit(ctx: TesseraContext) {
  const now = ctx.now();
  return { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
}

function moduleRow(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(moduleTable).where(eq(moduleTable.id, id)).get();
  if (!row) throw new Error("module missing");
  return row;
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function rowsSince(ctx: TesseraContext, seq: number) {
  return ctx.db
    .select()
    .from(activity)
    .orderBy(activity.seq)
    .all()
    .filter((row) => row.seq > seq);
}

function memberRows(ctx: TesseraContext, moduleId: string): string[] {
  return ctx.db
    .select()
    .from(module_member)
    .where(eq(module_member.module_id, moduleId))
    .all()
    .map((row) => row.actor_id)
    .sort();
}

function junctionRows(ctx: TesseraContext, moduleId: string): string[] {
  return ctx.db
    .select()
    .from(work_item_module)
    .where(eq(work_item_module.module_id, moduleId))
    .all()
    .map((row) => row.work_item_id)
    .sort();
}

const ZERO_PROGRESS = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };

describe("createModule and listModules", () => {
  it("creates a module with defaults, appends sort_order and logs created", () => {
    const { ctx, projectId } = setup();
    expect(listModules(ctx, projectId)).toEqual([]);
    const seqBefore = latestSeq(ctx);
    const auth = createModule(ctx, { project_id: projectId, name: "  Auth  " });
    const billing = createModule(ctx, { project_id: projectId, name: "Billing", description_md: "Invoices", status: "in_progress" });
    expect(auth).toMatchObject({
      name: "Auth",
      name_key: "auth",
      description_md: "",
      status: "planned",
      lead_actor_id: null,
      start_date: null,
      target_date: null,
      archived_at: null,
      member_ids: [],
      links_count: 0,
      progress: ZERO_PROGRESS,
      created_by: ctx.actor.id,
    });
    expect(billing.status).toBe("in_progress");
    expect(billing.description_md).toBe("Invoices");
    expect(auth.sort_order < billing.sort_order).toBe(true);
    expect(listModules(ctx, projectId).map((m) => m.id)).toEqual([auth.id, billing.id]);
    const rows = activityRows(ctx, auth.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "created", entity_type: "module", new_identifier: "Auth", project_id: projectId, work_item_id: null });
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    expect(errorCode(() => listModules(ctx, newId()))).toBe("NOT_FOUND");
    expect(errorCode(() => getModule(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("keeps names unique per project (case- and whitespace-insensitive), reusable after delete", () => {
    const { ctx, projectId } = setup();
    const auth = createModule(ctx, { project_id: projectId, name: "Auth" });
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: " AUTH " }))).toBe("CONFLICT");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createModule(ctx, { project_id: other.id, name: "auth" }).name).toBe("auth");
    deleteModule(ctx, auth.id);
    expect(createModule(ctx, { project_id: projectId, name: "auth" }).name).toBe("auth");
  });

  it("validates input before writing", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "" }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", status: "done" as "planned" }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", start_date: "2026-13-01" }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", target_date: "tomorrow" }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", lead_actor_id: "nope" }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", member_ids: ["nope"] }))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => createModule(ctx, { project_id: newId(), name: "x" }))).toBe("NOT_FOUND");
    expect(listModules(ctx, projectId)).toEqual([]);
  });

  it("requires start_date on or before target_date, on create and on update", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", start_date: "2026-03-02", target_date: "2026-03-01" }))).toBe("VALIDATION");
    const m = createModule(ctx, { project_id: projectId, name: "Auth", start_date: "2026-03-01", target_date: "2026-03-01" });
    expect(m.start_date).toBe("2026-03-01");
    expect(errorCode(() => updateModule(ctx, m.id, { target_date: "2026-02-28" }))).toBe("VALIDATION");
    expect(errorCode(() => updateModule(ctx, m.id, { start_date: "2026-03-02" }))).toBe("VALIDATION");
    expect(updateModule(ctx, m.id, { start_date: null }).start_date).toBeNull();
    expect(updateModule(ctx, m.id, { target_date: "2026-01-01" }).target_date).toBe("2026-01-01");
    expect(updateModule(ctx, m.id, { start_date: "2025-12-31", target_date: "2026-01-31" })).toMatchObject({ start_date: "2025-12-31", target_date: "2026-01-31" });
  });

  it("stores the lead and the members, which must be existing actors", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", lead_actor_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "x", member_ids: [USER_ACTOR_ID, newId()] }))).toBe("NOT_FOUND");
    expect(listModules(ctx, projectId)).toEqual([]);
    const seqBefore = latestSeq(ctx);
    const m = createModule(ctx, {
      project_id: projectId,
      name: "Auth",
      lead_actor_id: ASSISTANT_ACTOR_ID,
      member_ids: [ASSISTANT_ACTOR_ID, USER_ACTOR_ID, USER_ACTOR_ID],
    });
    expect(m.lead_actor_id).toBe(ASSISTANT_ACTOR_ID);
    expect([...m.member_ids].sort()).toEqual([ASSISTANT_ACTOR_ID, USER_ACTOR_ID].sort());
    expect(memberRows(ctx, m.id)).toEqual([ASSISTANT_ACTOR_ID, USER_ACTOR_ID].sort());
    const rows = rowsSince(ctx, seqBefore);
    expect(rows.map((r) => [r.verb, r.field])).toEqual([
      ["created", null],
      ["updated", "member_ids"],
    ]);
    expect(rows[1]).toMatchObject({ entity_id: m.id, old_value: "[]", new_identifier: "Assistant, You" });
    expect(JSON.parse(rows[1].new_value ?? "")).toEqual([ASSISTANT_ACTOR_ID, USER_ACTOR_ID]);
  });

  it("lists active modules by default, archived ones on request, and filters by status", () => {
    const { ctx, projectId } = setup();
    const a = createModule(ctx, { project_id: projectId, name: "A", status: "completed" });
    const b = createModule(ctx, { project_id: projectId, name: "B" });
    const c = createModule(ctx, { project_id: projectId, name: "C", status: "completed" });
    archiveModule(ctx, a.id);
    expect(listModules(ctx, projectId).map((m) => m.id)).toEqual([b.id, c.id]);
    expect(listModules(ctx, projectId, { archived: true }).map((m) => m.id)).toEqual([a.id]);
    expect(listModules(ctx, projectId, { status: "completed" }).map((m) => m.id)).toEqual([c.id]);
    expect(listModules(ctx, projectId, { archived: true, status: "planned" })).toEqual([]);
    expect(errorCode(() => listModules(ctx, projectId, { status: "nope" as "planned" }))).toBe("VALIDATION");
  });
});

describe("getModule", () => {
  it("returns the detail with full progress, links and the active work item ids", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth", member_ids: [USER_ACTOR_ID] });
    const todo = insertWorkItem(ctx, projectId, states.unstarted, "todo");
    const done = insertWorkItem(ctx, projectId, states.completed, "done");
    const gone = insertWorkItem(ctx, projectId, states.completed, "gone", { archived_at: ctx.now() });
    ctx.db
      .insert(work_item_module)
      .values([
        { work_item_id: todo.id, module_id: m.id },
        { work_item_id: done.id, module_id: m.id },
        { work_item_id: gone.id, module_id: m.id },
      ])
      .run();
    const link = addModuleLink(ctx, m.id, { url: "https://example.com/spec", title: "Spec" });
    const detail = getModule(ctx, m.id);
    expect(detail).toMatchObject({ id: m.id, name: "Auth", member_ids: [USER_ACTOR_ID], links_count: 1 });
    expect(detail.links.map((l) => l.id)).toEqual([link.id]);
    expect(detail.work_item_ids.sort()).toEqual([todo.id, done.id].sort());
    expect(detail.progress).toEqual({
      ...ZERO_PROGRESS,
      total: 2,
      unstarted: 1,
      completed: 1,
      by_state: { [states.unstarted]: 1, [states.completed]: 1 },
    });
    expect(detail.progress.points).toBeUndefined();
  });
});

describe("updateModule", () => {
  it("updates fields with one activity row per changed field and names as identifiers", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const seqBefore = latestSeq(ctx);
    const updated = updateModule(ctx, m.id, {
      name: "Authentication",
      description_md: "SSO",
      status: "in_progress",
      lead_actor_id: ASSISTANT_ACTOR_ID,
      start_date: "2026-01-01",
      target_date: "2026-02-01",
    });
    expect(updated).toMatchObject({
      name: "Authentication",
      name_key: "authentication",
      description_md: "SSO",
      status: "in_progress",
      lead_actor_id: ASSISTANT_ACTOR_ID,
      start_date: "2026-01-01",
      target_date: "2026-02-01",
    });
    expect(updated.updated_at >= m.updated_at).toBe(true);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows.every((r) => r.entity_id === m.id && r.verb === "updated" && r.project_id === projectId)).toBe(true);
    expect(rows.map((r) => r.field)).toEqual(["name", "description_md", "status", "lead_actor_id", "start_date", "target_date"]);
    expect(rows[0]).toMatchObject({ old_identifier: "Auth", new_identifier: "Authentication" });
    expect(rows[2]).toMatchObject({ old_value: "planned", new_value: "in_progress", old_identifier: "planned", new_identifier: "in_progress" });
    expect(rows[3]).toMatchObject({ old_value: null, new_value: ASSISTANT_ACTOR_ID, old_identifier: null, new_identifier: "Assistant" });
    expect(rows[4]).toMatchObject({ old_value: null, new_value: "2026-01-01" });
    const seqAfter = latestSeq(ctx);
    expect(updateModule(ctx, m.id, { status: "in_progress", name: "Authentication" }).status).toBe("in_progress");
    expect(latestSeq(ctx)).toBe(seqAfter);
    const cleared = updateModule(ctx, m.id, { lead_actor_id: null });
    expect(cleared.lead_actor_id).toBeNull();
    expect(activityRows(ctx, m.id).at(-1)).toMatchObject({ field: "lead_actor_id", old_identifier: "Assistant", new_identifier: null, new_value: null });
  });

  it("refuses a name used by another module of the project and validates input", () => {
    const { ctx, projectId } = setup();
    const auth = createModule(ctx, { project_id: projectId, name: "Auth" });
    createModule(ctx, { project_id: projectId, name: "Billing" });
    expect(errorCode(() => updateModule(ctx, auth.id, { name: "billing" }))).toBe("CONFLICT");
    expect(updateModule(ctx, auth.id, { name: "AUTH" }).name).toBe("AUTH");
    expect(errorCode(() => updateModule(ctx, auth.id, { name: " " }))).toBe("VALIDATION");
    expect(errorCode(() => updateModule(ctx, auth.id, { status: "finished" as "completed" }))).toBe("VALIDATION");
    expect(errorCode(() => updateModule(ctx, auth.id, { project_id: projectId } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateModule(ctx, auth.id, { lead_actor_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => updateModule(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
  });
});

describe("reorderModule", () => {
  it("moves between neighbours, fills a missing side and ignores archived modules", () => {
    const { ctx, projectId } = setup();
    const a = createModule(ctx, { project_id: projectId, name: "A" });
    const b = createModule(ctx, { project_id: projectId, name: "B" });
    const c = createModule(ctx, { project_id: projectId, name: "C" });
    const d = createModule(ctx, { project_id: projectId, name: "D" });
    const names = () => listModules(ctx, projectId).map((m) => m.name);
    reorderModule(ctx, d.id, { before_id: a.id, after_id: b.id });
    expect(names()).toEqual(["A", "D", "B", "C"]);
    reorderModule(ctx, a.id, { before_id: c.id });
    expect(names()).toEqual(["D", "B", "C", "A"]);
    reorderModule(ctx, c.id, { after_id: d.id });
    expect(names()).toEqual(["C", "D", "B", "A"]);
    expect(activityRows(ctx, c.id).at(-1)).toMatchObject({ field: "sort_order", old_identifier: "C", new_identifier: "C" });
    expect(errorCode(() => reorderModule(ctx, c.id, {}))).toBe("VALIDATION");
    expect(errorCode(() => reorderModule(ctx, c.id, { before_id: d.id, after_id: a.id }))).toBe("VALIDATION");
    expect(errorCode(() => reorderModule(ctx, c.id, { before_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => reorderModule(ctx, newId(), { before_id: a.id }))).toBe("NOT_FOUND");
    updateModule(ctx, b.id, { status: "cancelled" });
    archiveModule(ctx, b.id);
    expect(errorCode(() => reorderModule(ctx, c.id, { before_id: b.id }))).toBe("NOT_FOUND");
    reorderModule(ctx, c.id, { before_id: d.id, after_id: a.id });
    expect(names()).toEqual(["D", "C", "A"]);
  });

  it("computes keys across archived modules so unarchiving never creates ties", () => {
    const { ctx, projectId } = setup();
    const a = createModule(ctx, { project_id: projectId, name: "A" });
    const b = createModule(ctx, { project_id: projectId, name: "B" });
    const c = createModule(ctx, { project_id: projectId, name: "C" });
    const names = () => listModules(ctx, projectId).map((m) => m.name);
    const keys = () => [a, b, c].map((m) => moduleRow(ctx, m.id).sort_order);
    updateModule(ctx, c.id, { status: "completed" });
    archiveModule(ctx, c.id);
    reorderModule(ctx, a.id, { before_id: b.id });
    expect(names()).toEqual(["B", "A"]);
    expect(new Set(keys()).size).toBe(3);
    unarchiveModule(ctx, c.id);
    expect(names()).toEqual(["B", "A", "C"]);
    reorderModule(ctx, c.id, { before_id: b.id, after_id: a.id });
    expect(names()).toEqual(["B", "C", "A"]);
    expect(new Set(keys()).size).toBe(3);
  });
});

describe("archive and unarchive", () => {
  it("archives only when the status is completed or cancelled", () => {
    const { ctx, projectId } = setup();
    expect(ARCHIVABLE_MODULE_STATUSES).toEqual(["completed", "cancelled"]);
    for (const status of ModuleStatusSchema.options) {
      const m = createModule(ctx, { project_id: projectId, name: `Module ${status}`, status });
      if (ARCHIVABLE_MODULE_STATUSES.includes(status)) {
        expect(archiveModule(ctx, m.id).archived_at).not.toBeNull();
      } else {
        expect(ruleName(() => archiveModule(ctx, m.id))).toBe("module_status");
        expect(getModule(ctx, m.id).archived_at).toBeNull();
      }
    }
  });

  it("archive sets archived_at and logs archived; unarchive clears it and logs restored", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth", status: "completed" });
    const seqBefore = latestSeq(ctx);
    expect(ruleName(() => unarchiveModule(ctx, m.id))).toBe("not_archived");
    const archived = archiveModule(ctx, m.id);
    expect(archived.archived_at).not.toBeNull();
    expect(listModules(ctx, projectId)).toEqual([]);
    expect(getModule(ctx, m.id).archived_at).toBe(archived.archived_at);
    expect(errorCode(() => archiveModule(ctx, m.id))).toBe("ARCHIVED");
    const restored = unarchiveModule(ctx, m.id);
    expect(restored.archived_at).toBeNull();
    expect(listModules(ctx, projectId).map((x) => x.id)).toEqual([m.id]);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows.map((r) => [r.verb, r.old_identifier, r.new_identifier])).toEqual([
      ["archived", "Auth", null],
      ["restored", null, "Auth"],
    ]);
  });

  it("archived modules are read-only except unarchive and delete", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth", status: "completed" });
    const other = createModule(ctx, { project_id: projectId, name: "Other" });
    const item = insertWorkItem(ctx, projectId, states.backlog, "item");
    addWorkItemsToModule(ctx, m.id, [item.id]);
    const link = addModuleLink(ctx, m.id, { url: "https://example.com" });
    archiveModule(ctx, m.id);
    expect(errorCode(() => updateModule(ctx, m.id, { name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => reorderModule(ctx, m.id, { before_id: other.id }))).toBe("ARCHIVED");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => removeWorkItemsFromModule(ctx, m.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => setModuleMembers(ctx, m.id, [USER_ACTOR_ID]))).toBe("ARCHIVED");
    expect(errorCode(() => addModuleLink(ctx, m.id, { url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateModuleLink(ctx, link.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => removeModuleLink(ctx, link.id))).toBe("ARCHIVED");
    expect(errorCode(() => addLink(ctx, { module_id: m.id, url: "https://example.com/3" }))).toBe("ARCHIVED");
    expect(getModule(ctx, m.id)).toMatchObject({ name: "Auth", links_count: 1, work_item_ids: [item.id] });
    expect(unarchiveModule(ctx, m.id).archived_at).toBeNull();
    archiveModule(ctx, m.id);
    deleteModule(ctx, m.id);
    expect(errorCode(() => getModule(ctx, m.id))).toBe("NOT_FOUND");
  });
});

describe("setModuleMembers", () => {
  it("replaces the member list, dedupes, logs one member_ids row and requires existing actors", () => {
    const { ctx, projectId } = setup();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:claude" });
    const m = createModule(ctx, { project_id: projectId, name: "Auth", member_ids: [USER_ACTOR_ID, ASSISTANT_ACTOR_ID] });
    const seqBefore = latestSeq(ctx);
    const updated = setModuleMembers(ctx, m.id, [agent.id, ASSISTANT_ACTOR_ID, agent.id]);
    expect([...updated.member_ids].sort()).toEqual([agent.id, ASSISTANT_ACTOR_ID].sort());
    expect(memberRows(ctx, m.id)).toEqual([agent.id, ASSISTANT_ACTOR_ID].sort());
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_id: m.id, verb: "updated", field: "member_ids", old_identifier: "You, Assistant" });
    expect(rows[0].new_identifier?.split(", ").sort()).toEqual(["Assistant", "mcp:claude"]);
    expect(JSON.parse(rows[0].old_value ?? "").sort()).toEqual([USER_ACTOR_ID, ASSISTANT_ACTOR_ID].sort());
    const seqAfter = latestSeq(ctx);
    setModuleMembers(ctx, m.id, [ASSISTANT_ACTOR_ID, agent.id]);
    expect(latestSeq(ctx)).toBe(seqAfter);
    expect(setModuleMembers(ctx, m.id, []).member_ids).toEqual([]);
    expect(memberRows(ctx, m.id)).toEqual([]);
    expect(errorCode(() => setModuleMembers(ctx, m.id, [SYSTEM_ACTOR_ID, newId()]))).toBe("NOT_FOUND");
    expect(memberRows(ctx, m.id)).toEqual([]);
    expect(errorCode(() => setModuleMembers(ctx, m.id, ["nope"]))).toBe("VALIDATION");
    expect(errorCode(() => setModuleMembers(ctx, newId(), []))).toBe("NOT_FOUND");
  });
});

describe("addWorkItemsToModule and removeWorkItemsFromModule", () => {
  it("adds junction rows, allows many modules per item, skips items already in the module and logs both sides", () => {
    const { ctx, projectId, states } = setup();
    const auth = createModule(ctx, { project_id: projectId, name: "Auth" });
    const billing = createModule(ctx, { project_id: projectId, name: "Billing" });
    const one = insertWorkItem(ctx, projectId, states.backlog, "one");
    const two = insertWorkItem(ctx, projectId, states.started, "two");
    const seqBefore = latestSeq(ctx);
    const result = addWorkItemsToModule(ctx, auth.id, [one.id, two.id, one.id]);
    expect(result.progress).toEqual({ ...ZERO_PROGRESS, total: 2, backlog: 1, started: 1 });
    expect(junctionRows(ctx, auth.id)).toEqual([one.id, two.id].sort());
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      entity_type: "module",
      entity_id: auth.id,
      work_item_id: null,
      project_id: projectId,
      verb: "added",
      field: "work_item",
      new_value: one.id,
      new_identifier: `WEB-${one.sequence_id}`,
    });
    expect(rows[1]).toMatchObject({
      entity_type: "work_item",
      entity_id: one.id,
      work_item_id: one.id,
      project_id: projectId,
      verb: "added",
      field: "module",
      new_value: auth.id,
      new_identifier: "Auth",
    });
    expect(rows[2]).toMatchObject({ entity_id: auth.id, new_identifier: `WEB-${two.sequence_id}` });
    expect(rows[3]).toMatchObject({ entity_id: two.id, new_identifier: "Auth" });
    const seqAfter = latestSeq(ctx);
    addWorkItemsToModule(ctx, auth.id, [one.id]);
    expect(latestSeq(ctx)).toBe(seqAfter);
    addWorkItemsToModule(ctx, billing.id, [one.id]);
    expect(junctionRows(ctx, billing.id)).toEqual([one.id]);
    expect(ctx.db.select().from(work_item_module).where(eq(work_item_module.work_item_id, one.id)).all()).toHaveLength(2);
    expect(listModules(ctx, projectId).map((m) => m.progress.total)).toEqual([2, 1]);
  });

  it("refuses items from another project, unknown items and archived items", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = insertWorkItem(ctx, other.id, stateIds(ctx, other.id).backlog, "foreign");
    const local = insertWorkItem(ctx, projectId, states.backlog, "local");
    const gone = insertWorkItem(ctx, projectId, states.completed, "gone", { archived_at: ctx.now() });
    const deleted = insertWorkItem(ctx, projectId, states.backlog, "deleted", { deleted_at: ctx.now() });
    expect(ruleName(() => addWorkItemsToModule(ctx, m.id, [local.id, foreign.id]))).toBe("work_item_project");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, [local.id, newId()]))).toBe("NOT_FOUND");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, [local.id, deleted.id]))).toBe("NOT_FOUND");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, [local.id, gone.id]))).toBe("ARCHIVED");
    expect(junctionRows(ctx, m.id)).toEqual([]);
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, []))).toBe("VALIDATION");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, ["nope"]))).toBe("VALIDATION");
    expect(errorCode(() => addWorkItemsToModule(ctx, newId(), [local.id]))).toBe("NOT_FOUND");
  });

  it("removes junction rows, skips items that are not in the module and logs both sides", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const one = insertWorkItem(ctx, projectId, states.backlog, "one");
    const two = insertWorkItem(ctx, projectId, states.backlog, "two");
    const three = insertWorkItem(ctx, projectId, states.backlog, "three");
    addWorkItemsToModule(ctx, m.id, [one.id, two.id]);
    const seqBefore = latestSeq(ctx);
    const result = removeWorkItemsFromModule(ctx, m.id, [one.id, three.id]);
    expect(result.progress.total).toBe(1);
    expect(junctionRows(ctx, m.id)).toEqual([two.id]);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entity_type: "module", entity_id: m.id, verb: "removed", field: "work_item", old_value: one.id, old_identifier: `WEB-${one.sequence_id}` });
    expect(rows[1]).toMatchObject({ entity_type: "work_item", entity_id: one.id, work_item_id: one.id, verb: "removed", field: "module", old_value: m.id, old_identifier: "Auth" });
    expect(errorCode(() => removeWorkItemsFromModule(ctx, m.id, [newId()]))).toBe("NOT_FOUND");
    expect(errorCode(() => removeWorkItemsFromModule(ctx, m.id, []))).toBe("VALIDATION");
  });
});

describe("getModuleProgress", () => {
  it("counts non-deleted, non-archived items by state group and by state, ignoring triage", () => {
    const { ctx, projectId } = setup();
    updateProjectFeatures(ctx, projectId, { intake_enabled: true });
    const states = stateIds(ctx, projectId);
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const items = [
      insertWorkItem(ctx, projectId, states.backlog, "b1"),
      insertWorkItem(ctx, projectId, states.unstarted, "u1"),
      insertWorkItem(ctx, projectId, states.started, "s1"),
      insertWorkItem(ctx, projectId, states.started, "s2"),
      insertWorkItem(ctx, projectId, states.completed, "c1"),
      insertWorkItem(ctx, projectId, states.cancelled, "x1"),
      insertWorkItem(ctx, projectId, states.triage, "t1"),
      insertWorkItem(ctx, projectId, states.completed, "archived", { archived_at: ctx.now() }),
      insertWorkItem(ctx, projectId, states.started, "deleted", { deleted_at: ctx.now() }),
    ];
    ctx.db
      .insert(work_item_module)
      .values(items.map((item) => ({ work_item_id: item.id, module_id: m.id })))
      .run();
    const progress = getModuleProgress(ctx, m.id);
    expect(progress).toEqual({
      total: 6,
      backlog: 1,
      unstarted: 1,
      started: 2,
      completed: 1,
      cancelled: 1,
      by_state: { [states.backlog]: 1, [states.unstarted]: 1, [states.started]: 2, [states.completed]: 1, [states.cancelled]: 1 },
    });
    expect(listModules(ctx, projectId)[0].progress).toEqual({ total: 6, backlog: 1, unstarted: 1, started: 2, completed: 1, cancelled: 1 });
    expect(errorCode(() => getModuleProgress(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("reports points from estimate_point.value when the project has an active estimate system", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const system = ctx.db
      .insert(estimate)
      .values({ id: newId(), project_id: projectId, name: "Fibonacci", type: "points", ...audit(ctx) })
      .returning()
      .get();
    const stale = ctx.db
      .insert(estimate)
      .values({ id: newId(), project_id: projectId, name: "Old", type: "points", archived_at: ctx.now(), ...audit(ctx) })
      .returning()
      .get();
    const point = (estimateId: string, position: number, value: string) =>
      ctx.db
        .insert(estimate_point)
        .values({ id: newId(), estimate_id: estimateId, position, value, ...audit(ctx) })
        .returning()
        .get();
    const two = point(system.id, 0, "2");
    const five = point(system.id, 1, "5");
    const eight = point(system.id, 2, "8");
    const staleEight = point(stale.id, 0, "8");
    const items = [
      insertWorkItem(ctx, projectId, states.backlog, "b", { estimate_point_id: two.id }),
      insertWorkItem(ctx, projectId, states.started, "s", { estimate_point_id: five.id }),
      insertWorkItem(ctx, projectId, states.completed, "c1", { estimate_point_id: eight.id }),
      insertWorkItem(ctx, projectId, states.completed, "c2", { estimate_point_id: five.id }),
      insertWorkItem(ctx, projectId, states.completed, "c3", { estimate_point_id: staleEight.id }),
      insertWorkItem(ctx, projectId, states.unstarted, "no estimate"),
    ];
    ctx.db
      .insert(work_item_module)
      .values(items.map((item) => ({ work_item_id: item.id, module_id: m.id })))
      .run();
    expect(getModuleProgress(ctx, m.id).points).toBeUndefined();
    ctx.db.update(project).set({ estimate_id: system.id, estimates_enabled: true }).where(eq(project.id, projectId)).run();
    const progress = getModuleProgress(ctx, m.id);
    expect(progress.total).toBe(6);
    expect(progress.points).toEqual({ total: 20, backlog: 2, unstarted: 0, started: 5, completed: 13, cancelled: 0 });
    ctx.db.update(project).set({ estimates_enabled: false }).where(eq(project.id, projectId)).run();
    expect(getModuleProgress(ctx, m.id).points).toBeUndefined();
  });
});

describe("deleteModule", () => {
  it("soft-deletes, removes member and work item junction rows and logs deleted", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth", member_ids: [USER_ACTOR_ID] });
    const keep = createModule(ctx, { project_id: projectId, name: "Keep", member_ids: [USER_ACTOR_ID] });
    const item = insertWorkItem(ctx, projectId, states.backlog, "item");
    addWorkItemsToModule(ctx, m.id, [item.id]);
    addWorkItemsToModule(ctx, keep.id, [item.id]);
    const seqBefore = latestSeq(ctx);
    deleteModule(ctx, m.id);
    expect(errorCode(() => getModule(ctx, m.id))).toBe("NOT_FOUND");
    expect(errorCode(() => deleteModule(ctx, m.id))).toBe("NOT_FOUND");
    expect(listModules(ctx, projectId).map((x) => x.id)).toEqual([keep.id]);
    expect(ctx.db.select().from(moduleTable).where(eq(moduleTable.id, m.id)).get()?.deleted_at).not.toBeNull();
    expect(junctionRows(ctx, m.id)).toEqual([]);
    expect(memberRows(ctx, m.id)).toEqual([]);
    expect(junctionRows(ctx, keep.id)).toEqual([item.id]);
    expect(memberRows(ctx, keep.id)).toEqual([USER_ACTOR_ID]);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: "module", entity_id: m.id, verb: "deleted", old_identifier: "Auth", project_id: projectId });
  });
});

describe("module links", () => {
  it("addModuleLink, updateModuleLink and removeModuleLink go through links.ts and count in links_count", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const seqBefore = latestSeq(ctx);
    const link = addModuleLink(ctx, m.id, { url: "https://example.com/spec", title: "Spec", metadata: { favicon: "x" } });
    expect(link).toMatchObject({ parent_type: "module", module_id: m.id, work_item_id: null, title: "Spec", url: "https://example.com/spec", metadata: { favicon: "x" } });
    expect(getModule(ctx, m.id).links_count).toBe(1);
    expect(listLinks(ctx, { module_id: m.id }).map((l) => l.id)).toEqual([link.id]);
    const updated = updateModuleLink(ctx, link.id, { title: "Design", url: "https://example.com/design" });
    expect(updated).toMatchObject({ title: "Design", url: "https://example.com/design" });
    removeModuleLink(ctx, link.id);
    expect(getModule(ctx, m.id).links_count).toBe(0);
    expect(errorCode(() => getLink(ctx, link.id))).toBe("NOT_FOUND");
    const rows = rowsSince(ctx, seqBefore);
    expect(rows.every((r) => r.entity_type === "module" && r.entity_id === m.id)).toBe(true);
    expect(rows.map((r) => [r.verb, r.field])).toEqual([
      ["added", "link"],
      ["updated", "link_title"],
      ["updated", "link_url"],
      ["removed", "link"],
    ]);
    expect(errorCode(() => addModuleLink(ctx, m.id, { url: "ftp://example.com" }))).toBe("VALIDATION");
    expect(errorCode(() => addModuleLink(ctx, newId(), { url: "https://example.com" }))).toBe("NOT_FOUND");
    expect(errorCode(() => updateModuleLink(ctx, newId(), { title: "x" }))).toBe("NOT_FOUND");
    expect(errorCode(() => removeModuleLink(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("the module link functions refuse a work item link", () => {
    const { ctx, projectId, states } = setup();
    const item = insertWorkItem(ctx, projectId, states.backlog, "item");
    const link = addLink(ctx, { work_item_id: item.id, url: "https://example.com" });
    expect(errorCode(() => updateModuleLink(ctx, link.id, { title: "x" }))).toBe("NOT_FOUND");
    expect(errorCode(() => removeModuleLink(ctx, link.id))).toBe("NOT_FOUND");
    expect(getLink(ctx, link.id).title).toBe("");
  });
});

describe("archived project", () => {
  it("every module mutation is refused with ARCHIVED", () => {
    const { ctx, projectId, states } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const done = createModule(ctx, { project_id: projectId, name: "Done", status: "completed" });
    archiveModule(ctx, done.id);
    const item = insertWorkItem(ctx, projectId, states.backlog, "item");
    const link = addModuleLink(ctx, m.id, { url: "https://example.com" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => createModule(ctx, { project_id: projectId, name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateModule(ctx, m.id, { name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => reorderModule(ctx, m.id, { before_id: done.id }))).toBe("ARCHIVED");
    expect(errorCode(() => archiveModule(ctx, m.id))).toBe("ARCHIVED");
    expect(errorCode(() => unarchiveModule(ctx, done.id))).toBe("ARCHIVED");
    expect(errorCode(() => deleteModule(ctx, m.id))).toBe("ARCHIVED");
    expect(errorCode(() => addWorkItemsToModule(ctx, m.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => removeWorkItemsFromModule(ctx, m.id, [item.id]))).toBe("ARCHIVED");
    expect(errorCode(() => setModuleMembers(ctx, m.id, [USER_ACTOR_ID]))).toBe("ARCHIVED");
    expect(errorCode(() => addModuleLink(ctx, m.id, { url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateModuleLink(ctx, link.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => removeModuleLink(ctx, link.id))).toBe("ARCHIVED");
    expect(listModules(ctx, projectId).map((x) => x.id)).toEqual([m.id]);
    expect(getModule(ctx, m.id).links_count).toBe(1);
  });
});
