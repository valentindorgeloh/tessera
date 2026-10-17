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
  isSameRecent,
  isTransientPath,
  labelRecents,
  lookupFromNames,
  normalizePath,
  onScreenPaths,
  otherRecents,
  parseRecents,
  projectIdFromPath,
  projectNameMap,
  removeRecentsUnder,
  resolveRoute,
  type RouteLookup,
} from "@/components/shell/recents";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
const CYCLE = "33333333-3333-7333-8333-333333333333";
const MODULE = "44444444-4444-7444-8444-444444444444";

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
    expect(projectIdFromPath(`/projects/${PROJECT}/archives/cycles`)).toBe(PROJECT);
    expect(projectIdFromPath("/projects")).toBeNull();
    expect(projectIdFromPath("/projects/")).toBeNull();
    expect(projectIdFromPath(`/work-items/${ITEM}`)).toBeNull();
    expect(projectIdFromPath(`/cycles/${CYCLE}`)).toBeNull();
    expect(projectIdFromPath("/home")).toBeNull();
  });

  it("never treats the archived projects page as a project", () => {
    expect(projectIdFromPath("/projects/archives")).toBeNull();
    expect(projectIdFromPath("/projects/archives/")).toBeNull();
    expect(projectIdFromPath("/projects/archives?peek=1")).toBeNull();
    expect(projectIdFromPath("/projects/archives#top")).toBeNull();
    // Only the exact segment is guarded; an id that starts with the word is still an id.
    expect(projectIdFromPath("/projects/archives-2024/work-items")).toBe("archives-2024");
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
    expect(resolveRoute(`/projects/${PROJECT}/settings`, lookup)).toEqual({ label: "Website · Settings", icon: "page" });
    expect(resolveRoute(`/projects/${PROJECT}/work-items/`, lookup).icon).toBe("work-items");
  });

  it("labels the cycles and modules routes, with the registered entity name on a detail", () => {
    expect(resolveRoute(`/projects/${PROJECT}/cycles`, lookup)).toEqual({ label: "Website · Cycles", icon: "cycles" });
    expect(resolveRoute(`/projects/${PROJECT}/cycles/${CYCLE}`, lookup)).toEqual({ label: "Website · Cycle", icon: "cycle" });
    expect(resolveRoute(`/projects/${PROJECT}/modules`, lookup)).toEqual({ label: "Website · Modules", icon: "modules" });
    expect(resolveRoute(`/projects/${PROJECT}/modules/${MODULE}`, lookup)).toEqual({ label: "Website · Module", icon: "module" });
    const names: Record<string, string> = { [CYCLE]: "Sprint 1", [MODULE]: "Launch" };
    const withEntities: RouteLookup = { ...lookup, entityLabel: (id) => names[id] };
    expect(resolveRoute(`/projects/${PROJECT}/cycles/${CYCLE}?peek=x`, withEntities).label).toBe("Website · Sprint 1");
    expect(resolveRoute(`/projects/${PROJECT}/modules/${MODULE}/`, withEntities).label).toBe("Website · Launch");
    // The list routes keep their section label even when an entity label exists.
    expect(resolveRoute(`/projects/${PROJECT}/cycles`, withEntities).label).toBe("Website · Cycles");
  });

  it("labels the project archives and the archived projects page", () => {
    expect(resolveRoute(`/projects/${PROJECT}/archives`, lookup)).toEqual({ label: "Website · Archives", icon: "archives" });
    // Each archives tab has its own label, so three archives recents never read as one repeated entry.
    expect(resolveRoute(`/projects/${PROJECT}/archives/work-items`, lookup)).toEqual({ label: "Website · Archived work items", icon: "archives" });
    expect(resolveRoute(`/projects/${PROJECT}/archives/cycles`, lookup)).toEqual({ label: "Website · Archived cycles", icon: "archives" });
    expect(resolveRoute(`/projects/${PROJECT}/archives/modules?peek=x`, lookup).label).toBe("Website · Archived modules");
    expect(resolveRoute(`/projects/${PROJECT}/archives/other`, lookup).label).toBe("Website · Archives");
    expect(resolveRoute("/projects/archives", lookup)).toEqual({ label: "Archived projects", icon: "archives" });
    expect(resolveRoute("/projects/archives/", lookup).label).toBe("Archived projects");
    // Checked before the project lookup, so a lookup that knows "archives" cannot rename it.
    const odd: RouteLookup = { projectName: () => "Archives project" };
    expect(resolveRoute("/projects/archives", odd).label).toBe("Archived projects");
  });

  it("labels the cycle and module alias routes", () => {
    expect(resolveRoute(`/cycles/${CYCLE}`, lookup)).toEqual({ label: "Cycle", icon: "cycle" });
    expect(resolveRoute(`/modules/${MODULE}`, lookup)).toEqual({ label: "Module", icon: "module" });
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

  it("treats the cycle and module aliases as transient, not the project routes", () => {
    expect(isTransientPath(`/cycles/${CYCLE}`)).toBe(true);
    expect(isTransientPath(`/modules/${MODULE}/`)).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}/cycles/${CYCLE}`)).toBe(false);
    expect(isTransientPath(`/projects/${PROJECT}/modules`)).toBe(false);
  });

  it("treats the archives index as transient, not the archive lists or the archived projects page", () => {
    expect(isTransientPath(`/projects/${PROJECT}/archives`)).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}/archives/`)).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}/archives/work-items`)).toBe(false);
    expect(isTransientPath("/projects/archives")).toBe(false);
    expect(isTransientPath("/projects/archives/")).toBe(false);
  });

  it("treats the project index as transient: it only redirects to the work items", () => {
    expect(isTransientPath(`/projects/${PROJECT}`)).toBe(true);
    expect(isTransientPath(`/projects/${PROJECT}/`)).toBe(true);
    expect(isTransientPath("/projects")).toBe(false);
    expect(isTransientPath(LIST)).toBe(false);
  });

  it("never records Home, the root or a redirect alias", () => {
    expect(isRecordable("/home")).toBe(false);
    expect(isRecordable("/")).toBe(false);
    expect(isRecordable("/browse/WEB-1")).toBe(false);
    expect(isRecordable(`/projects/${PROJECT}`)).toBe(false);
    expect(isRecordable(`/cycles/${CYCLE}`)).toBe(false);
    expect(isRecordable(`/modules/${MODULE}`)).toBe(false);
    expect(isRecordable(`/projects/${PROJECT}/archives`)).toBe(false);
    expect(isRecordable("/projects")).toBe(true);
    expect(isRecordable("/projects/archives")).toBe(true);
    expect(isRecordable(`/projects/${PROJECT}/archives/work-items`)).toBe(true);
    expect(isRecordable(`/projects/${PROJECT}/cycles/${CYCLE}`)).toBe(true);
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
    expect(addRecent(recents, `/cycles/${CYCLE}`)).toBe(recents);
    expect(addRecent(recents, `/modules/${MODULE}`)).toBe(recents);
    expect(addRecent(recents, `/projects/${PROJECT}/archives`)).toBe(recents);
  });

  it("records the page an alias lands on, never the alias", () => {
    const cycle = `/projects/${PROJECT}/cycles/${CYCLE}`;
    expect(addRecent(addRecent([LIST], `/cycles/${CYCLE}`), cycle)).toEqual([cycle, LIST]);
    const archived = `/projects/${PROJECT}/archives/work-items`;
    expect(addRecent(addRecent([LIST], `/projects/${PROJECT}/archives`), archived)).toEqual([archived, LIST]);
    expect(addRecent([LIST], "/projects/archives")).toEqual(["/projects/archives", LIST]);
  });

  it("keeps one entry per work item: a visit to its global route replaces its project route, and back", () => {
    const global = `/work-items/${ITEM}`;
    expect(addRecent([DETAIL, LIST], global)).toEqual([global, LIST]);
    expect(addRecent([LIST, global], DETAIL)).toEqual([DETAIL, LIST]);
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

describe("removeRecentsUnder", () => {
  it("drops the path and the routes under it", () => {
    expect(removeRecentsUnder([DETAIL, "/projects", LIST], LIST)).toEqual(["/projects"]);
    expect(removeRecentsUnder([DETAIL, LIST], `${DETAIL}/`)).toEqual([LIST]);
  });

  it("keeps routes that only share a prefix, and returns the same list when nothing goes", () => {
    const recents = [`${LIST}-archive`, LIST];
    expect(removeRecentsUnder(recents, `${LIST}-archive`)).toEqual([LIST]);
    expect(removeRecentsUnder(recents, DETAIL)).toBe(recents);
  });

  it("removes a deleted cycle and the routes below it, keeping its siblings", () => {
    const list = `/projects/${PROJECT}/cycles`;
    const cycle = `${list}/${CYCLE}`;
    const sibling = `${list}/${CYCLE}0`;
    expect(removeRecentsUnder(["/projects", list, cycle, `${cycle}/extra`, sibling], `${cycle}/`)).toEqual(["/projects", list, sibling]);
  });

  it("drops every route of a deleted or archived project, not the archived projects page", () => {
    const recents = ["/projects", LIST, `/projects/${PROJECT}/cycles/${CYCLE}`, "/projects/archives", DETAIL];
    expect(removeRecentsUnder(recents, `/projects/${PROJECT}`)).toEqual(["/projects", "/projects/archives"]);
    const none = ["/projects"];
    expect(removeRecentsUnder(none, `/projects/${PROJECT}/cycles/${CYCLE}`)).toBe(none);
  });
});

describe("onScreenPaths and otherRecents", () => {
  it("is the page, plus the peeked item's full page inside a project", () => {
    expect(onScreenPaths(`${LIST}/`, null)).toEqual([LIST]);
    expect(onScreenPaths(LIST, ITEM)).toEqual([LIST, DETAIL]);
    expect(onScreenPaths(`/projects/${PROJECT}/cycles/c1`, ITEM)).toEqual([`/projects/${PROJECT}/cycles/c1`, DETAIL]);
    expect(onScreenPaths("/projects", ITEM)).toEqual(["/projects"]);
    // The archived projects page is no project, so a stray peek param names no item there.
    expect(onScreenPaths("/projects/archives", ITEM)).toEqual(["/projects/archives"]);
    expect(onScreenPaths(`/projects/${PROJECT}/archives/work-items`, ITEM)).toEqual([`/projects/${PROJECT}/archives/work-items`, DETAIL]);
  });

  it("leaves the routes on screen out and caps what is left", () => {
    const recents = [DETAIL, LIST, "/projects", "/a", "/b"].map((path) => ({ path }));
    expect(otherRecents(recents, onScreenPaths(LIST, ITEM), 2).map((recent) => recent.path)).toEqual(["/projects", "/a"]);
    expect(otherRecents(recents, ["/elsewhere"], 10)).toHaveLength(5);
  });

  it("treats the project and global routes of one work item as the same page", () => {
    expect(isSameRecent(DETAIL, `/work-items/${ITEM}`)).toBe(true);
    expect(isSameRecent(`${LIST}/`, LIST)).toBe(true);
    expect(isSameRecent(LIST, "/work-items")).toBe(false);
    expect(isSameRecent(DETAIL, `/work-items/other`)).toBe(false);
    const recents = [`/work-items/${ITEM}`, "/projects"].map((path) => ({ path }));
    expect(otherRecents(recents, onScreenPaths(LIST, ITEM), 5).map((recent) => recent.path)).toEqual(["/projects"]);
  });
});

describe("parseRecents", () => {
  it("reads a stored list of paths, newest first", () => {
    expect(parseRecents([DETAIL, LIST])).toEqual([DETAIL, LIST]);
  });

  it("drops malformed, duplicate and unrecordable entries", () => {
    expect(parseRecents([LIST, 42, null, "relative", `${LIST}/`, "/home", "/browse/WEB-1", { path: DETAIL }, DETAIL])).toEqual([LIST, DETAIL]);
    expect(parseRecents([DETAIL, `/work-items/${ITEM}`, LIST])).toEqual([DETAIL, LIST]);
    expect(parseRecents([`/cycles/${CYCLE}`, "/projects/archives", `/projects/${PROJECT}/archives`])).toEqual(["/projects/archives"]);
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

  it("labels cycle, module and archive recents with their icons", () => {
    const planning = [`/projects/${PROJECT}/cycles/${CYCLE}`, `/projects/${PROJECT}/modules`, "/projects/archives"];
    const named: RouteLookup = { ...lookup, entityLabel: (id) => (id === CYCLE ? "Sprint 1" : undefined) };
    const labelled = labelRecents(planning, named);
    expect(labelled.map((recent) => recent.label)).toEqual(["Website · Sprint 1", "Website · Modules", "Archived projects"]);
    expect(labelled.map((recent) => recent.icon)).toEqual(["cycle", "modules", "archives"]);
  });

  it("returns nothing for an empty list", () => {
    expect(labelRecents([], lookup)).toEqual([]);
  });
});
