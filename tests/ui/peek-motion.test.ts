// @vitest-environment jsdom
/**
 * The peek's motion (src/components/detail/PeekHost.tsx, docs/contracts/ui.md "Motion"): the side panel slides in when
 * it opens after mount, and a close starts its navigation at once while the CSS exit runs; the host keeps the leaving
 * item on screen until the exit ends, a second close does nothing, a cancelled exit closes nothing, and focus still
 * returns to the row (decision 11). Switching items in place dips the shared mount node and fades it back. A panel that
 * covers the list fades instead of sliding, the leaving panel is inert, and nothing animates for the browser's Back and
 * Forward (a popstate), which the panel's own Back (a close) is not.
 * jsdom runs no CSS animation: `getAnimations` is stubbed with a fake exit the test finishes or cancels, and the
 * animator is a spy. tests/e2e/motion-panels.spec.ts runs the real stylesheet in a browser.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekData } from "@/components/detail/PeekHost";
import { notePeekPush } from "@/components/detail/peek-history";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  pathname: "/projects/p/work-items",
  search: "",
}));
const animator = vi.hoisted(() => ({ set: vi.fn(), animate: vi.fn(() => Promise.resolve()), stop: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@astryxdesign/core/hooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/hooks")>()), useAnimator: () => animator }));
vi.mock("@/components/detail/WorkItemDetail", () => ({
  WorkItemDetail: ({ onClose }: { onClose: () => void }) =>
    createElement(
      "div",
      null,
      createElement("button", { type: "button", "aria-label": "Close", onClick: onClose }, "Close"),
      createElement("input", { "aria-label": "Title", "data-testid": "detail-input" }),
    ),
}));

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
const OTHER = "33333333-3333-7333-8333-333333333333";
const item = (id: string) => ({ id, data: { item: { id, project_id: PROJECT } } }) as unknown as PeekData;
const peek = item(ITEM);

/** The width the faked layout gives every element (the panel's container reads it): 1000 leaves room beside the list, 400 covers it. */
const layout = { width: 1000 };
let container: HTMLElement | null = null;
let root: Root | null = null;

/** What `getAnimations` returns for an element marked `data-exiting`: nothing (no animation), or a fake exit the test settles. */
const exit = { current: null as null | { finish: () => void; cancel: () => void } };
function runExit() {
  let finish!: () => void;
  let cancel!: () => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    cancel = () => reject(new DOMException("cancelled", "AbortError"));
  });
  finished.catch(() => {});
  const animation = { animationName: "tessera-slide-out-end", finished } as unknown as Animation;
  const pending = { finish, cancel };
  exit.current = pending;
  return animation;
}
let fakeExit: Animation | null = null;

beforeAll(async () => {
  // PeekHost pulls in Astryx's Layout and the stack around it: load it here, under the hook's own limit (see peek-inert.test.ts).
  await import("@/components/detail/PeekHost");
  await import("@/components/detail/peek-prefs");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    private readonly targets = new Set<Element>();
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.targets.add(target);
      this.callback([{ target } as ResizeObserverEntry], this);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: layout.width, bottom: 0, width: layout.width, height: 0, toJSON: () => ({}) };
  };
  Element.prototype.getAnimations = function getAnimations(this: Element) {
    return this.hasAttribute("data-exiting") && fakeExit !== null ? [fakeExit] : [];
  };
}, 60_000);

beforeEach(() => {
  nav.search = "";
  nav.router.push.mockClear();
  nav.router.replace.mockClear();
  nav.router.back.mockClear();
  animator.set.mockClear();
  animator.animate.mockClear();
  fakeExit = null;
  exit.current = null;
  layout.width = 1000;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
  savePeekPrefs({ mode: "side" });
  window.sessionStorage.clear();
});

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}

