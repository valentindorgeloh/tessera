import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { ASSISTANT_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { TrackerError } from "@/lib/tessera/core/errors";
import { getCounts } from "@/lib/tessera/counts";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { searchWorkItemIds, upsertWorkItemFts } from "@/lib/tessera/db/fts";
import {
  activity,
  cycle,
  intake,
  intake_item,
  label,
  moduleTable,
  state,
  view,
  work_item,
  work_item_assignee,
  work_item_label,
} from "@/lib/tessera/db/schema";
import { createLabel } from "@/lib/tessera/labels";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unarchiveProject,
  updateProject,
  updateProjectFeatures,
} from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import { createState, listStates } from "@/lib/tessera/states";
import type { StateRow } from "@/lib/tessera/types";
import { createWorkItem, getWorkItem, getWorkItemByKey, listWorkItems } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

function setup(): TesseraContext {
  return createTestContext(createTestDb());
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

function stateByName(states: StateRow[], name: string): StateRow {
  const found = states.find((s) => s.name === name);
  if (!found) throw new Error(`state ${name} missing`);
  return found;
}

let sequence = 0;

function insertWorkItem(ctx: TesseraContext, projectId: string, stateId: string, name: string, extra: Partial<typeof work_item.$inferInsert> = {}) {
  const now = ctx.now();
  sequence += 1;
  const row = ctx.db
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
  upsertWorkItemFts(ctx.sqlite, { id: row.id, project_id: projectId, name, body: "" });
  return row;
}

function audit(ctx: TesseraContext) {
  const now = ctx.now();
  return { created_at: now, updated_at: now, created_by: ctx.actor.id, updated_by: ctx.actor.id };
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

describe("createProject", () => {
  it("returns the project with upper-cased identifier, zero counts and defaults", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Website", identifier: " web " });
    expect(p.identifier).toBe("WEB");
    expect(p.name_key).toBe("website");
    expect(p.counts.total).toBe(0);
    expect(p.counts.by_state_group).toEqual({ backlog: 0, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 });
    expect(p.cycles_enabled).toBe(true);
    expect(p.intake_enabled).toBe(false);
    expect(p.estimates_enabled).toBe(false);
    expect(p.created_by).toBe(ctx.actor.id);
    expect(p.archived_at).toBeNull();
    expect(getProject(ctx, p.id).id).toBe(p.id);
  });

  it("seeds Backlog (default), Todo, In Progress, Done, Cancelled with increasing sort_order", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const states = listStates(ctx, p.id);
    expect(states.map((s) => s.name)).toEqual(["Backlog", "Todo", "In Progress", "Done", "Cancelled"]);
    expect(states.map((s) => s.state_group)).toEqual(["backlog", "unstarted", "started", "completed", "cancelled"]);
    expect(states.map((s) => s.color)).toEqual(["gray", "blue", "yellow", "green", "red"]);
    expect(states.map((s) => s.is_default)).toEqual([true, false, false, false, false]);
    for (let i = 1; i < states.length; i += 1) expect(states[i - 1].sort_order < states[i].sort_order).toBe(true);
  });

  it("does not create a triage state or an intake row until intake is enabled", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    expect(listStates(ctx, p.id).some((s) => s.state_group === "triage")).toBe(false);
    expect(ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).all()).toHaveLength(0);
  });

  it("creates the triage state and the default intake when features.intake_enabled is true", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true, cycles_enabled: false } });
    expect(p.intake_enabled).toBe(true);
    expect(p.cycles_enabled).toBe(false);
    expect(listStates(ctx, p.id).filter((s) => s.state_group === "triage")).toHaveLength(1);
    const intakes = ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).all();
    expect(intakes).toHaveLength(1);
    expect(intakes[0].is_default).toBe(true);
  });

  it("writes a created activity row for the project and each seeded state", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const rows = activityRows(ctx, p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("created");
    expect(rows[0].entity_type).toBe("project");
    expect(rows[0].project_id).toBe(p.id);
    expect(rows[0].new_identifier).toBe("WEB");
    const stateRows = ctx.db.select().from(activity).where(eq(activity.entity_type, "state")).all();
    expect(stateRows).toHaveLength(5);
    expect(latestSeq(ctx)).toBe(6);
  });

  it("stores and validates the logo through LogoSchema", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", logo: { icon: "Rocket", color: "teal" } });
    expect(p.logo).toEqual({ icon: "Rocket", color: "teal" });
    expect(errorCode(() => createProject(ctx, { name: "Other", identifier: "OTH", logo: { icon: "Rocket", color: "neon" as "teal" } }))).toBe("VALIDATION");
    expect(errorCode(() => createProject(ctx, { name: "Other", identifier: "OTH", logo: { icon: "", color: "teal" } }))).toBe("VALIDATION");
  });

  it("rejects unknown keys, empty names and bad input before writing", () => {
    const ctx = setup();
    expect(errorCode(() => createProject(ctx, { name: "  ", identifier: "WEB" }))).toBe("VALIDATION");
    expect(errorCode(() => createProject(ctx, { name: "Web", identifier: "WEB", bogus: 1 } as never))).toBe("VALIDATION");
    expect(listProjects(ctx)).toHaveLength(0);
    expect(latestSeq(ctx)).toBe(0);
  });
});

