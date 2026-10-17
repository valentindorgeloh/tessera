// @vitest-environment jsdom
/**
 * Recents store (src/components/shell/recents-store.ts): every write starts
 * from the stored list, so two tabs never erase each other's visits; forget
 * drops a route and the routes under it; a `storage` event from another tab
 * reaches the subscribers. The store is module state, so each test imports a
 * fresh copy. A not-found screen's address leaves the list and stays out
 * of it until another route is visited. Cycles and modules read the names
 * their detail screens register; a deleted or archived project takes all its
 * routes with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECENTS_STORAGE_KEY } from "@/components/shell/recents";

const LIST = "/projects/p1/work-items";
const DETAIL = "/projects/p1/work-items/i1";

async function freshStore() {
  vi.resetModules();
  return import("@/components/shell/recents-store");
}

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "null");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("recents store", () => {
  it("keeps the visits another tab stored between two of this tab's visits", async () => {
    const store = await freshStore();
    store.recordVisit(LIST);
    // Another tab records a visit after this one loaded the list.
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["/projects", LIST]));
    store.recordVisit(DETAIL);
    expect(stored()).toEqual([DETAIL, "/projects", LIST]);
    expect(store.readRecents().map((recent) => recent.path)).toEqual([DETAIL, "/projects", LIST]);
  });

  it("forgets a route and the routes under it", async () => {
    const store = await freshStore();
    store.recordVisit(LIST);
    store.recordVisit(DETAIL);
    store.recordVisit("/projects");
    store.forgetRecentsUnder(LIST);
    expect(stored()).toEqual(["/projects"]);
    expect(store.readRecents().map((recent) => recent.path)).toEqual(["/projects"]);
  });

  it("forgets every route of a deleted or archived project, keeping the archived projects page", async () => {
    const store = await freshStore();
    store.recordVisit(LIST);
    store.recordVisit("/projects/p1/cycles/c1");
    store.recordVisit("/projects/archives");
    store.recordVisit("/projects/p10/work-items");
    store.forgetRecentsUnder("/projects/p1");
    expect(stored()).toEqual(["/projects/p10/work-items", "/projects/archives"]);
  });

  it("labels a cycle or module recent with the name its detail screen registered", async () => {
    const store = await freshStore();
    const labels = await import("@/components/shell/entity-labels");
    store.setRecentProjectNames({ p1: "Website" });
    store.recordVisit("/projects/p1/cycles/c1");
    store.recordVisit("/projects/p1/modules/m1");
    store.recordVisit("/projects/archives");
    expect(store.readRecents().map((recent) => recent.label)).toEqual(["Archived projects", "Website · Module", "Website · Cycle"]);
    labels.registerEntityLabel("c1", "Sprint 1");
    labels.registerEntityLabel("m1", "Launch");
    const recents = store.readRecents();
    expect(recents.map((recent) => recent.label)).toEqual(["Archived projects", "Website · Launch", "Website · Sprint 1"]);
    expect(recents.map((recent) => recent.icon)).toEqual(["archives", "module", "cycle"]);
  });

  it("skips the visit a not-found screen's address gets after the screen forgot it, until another route is visited", async () => {
    const store = await freshStore();
    store.recordVisit(LIST);
    window.history.replaceState(null, "", DETAIL);
    const probe = await renderMissing(store);
    store.recordVisit(DETAIL);
    expect(stored()).toEqual([LIST]);
    store.recordVisit("/projects");
    store.recordVisit(DETAIL);
    expect(stored()).toEqual([DETAIL, "/projects", LIST]);
    await probe.unmount();
  });

  it("follows another tab's writes through the storage event", async () => {
    const store = await freshStore();
    store.recordVisit(LIST);
    const probe = await renderRecents(store);
    expect(probe.paths()).toEqual([LIST]);
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify([DETAIL, LIST]));
    await probe.act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: RECENTS_STORAGE_KEY }));
    });
    expect(probe.paths()).toEqual([DETAIL, LIST]);
    await probe.unmount();
  });
});

/** Mounts `useRecents` in a jsdom root (from the same fresh module registry as the store) and reads its latest value. */
async function renderRecents(store: Awaited<ReturnType<typeof freshStore>>) {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let latest: readonly { path: string }[] = [];
  function Probe() {
    latest = store.useRecents().recents;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(createElement(Probe));
  });
  return {
    paths: () => latest.map((recent) => recent.path),
    act: (run: () => void) => act(async () => run()),
    unmount: () => act(async () => root.unmount()),
  };
}

/** Mounts a component that calls `useMissingRoute` (a not-found screen) for the current address. */
async function renderMissing(store: Awaited<ReturnType<typeof freshStore>>) {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  function Missing() {
    store.useMissingRoute();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(createElement(Missing));
  });
  return { unmount: () => act(async () => root.unmount()) };
}
