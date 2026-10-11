/**
 * Pure recents model of the shell (src/components/shell/recents.ts): route →
 * label/icon resolution, the visit reducer and the stored-list parser that
 * Home's recents and Power K's "Recent" group read.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RECENTS,
  addRecent,
  isRecordable,
  isTransientPath,
  labelRecents,
  lookupFromNames,
  normalizePath,
  parseRecents,
  projectIdFromPath,
  projectNameMap,
  resolveRoute,
  type RouteLookup,
} from "@/components/shell/recents";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";

const lookup: RouteLookup = {
  projectName: (id) => (id === PROJECT ? "Website" : undefined),
};

const LIST = `/projects/${PROJECT}/work-items`;
const DETAIL = `/projects/${PROJECT}/work-items/${ITEM}`;

describe("normalizePath", () => {
  it("strips query, hash and trailing slashes", () => {
    expect(normalizePath("/projects/")).toBe("/projects");
    expect(normalizePath(`${LIST}?create=1`)).toBe(LIST);
    expect(normalizePath("/home#top")).toBe("/home");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("home")).toBe("/home");
  });
});

describe("projectIdFromPath", () => {
  it("reads the project segment of project routes only", () => {
    expect(projectIdFromPath(LIST)).toBe(PROJECT);
    expect(projectIdFromPath(`/projects/${PROJECT}`)).toBe(PROJECT);
    expect(projectIdFromPath(`/projects/${PROJECT}?peek=1`)).toBe(PROJECT);
    expect(projectIdFromPath("/projects")).toBeNull();
    expect(projectIdFromPath(`/work-items/${ITEM}`)).toBeNull();
    expect(projectIdFromPath("/home")).toBeNull();
  });
});

describe("resolveRoute", () => {
  it("resolves the workspace routes", () => {
    expect(resolveRoute("/home", lookup)).toEqual({ label: "Home", icon: "home" });
    expect(resolveRoute("/projects", lookup)).toEqual({ label: "Projects", icon: "projects" });
  });

  it("resolves the project routes with the project name", () => {
    expect(resolveRoute(`/projects/${PROJECT}`, lookup)).toEqual({ label: "Website", icon: "projects" });
    expect(resolveRoute(`/projects/${PROJECT}/work-items`, lookup)).toEqual({
      label: "Website · Work items",
      icon: "work-items",
    });
    expect(resolveRoute(`/projects/${PROJECT}/work-items/${ITEM}`, lookup)).toEqual({
      label: "Website · Work item",
      icon: "work-item",
    });
  });

  it("uses the work item label when the lookup knows it", () => {
    const withItems: RouteLookup = { ...lookup, workItemLabel: (id) => (id === ITEM ? "WEB-1" : undefined) };
    expect(resolveRoute(`/projects/${PROJECT}/work-items/${ITEM}`, withItems).label).toBe("Website · WEB-1");
  });

  it("falls back to a generic project name for unknown ids", () => {
    expect(resolveRoute("/projects/unknown/work-items", lookup)).toEqual({
      label: "Project · Work items",
      icon: "work-items",
    });
  });

  it("gives later project sections a readable label without code changes", () => {
    expect(resolveRoute(`/projects/${PROJECT}/cycles`, lookup)).toEqual({ label: "Website · Cycles", icon: "page" });
    expect(resolveRoute(`/projects/${PROJECT}/work-items/`, lookup).icon).toBe("work-items");
  });

  it("falls back to the first segment for unknown routes", () => {
    expect(resolveRoute("/your-work/assigned", lookup)).toEqual({ label: "Your work", icon: "page" });
    expect(resolveRoute("/", lookup)).toEqual({ label: "Home", icon: "home" });
  });

  it("labels the global detail route with the registered work item label", () => {
    expect(resolveRoute(`/work-items/${ITEM}`, lookup)).toEqual({ label: "Work item", icon: "work-item" });
    const withItems: RouteLookup = { ...lookup, workItemLabel: (id) => (id === ITEM ? "WEB-1 Set up hosting" : undefined) };
    expect(resolveRoute(`/work-items/${ITEM}`, withItems)).toEqual({ label: "WEB-1 Set up hosting", icon: "work-item" });
    expect(resolveRoute(`/work-items/${ITEM}/`, withItems).label).toBe("WEB-1 Set up hosting");
    // Without an id the route is not a detail; it keeps the generic first-segment label.
    expect(resolveRoute("/work-items", withItems)).toEqual({ label: "Work items", icon: "page" });
  });

  it("labels the browse route with the upper-cased key", () => {
    expect(resolveRoute("/browse/web-1", lookup)).toEqual({ label: "WEB-1", icon: "work-item" });
    expect(resolveRoute("/browse/WEB-12?x=1", lookup).label).toBe("WEB-12");
    expect(resolveRoute("/browse/web%2D7", lookup).label).toBe("WEB-7");
    expect(resolveRoute("/browse", lookup)).toEqual({ label: "Browse", icon: "page" });
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
    expect(resolveRoute("/projects/missing/work-items", fromNames).label).toBe("Project · Work items");
  });
});

describe("isTransientPath and isRecordable", () => {
  it("treats the redirect aliases as transient", () => {
    expect(isTransientPath("/browse/WEB-1")).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}`)).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}/`)).toBe(true);
    expect(isTransientPath(LIST)).toBe(false);
    expect(isTransientPath("/projects")).toBe(false);
  });

  it("never records Home, the root or a redirect alias", () => {
    expect(isRecordable("/home")).toBe(false);
    expect(isRecordable("/")).toBe(false);
    expect(isRecordable("/browse/WEB-1")).toBe(false);
    expect(isRecordable(`/projects/${PROJECT}`)).toBe(false);
    expect(isRecordable("/projects")).toBe(true);
    expect(isRecordable(DETAIL)).toBe(true);
    expect(isRecordable(`/work-items/${ITEM}`)).toBe(true);
  });
});

describe("addRecent", () => {
  it("puts a new visit first", () => {
    expect(addRecent([], LIST)).toEqual([LIST]);
    expect(addRecent([LIST], DETAIL)).toEqual([DETAIL, LIST]);
  });

  it("moves a repeated visit to the front instead of listing it twice", () => {
    expect(addRecent([DETAIL, "/projects", LIST], LIST)).toEqual([LIST, DETAIL, "/projects"]);
  });

  it("normalizes the path, so query strings and trailing slashes share one entry", () => {
    expect(addRecent([LIST], `${DETAIL}/?peek=x`)).toEqual([DETAIL, LIST]);
    expect(addRecent([DETAIL, LIST], `${LIST}?q=abc`)).toEqual([LIST, DETAIL]);
  });

  it("returns the same list when nothing changes, so callers skip the write", () => {
    const recents = [LIST, DETAIL];
    expect(addRecent(recents, LIST)).toBe(recents);
    expect(addRecent(recents, "/home")).toBe(recents);
    expect(addRecent(recents, "/browse/WEB-1")).toBe(recents);
    expect(addRecent(recents, `/projects/${PROJECT}`)).toBe(recents);
  });

  it("keeps at most `max` entries, dropping the oldest", () => {
    const many = Array.from({ length: MAX_RECENTS }, (_, index) => `/page-${index}`);
    const next = addRecent(many, LIST);
    expect(next).toHaveLength(MAX_RECENTS);
    expect(next[0]).toBe(LIST);
    expect(next).not.toContain(`/page-${MAX_RECENTS - 1}`);
    expect(addRecent(["/a", "/b"], "/c", 2)).toEqual(["/c", "/a"]);
  });
});

describe("parseRecents", () => {
  it("reads a stored list of paths, newest first", () => {
    expect(parseRecents([DETAIL, LIST])).toEqual([DETAIL, LIST]);
  });

  it("drops malformed, duplicate and unrecordable entries", () => {
    expect(parseRecents([LIST, 42, null, "relative", `${LIST}/`, "/home", "/browse/WEB-1", { path: DETAIL }, DETAIL])).toEqual([LIST, DETAIL]);
  });

  it("caps the list and rejects anything that is not an array", () => {
    const many = Array.from({ length: MAX_RECENTS + 5 }, (_, index) => `/page-${index}`);
    expect(parseRecents(many)).toHaveLength(MAX_RECENTS);
    expect(parseRecents({ recents: [LIST] })).toEqual([]);
    expect(parseRecents("nope")).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });
});

describe("labelRecents", () => {
  const stored = [DETAIL, LIST, "/projects"];

  it("labels stored recents from the current lookup, keeping their paths and order", () => {
    const labelled = labelRecents(stored, lookup);
    expect(labelled.map((recent) => recent.path)).toEqual(stored);
    expect(labelled.map((recent) => recent.label)).toEqual(["Website · Work item", "Website · Work items", "Projects"]);
    expect(labelled.map((recent) => recent.icon)).toEqual(["work-item", "work-items", "projects"]);
  });

  it("relabels the same recents when the lookup changes", () => {
    expect(labelRecents(stored, lookupFromNames({})).map((recent) => recent.label)).toEqual(["Project · Work item", "Project · Work items", "Projects"]);
    const named = { ...lookupFromNames({ [PROJECT]: "Marketing site" }), workItemLabel: (id: string) => (id === ITEM ? "WEB-1 Hero" : undefined) };
    expect(labelRecents(stored, named).map((recent) => recent.label)).toEqual(["Marketing site · WEB-1 Hero", "Marketing site · Work items", "Projects"]);
  });

  it("returns nothing for an empty list", () => {
    expect(labelRecents([], lookup)).toEqual([]);
  });
});
