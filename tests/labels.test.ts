import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, label, view, work_item, work_item_label } from "@/lib/tessera/db/schema";
import { createLabel, deleteLabel, getLabel, listLabels, reorderLabel, updateLabel } from "@/lib/tessera/labels";
import { archiveProject, createProject } from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY, FiltersSchema } from "@/lib/tessera/schemas";
import { listStates } from "@/lib/tessera/states";
import type { Filters } from "@/lib/tessera/types";
import { getViewSettings, saveViewSettings, WORKSPACE_SCOPE_ID } from "@/lib/tessera/view-settings";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

type Fixture = { ctx: TesseraContext; projectId: string; stateId: string };

function setup(): Fixture {
  const ctx = createTestContext(createTestDb());
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: p.id, stateId: listStates(ctx, p.id)[0].id };
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

function insertWorkItem(ctx: TesseraContext, projectId: string, stateId: string, name: string) {
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
    })
    .returning()
    .get();
}

function insertView(ctx: TesseraContext, projectId: string | null, name: string, filters: Filters) {
  const now = ctx.now();
  return ctx.db
    .insert(view)
    .values({
      id: newId(),
      project_id: projectId,
      name,
      name_key: name.toLowerCase(),
      filters,
      display: DEFAULT_DISPLAY,
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get();
}

function viewFilters(ctx: TesseraContext, viewId: string): Filters {
  const row = ctx.db.select().from(view).where(eq(view.id, viewId)).get();
  if (!row) throw new Error("view missing");
  return FiltersSchema.parse(row.filters);
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

describe("createLabel and listLabels", () => {
  it("creates labels in order with defaults and logs created", () => {
    const { ctx, projectId } = setup();
    expect(listLabels(ctx, projectId)).toEqual([]);
    const seqBefore = latestSeq(ctx);
    const bug = createLabel(ctx, { project_id: projectId, name: "  Bug  " });
    const feature = createLabel(ctx, { project_id: projectId, name: "Feature", color: "green" });
    expect(bug.name).toBe("Bug");
    expect(bug.name_key).toBe("bug");
    expect(bug.color).toBe("gray");
    expect(bug.parent_id).toBeNull();
    expect(feature.color).toBe("green");
    expect(bug.sort_order < feature.sort_order).toBe(true);
    expect(listLabels(ctx, projectId).map((l) => l.id)).toEqual([bug.id, feature.id]);
    expect(getLabel(ctx, bug.id).project_id).toBe(projectId);
    const rows = activityRows(ctx, bug.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "created", entity_type: "label", new_identifier: "Bug", project_id: projectId });
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    expect(errorCode(() => listLabels(ctx, newId()))).toBe("NOT_FOUND");
    expect(errorCode(() => getLabel(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("keeps names unique per project (case- and whitespace-insensitive), reusable after delete", () => {
    const { ctx, projectId } = setup();
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: " BUG " }))).toBe("CONFLICT");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createLabel(ctx, { project_id: other.id, name: "bug" }).name).toBe("bug");
    deleteLabel(ctx, bug.id);
    expect(createLabel(ctx, { project_id: projectId, name: "bug" }).name).toBe("bug");
  });

  it("validates input before writing", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "" }))).toBe("VALIDATION");
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "x", color: "neon" as "red" }))).toBe("VALIDATION");
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "x", parent_id: "nope" }))).toBe("VALIDATION");
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "x", extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => createLabel(ctx, { project_id: newId(), name: "x" }))).toBe("NOT_FOUND");
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "x", parent_id: newId() }))).toBe("NOT_FOUND");
    expect(listLabels(ctx, projectId)).toEqual([]);
  });
});

