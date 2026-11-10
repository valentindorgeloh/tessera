/**
 * Pure maths of the virtual windows (src/components/virtual/virtual-math.ts, decisions 135-137): thresholds,
 * anchor offsets, estimated starts, the deterministic first window, the near-viewport gate, paddings (scrollMargin
 * subtracted once), kept rows, table spacers, and the small helpers.
 */
import { describe, expect, it } from "vitest";
import { ESTIMATE, INITIAL_BOARD_BODY, INITIAL_OVERSCAN, INITIAL_VIEWPORT, START, VIRTUAL_BOARD_MIN, VIRTUAL_GANTT_MIN, VIRTUAL_LIST_MIN, VIRTUAL_TABLE_MIN } from "@/components/virtual/virtual-config";
import {
  cssPx,
  estimateStarts,
  gateWindow,
  initialRange,
  isNavKey,
  isNearViewport,
  isOpenEnd,
  offsetWithin,
  paddings,
  partitionKept,
  shouldVirtualize,
  tableSegments,
  withKept,
} from "@/components/virtual/virtual-math";

const section = (rows: number, over: Partial<{ isOpen: boolean; hasBand: boolean; hasFooter: boolean; hasQuickAdd: boolean }> = {}) => ({
  rows,
  isOpen: true,
  hasBand: true,
  hasFooter: false,
  hasQuickAdd: false,
  ...over,
});

describe("shouldVirtualize", () => {
  it("turns on above each threshold", () => {
    expect([shouldVirtualize(30, VIRTUAL_LIST_MIN), shouldVirtualize(31, VIRTUAL_LIST_MIN)]).toEqual([false, true]);
    expect([shouldVirtualize(30, VIRTUAL_TABLE_MIN), shouldVirtualize(31, VIRTUAL_TABLE_MIN)]).toEqual([false, true]);
    expect([shouldVirtualize(40, VIRTUAL_GANTT_MIN), shouldVirtualize(41, VIRTUAL_GANTT_MIN)]).toEqual([false, true]);
    expect([shouldVirtualize(8, VIRTUAL_BOARD_MIN), shouldVirtualize(9, VIRTUAL_BOARD_MIN)]).toEqual([false, true]);
  });
});

describe("offsetWithin", () => {
  it("adds the scroll position and removes the scroller's border", () => {
    expect(offsetWithin(100, 50, 0, 0)).toBe(50);
    expect(offsetWithin(-300, 50, 400, 0)).toBe(50);
    expect(offsetWithin(-300, 50, 400, 1)).toBe(49);
  });
});

describe("estimateStarts", () => {
  it("starts a flat list after the block padding", () => {
    expect(estimateStarts([section(300, { hasBand: false })], "list")).toEqual([START.listPadding]);
  });

  it("stacks open and collapsed groups with bands and gaps", () => {
    const starts = estimateStarts([section(3), section(5, { isOpen: false }), section(2)], "list");
    const first = START.listPadding + START.groupBand;
    const second = first + 3 * ESTIMATE.list + START.groupGap + START.groupBand;
    const third = second + START.groupGap + START.groupBand;
    expect(starts).toEqual([first, second, third]);
  });

  it("adds footers and quick-add rows", () => {
    const starts = estimateStarts([section(2, { hasFooter: true, hasQuickAdd: true }), section(1)], "list");
    expect(starts[1] - starts[0]).toBe(2 * ESTIMATE.list + START.listFooter + START.quickAdd + START.groupGap + START.groupBand);
  });

  it("starts the table below its head", () => {
    expect(estimateStarts([section(100)], "table")).toEqual([START.tableHead]);
  });
});

describe("initialRange", () => {
  it("matches the refresh numbers", () => {
    const [first, second] = estimateStarts([section(5000), section(5000)], "list");
    const list = { size: ESTIMATE.list, gap: 0, viewport: INITIAL_VIEWPORT, overscan: INITIAL_OVERSCAN.list };
    expect(initialRange({ ...list, start: first, count: 5000 })).toEqual({ first: 0, last: 18 });
    expect(initialRange({ ...list, start: second, count: 5000 })).toBeNull();
    expect(initialRange({ ...list, start: START.listPadding, count: 10_000 })).toEqual({ first: 0, last: 19 });
    expect(initialRange({ start: START.tableHead, count: 10_000, size: ESTIMATE.table, gap: 0, viewport: INITIAL_VIEWPORT, overscan: INITIAL_OVERSCAN.table })).toEqual({ first: 0, last: 22 });
    expect(initialRange({ start: START.boardBodyPadding, count: 500, size: ESTIMATE.board, gap: 8, viewport: INITIAL_BOARD_BODY, overscan: INITIAL_OVERSCAN.board })).toEqual({ first: 0, last: 4 });
    expect(initialRange({ start: START.ganttBody, count: 10_000, size: ESTIMATE.gantt, gap: 0, viewport: INITIAL_VIEWPORT, overscan: INITIAL_OVERSCAN.gantt })).toEqual({ first: 0, last: 27 });
  });

  it("stops at the last row and has no window without rows", () => {
    expect(initialRange({ start: 8, count: 5, size: 44, gap: 0, viewport: 768, overscan: 2 })).toEqual({ first: 0, last: 4 });
    expect(initialRange({ start: 8, count: 0, size: 44, gap: 0, viewport: 768, overscan: 2 })).toBeNull();
  });
});

