import { describe, expect, it } from "vitest";
import { addRelation, listRelations, removeRelation } from "@/lib/tessera/relations";
import { activity } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

describe("relations", () => {
  it("shows the inverse type on the other item", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const a = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const b = createWorkItem(ctx, { project_id: project.id, name: "Session" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: b.id, relation_type: "blocked_by" });
    expect(listRelations(ctx, a.id).map((row) => row.relation_type)).toEqual(["blocked_by"]);
    expect(listRelations(ctx, b.id).map((row) => row.relation_type)).toEqual(["blocking"]);
  });

  it("logs a removal on both items with the display type from each side (decision 55)", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const a = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const b = createWorkItem(ctx, { project_id: project.id, name: "Session" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: b.id, relation_type: "blocked_by" });
    removeRelation(ctx, a.id, b.id);
    const removed = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.verb === "removed" && row.entity_type === "work_item");
    const byItem = new Map(removed.map((row) => [row.work_item_id, row]));
    expect(removed).toHaveLength(2);
    expect(byItem.get(a.id)).toMatchObject({ field: "blocked_by", old_value: b.id, old_identifier: "WEB-2", project_id: project.id });
    expect(byItem.get(b.id)).toMatchObject({ field: "blocking", old_value: a.id, old_identifier: "WEB-1", project_id: project.id });
  });

  it("logs a replaced type as removed + added on both items", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const a = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const b = createWorkItem(ctx, { project_id: project.id, name: "Session" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: b.id, relation_type: "blocked_by" });
    addRelation(ctx, { work_item_id: a.id, related_work_item_id: b.id, relation_type: "relates_to" });
    const rows = ctx.db
      .select()
      .from(activity)
      .all()
      .filter((row) => row.work_item_id === a.id && (row.verb === "added" || row.verb === "removed"));
    expect(rows.map((row) => [row.verb, row.field])).toEqual([
      ["added", "blocked_by"],
      ["removed", "blocked_by"],
      ["added", "relates_to"],
    ]);
  });
});
