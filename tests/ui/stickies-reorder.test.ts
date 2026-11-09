// @vitest-environment jsdom
/**
 * Stickies grid drag reorder (src/components/stickies, decision 105) under
 * jsdom with the sticky actions mocked: a pointer drop in a wrapping grid calls
 * move_sticky with one neighbour, the order changes optimistically and is
 * restored with a toast when the action fails, and the grip's arrow keys are
 * the keyboard path with the same placement semantics.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StickyView } from "@/lib/tessera/types";
import { box, drag, pointerEvent, pressKey, stubRects } from "../helpers/pointer-drag-dom";

const ok = { ok: true as const, data: {}, cursor: 1 };
const mocks = vi.hoisted(() => ({
  moveStickyAction: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/app/actions/stickies", () => ({
  createStickyAction: vi.fn(async () => ok),
  updateStickyAction: vi.fn(async () => ok),
  deleteStickyAction: vi.fn(async () => ok),
  moveStickyAction: mocks.moveStickyAction,
}));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/editor", () => ({ MarkdownEditor: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/stickies",
  useSearchParams: () => new URLSearchParams(""),
}));

const { StickiesScreen } = await import("@/components/stickies/StickiesScreen");

function sticky(id: string): StickyView {
  return { id, name: `Note ${id}`, description_md: "", color: "yellow", sort_order: id, updated_at: "2026-10-21T10:00:00.000Z" };
}

const STICKIES = ["s1", "s2", "s3", "s4"].map(sticky);

/** Two columns: s1 s2 on the first row, s3 s4 on the second. */
const LAYOUT = {
  ".tessera-sticky-grid": box(0, 0, 220, 120),
  s1: box(0, 0, 100, 50),
  s2: box(110, 0, 100, 50),
  s3: box(0, 60, 100, 50),
  s4: box(110, 60, 100, 50),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreRects: (() => void) | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) =>
      ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  mocks.moveStickyAction.mockReset();
  mocks.moveStickyAction.mockResolvedValue(ok);
  mocks.toast.mockReset();
  restoreRects = stubRects(LAYOUT);
});

afterEach(async () => {
  restoreRects?.();
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(StickiesScreen, { stickies: STICKIES, q: "" }));
  });
  return container;
}

function order(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".tessera-sticky-grid > [id]")).map((el) => el.id);
}

function grip(host: HTMLElement, id: string): HTMLElement {
  const label = `Reorder Note ${id}`;
  const el = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no grip ${label}`);
  return el;
}

describe("stickies drag reorder", () => {
  it("drops between two cards of the second row with the previous card as before_id", async () => {
    const host = await render();
    // s1 leaves; pointer ends left of s4's midpoint on the second row: slot 2 among s2 s3 s4.
    await drag(grip(host, "s1"), { x: 5, y: 5 }, [{ x: 60, y: 30 }, { x: 120, y: 80 }]);
    expect(mocks.moveStickyAction).toHaveBeenCalledTimes(1);
    expect(mocks.moveStickyAction).toHaveBeenCalledWith({ sticky_id: "s1", before_id: "s3" });
  });

  it("names the first card as after_id when dropped at the front", async () => {
    const host = await render();
    await drag(grip(host, "s4"), { x: 115, y: 65 }, [{ x: 60, y: 40 }, { x: 5, y: 10 }]);
    expect(mocks.moveStickyAction).toHaveBeenCalledWith({ sticky_id: "s4", after_id: "s1" });
  });

  it("does not call the action for a drop in the slot it already holds", async () => {
    const host = await render();
    // s2 dropped right where it was: row 1, between s1 (mid 50) and the row end.
    await drag(grip(host, "s2"), { x: 115, y: 5 }, [{ x: 140, y: 20 }, { x: 160, y: 20 }]);
    expect(mocks.moveStickyAction).not.toHaveBeenCalled();
  });

  it("shows the new order at once and keeps it while the action is pending", async () => {
    let resolveMove: (value: typeof ok) => void = () => {};
    mocks.moveStickyAction.mockReturnValue(new Promise((resolve) => (resolveMove = resolve)));
    const host = await render();
    await drag(grip(host, "s1"), { x: 5, y: 5 }, [{ x: 60, y: 30 }, { x: 120, y: 80 }]);
    expect(order(host)).toEqual(["s2", "s3", "s1", "s4"]);
    await act(async () => {
      resolveMove(ok);
    });
  });

  it("restores the order and shows a toast when the move fails", async () => {
    mocks.moveStickyAction.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Changed elsewhere." });
    const host = await render();
    await drag(grip(host, "s1"), { x: 5, y: 5 }, [{ x: 60, y: 30 }, { x: 120, y: 80 }]);
    await act(async () => {});
    expect(order(host)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(mocks.toast).toHaveBeenCalledWith({ type: "error", body: "Could not move the sticky. Changed elsewhere." });
  });

  it("abandons the drag on Escape without calling the action", async () => {
    const host = await render();
    await drag(grip(host, "s1"), { x: 5, y: 5 }, [{ x: 60, y: 30 }, { x: 120, y: 80 }], { release: false });
    await pressKey(document.body, "Escape");
    await act(async () => {
      pointerEvent("pointerup", 0, 0, window);
    });
    expect(mocks.moveStickyAction).not.toHaveBeenCalled();
    expect(order(host)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("moves one place with the grip's arrow keys (the keyboard path)", async () => {
    const host = await render();
    await pressKey(grip(host, "s1"), "ArrowRight");
    expect(mocks.moveStickyAction).toHaveBeenLastCalledWith({ sticky_id: "s1", before_id: "s2" });
    await pressKey(grip(host, "s3"), "ArrowLeft");
    expect(mocks.moveStickyAction).toHaveBeenLastCalledWith({ sticky_id: "s3", before_id: "s1" });
  });

  it("ignores an arrow key at an edge", async () => {
    const host = await render();
    await pressKey(grip(host, "s1"), "ArrowLeft");
    await pressKey(grip(host, "s4"), "ArrowRight");
    expect(mocks.moveStickyAction).not.toHaveBeenCalled();
  });
});
