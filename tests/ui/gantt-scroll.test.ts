// @vitest-environment jsdom
/**
 * Gantt "Today" scroll (decision 90; src/components/work-items/gantt-scroll.ts).
 * The offset math is pure; `centerTodayLine` measures the DOM, so the jsdom
 * cases give the elements fake rectangles. The label column is sticky, so the
 * line is centred in the bar area (viewport minus the label), not the viewport.
 */
import { describe, expect, it } from "vitest";
import { centerTodayLine, horizontalScroller, todayScrollLeft } from "@/components/work-items/gantt-scroll";

const base = { scrollerLeft: 0, scrollLeft: 0, labelWidth: 256, viewportWidth: 1000, scrollWidth: 5000 };

describe("todayScrollLeft", () => {
  it("puts the line in the middle of the bar area", () => {
    // Bar area is 744px wide: its middle is 256 + 372 = 628px from the scroller's left edge.
    expect(todayScrollLeft({ ...base, lineLeft: 2000 })).toBe(2000 - 628);
  });

  it("measures from the current scroll position, so repeating it is stable", () => {
    const first = todayScrollLeft({ ...base, lineLeft: 2000 });
    // After scrolling, the line sits at 628px on screen and the scroller reports the new scrollLeft.
    expect(todayScrollLeft({ ...base, lineLeft: 628, scrollLeft: first })).toBe(first);
  });

  it("subtracts the scroller's own offset in the page", () => {
    expect(todayScrollLeft({ ...base, scrollerLeft: 100, lineLeft: 2100 })).toBe(2000 - 628);
  });

  it("clamps to the scrollable range at both ends", () => {
    expect(todayScrollLeft({ ...base, lineLeft: 300 })).toBe(0);
    expect(todayScrollLeft({ ...base, lineLeft: 4990 })).toBe(4000);
  });

  it("is zero when nothing overflows", () => {
    expect(todayScrollLeft({ ...base, lineLeft: 500, scrollWidth: 1000 })).toBe(0);
  });

  it("centres at 375px, where the label column is 40% of the screen", () => {
    // 357px scroller, 143px label: the bar area is 214px, centred 107px from its start.
    const left = todayScrollLeft({ scrollerLeft: 0, scrollLeft: 0, lineLeft: 1200, labelWidth: 143, viewportWidth: 357, scrollWidth: 4000 });
    expect(1200 - left).toBe(143 + 107);
  });

  it("has no label to subtract in a timeline without one", () => {
    expect(todayScrollLeft({ ...base, labelWidth: 0, lineLeft: 2000 })).toBe(1500);
  });
});

function rect(left: number, width: number): DOMRect {
  return { left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) };
}

/** A scroller holding a gantt root with a label and a today line; every geometry is a stub. */
function build(opts: { scrollLeft: number; lineContentX: number; labelWidth: number; viewportWidth: number; scrollWidth: number; scrollerLeft?: number }) {
  const scroller = document.createElement("div");
  scroller.style.overflowX = "auto";
  const root = document.createElement("div");
  const label = document.createElement("div");
  label.className = "tessera-gantt-label";
  const line = document.createElement("div");
  line.className = "tessera-gantt-today";
  root.append(label, line);
  scroller.append(root);
  document.body.append(scroller);
  const scrollerLeft = opts.scrollerLeft ?? 0;
  const scrolls: { left?: number; behavior?: string }[] = [];
  Object.defineProperty(scroller, "clientWidth", { value: opts.viewportWidth });
  Object.defineProperty(scroller, "scrollWidth", { value: opts.scrollWidth });
  scroller.scrollLeft = opts.scrollLeft;
  scroller.getBoundingClientRect = () => rect(scrollerLeft, opts.viewportWidth);
  label.getBoundingClientRect = () => rect(scrollerLeft, opts.labelWidth);
  line.getBoundingClientRect = () => rect(scrollerLeft + opts.lineContentX - scroller.scrollLeft, 1);
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scrolls.push({ left: options.left, behavior: options.behavior });
    scroller.scrollLeft = options.left ?? 0;
  }) as typeof scroller.scrollTo;
  return { scroller, root, line, scrolls };
}

describe("centerTodayLine", () => {
  it("scrolls the nearest horizontal scroller until the line is centred in the bar area", () => {
    const { scroller, root, line, scrolls } = build({ scrollLeft: 0, lineContentX: 2000, labelWidth: 256, viewportWidth: 1000, scrollWidth: 5000 });
    expect(centerTodayLine(root)).toBe(true);
    expect(scrolls).toEqual([{ left: 1372, behavior: "instant" }]);
    expect(line.getBoundingClientRect().left).toBe(628);
    expect(scroller.scrollLeft).toBe(1372);
  });

  it("finds the same position when started from a scrolled timeline", () => {
    const { scroller, root } = build({ scrollLeft: 900, lineContentX: 2000, labelWidth: 256, viewportWidth: 1000, scrollWidth: 5000 });
    centerTodayLine(root);
    expect(scroller.scrollLeft).toBe(1372);
  });

  it("does nothing without a root or without a today line", () => {
    expect(centerTodayLine(null)).toBe(false);
    const bare = document.createElement("div");
    document.body.append(bare);
    expect(centerTodayLine(bare)).toBe(false);
  });
});

describe("horizontalScroller", () => {
  it("returns the nearest ancestor with horizontal overflow", () => {
    const outer = document.createElement("div");
    outer.style.overflowX = "scroll";
    const inner = document.createElement("div");
    inner.style.overflowX = "auto";
    const leaf = document.createElement("div");
    inner.append(leaf);
    outer.append(inner);
    document.body.append(outer);
    expect(horizontalScroller(leaf)).toBe(inner);
  });
});
