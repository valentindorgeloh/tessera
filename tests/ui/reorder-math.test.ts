/**
 * Reorder helpers behind the stickies, quick-link and Home widget drag
 * (src/components/stickies/reorder-math.ts, decision 105): the placement passed
 * to move_sticky / move_quick_link, the optimistic order and the insertion line.
 */
import { describe, expect, it } from "vitest";
import { dropMarker, placementFor, reorderBy, stepIndex } from "@/components/stickies/reorder-math";

const IDS = ["a", "b", "c", "d"];

describe("placementFor", () => {
  it("names the previous item as before_id for any slot past the front", () => {
    expect(placementFor(IDS, "a", 2)).toEqual({ before_id: "c" });
    expect(placementFor(IDS, "a", 3)).toEqual({ before_id: "d" });
    expect(placementFor(IDS, "d", 1)).toEqual({ before_id: "a" });
  });

  it("names the first remaining item as after_id for the front slot", () => {
    expect(placementFor(IDS, "c", 0)).toEqual({ after_id: "a" });
    expect(placementFor(IDS, "a", 0)).toEqual({ after_id: "b" });
  });

  it("never names the moved item and clamps the slot", () => {
    expect(placementFor(IDS, "b", 99)).toEqual({ before_id: "d" });
    expect(placementFor(IDS, "b", -3)).toEqual({ after_id: "a" });
  });

  it("is null when the list holds only the moved item", () => {
    expect(placementFor(["a"], "a", 0)).toBeNull();
    expect(placementFor([], "a", 0)).toBeNull();
  });

  it("matches what the step buttons need: earlier names the item it jumps over as after_id", () => {
    const earlier = stepIndex(IDS, "c", -1);
    const later = stepIndex(IDS, "b", 1);
    expect(earlier === null ? null : placementFor(IDS, "c", earlier)).toEqual({ before_id: "a" });
    expect(later === null ? null : placementFor(IDS, "b", later)).toEqual({ before_id: "c" });
    expect(placementFor(IDS, "b", 0)).toEqual({ after_id: "a" });
  });
});

describe("stepIndex", () => {
  it("is the neighbouring slot among the other items", () => {
    expect(stepIndex(IDS, "b", -1)).toBe(0);
    expect(stepIndex(IDS, "b", 1)).toBe(2);
  });

  it("is null at an edge or for an unknown id", () => {
    expect(stepIndex(IDS, "a", -1)).toBeNull();
    expect(stepIndex(IDS, "d", 1)).toBeNull();
    expect(stepIndex(IDS, "x", 1)).toBeNull();
  });
});

describe("reorderBy", () => {
  const items = IDS.map((id) => ({ id, n: id.charCodeAt(0) }));
  const order = (list: { id: string }[]) => list.map((item) => item.id);

  it("moves an item to a slot among the others and keeps the objects", () => {
    const next = reorderBy(items, (item) => item.id, "a", 2);
    expect(order(next)).toEqual(["b", "c", "a", "d"]);
    expect(next[2]).toBe(items[0]);
    expect(order(reorderBy(items, (item) => item.id, "d", 0))).toEqual(["d", "a", "b", "c"]);
  });

  it("leaves the order alone for an unknown id and does not touch the input", () => {
    expect(order(reorderBy(items, (item) => item.id, "x", 1))).toEqual(IDS);
    reorderBy(items, (item) => item.id, "a", 3);
    expect(order(items)).toEqual(IDS);
  });
});

describe("dropMarker", () => {
  it("draws before the item at the slot, among the items that stay", () => {
    expect(dropMarker(IDS, "a", 0)).toEqual({ id: "b", edge: "before" });
    expect(dropMarker(IDS, "d", 2)).toEqual({ id: "c", edge: "before" });
  });

  it("draws after the last item for the final slot", () => {
    expect(dropMarker(IDS, "a", 3)).toEqual({ id: "d", edge: "after" });
    expect(dropMarker(IDS, "d", 3)).toEqual({ id: "c", edge: "after" });
  });

  it("is null when nothing else is in the list", () => {
    expect(dropMarker(["a"], "a", 0)).toBeNull();
  });
});
