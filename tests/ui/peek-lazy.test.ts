// @vitest-environment jsdom
/**
 * The peek's detail is a lazy chunk (decision 142, src/components/detail/peek-detail-lazy.tsx):
 * PeekHost has no static import of WorkItemDetail left, a peek opened before the chunk
 * arrives shows the skeleton, and the preload fires once, on idle or on the first row contact.
 */
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PRELOAD_DELAY_MS, schedulePreload, type PreloadWindow } from "@/components/detail/peek-detail-lazy";

const gate = vi.hoisted(() => {
  const state: { ready: Promise<void>; release: () => void } = { ready: Promise.resolve(), release: () => {} };
  /** A fresh closed gate: the stubbed chunk resolves only after `release()`. */
  const close = () => {
    state.ready = new Promise<void>((resolve) => {
      state.release = resolve;
    });
  };
  close();
  return { state, close };
});

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("PeekHost source", () => {
  const host = read("src/components/detail/PeekHost.tsx");

  it("has no static import of WorkItemDetail (the editor leaves the list routes' first load)", () => {
    expect(host).not.toMatch(/^import .*from "\.\/WorkItemDetail"/m);
    expect(host).not.toMatch(/^import .*from "@\/components\/detail(\/WorkItemDetail|\/index)?"/m);
    expect(host).toContain('from "./peek-detail-lazy"');
  });

  it("declares next/dynamic once, at module top level of the lazy file", () => {
    const lazy = read("src/components/detail/peek-detail-lazy.tsx");
    expect(lazy.match(/^export const LazyWorkItemDetail = dynamic<[^>]*>\(/gm)).toHaveLength(1);
    expect(lazy).toContain('import("./WorkItemDetail")');
  });
});

describe("the lazy detail", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  type Lazy = typeof import("@/components/detail/peek-detail-lazy");
  const props = (extra: object = {}) => ({ data: {}, host: "peek", onClose: () => {}, onHostChange: () => {}, onOpenItem: () => {}, ...extra }) as never;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  // Fresh module state per case: the loaded component is module state, and the stubbed chunk starts closed.
  async function setup(): Promise<Lazy> {
    vi.resetModules();
    gate.close();
    // The real WorkItemDetail pulls the editor; the stub resolves when the test releases the gate.
    vi.doMock("@/components/detail/WorkItemDetail", async () => {
      await gate.state.ready;
      return { WorkItemDetail: () => createElement("section", { "data-detail-stub": "" }, "detail") };
    });
    const lazy = await import("@/components/detail/peek-detail-lazy");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    return lazy;
  }
  const render = (node: ReturnType<typeof createElement>) => act(async () => root?.render(node));
  const release = () =>
    act(async () => {
      gate.state.release();
      await vi.dynamicImportSettled();
    });
  const stub = () => container?.querySelector("[data-detail-stub]") ?? null;

  afterEach(async () => {
    const current = root;
    if (current) await act(async () => current.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("shows the skeleton, never an empty panel, until the chunk arrives, then the detail", async () => {
    const { LazyWorkItemDetail } = await setup();
    const onMountedChange = vi.fn();
    await render(createElement(LazyWorkItemDetail, props({ onMountedChange })));
    expect(stub()).toBeNull();
    expect(container?.innerHTML).not.toBe("");
    expect(container?.textContent).not.toContain("detail");
    expect(onMountedChange).not.toHaveBeenCalled();
    await release();
    expect(stub()).not.toBeNull();
    // PeekHost moves focus into the detail only once it is mounted (the skeleton has nothing to focus).
    expect(onMountedChange.mock.calls).toEqual([[true]]);
    const current = root;
    await act(async () => current?.unmount());
    root = null;
    expect(onMountedChange.mock.calls).toEqual([[true], [false]]);
  });

  it("PeekDetail opened before the chunk is loaded shows the skeleton, then the detail, and keeps the same DOM when it re-renders", async () => {
    const { PeekDetail } = await setup();
    await render(createElement(PeekDetail, props()));
    expect(stub()).toBeNull();
    expect(container?.innerHTML).not.toBe("");
    await release();
    const first = stub();
    expect(first).not.toBeNull();
    await render(createElement(PeekDetail, props({ host: "modal" })));
    expect(stub()).toBe(first);
  });

  it("PeekDetail opened after the preload renders the detail in the commit that opens it, with no skeleton step", async () => {
    const { PeekDetail, preloadPeekDetail } = await setup();
    preloadPeekDetail();
    await release();
    const onMountedChange = vi.fn();
    // One synchronous render: a next/dynamic component would suspend here and hold its fallback for 300 ms.
    act(() => root?.render(createElement(PeekDetail, props({ onMountedChange }))));
    expect(stub()).not.toBeNull();
    expect(onMountedChange.mock.calls).toEqual([[true]]);
  });

  it("repeating the preload is harmless", async () => {
    const { preloadPeekDetail } = await setup();
    preloadPeekDetail();
    preloadPeekDetail();
    await release();
    preloadPeekDetail();
    // Settling the preload's imports (release() above) takes about 2.7 s alone and over 5 s beside the other jsdom files
    // of a full run, so this case gets its own limit.
    await vi.dynamicImportSettled();
  }, 30_000);
});

type Listener = (event: Event) => void;

/** A stand-in for `window`: records timers, the idle callback and the document listeners. */
function fakeWindow(options: { hasIdle: boolean }) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, () => void>();
  const idle = new Map<number, () => void>();
  let nextHandle = 1;
  const win: PreloadWindow = {
    setTimeout: (callback) => {
      timers.set(nextHandle, callback);
      return nextHandle++;
    },
    clearTimeout: (handle) => void timers.delete(handle),
    document: {
      addEventListener: (name: string, listener: unknown) => void (listeners.get(name) ?? listeners.set(name, new Set()).get(name))?.add(listener as Listener),
      removeEventListener: (name: string, listener: unknown) => void listeners.get(name)?.delete(listener as Listener),
    } as PreloadWindow["document"],
  };
  if (options.hasIdle) {
    win.requestIdleCallback = (callback) => {
      idle.set(nextHandle, callback);
      return nextHandle++;
    };
    win.cancelIdleCallback = (handle) => void idle.delete(handle);
  }
  const listenerCount = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  const dispatch = (name: string, target: unknown) => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener({ target } as unknown as Event);
  };
  return { win, timers, idle, listenerCount, dispatch };
}

const rowTarget = { closest: (selector: string) => (selector === ".tessera-wi-row" ? {} : null) };
const otherTarget = { closest: () => null };

describe("schedulePreload", () => {
  it("fires once when the browser is idle, then removes its listeners", () => {
    const fake = fakeWindow({ hasIdle: true });
    const fn = vi.fn();
    schedulePreload(fake.win, fn);
    expect(fake.listenerCount()).toBe(2);
    expect(fn).not.toHaveBeenCalled();
    for (const callback of [...fake.idle.values()]) callback();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(0);
    fake.dispatch("pointerover", rowTarget);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses a 1500 ms timer where requestIdleCallback does not exist", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const idle = fakeWindow({ hasIdle: false });
      schedulePreload({ ...idle.win, setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: (handle) => window.clearTimeout(handle) }, fn);
      vi.advanceTimersByTime(PRELOAD_DELAY_MS - 1);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires on the first pointerover or focusin on a list row, once, and cancels the idle wait", () => {
    for (const name of ["pointerover", "focusin"]) {
      const fake = fakeWindow({ hasIdle: true });
      const fn = vi.fn();
      schedulePreload(fake.win, fn);
      fake.dispatch(name, otherTarget);
      expect(fn).not.toHaveBeenCalled();
      fake.dispatch(name, rowTarget);
      fake.dispatch(name === "focusin" ? "pointerover" : "focusin", rowTarget);
      fake.dispatch(name, rowTarget);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fake.idle.size).toBe(0);
      expect(fake.listenerCount()).toBe(0);
    }
  });

  it("the timer fallback is cleared by a row contact, so the idle path cannot fire it a second time", () => {
    const fake = fakeWindow({ hasIdle: false });
    const fn = vi.fn();
    schedulePreload(fake.win, fn);
    fake.dispatch("pointerover", rowTarget);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.timers.size).toBe(0);
  });

  it("its cancel function stops everything without firing", () => {
    const fake = fakeWindow({ hasIdle: true });
    const fn = vi.fn();
    const cancel = schedulePreload(fake.win, fn);
    cancel();
    expect(fake.idle.size).toBe(0);
    expect(fake.listenerCount()).toBe(0);
    fake.dispatch("pointerover", rowTarget);
    expect(fn).not.toHaveBeenCalled();
  });
});
