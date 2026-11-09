// @vitest-environment jsdom
/**
 * The board drop settle (docs/contracts/ui.md "Motion"):
 *
 * - `usePointerDrag` measures the drag overlay at the moment of the drop and hands the rectangle to `onDrop`
 *   (`overlayRect`), and exposes the registered item element (`getItemElement`); both are additive;
 * - BoardLayout jumps the dropped card back to the overlay's place and springs it to rest (`set`, then `animate` to 0
 *   with no velocity), only for a drop that goes through, never under Reduce Motion;
 * - the start is clamped horizontally so the card begins inside its column body (a scroller that clips it): a drop near
 *   the column's edge no longer starts the glide cut off.
 *
 * jsdom has no layout, so rectangles are stubbed (tests/helpers/pointer-drag-dom.ts) and the animator is a spy;
 * tests/e2e/motion-work-items.spec.ts runs the real thing in a browser.
 */
import { act, createElement, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { box, drag, pointerEvent, stubRects, type Box } from "../helpers/pointer-drag-dom";
import type { DragDropEvent } from "@/components/dnd/use-pointer-drag";
import type { LayoutProps, MoveInput, ProjectBundle } from "@/components/work-items/types";
import { settleStartX } from "@/components/work-items/settle-offset";
import type { ActorRow, Display, Project, State, WorkItem, WorkItemListResult } from "@/lib/tessera/types";

// The real hooks, except the animator: a spy handle.
const animator = vi.hoisted(() => ({ set: vi.fn(), animate: vi.fn(() => Promise.resolve()), stop: vi.fn() }));
vi.mock("@astryxdesign/core/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/hooks")>();
  return { ...actual, useAnimator: () => animator };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { usePointerDrag } = await import("@/components/dnd/use-pointer-drag");
const { BoardLayout } = await import("@/components/work-items/BoardLayout");
const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreRects: (() => void) | null = null;
let reduceMotion = false;
const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  reduceMotion = false;
  window.matchMedia = ((query: string) =>
    ({
      matches: reduceMotion && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
  animator.set.mockClear();
  animator.animate.mockClear();
  overlayBox = OVERLAY;
});

afterEach(async () => {
  restoreRects?.();
  restoreRects = null;
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  window.matchMedia = originalMatchMedia;
});

async function mountNode(node: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type Drops = DragDropEvent[];

function HookHarness({ drops, withOverlay }: { drops: Drops; withOverlay: boolean }) {
  const { drag: state, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop: (event) => drops.push(event),
    itemsOf: (name) => (name === "left" ? ["a", "b"] : ["c"]),
  });
  return createElement(
    "div",
    null,
    ["left", "right"].map((name) =>
      createElement(
        "div",
        { key: name, id: name, ref: registerContainer(name) },
        (name === "left" ? ["a", "b"] : ["c"]).map((id) => createElement("div", { key: id, id, ref: registerItem(id), ...itemHandlers(id, name) }, id)),
      ),
    ),
    state && withOverlay ? createElement("div", { id: "overlay", ref: registerOverlay }, "ghost") : null,
  );
}

const HOOK_RECTS: Record<string, Box> = {
  left: box(0, 0, 200, 300),
  right: box(300, 0, 200, 300),
  a: box(0, 0, 200, 80),
  b: box(0, 90, 200, 80),
  c: box(300, 0, 200, 80),
  overlay: box(310, 40, 200, 80),
};

describe("usePointerDrag drop event", () => {
  it("carries the overlay's rectangle as measured at the drop", async () => {
    restoreRects = stubRects(HOOK_RECTS);
    const drops: Drops = [];
    await mountNode(createElement(HookHarness, { drops, withOverlay: true }));
    await drag(document.getElementById("a")!, { x: 100, y: 40 }, [{ x: 110, y: 50 }, { x: 350, y: 60 }, { x: 360, y: 60 }]);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.toContainer).toBe("right");
    expect(drops[0]!.overlayRect).toEqual({ left: 310, top: 40, width: 200, height: 80 });
  });

  it("leaves overlayRect out when the surface renders no overlay (every other surface is unchanged)", async () => {
    restoreRects = stubRects(HOOK_RECTS);
    const drops: Drops = [];
    await mountNode(createElement(HookHarness, { drops, withOverlay: false }));
    await drag(document.getElementById("a")!, { x: 100, y: 40 }, [{ x: 110, y: 50 }, { x: 350, y: 60 }, { x: 360, y: 60 }]);
    expect(drops).toHaveLength(1);
    expect("overlayRect" in drops[0]!).toBe(false);
  });

  it("does not drop on Escape", async () => {
    restoreRects = stubRects(HOOK_RECTS);
    const drops: Drops = [];
    await mountNode(createElement(HookHarness, { drops, withOverlay: true }));
    await drag(document.getElementById("a")!, { x: 100, y: 40 }, [{ x: 110, y: 50 }, { x: 350, y: 60 }], { release: false });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      pointerEvent("pointerup", 350, 60, window);
    });
    expect(drops).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const TODO = "66666666-6666-7666-8666-666666666666";
const DONE = "77777777-7777-7777-8777-777777777777";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

function makeBundle(): ProjectBundle {
  const project = {
    id: PROJECT,
    name: "Website",
    identifier: "WEB",
    next_sequence: 4,
    cycles_enabled: false,
    modules_enabled: false,
    views_enabled: true,
    estimates_enabled: false,
    archived_at: null,
    counts: { total: 3, by_state_group: { backlog: 0, unstarted: 2, started: 0, completed: 1, cancelled: 0, triage: 0 } },
    ...audit,
  } as unknown as Project;
  const states = [
    { id: TODO, project_id: PROJECT, name: "Todo", name_key: "todo", description: "", color: "gray", state_group: "unstarted", is_default: true, sort_order: "a0", ...audit },
    { id: DONE, project_id: PROJECT, name: "Done", name_key: "done", description: "", color: "green", state_group: "completed", is_default: false, sort_order: "a1", ...audit },
  ] as State[];
  const actors = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }] as ActorRow[];
  return { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] };
}

