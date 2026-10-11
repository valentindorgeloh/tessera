/**
 * Pure tab model of the shell (src/components/shell/tab-registry.ts):
 * route → label/icon resolution and the add / activate / close / reorder
 * reducers the TabBar dispatches.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_TABS,
  activateTab,
  addTab,
  closeOtherTabs,
  closeTab,
  isTransientPath,
  isTypingTarget,
  labelTabs,
  lookupFromNames,
  normalizePath,
  parseTabsState,
  projectNameMap,
  reorderTab,
  resolveTab,
  type TabLookup,
  type TabsState,
} from "@/components/shell/tab-registry";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";

const lookup: TabLookup = {
  projectName: (id) => (id === PROJECT ? "Website" : undefined),
};

function state(paths: string[], active: string | null = paths[paths.length - 1] ?? null): TabsState {
  return { tabs: paths.map((path) => ({ path })), active };
}

describe("normalizePath", () => {
  it("strips query, hash and trailing slashes", () => {
    expect(normalizePath("/projects/")).toBe("/projects");
    expect(normalizePath(`/projects/${PROJECT}/work-items?create=1`)).toBe(`/projects/${PROJECT}/work-items`);
    expect(normalizePath("/home#top")).toBe("/home");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("home")).toBe("/home");
  });
});

describe("resolveTab", () => {
  it("resolves the workspace routes", () => {
    expect(resolveTab("/home", lookup)).toEqual({ label: "Home", icon: "home" });
    expect(resolveTab("/projects", lookup)).toEqual({ label: "Projects", icon: "projects" });
  });

  it("resolves the project routes with the project name", () => {
    expect(resolveTab(`/projects/${PROJECT}`, lookup)).toEqual({ label: "Website", icon: "projects" });
    expect(resolveTab(`/projects/${PROJECT}/work-items`, lookup)).toEqual({
      label: "Website · Work items",
      icon: "work-items",
    });
    expect(resolveTab(`/projects/${PROJECT}/work-items/${ITEM}`, lookup)).toEqual({
      label: "Website · Work item",
      icon: "work-item",
    });
  });

  it("uses the work item label when the lookup knows it", () => {
    const withItems: TabLookup = { ...lookup, workItemLabel: (id) => (id === ITEM ? "WEB-1" : undefined) };
    expect(resolveTab(`/projects/${PROJECT}/work-items/${ITEM}`, withItems).label).toBe("Website · WEB-1");
  });

  it("falls back to a generic project name for unknown ids", () => {
    expect(resolveTab("/projects/unknown/work-items", lookup)).toEqual({
      label: "Project · Work items",
      icon: "work-items",
    });
  });

  it("gives later project sections a readable label without code changes", () => {
    expect(resolveTab(`/projects/${PROJECT}/cycles`, lookup)).toEqual({ label: "Website · Cycles", icon: "page" });
    expect(resolveTab(`/projects/${PROJECT}/work-items/`, lookup).icon).toBe("work-items");
  });

  it("falls back to the first segment for unknown routes", () => {
    expect(resolveTab("/your-work/assigned", lookup)).toEqual({ label: "Your work", icon: "page" });
    expect(resolveTab("/", lookup)).toEqual({ label: "Home", icon: "home" });
  });

  it("labels the global detail route with the registered work item label", () => {
    expect(resolveTab(`/work-items/${ITEM}`, lookup)).toEqual({ label: "Work item", icon: "work-item" });
    const withItems: TabLookup = { ...lookup, workItemLabel: (id) => (id === ITEM ? "WEB-1 Set up hosting" : undefined) };
    expect(resolveTab(`/work-items/${ITEM}`, withItems)).toEqual({ label: "WEB-1 Set up hosting", icon: "work-item" });
    expect(resolveTab(`/work-items/${ITEM}/`, withItems).label).toBe("WEB-1 Set up hosting");
    // Without an id the route is not a detail; it keeps the generic first-segment label.
    expect(resolveTab("/work-items", withItems)).toEqual({ label: "Work items", icon: "page" });
  });

  it("labels the browse route with the upper-cased key", () => {
    expect(resolveTab("/browse/web-1", lookup)).toEqual({ label: "WEB-1", icon: "work-item" });
    expect(resolveTab("/browse/WEB-12?x=1", lookup).label).toBe("WEB-12");
    expect(resolveTab("/browse/web%2D7", lookup).label).toBe("WEB-7");
    expect(resolveTab("/browse", lookup)).toEqual({ label: "Browse", icon: "page" });
  });
});

describe("addTab", () => {
  it("appends a new path and activates it", () => {
    const next = addTab(EMPTY_TABS, "/home");
    expect(next).toEqual(state(["/home"]));
    expect(addTab(next, "/projects")).toEqual(state(["/home", "/projects"]));
  });

  it("activates an existing path instead of duplicating it", () => {
    const base = state(["/home", "/projects"], "/projects");
    const next = addTab(base, "/home");
    expect(next.tabs).toEqual(base.tabs);
    expect(next.active).toBe("/home");
  });

  it("normalises the path and returns the same state when nothing changes", () => {
    const base = state(["/home"]);
    expect(addTab(base, "/home/")).toBe(base);
    expect(addTab(base, "/projects?x=1").tabs.map((tab) => tab.path)).toEqual(["/home", "/projects"]);
  });

  it("gives a /browse tab's slot to the route that follows it (the redirect target)", () => {
    const base = state(["/home", "/browse/WEB-1", "/projects"], "/browse/WEB-1");
    const next = addTab(base, "/projects/p1/work-items/w1");
    expect(next).toEqual(state(["/home", "/projects/p1/work-items/w1", "/projects"], "/projects/p1/work-items/w1"));
  });

  it("drops /browse tabs when the next route already has a tab or the alias is not active", () => {
    const open = state(["/home", "/projects/p1/work-items/w1", "/browse/web-1"], "/browse/web-1");
    expect(addTab(open, "/projects/p1/work-items/w1")).toEqual(state(["/home", "/projects/p1/work-items/w1"], "/projects/p1/work-items/w1"));
    const restored = state(["/browse/NOPE-9", "/home"], "/home");
    expect(addTab(restored, "/projects")).toEqual(state(["/home", "/projects"], "/projects"));
    expect(isTransientPath("/browse/WEB-1/")).toBe(true);
    expect(isTransientPath("/work-items/w1")).toBe(false);
  });
});

describe("activateTab", () => {
  it("switches the active tab and ignores unknown paths", () => {
    const base = state(["/home", "/projects"], "/projects");
    expect(activateTab(base, "/home").active).toBe("/home");
    expect(activateTab(base, "/nowhere")).toBe(base);
    expect(activateTab(base, "/projects")).toBe(base);
  });
});

describe("closeTab", () => {
  const base = state(["/home", "/projects", `/projects/${PROJECT}/work-items`], "/projects");

  it("removes the path and keeps the active tab when another one was closed", () => {
    const next = closeTab(base, "/home");
    expect(next.tabs.map((tab) => tab.path)).toEqual(["/projects", `/projects/${PROJECT}/work-items`]);
    expect(next.active).toBe("/projects");
  });

  it("activates the left neighbour when the active tab closes", () => {
    const next = closeTab(base, "/projects");
    expect(next.active).toBe("/home");
  });

  it("activates the right neighbour when the first tab was active", () => {
    const next = closeTab(state(["/home", "/projects"], "/home"), "/home");
    expect(next).toEqual(state(["/projects"], "/projects"));
  });

  it("leaves active null when the last tab closes", () => {
    expect(closeTab(state(["/home"]), "/home")).toEqual({ tabs: [], active: null });
  });

  it("ignores unknown paths", () => {
    expect(closeTab(base, "/nowhere")).toBe(base);
  });
});

describe("closeOtherTabs", () => {
  it("keeps only the given tab and activates it", () => {
    const base = state(["/home", "/projects", "/x"], "/x");
    expect(closeOtherTabs(base, "/projects")).toEqual(state(["/projects"], "/projects"));
  });

  it("ignores unknown paths and is a no-op for a lone active tab", () => {
    const base = state(["/home"]);
    expect(closeOtherTabs(base, "/nowhere")).toBe(base);
    expect(closeOtherTabs(base, "/home")).toBe(base);
  });
});

describe("reorderTab", () => {
  const base = state(["/a", "/b", "/c"], "/c");

  it("moves a tab forwards and backwards", () => {
    expect(reorderTab(base, 0, 2).tabs.map((tab) => tab.path)).toEqual(["/b", "/c", "/a"]);
    expect(reorderTab(base, 2, 0).tabs.map((tab) => tab.path)).toEqual(["/c", "/a", "/b"]);
    expect(reorderTab(base, 0, 2).active).toBe("/c");
  });

  it("ignores out-of-range or identical indexes", () => {
    expect(reorderTab(base, 0, 0)).toBe(base);
    expect(reorderTab(base, -1, 1)).toBe(base);
    expect(reorderTab(base, 0, 3)).toBe(base);
    expect(reorderTab(base, 0.5, 1)).toBe(base);
  });
});

describe("parseTabsState", () => {
  it("accepts a well-formed stored value", () => {
    expect(parseTabsState({ tabs: [{ path: "/home" }, { path: "/projects" }], active: "/projects" })).toEqual(
      state(["/home", "/projects"], "/projects"),
    );
  });

  it("drops malformed and duplicate entries and repairs the active tab", () => {
    const parsed = parseTabsState({
      tabs: [{ path: "/home" }, { path: "/home/" }, { path: "relative" }, 42, { path: "/projects" }],
      active: "/gone",
    });
    expect(parsed).toEqual(state(["/home", "/projects"], "/home"));
  });

  it("rejects values that are not a tabs object", () => {
    expect(parseTabsState(null)).toBeNull();
    expect(parseTabsState("tabs")).toBeNull();
    expect(parseTabsState({ tabs: "nope" })).toBeNull();
    expect(parseTabsState({ tabs: [] })).toEqual({ tabs: [], active: null });
  });
});

describe("isTypingTarget", () => {
  it("is true for inputs, textareas, selects and contenteditable elements", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for other elements and for no target", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("projectNameMap and lookupFromNames", () => {
  it("builds a lookup from project rows", () => {
    const names = projectNameMap([
      { id: PROJECT, name: "Website" },
      { id: "p2", name: "Mobile app" },
    ]);
    expect(names).toEqual({ [PROJECT]: "Website", p2: "Mobile app" });
    const fromNames = lookupFromNames(names);
    expect(fromNames.projectName(PROJECT)).toBe("Website");
    expect(fromNames.projectName("p2")).toBe("Mobile app");
  });

  it("resolves ids the map does not hold to undefined, including inherited keys", () => {
    const fromNames = lookupFromNames(projectNameMap([]));
    expect(fromNames.projectName("missing")).toBeUndefined();
    expect(fromNames.projectName("constructor")).toBeUndefined();
    expect(resolveTab("/projects/missing/work-items", fromNames).label).toBe("Project · Work items");
  });
});

describe("labelTabs", () => {
  const stored = state(["/home", `/projects/${PROJECT}/work-items`, `/projects/${PROJECT}/work-items/${ITEM}`]);

  it("labels stored tabs from the current lookup, keeping their paths and order", () => {
    const labelled = labelTabs(stored, lookup);
    expect(labelled.map((tab) => tab.path)).toEqual(stored.tabs.map((tab) => tab.path));
    expect(labelled.map((tab) => tab.label)).toEqual(["Home", "Website · Work items", "Website · Work item"]);
    expect(labelled.map((tab) => tab.icon)).toEqual(["home", "work-items", "work-item"]);
  });

  it("relabels the same stored tabs when the lookup changes", () => {
    expect(labelTabs(stored, lookupFromNames({})).map((tab) => tab.label)).toEqual(["Home", "Project · Work items", "Project · Work item"]);
    expect(labelTabs(stored, lookupFromNames({ [PROJECT]: "Marketing site" })).map((tab) => tab.label)).toEqual([
      "Home",
      "Marketing site · Work items",
      "Marketing site · Work item",
    ]);
  });

  it("returns no tabs for an empty state", () => {
    expect(labelTabs(EMPTY_TABS, lookup)).toEqual([]);
  });
});
