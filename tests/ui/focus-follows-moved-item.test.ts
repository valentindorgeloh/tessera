// @vitest-environment jsdom
/**
 * Keyboard focus follows a work item that leaves its group (src/components/work-items/focus-follow.ts). Changing a
 * row's State from the keyboard in a list or table grouped by state, or picking "Move to" in a board card's actions
 * menu, moves the item to another group: its old row or card unmounts and a new one mounts there. Before, the focus
 * fell to `<body>` and a keyboard user had to tab in again from the top. Now it lands on the same control of the moved
 * row or card (armed, so a State combobox is a combobox again), or, when the item left the list, on the same control of
 * the row that took its place. The real WorkItemsScreen renders the real layouts (the harness of row-arming.test.ts);
 * the Server Actions are held open until the test releases them, so the optimistic move and the server's answer are
 * checked apart. jsdom has no layout.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Display, Project, State, WorkItem } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const held = vi.hoisted(() => ({ releases: [] as (() => void)[], calls: [] as unknown[] }));
function holdOpen(input: unknown) {
  held.calls.push(input);
  return new Promise((resolve) => {
    held.releases.push(() => resolve(ok));
  });
}
vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: vi.fn(async () => ok),
  moveWorkItemAction: vi.fn((input: unknown) => holdOpen(input)),
  listWorkItemsAction: vi.fn(async () => ({ ok: false as const, message: "unused" })),
  updateWorkItemAction: vi.fn((input: unknown) => holdOpen(input)),
}));
vi.mock("@/app/actions/views", () => ({
  saveViewSettingsAction: vi.fn(async () => ok),
  resetViewSettingsAction: vi.fn(async () => ok),
  createViewAction: vi.fn(async () => ok),
  updateViewAction: vi.fn(async () => ok),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { WorkItemsScreen } = await import("@/components/work-items/WorkItemsScreen");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const BACKLOG = "66666666-6666-7666-8666-666666666661";
const TODO = "66666666-6666-7666-8666-666666666662";
const PROGRESS = "66666666-6666-7666-8666-666666666663";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

function makeBundle(): ProjectBundle {
  const project = {
    id: PROJECT,
    name: "Website",
    identifier: "WEB",
    next_sequence: 7,
    cycles_enabled: false,
    modules_enabled: false,
    views_enabled: true,
    estimates_enabled: false,
    archived_at: null,
    counts: { total: 6, by_state_group: { backlog: 2, unstarted: 2, started: 2, completed: 0, cancelled: 0, triage: 0 } },
    ...audit,
  } as unknown as Project;
  const state = (id: string, name: string, group: string, order: string) =>
    ({ id, project_id: PROJECT, name, name_key: name.toLowerCase(), description: "", color: "gray", state_group: group, is_default: id === BACKLOG, sort_order: order, ...audit }) as State;
  const states = [state(BACKLOG, "Backlog", "backlog", "a0"), state(TODO, "Todo", "unstarted", "a1"), state(PROGRESS, "In Progress", "started", "a2")];
  const actors = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }] as ActorRow[];
  return { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] };
}

/** Six items, two per state: WEB-1 and WEB-2 in Backlog, WEB-3 and WEB-4 in Todo, WEB-5 and WEB-6 in In Progress. */
function makeItems(): WorkItem[] {
  const stateOf = [BACKLOG, BACKLOG, TODO, TODO, PROGRESS, PROGRESS];
  return stateOf.map((stateId, index) => ({
    id: `item-${index + 1}`,
    project_id: PROJECT,
    sequence_id: index + 1,
    key: `WEB-${index + 1}`,
    name: `Item ${index + 1}`,
    description_md: "",
    description_version: 0,
    state_id: stateId,
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
  })) as WorkItem[];
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type ScreenProps = ComponentProps<typeof WorkItemsScreen>;
type World = { items: WorkItem[]; display: Display; bundle: ProjectBundle };

function world(layout: Display["layout"]): World {
  return { items: makeItems(), display: { ...DEFAULT_DISPLAY, layout, group_by: "state" }, bundle: makeBundle() };
}

/** What the server hands the client: the items grouped by state in sort order, as the engine groups them. */
function tree(w: World) {
  const groups = w.bundle.states.map((state) => {
    const ids = w.items.filter((item) => item.state_id === state.id).map((item) => item.id);
    return { field: "state" as const, id: state.id, name: state.name, color: null, count: ids.length, item_ids: ids, has_more: false };
  });
  const result = { items: clone(w.items), total: w.items.length, cursor: 1, groups };
  const display = clone(w.display);
  const props: ScreenProps = { projectId: PROJECT, result, display, filters: {}, settingsDisplay: clone(w.display), createOnOpen: false };
  return createElement(ProjectProvider, { bundle: clone(w.bundle) } as ComponentProps<typeof ProjectProvider>, createElement(WorkItemsScreen, props));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(w: World) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(tree(w));
  });
}

