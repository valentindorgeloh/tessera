// @vitest-environment jsdom
/**
 * Bringing a moved item's row into its virtual window (src/components/virtual/reveal.ts and the revealer that
 * src/components/virtual/use-virtual-rows.ts registers, decisions 135-137). The focus-follow of a moved work item
 * (src/components/work-items/focus-follow.ts) asks the screen's scroller from the screen's layout effect, in the very
 * commit that moved the item, so every container must already answer with that commit's rows; and a board column
 * windows inside its own nested scroller, which the screen's scroller must find too.
 *
 * jsdom has no layout: the scrollers get their sizes by hand and TanStack's instance is a small fake, one per group,
 * whose `scrollToIndex` calls are recorded per group.
 */
import { act, createElement, useCallback, useEffect, useLayoutEffect, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Range } from "@tanstack/react-virtual";

type FakeOptions = { count: number; enabled: boolean; overscan: number; getItemKey: (i: number) => string; rangeExtractor: (r: Range) => number[] };
type FakeInstance = {
  options: FakeOptions | null;
  range: { startIndex: number; endIndex: number } | null;
  getVirtualItems: () => { index: number; key: string; start: number; end: number; size: number; lane: number }[];
  getTotalSize: () => number;
  scrollToIndex: (index: number) => void;
  measureElement: () => void;
  measurementsCache: unknown[];
  indexFromElement: (el: Element) => number;
};

const fake = vi.hoisted(() => ({ calls: new Map<string, number[]>(), instances: new Map<string, unknown>() }));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  /** One instance per container, found by the group name its keys start with ("A-x0" is group A). */
  function fakeVirtualizer(options: FakeOptions): FakeInstance {
    const name = options.getItemKey(0)?.split("-")[0] ?? "";
    let instance = fake.instances.get(name) as FakeInstance | undefined;
    if (!instance) {
      const created: FakeInstance = {
        options: null,
        range: null,
        getVirtualItems: () => [],
        getTotalSize: () => 0,
        // Records which container was asked for which index.
        scrollToIndex: (index) => fake.calls.set(name, [...(fake.calls.get(name) ?? []), index]),
        measureElement: () => {},
        measurementsCache: [],
        indexFromElement: (el) => Number(el.getAttribute("data-index")),
      };
      fake.instances.set(name, created);
      instance = created;
    }
    instance.options = options;
    const indexes = options.enabled && options.count > 0 ? options.rangeExtractor({ startIndex: 0, endIndex: 1, overscan: options.overscan, count: options.count }) : [];
    instance.range = options.enabled ? { startIndex: 0, endIndex: 1 } : null;
    instance.getVirtualItems = () => indexes.map((index) => ({ index, key: options.getItemKey(index), start: index * 44, end: (index + 1) * 44, size: 44, lane: 0 }));
    instance.getTotalSize = () => options.count * 44;
    return instance;
  }
  return { ...actual, useVirtualizer: (options: FakeOptions) => fakeVirtualizer(options) };
});

const { registerRevealer, revealKey, keyNamesItem } = await import("@/components/virtual/reveal");
const { useVirtualRows } = await import("@/components/virtual/use-virtual-rows");
const { VirtualScrollerProvider } = await import("@/components/virtual/VirtualScrollerProvider");

/** Manual animation frames. */
const frameQueue = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
function runFrames() {
  for (let round = 0; round < 4; round += 1) {
    const callbacks = [...frameQueue.values()];
    frameQueue.clear();
    for (const cb of callbacks) cb(0);
  }
}

/** A scroll element with a layout: 600 px tall. */
function layoutElement(parent: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  parent.append(el);
  Object.defineProperty(el, "clientHeight", { get: () => 600 });
  Object.defineProperty(el, "offsetParent", { get: () => document.body });
  el.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600, left: 0, right: 800, width: 800, x: 0, y: 0 }) as DOMRect;
  el.scrollTo = () => {};
  return el;
}

