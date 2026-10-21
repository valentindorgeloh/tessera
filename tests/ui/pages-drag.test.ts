// @vitest-environment jsdom
/**
 * Page tree drag (decision 105) in PagesScreen under jsdom: jsdom has no
 * layout, so the tree and its rows get fixed rects, and the pointer events are
 * dispatched by hand. A drop between two rows calls movePageAction with the
 * parent and the `before_id`/`after_id` sibling; a drop on the row's own place
 * does nothing; a failed move toasts and the order snaps back; a locked page
 * does not drag; the row menu's Move up stays.
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

function page(id: string, overrides: Partial<PageSummary> = {}): PageSummary {
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
    ...overrides,
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

const ROW_HEIGHT = 40;

/** Fixed layout: the tree at the top-left, rows stacked in tree order. */
function layout(el: HTMLElement) {
  const rect = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const rows = [...el.querySelectorAll<HTMLElement>(".tessera-page-row")];
  rows.forEach((row, index) => {
    row.getBoundingClientRect = rect(0, index * ROW_HEIGHT, 300, ROW_HEIGHT);
  });
  const tree = el.querySelector<HTMLElement>('[role="tree"]');
  if (tree) tree.getBoundingClientRect = rect(0, 0, 300, rows.length * ROW_HEIGHT);
  for (const group of el.querySelectorAll<HTMLElement>('[role="group"]')) {
    const inside = [...group.querySelectorAll<HTMLElement>(".tessera-page-row")].map((row) => rows.indexOf(row));
    group.getBoundingClientRect = rect(0, Math.min(...inside) * ROW_HEIGHT, 300, inside.length * ROW_HEIGHT);
  }
  return rows;
}

function pointer(type: string, target: EventTarget, x: number, y: number, pointerType?: string) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  if (pointerType !== undefined) Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
}

/** Press on a row (or `from`), move past the threshold to `y`, release. */
async function dragRow(row: HTMLElement, toY: number, options: { from?: Element; pointerType?: string } = {}) {
  const link = options.from ?? row.querySelector("a") ?? row;
  const from = row.getBoundingClientRect();
  await act(async () => {
    pointer("pointerdown", link, 20, from.top + 10, options.pointerType);
  });
  await act(async () => {
    pointer("pointermove", window, 20, from.top + 20);
  });
  await act(async () => {
    pointer("pointermove", window, 20, toY);
  });
  await act(async () => {
    pointer("pointerup", window, 20, toY);
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

describe("page tree drag", () => {
  it("drops a page between two siblings with before_id", async () => {
    actions.movePageAction.mockResolvedValue(ok);
    const el = await render([page("A"), page("B"), page("C")]);
    const rows = layout(el);
    expect(rows).toHaveLength(3);
    // Row C dragged into the top half of row B (y 45, B spans 40-80).
    await dragRow(rows[2], 45);
    expect(actions.movePageAction).toHaveBeenCalledTimes(1);
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "C", parent_id: null, before_id: "B" });
  });

  it("drops a page below the last sibling with after_id", async () => {
    actions.movePageAction.mockResolvedValue(ok);
    const el = await render([page("A"), page("B"), page("C")]);
    const rows = layout(el);
    await dragRow(rows[0], 110);
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "A", parent_id: null, after_id: "C" });
  });

  it("does nothing for a drop on the page's own place", async () => {
    const el = await render([page("A"), page("B"), page("C")]);
    const rows = layout(el);
    await dragRow(rows[1], 55);
    expect(actions.movePageAction).not.toHaveBeenCalled();
  });

  it("shows the new order at once and snaps back with a toast when the move fails", async () => {
    let finish: (value: { ok: false; code: string; message: string; details: null }) => void = () => {};
    actions.movePageAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render([page("A"), page("B"), page("C")]);
    const rows = layout(el);
    const order = () => [...el.querySelectorAll(".tessera-page-row")].map((row) => row.textContent?.match(/Page [ABC]/)?.[0]);
    expect(order()).toEqual(["Page A", "Page B", "Page C"]);
    await dragRow(rows[2], 5);
    expect(order()).toEqual(["Page C", "Page A", "Page B"]);
    await act(async () => {
      finish({ ok: false, code: "RULE", message: "Nope", details: null });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(order()).toEqual(["Page A", "Page B", "Page C"]);
    expect(document.body.textContent).toContain("Could not move Page C. Nope");
  });

  it("reparents into an expanded parent's child group", async () => {
    actions.movePageAction.mockResolvedValue(ok);
    const el = await render([page("A"), page("B"), page("B1", { parent_id: "B" }), page("B2", { parent_id: "B" }), page("C")]);
    const rows = layout(el);
    expect(rows).toHaveLength(5);
    // Row order: A, B, B1, B2, C. Drag A into the top half of B2 (y 3*40 = 120..160, pointer at 125).
    await dragRow(rows[0], 125);
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "A", parent_id: "B", before_id: "B2" });
  });

  it("refuses a drop into the page's own subtree", async () => {
    const el = await render([page("A"), page("B"), page("B1", { parent_id: "B" }), page("C")]);
    const rows = layout(el);
    await dragRow(rows[1], 85);
    expect(actions.movePageAction).not.toHaveBeenCalled();
  });

  it("does not drag a locked page", async () => {
    const el = await render([page("A"), page("B", { is_locked: true }), page("C")]);
    const rows = layout(el);
    await dragRow(rows[1], 5);
    expect(actions.movePageAction).not.toHaveBeenCalled();
  });

  it("keeps Move up in the row menu as the keyboard path", async () => {
    const el = await render([page("A"), page("B")]);
    const trigger = el.querySelectorAll<HTMLButtonElement>('button[aria-label="Page actions"]')[1];
    await act(async () => {
      trigger?.click();
    });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent?.trim() ?? "");
    expect(labels.some((label) => label.startsWith("Move up"))).toBe(true);
  });

  it("shows a grip on movable rows only and a hidden spacer on a locked one", async () => {
    const el = await render([page("A"), page("B", { is_locked: true }), page("C")]);
    const rows = [...el.querySelectorAll<HTMLElement>(".tessera-page-row")];
    expect(rows.map((row) => row.querySelector(".tessera-row-grip") !== null)).toEqual([true, false, true]);
    expect(rows[1].querySelector(".tessera-page-grip-spacer")).not.toBeNull();
    expect(rows[0].classList.contains("tessera-page-row--draggable")).toBe(true);
    expect(rows[1].classList.contains("tessera-page-row--draggable")).toBe(false);
  });

  it("drags by touch from the grip only; a finger on the row scrolls", async () => {
    actions.movePageAction.mockResolvedValue(ok);
    const el = await render([page("A"), page("B"), page("C")]);
    const rows = layout(el);
    await dragRow(rows[2], 5, { pointerType: "touch" });
    expect(actions.movePageAction).not.toHaveBeenCalled();
    const grip = rows[2].querySelector(".tessera-row-grip") ?? rows[2];
    await dragRow(rows[2], 5, { from: grip, pointerType: "touch" });
    expect(actions.movePageAction).toHaveBeenCalledWith({ page_id: "C", parent_id: null, before_id: "A" });
  });
});
