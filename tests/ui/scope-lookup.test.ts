/**
 * Lookup order of the cycle, module and view pages
 * (src/app/(tessera)/projects/[projectId]/scope-lookup.ts): the id is looked up
 * before the project's feature toggle, so an unknown, deleted or foreign id is
 * "missing" (the page answers notFound(), and the shell never records the path
 * as a recent) with the feature on or off, and only a real record of a project
 * with the feature turned off reaches the feature-off state (decision 31).
 */
import { describe, expect, it } from "vitest";
import { lookupScoped } from "@/app/(tessera)/projects/[projectId]/scope-lookup";
import { createCycle, deleteCycle, getCycle } from "@/lib/tessera/cycles";
import { createModule, deleteModule, getModule } from "@/lib/tessera/modules";
import { createProject, getProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { createView, deleteView, getView } from "@/lib/tessera/views";
import { createTestContext, createTestDb } from "../helpers/db";

const UNKNOWN = "99999999-9999-7999-8999-999999999999";

function setup() {
  const ctx = createTestContext(createTestDb());
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const other = createProject(ctx, { name: "Docs", identifier: "DOC" });
  return { ctx, project, other };
}

describe("lookupScoped for a cycle", () => {
  function lookup(ctx: ReturnType<typeof setup>["ctx"], projectId: string, cycleId: string) {
    return lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.cycles_enabled,
      load: () => getCycle(ctx, cycleId),
      projectIdOf: (cycle) => cycle.project_id,
    });
  }

  it("finds a cycle of the project while cycles are on", () => {
    const { ctx, project } = setup();
    const cycle = createCycle(ctx, { project_id: project.id, name: "Sprint 1" });
    expect(lookup(ctx, project.id, cycle.id)).toMatchObject({ kind: "found", value: { id: cycle.id } });
  });

  it("is missing for an unknown, a deleted and a foreign cycle with cycles on", () => {
    const { ctx, project, other } = setup();
    const gone = createCycle(ctx, { project_id: project.id, name: "Gone" });
    deleteCycle(ctx, gone.id);
    const foreign = createCycle(ctx, { project_id: other.id, name: "Elsewhere" });
    expect(lookup(ctx, project.id, UNKNOWN).kind).toBe("missing");
    expect(lookup(ctx, project.id, gone.id).kind).toBe("missing");
    expect(lookup(ctx, project.id, foreign.id).kind).toBe("missing");
  });

  it("is missing for an unknown, a deleted and a foreign cycle with cycles off, and feature_off only for a real one", () => {
    const { ctx, project, other } = setup();
    const real = createCycle(ctx, { project_id: project.id, name: "Real" });
    const gone = createCycle(ctx, { project_id: project.id, name: "Gone" });
    deleteCycle(ctx, gone.id);
    const foreign = createCycle(ctx, { project_id: other.id, name: "Elsewhere" });
    updateProjectFeatures(ctx, project.id, { cycles_enabled: false });
    expect(lookup(ctx, project.id, UNKNOWN).kind).toBe("missing");
    expect(lookup(ctx, project.id, gone.id).kind).toBe("missing");
    expect(lookup(ctx, project.id, foreign.id).kind).toBe("missing");
    expect(lookup(ctx, project.id, real.id).kind).toBe("feature_off");
  });

  it("still throws for an unknown project (the page maps it to notFound)", () => {
    const { ctx } = setup();
    expect(() => lookup(ctx, UNKNOWN, UNKNOWN)).toThrow();
  });
});

describe("lookupScoped for a module", () => {
  function lookup(ctx: ReturnType<typeof setup>["ctx"], projectId: string, moduleId: string) {
    return lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.modules_enabled,
      load: () => getModule(ctx, moduleId),
      projectIdOf: (loaded) => loaded.project_id,
    });
  }

  it("orders the lookup before the toggle", () => {
    const { ctx, project, other } = setup();
    const real = createModule(ctx, { project_id: project.id, name: "Auth" });
    const gone = createModule(ctx, { project_id: project.id, name: "Gone" });
    deleteModule(ctx, gone.id);
    const foreign = createModule(ctx, { project_id: other.id, name: "Billing" });
    expect(lookup(ctx, project.id, real.id).kind).toBe("found");
    updateProjectFeatures(ctx, project.id, { modules_enabled: false });
    expect(lookup(ctx, project.id, real.id).kind).toBe("feature_off");
    for (const id of [UNKNOWN, gone.id, foreign.id]) expect(lookup(ctx, project.id, id).kind).toBe("missing");
  });
});

describe("lookupScoped for a view", () => {
  function lookup(ctx: ReturnType<typeof setup>["ctx"], projectId: string, viewId: string) {
    return lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.views_enabled,
      load: () => getView(ctx, viewId),
      projectIdOf: (view) => view.project_id,
    });
  }

  it("orders the lookup before the toggle, and a workspace view is not a project's", () => {
    const { ctx, project, other } = setup();
    const real = createView(ctx, { project_id: project.id, name: "Mine" });
    const gone = createView(ctx, { project_id: project.id, name: "Gone" });
    deleteView(ctx, gone.id);
    const foreign = createView(ctx, { project_id: other.id, name: "Theirs" });
    const workspace = createView(ctx, { project_id: null, name: "Everywhere" });
    expect(lookup(ctx, project.id, real.id).kind).toBe("found");
    updateProjectFeatures(ctx, project.id, { views_enabled: false });
    expect(lookup(ctx, project.id, real.id).kind).toBe("feature_off");
    for (const id of [UNKNOWN, gone.id, foreign.id, workspace.id]) expect(lookup(ctx, project.id, id).kind).toBe("missing");
  });
});