/** One windowed container, keyed "<name>-<item>" per row, as a list group or a board column renders it. */
function Group({ name, items }: { name: string; items: readonly string[] }): ReactNode {
  const getKey = useCallback((index: number) => `${name}-${items[index]}`, [name, items]);
  const v = useVirtualRows({ anchorId: `list:${name}`, kind: "list", count: items.length, getKey, isEnabled: true, estimateStart: 0 });
  return createElement(
    "ul",
    { ref: v.anchorRef, className: v.anchorClassName, "data-live": v.measureRef ? "" : undefined },
    v.rendered.map((row) => createElement("li", { key: row.key, "data-index": row.index }, row.key)),
  );
}

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Set by the mounted screen: moves item "MOVED" from the end of group A to the end of group B. */
const controls = { move: () => {} };
const asked: boolean[] = [];

/**
 * The screen: two groups, and a layout effect that asks the scroller for the moved item in the commit that moved it, as
 * useFocusFollow does. `nested` puts group B inside its own scroller, as a board column body.
 */
function Screen({ scroller, column }: { scroller: HTMLElement; column: HTMLElement | null }): ReactNode {
  const [a, setA] = useState(() => [...many("x", 30), "MOVED"]);
  const [b, setB] = useState(() => many("y", 30));
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    controls.move = () => {
      setA(many("x", 30));
      setB([...many("y", 30), "MOVED"]);
      setMoved(true);
    };
  }, []);
  useLayoutEffect(() => {
    if (moved) asked.push(revealKey(scroller, (key) => key.endsWith("-MOVED")));
  }, [moved, scroller]);
  const groupB = createElement(Group, { name: "B", items: b });
  return createElement(
    VirtualScrollerProvider,
    { scroller } as ComponentProps<typeof VirtualScrollerProvider>,
    createElement(Group, { name: "A", items: a }),
    column ? createElement(VirtualScrollerProvider, { scroller: column, nested: true } as ComponentProps<typeof VirtualScrollerProvider>, groupB) : groupB,
  );
}

let root: Root | null = null;

async function mountScreen(nested: boolean) {
  const scroller = layoutElement(document.body);
  const column = nested ? layoutElement(scroller) : null;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Screen, { scroller, column })));
  await act(async () => runFrames());
  return host;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameQueue.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frameQueue.delete(id));
  fake.calls = new Map();
  fake.instances = new Map();
  asked.length = 0;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  root = null;
  frameQueue.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("revealKey", () => {
  it("asks the containers of a scroller nested inside the one asked, and none outside it", () => {
    const screen = document.createElement("div");
    const column = document.createElement("div");
    const elsewhere = document.createElement("div");
    screen.append(column);
    const seen: string[] = [];
    const offs = [
      registerRevealer(column, (matches) => (seen.push("column"), matches("card"))),
      registerRevealer(elsewhere, (matches) => (seen.push("elsewhere"), matches("card"))),
    ];
    expect(revealKey(screen, (key) => key === "card")).toBe(true);
    expect(seen).toEqual(["column"]);
    offs.forEach((off) => off());
    expect(revealKey(screen, (key) => key === "card")).toBe(false);
  });

  it("names a work item by a plain key and by a grouped table key", () => {
    expect(keyNamesItem("abc", "abc")).toBe(true);
    expect(keyNamesItem("group:abc", "abc")).toBe(true);
    expect(keyNamesItem("abcd", "abc")).toBe(false);
  });
});

describe("a moved item's row, asked for in the commit that moved it", () => {
  it("is brought in by the group it moved to, at its new index, and not by the group it left", async () => {
    const host = await mountScreen(false);
    expect(host.querySelectorAll("ul[data-live]")).toHaveLength(2);
    await act(async () => controls.move());
    expect(asked).toEqual([true]);
    expect(fake.calls.get("B")).toEqual([30]);
    expect(fake.calls.get("A")).toBeUndefined();
  });

  it("is brought in by a board column that windows inside its own scroller", async () => {
    const host = await mountScreen(true);
    expect(host.querySelectorAll("ul[data-live]")).toHaveLength(2);
    await act(async () => controls.move());
    expect(asked).toEqual([true]);
    expect(fake.calls.get("B")).toEqual([30]);
    expect(fake.calls.get("A")).toBeUndefined();
  });
});
