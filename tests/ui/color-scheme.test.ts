import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Colour scheme store (src/components/shell/color-scheme.ts) against a fake
 * `window`: stored values, the Frappé fallback, persistence failures and
 * cross-tab sync through `storage` events. Each test loads a fresh module so
 * the cached snapshot starts empty.
 */

type StorageListener = (event: { key: string | null }) => void;

function fakeWindow(initial: Record<string, string> = {}, { failWrites = false } = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Set<StorageListener>();
  return {
    values,
    listeners,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
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

async function load(win: ReturnType<typeof fakeWindow>) {
  vi.stubGlobal("window", win);
  return import("@/components/shell/color-scheme");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("colour scheme store", () => {
  it("recognises exactly the three Astryx modes", async () => {
    const { isColorScheme } = await load(fakeWindow());
    expect(["dark", "light", "system"].every(isColorScheme)).toBe(true);
    expect([null, "", "Dark", "frappe", 1].some(isColorScheme)).toBe(false);
  });

  it("renders Frappé on the server and when nothing valid is stored", async () => {
    const { colorSchemeStore, COLOR_SCHEME_STORAGE_KEY } = await load(fakeWindow());
    expect(colorSchemeStore.getServerSnapshot()).toBe("dark");
    expect(colorSchemeStore.getSnapshot()).toBe("dark");

    vi.resetModules();
    const garbage = await load(fakeWindow({ [COLOR_SCHEME_STORAGE_KEY]: "mocha" }));
    expect(garbage.colorSchemeStore.getSnapshot()).toBe("dark");
  });

  it("reads a stored choice and keeps the snapshot stable", async () => {
    const { colorSchemeStore } = await load(fakeWindow({ "tessera.scheme.v1": "light" }));
    expect(colorSchemeStore.getSnapshot()).toBe("light");
    expect(colorSchemeStore.getSnapshot()).toBe(colorSchemeStore.getSnapshot());
  });

  it("persists a choice and notifies subscribers", async () => {
    const win = fakeWindow();
    const { colorSchemeStore, setColorScheme, COLOR_SCHEME_STORAGE_KEY } = await load(win);
    const listener = vi.fn();
    colorSchemeStore.subscribe(listener);

    setColorScheme("system");

    expect(win.values.get(COLOR_SCHEME_STORAGE_KEY)).toBe("system");
    expect(colorSchemeStore.getSnapshot()).toBe("system");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still switches for the session when storage refuses the write", async () => {
    const { colorSchemeStore, setColorScheme } = await load(fakeWindow({}, { failWrites: true }));
    const listener = vi.fn();
    colorSchemeStore.subscribe(listener);

    expect(() => setColorScheme("light")).not.toThrow();
    expect(colorSchemeStore.getSnapshot()).toBe("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("follows a change made in another tab and ignores other keys", async () => {
    const win = fakeWindow({ "tessera.scheme.v1": "dark" });
    const { colorSchemeStore } = await load(win);
    const listener = vi.fn();
    colorSchemeStore.subscribe(listener);
    expect(colorSchemeStore.getSnapshot()).toBe("dark");

    win.values.set("tessera.tabs.v1", "[]");
    win.dispatchStorage("tessera.tabs.v1");
    expect(listener).not.toHaveBeenCalled();

    win.values.set("tessera.scheme.v1", "light");
    win.dispatchStorage("tessera.scheme.v1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(colorSchemeStore.getSnapshot()).toBe("light");
  });

  it("listens for storage events only while subscribed", async () => {
    const win = fakeWindow();
    const { colorSchemeStore } = await load(win);
    const unsubscribeA = colorSchemeStore.subscribe(() => {});
    const unsubscribeB = colorSchemeStore.subscribe(() => {});
    expect(win.listeners.size).toBe(1);

    unsubscribeA();
    expect(win.listeners.size).toBe(1);
    unsubscribeB();
    expect(win.listeners.size).toBe(0);
  });
});