describe("isNearViewport", () => {
  const base = { size: 100, scrollTop: 1000, viewport: 500, margin: 50 };
  it("is false above and below, true inside and when touching the margin", () => {
    expect(isNearViewport({ ...base, start: 0 })).toBe(false);
    expect(isNearViewport({ ...base, start: 1200 })).toBe(true);
    expect(isNearViewport({ ...base, start: 2000 })).toBe(false);
    expect(isNearViewport({ ...base, start: 850 })).toBe(true);
    expect(isNearViewport({ ...base, start: 1550 })).toBe(true);
    expect(isNearViewport({ ...base, start: 849 })).toBe(false);
    expect(isNearViewport({ ...base, start: 1551 })).toBe(false);
  });
});

describe("paddings", () => {
  const span = (index: number, margin: number) => ({ start: margin + index * 44, end: margin + (index + 1) * 44 });
  const windowOf = (first: number, last: number, margin: number) => Array.from({ length: last - first + 1 }, (_, i) => span(first + i, margin));
  const total = 100 * 44;

  for (const margin of [0, 400]) {
    it(`subtracts scrollMargin ${margin} once`, () => {
      expect(paddings(windowOf(0, 19, margin), total, margin)).toEqual({ before: 0, after: 80 * 44 });
      expect(paddings(windowOf(40, 59, margin), total, margin)).toEqual({ before: 40 * 44, after: 40 * 44 });
      expect(paddings(windowOf(80, 99, margin), total, margin)).toEqual({ before: 80 * 44, after: 0 });
    });
  }

  it("pads the whole size for an empty window", () => {
    expect(paddings([], total, 400)).toEqual({ before: 0, after: total });
  });
});

describe("withKept and partitionKept", () => {
  it("merges, de-duplicates and limits to the rows", () => {
    expect(withKept([3, 4, 5], [4, 9, -1, 12, 1.5], 10)).toEqual([3, 4, 5, 9]);
    expect(withKept([3, 4], [], 10)).toEqual([3, 4]);
  });

  it("splits kept rows before, inside and after the window", () => {
    expect(partitionKept([1, 5, 6, 7, 20], 5, 7)).toEqual({ before: [1], window: [5, 6, 7], after: [20] });
    expect(partitionKept([5, 6], 5, 7)).toEqual({ before: [], window: [5, 6], after: [] });
  });

  it("gateWindow keeps a kept row in range while the anchor is not near yet", () => {
    const parts = { before: [1], window: [3, 4, 5], after: [20] };
    expect(gateWindow(parts, true, [3])).toBe(parts);
    expect(gateWindow(parts, false, [3])).toEqual({ before: [1, 3], window: [], after: [20] });
    expect(gateWindow(parts, false, [])).toEqual({ before: [1], window: [], after: [20] });
  });
});

describe("tableSegments", () => {
  const row = (index: number, margin = 30) => ({ index, start: margin + index * 37, end: margin + (index + 1) * 37 });
  const total = 100 * 37;

  it("adds only a bottom spacer at the top", () => {
    expect(tableSegments([row(0), row(1)], total, 30)).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "spacer", id: "virtual:bottom", height: 98 * 37 },
    ]);
  });

  it("adds only a top spacer at the bottom", () => {
    expect(tableSegments([row(98), row(99)], total, 30)).toEqual([
      { kind: "spacer", id: "virtual:top", height: 98 * 37 },
      { kind: "row", index: 98 },
      { kind: "row", index: 99 },
    ]);
  });

  it("adds both in the middle, and splits around kept rows", () => {
    expect(tableSegments([row(2), row(50), row(51), row(90)], total, 30)).toEqual([
      { kind: "spacer", id: "virtual:top", height: 2 * 37 },
      { kind: "row", index: 2 },
      { kind: "spacer", id: "virtual:gap-1", height: 47 * 37 },
      { kind: "row", index: 50 },
      { kind: "row", index: 51 },
      { kind: "spacer", id: "virtual:gap-2", height: 38 * 37 },
      { kind: "row", index: 90 },
      { kind: "spacer", id: "virtual:bottom", height: 9 * 37 },
    ]);
  });

  it("drops sub-pixel spacers and covers an empty body", () => {
    const rows = [
      { index: 0, start: 30.2, end: 67 },
      { index: 2, start: 67.3, end: 104 },
    ];
    expect(tableSegments(rows, 74, 30)).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 2 },
    ]);
    expect(tableSegments([], 500, 30)).toEqual([{ kind: "spacer", id: "virtual:top", height: 500 }]);
  });
});

describe("small helpers", () => {
  it("isOpenEnd", () => {
    expect(isOpenEnd(18, 20)).toBe(true);
    expect(isOpenEnd(19, 20)).toBe(false);
  });

  it("isNavKey excludes modifiers", () => {
    const key = (k: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
    for (const k of ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) expect(isNavKey(key(k))).toBe(true);
    expect(isNavKey(key("Enter"))).toBe(false);
    expect(isNavKey(key("ArrowDown", { shiftKey: true }))).toBe(false);
    expect(isNavKey(key("Home", { metaKey: true }))).toBe(false);
  });

  it("cssPx rounds and clamps", () => {
    expect(cssPx(12.4)).toBe("12px");
    expect(cssPx(12.5)).toBe("13px");
    expect(cssPx(-3)).toBe("0px");
  });
});
