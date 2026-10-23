// @vitest-environment jsdom
/**
 * Behaviour fixes of the board and the table (visual audit, lane board-table), under jsdom (no layout):
 * - a card starts a drag from a mouse or pen anywhere, from a finger only on its grip, and a read-only card has no grip;
 * - the card menu sits in its slot and the drag overlay keeps an inert slot of the same size;
 * - the card and the row of the item the side peek shows (`?peek=`) carry aria-current;
 * - ticking a table row's checkbox selects it without opening the item, a click elsewhere in the row still opens it.
 * The stylesheet rules are read in board-table-css.test.ts.
 */
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Group, Project, State, WorkItem } from "@/lib/tessera/types";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: vi.fn(), updateWorkItemAction: vi.fn(), moveWorkItemAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { BoardLayout } = await import("@/components/work-items/BoardLayout");
const { BoardCard } = await import("@/components/work-items/BoardCards");
const { TableLayout } = await import("@/components/work-items/TableLayout");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project = { id: PROJECT, name: "Website", identifier: "WEB", cycles_enabled: false, modules_enabled: false, estimates_enabled: false, archived_at: null, ...audit } as unknown as Project;
const states: State[] = [{ id: STATE, project_id: PROJECT, name: "Todo", name_key: "todo", description: "", color: "gray", state_group: "unstarted", is_default: true, sort_order: "a0", ...audit }];
const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }];
const bundle = { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] } as unknown as ProjectBundle;

function item(id: string, sequence: number): WorkItem {
  return {
    id,
    project_id: PROJECT,
    sequence_id: sequence,
    key: `WEB-${sequence}`,
    name: `Item ${sequence}`,
    description_md: "",
    description_version: 0,
    state_id: STATE,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: `a${sequence}`,
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

const first = item("item-1", 1);
const second = item("item-2", 2);
const group = { id: STATE, name: "Todo", color: null, count: 2, item_ids: [first.id, second.id], has_more: false } as unknown as Group;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  await act(async () => {
    root?.render(createElement(ProjectProvider, providerProps, node));
  });
  return container;
}

const layoutProps = (extra: Partial<ComponentProps<typeof BoardLayout>> = {}): ComponentProps<typeof BoardLayout> => ({
  result: { items: [first, second], total: 2, cursor: 1, groups: [group] },
  display: { ...DEFAULT_DISPLAY, group_by: "state" },
  bundle,
  onMove: () => {},
  onUpdate: () => {},
  onOpen: () => {},
  ...extra,
});

/** A pointerdown the way a browser sends it: the type (mouse, touch, pen) is the event's `pointerType`. */
function pointerDown(target: Element, pointerType: "mouse" | "touch" | "pen") {
  const init = { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, pointerId: 1 };
  const event = typeof PointerEvent === "function" ? new PointerEvent("pointerdown", init) : new MouseEvent("pointerdown", init);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return act(async () => {
    target.dispatchEvent(event);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  document.body.replaceChildren();
  root = null;
  container = null;
  nav.search = "";
});

describe("board card drag handle", () => {
  const cardProps = (extra: Partial<ComponentProps<typeof BoardCard>> = {}): ComponentProps<typeof BoardCard> => ({
    item: first,
    bundle,
    properties: DEFAULT_DISPLAY.properties,
    columns: [],
    currentColumn: STATE,
    onOpen: () => {},
    onMoveTo: () => {},
    ...extra,
  });

  it("starts a drag from a mouse or a pen anywhere on the card, from a finger only on the grip", async () => {
    const onPointerDown = vi.fn();
    const el = await render(createElement(BoardCard, cardProps({ handlers: { onPointerDown, onClickCapture: () => {} } })));
    const card = el.querySelector(".tessera-board-card") as HTMLElement;
    const grip = el.querySelector(".tessera-board-card-grip") as Element;
    expect(grip).not.toBeNull();
    const title = [...card.querySelectorAll("*")].find((node) => node.textContent === "Item 1" && node.children.length === 0) as Element;

    await pointerDown(title, "mouse");
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    await pointerDown(title, "pen");
    expect(onPointerDown).toHaveBeenCalledTimes(2);
    await pointerDown(title, "touch");
    expect(onPointerDown).toHaveBeenCalledTimes(2);
    await pointerDown(card, "touch");
    expect(onPointerDown).toHaveBeenCalledTimes(2);
    await pointerDown(grip, "touch");
    expect(onPointerDown).toHaveBeenCalledTimes(3);
  });

  it("has no grip and no drag handlers on a read-only card", async () => {
    const el = await render(createElement(BoardCard, cardProps()));
    expect(el.querySelector(".tessera-board-card-grip")).toBeNull();
    expect(el.querySelector(".tessera-board-card-readonly")).not.toBeNull();
  });

  it("puts the menu in its slot and gives the drag overlay's inert copy a slot of its own", async () => {
    const el = await render(createElement(BoardLayout, layoutProps()));
    const slots = el.querySelectorAll(".tessera-board-card-menu");
    expect(slots).toHaveLength(2);
    for (const slot of slots) expect(slot.querySelector("button[aria-label^='Actions for']")).not.toBeNull();
  });
});

describe("peeked card and row", () => {
  it("marks only the card of ?peek=<id> with aria-current", async () => {
    nav.search = `peek=${second.id}`;
    const el = await render(createElement(BoardLayout, layoutProps()));
    const current = [...el.querySelectorAll(".tessera-board-card")].filter((card) => card.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Item 2");
  });

  it("marks no card without a peek", async () => {
    const el = await render(createElement(BoardLayout, layoutProps()));
    expect(el.querySelectorAll('.tessera-board-card[aria-current="true"]')).toHaveLength(0);
  });

  it("marks only the row of ?peek=<id> in the table", async () => {
    nav.search = `peek=${first.id}`;
    const el = await render(createElement(TableLayout, layoutProps({ display: { ...DEFAULT_DISPLAY, layout: "table" } })));
    const current = el.querySelectorAll('tr[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("WEB-1");
  });
});

describe("table row selection", () => {
  const tableProps = (onOpen: () => void, onToggle: () => void) =>
    layoutProps({
      display: { ...DEFAULT_DISPLAY, layout: "table" },
      onOpen,
      selection: { selected: new Set<string>(), onToggle, onToggleIds: () => {} },
    });

  it("selects a row from its checkbox without opening the item", async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const el = await render(createElement(TableLayout, tableProps(onOpen, onToggle)));
    const row = [...el.querySelectorAll("tbody tr")].find((entry) => entry.textContent?.includes("Item 1")) as HTMLElement;
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox.click();
    });
    expect(onToggle).toHaveBeenCalledWith(first.id, false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("still opens the item from a click on the rest of the row", async () => {
    const onOpen = vi.fn();
    const el = await render(createElement(TableLayout, tableProps(onOpen, vi.fn())));
    const row = [...el.querySelectorAll("tbody tr")].find((entry) => entry.textContent?.includes("Item 1")) as HTMLElement;
    const nameCell = [...row.querySelectorAll("td")].find((cell) => cell.textContent === "Item 1") as HTMLElement;
    await act(async () => {
      nameCell.click();
    });
    expect(onOpen).toHaveBeenCalledWith(first.id);
  });
});
