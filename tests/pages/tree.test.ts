import { describe, expect, it } from "vitest";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createPage, getPage, listPages, movePage } from "@/lib/tessera/pages";
import { createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { createTestContext, createTestDb } from "../helpers/db";

function setup() {
  const ctx = createTestContext(createTestDb());
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: project.id };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

describe("pages", () => {
  it("creates a wiki page and a project page, and lists the wiki in tree order", () => {
    const { ctx, projectId } = setup();
    const root = createPage(ctx, { project_id: null, name: "Getting started" });
    const child = createPage(ctx, { project_id: null, parent_id: root.id, name: "Onboarding" });
    createPage(ctx, { project_id: projectId, name: "Spec" });
    const wiki = listPages(ctx, { project_id: null });
    expect(wiki.map((page) => page.name)).toEqual(["Getting started", "Onboarding"]);
    expect(getPage(ctx, child.id).ancestors.map((item) => item.name)).toEqual(["Getting started"]);
    expect(listPages(ctx, { project_id: projectId }).map((page) => page.name)).toEqual(["Spec"]);
  });

  it("refuses a parent in another space and a move into a project with Pages off", () => {
    const { ctx, projectId } = setup();
    const wiki = createPage(ctx, { project_id: null, name: "Note" });
    const spec = createPage(ctx, { project_id: projectId, name: "Spec" });
    expect(code(() => createPage(ctx, { project_id: null, parent_id: spec.id, name: "Child" }))).toBe("VALIDATION");
    updateProjectFeatures(ctx, projectId, { pages_enabled: false });
    expect(code(() => movePage(ctx, { page_id: wiki.id, project_id: projectId }))).toBe("RULE");
    expect(code(() => createPage(ctx, { project_id: projectId, name: "Later" }))).toBe("RULE");
  });

  it("refuses moving a page under its own child", () => {
    const { ctx } = setup();
    const root = createPage(ctx, { project_id: null, name: "Root" });
    const child = createPage(ctx, { project_id: null, parent_id: root.id, name: "Child" });
    expect(code(() => movePage(ctx, { page_id: root.id, parent_id: child.id }))).toBe("VALIDATION");
  });
});