function makeItem(id: string, index: number, state: string): WorkItem {
  return {
    id,
    project_id: PROJECT,
    sequence_id: index + 1,
    key: `WEB-${index + 1}`,
    name: `Card ${id}`,
    description_md: "",
    description_version: 0,
    state_id: state,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: `a${index}`,
    external_source: null,
    external_id: null,
    label_ids: [],
    module_ids: [],
    assignee_ids: [],
    sub_items_count: 0,
    links_count: 0,
    intake: null,
    ...audit,
  } as WorkItem;
}

/** Which card ids sit in which state column. */
type Placement = { todo: string[]; done: string[] };

/** `lanes`: one swimlane (by priority) holds every card, so each column's cards sit in a lane cell instead of the column body. */
function resultOf(placement: Placement, lanes: boolean): WorkItemListResult {
  const items = [...placement.todo.map((id, i) => makeItem(id, i, TODO)), ...placement.done.map((id, i) => makeItem(id, i + 10, DONE))];
  const group = (id: string, name: string, ids: string[]) => ({
    field: "state" as const,
    id,
    name,
    color: null,
    count: ids.length,
    item_ids: ids,
    has_more: false,
    ...(lanes ? { sub_groups: [{ field: "priority" as const, id: "none", name: "No priority", color: null, count: ids.length, item_ids: ids, has_more: false }] } : {}),
  });
  return { items, total: items.length, cursor: 1, groups: [group(TODO, "Todo", placement.todo), group(DONE, "Done", placement.done)] } as unknown as WorkItemListResult;
}

const DISPLAY: Display = { ...DEFAULT_DISPLAY, layout: "board", group_by: "state" };
const LANES_DISPLAY: Display = { ...DISPLAY, sub_group_by: "priority" };

const moves: MoveInput[] = [];
let placementOf: ((moved: Placement) => void) | null = null;

/** The board with the optimistic copy a drop commits at once: the move lands in the same commit as the drag state clearing. */
function BoardHarness({ initial, after, lanes = false }: { initial: Placement; after: Placement; lanes?: boolean }) {
  const [placement, setPlacement] = useState(initial);
  useEffect(() => {
    placementOf = setPlacement;
  }, []);
  const props: LayoutProps = {
    result: resultOf(placement, lanes),
    display: lanes ? LANES_DISPLAY : DISPLAY,
    bundle: makeBundle(),
    onMove: (input) => {
      moves.push(input);
      setPlacement(after);
    },
    onUpdate: () => {},
    onOpen: () => {},
  };
  return createElement(ProjectProvider, { bundle: makeBundle() } as ComponentProps<typeof ProjectProvider>, createElement(BoardLayout, props));
}

const COLUMN_X = [0, 400];
/** The column body's padding (padding={2}, 8px): the card sits this far inside it on both sides. */
const PAD = 8;
const OVERLAY = box(430, 150, 350, 80);
let overlayBox: Box = OVERLAY;

/** What clips the cards: a column's body, or a swimlane's cell. */
const BODY = ".tessera-board-column-body, .tessera-board-cell";

/** Bodies side by side; a card sits inside its body, inset by its padding, at a fixed step; the overlay is where the pointer let go. */
function boardRects(): () => void {
  return stubRects((el) => {
    if (el.matches(BODY)) {
      const index = [...document.querySelectorAll(BODY)].indexOf(el);
      return box(COLUMN_X[index] ?? 0, 50, 350, 600);
    }
    if (el.classList.contains("tessera-board-card")) {
      const body = el.closest(BODY);
      const column = [...document.querySelectorAll(BODY)].indexOf(body as Element);
      const row = [...(body?.querySelectorAll(".tessera-board-card") ?? [])].indexOf(el);
      return box((COLUMN_X[column] ?? 0) + PAD, 60 + row * 90, 350 - 2 * PAD, 80);
    }
    if (el.classList.contains("tessera-drag-overlay")) return overlayBox;
    return null;
  });
}

const cardOf = (id: string) => [...document.querySelectorAll<HTMLElement>(".tessera-board-card")].find((el) => (el.textContent ?? "").includes(`Card ${id}`))!;

