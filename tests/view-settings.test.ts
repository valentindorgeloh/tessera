import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, cycle, view_settings } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, ViewSettingsScope } from "@/lib/tessera/types";
import {
  DISPLAY_PROPERTY_KEYS,
  defaultViewSettings,
  getViewSettings,
  mergeDisplay,
  mergeFilters,
  resetViewSettings,
  saveViewSettings,
  WORKSPACE_SCOPE_ID,
} from "@/lib/tessera/view-settings";
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

function rawRow(ctx: TesseraContext, scopeType: ViewSettingsScope, scopeId: string) {
  return ctx.db
    .select()
    .from(view_settings)
    .where(and(eq(view_settings.scope_type, scopeType), eq(view_settings.scope_id, scopeId)))
    .get();
}

function activityRows(ctx: TesseraContext, entityId: string) {
  return ctx.db.select().from(activity).where(eq(activity.entity_id, entityId)).orderBy(activity.seq).all();
}

function insertCycle(ctx: TesseraContext, projectId: string): string {
  const now = ctx.now();
  return ctx.db
    .insert(cycle)
    .values({
      id: newId(),
      project_id: projectId,
      name: "Sprint 1",
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
    })
    .returning()
    .get().id;
}

describe("getViewSettings", () => {
  it("returns empty filters and DEFAULT_DISPLAY when no row exists, for every scope", () => {
    const { ctx, projectId } = setup();
    expect(getViewSettings(ctx, "project", projectId)).toEqual({ filters: {}, display: DEFAULT_DISPLAY });
    expect(getViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID)).toEqual({ filters: {}, display: DEFAULT_DISPLAY });
    expect(getViewSettings(ctx, "profile", ctx.actor.id)).toEqual(defaultViewSettings());
    expect(rawRow(ctx, "project", projectId)).toBeUndefined();
  });

  it("returns fresh objects so callers cannot mutate the defaults", () => {
    const { ctx, projectId } = setup();
    const first = getViewSettings(ctx, "project", projectId);
    first.display.layout = "board";
    first.filters.priority = ["high"];
    expect(getViewSettings(ctx, "project", projectId)).toEqual({ filters: {}, display: DEFAULT_DISPLAY });
    expect(DEFAULT_DISPLAY.layout).toBe("list");
  });

  it("validates scope_type and scope_id and requires scope_id workspace for the workspace scope", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => getViewSettings(ctx, "galaxy" as ViewSettingsScope, projectId))).toBe("VALIDATION");
    expect(errorCode(() => getViewSettings(ctx, "project", " "))).toBe("VALIDATION");
    expect(errorCode(() => getViewSettings(ctx, "workspace", projectId))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "workspace", "", {}))).toBe("VALIDATION");
    expect(errorCode(() => resetViewSettings(ctx, "workspace", "all"))).toBe("VALIDATION");
    expect(getViewSettings(ctx, "workspace", "workspace").display.layout).toBe("list");
  });

  it("parses stored JSON through the schemas, filling display defaults", () => {
    const { ctx, projectId } = setup();
    const partialDisplay = { layout: "board" } as Display;
    ctx.db
      .insert(view_settings)
      .values({ scope_type: "project", scope_id: projectId, filters: { priority: ["high"] }, display: partialDisplay, updated_at: ctx.now() })
      .run();
    expect(getViewSettings(ctx, "project", projectId)).toEqual({ filters: { priority: ["high"] }, display: { ...DEFAULT_DISPLAY, layout: "board" } });
  });
});

