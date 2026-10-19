import { describe, expect, it } from "vitest";
import { orderByFromSort, sortFromOrderBy } from "@/components/work-items/table-sort";
import { hrefWithLayout, layoutFromParam } from "@/components/work-items/layout-param";
import { decodeUrlState } from "@/components/work-items/url-state";

describe("table sort <-> order_by", () => {
  it("maps a stored order to a header sort", () => {
    expect(sortFromOrderBy("name")).toEqual([{ sortKey: "name", direction: "ascending" }]);
    expect(sortFromOrderBy("-updated_at")).toEqual([{ sortKey: "updated_at", direction: "descending" }]);
    expect(sortFromOrderBy("sequence_id")).toEqual([{ sortKey: "key", direction: "ascending" }]);
  });

  it("shows no sort for the manual order", () => {
    expect(sortFromOrderBy("sort_order")).toEqual([]);
    expect(sortFromOrderBy("-sort_order")).toEqual([]);
  });

  it("maps a header click to an order, and clearing to the manual order", () => {
    expect(orderByFromSort([{ sortKey: "priority", direction: "descending" }])).toBe("-priority");
    expect(orderByFromSort([{ sortKey: "key", direction: "ascending" }])).toBe("sequence_id");
    expect(orderByFromSort([])).toBe("sort_order");
    expect(orderByFromSort([{ sortKey: "state", direction: "ascending" }])).toBe("sort_order");
  });
});

describe("layout param", () => {
  it("accepts the five layouts and nothing else", () => {
    for (const layout of ["list", "board", "table", "calendar", "gantt"]) expect(layoutFromParam(layout)).toBe(layout);
    expect(layoutFromParam("grid")).toBeNull();
    expect(layoutFromParam(null)).toBeNull();
  });

  it("merges the layout into q, drops the param and keeps the others", () => {
    const href = hrefWithLayout("/projects/p1/work-items", "layout=gantt&peek=w1", {}, "gantt");
    const url = new URL(href, "http://x");
    expect(url.searchParams.get("layout")).toBeNull();
    expect(url.searchParams.get("peek")).toBe("w1");
    expect(decodeUrlState(url.searchParams.get("q")).display?.layout).toBe("gantt");
  });

  it("keeps the other URL state", () => {
    const href = hrefWithLayout("/x", "layout=board", { display: { group_by: "state" }, filters: { priority: ["high"] } }, "board");
    const state = decodeUrlState(new URL(href, "http://x").searchParams.get("q"));
    expect(state.display).toEqual({ group_by: "state", layout: "board" });
    expect(state.filters).toEqual({ priority: ["high"] });
  });
});
