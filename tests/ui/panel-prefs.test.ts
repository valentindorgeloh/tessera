/**
 * Planning side panel preferences (src/components/planning/panel-prefs.ts):
 * validation of the stored `tessera.planningPanel.v1` value field by field,
 * and the store that reads it once after mount and writes every change back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PANEL_PREFS, PANEL_STORAGE_KEY, parsePanelPrefs } from "@/components/planning/panel-prefs";

describe("parsePanelPrefs", () => {
  it("defaults to an open panel, the burndown chart and items", () => {
    expect(DEFAULT_PANEL_PREFS).toEqual({ open: true, chart: "burndown", unit: "issues" });
    expect(PANEL_STORAGE_KEY).toBe("tessera.planningPanel.v1");
  });

  it("returns the defaults for input that is not an object", () => {
    for (const raw of [null, undefined, "burnup", 42, true]) {
      expect(parsePanelPrefs(raw)).toEqual(DEFAULT_PANEL_PREFS);
    }
  });

  it("fills missing fields with the defaults", () => {
    expect(parsePanelPrefs({})).toEqual(DEFAULT_PANEL_PREFS);
    expect(parsePanelPrefs({ open: false })).toEqual({ open: false, chart: "burndown", unit: "issues" });
    expect(parsePanelPrefs({ chart: "burnup" })).toEqual({ open: true, chart: "burnup", unit: "issues" });
    expect(parsePanelPrefs({ unit: "points" })).toEqual({ open: true, chart: "burndown", unit: "points" });
  });

  it("reads a complete stored value", () => {
    expect(parsePanelPrefs({ open: false, chart: "burnup", unit: "points" })).toEqual({ open: false, chart: "burnup", unit: "points" });
    expect(parsePanelPrefs({ open: true, chart: "burndown", unit: "issues" })).toEqual(DEFAULT_PANEL_PREFS);
  });

  it("replaces fields of the wrong type with the defaults", () => {
    expect(parsePanelPrefs({ open: "false", chart: 1, unit: ["points"] })).toEqual(DEFAULT_PANEL_PREFS);
    expect(parsePanelPrefs({ open: 0, chart: null, unit: null })).toEqual(DEFAULT_PANEL_PREFS);
  });

  it("falls back to the defaults for unknown strings and ignores unknown keys", () => {
    expect(parsePanelPrefs({ chart: "scatter", unit: "hours" })).toEqual(DEFAULT_PANEL_PREFS);
    expect(parsePanelPrefs({ chart: "Burnup", unit: "POINTS" })).toEqual(DEFAULT_PANEL_PREFS);
    expect(parsePanelPrefs({ open: false, width: 400 })).toEqual({ open: false, chart: "burndown", unit: "issues" });
  });
});

describe("panel prefs store", () => {
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

  const stored = () => JSON.parse(storage.get(PANEL_STORAGE_KEY) ?? "null");

  it("reads the stored value before the first save, so the other fields survive", async () => {
    storage.set(PANEL_STORAGE_KEY, JSON.stringify({ open: false, chart: "burnup", unit: "points" }));
    const store = await import("@/components/planning/panel-prefs");
    store.savePanelPrefs({ chart: "burndown" });
    expect(stored()).toEqual({ open: false, chart: "burndown", unit: "points" });
  });

  it("does not re-read storage over a newer value in the same page", async () => {
    const store = await import("@/components/planning/panel-prefs");
    store.loadPanelPrefs();
    store.savePanelPrefs({ open: false });
    storage.set(PANEL_STORAGE_KEY, JSON.stringify({ open: true, chart: "burnup", unit: "points" }));
    store.loadPanelPrefs();
    store.savePanelPrefs({ unit: "points" });
    expect(stored()).toEqual({ open: false, chart: "burndown", unit: "points" });
  });

  it("ignores a corrupt or invalid stored value", async () => {
    storage.set(PANEL_STORAGE_KEY, "{oops");
    const corrupt = await import("@/components/planning/panel-prefs");
    corrupt.savePanelPrefs({ open: false });
    expect(stored()).toEqual({ open: false, chart: "burndown", unit: "issues" });

    vi.resetModules();
    storage.set(PANEL_STORAGE_KEY, JSON.stringify({ open: "yes", chart: "pie", unit: 3 }));
    const invalid = await import("@/components/planning/panel-prefs");
    invalid.savePanelPrefs({ chart: "burnup" });
    expect(stored()).toEqual({ open: true, chart: "burnup", unit: "issues" });
  });

  describe("on a phone (max-width 480px)", () => {
    const phone = (matches: boolean) =>
      vi.stubGlobal("window", {
        matchMedia: (query: string) => ({ matches: matches && query === "(max-width: 480px)" }),
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => void storage.set(key, value),
        },
      });

    it("starts closed, so the work item list keeps its width", async () => {
      phone(true);
      const store = await import("@/components/planning/panel-prefs");
      store.loadPanelPrefs();
      expect(store.currentPanelPrefs().open).toBe(false);
      // The toggle opens it for this visit; the wide-screen preference (open) stays in storage.
      store.savePanelPrefs({ open: true });
      expect(store.currentPanelPrefs().open).toBe(true);
      expect(stored()).toEqual({ open: true, chart: "burndown", unit: "issues" });
      store.savePanelPrefs({ chart: "burnup" });
      expect(stored()).toEqual({ open: true, chart: "burnup", unit: "issues" });
    });

    it("ignores a stored open on the phone but keeps it in storage", async () => {
      storage.set(PANEL_STORAGE_KEY, JSON.stringify({ open: true, chart: "burnup", unit: "points" }));
      phone(true);
      const store = await import("@/components/planning/panel-prefs");
      store.loadPanelPrefs();
      expect(store.currentPanelPrefs().open).toBe(false);
      store.savePanelPrefs({ unit: "issues" });
      expect(stored()).toEqual({ open: true, chart: "burnup", unit: "issues" });
    });

    it("never writes a stored closed panel back as open", async () => {
      storage.set(PANEL_STORAGE_KEY, JSON.stringify({ open: false, chart: "burndown", unit: "issues" }));
      phone(true);
      const store = await import("@/components/planning/panel-prefs");
      store.savePanelPrefs({ open: true });
      expect(stored().open).toBe(false);
    });

    it("does not change a wide screen", async () => {
      phone(false);
      const store = await import("@/components/planning/panel-prefs");
      store.savePanelPrefs({ open: false });
      expect(stored().open).toBe(false);
    });
  });
});