describe("saveViewSettings", () => {
  it("inserts the row for a new scope and returns the merged settings", () => {
    const { ctx, projectId } = setup();
    const saved = saveViewSettings(ctx, "project", projectId, { filters: { priority: ["high"] }, display: { layout: "board" } });
    expect(saved).toEqual({ filters: { priority: ["high"] }, display: { ...DEFAULT_DISPLAY, layout: "board" } });
    expect(getViewSettings(ctx, "project", projectId)).toEqual(saved);
    const row = rawRow(ctx, "project", projectId);
    expect(row?.filters).toEqual({ priority: ["high"] });
    expect(row?.updated_at).toBeTruthy();
  });

  it("merges the given filters over the stored ones; an empty list clears one key", () => {
    const { ctx, projectId } = setup();
    saveViewSettings(ctx, "project", projectId, { filters: { priority: ["high"], state_group: ["started"] } });
    const merged = saveViewSettings(ctx, "project", projectId, { filters: { priority: ["urgent"], search: "login" } });
    expect(merged.filters).toEqual({ priority: ["urgent"], state_group: ["started"], search: "login" });
    const cleared = saveViewSettings(ctx, "project", projectId, { filters: { state_group: [] } });
    expect(cleared.filters).toEqual({ priority: ["urgent"], state_group: [], search: "login" });
    expect(getViewSettings(ctx, "project", projectId).filters).toEqual(cleared.filters);
  });

  it("merges the given display over the stored one, one level deep for calendar and properties", () => {
    const { ctx, projectId } = setup();
    saveViewSettings(ctx, "project", projectId, {
      display: { layout: "board", group_by: "state", calendar: { layout: "week" }, properties: { key: false, links: false } },
    });
    const merged = saveViewSettings(ctx, "project", projectId, {
      display: { order_by: "-created_at", calendar: { show_weekends: false }, properties: { key: true } },
    });
    expect(merged.display).toEqual({
      ...DEFAULT_DISPLAY,
      layout: "board",
      group_by: "state",
      order_by: "-created_at",
      calendar: { layout: "week", show_weekends: false },
      properties: { ...DEFAULT_DISPLAY.properties, key: true, links: false },
    });
    expect(getViewSettings(ctx, "project", projectId).display).toEqual(merged.display);
  });

  it("an empty save creates the row with defaults and a save without changes is harmless", () => {
    const { ctx, projectId } = setup();
    expect(saveViewSettings(ctx, "project", projectId, {})).toEqual(defaultViewSettings());
    expect(rawRow(ctx, "project", projectId)?.display).toEqual(DEFAULT_DISPLAY);
    expect(saveViewSettings(ctx, "project", projectId, { display: {} })).toEqual(defaultViewSettings());
  });

  it("validates filters and display through the schemas and rejects unknown keys", () => {
    const { ctx, projectId } = setup();
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { filters: { priority: ["critical"] } as never }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { filters: { labels: ["x"] } }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { display: { layout: "grid" } as never }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { display: { group_by: "colour" } as never }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { display: { calendar: { layout: "year" } } as never }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { display: { properties: { bogus: true } } as never }))).toBe("VALIDATION");
    expect(errorCode(() => saveViewSettings(ctx, "project", projectId, { layout: "board" } as never))).toBe("VALIDATION");
    expect(rawRow(ctx, "project", projectId)).toBeUndefined();
  });

  it("keys rows by (scope_type, scope_id) so scopes never bleed into each other", () => {
    const { ctx, projectId } = setup();
    const other = createProject(ctx, { name: "Other", identifier: "OTH" });
    saveViewSettings(ctx, "project", projectId, { display: { layout: "board" } });
    saveViewSettings(ctx, "project", other.id, { display: { layout: "table" } });
    saveViewSettings(ctx, "archived", projectId, { display: { layout: "calendar" } });
    saveViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID, { filters: { priority: ["urgent"] } });
    expect(getViewSettings(ctx, "project", projectId).display.layout).toBe("board");
    expect(getViewSettings(ctx, "project", other.id).display.layout).toBe("table");
    expect(getViewSettings(ctx, "archived", projectId).display.layout).toBe("calendar");
    expect(getViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID)).toEqual({ filters: { priority: ["urgent"] }, display: DEFAULT_DISPLAY });
    expect(ctx.db.select().from(view_settings).all()).toHaveLength(4);
  });

  it("logs one activity row per changed field and none when nothing changed", () => {
    const { ctx, projectId } = setup();
    const entityId = `project:${projectId}`;
    const seqBefore = latestSeq(ctx);
    saveViewSettings(ctx, "project", projectId, { filters: { priority: ["high"] }, display: { layout: "board" } });
    const rows = activityRows(ctx, entityId);
    expect(rows.map((r) => r.field)).toEqual(["filters", "display"]);
    expect(rows[0]).toMatchObject({ entity_type: "view_settings", verb: "updated", project_id: projectId, old_value: "{}", new_value: JSON.stringify({ priority: ["high"] }) });
    expect(rows[1]).toMatchObject({ old_value: JSON.stringify(DEFAULT_DISPLAY), new_value: JSON.stringify({ ...DEFAULT_DISPLAY, layout: "board" }) });
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    saveViewSettings(ctx, "project", projectId, { filters: { priority: ["high"] }, display: { layout: "board" } });
    expect(latestSeq(ctx)).toBe(seqBefore + 2);
    saveViewSettings(ctx, "project", projectId, { display: { sub_items: false } });
    expect(latestSeq(ctx)).toBe(seqBefore + 3);
    expect(activityRows(ctx, entityId).at(-1)?.field).toBe("display");
  });

  it("stamps the project on activity for project, archived, cycle and module scopes and null elsewhere", () => {
    const { ctx, projectId } = setup();
    const cycleId = insertCycle(ctx, projectId);
    saveViewSettings(ctx, "cycle", cycleId, { display: { layout: "board" } });
    saveViewSettings(ctx, "archived", projectId, { display: { layout: "board" } });
    saveViewSettings(ctx, "module", newId(), { display: { layout: "board" } });
    saveViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID, { display: { layout: "table" } });
    saveViewSettings(ctx, "profile", ctx.actor.id, { display: { layout: "table" } });
    expect(activityRows(ctx, `cycle:${cycleId}`)[0].project_id).toBe(projectId);
    expect(activityRows(ctx, `archived:${projectId}`)[0].project_id).toBe(projectId);
    expect(activityRows(ctx, `workspace:${WORKSPACE_SCOPE_ID}`)[0].project_id).toBeNull();
    expect(activityRows(ctx, `profile:${ctx.actor.id}`)[0].project_id).toBeNull();
    expect(ctx.db.select().from(activity).all().filter((r) => r.entity_type === "view_settings")).toHaveLength(5);
  });

  it("tolerates a project scope whose project does not exist (settings are not tied to a row)", () => {
    const { ctx } = setup();
    const ghost = newId();
    expect(saveViewSettings(ctx, "project", ghost, { display: { layout: "board" } }).display.layout).toBe("board");
    expect(activityRows(ctx, `project:${ghost}`)[0].project_id).toBeNull();
  });
});