async function host(peekData: PeekData | null) {
  const { PeekHost } = await import("@/components/detail/PeekHost");
  const hostProps = { projectId: PROJECT, peek: peekData } as ComponentProps<typeof PeekHost>;
  return createElement(PeekHost, hostProps, createElement("button", { type: "button", "data-testid": "row-key" }, "WEB-1"));
}
async function show(peekData: PeekData | null) {
  const node = await host(peekData);
  await act(async () => root?.render(node));
}

const panel = () => document.querySelector<HTMLElement>(".tessera-peek-panel");
const closeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
const input = () => document.querySelector<HTMLInputElement>('[data-testid="detail-input"]');
const list = () => document.querySelector<HTMLElement>('[data-testid="row-key"]')?.closest(".astryx-layout-content") as HTMLElement | null;
const mountNode = () => document.querySelector<HTMLElement>(".tessera-peek-node");

/** Opens a side peek the way the list does: mounted closed, then the URL names an item. */
async function openPeek() {
  await mount(await host(null));
  await show(peek);
  await act(async () => vi.dynamicImportSettled());
}

describe("the side panel slides in", () => {
  it("carries the slide class and data-enter when the peek opens after mount, and drops data-enter when the slide ends", async () => {
    await mount(await host(null));
    expect(panel()).toBeNull();
    await show(peek);
    const element = panel();
    expect(element?.className).toContain("tessera-motion-slide-end");
    expect(element?.hasAttribute("data-enter")).toBe(true);
    // The panel's own animationend ends the enter (a child's would not).
    await act(async () => {
      // jsdom's style declaration has no `animation` property, so React listens for the prefixed name there; a browser fires `animationend`.
      for (const type of ["animationend", "webkitAnimationEnd"]) element?.dispatchEvent(new Event(type, { bubbles: true }));
    });
    expect(panel()?.hasAttribute("data-enter")).toBe(false);
  });

  it("does not slide for a host that mounts with the peek already open (a deep link, a navigation to one), until it has been closed once", async () => {
    await mount(await host(peek));
    expect(panel()).not.toBeNull();
    expect(panel()?.hasAttribute("data-enter")).toBe(false);
    await show(item(OTHER)); // switching items is not an open
    expect(panel()?.hasAttribute("data-enter")).toBe(false);
    await show(null);
    expect(panel()).toBeNull();
    await show(peek);
    expect(panel()?.hasAttribute("data-enter")).toBe(true);
  });

  it("has nothing to enter while closed, and no exit marker", async () => {
    await mount(await host(null));
    expect(document.querySelector("[data-enter], [data-exiting]")).toBeNull();
  });
});

describe("closing", () => {
  it("navigates at once and keeps the leaving item on screen, held out, until the exit ends", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/projects/p/work-items", { scroll: false });
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);

    // The URL no longer names the item: the panel and its detail stay for the exit.
    await show(null);
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    expect(input()).not.toBeNull();

    await act(async () => exit.current?.finish());
    expect(panel()).toBeNull();
    expect(input()).toBeNull();
  });

  it("does nothing on a second close while the panel is leaving", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    await act(async () => closeButton()?.click());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.back).not.toHaveBeenCalled();
  });

  it("closes at once when nothing animates (Reduce Motion, no Web Animations)", async () => {
    await openPeek();
    await act(async () => closeButton()?.click());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    await show(null);
    expect(panel()).toBeNull();
  });

  it("closes nothing more when the exit is cancelled (a hidden route, an unmount), and drops the leaving item", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    await show(null);
    await act(async () => exit.current?.cancel());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.back).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it("shows the panel again when the URL names an item before the exit ends", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    await show(null);
    await show(item(OTHER));
    expect(panel()).not.toBeNull();
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
  });

  it("hands focus back to the row once the URL drops the item, as before the exit existed (peek-cover.ts)", async () => {
    layout.width = 400;
    await mount(await host(null));
    const key = document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
    await act(async () => key?.focus());
    await show(peek);
    await act(async () => vi.dynamicImportSettled());
    expect(list()?.hasAttribute("inert")).toBe(true);
    fakeExit = runExit();
    await act(async () => closeButton()?.focus());
    await act(async () => closeButton()?.click());
    // The detail is still mounted while it leaves, so the focus inside it was let go when the close started.
    await show(null);
    expect(panel()).not.toBeNull();
    expect(list()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(key);
  });

  it("does not play an exit for the modal, which keeps the Dialog's own", async () => {
    const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
    savePeekPrefs({ mode: "modal" });
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.showModal !== "function") proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    if (typeof proto.close !== "function") proto.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    fakeExit = runExit();
    await mount(await host(peek));
    await act(async () => vi.dynamicImportSettled());
    await act(async () => closeButton()?.click());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-exiting]")).toBeNull();
  });
});

