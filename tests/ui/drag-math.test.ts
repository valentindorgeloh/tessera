/**
 * Pure drag-and-drop maths (src/components/dnd/drag-math.ts): drop target
 * resolution, insertion index, neighbour ids for move_work_item, the reorder
 * reducer and the auto-scroll ramp.
 */
import { describe, expect, it } from "vitest";
import {
  applyMove,
  autoScrollFor,
  autoScrollVelocity,
  containerAt,
  dropIndexFor,
  exceedsThreshold,
  isNoopDrop,
  neighboursAt,
  rectContains,
  reorderIds,
  withoutId,
  type Rect,
} from "@/components/dnd/drag-math";

const box = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

/** n stacked cards of height 40 with an 8px gap, starting at y=100. */
function column(n: number, top = 100): Rect[] {
  return Array.from({ length: n }, (_, i) => box(0, top + i * 48, 200, 40));
}

describe("exceedsThreshold", () => {
  it("promotes a press to a drag only after the pointer travelled far enough", () => {
    expect(exceedsThreshold({ x: 0, y: 0 }, { x: 2, y: 2 }, 5)).toBe(false);
    expect(exceedsThreshold({ x: 0, y: 0 }, { x: 3, y: 2 }, 5)).toBe(true);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 4, y: 10 }, 5)).toBe(true);
  });
});

describe("containerAt", () => {
  const containers = [
    { id: "a", rect: box(0, 0, 100, 400) },
    { id: "b", rect: box(100, 0, 100, 400) },
    { id: "b:inner", rect: box(110, 10, 80, 100) },
  ];

  it("returns the container under the pointer and null outside", () => {
    expect(containerAt({ x: 50, y: 50 }, containers)).toBe("a");
    expect(containerAt({ x: 150, y: 300 }, containers)).toBe("b");
    expect(containerAt({ x: 250, y: 50 }, containers)).toBeNull();
  });

  it("prefers the innermost container when they nest", () => {
    expect(containerAt({ x: 150, y: 50 }, containers)).toBe("b:inner");
  });

  it("treats the edges as inside", () => {
    expect(rectContains(box(0, 0, 10, 10), { x: 10, y: 10 })).toBe(true);
    expect(rectContains(box(0, 0, 10, 10), { x: 10.1, y: 10 })).toBe(false);
  });
});

describe("dropIndexFor", () => {
  it("inserts before the first card whose midpoint is below the pointer", () => {
    const rects = column(3);
    expect(dropIndexFor({ x: 10, y: 50 }, rects)).toBe(0);
    expect(dropIndexFor({ x: 10, y: 119 }, rects)).toBe(0);
    expect(dropIndexFor({ x: 10, y: 121 }, rects)).toBe(1);
    expect(dropIndexFor({ x: 10, y: 170 }, rects)).toBe(2);
    expect(dropIndexFor({ x: 10, y: 500 }, rects)).toBe(3);
  });

  it("returns 0 for an empty container", () => {
    expect(dropIndexFor({ x: 10, y: 10 }, [])).toBe(0);
  });

  it("measures along the x axis for horizontal lists", () => {
    const rects = [box(0, 0, 100, 40), box(110, 0, 100, 40)];
    expect(dropIndexFor({ x: 40, y: 10 }, rects, "x")).toBe(0);
    expect(dropIndexFor({ x: 60, y: 10 }, rects, "x")).toBe(1);
    expect(dropIndexFor({ x: 300, y: 10 }, rects, "x")).toBe(2);
  });
});

describe("neighboursAt", () => {
  const ids = ["a", "b", "c"];

  it("names the items that will sit before and after the slot", () => {
    expect(neighboursAt(ids, 0)).toEqual({ after_id: "a" });
    expect(neighboursAt(ids, 1)).toEqual({ before_id: "a", after_id: "b" });
    expect(neighboursAt(ids, 3)).toEqual({ before_id: "c" });
  });

  it("clamps out-of-range indices and handles empty lists", () => {
    expect(neighboursAt(ids, 9)).toEqual({ before_id: "c" });
    expect(neighboursAt(ids, -1)).toEqual({ after_id: "a" });
    expect(neighboursAt([], 0)).toEqual({});
  });

  it("is measured against the list without the dragged item", () => {
    expect(withoutId(["a", "x", "b"], "x")).toEqual(["a", "b"]);
    expect(neighboursAt(withoutId(["a", "x", "b"], "x"), 1)).toEqual({ before_id: "a", after_id: "b" });
  });
});

