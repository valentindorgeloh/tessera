import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sidebar preferences (src/components/shell/nav-prefs.ts, decisions 128–131):
 * parsing, serializing, the view helpers, the Power K patches, and the two
 * module stores against a fake `window` (like tests/ui/color-scheme.test.ts).
 * Each store test loads a fresh module so the cached snapshot starts empty.
 * The hydration cases of the store are lane N's (tests/ui/nav-prefs-store.test.ts).
 */

type StorageListener = (event: { key: string | null }) => void;

function fakeWindow(initial: Record<string, string> = {}, { failWrites = false, failReads = false } = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Set<StorageListener>();
  const writes: [string, string][] = [];
  return {
    values,
    listeners,
    writes,
    localStorage: {
      getItem: (key: string) => {
        if (failReads) throw new Error("SecurityError");
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
        writes.push([key, value]);
        values.set(key, value);
      },
    },
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === "storage") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: StorageListener) => {
      if (type === "storage") listeners.delete(listener);
    },
    /** Another tab wrote `key`. */
    dispatchStorage(key: string | null) {
      for (const listener of listeners) listener({ key });
    },
  };
}

async function load(win: ReturnType<typeof fakeWindow> = fakeWindow()) {
  vi.stubGlobal("window", win);
  return import("@/components/shell/nav-prefs");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEY = "tessera.nav.v1";
const DEFAULTS = { display: "full", rail: "icons", dock: "docked" };

describe("parseNavPrefs", () => {
  it("falls back to the defaults for null, invalid JSON and non-objects", async () => {
    const { parseNavPrefs, DEFAULT_NAV_PREFS } = await load();
    expect(DEFAULT_NAV_PREFS).toEqual(DEFAULTS);
    expect(Object.isFrozen(DEFAULT_NAV_PREFS)).toBe(true);
    for (const raw of [null, "", "{", "not json", "null", "42", '"full"', "true", "[]", '["rail"]']) {
      expect(parseNavPrefs(raw)).toEqual(DEFAULTS);
    }
  });

  it("validates each field on its own and ignores extra keys", async () => {
    const { parseNavPrefs } = await load();
    expect(parseNavPrefs('{"display":"rail","rail":"labels","dock":"floating"}')).toEqual({ display: "rail", rail: "labels", dock: "floating" });
    expect(parseNavPrefs('{"rail":"labels"}')).toEqual({ display: "full", rail: "labels", dock: "docked" });
    expect(parseNavPrefs('{"dock":"floating"}')).toEqual({ display: "full", rail: "icons", dock: "floating" });
    expect(parseNavPrefs('{"display":1,"rail":true,"dock":null}')).toEqual(DEFAULTS);
    expect(parseNavPrefs('{"display":"rail","rail":"wide","dock":"Docked"}')).toEqual({ display: "rail", rail: "icons", dock: "docked" });
    expect(parseNavPrefs('{"display":"rail","extra":1,"width":300}')).toEqual({ display: "rail", rail: "icons", dock: "docked" });
  });

  it("reads the never-shipped draft display values as full", async () => {
    const { parseNavPrefs } = await load();
    expect(parseNavPrefs('{"display":"labels","dock":"floating"}')).toEqual({ display: "full", rail: "icons", dock: "floating" });
    expect(parseNavPrefs('{"display":"icons"}')).toEqual(DEFAULTS);
  });
});

describe("serializeNavPrefs", () => {
  it("round-trips with exactly the three keys", async () => {
    const { parseNavPrefs, serializeNavPrefs } = await load();
    const prefs = { display: "rail", rail: "labels", dock: "floating" } as const;
    const raw = serializeNavPrefs({ ...prefs, extra: "x" } as typeof prefs);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["display", "dock", "rail"]);
    expect(parseNavPrefs(raw)).toEqual(prefs);
  });
});

describe("view helpers", () => {
  it("maps the three views to and from the preferences", async () => {
    const { navView, navViewPatch } = await load();
    expect(navViewPatch("full")).toEqual({ display: "full" });
    expect(navViewPatch("icons")).toEqual({ display: "rail", rail: "icons" });
    expect(navViewPatch("labels")).toEqual({ display: "rail", rail: "labels" });
    expect(navView({ display: "full", rail: "labels", dock: "docked" })).toBe("full");
    expect(navView({ display: "rail", rail: "icons", dock: "docked" })).toBe("icons");
    expect(navView({ display: "rail", rail: "labels", dock: "floating" })).toBe("labels");
  });

  it("shows a rail only while docked with a rail display", async () => {
    const { isRailShown } = await load();
    for (const display of ["full", "rail"] as const) {
      for (const rail of ["icons", "labels"] as const) {
        for (const dock of ["docked", "floating"] as const) {
          expect(isRailShown({ display, rail, dock })).toBe(display === "rail" && dock === "docked");
        }
      }
    }
  });

  it("turns each sidebar command into its patch and rejects other ids", async () => {
    const { sidebarCommandPatch, SIDEBAR_COMMAND_PREFIX } = await load();
    expect(SIDEBAR_COMMAND_PREFIX).toBe("sidebar.");
    expect(sidebarCommandPatch("sidebar.full")).toEqual({ display: "full" });
    expect(sidebarCommandPatch("sidebar.labels")).toEqual({ display: "rail", rail: "labels" });
    expect(sidebarCommandPatch("sidebar.icons")).toEqual({ display: "rail", rail: "icons" });
    expect(sidebarCommandPatch("sidebar.float")).toEqual({ dock: "floating" });
    expect(sidebarCommandPatch("sidebar.dock")).toEqual({ dock: "docked" });
    expect(sidebarCommandPatch("sidebar.toggle")).toBeNull();
    expect(sidebarCommandPatch("theme.dark")).toBeNull();
    expect(sidebarCommandPatch("")).toBeNull();
  });
});

