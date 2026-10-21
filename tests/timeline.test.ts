/**
 * Gantt extras of listWorkItems (decisions 90 and 92): `include_date_range`
 * (dateRangeOf in work-items/timeline.ts) and `include_relations`.
 */
import { describe, expect, it } from "vitest";
import { createProject, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { addRelation } from "@/lib/tessera/relations";
import { archiveWorkItem, createWorkItem, deleteWorkItem, listWorkItems, updateWorkItem } from "@/lib/tessera/work-items";
import { dateRangeOf } from "@/lib/tessera/work-items/timeline";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

function setup(): { ctx: TesseraContext; web: Project; api: Project } {
  const ctx = createTestContext(createTestDb());
  return {
    ctx,
    web: createProject(ctx, { name: "Web", identifier: "WEB" }),
    api: createProject(ctx, { name: "API", identifier: "API" }),
  };
}

const rangeOf = (ctx: TesseraContext, project: Project, extra: Record<string, unknown> = {}) =>
  listWorkItems(ctx, { scope: { type: "project", project_id: project.id }, include_date_range: true, ...extra }).date_range;

describe("include_date_range", () => {
  it("is absent unless asked for", () => {
    const { ctx, web } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "A", target_date: "2026-10-10" });
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: web.id } }).date_range).toBeUndefined();
  });

  it("is null on both ends when no item has a date", () => {
    const { ctx, web } = setup();
    expect(rangeOf(ctx, web)).toEqual({ start: null, end: null });
    createWorkItem(ctx, { project_id: web.id, name: "Undated" });
    expect(rangeOf(ctx, web)).toEqual({ start: null, end: null });
  });

  it("takes the earliest and latest of start and target dates together", () => {
    const { ctx, web } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "Spans", start_date: "2026-10-05", target_date: "2026-10-20" });
    createWorkItem(ctx, { project_id: web.id, name: "Target only, earliest", target_date: "2026-09-30" });
    createWorkItem(ctx, { project_id: web.id, name: "Start only, latest", start_date: "2026-11-02" });
    createWorkItem(ctx, { project_id: web.id, name: "Undated" });
    expect(rangeOf(ctx, web)).toEqual({ start: "2026-09-30", end: "2026-11-02" });
  });

  it("covers the whole filtered set whichever page is returned", () => {
    const { ctx, web } = setup();
    for (let day = 1; day <= 9; day += 1) {
      createWorkItem(ctx, { project_id: web.id, name: `Item ${day}`, target_date: `2026-10-0${day}` });
    }
    const page = listWorkItems(ctx, { scope: { type: "project", project_id: web.id }, include_date_range: true, limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.date_range).toEqual({ start: "2026-10-01", end: "2026-10-09" });
    const second = listWorkItems(ctx, { scope: { type: "project", project_id: web.id }, include_date_range: true, limit: 2, offset: 2 });
    expect(second.date_range).toEqual(page.date_range);
  });

  it("follows the filters", () => {
    const { ctx, web } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "Urgent", priority: "urgent", target_date: "2026-10-12" });
    createWorkItem(ctx, { project_id: web.id, name: "Low", priority: "low", target_date: "2026-12-24" });
    expect(rangeOf(ctx, web)).toEqual({ start: "2026-10-12", end: "2026-12-24" });
    expect(rangeOf(ctx, web, { filters: { priority: ["urgent"] } })).toEqual({ start: "2026-10-12", end: "2026-10-12" });
  });

  it("leaves out archived and deleted items", () => {
    const { ctx, web } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "Kept", target_date: "2026-10-12" });
    const archived = createWorkItem(ctx, { project_id: web.id, name: "Archived", target_date: "2027-01-01" });
    const deleted = createWorkItem(ctx, { project_id: web.id, name: "Deleted", start_date: "2025-01-01" });
    const done = listStates(ctx, web.id).find((row) => row.state_group === "completed");
    updateWorkItem(ctx, archived.id, { state_id: done?.id });
    archiveWorkItem(ctx, archived.id);
    deleteWorkItem(ctx, deleted.id);
    expect(rangeOf(ctx, web)).toEqual({ start: "2026-10-12", end: "2026-10-12" });
  });

  it("stays inside the project scope and spans projects in the workspace scope", () => {
    const { ctx, web, api } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "Web", target_date: "2026-10-12" });
    createWorkItem(ctx, { project_id: api.id, name: "API", start_date: "2026-08-01", target_date: "2026-08-15" });
    expect(rangeOf(ctx, web)).toEqual({ start: "2026-10-12", end: "2026-10-12" });
    expect(listWorkItems(ctx, { scope: { type: "workspace" }, include_date_range: true }).date_range).toEqual({ start: "2026-08-01", end: "2026-10-12" });
  });

  it("also comes with a group-paged list", () => {
    const { ctx, web } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "A", target_date: "2026-10-12" });
    createWorkItem(ctx, { project_id: web.id, name: "B", start_date: "2026-10-01" });
    const result = listWorkItems(ctx, { scope: { type: "project", project_id: web.id }, display: { group_by: "state" }, per_group_limit: 1, include_date_range: true });
    expect(result.date_range).toEqual({ start: "2026-10-01", end: "2026-10-12" });
  });

  it("dateRangeOf with no predicate reads every row", () => {
    const { ctx, web, api } = setup();
    createWorkItem(ctx, { project_id: web.id, name: "A", target_date: "2026-10-12" });
    createWorkItem(ctx, { project_id: api.id, name: "B", target_date: "2026-03-03" });
    expect(dateRangeOf(ctx, undefined)).toEqual({ start: "2026-03-03", end: "2026-10-12" });
  });
});

describe("include_relations", () => {
  it("lists relations in canonical direction with one end loaded and the other in the filtered set", () => {
    const { ctx, web } = setup();
    const a = createWorkItem(ctx, { project_id: web.id, name: "A", priority: "high" });
    const b = createWorkItem(ctx, { project_id: web.id, name: "B", priority: "high" });
    const c = createWorkItem(ctx, { project_id: web.id, name: "C", priority: "low" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: b.id, relation_type: "blocked_by" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: c.id, relation_type: "relates_to" });
    const all = listWorkItems(ctx, { scope: { type: "project", project_id: web.id }, include_relations: true });
    expect(all.relations).toHaveLength(2);
    expect(all.relations).toContainEqual({ from_id: a.id, to_id: b.id, type: "blocked_by" });
    // C is outside the priority filter, so its edge to A is not part of this list.
    const filtered = listWorkItems(ctx, { scope: { type: "project", project_id: web.id }, filters: { priority: ["high"] }, include_relations: true });
    expect(filtered.relations).toEqual([{ from_id: a.id, to_id: b.id, type: "blocked_by" }]);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: web.id } }).relations).toBeUndefined();
  });
});
