import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { getCounts } from "@/lib/tessera/counts";
import { createProject, type Project } from "@/lib/tessera/projects";
import { createView } from "@/lib/tessera/views";
import { createWorkItem, listWorkItems } from "@/lib/tessera/work-items";
import { createTestDb } from "./helpers/db";

function setup(): { ctx: TesseraContext; project: Project } {
  const handles = createTestDb();
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => "2026-10-10T12:00:00.000Z", today: () => "2026-10-10" });
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, project };
}

describe("rich filters", () => {
  it("ANDs a tree with the list and the view count", () => {
    const { ctx, project } = setup();
    createWorkItem(ctx, { project_id: project.id, name: "Urgent bug", priority: "urgent" });
    createWorkItem(ctx, { project_id: project.id, name: "Low chore", priority: "low" });
    const tree = { or: [{ field: "priority" as const, op: "eq" as const, value: "urgent" }, { field: "name" as const, op: "contains" as const, value: "chore" }] };
    const listed = listWorkItems(ctx, { scope: { type: "project", project_id: project.id }, rich_filters: tree });
    expect(listed.total).toBe(2);
    const view = createView(ctx, { project_id: project.id, name: "Open", rich_filters: { and: [{ field: "priority", op: "eq", value: "urgent" }] } });
    const fromView = listWorkItems(ctx, { scope: { type: "view", view_id: view.id } });
    expect(fromView.total).toBe(1);
    expect(fromView.items[0]?.name).toBe("Urgent bug");
    expect(getCounts(ctx, { type: "view", view_id: view.id }).total).toBe(1);
    const cleared = listWorkItems(ctx, { scope: { type: "view", view_id: view.id }, rich_filters: null });
    expect(cleared.total).toBe(2);
  });

  it("rejects a bad operator and a tree past the depth limit", () => {
    const { ctx, project } = setup();
    expect(() => createView(ctx, { project_id: project.id, name: "Bad", rich_filters: { and: [{ field: "name", op: "in", value: ["a"] }] } })).toThrow(TrackerError);
    const deep = { and: [{ or: [{ and: [{ or: [{ and: [{ field: "priority", op: "eq", value: "low" }] }] }] }] }] };
    expect(() => createView(ctx, { project_id: project.id, name: "Deep", rich_filters: deep })).toThrow(TrackerError);
  });

  it("keeps a name that starts with = as a contains miss and matches blocked items", () => {
    const { ctx, project } = setup();
    const item = createWorkItem(ctx, { project_id: project.id, name: "=SUM(1,2)", priority: "none" });
    const named = listWorkItems(ctx, { scope: { type: "project", project_id: project.id }, rich_filters: { and: [{ field: "name", op: "eq", value: "=SUM(1,2)" }] } });
    expect(named.items.map((row) => row.id)).toEqual([item.id]);
    const blocked = listWorkItems(ctx, { scope: { type: "project", project_id: project.id }, rich_filters: { and: [{ field: "blocked", op: "eq", value: true }] } });
    expect(blocked.total).toBe(0);
  });
});
