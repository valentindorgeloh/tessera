// @vitest-environment jsdom
/**
 * The scroller store of the virtual windows (src/components/virtual/VirtualScrollerProvider.tsx, decision 135):
 * server snapshot, skipped passes without layout, one emit per frame, offsets in a scrolled scroller, the computed
 * scroll padding, the near-viewport gate, and the default and nested stores. ResizeObserver and rAF are stubbed;
 * jsdom has no layout, so clientHeight, offsetParent and the rects are set by hand.
 */
import { act, createElement, Fragment, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScrollerStore,
  DEFAULT_SCROLLER_STORE,
  useScrollerMeasured,
  useScrollerStore,
  useScrollerViewport,
  VirtualScrollerProvider,
  type ScrollerStore,
} from "@/components/virtual/VirtualScrollerProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Manual frames: `run()` flushes every queued callback once. */
function frames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  return {
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      queue.set(next, cb);
      return next++;
    },
    cancelAnimationFrame: (id: number) => void queue.delete(id),
    pending: () => queue.size,
    run() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(0);
    },
  };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}

type Layout = { clientHeight: number; top: number; scrollTop: number; scrollPadding: string; visible: boolean };

function scroller(layout: Layout): HTMLElement {
  const el = document.createElement("div");
  el.append(document.createElement("div"));
  document.body.append(el);
  Object.defineProperty(el, "clientHeight", { get: () => layout.clientHeight });
  Object.defineProperty(el, "clientTop", { get: () => 0 });
  Object.defineProperty(el, "offsetParent", { get: () => (layout.visible ? document.body : null) });
  Object.defineProperty(el, "scrollTop", { get: () => layout.scrollTop, set: (v: number) => (layout.scrollTop = v) });
  el.style.setProperty("scroll-padding-block-start", layout.scrollPadding);
  el.getBoundingClientRect = () => ({ top: layout.top }) as DOMRect;
  return el;
}

/** An anchor whose content offset is `offset`: its rect moves up as the scroller scrolls. */
function anchor(parent: HTMLElement, layout: Layout, offset: number, height: number): HTMLElement {
  const el = document.createElement("ul");
  parent.firstElementChild?.append(el);
  el.getBoundingClientRect = () => ({ top: layout.top + offset - layout.scrollTop, height }) as DOMRect;
  return el;
}

let layout: Layout;
beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  layout = { clientHeight: 600, top: 50, scrollTop: 0, scrollPadding: "0px", visible: true };
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("createScrollerStore", () => {
  it("equals its server snapshot until measured", () => {
    const store = createScrollerStore(768, true, frames());
    expect({ measured: store.isMeasured(), viewport: store.viewport() }).toEqual({ measured: false, viewport: 768 });
  });

  it("skips a pass while the scroller has no layout", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const listener = vi.fn();
    store.subscribe(listener);
    layout.clientHeight = 0;
    store.attach(scroller(layout));
    f.run();
    expect(listener).not.toHaveBeenCalled();
    expect(store.isMeasured()).toBe(false);
    layout.clientHeight = 600;
    layout.visible = false;
    store.measureNow();
    expect(store.isMeasured()).toBe(false);
  });

  it("emits once for two changes in one frame and not for an unchanged pass", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const listener = vi.fn();
    store.subscribe(listener);
    const el = scroller(layout);
    store.attach(el);
    store.register("list:a", anchor(el, layout, 48, 400), 176);
    expect(f.pending()).toBe(1);
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.viewport()).toBe(600);
    expect(store.offsetOf("list:a")).toBe(48);
    store.measureNow();
    expect(listener).toHaveBeenCalledTimes(1);
    for (const ro of FakeResizeObserver.instances) ro.callback();
    for (const ro of FakeResizeObserver.instances) ro.callback();
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("measures offsets in a scrolled scroller and reads the scroll padding", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    layout.scrollTop = 1000;
    layout.scrollPadding = "12px";
    const el = scroller(layout);
    store.attach(el);
    store.register("list:b", anchor(el, layout, 2300, 400), 176);
    f.run();
    expect(store.offsetOf("list:b")).toBe(2300);
    expect(store.scrollPaddingStart()).toBe(12);
    expect(store.scrollTop()).toBe(1000);
  });

  it("recomputes near once per frame and emits only when a flag flips", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const el = scroller(layout);
    store.attach(el);
    store.register("list:far", anchor(el, layout, 3000, 400), 100);
    f.run();
    expect(store.isNear("list:far")).toBe(false);
    const listener = vi.fn();
    store.subscribe(listener);
    layout.scrollTop = 200;
    el.dispatchEvent(new Event("scroll"));
    layout.scrollTop = 300;
    el.dispatchEvent(new Event("scroll"));
    expect(f.pending()).toBe(1);
    f.run();
    expect(listener).not.toHaveBeenCalled();
    layout.scrollTop = 2500;
    el.dispatchEvent(new Event("scroll"));
    f.run();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.isNear("list:far")).toBe(true);
  });

  it("reads a gliding anchor at its layout place: the translate and transform of a move are taken out", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const el = scroller(layout);
    store.attach(el);
    // The group below a closing one is drawn 120px (translate) plus 30px (a transform) below its layout place mid-glide.
    const below = anchor(el, layout, 200 + 150, 400);
    const group = below.parentElement!;
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((node: Element) => {
      const style = real(node);
      if (node === group) return { ...style, getPropertyValue: style.getPropertyValue.bind(style), translate: "0px 120px", transform: "matrix(1, 0, 0, 1, 0, 30)" } as CSSStyleDeclaration;
      return style;
    });
    store.register("list:below", below, 176);
    f.run();
    expect(store.offsetOf("list:below")).toBe(200);
  });

  it("detaches its listener and observers", () => {
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const el = scroller(layout);
    const detach = store.attach(el);
    f.run();
    detach();
    expect(FakeResizeObserver.instances[0].observed.size).toBe(0);
    el.dispatchEvent(new Event("scroll"));
    expect(f.pending()).toBe(0);
    expect(store.element()).toBeNull();
  });
});

type ProviderProps = ComponentProps<typeof VirtualScrollerProvider>;

describe("the provider", () => {
  function Probe({ out }: { out: { store?: ScrollerStore; viewport?: number; measured?: boolean } }) {
    out.store = useScrollerStore();
    out.viewport = useScrollerViewport();
    out.measured = useScrollerMeasured();
    return null;
  }

  it("serves the server snapshot", () => {
    const out: { viewport?: number; measured?: boolean } = {};
    renderToString(createElement(VirtualScrollerProvider, { scroller: null } as ProviderProps, createElement(Probe, { out })));
    expect(out).toMatchObject({ viewport: 768, measured: false });
  });

  it("returns the default store without a provider, and a nested provider under it does not virtualise", async () => {
    const outer: { store?: ScrollerStore } = {};
    const nested: { store?: ScrollerStore } = {};
    const top: { store?: ScrollerStore } = {};
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, { out: outer }),
          createElement(VirtualScrollerProvider, { scroller: null, nested: true } as ProviderProps, createElement(Probe, { out: nested })),
          createElement(VirtualScrollerProvider, { scroller: null } as ProviderProps, createElement(Probe, { out: top })),
        ),
      );
    });
    expect(outer.store).toBe(DEFAULT_SCROLLER_STORE);
    expect(outer.store?.virtualizes).toBe(false);
    expect(nested.store?.virtualizes).toBe(false);
    expect(top.store?.virtualizes).toBe(true);
    await act(async () => root.unmount());
  });
});
