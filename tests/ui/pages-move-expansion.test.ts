// @vitest-environment jsdom
/**
 * A failed page move that changed the moved parent's depth (decision 13): the
 * optimistic list draws the parent one level down, where the tree seeds it
 * closed, and the revert must give it back open with its sub-pages visible.
 * The drag hook is replaced so the test can drop a page without pointer events.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const actions = vi.hoisted(() => ({ movePageAction: vi.fn() }));
const drag = vi.hoisted(() => ({ onMove: null as null | ((move: { page_id: string; parent_id: string | null }) => void) }));
vi.mock("@/components/pages/use-page-drag", () => ({
  usePageDrag: (options: { onMove: (move: { page_id: string; parent_id: string | null }) => void }) => {
    drag.onMove = options.onMove;
    return {
      setRoot: () => {},
      handlers: { onPointerDown: () => {}, onClickCapture: () => {}, onDragStart: () => {} },
      draggingId: null,
      registerOverlay: () => {},
      isRowDraggable: () => false,
      rowClassName: () => "tessera-page-row",
    };
  },
}));
vi.mock("@/app/actions/pages", () => ({
  createPageAction: vi.fn(async () => ok),
  movePageAction: actions.movePageAction,
  archivePageAction: vi.fn(async () => ok),
  unarchivePageAction: vi.fn(async () => ok),
  updatePageAction: vi.fn(async () => ok),
  duplicatePageAction: vi.fn(async () => ok),
  lockPageAction: vi.fn(async () => ok),
  unlockPageAction: vi.fn(async () => ok),
  deletePageAction: vi.fn(async () => ok),
  listPagesAction: vi.fn(async () => ok),
}));
vi.mock("@/app/actions/favorites", () => ({ addFavoriteAction: vi.fn(async () => ok), removeFavoriteAction: vi.fn(async () => ok) }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn(async () => undefined) }));
vi.mock("@/app/actions/history", () => ({
  restorePageVersionAction: vi.fn(async () => ok),
  restoreWorkItemVersionAction: vi.fn(async () => ok),
  listActorsAction: vi.fn(async () => ({ ok: true as const, data: { items: [] }, cursor: 1 })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/wiki",
  useSearchParams: () => new URLSearchParams(""),
}));

const { PagesScreen } = await import("@/components/pages/PagesScreen");

function page(id: string): PageSummary {
  return {
    id,
    project_id: null,
    parent_id: null,
    name: `Page ${id}`,
    access: "public",
    is_locked: false,
    logo: null,
    archived_at: null,
    sort_order: id,
    label_ids: [],
    child_count: 0,
    updated_at: "2026-10-11T10:00:00.000Z",
    updated_by: "u",
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(pages: PageSummary[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PagesScreen, { space: { kind: "wiki" }, tab: "public", pages, labels: [], spaces: [] }));
  });
  return container;
}

const names = (el: HTMLElement) => [...el.querySelectorAll(".tessera-page-row")].map((row) => row.textContent?.match(/Page [A-Z]/)?.[0]);

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
  actions.movePageAction.mockReset();
});

const tree = (): PageSummary[] => [
  page("S"),
  { ...page("P"), child_count: 1 },
  { ...page("C"), parent_id: "P" },
];

describe("a failed move of a parent keeps it open", () => {
  it("a move that is still pending shows the parent open under its new parent", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.movePageAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render(tree());
    await act(async () => {
      drag.onMove?.({ page_id: "P", parent_id: "S" });
    });
    expect(names(el)).toEqual(["Page S", "Page P", "Page C"]);
    expect(el.querySelector('li[data-tree-id="P"]')?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      finish(ok);
    });
  });

  it("a refused move (ok: false) leaves the moved parent expanded with its sub-pages visible", async () => {
    actions.movePageAction.mockResolvedValue({ ok: false, code: "RULE", message: "Nope", details: null });
    const el = await render(tree());
    expect(names(el)).toEqual(["Page S", "Page P", "Page C"]);
    await act(async () => {
      drag.onMove?.({ page_id: "P", parent_id: "S" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(names(el)).toEqual(["Page S", "Page P", "Page C"]);
    expect(el.querySelector('li[data-tree-id="P"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Could not move Page P. Nope");
  });

  it("a rejected request (network error) leaves the moved parent expanded with its sub-pages visible", async () => {
    actions.movePageAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await render(tree());
    await act(async () => {
      drag.onMove?.({ page_id: "P", parent_id: "S" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(names(el)).toEqual(["Page S", "Page P", "Page C"]);
    expect(el.querySelector('li[data-tree-id="P"]')?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("a moved leaf is not pinned closed", () => {
  it("a sub-page dropped under a page that was moved while it was a leaf shows", async () => {
    actions.movePageAction.mockResolvedValue(ok);
    const el = await render([page("S"), page("P")]);
    // S moves as a leaf (a reorder among the roots).
    await act(async () => {
      drag.onMove?.({ page_id: "S", parent_id: null });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The server list now has P under S.
    await act(async () => {
      root?.render(
        createElement(PagesScreen, {
          space: { kind: "wiki" },
          tab: "public",
          pages: [{ ...page("S"), child_count: 1 }, { ...page("P"), parent_id: "S" }],
          labels: [],
          spaces: [],
        }),
      );
    });
    expect(names(el)).toEqual(["Page S", "Page P"]);
    expect(el.querySelector('li[data-tree-id="S"]')?.getAttribute("aria-expanded")).toBe("true");
  });
});