describe("isNoopDrop", () => {
  it("detects a drop back onto the original slot", () => {
    expect(isNoopDrop("b", "col", ["a", "b", "c"], { container: "col", index: 1 })).toBe(true);
    expect(isNoopDrop("b", "col", ["a", "b", "c"], { container: "col", index: 0 })).toBe(false);
    expect(isNoopDrop("b", "col", ["a", "b", "c"], { container: "col", index: 2 })).toBe(false);
    expect(isNoopDrop("b", "col", ["a", "b", "c"], { container: "other", index: 1 })).toBe(false);
  });
});

type Item = { id: string; column: string };
const adapter = {
  idOf: (item: Item) => item.id,
  containerOf: (item: Item) => item.column,
  withContainer: (item: Item, column: string) => ({ ...item, column }),
};
const items: Item[] = [
  { id: "t1", column: "todo" },
  { id: "t2", column: "todo" },
  { id: "p1", column: "progress" },
  { id: "d1", column: "done" },
];

describe("applyMove", () => {
  it("moves a card into another column at the requested slot", () => {
    const next = applyMove(items, { id: "t2", toContainer: "progress", index: 0 }, adapter);
    expect(next.map((i) => i.id)).toEqual(["t1", "t2", "p1", "d1"]);
    expect(next.find((i) => i.id === "t2")?.column).toBe("progress");
  });

  it("appends after the last sibling when the slot is at the end", () => {
    const next = applyMove(items, { id: "t1", toContainer: "progress", index: 1 }, adapter);
    expect(next.map((i) => i.id)).toEqual(["t2", "p1", "t1", "d1"]);
  });

  it("appends to the flat list when the target column is empty", () => {
    const next = applyMove(items, { id: "t1", toContainer: "review", index: 0 }, adapter);
    expect(next.map((i) => i.id)).toEqual(["t2", "p1", "d1", "t1"]);
    expect(next[3].column).toBe("review");
  });

  it("reorders within a column and keeps the other columns untouched", () => {
    const next = applyMove(items, { id: "t2", toContainer: "todo", index: 0 }, adapter);
    expect(next.map((i) => i.id)).toEqual(["t2", "t1", "p1", "d1"]);
  });

  it("returns a copy for an unknown id and never mutates the input", () => {
    const before = items.map((i) => ({ ...i }));
    const next = applyMove(items, { id: "nope", toContainer: "todo", index: 0 }, adapter);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
    expect(items).toEqual(before);
  });
});

describe("reorderIds", () => {
  it("reinserts the dragged id at the slot measured against the rest", () => {
    expect(reorderIds(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(reorderIds(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(reorderIds(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
  });
});

describe("autoScroll", () => {
  const options = { edge: 40, maxSpeed: 20 };

  it("is zero in the middle and outside the region", () => {
    expect(autoScrollVelocity(200, 0, 400, options)).toBe(0);
    expect(autoScrollVelocity(-5, 0, 400, options)).toBe(0);
    expect(autoScrollVelocity(405, 0, 400, options)).toBe(0);
  });

  it("ramps up towards the edges, negative at the start and positive at the end", () => {
    expect(autoScrollVelocity(0, 0, 400, options)).toBe(-20);
    expect(autoScrollVelocity(20, 0, 400, options)).toBe(-10);
    expect(autoScrollVelocity(40, 0, 400, options)).toBe(0);
    expect(autoScrollVelocity(380, 0, 400, options)).toBe(10);
    expect(autoScrollVelocity(400, 0, 400, options)).toBe(20);
  });

  it("covers both axes of a rect", () => {
    expect(autoScrollFor({ x: 10, y: 200 }, box(0, 0, 300, 400), options)).toEqual({ x: -15, y: 0 });
    expect(autoScrollFor({ x: 150, y: 395 }, box(0, 0, 300, 400), options)).toEqual({ x: 0, y: 18 });
  });

  it("ignores degenerate regions", () => {
    expect(autoScrollVelocity(5, 10, 10, options)).toBe(0);
    expect(autoScrollVelocity(5, 0, 10, { edge: 0, maxSpeed: 20 })).toBe(0);
  });
});
