import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, view } from "@/lib/tessera/db/schema";
import { archiveProject, createProject } from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Filters, RichFilters } from "@/lib/tessera/types";
import {
  COPY_NAME_PREFIX,
  createView,
  deleteView,
  duplicateView,
  getView,
  listViews,
  lockView,
  unlockView,
  updateView,
  type View,
} from "@/lib/tessera/views";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

type Fixture = { ctx: TesseraContext; projectId: string };

function setup(): Fixture {
  const ctx = createTestContext(createTestDb());
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: p.id };
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

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function rawRow(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(view).where(eq(view.id, id)).get();
  if (!row) throw new Error("view row missing");
  return row;
}

const RICH: RichFilters = { and: [{ field: "priority", op: "in", value: ["high"] }] };

describe("listViews and getView", () => {
  it("lists project views in sort order and workspace views for project_id null", () => {
    const { ctx, projectId } = setup();
    expect(listViews(ctx, { project_id: projectId })).toEqual([]);
    expect(listViews(ctx, { project_id: null })).toEqual([]);
    const a = createView(ctx, { project_id: projectId, name: "A" });
    const b = createView(ctx, { project_id: projectId, name: "B" });
    const w = createView(ctx, { project_id: null, name: "W" });
    expect(listViews(ctx, { project_id: projectId }).map((v) => v.id)).toEqual([a.id, b.id]);
    expect(listViews(ctx, { project_id: null }).map((v) => v.id)).toEqual([w.id]);
    expect(getView(ctx, w.id).project_id).toBeNull();
  });

  it("NOT_FOUND for an unknown project, an unknown view and VALIDATION for a bad project id", () => {
    const { ctx } = setup();
    expect(errorCode(() => listViews(ctx, { project_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => getView(ctx, newId()))).toBe("NOT_FOUND");
    expect(errorCode(() => listViews(ctx, { project_id: "nope" }))).toBe("VALIDATION");
  });

  it("parses JSON columns through their schemas on read, filling display defaults", () => {
    const { ctx, projectId } = setup();
    const now = ctx.now();
    const partialDisplay = { layout: "board", group_by: "state" } as Display;
    const row = ctx.db
      .insert(view)
      .values({
        id: newId(),
        project_id: projectId,
        name: "Raw",
        name_key: "raw",
        filters: { priority: ["high"] },
        display: partialDisplay,
        sort_order: firstSortOrder(),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    const read = getView(ctx, row.id);
    expect(read.display).toEqual({ ...DEFAULT_DISPLAY, layout: "board", group_by: "state" });
    expect(read.filters).toEqual({ priority: ["high"] });
    expect(read.rich_filters).toBeNull();
    expect(read.logo).toBeNull();
  });
});

describe("createView", () => {
  it("creates a project view with defaults and logs created", () => {
    const { ctx, projectId } = setup();
    const seqBefore = latestSeq(ctx);
    const v = createView(ctx, { project_id: projectId, name: "  Open bugs  " });
    expect(v.name).toBe("Open bugs");
    expect(v.name_key).toBe("open bugs");
    expect(v.description).toBe("");
    expect(v.filters).toEqual({});
    expect(v.rich_filters).toBeNull();
    expect(v.display).toEqual(DEFAULT_DISPLAY);
    expect(v.is_locked).toBe(false);
    expect(v.logo).toBeNull();
    expect(v.created_by).toBe(ctx.actor.id);
    expect(v.deleted_at).toBeNull();
    const rows = activityRows(ctx, v.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "created", entity_type: "view", new_identifier: "Open bugs", project_id: projectId });
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
  });

  it("stores description, filters, rich_filters, display and logo as given", () => {
    const { ctx, projectId } = setup();
    const filters: Filters = { priority: ["high", "urgent"], state_group: ["started"] };
    const v = createView(ctx, {
      project_id: projectId,
      name: "Hot",
      description: " Urgent work ",
      filters,
      rich_filters: RICH,
      display: { layout: "board", group_by: "state", calendar: { layout: "week" }, properties: { key: false } },
      logo: { icon: "Fire", color: "red" },
    });
    expect(v.description).toBe("Urgent work");
    expect(v.filters).toEqual(filters);
    expect(v.rich_filters).toEqual(RICH);
    expect(v.display).toEqual({
      ...DEFAULT_DISPLAY,
      layout: "board",
      group_by: "state",
      calendar: { layout: "week", show_weekends: true },
      properties: { ...DEFAULT_DISPLAY.properties, key: false },
    });
    expect(v.logo).toEqual({ icon: "Fire", color: "red" });
  });

  it("creates a workspace view with project_id null and defaults its layout to table", () => {
    const { ctx } = setup();
    const w = createView(ctx, { project_id: null, name: "All urgent", display: { group_by: "project" } });
    expect(w.project_id).toBeNull();
    expect(w.display.layout).toBe("table");
    expect(w.display.group_by).toBe("project");
    expect(activityRows(ctx, w.id)[0]).toMatchObject({ verb: "created", project_id: null });
  });

  it("rejects a workspace view with a layout other than table (VALIDATION) before writing", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => createView(ctx, { project_id: null, name: "Board", display: { layout: "board" } }))).toBe("VALIDATION");
    expect(listViews(ctx, { project_id: null })).toEqual([]);
    expect(createView(ctx, { project_id: projectId, name: "Board", display: { layout: "board" } }).display.layout).toBe("board");
  });

  it("keeps names unique per project (case- and whitespace-insensitive), reusable after delete", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "Open bugs" });
    expect(errorCode(() => createView(ctx, { project_id: projectId, name: " open   BUGS " }))).toBe("CONFLICT");
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    expect(createView(ctx, { project_id: other.id, name: "open bugs" }).project_id).toBe(other.id);
    deleteView(ctx, v.id);
    expect(createView(ctx, { project_id: projectId, name: "open bugs" }).name).toBe("open bugs");
  });

  it("keeps workspace view names unique in code although NULL project_id escapes the unique index", () => {
    const { ctx, projectId } = setup();
    createView(ctx, { project_id: null, name: "Mine" });
    expect(errorCode(() => createView(ctx, { project_id: null, name: "MINE" }))).toBe("CONFLICT");
    expect(createView(ctx, { project_id: projectId, name: "Mine" }).project_id).toBe(projectId);
    expect(listViews(ctx, { project_id: null })).toHaveLength(1);
  });

  it("validates name, filters, rich_filters, display, logo and unknown keys before writing", () => {
    const { ctx, projectId } = setup();
    const base = { project_id: projectId, name: "V" };
    expect(errorCode(() => createView(ctx, { ...base, name: " " }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, name: "x".repeat(121) }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, filters: { priority: ["critical"] } as never }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, filters: { state: ["not-an-id"] } }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, rich_filters: { and: [{ field: "nope", op: "eq" }] } as never }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, display: { layout: "grid" } as never }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, display: { properties: { bogus: true } } as never }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, logo: { icon: "Fire", color: "neon" } as never }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, logo: { icon: "", color: "red" } }))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { ...base, extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => createView(ctx, { project_id: newId(), name: "V" }))).toBe("NOT_FOUND");
    expect(listViews(ctx, { project_id: projectId })).toEqual([]);
  });

  it("appends sort_order at the end of its own scope", () => {
    const { ctx, projectId } = setup();
    const a = createView(ctx, { project_id: projectId, name: "A" });
    const w = createView(ctx, { project_id: null, name: "W" });
    const b = createView(ctx, { project_id: projectId, name: "B" });
    expect(a.sort_order < b.sort_order).toBe(true);
    expect(w.sort_order).toBe(a.sort_order);
    expect(listViews(ctx, { project_id: projectId }).map((v) => v.name)).toEqual(["A", "B"]);
  });
});