describe("switching items in place", () => {
  it("dips the shared mount node to 0.4 and animates it back to 1, without a velocity", async () => {
    await openPeek();
    expect(animator.set).not.toHaveBeenCalled();
    const node = mountNode();
    await show(item(OTHER));
    expect(mountNode()).toBe(node); // the node survives: only the detail under it remounts
    expect(animator.set).toHaveBeenCalledTimes(1);
    expect(animator.set).toHaveBeenCalledWith({ opacity: 0.4 });
    expect(animator.animate).toHaveBeenCalledTimes(1);
    expect(animator.animate).toHaveBeenCalledWith({ opacity: 1 });
    expect(animator.set.mock.invocationCallOrder[0]).toBeLessThan(animator.animate.mock.invocationCallOrder[0]);
  });

  it("does not fade on open, on close, or on a refresh that keeps the item", async () => {
    await mount(await host(null));
    await show(peek);
    await act(async () => vi.dynamicImportSettled());
    await show(item(ITEM)); // the 4-second refresh: a new payload for the same id
    await show(item(ITEM));
    await show(null);
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("does not fade for an item opened after the panel closed", async () => {
    await mount(await host(peek));
    await show(null);
    await show(item(OTHER));
    expect(animator.set).not.toHaveBeenCalled();
  });
});

describe("the cover", () => {
  it("fades a panel that covers the list, and slides one that sits beside it", async () => {
    layout.width = 400;
    await mount(await host(null));
    await show(peek);
    expect(panel()?.className).toContain("tessera-peek-panel--cover");
    expect(panel()?.className).toContain("tessera-motion-fade");
    expect(panel()?.className).not.toContain("tessera-motion-slide-end");
    expect(panel()?.hasAttribute("data-enter")).toBe(true);
    await show(null);

    layout.width = 1000;
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    await mount(await host(null));
    await show(peek);
    expect(panel()?.className).toContain("tessera-motion-slide-end");
    expect(panel()?.className).not.toContain("tessera-motion-fade");
  });
});

describe("the leaving panel", () => {
  it("is inert from the start of the exit, and the list is not", async () => {
    fakeExit = runExit();
    await openPeek();
    expect(panel()?.hasAttribute("inert")).toBe(false);
    await act(async () => closeButton()?.click());
    expect(panel()?.hasAttribute("inert")).toBe(true);
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    expect(list()?.hasAttribute("inert")).toBe(false);
  });

  it("takes no focus: the focus that was inside it is let go when the exit starts", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.focus());
    expect(panel()?.contains(document.activeElement)).toBe(true);
    await act(async () => closeButton()?.click());
    expect(panel()?.contains(document.activeElement)).toBe(false);
  });

  it("stays inert and held out after its exit ended while the URL still names the item, and a second close or Escape does nothing", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    // The exit is over but the navigation has not landed (a slow Back or a slow fetch): the panel is still in the tree.
    await act(async () => exit.current?.finish());
    expect(panel()).not.toBeNull();
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    expect(panel()?.hasAttribute("inert")).toBe(true);

    await act(async () => closeButton()?.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    });
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.back).not.toHaveBeenCalled();
  });

  it("does nothing on a second Escape while it leaves (the first Escape closes)", async () => {
    fakeExit = runExit();
    await openPeek();
    const press = () =>
      act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      });
    await press();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    await press();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
  });

  it("is taken back, focusable again, when the exit is cancelled or the URL names another item", async () => {
    fakeExit = runExit();
    await openPeek();
    await act(async () => closeButton()?.click());
    await act(async () => exit.current?.cancel());
    expect(panel()?.hasAttribute("inert")).toBe(false);
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);

    // A new close can start again, and another item shown during that exit brings the panel back.
    fakeExit = runExit();
    await act(async () => closeButton()?.click());
    expect(panel()?.hasAttribute("inert")).toBe(true);
    await show(item(OTHER));
    expect(panel()?.hasAttribute("inert")).toBe(false);
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
  });

  it("returns focus to the row's key button, as before the panel was inert", async () => {
    layout.width = 400;
    await mount(await host(null));
    const key = document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
    await act(async () => key?.focus());
    await show(peek);
    await act(async () => vi.dynamicImportSettled());
    fakeExit = runExit();
    await act(async () => closeButton()?.click());
    await show(null);
    expect(panel()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(key);
  });
});

