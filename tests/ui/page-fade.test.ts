// @vitest-environment jsdom
/**
 * The page change fade (src/components/shell/PageFade.tsx): the content dips to
 * 0.4 and animates back to 1 when the pathname changes, and does nothing on the
 * first render, on a search-only change, or on Back and Forward (a popstate).
 * The router and the animator are stubbed; tests/e2e/motion-shell.spec.ts runs
 * the real thing in a browser.
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ pathname: "/inbox" }));
const animator = vi.hoisted(() => ({ set: vi.fn(), animate: vi.fn(() => Promise.resolve()), stop: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => router.pathname }));
vi.mock("@astryxdesign/core/hooks", () => ({ useAnimator: () => animator }));

import { PageFade } from "@/components/shell/PageFade";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
beforeEach(() => {
  router.pathname = "/inbox";
  animator.set.mockClear();
  animator.animate.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const target = createRef<HTMLElement>();
const render = () => act(() => root!.render(createElement(PageFade, { targetRef: target })));
function mount() {
  root = createRoot(document.createElement("div"));
  render();
}
const goTo = (pathname: string) => {
  router.pathname = pathname;
  render();
};
/** A macrotask: the "same task" flag is over. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PageFade", () => {
  it("does nothing on the first render (first load, hydration)", () => {
    mount();
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("dips to 0.4 and animates back to 1 on a pathname change", () => {
    mount();
    goTo("/");
    expect(animator.set).toHaveBeenCalledTimes(1);
    expect(animator.set).toHaveBeenCalledWith({ opacity: 0.4 });
    expect(animator.animate).toHaveBeenCalledTimes(1);
    expect(animator.animate).toHaveBeenCalledWith({ opacity: 1 }); // no velocity: it would overshoot
    expect(animator.set.mock.invocationCallOrder[0]).toBeLessThan(animator.animate.mock.invocationCallOrder[0]);
  });

  it("does nothing while the pathname stays (a search-only change, the agent refresh)", () => {
    mount();
    render();
    render();
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("fades again on each pathname change", () => {
    mount();
    goTo("/");
    goTo("/projects");
    expect(animator.animate).toHaveBeenCalledTimes(2);
  });

  it("skips a pathname change that follows a popstate (Back or Forward, popstate first)", () => {
    mount();
    window.dispatchEvent(new PopStateEvent("popstate"));
    goTo("/");
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("ends a dip that Next committed before the popstate listener ran, in the same task", () => {
    mount();
    goTo("/"); // Next's listener restored the route first: the layout effect started the dip
    expect(animator.set).toHaveBeenLastCalledWith({ opacity: 0.4 });
    window.dispatchEvent(new PopStateEvent("popstate")); // this listener, still inside the same event dispatch
    expect(animator.set).toHaveBeenLastCalledWith({ opacity: 1 });
  });

  it("leaves a dip from an earlier task alone when a popstate arrives", async () => {
    mount();
    goTo("/");
    await nextTask();
    animator.set.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("stops listening when it unmounts", () => {
    mount();
    const remove = vi.spyOn(window, "removeEventListener");
    act(() => root!.unmount());
    root = null;
    expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function));
    remove.mockRestore();
  });
});