describe("updateView", () => {
  it("updates every field with one activity row per changed field and names as identifiers", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "Open", filters: { priority: ["high"] } });
    const seqBefore = latestSeq(ctx);
    const updated = updateView(ctx, v.id, {
      name: "Open bugs",
      description: "Bugs still open",
      filters: { state_group: ["started"] },
      rich_filters: RICH,
      display: { layout: "board" },
      logo: { icon: "Bug", color: "red" },
    });
    expect(updated.name).toBe("Open bugs");
    expect(updated.name_key).toBe("open bugs");
    expect(updated.description).toBe("Bugs still open");
    expect(updated.filters).toEqual({ state_group: ["started"] });
    expect(updated.rich_filters).toEqual(RICH);
    expect(updated.display.layout).toBe("board");
    expect(updated.logo).toEqual({ icon: "Bug", color: "red" });
    expect(updated.updated_by).toBe(ctx.actor.id);
    const rows = activityRows(ctx, v.id).filter((r) => r.seq > seqBefore);
    expect(rows.map((r) => r.field)).toEqual(["name", "description", "filters", "rich_filters", "display", "logo"]);
    expect(rows[0]).toMatchObject({ verb: "updated", old_identifier: "Open", new_identifier: "Open bugs", project_id: projectId });
    expect(rows[2]).toMatchObject({ old_value: JSON.stringify({ priority: ["high"] }), new_value: JSON.stringify({ state_group: ["started"] }) });
    expect(rows[3].old_value).toBeNull();
    expect(rows[5].old_value).toBeNull();
    expect(getView(ctx, v.id)).toEqual(updated);
  });

  it("writes no activity when nothing changes and clears rich_filters and logo with null", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "Open", rich_filters: RICH, logo: { icon: "Bug", color: "red" } });
    const seqBefore = latestSeq(ctx);
    const unchanged = updateView(ctx, v.id, { name: "Open", rich_filters: RICH, display: {} });
    // updated_at is stamped on every write; everything else must be untouched.
    expect({ ...unchanged, updated_at: v.updated_at }).toEqual(v);
    expect(latestSeq(ctx)).toBe(seqBefore);
    const cleared = updateView(ctx, v.id, { rich_filters: null, logo: null });
    expect(cleared.rich_filters).toBeNull();
    expect(cleared.logo).toBeNull();
    expect(activityRows(ctx, v.id).filter((r) => r.seq > seqBefore).map((r) => r.field)).toEqual(["rich_filters", "logo"]);
  });

  it("merges display over the saved display one level deep and replaces filters", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, {
      project_id: projectId,
      name: "Open",
      filters: { priority: ["high"], state_group: ["started"] },
      display: { layout: "board", group_by: "state", calendar: { layout: "week" }, properties: { key: false, links: false } },
    });
    const updated = updateView(ctx, v.id, {
      filters: { priority: ["urgent"] },
      display: { order_by: "-created_at", calendar: { show_weekends: false }, properties: { key: true } },
    });
    expect(updated.filters).toEqual({ priority: ["urgent"] });
    expect(updated.display).toEqual({
      ...DEFAULT_DISPLAY,
      layout: "board",
      group_by: "state",
      order_by: "-created_at",
      calendar: { layout: "week", show_weekends: false },
      properties: { ...DEFAULT_DISPLAY.properties, key: true, links: false },
    });
  });

  it("refuses a name used by another view of the same scope but allows it in another scope", () => {
    const { ctx, projectId } = setup();
    const a = createView(ctx, { project_id: projectId, name: "A" });
    createView(ctx, { project_id: projectId, name: "B" });
    const w = createView(ctx, { project_id: null, name: "W" });
    createView(ctx, { project_id: null, name: "X" });
    expect(errorCode(() => updateView(ctx, a.id, { name: " b " }))).toBe("CONFLICT");
    expect(errorCode(() => updateView(ctx, w.id, { name: "x" }))).toBe("CONFLICT");
    expect(updateView(ctx, a.id, { name: "W" }).name).toBe("W");
    expect(updateView(ctx, w.id, { name: "A" }).name).toBe("A");
    expect(updateView(ctx, a.id, { name: "w" }).name).toBe("w");
  });

  it("keeps workspace views table-only on update", () => {
    const { ctx } = setup();
    const w = createView(ctx, { project_id: null, name: "W" });
    expect(errorCode(() => updateView(ctx, w.id, { display: { layout: "list" } }))).toBe("VALIDATION");
    expect(updateView(ctx, w.id, { display: { layout: "table", group_by: "priority" } }).display.group_by).toBe("priority");
    expect(getView(ctx, w.id).display.layout).toBe("table");
  });

  it("validates the patch and reports NOT_FOUND for unknown views", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    expect(errorCode(() => updateView(ctx, v.id, { name: "" }))).toBe("VALIDATION");
    expect(errorCode(() => updateView(ctx, v.id, { project_id: null } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateView(ctx, v.id, { filters: { labels: ["x"] } }))).toBe("VALIDATION");
    expect(errorCode(() => updateView(ctx, v.id, { logo: { icon: "A", color: "magenta" } as never }))).toBe("VALIDATION");
    expect(errorCode(() => updateView(ctx, newId(), { name: "x" }))).toBe("NOT_FOUND");
    expect(getView(ctx, v.id)).toEqual(v);
  });
});

