/**
 * Peek preferences of the detail hosts (src/components/detail/peek-prefs.ts):
 * width clamping to 360–720 px, validation of the stored
 * `tessera.peek.v1` value, and the store that reads it once after mount and
 * writes every change back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PEEK_PREFS,
  PEEK_DEFAULT_WIDTH,
  PEEK_MAX_WIDTH,
  PEEK_MIN_WIDTH,
  PEEK_STORAGE_KEY,
  clampPeekWidth,
  parsePeekPrefs,
} from "@/components/detail/peek-prefs";

describe("clampPeekWidth", () => {
  it("keeps widths inside the range and rounds them", () => {
    expect(clampPeekWidth(480)).toBe(480);
    expect(clampPeekWidth(561.4)).toBe(561);
    expect(clampPeekWidth(PEEK_MIN_WIDTH)).toBe(360);
    expect(clampPeekWidth(PEEK_MAX_WIDTH)).toBe(720);
  });

  it("clamps widths outside the range", () => {
    expect(clampPeekWidth(100)).toBe(PEEK_MIN_WIDTH);
    expect(clampPeekWidth(5000)).toBe(PEEK_MAX_WIDTH);
    expect(clampPeekWidth(-1)).toBe(PEEK_MIN_WIDTH);
  });

  it("falls back to the default for anything that is not a finite number", () => {
    expect(clampPeekWidth(Number.NaN)).toBe(PEEK_DEFAULT_WIDTH);
    expect(clampPeekWidth(Number.POSITIVE_INFINITY)).toBe(PEEK_DEFAULT_WIDTH);
    expect(clampPeekWidth("600")).toBe(PEEK_DEFAULT_WIDTH);
    expect(clampPeekWidth(undefined)).toBe(PEEK_DEFAULT_WIDTH);
  });
});

describe("parsePeekPrefs", () => {
  it("reads a valid value", () => {
    expect(parsePeekPrefs({ width: 600, mode: "modal" })).toEqual({ width: 600, mode: "modal" });
    expect(parsePeekPrefs({ width: 400, mode: "side" })).toEqual({ width: 400, mode: "side" });
  });

  it("repairs an unknown mode and an out-of-range width", () => {
    expect(parsePeekPrefs({ width: 9000, mode: "page" })).toEqual({ width: PEEK_MAX_WIDTH, mode: "side" });
    expect(parsePeekPrefs({})).toEqual(DEFAULT_PEEK_PREFS);
  });

  it("rejects values that are not objects", () => {
    expect(parsePeekPrefs(null)).toBeNull();
    expect(parsePeekPrefs("side")).toBeNull();
    expect(parsePeekPrefs(42)).toBeNull();
  });
});

describe("peek prefs store", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stored = () => JSON.parse(storage.get(PEEK_STORAGE_KEY) ?? "null");

  it("loads the stored value once and keeps the default without one", async () => {
    const empty = await import("@/components/detail/peek-prefs");
    empty.loadPeekPrefs();
    expect(stored()).toBeNull();

    vi.resetModules();
    storage.set(PEEK_STORAGE_KEY, JSON.stringify({ width: 600, mode: "modal" }));
    const store = await import("@/components/detail/peek-prefs");
    store.loadPeekPrefs();
    store.savePeekPrefs({ width: 640 });
    expect(stored()).toEqual({ width: 640, mode: "modal" });
    // A second load in the same page does not re-read storage over the newer value.
    storage.set(PEEK_STORAGE_KEY, JSON.stringify({ width: 400, mode: "side" }));
    store.loadPeekPrefs();
    store.savePeekPrefs({ mode: "side" });
    expect(stored()).toEqual({ width: 640, mode: "side" });
  });

  it("clamps saved widths and merges partial patches", async () => {
    const store = await import("@/components/detail/peek-prefs");
    store.loadPeekPrefs();
    store.savePeekPrefs({ width: 9999 });
    expect(stored()).toEqual({ width: PEEK_MAX_WIDTH, mode: "side" });
    store.savePeekPrefs({ mode: "modal" });
    expect(stored()).toEqual({ width: PEEK_MAX_WIDTH, mode: "modal" });
    store.savePeekPrefs({ width: 10 });
    expect(stored()).toEqual({ width: PEEK_MIN_WIDTH, mode: "modal" });
  });

  it("reads the stored value before a save that comes first, so the other field survives", async () => {
    storage.set(PEEK_STORAGE_KEY, JSON.stringify({ width: 600, mode: "side" }));
    const store = await import("@/components/detail/peek-prefs");
    // The full page's mode switcher saves before any peek host has mounted.
    store.savePeekPrefs({ mode: "modal" });
    expect(stored()).toEqual({ width: 600, mode: "modal" });
  });

  it("ignores a corrupt stored value", async () => {
    storage.set(PEEK_STORAGE_KEY, "{oops");
    const store = await import("@/components/detail/peek-prefs");
    store.loadPeekPrefs();
    store.savePeekPrefs({ mode: "modal" });
    expect(stored()).toEqual({ width: PEEK_DEFAULT_WIDTH, mode: "modal" });
  });
});
