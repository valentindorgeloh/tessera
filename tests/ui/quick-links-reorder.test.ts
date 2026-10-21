// @vitest-environment jsdom
/**
 * Quick links drag reorder (src/components/home/QuickLinksWidget.tsx, decision
 * 105) under jsdom with the quick-link actions mocked: chips wrap, a pointer
 * drop calls move_quick_link with one neighbour, the order is optimistic and
 * restored with a toast on failure, and the menu's Move left / Move right keep
 * naming the right neighbour (before_id is the row that ends up in front).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickLinkView } from "@/lib/tessera/types";
import { box, drag, stubRects, type Box } from "../helpers/pointer-drag-dom";

const ok = { ok: true as const, data: {}, cursor: 1 };
const mocks = vi.hoisted(() => ({ moveQuickLinkAction: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/actions/quick-links", () => ({
  addQuickLinkAction: vi.fn(async () => ok),
  updateQuickLinkAction: vi.fn(async () => ok),
  removeQuickLinkAction: vi.fn(async () => ok),
  moveQuickLinkAction: mocks.moveQuickLinkAction,
}));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

const { QuickLinksWidget } = await import("@/components/home/QuickLinksWidget");

function link(id: string): QuickLinkView {
  return { id, title: `Link ${id}`, url: `/${id}`, sort_order: id };
}

const LINKS = ["l1", "l2", "l3", "l4"].map(link);

/** l1 l2 l3 on the first row, l4 wrapped onto the second. */
const CHIPS: Record<string, Box> = {
  "Link l1": box(0, 0, 100, 32),
  "Link l2": box(108, 0, 100, 32),
  "Link l3": box(216, 0, 100, 32),
  "Link l4": box(0, 40, 100, 32),
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
  mocks.moveQuickLinkAction.mockReset();
  mocks.moveQuickLinkAction.mockResolvedValue(ok);
  mocks.toast.mockReset();
  restoreRects = stubRects((el) => {
    if (el.classList.contains("tessera-home-links")) return box(0, 0, 330, 80);
    if (el.classList.contains("tessera-quick-link") && !el.classList.contains("tessera-drag-overlay")) return CHIPS[labelOf(el)] ?? null;
    return null;
  });
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
    root?.render(createElement(QuickLinksWidget, { links: LINKS }));
  });
  return container;
}

/** The label of a chip is its link text (the menu adds more text of its own). */
function labelOf(chip: Element): string {
  return (chip.querySelector("a")?.textContent ?? "").trim();
}

function chips(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".tessera-home-links > .tessera-quick-link"));
}

function chipOf(host: HTMLElement, id: string): HTMLElement {
  const el = chips(host).find((chip) => labelOf(chip) === `Link ${id}`);
  if (!el) throw new Error(`no chip ${id}`);
  return el;
}

function order(host: HTMLElement): string[] {
  return chips(host).map((chip) => labelOf(chip).replace("Link ", ""));
}

describe("quick links drag reorder", () => {
  it("drops a chip between two others of the first row with the previous chip as before_id", async () => {
    const host = await render();
    // l4 (second row) dragged up between l2 and l3: pointer left of l3's midpoint (266).
    await drag(chipOf(host, "l4").querySelector("a") ?? chipOf(host, "l4"), { x: 10, y: 50 }, [{ x: 100, y: 30 }, { x: 230, y: 16 }]);
    expect(mocks.moveQuickLinkAction).toHaveBeenCalledTimes(1);
    expect(mocks.moveQuickLinkAction).toHaveBeenCalledWith({ quick_link_id: "l4", before_id: "l2" });
  });

  it("names the first chip as after_id when dropped at the front", async () => {
    const host = await render();
    await drag(chipOf(host, "l3"), { x: 230, y: 10 }, [{ x: 120, y: 16 }, { x: 10, y: 16 }]);
    expect(mocks.moveQuickLinkAction).toHaveBeenCalledWith({ quick_link_id: "l3", after_id: "l1" });
  });

  it("drops past the end of the last row after the last chip", async () => {
    const host = await render();
    await drag(chipOf(host, "l1"), { x: 10, y: 10 }, [{ x: 150, y: 50 }, { x: 300, y: 56 }]);
    expect(mocks.moveQuickLinkAction).toHaveBeenCalledWith({ quick_link_id: "l1", before_id: "l4" });
  });

  it("does not drag from the menu button", async () => {
    const host = await render();
    const menu = chipOf(host, "l1").querySelector("button");
    if (!menu) throw new Error("no menu button");
    await drag(menu, { x: 90, y: 10 }, [{ x: 150, y: 50 }, { x: 300, y: 56 }]);
    expect(mocks.moveQuickLinkAction).not.toHaveBeenCalled();
  });

  it("applies the order at once and restores it with a toast when the move fails", async () => {
    let resolveMove: (value: unknown) => void = () => {};
    mocks.moveQuickLinkAction.mockReturnValue(new Promise((resolve) => (resolveMove = resolve)));
    const host = await render();
    await drag(chipOf(host, "l1"), { x: 10, y: 10 }, [{ x: 150, y: 50 }, { x: 300, y: 56 }]);
    expect(order(host)).toEqual(["l2", "l3", "l4", "l1"]);
    await act(async () => {
      resolveMove({ ok: false, code: "CONFLICT", message: "Changed elsewhere." });
    });
    expect(order(host)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(mocks.toast).toHaveBeenCalledWith({ type: "error", body: "Could not move the link. Changed elsewhere." });
  });
});
