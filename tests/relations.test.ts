import { describe, expect, it } from "vitest";
import { addRelation, listRelations } from "@/lib/tessera/relations";
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
});
