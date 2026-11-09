// @vitest-environment jsdom
/**
 * The layout, period and zoom fade (src/components/work-items/use-view-fade.ts): the work items scroller dips to
 * 0.4 and animates back to 1 when the view key changes, and does nothing on the first render, while the key stays
 * (a filter, a sort, the agent refresh) or on Back and Forward (a popstate). The animator is stubbed;
 * tests/e2e/motion-work-items.spec.ts runs the real thing in a browser.
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const animator = vi.hoisted(() => ({ set: vi.fn(), animate: vi.fn(() => Promise.resolve()), stop: vi.fn() }));
vi.mock("@astryxdesign/core/hooks", () => ({ useAnimator: () => animator }));

import { useViewFade } from "@/components/work-items/use-view-fade";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
beforeEach(() => {
  animator.set.mockClear();
  animator.animate.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const target = createRef<HTMLElement>();
function Probe({ viewKey, tick }: { viewKey: string; tick: number }) {
  useViewFade(target, viewKey);
  return createElement("span", { "data-tick": tick });
}
let tick = 0;
const render = (viewKey: string) => act(() => root!.render(createElement(Probe, { viewKey, tick: (tick += 1) })));
function mount(viewKey: string) {
  root = createRoot(document.createElement("div"));
  render(viewKey);
}
/** A macrotask: the "same task" flag is over. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("useViewFade", () => {
  it("does nothing on the first render (first load, hydration)", () => {
    mount("list");
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("dips to 0.4 and animates back to 1 when the layout changes", () => {
    mount("list");
    render("board");
    expect(animator.set).toHaveBeenCalledTimes(1);
    expect(animator.set).toHaveBeenCalledWith({ opacity: 0.4 });
    expect(animator.animate).toHaveBeenCalledTimes(1);
    expect(animator.animate).toHaveBeenCalledWith({ opacity: 1 }); // no velocity: it would overshoot
    expect(animator.set.mock.invocationCallOrder[0]).toBeLessThan(animator.animate.mock.invocationCallOrder[0]);
  });

  it("does nothing while the key stays (a filter, a sort, a data refresh)", () => {
    mount("list");
    render("list");
    render("list");
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("fades again on each change: a calendar period, month or week, a Gantt zoom", () => {
    mount("calendar:month:");
    render("calendar:month:2026-11-02");
    render("calendar:week:2026-11-02");
    render("gantt:month");
    render("gantt:week");
    expect(animator.animate).toHaveBeenCalledTimes(4);
  });

  it("skips a change that follows a popstate (Back or Forward, popstate first)", () => {
    mount("list");
    window.dispatchEvent(new PopStateEvent("popstate"));
    render("board");
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("ends a dip that Next committed before the popstate listener ran, in the same task", () => {
    mount("list");
    render("board"); // Next's listener restored the URL first: the layout effect started the dip
    expect(animator.set).toHaveBeenLastCalledWith({ opacity: 0.4 });
    window.dispatchEvent(new PopStateEvent("popstate")); // this listener, still inside the same event dispatch
    expect(animator.set).toHaveBeenLastCalledWith({ opacity: 1 });
  });

  it("leaves a dip from an earlier task alone when a popstate arrives", async () => {
    mount("list");
    render("board");
    await nextTask();
    animator.set.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", () => {
    mount("list");
    const remove = vi.spyOn(window, "removeEventListener");
    act(() => root!.unmount());
    root = null;
    expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function));
    remove.mockRestore();
  });
});
