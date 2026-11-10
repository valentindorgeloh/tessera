import { describe, expect, it } from "vitest";
import { filterRowForced, filterRowShown } from "@/components/work-items/filter-row";
import type { RichFilters } from "@/lib/tessera/types";

const TREE = { op: "and", children: [] } as unknown as RichFilters;

describe("filter row visibility", () => {
  it("is not forced without any filter, search text or Advanced tree", () => {
    expect(filterRowForced({}, null, false)).toBe(false);
    expect(filterRowForced({}, undefined, false)).toBe(false);
    expect(filterRowForced({ search: "  " }, null, false)).toBe(false);
    expect(filterRowForced({ priority: [] }, null, false)).toBe(false);
  });

  it("is forced by a search text, a list filter, a date filter or an Advanced tree", () => {
    expect(filterRowForced({ search: "bug" }, null, false)).toBe(true);
    expect(filterRowForced({ priority: ["high"] }, null, false)).toBe(true);
    expect(filterRowForced({ target_date: { type: "relative", window: "1w" } as never }, null, false)).toBe(true);
    expect(filterRowForced({}, TREE, false)).toBe(true);
  });

  it("is forced by a bar that lives in the row (a saved view's)", () => {
    expect(filterRowForced({}, null, true)).toBe(true);
  });

  it("shows when forced or toggled open, and hides only when neither", () => {
    expect(filterRowShown(false, false)).toBe(false);
    expect(filterRowShown(false, true)).toBe(true);
    expect(filterRowShown(true, false)).toBe(true);
    expect(filterRowShown(true, true)).toBe(true);
  });
});