describe("identifier", () => {
  it("matches ^[A-Z][A-Z0-9]{1,11}$ after normalisation", () => {
    const ctx = setup();
    expect(createProject(ctx, { name: "A", identifier: "ab" }).identifier).toBe("AB");
    expect(createProject(ctx, { name: "B", identifier: "A1B2C3D4E5F6" }).identifier).toBe("A1B2C3D4E5F6");
    for (const bad of ["A", "1AB", "ABCDEFGHIJKLM", "WE-B", "WE B", "wéb"]) {
      expect(errorCode(() => createProject(ctx, { name: `bad ${bad}`, identifier: bad })), bad).toBe("VALIDATION");
    }
  });

  it("is unique among non-deleted projects and reusable after delete", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    expect(errorCode(() => createProject(ctx, { name: "Web two", identifier: "web" }))).toBe("CONFLICT");
    deleteProject(ctx, p.id);
    expect(createProject(ctx, { name: "Web again", identifier: "WEB" }).identifier).toBe("WEB");
  });

  it("can be renamed through updateProject, not onto another project's identifier", () => {
    const ctx = setup();
    const a = createProject(ctx, { name: "A", identifier: "AAA" });
    createProject(ctx, { name: "B", identifier: "BBB" });
    const renamed = updateProject(ctx, a.id, { identifier: "ccc" });
    expect(renamed.identifier).toBe("CCC");
    expect(getProject(ctx, "ccc").id).toBe(a.id);
    expect(errorCode(() => updateProject(ctx, a.id, { identifier: "bbb" }))).toBe("CONFLICT");
    expect(errorCode(() => updateProject(ctx, a.id, { identifier: "9x" }))).toBe("VALIDATION");
    expect(updateProject(ctx, a.id, { identifier: "CCC" }).identifier).toBe("CCC");
  });

  it("renaming the identifier changes every item's key at read time", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: p.id, name: "First" });
    expect(item.key).toBe("WEB-1");
    updateProject(ctx, p.id, { identifier: "SITE" });
    expect(getWorkItem(ctx, item.id).key).toBe("SITE-1");
    expect(getWorkItemByKey(ctx, "SITE-1").id).toBe(item.id);
    expect(getWorkItemByKey(ctx, "site-1").id).toBe(item.id);
    expect(errorCode(() => getWorkItemByKey(ctx, "WEB-1"))).toBe("NOT_FOUND");
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).items.map((row) => row.key)).toEqual(["SITE-1"]);
  });
});

describe("name_key", () => {
  it("is unique case- and whitespace-insensitively among non-deleted projects", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web  Site", identifier: "WEB" });
    expect(errorCode(() => createProject(ctx, { name: " web site ", identifier: "WS" }))).toBe("CONFLICT");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(errorCode(() => updateProject(ctx, other.id, { name: "WEB SITE" }))).toBe("CONFLICT");
    expect(updateProject(ctx, p.id, { name: "Web Site" }).name_key).toBe("web site");
    deleteProject(ctx, p.id);
    expect(createProject(ctx, { name: "web site", identifier: "WS" }).name_key).toBe("web site");
  });
});