/** Press a card in the Todo column, cross the threshold and release over the Done column. */
async function dropOnDone(id: string) {
  await drag(cardOf(id), { x: 100, y: 100 }, [{ x: 110, y: 110 }, { x: 450, y: 160 }, { x: 460, y: 170 }]);
}

describe("BoardLayout drop settle", () => {
  it("springs the dropped card from the overlay's place into its slot: set, then animate to rest, no velocity", async () => {
    restoreRects = boardRects();
    moves.length = 0;
    await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: ["a"] } }));
    expect(animator.set).not.toHaveBeenCalled();
    await dropOnDone("a");
    expect(moves).toHaveLength(1);
    // The card is now the first one of the Done column: its slot is at x 408, y 60; the overlay was at 430, 150. The
    // horizontal offset (22) is beyond the body's padding, so it is clamped to it; the vertical one is kept.
    expect(animator.set).toHaveBeenCalledTimes(1);
    expect(animator.set).toHaveBeenCalledWith({ x: PAD, y: OVERLAY.top - 60 });
    expect(animator.animate).toHaveBeenCalledTimes(1);
    expect(animator.animate).toHaveBeenCalledWith({ x: 0, y: 0 }); // no velocity: it would overshoot
    expect(animator.set.mock.invocationCallOrder[0]).toBeLessThan(animator.animate.mock.invocationCallOrder[0]);
  });

  it("starts inside the column body: an overlay that let go beyond either edge is clamped to it, one inside is kept", async () => {
    const SLOT_X = COLUMN_X[1]! + PAD;
    const cases: Array<{ name: string; left: number; x: number }> = [
      { name: "far right of the column", left: 700, x: PAD },
      { name: "far left of the column", left: 120, x: -PAD },
      { name: "within the padding", left: SLOT_X + 5, x: 5 },
      { name: "on the slot", left: SLOT_X, x: 0 },
    ];
    for (const { name, left, x } of cases) {
      overlayBox = box(left, 150, 350, 80);
      restoreRects = boardRects();
      moves.length = 0;
      animator.set.mockClear();
      await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: ["a"] } }));
      await dropOnDone("a");
      expect(animator.set, name).toHaveBeenCalledWith({ x, y: 150 - 60 });
      restoreRects?.();
      restoreRects = null;
      const current = root;
      await act(async () => current?.unmount());
      root = null;
      container?.remove();
    }
  });

  it("clamps the same way in a swimlane, where the lane's cell clips the card", async () => {
    restoreRects = boardRects();
    moves.length = 0;
    await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: ["a"] }, lanes: true }));
    expect(document.querySelectorAll(".tessera-board-cell")).toHaveLength(2);
    await dropOnDone("a");
    expect(moves).toHaveLength(1);
    expect(animator.set).toHaveBeenCalledWith({ x: PAD, y: OVERLAY.top - 60 });
  });

  it("does not settle on a plain render, a refresh or a press that never travels", async () => {
    restoreRects = boardRects();
    moves.length = 0;
    await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: ["a"] } }));
    // A refresh with the same data.
    await act(async () => placementOf?.({ todo: ["a", "b"], done: [] }));
    expect(animator.set).not.toHaveBeenCalled();
    // A press that never travels is a click, not a drop.
    await drag(cardOf("a"), { x: 100, y: 100 }, [{ x: 101, y: 101 }]);
    expect(moves).toHaveLength(0);
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("lands at once under Reduce Motion", async () => {
    reduceMotion = true;
    restoreRects = boardRects();
    moves.length = 0;
    await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: ["a"] } }));
    await dropOnDone("a");
    expect(moves).toHaveLength(1);
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("does nothing when the dropped card is not on screen afterwards", async () => {
    restoreRects = boardRects();
    moves.length = 0;
    // The move filters the card out of the board (a filter that no longer matches it).
    await mountNode(createElement(BoardHarness, { initial: { todo: ["a", "b"], done: [] }, after: { todo: ["b"], done: [] } }));
    await dropOnDone("a");
    expect(moves).toHaveLength(1);
    expect(animator.set).not.toHaveBeenCalled();
  });
});

describe("settleStartX", () => {
  const slot = { left: 108, right: 442 };
  const clip = { left: 100, right: 450 };

  it("keeps the offset when the card has no clipping body", () => {
    expect(settleStartX(300, slot, null)).toBe(300);
    expect(settleStartX(-300, slot, undefined)).toBe(-300);
  });

  it("keeps an offset that leaves the card inside the body", () => {
    expect(settleStartX(0, slot, clip)).toBe(0);
    expect(settleStartX(7, slot, clip)).toBe(7);
    expect(settleStartX(-8, slot, clip)).toBe(-8);
  });

  it("clamps an offset that would push the card past either edge", () => {
    expect(settleStartX(300, slot, clip)).toBe(8);
    expect(settleStartX(-300, slot, clip)).toBe(-8);
    expect(settleStartX(9, slot, clip)).toBe(8);
  });

  it("starts in the slot when the card is wider than its body", () => {
    expect(settleStartX(50, { left: 90, right: 460 }, clip)).toBe(0);
  });
});
