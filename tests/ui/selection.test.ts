import { describe, expect, it } from "vitest";
import { prune, selectAll, selectRange, toggle, MAX_SELECTION } from "@/components/work-items/selection";

describe("selection", () => {
  it("toggles, extends a range, caps at 500 and drops missing ids", () => {
    const one = toggle(new Set(), "a");
    expect([...toggle(one, "a")]).toEqual([]);
    expect([...selectRange(one, ["a", "b", "c"], "a", "c")].sort()).toEqual(["a", "b", "c"]);
    expect(selectAll(Array.from({ length: MAX_SELECTION + 5 }, (_, index) => String(index))).size).toBe(MAX_SELECTION);
    const kept = prune(new Set(["a", "b"]), new Set(["b"]));
    expect([...kept]).toEqual(["b"]);
    expect(prune(new Set(["b"]), new Set(["b"]))).toBeInstanceOf(Set);
  });
});
