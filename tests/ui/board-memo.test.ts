// @vitest-environment jsdom
/**
 * Board render identity during a drag (decision 136; src/components/work-items/BoardLayout.tsx, BoardColumn.tsx,
 * BoardVirtualCards.tsx): a drag publish reaches a column only as `hiddenId` / `slotIndex` / `placeholderHeight`,
 * so it re-renders the source and the target column and no other, and inside a column only the cards whose
 * `virtualIndex` changed.
 *
 * Counters: the column `Layout` (one render per BoardColumn render, by its header's column id) and the card's
 * `ClickableCard` (one per BoardCard render, by its label). `usePointerDrag` is the real hook with its `drag` state
 * set by the test (a publish is exactly a new `drag` object); its register functions and handlers stay real.
 * The board renders under a virtualising scroller provider, as in the screen; jsdom has no layout, so a windowed
 * column shows its deterministic initial window.
 */
import { act, createElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragState } from "@/components/dnd/use-pointer-drag";
import type { LayoutProps, ProjectBundle } from "@/components/work-items/types";
import type { Group, WorkItem } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const counts = vi.hoisted(() => ({ columns: new Map<string, number>(), cards: new Map<string, number>() }));
vi.mock("@astryxdesign/core/Layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/Layout")>();
  const Counted = (props: ComponentProps<typeof actual.Layout>) => {
    const header = props.header;
    const inner = isValidElement<{ children?: unknown }>(header) ? header.props.children : null;
    if (isValidElement<{ column?: { id: string } }>(inner) && inner.props.column) {
      const id = inner.props.column.id;
      counts.columns.set(id, (counts.columns.get(id) ?? 0) + 1);
    }
    return createElement(actual.Layout, props);
  };
  return { ...actual, Layout: Counted };
});
vi.mock("@astryxdesign/core/ClickableCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/ClickableCard")>();
  const Counted = (props: ComponentProps<typeof actual.ClickableCard>) => {
    const key = String(props.label).split(" ")[0];
    counts.cards.set(key, (counts.cards.get(key) ?? 0) + 1);
    return createElement(actual.ClickableCard, props);
  };
  return { ...actual, ClickableCard: Counted };
});
const dragCtl = vi.hoisted(() => ({ set: null as null | ((drag: DragState | null) => void) }));
vi.mock("@/components/dnd/use-pointer-drag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/dnd/use-pointer-drag")>();
  const React = await import("react");
  return {
    ...actual,
    usePointerDrag: (options: Parameters<typeof actual.usePointerDrag>[0]) => {
      const real = actual.usePointerDrag(options);
      const [drag, setDrag] = React.useState<DragState | null>(null);
      dragCtl.set = setDrag;
      return { ...real, drag };
    },
  };
});
const models = vi.hoisted(() => ({ list: [] as { containers: Map<string, { itemIds: string[] }> }[] }));
vi.mock("@/components/work-items/board-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/work-items/board-model")>();
  return {
    ...actual,
    useBoardModel: (...args: Parameters<typeof actual.useBoardModel>) => {
      const model = actual.useBoardModel(...args);
      models.list.push(model);
      return model;
    },
  };
});

const { BoardLayout } = await import("@/components/work-items/BoardLayout");
const { VirtualScrollerProvider } = await import("@/components/virtual/VirtualScrollerProvider");
const { ProjectScope } = await import("@/components/work-items/project-provider");
const { containerId } = await import("@/components/work-items/board-model");
const { dragKey } = await import("@/components/work-items/board-keys");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const A = "a0000000-0000-7000-8000-000000000001";
const B = "b0000000-0000-7000-8000-000000000002";
const C = "c0000000-0000-7000-8000-000000000003";
const D = "d0000000-0000-7000-8000-000000000004";

let sequence = 0;
function makeItems(state: string, length: number): WorkItem[] {
  return Array.from({ length }, () => {
    sequence += 1;
    return {
      id: `item-${sequence}`,
      project_id: PROJECT,
      sequence_id: sequence,
      key: `WEB-${sequence}`,
      name: `Item ${sequence}`,
      state_id: state,
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
      sort_order: `a${sequence}`,
    } as unknown as WorkItem;
  });
}

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB", estimates_enabled: false, archived_at: null },
  states: [
    { id: A, name: "Backlog", state_group: "backlog", color: "gray" },
    { id: B, name: "Todo", state_group: "unstarted", color: "blue" },
    { id: C, name: "Doing", state_group: "started", color: "yellow" },
    { id: D, name: "Done", state_group: "completed", color: "green" },
  ],
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

/** Columns A (3 cards), B (`bSize` cards), C (3) and D (3), grouped by state. */
function board(bSize: number) {
  sequence = 0;
  const columns: Record<string, WorkItem[]> = { [A]: makeItems(A, 3), [B]: makeItems(B, bSize), [C]: makeItems(C, 3), [D]: makeItems(D, 3) };
  const items = Object.values(columns).flat();
  const groups: Group[] = bundle.states.map((state): Group => ({ field: "state", id: state.id, name: state.name, color: null, count: columns[state.id].length, item_ids: columns[state.id].map((it) => it.id), has_more: false }));
  const result = { items, total: items.length, cursor: 1, groups };
  const display = { ...DEFAULT_DISPLAY, layout: "board" as const, group_by: "state" as const, order_by: "sort_order" as const };
  const handlers = { onMove: vi.fn(), onUpdate: vi.fn(), onOpen: vi.fn() };
  const props = { result, display, bundle, ...handlers } as unknown as LayoutProps;
  return { columns, props };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
beforeEach(() => {
  models.list.length = 0;
});
afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
});