describe("getProject and listProjects", () => {
  it("finds by id or identifier in any case and throws NOT_FOUND otherwise", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    expect(getProject(ctx, p.id).identifier).toBe("WEB");
    expect(getProject(ctx, " web ").id).toBe(p.id);
    expect(errorCode(() => getProject(ctx, "NOPE"))).toBe("NOT_FOUND");
    expect(errorCode(() => getProject(ctx, newId()))).toBe("NOT_FOUND");
    deleteProject(ctx, p.id);
    expect(errorCode(() => getProject(ctx, p.id))).toBe("NOT_FOUND");
    expect(errorCode(() => getProject(ctx, "WEB"))).toBe("NOT_FOUND");
  });

  it("lists active projects in sort order and archived ones on request", () => {
    const ctx = setup();
    const a = createProject(ctx, { name: "Alpha", identifier: "ALP" });
    const b = createProject(ctx, { name: "Beta", identifier: "BET" });
    const c = createProject(ctx, { name: "Gamma", identifier: "GAM" });
    archiveProject(ctx, b.id);
    deleteProject(ctx, c.id);
    expect(listProjects(ctx).map((p) => p.id)).toEqual([a.id]);
    expect(listProjects(ctx, {}).map((p) => p.id)).toEqual([a.id]);
    expect(listProjects(ctx, { archived: false }).map((p) => p.id)).toEqual([a.id]);
    expect(listProjects(ctx, { archived: true }).map((p) => p.id)).toEqual([b.id]);
    expect(errorCode(() => listProjects(ctx, { archived: "yes" } as never))).toBe("VALIDATION");
  });

  it("returns counts over non-deleted, non-archived work items grouped by state group", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const q = createProject(ctx, { name: "Other", identifier: "OTH" });
    const states = listStates(ctx, p.id);
    const backlog = stateByName(states, "Backlog");
    const started = stateByName(states, "In Progress");
    const done = stateByName(states, "Done");
    insertWorkItem(ctx, p.id, backlog.id, "one");
    insertWorkItem(ctx, p.id, backlog.id, "two");
    insertWorkItem(ctx, p.id, started.id, "three");
    insertWorkItem(ctx, p.id, done.id, "archived", { archived_at: ctx.now() });
    insertWorkItem(ctx, p.id, done.id, "deleted", { deleted_at: ctx.now() });
    const qStates = listStates(ctx, q.id);
    insertWorkItem(ctx, q.id, stateByName(qStates, "Todo").id, "other project");
    const [first, second] = listProjects(ctx);
    expect(first.id).toBe(p.id);
    expect(first.counts).toEqual({ total: 3, by_state_group: { backlog: 2, unstarted: 0, started: 1, completed: 0, cancelled: 0, triage: 0 } });
    expect(second.counts.total).toBe(1);
    expect(second.counts.by_state_group.unstarted).toBe(1);
    expect(getProject(ctx, p.id).counts.total).toBe(3);
  });

  it("counts leave out items waiting in triage, matching getCounts and listWorkItems", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true, agent_intake_required: true } });
    createWorkItem(ctx, { project_id: p.id, name: "Visible" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:test" });
    const pending = createWorkItem(createTestContext(handles, agent.id), { project_id: p.id, name: "Via intake" });
    expect(pending.intake).toEqual({ status: "pending" });
    const counts = getProject(ctx, p.id).counts;
    expect(counts).toEqual({ total: 1, by_state_group: { backlog: 1, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } });
    expect(listProjects(ctx)[0].counts).toEqual(counts);
    expect(counts.total).toBe(getCounts(ctx, { type: "project", project_id: p.id }).total);
    expect(counts.total).toBe(listWorkItems(ctx, { scope: { type: "project", project_id: p.id } }).total);
  });
});