describe("preferences store", () => {
  it("serves the same default object on the server and reads storage lazily on the client", async () => {
    const win = fakeWindow({ [KEY]: '{"display":"rail","rail":"labels","dock":"docked"}' });
    const { navPrefsStore, DEFAULT_NAV_PREFS, getNavPrefs } = await load(win);
    expect(navPrefsStore.getServerSnapshot()).toBe(DEFAULT_NAV_PREFS);
    expect(navPrefsStore.getServerSnapshot()).toBe(navPrefsStore.getServerSnapshot());
    const snapshot = navPrefsStore.getSnapshot();
    expect(snapshot).toEqual({ display: "rail", rail: "labels", dock: "docked" });
    expect(navPrefsStore.getSnapshot()).toBe(snapshot);
    expect(getNavPrefs()).toBe(snapshot);
  });

  it("emits once per change, stores it, and does nothing when unchanged", async () => {
    const win = fakeWindow();
    const { navPrefsStore, setNavPrefs } = await load(win);
    const listener = vi.fn();
    navPrefsStore.subscribe(listener);

    setNavPrefs({ display: "rail" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(navPrefsStore.getSnapshot()).toEqual({ display: "rail", rail: "icons", dock: "docked" });
    expect(JSON.parse(win.values.get(KEY) ?? "null")).toEqual({ display: "rail", rail: "icons", dock: "docked" });

    const before = navPrefsStore.getSnapshot();
    setNavPrefs({ display: "rail", rail: "icons" });
    setNavPrefs({});
    expect(listener).toHaveBeenCalledTimes(1);
    expect(navPrefsStore.getSnapshot()).toBe(before);
    expect(win.writes).toHaveLength(1);
  });

  it("follows a storage event for its key and ignores other keys", async () => {
    const win = fakeWindow();
    const { navPrefsStore } = await load(win);
    const listener = vi.fn();
    const unsubscribe = navPrefsStore.subscribe(listener);
    expect(navPrefsStore.getSnapshot()).toEqual(DEFAULTS);

    win.values.set("tessera.scheme.v1", "light");
    win.dispatchStorage("tessera.scheme.v1");
    expect(listener).not.toHaveBeenCalled();
    expect(navPrefsStore.getSnapshot()).toEqual(DEFAULTS);

    win.values.set(KEY, '{"display":"rail","rail":"labels","dock":"floating"}');
    win.dispatchStorage(KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(navPrefsStore.getSnapshot()).toEqual({ display: "rail", rail: "labels", dock: "floating" });

    unsubscribe();
    expect(win.listeners.size).toBe(0);
  });

  it("still applies a change when localStorage throws", async () => {
    const win = fakeWindow({}, { failWrites: true, failReads: true });
    const { navPrefsStore, setNavPrefs } = await load(win);
    const listener = vi.fn();
    navPrefsStore.subscribe(listener);
    expect(navPrefsStore.getSnapshot()).toEqual(DEFAULTS);
    expect(() => setNavPrefs({ dock: "floating" })).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(navPrefsStore.getSnapshot()).toEqual({ display: "full", rail: "icons", dock: "floating" });
  });
});

describe("floating open flag", () => {
  it("emits only on a change and never writes storage", async () => {
    const win = fakeWindow();
    const { getNavOpen, setNavOpenFlag, navOpenStore, navPrefsStore } = await load(win);
    const prefsListener = vi.fn();
    const openListener = vi.fn();
    navPrefsStore.subscribe(prefsListener);
    navOpenStore.subscribe(openListener);
    expect(navOpenStore.getServerSnapshot()).toBe(false);
    expect(getNavOpen()).toBe(false);

    setNavOpenFlag(false);
    expect(openListener).not.toHaveBeenCalled();
    setNavOpenFlag(true);
    setNavOpenFlag(true);
    expect(openListener).toHaveBeenCalledTimes(1);
    expect(getNavOpen()).toBe(true);
    setNavOpenFlag(false);
    expect(openListener).toHaveBeenCalledTimes(2);
    expect(navOpenStore.getSnapshot()).toBe(false);

    expect(win.writes).toHaveLength(0);
    expect(win.values.size).toBe(0);
    expect(prefsListener).not.toHaveBeenCalled();
  });
});
