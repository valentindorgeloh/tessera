/**
 * Project frame tabs (src/components/work-items/project-tabs.ts): which tabs
 * the feature toggles show, in which order, and which one a path selects.
 */
import { describe, expect, it } from "vitest";
import { activeProjectTab, projectTabs } from "@/components/work-items/project-tabs";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";
const CYCLE = "33333333-3333-7333-8333-333333333333";

const ALL = { cycles_enabled: true, modules_enabled: true };

describe("projectTabs", () => {
  it("lists Work items, Cycles, Modules and Archives when both features are on", () => {
    expect(projectTabs(ALL)).toEqual([
      { key: "work-items", label: "Work items", segment: "work-items" },
      { key: "cycles", label: "Cycles", segment: "cycles" },
      { key: "modules", label: "Modules", segment: "modules" },
      { key: "archives", label: "Archives", segment: "archives" },
    ]);
  });

  it("leaves out a feature that is turned off and always keeps Archives", () => {
    expect(projectTabs({ cycles_enabled: false, modules_enabled: true }).map((tab) => tab.key)).toEqual(["work-items", "modules", "archives"]);
    expect(projectTabs({ cycles_enabled: true, modules_enabled: false }).map((tab) => tab.key)).toEqual(["work-items", "cycles", "archives"]);
    expect(projectTabs({ cycles_enabled: false, modules_enabled: false }).map((tab) => tab.key)).toEqual(["work-items", "archives"]);
  });
});

describe("activeProjectTab", () => {
  const tabs = projectTabs(ALL);

  it("selects the tab of the first segment, on lists and on detail routes", () => {
    expect(activeProjectTab(`/projects/${PROJECT}/work-items`, PROJECT, tabs)?.key).toBe("work-items");
    expect(activeProjectTab(`/projects/${PROJECT}/work-items/${OTHER}`, PROJECT, tabs)?.key).toBe("work-items");
    expect(activeProjectTab(`/projects/${PROJECT}/cycles`, PROJECT, tabs)?.key).toBe("cycles");
    expect(activeProjectTab(`/projects/${PROJECT}/cycles/${CYCLE}`, PROJECT, tabs)?.key).toBe("cycles");
    expect(activeProjectTab(`/projects/${PROJECT}/modules/`, PROJECT, tabs)?.key).toBe("modules");
    expect(activeProjectTab(`/projects/${PROJECT}/archives/cycles`, PROJECT, tabs)?.key).toBe("archives");
  });

  it("selects the first tab on the project root", () => {
    expect(activeProjectTab(`/projects/${PROJECT}`, PROJECT, tabs)?.key).toBe("work-items");
    expect(activeProjectTab(`/projects/${PROJECT}/`, PROJECT, tabs)?.key).toBe("work-items");
  });

  it("selects no tab on a route of a disabled feature, an unknown section or another project", () => {
    const noCycles = projectTabs({ cycles_enabled: false, modules_enabled: true });
    expect(activeProjectTab(`/projects/${PROJECT}/cycles`, PROJECT, noCycles)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}/cycles/${CYCLE}`, PROJECT, noCycles)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}/settings`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab(`/projects/${OTHER}/work-items`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}x/work-items`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab("/projects/archives", PROJECT, tabs)).toBeNull();
  });
});
