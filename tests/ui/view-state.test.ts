/**
 * Saved-view helpers (src/components/views/view-state.ts): when a view counts
 * as modified (decision 32), the quick-add defaults its filters imply and its
 * one-line summary.
 */
import { describe, expect, it } from "vitest";
import { isViewModified, normalizeFilters, stableJson, viewScopeDefaults, viewSummary, type ViewState } from "@/components/views/view-state";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Filters } from "@/lib/tessera/types";

const A = "11111111-1111-7111-8111-111111111111";
const B = "22222222-2222-7222-8222-222222222222";
const C = "33333333-3333-7333-8333-333333333333";

const state = (filters: Filters, display: Display = DEFAULT_DISPLAY): ViewState => ({ filters, display });

describe("isViewModified", () => {
  it("treats [] and \"\" like a missing key", () => {
    const saved = state({ priority: ["high"] });
    expect(isViewModified(saved, state({ priority: ["high"], labels: [], search: "", state: undefined }))).toBe(false);
    expect(isViewModified(state({}), state({ labels: [], search: "" }))).toBe(false);
  });

  it("ignores the order of ids", () => {
    expect(isViewModified(state({ labels: [A, B] }), state({ labels: [B, A] }))).toBe(false);
  });

  it("sees a filter change", () => {
    expect(isViewModified(state({ labels: [A] }), state({ labels: [A, B] }))).toBe(true);
    expect(isViewModified(state({}), state({ priority: ["urgent"] }))).toBe(true);
  });

  it("sees a display order or property change", () => {
    expect(isViewModified(state({}), state({}, { ...DEFAULT_DISPLAY, order_by: "-created_at" }))).toBe(true);
    expect(isViewModified(state({}), state({}, { ...DEFAULT_DISPLAY, properties: { ...DEFAULT_DISPLAY.properties, labels: false } }))).toBe(true);
    expect(isViewModified(state({}), state({}, { ...DEFAULT_DISPLAY }))).toBe(false);
  });
});

describe("normalizeFilters and stableJson", () => {
  it("drops empty values and sorts string arrays", () => {
    expect(normalizeFilters({ labels: [B, A], state: [], search: "", priority: ["low", "high"] })).toEqual({ labels: [A, B], priority: ["high", "low"] });
  });

  it("sorts object keys at every level and keeps array order", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: 3 } })).toBe('{"a":{"c":3,"d":[2,1]},"b":1}');
  });
});

describe("viewScopeDefaults", () => {
  it("takes a single state, priority and cycle", () => {
    expect(viewScopeDefaults({ state: [A], priority: ["high"], cycle: [B] })).toEqual({ state_id: A, priority: "high", cycle_id: B });
  });

  it("adds nothing for several states, priorities or cycles", () => {
    expect(viewScopeDefaults({ state: [A, B], priority: ["high", "low"], cycle: [A, B] })).toEqual({});
  });

  it("takes every label, assignee and module id", () => {
    expect(viewScopeDefaults({ labels: [B, A], assignees: [C], module: [A, B] })).toEqual({ label_ids: [A, B], assignee_ids: [C], module_ids: [A, B] });
  });

  it("ignores every other filter and empty lists", () => {
    expect(viewScopeDefaults({ search: "x", created_by: [A], state_group: ["started"], labels: [] })).toEqual({});
  });
});

describe("viewSummary", () => {
  it("names layout, grouping and the number of filters", () => {
    expect(viewSummary({ filters: { state: [A], priority: ["high"] }, display: { ...DEFAULT_DISPLAY, layout: "board", group_by: "state" } })).toBe("Board · grouped by State · 2 filters");
  });

  it("says no filters and one filter", () => {
    expect(viewSummary({ filters: {}, display: DEFAULT_DISPLAY })).toBe("List · no filters");
    expect(viewSummary({ filters: { labels: [A] }, display: { ...DEFAULT_DISPLAY, layout: "table", group_by: "labels" } })).toBe("Table · grouped by Labels · 1 filter");
  });

  it("does not count empty filter keys", () => {
    expect(viewSummary({ filters: { labels: [], search: "" }, display: DEFAULT_DISPLAY })).toBe("List · no filters");
  });
});
