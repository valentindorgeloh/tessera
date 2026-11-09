// @vitest-environment jsdom
/**
 * A windowed board column (decisions 135-137; src/components/work-items/BoardVirtualCards.tsx): the drag
 * placeholder is one more entry of the column, keyed "placeholder", so the keys and the entries stay aligned with
 * the placeholder at the top, in the middle and at the end, and the rendered placeholder carries its own
 * `data-index`. The windowed render runs under a scroller provider that virtualises but has no measured scroller
 * (jsdom has no layout), so the window is the deterministic initial range.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { WorkItem } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { boardCards, BoardVirtualCards, PLACEHOLDER_KEY } = await import("@/components/work-items/BoardVirtualCards");
const { VirtualScrollerProvider } = await import("@/components/virtual/VirtualScrollerProvider");
const { ProjectScope } = await import("@/components/work-items/project-provider");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const STATE = "66666666-6666-7666-8666-666666666666";

function item(index: number): WorkItem {
  return {
    id: `item-${index}`,
    project_id: PROJECT,
    key: `WEB-${index + 1}`,
    name: `Item ${index}`,
    state_id: STATE,
    priority: "none",
    label_ids: [],
    module_ids: [],
    assignee_ids: [],
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: null,
    sub_items_count: 0,
    links_count: 0,
  } as unknown as WorkItem;
}

const items = Array.from({ length: 20 }, (_, i) => item(i));
const ids = items.map((it) => it.id);
const byId = new Map(items.map((it) => [it.id, it]));

describe("boardCards (the column's entries)", () => {
  const keysOf = (entries: ReturnType<typeof boardCards>) => entries.map((entry) => entry.key);

  it("lists the loaded cards in order without a drag", () => {
    const entries = boardCards(ids, byId, null, null);
    expect(keysOf(entries)).toEqual(ids);
    entries.forEach((entry, i) => expect(entry.item).toBe(items[i]));
  });

  it("puts the placeholder at index 0", () => {
    const entries = boardCards(ids, byId, null, 0);
    expect(keysOf(entries)).toEqual([PLACEHOLDER_KEY, ...ids]);
    expect(entries[0].item).toBeNull();
    entries.slice(1).forEach((entry, i) => expect(entry.item).toBe(items[i]));
  });

  it("puts the placeholder in the middle", () => {
    const entries = boardCards(ids, byId, null, 7);
    expect(keysOf(entries)).toEqual([...ids.slice(0, 7), PLACEHOLDER_KEY, ...ids.slice(7)]);
    entries.forEach((entry) => expect(entry.item === null ? PLACEHOLDER_KEY : entry.item.id).toBe(entry.key));
  });

  it("puts the placeholder at the end, and clamps a slot past it", () => {
    expect(keysOf(boardCards(ids, byId, null, 20)).at(-1)).toBe(PLACEHOLDER_KEY);
    expect(keysOf(boardCards(ids, byId, null, 99))).toEqual([...ids, PLACEHOLDER_KEY]);
    expect(keysOf(boardCards(ids, byId, null, -3))[0]).toBe(PLACEHOLDER_KEY);
  });

  it("leaves out the dragged card's copy in this column and counts the slot without it", () => {
    const entries = boardCards(ids, byId, "item-2", 4);
    expect(keysOf(entries)).toEqual([...ids.slice(0, 2), ...ids.slice(3, 5), PLACEHOLDER_KEY, ...ids.slice(5)]);
    expect(entries).toHaveLength(20);
  });

  it("skips an id that is not loaded", () => {
    expect(keysOf(boardCards(["item-0", "gone", "item-1"], byId, null, 1))).toEqual(["item-0", PLACEHOLDER_KEY, "item-1"]);
  });
});

describe("BoardVirtualCards (windowed)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (typeof window.matchMedia !== "function") {
      window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
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
      await act(async () => current.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  const bundle = {
    project: { id: PROJECT, name: "Website", identifier: "WEB", estimates_enabled: false },
    states: [{ id: STATE, name: "Todo", state_group: "unstarted", color: "gray" }],
    labels: [],
    cycles: [],
    modules: [],
    actors: [],
    cursor: 1,
    today: "2026-10-17",
    estimate: null,
    intake_open: 0,
    projects: [],
  } as unknown as ProjectBundle;
  const noop = () => {};
  const refFor = () => noop;
  const handlers = { onPointerDown: noop, onClickCapture: noop };

  function column(slotIndex: number | null, isVirtual = true, virtualizes = true): ReactNode {
    const cards = createElement(BoardVirtualCards, {
      container: "col:todo",
      cards: boardCards(ids, byId, null, slotIndex),
      isVirtual,
      properties: DEFAULT_DISPLAY.properties,
      moveTargets: [],
      currentColumn: "todo",
      readOnly: false,
      peekedId: null,
      placeholderHeight: 120,
      registerItem: () => refFor,
      itemHandlers: () => handlers,
      onOpen: noop,
      onMoveTo: noop,
    });
    const scoped = virtualizes ? createElement(VirtualScrollerProvider, { scroller: null } as ComponentProps<typeof VirtualScrollerProvider>, cards) : cards;
    return createElement(ProjectScope, { bundle } as ComponentProps<typeof ProjectScope>, scoped);
  }
  async function render(node: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(node));
    return container;
  }
  const indexed = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-index]")];

  it("renders a window of the column, every entry with its data-index in order", async () => {
    const el = await render(column(null));
    const rows = indexed(el);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(20);
    expect(rows.map((row) => row.dataset.index)).toEqual(rows.map((_, i) => String(i)));
    expect(el.querySelector(".tessera-board-cards")?.classList.contains("tessera-virtual")).toBe(true);
  });

  it("gives the placeholder at the top its own data-index 0, the cards after it shifted by one", async () => {
    const el = await render(column(0));
    const rows = indexed(el);
    expect(rows[0].classList.contains("tessera-board-placeholder")).toBe(true);
    expect(rows[0].dataset.index).toBe("0");
    expect(rows[1].textContent).toContain("WEB-1");
    expect(rows[1].dataset.index).toBe("1");
  });

  it("gives a placeholder inside the window its own data-index, keys and entries aligned", async () => {
    const el = await render(column(2));
    const rows = indexed(el);
    const placeholder = el.querySelector<HTMLElement>(".tessera-board-placeholder");
    expect(placeholder?.dataset.index).toBe("2");
    expect(rows[1].textContent).toContain("WEB-2");
    expect(rows[3].textContent).toContain("WEB-3");
  });

  it("does not render a placeholder past the window", async () => {
    const el = await render(column(20));
    expect(el.querySelector(".tessera-board-placeholder")).toBeNull();
  });

  it("renders every card with no data-index when the column is not windowed, the placeholder at the end", async () => {
    const el = await render(column(20, false));
    expect(indexed(el)).toHaveLength(0);
    expect(el.querySelectorAll(".tessera-board-card")).toHaveLength(20);
    expect(el.querySelector(".tessera-board-cards")?.lastElementChild?.classList.contains("tessera-board-placeholder")).toBe(true);
  });

  it("renders every card without a virtualising provider (the default store)", async () => {
    const el = await render(column(null, true, false));
    expect(indexed(el)).toHaveLength(0);
    expect(el.querySelectorAll(".tessera-board-card")).toHaveLength(20);
  });
});
