/**
 * URL state codec of the work-items screens
 * (src/components/work-items/url-state.ts): base64url round trips, sparse
 * display patches, rejection of invalid payloads and the merge helpers.
 */
import { describe, expect, it } from "vitest";
import { UrlDisplayPatchSchema, decodeUrlState, encodeUrlState, mergeDisplay, mergeFilters } from "@/components/work-items/url-state";
import { DEFAULT_DISPLAY, DisplaySchema } from "@/lib/tessera/schemas";
import type { Filters } from "@/lib/tessera/types";

const STATE_ID = "019505a0-7c5e-7000-8000-000000000001";
const LABEL_ID = "019505a0-7c5e-7000-8000-000000000002";

describe("encodeUrlState", () => {
  it("returns an empty string when there is nothing to carry", () => {
    expect(encodeUrlState({})).toBe("");
    expect(encodeUrlState({ filters: {}, display: {} })).toBe("");
    expect(encodeUrlState({ filters: { state: undefined } })).toBe("");
  });

  it("produces base64url without padding", () => {
    const encoded = encodeUrlState({ filters: { search: "hello world ??? >>>" }, display: { layout: "board" } });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
  });

  it("round-trips filters and a sparse display patch", () => {
    const filters: Filters = {
      state: [STATE_ID],
      priority: ["high", "urgent"],
      labels: [LABEL_ID],
      search: "login",
      target_date: { op: "between", from: "2026-10-01", to: "2026-10-31" },
    };
    const encoded = encodeUrlState({ filters, display: { group_by: "priority", layout: "list" } });
    expect(decodeUrlState(encoded)).toEqual({ filters, display: { group_by: "priority", layout: "list" } });
  });

  it("round-trips unicode", () => {
    const encoded = encodeUrlState({ filters: { search: "Überprüfung – 日本語" } });
    expect(decodeUrlState(encoded)).toEqual({ filters: { search: "Überprüfung – 日本語" } });
  });
});

describe("decodeUrlState", () => {
  it("returns {} for missing, empty, malformed or non-object values", () => {
    expect(decodeUrlState(undefined)).toEqual({});
    expect(decodeUrlState(null)).toEqual({});
    expect(decodeUrlState("")).toEqual({});
    expect(decodeUrlState("not base64!")).toEqual({});
    expect(decodeUrlState(Buffer.from("not json").toString("base64url"))).toEqual({});
    expect(decodeUrlState(Buffer.from("[1,2]").toString("base64url"))).toEqual({});
    expect(decodeUrlState(Buffer.from("42").toString("base64url"))).toEqual({});
  });

  it("returns {} when a filter or display value fails the schema", () => {
    expect(decodeUrlState(Buffer.from(JSON.stringify({ filters: { state: ["not-a-uuid"] } })).toString("base64url"))).toEqual({});
    expect(decodeUrlState(Buffer.from(JSON.stringify({ display: { layout: "cube" } })).toString("base64url"))).toEqual({});
    expect(decodeUrlState(Buffer.from(JSON.stringify({ filters: { priority: ["critical"] } })).toString("base64url"))).toEqual({});
  });

  it("keeps the display patch sparse instead of filling schema defaults", () => {
    const encoded = Buffer.from(JSON.stringify({ display: { group_by: "state" } })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({ display: { group_by: "state" } });
  });

  it("drops unknown keys and empty sections", () => {
    const encoded = Buffer.from(JSON.stringify({ filters: { bogus: 1 }, display: {}, extra: true })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({});
  });

  it("accepts a null group_by (flat list) as an explicit key", () => {
    const encoded = Buffer.from(JSON.stringify({ display: { group_by: null } })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({ display: { group_by: null } });
  });

  it("keeps nested properties and calendar patches sparse", () => {
    const encoded = Buffer.from(JSON.stringify({ display: { properties: { labels: false }, calendar: { layout: "week" } } })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({ display: { properties: { labels: false }, calendar: { layout: "week" } } });
  });

  it("drops empty nested patches and unknown property keys", () => {
    const encoded = Buffer.from(JSON.stringify({ display: { properties: { bogus: true }, calendar: {} } })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({});
  });

  it("rejects an invalid nested value", () => {
    const encoded = Buffer.from(JSON.stringify({ display: { properties: { labels: "no" } } })).toString("base64url");
    expect(decodeUrlState(encoded)).toEqual({});
  });

  it("merges a sparse properties patch over saved properties one level deep", () => {
    const saved = { ...DEFAULT_DISPLAY, properties: { ...DEFAULT_DISPLAY.properties, key: false, assignees: false } };
    const encoded = Buffer.from(JSON.stringify({ display: { properties: { labels: false } } })).toString("base64url");
    const merged = mergeDisplay(DEFAULT_DISPLAY, saved, decodeUrlState(encoded).display);
    expect(merged.properties.key).toBe(false);
    expect(merged.properties.assignees).toBe(false);
    expect(merged.properties.labels).toBe(false);
    expect(merged.properties.state).toBe(true);
  });

  it("covers every Display key in the URL patch schema", () => {
    expect(Object.keys(UrlDisplayPatchSchema.shape).sort()).toEqual(Object.keys(DisplaySchema.shape).sort());
  });
});

describe("mergeDisplay", () => {
  it("returns the defaults when no patch is given", () => {
    expect(mergeDisplay(DEFAULT_DISPLAY)).toEqual(DEFAULT_DISPLAY);
    expect(mergeDisplay(DEFAULT_DISPLAY, undefined, {})).toEqual(DEFAULT_DISPLAY);
  });

  it("applies patches left to right with the last one winning", () => {
    const merged = mergeDisplay(DEFAULT_DISPLAY, { layout: "board", group_by: "state" }, { group_by: "priority" });
    expect(merged.layout).toBe("board");
    expect(merged.group_by).toBe("priority");
    expect(merged.order_by).toBe("sort_order");
  });

  it("merges properties and calendar one level deep", () => {
    const merged = mergeDisplay(
      DEFAULT_DISPLAY,
      { properties: { ...DEFAULT_DISPLAY.properties, labels: false } },
      { calendar: { layout: "week", show_weekends: DEFAULT_DISPLAY.calendar.show_weekends } },
    );
    expect(merged.properties.labels).toBe(false);
    expect(merged.properties.key).toBe(true);
    expect(merged.calendar).toEqual({ layout: "week", show_weekends: true });
  });

  it("ignores undefined keys inside a patch", () => {
    const merged = mergeDisplay(DEFAULT_DISPLAY, { layout: "table" }, { layout: undefined });
    expect(merged.layout).toBe("table");
  });

  it("does not mutate the defaults", () => {
    const defaults = { ...DEFAULT_DISPLAY, properties: { ...DEFAULT_DISPLAY.properties } };
    mergeDisplay(defaults, { properties: { ...DEFAULT_DISPLAY.properties, key: false } });
    expect(defaults.properties.key).toBe(true);
  });
});

describe("mergeFilters", () => {
  it("lets a later patch replace a key and keeps the others", () => {
    const merged = mergeFilters({ search: "a", priority: ["low"] }, { search: "b" }, undefined, { priority: [] });
    expect(merged).toEqual({ search: "b", priority: [] });
  });
});