/** The server's answer: the refreshed list arrives and the held Server Action returns. */
async function answer(w: World) {
  await act(async () => {
    root?.render(tree(w));
    for (const release of held.releases.splice(0)) release();
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
  for (const release of held.releases.splice(0)) release();
  held.calls = [];
  document.body.querySelectorAll("button[data-outside]").forEach((button) => button.remove());
});

/** `key` pressed on the focused element. */
async function press(key: string) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** One animation frame: Astryx moves the focus into a menu a frame after a keyboard open. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

const focused = () => document.activeElement as HTMLElement | null;

/** The world after `key` moved to `stateId`; the server lists it at the end of its new group (its sort order is last). */
function moved(w: World, key: string, stateId: string): World {
  const next = clone(w);
  const item = next.items.find((candidate) => candidate.key === key)!;
  item.state_id = stateId;
  next.items = [...next.items.filter((candidate) => candidate !== item), item];
  return next;
}

/** Changes the State of the focused combobox from the keyboard: Enter opens it, ArrowDown twice, Enter picks. */
async function pickStateTwoDown() {
  expect(focused()?.getAttribute("role")).toBe("combobox");
  await press("Enter");
  expect(focused()?.getAttribute("aria-expanded")).toBe("true");
  await press("ArrowDown");
  await press("ArrowDown");
  await press("Enter");
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const tableRows = () => [...(container?.querySelectorAll<HTMLElement>("tr.tessera-table-row") ?? [])];
const tableKeyOf = (row: Element | null | undefined) => row?.closest("tr")?.querySelector(".tessera-table-open")?.textContent ?? null;
const tableRow = (key: string) => tableRows().find((row) => tableKeyOf(row) === key)!;
/** The State cell's trigger: the chip of a resting row or the combobox of an armed one. */
const tableState = (row: HTMLElement) => row.querySelector<HTMLElement>('button[data-arm-key="state"]') ?? [...row.querySelectorAll<HTMLElement>('[role="combobox"]')].find((trigger) => /Backlog|Todo|In Progress/.test(trigger.textContent ?? ""))!;

/** Focuses the key button of `key`'s table row (the row arms) and then its State combobox. */
async function focusTableState(key: string) {
  await act(async () => {
    tableRow(key).querySelector<HTMLButtonElement>(".tessera-table-open")!.focus();
  });
  await act(async () => {
    tableState(tableRow(key)).focus();
  });
}

describe("a table grouped by state", () => {
  it("keeps the focus on the State combobox of the row that moved to another group", async () => {
    const w = world("table");
    await mount(w);
    expect(tableRows().map((row) => tableKeyOf(row))).toEqual(["WEB-1", "WEB-2", "WEB-3", "WEB-4", "WEB-5", "WEB-6"]);
    await focusTableState("WEB-2");
    await pickStateTwoDown();
    expect(held.calls).toEqual([expect.objectContaining({ work_item_id: "item-2", state_id: PROGRESS })]);
    // The optimistic move: WEB-2 left Backlog for the end of In Progress, and the focus went with it.
    expect(tableRows().map((row) => tableKeyOf(row))).toEqual(["WEB-1", "WEB-3", "WEB-4", "WEB-5", "WEB-6", "WEB-2"]);
    expect(focused()).not.toBe(document.body);
    expect(tableKeyOf(focused())).toBe("WEB-2");
    expect(focused()?.getAttribute("role")).toBe("combobox");
    expect(focused()?.textContent).toContain("In Progress");
    expect(focused()?.getAttribute("aria-expanded")).toBe("false");
    // The server agrees; the focus stays where it is.
    await answer(moved(w, "WEB-2", PROGRESS));
    expect(tableKeyOf(focused())).toBe("WEB-2");
    expect(focused()?.getAttribute("role")).toBe("combobox");
    expect(focused()?.textContent).toContain("In Progress");
  });

  it("puts the focus on the same control of the row that took the place of an item the list no longer shows", async () => {
    const w = world("table");
    await mount(w);
    await focusTableState("WEB-3");
    await pickStateTwoDown();
    // A filtered list drops the item once the server has it in its new state: WEB-4 is now where WEB-3 was.
    const gone = moved(w, "WEB-3", PROGRESS);
    gone.items = gone.items.filter((item) => item.key !== "WEB-3");
    await answer(gone);
    expect(tableRows().map((row) => tableKeyOf(row))).toEqual(["WEB-1", "WEB-2", "WEB-4", "WEB-5", "WEB-6"]);
    expect(tableKeyOf(focused())).toBe("WEB-4");
    expect(focused()?.getAttribute("role")).toBe("combobox");
    expect(focused()?.textContent).toContain("Todo");
  });

  it("leaves the focus alone when it is outside the table while a row moves", async () => {
    const w = world("table");
    await mount(w);
    await focusTableState("WEB-1");
    const outside = document.createElement("button");
    outside.dataset.outside = "";
    document.body.appendChild(outside);
    await act(async () => {
      outside.focus();
    });
    // Another writer moves WEB-1; the refresh moves its row while the focus is on a button outside the table.
    await answer(moved(w, "WEB-1", TODO));
    expect(focused()).toBe(outside);
  });

  it("does not take the focus when nobody held it in the table", async () => {
    const w = world("table");
    await mount(w);
    await focusTableState("WEB-1");
    await act(async () => {
      focused()?.blur();
    });
    expect(focused()).toBe(document.body);
    await answer(moved(w, "WEB-1", TODO));
    expect(focused()).toBe(document.body);
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const listRows = () => [...(container?.querySelectorAll<HTMLElement>(".tessera-wi-row:not(.tessera-wi-row-pending)") ?? [])];
const listKeyOf = (element: Element | null | undefined) => element?.closest(".tessera-wi-row")?.querySelector(".tessera-wi-open")?.textContent ?? null;
const listRow = (key: string) => listRows().find((row) => listKeyOf(row) === key)!;

describe("a list grouped by state", () => {
  it("keeps the focus on the State combobox of the row that moved to another group", async () => {
    const w = world("list");
    await mount(w);
    await act(async () => {
      listRow("WEB-2").querySelector<HTMLButtonElement>(".tessera-wi-open")!.focus();
    });
    await act(async () => {
      tableState(listRow("WEB-2")).focus();
    });
    await pickStateTwoDown();
    expect(held.calls).toEqual([expect.objectContaining({ work_item_id: "item-2", state_id: PROGRESS })]);
    expect(listRows().map((row) => listKeyOf(row))).toEqual(["WEB-1", "WEB-3", "WEB-4", "WEB-5", "WEB-6", "WEB-2"]);
    expect(listKeyOf(focused())).toBe("WEB-2");
    expect(focused()?.getAttribute("role")).toBe("combobox");
    expect(focused()?.textContent).toContain("In Progress");
    await answer(moved(w, "WEB-2", PROGRESS));
    expect(listKeyOf(focused())).toBe("WEB-2");
    expect(focused()?.getAttribute("role")).toBe("combobox");
    // The arrow keys still work from there: a closed selector takes ArrowDown and opens.
    await press("ArrowDown");
    expect(listKeyOf(focused())).toBe("WEB-2");
    expect(focused()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("carries the list's tab stop to the moved row, so Shift+Tab reaches its key button and the arrows go on from there", async () => {
    const w = world("list");
    await mount(w);
    const key = (name: string) => listRow(name).querySelector<HTMLButtonElement>(".tessera-wi-open")!;
    const stops = () => [...(container?.querySelectorAll('.tessera-wi-open[tabindex="0"]') ?? [])].map((stop) => listKeyOf(stop));
    // A keyboard user arrows from the first row to WEB-2 (the stop moves with the arrows), then tabs on to its State.
    await act(async () => {
      key("WEB-1").focus();
    });
    await press("ArrowDown");
    expect(focused()).toBe(key("WEB-2"));
    expect(stops()).toEqual(["WEB-2"]);
    await act(async () => {
      tableState(listRow("WEB-2")).focus();
    });
    await pickStateTwoDown();
    expect(listKeyOf(focused())).toBe("WEB-2");
    expect(stops()).toEqual(["WEB-2"]);
    await answer(moved(w, "WEB-2", PROGRESS));
    expect(stops()).toEqual(["WEB-2"]);
    // Shift+Tab from the State lands on the key button (jsdom has no Tab: focus it), and ArrowUp goes to the row above.
    await act(async () => {
      key("WEB-2").focus();
    });
    await press("ArrowUp");
    expect(focused()).toBe(key("WEB-6"));
  });

  it("keeps the focus on a moved row's key button", async () => {
    const w = world("list");
    await mount(w);
    await act(async () => {
      listRow("WEB-4").querySelector<HTMLButtonElement>(".tessera-wi-open")!.focus();
    });
    // Another writer moves WEB-4 to Backlog while its key button has the focus.
    await answer(moved(w, "WEB-4", BACKLOG));
    expect(listRows().map((row) => listKeyOf(row))).toEqual(["WEB-1", "WEB-2", "WEB-4", "WEB-3", "WEB-5", "WEB-6"]);
    expect(focused()?.classList.contains("tessera-wi-open")).toBe(true);
    expect(listKeyOf(focused())).toBe("WEB-4");
  });
});

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

const cards = () => [...(container?.querySelectorAll<HTMLElement>(".tessera-board-card:not(.tessera-board-card-pending)") ?? [])];
const cardOf = (element: Element | null | undefined) => element?.closest<HTMLElement>(".tessera-board-card") ?? null;
const cardKey = (card: HTMLElement | null) => card?.getAttribute("aria-label")?.split(" ")[0] ?? card?.textContent?.match(/WEB-\d+/)?.[0] ?? null;
const card = (key: string) => cards().find((candidate) => candidate.querySelector(`[aria-label="Actions for ${key}"]`) !== null)!;
const columnOf = (element: Element) => element.closest(".tessera-board-column")?.querySelector("h4, [role='heading']")?.textContent ?? element.closest(".tessera-board-column")?.textContent ?? "";
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim().startsWith(label))!;

describe("a board grouped by state", () => {
  it("puts the focus on the moved card's Actions button after Move to", async () => {
    const w = world("board");
    await mount(w);
    const actions = card("WEB-2").querySelector<HTMLButtonElement>('[aria-label="Actions for WEB-2"]')!;
    await act(async () => {
      actions.focus();
    });
    // Enter on the focused button: a click with no pointer (detail 0) opens the menu after it mounted.
    await act(async () => {
      actions.click();
    });
    await frame();
    expect(focused()?.getAttribute("role")).toBe("menuitem");
    await act(async () => {
      menuItem("Move to").click();
    });
    await frame();
    await act(async () => {
      menuItem("In Progress").click();
    });
    await frame();
    expect(held.calls).toEqual([expect.objectContaining({ work_item_id: "item-2", group_by: "state", value: PROGRESS })]);
    // The card left Backlog for In Progress, and the focus went with it to its Actions button.
    expect(columnOf(card("WEB-2"))).toContain("In Progress");
    expect(focused()).not.toBe(document.body);
    expect(focused()?.getAttribute("aria-label")).toBe("Actions for WEB-2");
    expect(cardOf(focused())).toBe(card("WEB-2"));
    expect(focused()?.getAttribute("aria-expanded")).not.toBe("true");
    await answer(moved(w, "WEB-2", PROGRESS));
    expect(focused()?.getAttribute("aria-label")).toBe("Actions for WEB-2");
    expect(columnOf(cardOf(focused())!)).toContain("In Progress");
    // Enter opens the menu again from there.
    await act(async () => {
      (focused() as HTMLButtonElement).click();
    });
    await frame();
    expect(focused()?.getAttribute("role")).toBe("menuitem");
    expect(cardKey(cardOf(focused()))).toBeDefined();
  });

  it("keeps the focus on the card's own button when another writer moves the card", async () => {
    const w = world("board");
    await mount(w);
    // The card's open control: ClickableCard's button, named after the key and the title.
    const open = () => card("WEB-5").querySelector<HTMLButtonElement>('button[aria-label="WEB-5 Item 5"]')!;
    await act(async () => {
      open().focus();
    });
    await answer(moved(w, "WEB-5", BACKLOG));
    expect(columnOf(card("WEB-5"))).toContain("Backlog");
    expect(focused()).toBe(open());
  });
});