describe("resetViewSettings", () => {
  it("deletes the row, logs deleted and returns the defaults", () => {
    const { ctx, projectId } = setup();
    saveViewSettings(ctx, "project", projectId, { filters: { priority: ["high"] }, display: { layout: "board" } });
    const seqBefore = latestSeq(ctx);
    expect(resetViewSettings(ctx, "project", projectId)).toEqual(defaultViewSettings());
    expect(rawRow(ctx, "project", projectId)).toBeUndefined();
    expect(getViewSettings(ctx, "project", projectId)).toEqual({ filters: {}, display: DEFAULT_DISPLAY });
    expect(latestSeq(ctx)).toBe(seqBefore + 1);
    expect(activityRows(ctx, `project:${projectId}`).at(-1)).toMatchObject({ verb: "deleted", entity_type: "view_settings", project_id: projectId });
  });

  it("is a no-op without a row and leaves other scopes alone", () => {
    const { ctx, projectId } = setup();
    saveViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID, { display: { layout: "table" } });
    const seqBefore = latestSeq(ctx);
    expect(resetViewSettings(ctx, "project", projectId)).toEqual(defaultViewSettings());
    expect(latestSeq(ctx)).toBe(seqBefore);
    expect(getViewSettings(ctx, "workspace", WORKSPACE_SCOPE_ID).display.layout).toBe("table");
  });
});

describe("merge helpers", () => {
  it("mergeDisplay ignores undefined values and returns a complete Display", () => {
    const base: Display = { ...DEFAULT_DISPLAY, layout: "board", group_by: "state" };
    const merged = mergeDisplay(base, { layout: undefined, group_by: null, properties: {} });
    expect(merged).toEqual({ ...DEFAULT_DISPLAY, layout: "board", group_by: null });
    expect(merged).not.toBe(base);
    expect(mergeDisplay(DEFAULT_DISPLAY, {})).toEqual(DEFAULT_DISPLAY);
  });

  it("mergeDisplay drops a sub-group equal to the group or without a group", () => {
    expect(mergeDisplay(DEFAULT_DISPLAY, { group_by: "state", sub_group_by: "state" }).sub_group_by).toBeNull();
    expect(mergeDisplay(DEFAULT_DISPLAY, { group_by: null, sub_group_by: "priority" }).sub_group_by).toBeNull();
    expect(mergeDisplay(DEFAULT_DISPLAY, { group_by: "state", sub_group_by: "priority" })).toMatchObject({ group_by: "state", sub_group_by: "priority" });
    const stored: Display = { ...DEFAULT_DISPLAY, group_by: "state", sub_group_by: "priority" };
    expect(mergeDisplay(stored, { group_by: "priority" }).sub_group_by).toBeNull();
    expect(mergeDisplay(stored, { group_by: null }).sub_group_by).toBeNull();
  });

  it("mergeFilters overrides key by key and drops unknown keys", () => {
    expect(mergeFilters({ priority: ["high"], search: "a" }, { search: "b", bogus: 1 } as never)).toEqual({ priority: ["high"], search: "b" });
  });

  it("DISPLAY_PROPERTY_KEYS lists every display property", () => {
    expect([...DISPLAY_PROPERTY_KEYS].sort()).toEqual(Object.keys(DEFAULT_DISPLAY.properties).sort());
  });
});