describe("lockView and unlockView", () => {
  it("toggle is_locked and log locked and unlocked", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    const lockedView = lockView(ctx, v.id);
    expect(lockedView.is_locked).toBe(true);
    expect(getView(ctx, v.id).is_locked).toBe(true);
    const unlocked = unlockView(ctx, v.id);
    expect(unlocked.is_locked).toBe(false);
    expect(activityRows(ctx, v.id).map((r) => r.verb)).toEqual(["created", "locked", "unlocked"]);
    expect(activityRows(ctx, v.id)[1]).toMatchObject({ new_identifier: "V", project_id: projectId });
  });

  it("locked views reject every change except unlock with LOCKED", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    lockView(ctx, v.id);
    const seqBefore = latestSeq(ctx);
    expect(errorCode(() => updateView(ctx, v.id, { name: "Renamed" }))).toBe("LOCKED");
    expect(errorCode(() => updateView(ctx, v.id, { description: "x" }))).toBe("LOCKED");
    expect(errorCode(() => lockView(ctx, v.id))).toBe("LOCKED");
    expect(errorCode(() => deleteView(ctx, v.id))).toBe("LOCKED");
    expect(latestSeq(ctx)).toBe(seqBefore);
    expect(getView(ctx, v.id)).toMatchObject({ name: "V", is_locked: true, deleted_at: null });
    expect(unlockView(ctx, v.id).is_locked).toBe(false);
    expect(updateView(ctx, v.id, { name: "Renamed" }).name).toBe("Renamed");
  });

  it("unlocking a view that is not locked is a RULE error", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    expect(ruleName(() => unlockView(ctx, v.id))).toBe("not_locked");
    expect(errorCode(() => lockView(ctx, newId()))).toBe("NOT_FOUND");
    expect(errorCode(() => unlockView(ctx, newId()))).toBe("NOT_FOUND");
  });

  it("a locked view can still be duplicated and the copy is unlocked", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    lockView(ctx, v.id);
    const copy = duplicateView(ctx, v.id);
    expect(copy.is_locked).toBe(false);
    expect(copy.name).toBe("Copy of V");
    expect(getView(ctx, v.id).is_locked).toBe(true);
  });
});

