// @vitest-environment jsdom
/**
 * Render test of PageScreen (src/components/pages) under jsdom with the page
 * actions and the router mocked: toggling the lock (button and shift+L) and the
 * Outline keeps exactly one title, meta row and editor (the siblings once
 * shared one key and every toggle added another copy); the Outline lists the
 * body's headings at once, without a keystroke; and a failed lock never shows
 * the "Unlocked" feedback.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PageDetail } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const pageActions = vi.hoisted(() => ({
  lockPageAction: vi.fn(),
  unlockPageAction: vi.fn(),
}));
vi.mock("@/app/actions/pages", () => ({
  archivePageAction: vi.fn(async () => ok),
  unarchivePageAction: vi.fn(async () => ok),
  updatePageAction: vi.fn(async () => ok),
  updatePageBodyAction: vi.fn(async () => ({ ok: true as const, data: { description_version: 2 }, cursor: 1 })),
  createPageAction: vi.fn(async () => ok),
  duplicatePageAction: vi.fn(async () => ok),
  movePageAction: vi.fn(async () => ok),
  deletePageAction: vi.fn(async () => ok),
  listPagesAction: vi.fn(async () => ok),
  getPageAction: vi.fn(async () => ok),
  lockPageAction: pageActions.lockPageAction,
  unlockPageAction: pageActions.unlockPageAction,
}));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn(async () => undefined) }));
vi.mock("@/app/actions/favorites", () => ({ addFavoriteAction: vi.fn(async () => ok), removeFavoriteAction: vi.fn(async () => ok) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/pages/p1",
  useSearchParams: () => new URLSearchParams(""),
}));

const { PageScreen } = await import("@/components/pages/PageScreen");

const NOW = "2026-10-11T10:00:00.000Z";
const USER = "55555555-5555-7555-8555-555555555555";

function pageDetail(overrides: Partial<PageDetail> = {}): PageDetail {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    project_id: null,
    parent_id: null,
    name: "Handbook",
    access: "public",
    is_locked: false,
    logo: null,
    archived_at: null,
    sort_order: "a0",
    label_ids: [],
    child_count: 0,
    updated_at: NOW,
    updated_by: USER,
    description_md: "# Intro\n\ntext\n\n## Setup\n\n### Details",
    description_version: 1,
    ancestors: [],
    embeds: [],
    created_at: NOW,
    created_by: USER,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function screenFor(page: PageDetail): ReactNode {
  return createElement(PageScreen, { page, labels: [], actors: [], spaces: [], space: { kind: "wiki" } });
}

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

async function rerender(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

function titles(el: HTMLElement): number {
  return el.querySelectorAll("h1.tessera-page-title").length;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof document.createRange === "function") {
    const range = document.createRange();
    if (typeof range.getClientRects !== "function") {
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  }
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  pageActions.lockPageAction.mockReset();
  pageActions.unlockPageAction.mockReset();
});

describe("PageScreen", () => {
  it("keeps one title, meta row and editor across lock, unlock and outline toggles", async () => {
    pageActions.lockPageAction.mockResolvedValue(ok);
    pageActions.unlockPageAction.mockResolvedValue(ok);
    const el = await render(screenFor(pageDetail()));
    await settle();
    const count = () => ({ titles: titles(el), editors: el.querySelectorAll(".tessera-editor-content").length, meta: el.querySelectorAll(".tessera-page-meta").length });
    const first = count();
    expect(first.titles).toBe(1);
    expect(first.editors).toBe(1);

    const outline = el.querySelector<HTMLButtonElement>('button[aria-label="Outline"]');
    expect(outline).not.toBeNull();
    for (let round = 0; round < 2; round += 1) {
      await act(async () => {
        outline?.click();
      });
      expect(count()).toEqual(first);
    }

    // Lock through the button: the optimistic flip adds the banner above the title.
    const lock = el.querySelector<HTMLButtonElement>('button[aria-label="Lock page"]');
    await act(async () => {
      lock?.click();
    });
    expect(pageActions.lockPageAction).toHaveBeenCalledTimes(1);
    expect(count()).toEqual(first);
    await rerender(screenFor(pageDetail({ is_locked: true })));
    expect(count()).toEqual(first);
    const unlock = el.querySelector<HTMLButtonElement>('button[aria-label="Unlock page"]');
    expect(unlock).not.toBeNull();
    await act(async () => {
      unlock?.click();
    });
    await rerender(screenFor(pageDetail({ is_locked: false })));
    expect(count()).toEqual(first);

    // Shift+L toggles as well.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "L", code: "KeyL", shiftKey: true, bubbles: true }));
    });
    await rerender(screenFor(pageDetail({ is_locked: true })));
    expect(count()).toEqual(first);
  });

  it("lists the headings in the Outline right away, without a keystroke", async () => {
    const el = await render(screenFor(pageDetail()));
    await settle();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('button[aria-label="Outline"]')?.click();
    });
    await settle();
    const aside = el.querySelector('aside[aria-label="Outline"]');
    expect(aside).not.toBeNull();
    const text = aside?.textContent ?? "";
    expect(text).not.toContain("No headings yet");
    for (const heading of ["Intro", "Setup", "Details"]) expect(text).toContain(heading);
    // The aside shares the frame with the reading column instead of narrowing it.
    const frame = el.querySelector(".tessera-page-frame");
    expect(frame?.getAttribute("data-outline")).toBe("open");
    expect(frame?.querySelector(":scope > .tessera-reading")).not.toBeNull();
  });

  it("shows no Unlocked feedback while an unlock is in flight or after it fails and the lock snaps back", async () => {
    let fail: (value: { ok: false; code: string; message: string; details: null }) => void = () => {};
    pageActions.unlockPageAction.mockReturnValue(new Promise((resolve) => (fail = resolve)));
    const el = await render(screenFor(pageDetail({ is_locked: true })));
    await settle();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('button[aria-label="Unlock page"]')?.click();
    });
    // Optimistically unlocked, not yet confirmed: the button already offers Lock, but nothing says "Unlocked".
    expect(el.querySelector('button[aria-label="Lock page"]')).not.toBeNull();
    expect(el.textContent).not.toContain("Unlocked");
    await act(async () => {
      fail({ ok: false, code: "RULE", message: "Nope", details: null });
    });
    await settle();
    // Server value unchanged: the display is back to locked and nothing said "Unlocked".
    expect(el.textContent).not.toContain("Unlocked");
    expect(el.querySelector('button[aria-label="Unlock page"]')).not.toBeNull();
  });

  it("shows Unlocked once the server confirms an unlock", async () => {
    pageActions.unlockPageAction.mockResolvedValue(ok);
    const el = await render(screenFor(pageDetail({ is_locked: true })));
    await settle();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('button[aria-label="Unlock page"]')?.click();
    });
    expect(el.textContent).not.toContain("Unlocked");
    await rerender(screenFor(pageDetail({ is_locked: false })));
    expect(el.textContent).toContain("Unlocked");
  });
});
