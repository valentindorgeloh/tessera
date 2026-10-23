// @vitest-environment jsdom
/**
 * The page tree's row menu Move up / Move down (decision 13): the new order
 * shows at once (PagesScreen's useOptimistic move, handed down as `onMove`) and
 * a failed move toasts and snaps back, like a drag does.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const actions = vi.hoisted(() => ({ movePageAction: vi.fn() }));
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

const order = (el: HTMLElement) => [...el.querySelectorAll(".tessera-page-row")].map((row) => row.textContent?.match(/Page [ABC]/)?.[0]);

/** Open the menu of the row named `name` and pick `item` (every row's menu is in the document, in row order). */
async function pick(el: HTMLElement, name: string, item: string) {
  const rows = [...el.querySelectorAll<HTMLElement>(".tessera-page-row")];
  const index = rows.findIndex((entry) => entry.textContent?.includes(name));
  const trigger = rows[index]?.querySelector<HTMLButtonElement>('button[aria-label="Page actions"]');
  await act(async () => {
    trigger?.click();
  });
  const entries = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((node) => node.textContent?.trim().startsWith(item));
  await act(async () => {
    entries[index]?.click();
  });
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

describe("page row menu moves", () => {
  it("Move up reorders the tree before the server answers", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.movePageAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render([page("A"), page("B"), page("C")]);
    expect(order(el)).toEqual(["Page A", "Page B", "Page C"]);
    await pick(el, "Page C", "Move up");
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "C", parent_id: null, before_id: "B" });
    expect(order(el)).toEqual(["Page A", "Page C", "Page B"]);
    await act(async () => {
      finish(ok);
    });
  });

  it("Move down reorders the tree before the server answers", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.movePageAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render([page("A"), page("B"), page("C")]);
    await pick(el, "Page A", "Move down");
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "A", parent_id: null, after_id: "B" });
    expect(order(el)).toEqual(["Page B", "Page A", "Page C"]);
    await act(async () => {
      finish(ok);
    });
  });

  it("a failed move snaps back and toasts", async () => {
    let finish: (value: { ok: false; code: string; message: string; details: null }) => void = () => {};
    actions.movePageAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render([page("A"), page("B"), page("C")]);
    await pick(el, "Page C", "Move up");
    expect(order(el)).toEqual(["Page A", "Page C", "Page B"]);
    await act(async () => {
      finish({ ok: false, code: "RULE", message: "Nope", details: null });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(order(el)).toEqual(["Page A", "Page B", "Page C"]);
    expect(document.body.textContent).toContain("Could not move Page C. Nope");
  });

  it("a move whose request rejects snaps back and toasts instead of reaching the error boundary", async () => {
    actions.movePageAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await render([page("A"), page("B"), page("C")]);
    await pick(el, "Page C", "Move up");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(order(el)).toEqual(["Page A", "Page B", "Page C"]);
    expect(document.body.textContent).toContain("Could not move Page C. The request did not go through.");
    expect(document.body.textContent).not.toContain("Failed to fetch");
  });
});