describe("duplicateView", () => {
  it('names the copy "Copy of <name>" and copies description, filters, rich_filters, display and logo', () => {
    const { ctx, projectId } = setup();
    const source = createView(ctx, {
      project_id: projectId,
      name: "Open bugs",
      description: "Bugs",
      filters: { priority: ["high"] },
      rich_filters: RICH,
      display: { layout: "board", group_by: "state" },
      logo: { icon: "Bug", color: "red" },
    });
    const seqBefore = latestSeq(ctx);
    const copy = duplicateView(ctx, source.id);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(`${COPY_NAME_PREFIX}Open bugs`);
    expect(copy.name_key).toBe("copy of open bugs");
    expect(copy.project_id).toBe(projectId);
    expect(copy.description).toBe("Bugs");
    expect(copy.filters).toEqual(source.filters);
    expect(copy.rich_filters).toEqual(RICH);
    expect(copy.display).toEqual(source.display);
    expect(copy.logo).toEqual(source.logo);
    expect(copy.is_locked).toBe(false);
    expect(copy.sort_order > source.sort_order).toBe(true);
    const rows = activityRows(ctx, copy.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verb: "copied", old_value: source.id, old_identifier: "Open bugs", new_identifier: "Copy of Open bugs" });
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
    expect(listViews(ctx, { project_id: projectId }).map((v) => v.id)).toEqual([source.id, copy.id]);
  });

  it('numbers the copy "Copy of <name> (2)", "(3)" when the name is taken', () => {
    const { ctx, projectId } = setup();
    const source = createView(ctx, { project_id: projectId, name: "Open" });
    expect(duplicateView(ctx, source.id).name).toBe("Copy of Open");
    expect(duplicateView(ctx, source.id).name).toBe("Copy of Open (2)");
    createView(ctx, { project_id: projectId, name: "copy of open (3)" });
    expect(duplicateView(ctx, source.id).name).toBe("Copy of Open (4)");
  });

  it("fits the copy name into the 120 character limit", () => {
    const { ctx, projectId } = setup();
    const longName = "x".repeat(120);
    const source = createView(ctx, { project_id: projectId, name: longName });
    const first = duplicateView(ctx, source.id);
    expect(first.name).toHaveLength(120);
    expect(first.name.startsWith(`${COPY_NAME_PREFIX}xxx`)).toBe(true);
    const second = duplicateView(ctx, source.id);
    expect(second.name).toHaveLength(120);
    expect(second.name.endsWith(" (2)")).toBe(true);
  });

  it("duplicates workspace views as workspace views and reports NOT_FOUND for unknown ids", () => {
    const { ctx } = setup();
    const w = createView(ctx, { project_id: null, name: "W" });
    const copy = duplicateView(ctx, w.id);
    expect(copy.project_id).toBeNull();
    expect(copy.display.layout).toBe("table");
    expect(listViews(ctx, { project_id: null }).map((v) => v.name)).toEqual(["W", "Copy of W"]);
    expect(errorCode(() => duplicateView(ctx, newId()))).toBe("NOT_FOUND");
  });
});

