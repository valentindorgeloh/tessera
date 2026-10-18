import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { createProject } from "@/lib/tessera/projects";
import { reorderProject } from "@/lib/tessera/projects-order";
import { listProjects } from "@/lib/tessera/projects";
import { createTestDb } from "./helpers/db";

describe("reorder project", () => {
  it("places a project before another and keeps the order", () => {
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const web = createProject(ctx, { name: "Web", identifier: "WEB" });
    const ops = createProject(ctx, { name: "Ops", identifier: "OPS" });
    reorderProject(ctx, ops.id, { after_id: web.id });
    expect(listProjects(ctx).map((project) => project.id)).toEqual([ops.id, web.id]);
  });
});