describe("one level deep", () => {
  it("a label nests under a top-level label of the same project", () => {
    const { ctx, projectId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    const ui = createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    expect(ui.parent_id).toBe(area.id);
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(ruleName(() => createLabel(ctx, { project_id: other.id, name: "Foreign child", parent_id: area.id }))).toBe("label_parent_project");
  });

  it("a label with a parent cannot be a parent", () => {
    const { ctx, projectId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    const ui = createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    expect(ruleName(() => createLabel(ctx, { project_id: projectId, name: "Buttons", parent_id: ui.id }))).toBe("label_depth");
    const loose = createLabel(ctx, { project_id: projectId, name: "Loose" });
    expect(ruleName(() => updateLabel(ctx, loose.id, { parent_id: ui.id }))).toBe("label_depth");
  });

  it("a label with children cannot get a parent", () => {
    const { ctx, projectId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    const other = createLabel(ctx, { project_id: projectId, name: "Other" });
    expect(ruleName(() => updateLabel(ctx, area.id, { parent_id: other.id }))).toBe("label_has_children");
    expect(ruleName(() => updateLabel(ctx, area.id, { parent_id: area.id }))).toBe("label_self_parent");
    expect(getLabel(ctx, area.id).parent_id).toBeNull();
  });
});

describe("updateLabel", () => {
  it("updates name, colour and parent with one activity row per field and label names as identifiers", () => {
    const { ctx, projectId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    const zone = createLabel(ctx, { project_id: projectId, name: "Zone" });
    const ui = createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    const seqBefore = latestSeq(ctx);
    const updated = updateLabel(ctx, ui.id, { name: "Interface", color: "pink", parent_id: zone.id });
    expect(updated.name).toBe("Interface");
    expect(updated.name_key).toBe("interface");
    expect(updated.color).toBe("pink");
    expect(updated.parent_id).toBe(zone.id);
    const rows = activityRows(ctx, ui.id).filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => r.field)).toEqual(["name", "color", "parent_id"]);
    expect(rows[0]).toMatchObject({ old_identifier: "UI", new_identifier: "Interface", project_id: projectId });
    expect(rows[2]).toMatchObject({ old_value: area.id, new_value: zone.id, old_identifier: "Area", new_identifier: "Zone" });
    const detached = updateLabel(ctx, ui.id, { parent_id: null });
    expect(detached.parent_id).toBeNull();
    expect(activityRows(ctx, ui.id).at(-1)).toMatchObject({ field: "parent_id", old_identifier: "Zone", new_identifier: null, new_value: null });
    const seqAfter = latestSeq(ctx);
    expect(updateLabel(ctx, ui.id, { color: "pink" }).color).toBe("pink");
    expect(latestSeq(ctx)).toBe(seqAfter);
  });

  it("refuses a name used by another label of the project and validates input", () => {
    const { ctx, projectId } = setup();
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    createLabel(ctx, { project_id: projectId, name: "Feature" });
    expect(errorCode(() => updateLabel(ctx, bug.id, { name: "feature" }))).toBe("CONFLICT");
    expect(updateLabel(ctx, bug.id, { name: "BUG" }).name).toBe("BUG");
    expect(errorCode(() => updateLabel(ctx, bug.id, { name: " " }))).toBe("VALIDATION");
    expect(errorCode(() => updateLabel(ctx, bug.id, { project_id: projectId } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateLabel(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
    expect(errorCode(() => updateLabel(ctx, bug.id, { parent_id: newId() }))).toBe("NOT_FOUND");
  });
});

describe("reorderLabel", () => {
  it("moves between neighbours and fills a missing side", () => {
    const { ctx, projectId } = setup();
    const a = createLabel(ctx, { project_id: projectId, name: "A" });
    const b = createLabel(ctx, { project_id: projectId, name: "B" });
    const c = createLabel(ctx, { project_id: projectId, name: "C" });
    const d = createLabel(ctx, { project_id: projectId, name: "D" });
    reorderLabel(ctx, d.id, { before_id: a.id, after_id: b.id });
    expect(listLabels(ctx, projectId).map((l) => l.name)).toEqual(["A", "D", "B", "C"]);
    reorderLabel(ctx, a.id, { before_id: c.id });
    expect(listLabels(ctx, projectId).map((l) => l.name)).toEqual(["D", "B", "C", "A"]);
    reorderLabel(ctx, c.id, { after_id: d.id });
    expect(listLabels(ctx, projectId).map((l) => l.name)).toEqual(["C", "D", "B", "A"]);
    expect(activityRows(ctx, c.id).at(-1)?.field).toBe("sort_order");
    expect(errorCode(() => reorderLabel(ctx, c.id, {}))).toBe("VALIDATION");
    expect(errorCode(() => reorderLabel(ctx, c.id, { before_id: d.id, after_id: a.id }))).toBe("VALIDATION");
    expect(errorCode(() => reorderLabel(ctx, c.id, { before_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => reorderLabel(ctx, newId(), { before_id: a.id }))).toBe("NOT_FOUND");
  });
});

describe("deleteLabel", () => {
  it("deletes the children of a parent label", () => {
    const { ctx, projectId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    const ui = createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    const api = createLabel(ctx, { project_id: projectId, name: "API", parent_id: area.id });
    const other = createLabel(ctx, { project_id: projectId, name: "Other" });
    const seqBefore = latestSeq(ctx);
    deleteLabel(ctx, area.id);
    expect(listLabels(ctx, projectId).map((l) => l.id)).toEqual([other.id]);
    for (const id of [area.id, ui.id, api.id]) expect(errorCode(() => getLabel(ctx, id))).toBe("NOT_FOUND");
    expect(ctx.db.select().from(label).where(eq(label.id, ui.id)).get()?.deleted_at).not.toBeNull();
    const rows = ctx.db.select().from(activity).all().filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => [r.entity_id, r.verb])).toEqual([
      [area.id, "deleted"],
      [ui.id, "deleted"],
      [api.id, "deleted"],
    ]);
    expect(rows[0].old_identifier).toBe("Area");
    expect(errorCode(() => deleteLabel(ctx, area.id))).toBe("NOT_FOUND");
  });

  it("removes work_item_label rows for the label and its children", () => {
    const { ctx, projectId, stateId } = setup();
    const area = createLabel(ctx, { project_id: projectId, name: "Area" });
    const ui = createLabel(ctx, { project_id: projectId, name: "UI", parent_id: area.id });
    const keep = createLabel(ctx, { project_id: projectId, name: "Keep" });
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    ctx.db
      .insert(work_item_label)
      .values([
        { work_item_id: item.id, label_id: area.id },
        { work_item_id: item.id, label_id: ui.id },
        { work_item_id: item.id, label_id: keep.id },
      ])
      .run();
    deleteLabel(ctx, area.id);
    expect(ctx.db.select().from(work_item_label).where(eq(work_item_label.work_item_id, item.id)).all().map((r) => r.label_id)).toEqual([keep.id]);
  });

  it("strips the ids from filters.labels of every view in the project and leaves other views alone", () => {
    const { ctx, projectId } = setup();
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    const child = createLabel(ctx, { project_id: projectId, name: "Child", parent_id: bug.id });
    const keep = createLabel(ctx, { project_id: projectId, name: "Keep" });
    const mixed = insertView(ctx, projectId, "Mixed", { labels: [bug.id, keep.id, child.id], priority: ["high"] });
    const only = insertView(ctx, projectId, "Only", { labels: [bug.id] });
    const untouched = insertView(ctx, projectId, "Untouched", { labels: [keep.id], state_group: ["started"] });
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    const foreign = insertView(ctx, other.id, "Foreign", { labels: [bug.id] });
    const seqBefore = latestSeq(ctx);
    deleteLabel(ctx, bug.id);
    expect(viewFilters(ctx, mixed.id)).toEqual({ labels: [keep.id], priority: ["high"] });
    expect(viewFilters(ctx, only.id)).toEqual({});
    expect(viewFilters(ctx, untouched.id)).toEqual({ labels: [keep.id], state_group: ["started"] });
    expect(viewFilters(ctx, foreign.id)).toEqual({ labels: [bug.id] });
    expect(ctx.db.select().from(view).where(eq(view.id, untouched.id)).get()?.updated_at).toBe(untouched.updated_at);
    const viewRows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.seq > seqBefore && r.entity_type === "view");
    expect(viewRows.map((r) => r.entity_id).sort()).toEqual([mixed.id, only.id].sort());
    expect(viewRows.every((r) => r.field === "filters" && r.verb === "updated")).toBe(true);
  });

  it("strips the ids from workspace views and from stored view settings as well", () => {
    const { ctx, projectId } = setup();
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    const keep = createLabel(ctx, { project_id: projectId, name: "Keep" });
    const everywhere = insertView(ctx, null, "Everywhere", { labels: [bug.id, keep.id] });
    const elsewhere = insertView(ctx, null, "Elsewhere", { labels: [keep.id] });
    saveViewSettings(ctx, "project", projectId, { filters: { labels: [bug.id], priority: ["high"] } });
    saveViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID, { filters: { labels: [keep.id, bug.id] } });
    saveViewSettings(ctx, "profile", USER_ACTOR_ID, { filters: { labels: [keep.id] } });
    const seqBefore = latestSeq(ctx);
    deleteLabel(ctx, bug.id);
    expect(viewFilters(ctx, everywhere.id)).toEqual({ labels: [keep.id] });
    expect(viewFilters(ctx, elsewhere.id)).toEqual({ labels: [keep.id] });
    expect(getViewSettings(ctx, "project", projectId).filters).toEqual({ priority: ["high"] });
    expect(getViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID).filters).toEqual({ labels: [keep.id] });
    expect(getViewSettings(ctx, "profile", USER_ACTOR_ID).filters).toEqual({ labels: [keep.id] });
    const rows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.seq > seqBefore);
    expect(rows.filter((r) => r.entity_type === "view").map((r) => r.entity_id)).toEqual([everywhere.id]);
    const settingsRows = rows.filter((r) => r.entity_type === "view_settings");
    expect(settingsRows.map((r) => r.entity_id).sort()).toEqual([`project:${projectId}`, `workspace:${WORKSPACE_SCOPE_ID}`].sort());
    expect(settingsRows.every((r) => r.field === "filters" && r.verb === "updated")).toBe(true);
  });
});

describe("archived project", () => {
  it("every label mutation is refused with ARCHIVED", () => {
    const { ctx, projectId } = setup();
    const bug = createLabel(ctx, { project_id: projectId, name: "Bug" });
    const feature = createLabel(ctx, { project_id: projectId, name: "Feature" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => createLabel(ctx, { project_id: projectId, name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateLabel(ctx, bug.id, { name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => reorderLabel(ctx, bug.id, { before_id: feature.id }))).toBe("ARCHIVED");
    expect(errorCode(() => deleteLabel(ctx, bug.id))).toBe("ARCHIVED");
    expect(listLabels(ctx, projectId)).toHaveLength(2);
  });
});