describe("deleteView", () => {
  it("soft-deletes the view, logs deleted and hides it from reads", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    const keep = createView(ctx, { project_id: projectId, name: "Keep" });
    deleteView(ctx, v.id);
    expect(rawRow(ctx, v.id).deleted_at).not.toBeNull();
    expect(errorCode(() => getView(ctx, v.id))).toBe("NOT_FOUND");
    expect(errorCode(() => deleteView(ctx, v.id))).toBe("NOT_FOUND");
    expect(errorCode(() => updateView(ctx, v.id, { name: "x" }))).toBe("NOT_FOUND");
    expect(listViews(ctx, { project_id: projectId }).map((x) => x.id)).toEqual([keep.id]);
    expect(activityRows(ctx, v.id).at(-1)).toMatchObject({ verb: "deleted", old_identifier: "V", project_id: projectId });
  });
});

describe("archived project", () => {
  it("every project view mutation is refused with ARCHIVED while workspace views stay writable", () => {
    const { ctx, projectId } = setup();
    const v = createView(ctx, { project_id: projectId, name: "V" });
    const lockedView: View = lockView(ctx, createView(ctx, { project_id: projectId, name: "L" }).id);
    const w = createView(ctx, { project_id: null, name: "W" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => createView(ctx, { project_id: projectId, name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateView(ctx, v.id, { name: "X" }))).toBe("ARCHIVED");
    expect(errorCode(() => duplicateView(ctx, v.id))).toBe("ARCHIVED");
    expect(errorCode(() => lockView(ctx, v.id))).toBe("ARCHIVED");
    expect(errorCode(() => unlockView(ctx, lockedView.id))).toBe("ARCHIVED");
    expect(errorCode(() => deleteView(ctx, v.id))).toBe("ARCHIVED");
    expect(listViews(ctx, { project_id: projectId })).toHaveLength(2);
    expect(updateView(ctx, w.id, { name: "W2" }).name).toBe("W2");
  });
});