describe("the browser's Back and Forward", () => {
  const popstate = () =>
    act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

  it("does not slide an open that follows a popstate (Forward into a ?peek= entry), and slides again for the next click", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await mount(await host(null));
      await popstate();
      await show(peek);
      expect(panel()).not.toBeNull();
      expect(panel()?.hasAttribute("data-enter")).toBe(false);
      // The window ends while the panel is open: the slide must not start late.
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      expect(panel()?.hasAttribute("data-enter")).toBe(false);
      // Close, and a click that opens it again is an open like any other.
      await show(null);
      await show(peek);
      expect(panel()?.hasAttribute("data-enter")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the slide of an open that committed before the popstate listener ran", async () => {
    await mount(await host(null));
    await show(peek);
    expect(panel()?.hasAttribute("data-enter")).toBe(true);
    await popstate();
    expect(panel()?.hasAttribute("data-enter")).toBe(false);
  });

  it("does not count the panel's own Back (a close that goes Back) as a browser step: the next open slides", async () => {
    const list = "/projects/p/work-items";
    const open = `${list}?peek=${ITEM}`;
    await mount(await host(null));
    notePeekPush(list, open);
    nav.search = `peek=${ITEM}`;
    await show(peek);
    await act(async () => vi.dynamicImportSettled());
    await act(async () => closeButton()?.click());
    expect(nav.router.back).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).not.toHaveBeenCalled();
    // router.back() lands: the browser fires the popstate for it.
    await popstate();
    nav.search = "";
    await show(null);
    nav.search = `peek=${OTHER}`;
    await show(item(OTHER));
    expect(panel()?.hasAttribute("data-enter")).toBe(true);
  });

  it("does not dip the mount node for an item change that follows a popstate, and dips again once the window has passed", async () => {
    const now = vi.spyOn(performance, "now");
    try {
      now.mockReturnValue(10_000);
      await openPeek();
      await popstate();
      now.mockReturnValue(10_300);
      await show(item(OTHER)); // Back or Forward between two peek entries
      expect(animator.set).not.toHaveBeenCalled();
      expect(animator.animate).not.toHaveBeenCalled();
      now.mockReturnValue(12_500);
      await show(item(ITEM)); // a click, well after
      expect(animator.set).toHaveBeenCalledTimes(1);
      expect(animator.animate).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("ends a dip that the router committed before the popstate listener ran, in the same task", async () => {
    // The host's "end of the task" timer is held, so the popstate below arrives in the task that dipped (as it does in a browser).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await openPeek();
      await show(item(OTHER));
      expect(animator.set).toHaveBeenCalledWith({ opacity: 0.4 });
      animator.set.mockClear();
      await popstate();
      expect(animator.set).toHaveBeenCalledWith({ opacity: 1 });
      // Once that task is over a popstate has no dip to end.
      animator.set.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      await popstate();
      expect(animator.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