async function render(props: LayoutProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const tree: ReactNode = createElement(
    ProjectScope,
    { bundle } as ComponentProps<typeof ProjectScope>,
    createElement(VirtualScrollerProvider, { scroller: null } as ComponentProps<typeof VirtualScrollerProvider>, createElement(BoardLayout, props)),
  );
  await act(async () => root?.render(tree));
}

/** Publishes a drag of `item` from its column, its slot in `target` at `index`. */
async function publish(item: WorkItem, from: string, target: string, index: number) {
  const fromContainer = containerId(from, null);
  await act(async () => dragCtl.set?.({ id: dragKey(fromContainer, item.id), fromContainer, width: 300, height: 120, target: { container: containerId(target, null), index } }));
}
function resetCounts() {
  counts.columns.clear();
  counts.cards.clear();
}
const columnRenders = () => Object.fromEntries([A, B, C, D].map((id) => [id, counts.columns.get(id) ?? 0]));
const cardRenders = (items: WorkItem[]) => items.map((it) => counts.cards.get(it.key) ?? 0);
const placeholderIndex = () => document.querySelector<HTMLElement>(".tessera-board-placeholder")?.dataset.index;

describe("board drag publish", () => {
  it("moving the slot inside column B re-renders column B only", async () => {
    const { columns, props } = board(3);
    await render(props);
    await publish(columns[A][0], A, B, 0);
    resetCounts();
    await publish(columns[A][0], A, B, 2);
    expect(columnRenders()).toEqual({ [A]: 0, [B]: 1, [C]: 0, [D]: 0 });
  });

  it("moving the slot from column B to column C re-renders B and C only", async () => {
    const { columns, props } = board(3);
    await render(props);
    await publish(columns[A][0], A, B, 1);
    resetCounts();
    await publish(columns[A][0], A, C, 1);
    expect(columnRenders()).toEqual({ [A]: 0, [B]: 1, [C]: 1, [D]: 0 });
  });

  it("starting a drag re-renders the source and the target column only", async () => {
    const { columns, props } = board(3);
    await render(props);
    resetCounts();
    await publish(columns[A][0], A, B, 0);
    expect(columnRenders()).toEqual({ [A]: 1, [B]: 1, [C]: 0, [D]: 0 });
  });

  it("re-renders no card of an 8-card column (not windowed) when only the slot moves", async () => {
    const { columns, props } = board(8);
    await render(props);
    await publish(columns[A][0], A, B, 1);
    expect(document.querySelector(".tessera-board-placeholder")).not.toBeNull();
    expect(placeholderIndex()).toBeUndefined();
    resetCounts();
    await publish(columns[A][0], A, B, 6);
    expect(columnRenders()[B]).toBe(1);
    expect(cardRenders(columns[B])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cardRenders(columns[A])).toEqual([0, 0, 0]);
  });

  it("in a windowed column re-renders only the cards whose virtualIndex changed", async () => {
    const { columns, props } = board(20);
    await render(props);
    await publish(columns[A][0], A, B, 1);
    expect(placeholderIndex()).toBe("1");
    const rendered = [...document.querySelectorAll<HTMLElement>(`.tessera-board-card[data-index]`)];
    // The initial window of a 528px column body: a few cards, far fewer than the 20 loaded.
    expect(rendered.length).toBeGreaterThanOrEqual(4);
    expect(rendered.length).toBeLessThan(20);
    resetCounts();
    await publish(columns[A][0], A, B, 3);
    expect(placeholderIndex()).toBe("3");
    // [c0, P, c1, c2, c3, …] → [c0, c1, c2, P, c3, …]: c1 and c2 move up one index; c0 (before the lower slot) and c3
    // onwards (after the higher one) keep theirs.
    const b = cardRenders(columns[B]);
    expect(b[0]).toBe(0);
    expect(b[1]).toBe(1);
    expect(b[2]).toBe(1);
    expect(b.slice(3)).toEqual(new Array(17).fill(0));
    expect(columnRenders()).toEqual({ [A]: 0, [B]: 1, [C]: 0, [D]: 0 });
  });

  it("keeps each container's itemIds identity across a drag publish", async () => {
    const { columns, props } = board(20);
    await render(props);
    const before = models.list.at(-1);
    await publish(columns[A][0], A, B, 1);
    await publish(columns[A][0], A, B, 5);
    const after = models.list.at(-1);
    expect(models.list.length).toBeGreaterThan(1);
    for (const id of [A, B, C, D]) {
      const key = containerId(id, null);
      expect(after?.containers.get(key)?.itemIds).toBe(before?.containers.get(key)?.itemIds);
    }
  });
});
