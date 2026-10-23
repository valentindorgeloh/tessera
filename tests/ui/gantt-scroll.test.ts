// @vitest-environment jsdom
/**
 * Gantt "Today" scroll (decision 90; src/components/work-items/gantt-scroll.ts).
 * The offset math is pure; `centerTodayLine` measures the DOM, so the jsdom
 * cases give the elements fake rectangles. The label column is sticky, so the
 * line is centred in the bar area (viewport minus the label), not the viewport.
 */
import { StrictMode, act, createElement, type ReactNode, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SETTLE_MS, centerTodayLine, horizontalScroller, todayScrollLeft, useTodayScroll } from "@/components/work-items/gantt-scroll";

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

  it("does nothing, and says so, while the scroller's content is not wider than its viewport (the first paint at phone width)", () => {
    const { scroller, root, scrolls } = build({ scrollLeft: 0, lineContentX: 2000, labelWidth: 143, viewportWidth: 357, scrollWidth: 357 });
    expect(centerTodayLine(root)).toBe(false);
    expect(scrolls).toEqual([]);
    expect(scroller.scrollLeft).toBe(0);
  });

  it("does nothing while the label column has no width", () => {
    const { root, scrolls } = build({ scrollLeft: 0, lineContentX: 2000, labelWidth: 0, viewportWidth: 357, scrollWidth: 4000 });
    expect(centerTodayLine(root)).toBe(false);
    expect(scrolls).toEqual([]);
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

describe("useTodayScroll while the layout settles (visual audit T4)", () => {
  const observers: { callback: () => void; observed: Element[]; disconnected: boolean }[] = [];
  const original = globalThis.ResizeObserver;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.ResizeObserver = original;
    observers.length = 0;
    document.body.replaceChildren();
  });

  /** Reports a size change to observer `index`, as a real observer does while it is connected. */
  async function resized(index = 0) {
    await act(async () => {
      if (!observers[index]?.disconnected) observers[index]?.callback();
    });
  }

  function stubObserver() {
    class Recording {
      entry = { callback: () => {}, observed: [] as Element[], disconnected: false };
      constructor(callback: () => void) {
        this.entry.callback = callback;
        observers.push(this.entry);
      }
      observe(element: Element) {
        this.entry.observed.push(element);
      }
      unobserve() {}
      disconnect() {
        this.entry.disconnected = true;
      }
    }
    globalThis.ResizeObserver = Recording as unknown as typeof ResizeObserver;
  }

  function Harness(): ReactNode {
    const { rootRef } = useTodayScroll("month", true);
    return createElement("div", { ref: rootRef as RefObject<HTMLDivElement> }, createElement("div", { className: "tessera-gantt-label" }), createElement("div", { className: "tessera-gantt-today" }));
  }

  /** A scroller whose width and content width the test changes, as the panel does while it streams in. */
  async function mount(initial: { clientWidth: number; scrollWidth: number }, isStrict = false) {
    stubObserver();
    const scroller = document.createElement("div");
    scroller.style.overflowX = "auto";
    document.body.append(scroller);
    const size = { ...initial };
    Object.defineProperty(scroller, "clientWidth", { get: () => size.clientWidth });
    Object.defineProperty(scroller, "scrollWidth", { get: () => size.scrollWidth });
    const scrolls: number[] = [];
    scroller.scrollTo = ((options: ScrollToOptions) => {
      scrolls.push(options.left ?? 0);
      scroller.scrollLeft = options.left ?? 0;
    }) as typeof scroller.scrollTo;
    scroller.getBoundingClientRect = () => rect(0, size.clientWidth);
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains("tessera-gantt-label")) return rect(0, 143);
      if (this.classList.contains("tessera-gantt-today")) return rect(1200 - scroller.scrollLeft, 1);
      return real.call(this);
    };
    const root = createRoot(scroller);
    await act(async () => {
      root.render(isStrict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness));
    });
    const cleanup = async () => {
      await act(async () => {
        root.unmount();
      });
      HTMLElement.prototype.getBoundingClientRect = real;
    };
    return { scroller, size, scrolls, cleanup };
  }

  /** Where the line must be scrolled to centre in a 143px label and a viewport `width` wide. */
  const centredAt = (width: number) => Math.round(1200 - (143 + (width - 143) / 2));

  it("waits for a layout that is not there yet, then centres and keeps watching", async () => {
    const { scroller, size, scrolls, cleanup } = await mount({ clientWidth: 357, scrollWidth: 357 });
    try {
      expect(scrolls).toEqual([]);
      expect(observers).toHaveLength(1);
      expect(observers[0]?.observed).toContain(scroller);

      size.scrollWidth = 4000; // the day columns have their layout now
      await resized();
      expect(scrolls).toEqual([centredAt(357)]);
      expect(observers[0]?.disconnected).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("centres again when the panel settles to a different width after the first centring", async () => {
    // The 375px phone case: the panel was 107px wide on the first try and 357px a moment later.
    const { size, scrolls, cleanup } = await mount({ clientWidth: 143 + 107, scrollWidth: 4000 });
    try {
      expect(scrolls).toEqual([centredAt(250)]);
      size.clientWidth = 357;
      await resized();
      expect(scrolls).toEqual([centredAt(250), centredAt(357)]);
    } finally {
      await cleanup();
    }
  });

  it("keeps watching through React's double effect in development", async () => {
    const { size, scrolls, cleanup } = await mount({ clientWidth: 143 + 107, scrollWidth: 4000 }, true);
    try {
      // The first effect run was cleaned up; the second one watches.
      expect(observers.map((entry) => entry.disconnected)).toEqual([true, false]);
      size.clientWidth = 357;
      await resized(1);
      expect(scrolls.at(-1)).toBe(centredAt(357));
    } finally {
      await cleanup();
    }
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])("stops once the reader acts (%s), so a later resize leaves the scroll alone", async (type) => {
    const { scroller, size, scrolls, cleanup } = await mount({ clientWidth: 357, scrollWidth: 4000 });
    try {
      expect(scrolls).toHaveLength(1);
      await act(async () => {
        scroller.dispatchEvent(new Event(type, { bubbles: true }));
      });
      expect(observers[0]?.disconnected).toBe(true);
      size.clientWidth = 250;
      await resized();
      expect(scrolls).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("stops watching after the settle window", async () => {
    vi.useFakeTimers();
    const { cleanup } = await mount({ clientWidth: 357, scrollWidth: 4000 });
    try {
      expect(observers[0]?.disconnected).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(SETTLE_MS - 1);
      });
      expect(observers[0]?.disconnected).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(observers[0]?.disconnected).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