describe("updateProject", () => {
  it("updates fields and logs one activity row per changed field", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const before = latestSeq(ctx);
    const done = stateByName(listStates(ctx, p.id), "Done");
    const updated = updateProject(ctx, p.id, {
      name: "Website",
      description_md: "# Hello",
      logo: { icon: "Globe", color: "blue" },
      default_assignee_id: ASSISTANT_ACTOR_ID,
      archive_in_months: 3,
      close_in_months: 6,
      close_state_id: done.id,
    });
    expect(updated.name).toBe("Website");
    expect(updated.description_md).toBe("# Hello");
    expect(updated.logo).toEqual({ icon: "Globe", color: "blue" });
    expect(updated.default_assignee_id).toBe(ASSISTANT_ACTOR_ID);
    expect(updated.close_state_id).toBe(done.id);
    expect(updated.updated_at >= p.updated_at).toBe(true);
    const rows = activityRows(ctx, p.id).filter((r) => r.seq > before);
    expect(rows.map((r) => r.field)).toEqual(["name", "description_md", "logo", "default_assignee_id", "archive_in_months", "close_in_months", "close_state_id"]);
    expect(rows.every((r) => r.verb === "updated")).toBe(true);
    const assignee = rows.find((r) => r.field === "default_assignee_id");
    expect(assignee?.new_identifier).toBe("Assistant");
    const closeState = rows.find((r) => r.field === "close_state_id");
    expect(closeState?.new_identifier).toBe("Done");
    expect(closeState?.new_value).toBe(done.id);
    const name = rows.find((r) => r.field === "name");
    expect(name?.old_value).toBe("Web");
    expect(name?.new_identifier).toBe("Website");
    const seqAfter = latestSeq(ctx);
    expect(updateProject(ctx, p.id, { name: "Website" }).name).toBe("Website");
    expect(latestSeq(ctx)).toBe(seqAfter);
    expect(updateProject(ctx, p.id, { logo: null, close_state_id: null }).logo).toBeNull();
  });

  it("checks close_state_id against the project's states and default_assignee_id against actors", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const q = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = stateByName(listStates(ctx, q.id), "Done");
    expect(errorCode(() => updateProject(ctx, p.id, { close_state_id: foreign.id }))).toBe("NOT_FOUND");
    expect(errorCode(() => updateProject(ctx, p.id, { default_assignee_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => updateProject(ctx, p.id, { archive_in_months: 0 }))).toBe("VALIDATION");
    expect(errorCode(() => updateProject(ctx, p.id, { extra: true } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateProject(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
  });
});

describe("archive and unarchive", () => {
  it("archiveProject sets archived_at and logs archived; unarchive clears it and logs restored", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const archivedProject = archiveProject(ctx, p.id);
    expect(archivedProject.archived_at).not.toBeNull();
    expect(listProjects(ctx)).toHaveLength(0);
    expect(getProject(ctx, p.id).archived_at).not.toBeNull();
    const restored = unarchiveProject(ctx, p.id);
    expect(restored.archived_at).toBeNull();
    const verbs = activityRows(ctx, p.id).map((r) => r.verb);
    expect(verbs).toEqual(["created", "archived", "restored"]);
  });

  it("refuses to archive twice (ARCHIVED) or to unarchive an active project (RULE)", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    expect(errorCode(() => unarchiveProject(ctx, p.id))).toBe("RULE");
    archiveProject(ctx, p.id);
    expect(errorCode(() => archiveProject(ctx, p.id))).toBe("ARCHIVED");
    expect(errorCode(() => archiveProject(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("archived projects are read-only except unarchive and delete", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    archiveProject(ctx, p.id);
    expect(errorCode(() => updateProject(ctx, p.id, { name: "New" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateProjectFeatures(ctx, p.id, { intake_enabled: true }))).toBe("ARCHIVED");
    expect(errorCode(() => createState(ctx, { project_id: p.id, name: "QA", state_group: "started" }))).toBe("ARCHIVED");
    expect(errorCode(() => createLabel(ctx, { project_id: p.id, name: "bug" }))).toBe("ARCHIVED");
    expect(() => deleteProject(ctx, p.id)).not.toThrow();
    expect(errorCode(() => getProject(ctx, p.id))).toBe("NOT_FOUND");
  });
});

describe("deleteProject", () => {
  it("soft-deletes states, labels, work items, junction rows, FTS rows, cycles, modules, views and intakes in one transaction", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true } });
    const keep = createProject(ctx, { name: "Keep", identifier: "KEEP" });
    const states = listStates(ctx, p.id);
    const backlog = stateByName(states, "Backlog");
    const bug = createLabel(ctx, { project_id: p.id, name: "bug" });
    const item = insertWorkItem(ctx, p.id, backlog.id, "Searchable item");
    const keepItem = insertWorkItem(ctx, keep.id, stateByName(listStates(ctx, keep.id), "Backlog").id, "Searchable keeper");
    ctx.db.insert(work_item_label).values({ work_item_id: item.id, label_id: bug.id }).run();
    ctx.db.insert(work_item_assignee).values({ work_item_id: item.id, actor_id: ctx.actor.id }).run();
    const cycleId = newId();
    ctx.db.insert(cycle).values({ id: cycleId, project_id: p.id, name: "Sprint 1", sort_order: firstSortOrder(), ...audit(ctx) }).run();
    const moduleId = newId();
    ctx.db.insert(moduleTable).values({ id: moduleId, project_id: p.id, name: "Mod", name_key: "mod", sort_order: firstSortOrder(), ...audit(ctx) }).run();
    const viewId = newId();
    ctx.db
      .insert(view)
      .values({ id: viewId, project_id: p.id, name: "V", name_key: "v", filters: {}, display: DEFAULT_DISPLAY, sort_order: firstSortOrder(), ...audit(ctx) })
      .run();
    const workspaceViewId = newId();
    ctx.db
      .insert(view)
      .values({ id: workspaceViewId, project_id: null, name: "W", name_key: "w", filters: {}, display: DEFAULT_DISPLAY, sort_order: firstSortOrder(), ...audit(ctx) })
      .run();
    const intakeRow = ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).get();
    if (!intakeRow) throw new Error("intake missing");
    const intakeItemId = newId();
    ctx.db
      .insert(intake_item)
      .values({ id: intakeItemId, intake_id: intakeRow.id, work_item_id: item.id, created_by_actor_id: ctx.actor.id, ...audit(ctx) })
      .run();
    expect(searchWorkItemIds(ctx.sqlite, "searchable").sort()).toEqual([item.id, keepItem.id].sort());

    const seqBefore = latestSeq(ctx);
    deleteProject(ctx, p.id);

    expect(ctx.sqlite.inTransaction).toBe(false);
    expect(ctx.db.select().from(state).where(and(eq(state.project_id, p.id), isNull(state.deleted_at))).all()).toHaveLength(0);
    expect(ctx.db.select().from(label).where(and(eq(label.project_id, p.id), isNull(label.deleted_at))).all()).toHaveLength(0);
    expect(ctx.db.select().from(work_item).where(and(eq(work_item.project_id, p.id), isNull(work_item.deleted_at))).all()).toHaveLength(0);
    expect(ctx.db.select().from(work_item_label).where(eq(work_item_label.work_item_id, item.id)).all()).toHaveLength(0);
    expect(ctx.db.select().from(work_item_assignee).where(eq(work_item_assignee.work_item_id, item.id)).all()).toHaveLength(0);
    expect(searchWorkItemIds(ctx.sqlite, "searchable")).toEqual([keepItem.id]);
    expect(ctx.db.select().from(cycle).where(eq(cycle.id, cycleId)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(moduleTable).where(eq(moduleTable.id, moduleId)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(view).where(eq(view.id, viewId)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(view).where(eq(view.id, workspaceViewId)).get()?.deleted_at).toBeNull();
    expect(ctx.db.select().from(intake).where(eq(intake.id, intakeRow.id)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(intake_item).where(eq(intake_item.id, intakeItemId)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(state).where(eq(state.project_id, p.id)).all().length).toBeGreaterThan(0);
    expect(listStates(ctx, keep.id)).toHaveLength(5);
    expect(getProject(ctx, keep.id).counts.total).toBe(1);
    const rows = activityRows(ctx, p.id).filter((r) => r.seq > seqBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0].verb).toBe("deleted");
    expect(rows[0].old_identifier).toBe("WEB");
    expect(errorCode(() => deleteProject(ctx, p.id))).toBe("NOT_FOUND");
  });
});

describe("updateProjectFeatures", () => {
  it("enabling intake creates the hidden Triage state and the default intake exactly once", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const enabled = updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    expect(enabled.intake_enabled).toBe(true);
    const triage = listStates(ctx, p.id).filter((s) => s.state_group === "triage");
    expect(triage).toHaveLength(1);
    expect(triage[0].name).toBe("Triage");
    expect(triage[0].is_default).toBe(false);
    expect(ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).all()).toHaveLength(1);
    updateProjectFeatures(ctx, p.id, { intake_enabled: false });
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    updateProjectFeatures(ctx, p.id, { intake_enabled: true });
    expect(listStates(ctx, p.id).filter((s) => s.state_group === "triage")).toHaveLength(1);
    expect(ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).all()).toHaveLength(1);
    expect(listStates(ctx, p.id).filter((s) => s.is_default)).toHaveLength(1);
  });

  it("disabling intake with pending intake items is refused with RULE", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB", features: { intake_enabled: true } });
    const triage = listStates(ctx, p.id).find((s) => s.state_group === "triage");
    const intakeRow = ctx.db.select().from(intake).where(eq(intake.project_id, p.id)).get();
    if (!triage || !intakeRow) throw new Error("intake setup missing");
    const item = insertWorkItem(ctx, p.id, triage.id, "From an agent");
    const itemId = newId();
    ctx.db
      .insert(intake_item)
      .values({ id: itemId, intake_id: intakeRow.id, work_item_id: item.id, status: "pending", created_by_actor_id: ctx.actor.id, ...audit(ctx) })
      .run();
    expect(errorCode(() => updateProjectFeatures(ctx, p.id, { intake_enabled: false }))).toBe("RULE");
    expect(getProject(ctx, p.id).intake_enabled).toBe(true);
    ctx.db.update(intake_item).set({ status: "snoozed" }).where(eq(intake_item.id, itemId)).run();
    expect(errorCode(() => updateProjectFeatures(ctx, p.id, { intake_enabled: false }))).toBe("RULE");
    ctx.db.update(intake_item).set({ status: "accepted" }).where(eq(intake_item.id, itemId)).run();
    expect(updateProjectFeatures(ctx, p.id, { intake_enabled: false }).intake_enabled).toBe(false);
  });

  it("other toggles are plain updates with one activity row per changed field", () => {
    const ctx = setup();
    const p = createProject(ctx, { name: "Web", identifier: "WEB" });
    const seqBefore = latestSeq(ctx);
    const updated = updateProjectFeatures(ctx, p.id, { cycles_enabled: false, estimates_enabled: true, agent_intake_required: true, pages_enabled: true });
    expect(updated.cycles_enabled).toBe(false);
    expect(updated.estimates_enabled).toBe(true);
    expect(updated.agent_intake_required).toBe(true);
    expect(listStates(ctx, p.id).some((s) => s.state_group === "triage")).toBe(false);
    const rows = activityRows(ctx, p.id).filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => r.field)).toEqual(["cycles_enabled", "estimates_enabled", "agent_intake_required"]);
    expect(rows[0].old_value).toBe("true");
    expect(rows[0].new_value).toBe("false");
    const seqAfter = latestSeq(ctx);
    expect(updateProjectFeatures(ctx, p.id, { cycles_enabled: false }).updated_at).toBe(updated.updated_at);
    expect(latestSeq(ctx)).toBe(seqAfter);
    expect(errorCode(() => updateProjectFeatures(ctx, p.id, { cycles_enabled: "no" } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateProjectFeatures(ctx, newId(), { cycles_enabled: false }))).toBe("NOT_FOUND");
  });
});
