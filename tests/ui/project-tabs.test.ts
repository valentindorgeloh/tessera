/**
 * Project frame tabs (src/components/work-items/project-tabs.ts): which tabs
 * the feature toggles show, in which order, and which one a path selects.
 */
import { describe, expect, it } from "vitest";
import { activeProjectTab, projectTabs } from "@/components/work-items/project-tabs";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";
const CYCLE = "33333333-3333-7333-8333-333333333333";

const ALL = { cycles_enabled: true, modules_enabled: true, views_enabled: true, pages_enabled: true };

describe("projectTabs", () => {
  it("lists Work items, Cycles, Modules, Views, Archives and Settings when every feature is on", () => {
    expect(projectTabs(ALL)).toEqual([
      { key: "work-items", label: "Work items", segment: "work-items" },
      { key: "cycles", label: "Cycles", segment: "cycles" },
      { key: "modules", label: "Modules", segment: "modules" },
      { key: "views", label: "Views", segment: "views" },
      { key: "pages", label: "Pages", segment: "pages" },
      { key: "archives", label: "Archives", segment: "archives" },
      { key: "settings", label: "Settings", segment: "settings" },
    ]);
  });

  it("leaves out a feature that is turned off and always keeps Archives and Settings", () => {
    const keys = (toggles: Parameters<typeof projectTabs>[0]) => projectTabs(toggles).map((tab) => tab.key);
    expect(keys({ ...ALL, cycles_enabled: false })).toEqual(["work-items", "modules", "views", "pages", "archives", "settings"]);
    expect(keys({ ...ALL, modules_enabled: false })).toEqual(["work-items", "cycles", "views", "pages", "archives", "settings"]);
    expect(keys({ ...ALL, views_enabled: false })).toEqual(["work-items", "cycles", "modules", "pages", "archives", "settings"]);
    expect(keys({ ...ALL, pages_enabled: false })).toEqual(["work-items", "cycles", "modules", "views", "archives", "settings"]);
    expect(keys({ cycles_enabled: false, modules_enabled: false, views_enabled: false, pages_enabled: false })).toEqual(["work-items", "archives", "settings"]);
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
    expect(activeProjectTab(`/projects/${PROJECT}/views`, PROJECT, tabs)?.key).toBe("views");
    expect(activeProjectTab(`/projects/${PROJECT}/views/${OTHER}`, PROJECT, tabs)?.key).toBe("views");
  });

  it("selects Settings on the settings index and every settings tab", () => {
    expect(activeProjectTab(`/projects/${PROJECT}/settings`, PROJECT, tabs)?.key).toBe("settings");
    expect(activeProjectTab(`/projects/${PROJECT}/settings/general`, PROJECT, tabs)?.key).toBe("settings");
    expect(activeProjectTab(`/projects/${PROJECT}/settings/states`, PROJECT, tabs)?.key).toBe("settings");
  });

  it("selects the first tab on the project root", () => {
    expect(activeProjectTab(`/projects/${PROJECT}`, PROJECT, tabs)?.key).toBe("work-items");
    expect(activeProjectTab(`/projects/${PROJECT}/`, PROJECT, tabs)?.key).toBe("work-items");
  });

  it("selects no tab on a route of a disabled feature, an unknown section or another project", () => {
    const noCycles = projectTabs({ ...ALL, cycles_enabled: false });
    expect(activeProjectTab(`/projects/${PROJECT}/cycles`, PROJECT, noCycles)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}/cycles/${CYCLE}`, PROJECT, noCycles)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}/views`, PROJECT, projectTabs({ ...ALL, views_enabled: false }))).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}/intake`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab(`/projects/${OTHER}/work-items`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab(`/projects/${PROJECT}x/work-items`, PROJECT, tabs)).toBeNull();
    expect(activeProjectTab("/projects/archives", PROJECT, tabs)).toBeNull();
  });
});
