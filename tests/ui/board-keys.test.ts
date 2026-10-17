/**
 * Board drag keys (src/components/work-items/board-keys.ts, decision 30).
 */
import { describe, expect, it } from "vitest";
import { dragKey, itemIdOf } from "@/components/work-items/board-keys";

const ITEM = "11111111-1111-7111-8111-111111111111";

describe("board drag keys", () => {
  it("round-trips an item id through a column container", () => {
    const key = dragKey("col:22222222-2222-7222-8222-222222222222", ITEM);
    expect(key).toBe(`col:22222222-2222-7222-8222-222222222222|${ITEM}`);
    expect(itemIdOf(key)).toBe(ITEM);
  });

  it("round-trips an item id through a swimlane cell container", () => {
    const key = dragKey("cell:lane-a::col-x", ITEM);
    expect(itemIdOf(key)).toBe(ITEM);
  });

  it("gives the copies of one item in two containers different keys", () => {
    expect(dragKey("col:a", ITEM)).not.toBe(dragKey("col:b", ITEM));
  });

  it("passes a bare id through", () => {
    expect(itemIdOf(ITEM)).toBe(ITEM);
  });
});
