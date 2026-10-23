// @vitest-environment jsdom
/**
 * The side peek that covers the list (src/components/detail/peek-cover.ts, PeekHost.tsx; decision 11): the covered list
 * region is `inert` so it leaves the tab order, focus moves into the peek when the cover starts and back to the row's
 * key button when it ends. A peek beside the list (wide container) and the modal leave the list alone. jsdom has no layout,
 * so the container width is faked through getBoundingClientRect, and the detail is a stand-in with one control.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PeekData } from "@/components/detail/PeekHost";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  pathname: "/projects/p/work-items",
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
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
const peek = { id: ITEM, data: { item: { id: ITEM, project_id: PROJECT } } } as unknown as PeekData;

/** The width the faked layout gives every element (the panel's container reads it). */
const layout = { width: 400 };
/** The callbacks of the ResizeObservers the page created (jsdom has none): calling one is a resize. */
const observers = new Set<() => void>();
let container: HTMLElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  globalThis.ResizeObserver = class {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe() {
      observers.add(this.callback);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.callback);
    }
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: layout.width, bottom: 0, width: layout.width, height: 0, toJSON: () => ({}) };
  };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
  savePeekPrefs({ mode: "side" });
  window.sessionStorage.clear();
  layout.width = 400;
});

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}

async function host(peekData: PeekData | null) {
  const { PeekHost } = await import("@/components/detail/PeekHost");
  // children go in as the third argument; the cast covers the props object without them.
  const hostProps = { projectId: PROJECT, peek: peekData } as ComponentProps<typeof PeekHost>;
  return createElement(PeekHost, hostProps, createElement("button", { type: "button", "data-testid": "row-key" }, "WEB-1"));
}

const list = () => document.querySelector<HTMLElement>('[data-testid="row-key"]')?.closest(".astryx-layout-content") as HTMLElement | null;

describe("covering peek", () => {
  it("makes the covered list inert and moves focus into the peek", async () => {
    await mount(await host(null));
    const key = document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
    await act(async () => key?.focus());
    expect(document.activeElement).toBe(key);
    expect(list()?.hasAttribute("inert")).toBe(false);

    await act(async () => root?.render(await host(peek)));
    expect(list()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('button[aria-label="Close"]'));
  });

  it("returns focus to the row's key button on close, in the commit that drops inert", async () => {
    await mount(await host(null));
    const key = document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    expect(list()?.hasAttribute("inert")).toBe(true);

    await act(async () => root?.render(await host(null)));
    expect(list()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(key);
  });

  it("clears inert, without moving focus away from the peek, when a resize lets the list sit beside the panel", async () => {
    await mount(await host(peek));
    expect(list()?.hasAttribute("inert")).toBe(true);
    layout.width = 1000;
    await act(async () => {
      for (const callback of observers) callback();
    });
    expect(list()?.hasAttribute("inert")).toBe(false);
    expect(document.querySelector('[role="complementary"]')).not.toBeNull();
  });
});

describe("focus inside an open peek", () => {
  const resize = async (width: number) => {
    layout.width = width;
    await act(async () => {
      for (const callback of observers) callback();
    });
  };
  const input = () => document.querySelector<HTMLInputElement>('[data-testid="detail-input"]');

  it("stays in the detail field when a resize starts the cover", async () => {
    layout.width = 1000;
    await mount(await host(peek));
    await act(async () => input()?.focus());
    expect(document.activeElement).toBe(input());
    await resize(400);
    expect(list()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it("stays in the detail field when a resize ends the cover", async () => {
    await mount(await host(null));
    const key = document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    await act(async () => input()?.focus());
    await resize(1000);
    expect(list()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(input());
  });
});

describe("focus return after the cover state changes", () => {
  const resize = async (width: number) => {
    layout.width = width;
    await act(async () => {
      for (const callback of observers) callback();
    });
  };
  const rowKey = () => document.querySelector<HTMLButtonElement>('[data-testid="row-key"]');
  const input = () => document.querySelector<HTMLInputElement>('[data-testid="detail-input"]');

  it("returns to the row after a cover, wide, cover resize round trip", async () => {
    await mount(await host(null));
    const key = rowKey();
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    await act(async () => input()?.focus());
    await resize(1000);
    await resize(400);
    expect(list()?.hasAttribute("inert")).toBe(true);
    await act(async () => root?.render(await host(null)));
    expect(list()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(key);
  });

  it("returns to the row when a covering peek opened at 400 closes at 1000", async () => {
    await mount(await host(null));
    const key = rowKey();
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    await act(async () => input()?.focus());
    await resize(1000);
    await act(async () => root?.render(await host(null)));
    expect(document.activeElement).toBe(key);
  });

  it("returns to the row when a side panel beside the list closes", async () => {
    layout.width = 1000;
    await mount(await host(null));
    const key = rowKey();
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    expect(list()?.hasAttribute("inert")).toBe(false);
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.focus());
    await act(async () => root?.render(await host(null)));
    expect(document.activeElement).toBe(key);
  });

  it("does not pull focus to the row when the user moved it elsewhere", async () => {
    layout.width = 1000;
    await mount(await host(null));
    const key = rowKey();
    await act(async () => key?.focus());
    await act(async () => root?.render(await host(peek)));
    const other = document.createElement("button");
    document.body.appendChild(other);
    await act(async () => other.focus());
    await act(async () => root?.render(await host(null)));
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});

describe("peek that leaves the list reachable", () => {
  it("does not make the list inert when the container is wide", async () => {
    layout.width = 1000;
    await mount(await host(peek));
    expect(document.querySelector('[role="complementary"]')).not.toBeNull();
    expect(list()?.hasAttribute("inert")).toBe(false);
  });

  it("does not make the list inert in the modal", async () => {
    const { savePeekPrefs } = await import("@/components/detail/peek-prefs");
    savePeekPrefs({ mode: "modal" });
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.showModal !== "function") proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    if (typeof proto.close !== "function") proto.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    await mount(await host(peek));
    expect(list()?.hasAttribute("inert")).toBe(false);
  });
});
