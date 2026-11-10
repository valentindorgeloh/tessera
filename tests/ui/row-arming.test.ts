// @vitest-environment jsdom
/**
 * Row arming (src/components/work-items/properties/arming.tsx): a list row draws chips, not selectors and popovers,
 * until the pointer or keyboard focus reaches it. The real WorkItemsScreen renders the real ListLayout with 20 rows
 * (the harness of list-row-memo.test.ts), and a `ListItem` wrapper counts each row's renders. Arming must touch the
 * armed row alone, keep keyboard focus where it was, and open the control a click on a chip was aimed at. The Server
 * Actions and the router are mocked; jsdom has no layout.
 */
import { act, createElement, isValidElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LayoutProps, ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Display, Project, State, WorkItem } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const update = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: vi.fn(async () => ok),
  moveWorkItemAction: vi.fn(async () => ok),
  listWorkItemsAction: vi.fn(async () => ({ ok: false as const, message: "unused" })),
  // Held open until the test releases it, so the optimistic copy can be read while the write is in flight.
  updateWorkItemAction: vi.fn(
    () =>
      new Promise((resolve) => {
        update.release = () => resolve(ok);
      }),
  ),
}));
vi.mock("@/app/actions/views", () => ({
  saveViewSettingsAction: vi.fn(async () => ok),
  resetViewSettingsAction: vi.fn(async () => ok),
  createViewAction: vi.fn(async () => ok),
  updateViewAction: vi.fn(async () => ok),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// Record what the cards hand MoreMenu, so a test can tell a menu that mounts open from one that opens after it mounted.
const menus = vi.hoisted(() => ({ opened: [] as boolean[] }));
vi.mock("@astryxdesign/core/MoreMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/MoreMenu")>();
  const Recorded = (props: ComponentProps<typeof actual.MoreMenu>) => {
    menus.opened.push(props.isMenuOpen === true);
    return createElement(actual.MoreMenu, props);
  };
  return { ...actual, MoreMenu: Recorded };
});
// Count the renders of each row's ListItem by its title (RowTitle's `name`): one per WorkItemRow render.
const counts = vi.hoisted(() => ({ byName: new Map<string, number>() }));
vi.mock("@astryxdesign/core/List", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/List")>();
  const Counted = (props: ComponentProps<typeof actual.ListItem>) => {
    const label = props.label;
    if (isValidElement<{ name?: string }>(label) && typeof label.props.name === "string") counts.byName.set(label.props.name, (counts.byName.get(label.props.name) ?? 0) + 1);
    return createElement(actual.ListItem, props);
  };
  return { ...actual, ListItem: Counted };
});
// Record the props the screen hands the list, and render the real one.
const layout = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("@/components/work-items/ListLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/work-items/ListLayout")>();
  return {
    ...actual,
    ListLayout: (props: LayoutProps) => {
      layout.props.push(props);
      return createElement(actual.ListLayout, props);
    },
  };
});

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { WorkItemsScreen } = await import("@/components/work-items/WorkItemsScreen");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

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
    next_sequence: 21,
    cycles_enabled: false,
    modules_enabled: false,
    views_enabled: true,
    estimates_enabled: false,
    archived_at: null,
    counts: { total: 20, by_state_group: { backlog: 0, unstarted: 20, started: 0, completed: 0, cancelled: 0, triage: 0 } },
    ...audit,
  } as unknown as Project;
  const states = [
    { id: TODO, project_id: PROJECT, name: "Todo", name_key: "todo", description: "", color: "gray", state_group: "unstarted", is_default: true, sort_order: "a0", ...audit },
    { id: DONE, project_id: PROJECT, name: "Done", name_key: "done", description: "", color: "green", state_group: "completed", is_default: false, sort_order: "a1", ...audit },
  ] as State[];
  const actors = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }] as ActorRow[];
  return { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] };
}

function makeItems(): WorkItem[] {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `item-${index}`,
    project_id: PROJECT,
    sequence_id: index + 1,
    key: `WEB-${index + 1}`,
    name: `Item ${index}`,
    description_md: "",
    description_version: 0,
    state_id: TODO,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: `a${String(index).padStart(2, "0")}`,
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

function world(groupBy: Display["group_by"] = null): World {
  return { items: makeItems(), display: { ...DEFAULT_DISPLAY, layout: "list", group_by: groupBy }, bundle: makeBundle() };
}

/** What the server hands the client after a refresh: a fresh copy of the same data, with the world's changes. */
function tree(w: World) {
  const groups = w.display.group_by
    ? [{ field: w.display.group_by, id: TODO, name: "Todo", color: null, count: w.items.length, item_ids: w.items.map((item) => item.id), has_more: false }]
    : undefined;
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
  counts.byName.clear();
}

const rowRenders = () => [...counts.byName.values()].reduce((sum, n) => sum + n, 0);
const rows = () => [...(container?.querySelectorAll(".tessera-wi-row") ?? [])] as HTMLElement[];

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
  update.release = null;
  nav.search = "";
  nav.push.mockClear();
  counts.byName.clear();
  layout.props = [];
  menus.opened = [];
});


/** A mouse pointer entering `element`: React derives `onPointerEnter` from `pointerover`. */
function pointerEnter(element: Element, pointerType: string) {
  const event = new MouseEvent("pointerover", { bubbles: true, cancelable: true, relatedTarget: null });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  element.dispatchEvent(event);
}

/** A pointer moving over `element` (React's `onPointerMove`). */
function pointerMove(element: Element, pointerType: string) {
  const event = new MouseEvent("pointermove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  element.dispatchEvent(event);
}

const comboboxes = (row: HTMLElement) => row.querySelectorAll('[role="combobox"]');
const chips = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>("button[data-arm-key]")];
const chip = (row: HTMLElement, key: string) => row.querySelector<HTMLButtonElement>(`button[data-arm-key="${key}"]`)!;

function datedWorld(): World {
  const w = world();
  w.display.properties.start_date = true;
  w.display.properties.target_date = true;
  return w;
}

describe("an unarmed list row", () => {
  it("draws its property controls as chips with no selector, popover or layer sentinel", async () => {
    await mount(datedWorld());
    for (const row of rows()) {
      expect(chips(row).map((button) => button.getAttribute("data-arm-key"))).toEqual(["state", "priority", "start", "target"]);
      expect(comboboxes(row)).toHaveLength(0);
      expect(row.querySelectorAll("template")).toHaveLength(0);
    }
    // The chip names the control and its value, and shows the same value the armed control shows.
    expect(chip(rows()[0]!, "state").getAttribute("aria-label")).toBe("State: Todo");
    expect(chip(rows()[0]!, "state").textContent).toContain("Todo");
    expect(chip(rows()[0]!, "priority").getAttribute("aria-label")).toBe("Priority: No priority");
  });

  it("arms only the row the mouse enters, and draws the real controls there", async () => {
    await mount(datedWorld());
    await act(async () => {
      pointerEnter(rows()[3]!, "mouse");
    });
    expect([...counts.byName.keys()]).toEqual(["Item 3"]);
    expect(counts.byName.get("Item 3")).toBe(1);
    expect(comboboxes(rows()[3]!).length).toBeGreaterThanOrEqual(2);
    expect(chips(rows()[3]!)).toHaveLength(0);
    expect(comboboxes(rows()[4]!)).toHaveLength(0);
    expect(chips(rows()[4]!)).toHaveLength(4);
    // A second enter does nothing: the row is armed already.
    counts.byName.clear();
    await act(async () => {
      pointerEnter(rows()[3]!, "mouse");
    });
    expect(rowRenders()).toBe(0);
  });

  it("arms a row the mouse moves over without entering it, as when the row appeared under a resting pointer", async () => {
    await mount(datedWorld());
    await act(async () => {
      pointerMove(rows()[3]!, "touch");
    });
    expect(rowRenders()).toBe(0);
    await act(async () => {
      pointerMove(rows()[3]!, "mouse");
    });
    expect([...counts.byName.keys()]).toEqual(["Item 3"]);
    expect(comboboxes(rows()[3]!).length).toBeGreaterThanOrEqual(2);
    // The row arms within the pointer event itself, so a press that follows at once lands on the real control.
    await act(async () => {
      pointerMove(rows()[5]!, "mouse");
      expect(comboboxes(rows()[5]!).length).toBeGreaterThanOrEqual(2);
    });
    // Further moves over the armed row render nothing.
    counts.byName.clear();
    await act(async () => {
      pointerMove(rows()[3]!, "mouse");
      pointerMove(rows()[3]!, "mouse");
    });
    expect(rowRenders()).toBe(0);
  });

  it("stays unarmed for a touch pointer, so a tap's own target is not replaced under it", async () => {
    await mount(datedWorld());
    await act(async () => {
      pointerEnter(rows()[3]!, "touch");
    });
    expect(rowRenders()).toBe(0);
    expect(comboboxes(rows()[3]!)).toHaveLength(0);
  });

  it("opens the control a click on its chip was aimed at, without any hover", async () => {
    await mount(datedWorld());
    await act(async () => {
      chip(rows()[2]!, "state").click();
    });
    const triggers = [...comboboxes(rows()[2]!)];
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    const state = triggers.find((trigger) => trigger.textContent?.includes("Todo"));
    expect(state?.getAttribute("aria-expanded")).toBe("true");
    // The other selector of the row stays closed.
    expect(triggers.filter((trigger) => trigger.getAttribute("aria-expanded") === "true")).toHaveLength(1);
    expect(comboboxes(rows()[3]!)).toHaveLength(0);
  });

  it("opens the date popover a click on its chip was aimed at", async () => {
    await mount(datedWorld());
    await act(async () => {
      chip(rows()[1]!, "target").click();
    });
    const target = rows()[1]!.querySelector<HTMLButtonElement>('button[aria-label="Target date"]');
    expect(target).not.toBeNull();
    expect(target!.getAttribute("aria-expanded")).toBe("true");
    const start = rows()[1]!.querySelector<HTMLButtonElement>('button[aria-label="Start date"]');
    expect(start!.getAttribute("aria-expanded")).not.toBe("true");
  });

  it("keeps keyboard focus on the key button while focus arms the row", async () => {
    await mount(datedWorld());
    const key = rows()[5]!.querySelector<HTMLButtonElement>(".tessera-wi-open")!;
    await act(async () => {
      key.focus();
    });
    expect(chips(rows()[5]!)).toHaveLength(0);
    expect(comboboxes(rows()[5]!).length).toBeGreaterThanOrEqual(2);
    expect(rows()[5]!.querySelector(".tessera-wi-open")).toBe(key);
    expect(document.activeElement).toBe(key);
    expect(rows()[6]!.querySelectorAll("[role=combobox]")).toHaveLength(0);
  });

  it("hands the focus of a chip to its armed control when the mouse arms the row", async () => {
    await mount(datedWorld());
    const priority = chip(rows()[7]!, "priority");
    await act(async () => {
      priority.focus();
    });
    // Focusing a chip alone keeps the row unarmed: its click is what arms and opens it.
    expect(chips(rows()[7]!)).toHaveLength(4);
    await act(async () => {
      pointerEnter(rows()[7]!, "mouse");
    });
    expect(chips(rows()[7]!)).toHaveLength(0);
    const focused = document.activeElement;
    expect(focused?.getAttribute("role")).toBe("combobox");
    expect(rows()[7]!.contains(focused)).toBe(true);
    expect(focused?.querySelector('[aria-label="No priority"]')).not.toBeNull();
    expect(focused?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a read-only row without layers: selectors stay read-only, dates become disabled chips", async () => {
    const w = datedWorld();
    w.bundle.project.archived_at = NOW;
    await mount(w);
    const row = rows()[0]!;
    expect(row.querySelectorAll("template")).toHaveLength(0);
    // State and priority are Astryx read-only selectors (no selection surface), dates the disabled chips.
    expect(comboboxes(row)).toHaveLength(2);
    expect(chips(row).map((button) => button.getAttribute("data-arm-key"))).toEqual(["start", "target"]);
    for (const button of chips(row)) expect(button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true").toBe(true);
    await act(async () => {
      pointerEnter(row, "mouse");
    });
    expect(row.querySelectorAll("template")).toHaveLength(0);
  });
});

describe("an unarmed table row", () => {
  const tableRows = () => [...(container?.querySelectorAll("tr.tessera-table-row") ?? [])] as HTMLElement[];
  // The Assignees, Labels and Modules cells are read-only selectors in every row; only the editable ones are in question.
  const editable = (row: HTMLElement) => row.querySelectorAll('[role="combobox"]:not([aria-readonly="true"])');

  function tableWorld(): World {
    const w = datedWorld();
    w.display.layout = "table";
    return w;
  }

  it("draws chips in its editable cells and arms only the row the mouse enters", async () => {
    await mount(tableWorld());
    expect(tableRows()).toHaveLength(20);
    for (const row of tableRows()) {
      expect(chips(row).map((button) => button.getAttribute("data-arm-key"))).toEqual(["state", "priority", "cycle", "start", "target"]);
      expect(editable(row)).toHaveLength(0);
      expect(row.querySelectorAll("template")).toHaveLength(0);
    }
    await act(async () => {
      pointerEnter(tableRows()[4]!, "mouse");
    });
    expect(chips(tableRows()[4]!)).toHaveLength(0);
    expect(editable(tableRows()[4]!).length).toBeGreaterThanOrEqual(2);
    expect(chips(tableRows()[5]!)).toHaveLength(5);
    expect(editable(tableRows()[5]!)).toHaveLength(0);
    // A move arms a row too, as when a row appears under a resting pointer, and within the pointer event itself.
    await act(async () => {
      pointerMove(tableRows()[6]!, "mouse");
      expect(chips(tableRows()[6]!)).toHaveLength(0);
    });
    expect(editable(tableRows()[6]!).length).toBeGreaterThanOrEqual(2);
  });

  it("opens the state selector a click on its chip was aimed at, and keeps focus on the key button when focus arms a row", async () => {
    await mount(tableWorld());
    await act(async () => {
      chip(tableRows()[2]!, "state").click();
    });
    const expanded = [...editable(tableRows()[2]!)].filter((trigger) => trigger.getAttribute("aria-expanded") === "true");
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.textContent).toContain("Todo");
    const key = tableRows()[6]!.querySelector<HTMLButtonElement>(".tessera-table-open")!;
    await act(async () => {
      key.focus();
    });
    expect(chips(tableRows()[6]!)).toHaveLength(0);
    expect(document.activeElement).toBe(key);
    expect(chips(tableRows()[7]!)).toHaveLength(5);
  });
});

describe("an unarmed board card", () => {
  const cards = () => [...(container?.querySelectorAll(".tessera-board-card:not(.tessera-board-card-pending)") ?? [])] as HTMLElement[];
  const menuChip = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('button[data-arm-key="menu"]');
  const menuTrigger = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('button[aria-label="Actions for WEB-1"], button[aria-label^="Actions for"]');

  async function mountBoard() {
    const w = world("state");
    w.display.layout = "board";
    await mount(w);
  }

  it("shows an icon button for its actions menu until the mouse enters the card", async () => {
    await mountBoard();
    expect(cards().length).toBeGreaterThan(1);
    for (const card of cards()) {
      expect(menuChip(card)).not.toBeNull();
      expect(card.querySelectorAll("template")).toHaveLength(0);
    }
    await act(async () => {
      pointerEnter(cards()[1]!, "mouse");
      // Within the pointer event: a press that follows at once lands on the real menu button.
      expect(menuChip(cards()[1]!)).toBeNull();
    });
    expect(menuChip(cards()[1]!)).toBeNull();
    expect(menuTrigger(cards()[1]!)).not.toBeNull();
    expect(menus.opened).toEqual([false]);
    expect(menuChip(cards()[2]!)).not.toBeNull();
  });

  it("opens the menu a pointer click on its icon button was aimed at", async () => {
    await mountBoard();
    menus.opened = [];
    await act(async () => {
      // A mouse or finger click reports detail 1; `click()` is the keyboard's (detail 0).
      menuChip(cards()[3]!)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(menuChip(cards()[3]!)).toBeNull();
    expect(menuTrigger(cards()[3]!)).not.toBeNull();
    // The menu mounts open, and stays open through the render that spends the open intent.
    expect(menus.opened[0]).toBe(true);
    expect(menus.opened).not.toContain(false);
  });

  it("opens the menu once, after it mounted, for a click from the keyboard, and Astryx then puts the focus on its first item", async () => {
    await mountBoard();
    const card = cards()[3]!;
    const button = menuChip(card)!;
    await act(async () => {
      button.focus();
    });
    menus.opened = [];
    await act(async () => {
      // Enter on a focused button: a click with no pointer (detail 0).
      button.click();
    });
    // The trigger took the focus the chip held; the menu mounted closed and opened in the next render, once.
    expect(menus.opened[0]).toBe(false);
    expect(menus.opened).toContain(true);
    expect(menus.opened.filter((value, index) => value !== menus.opened[index - 1])).toEqual([false, true]);
    // Astryx focuses the first item a frame after a keyboard open.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(menuTrigger(card)?.getAttribute("aria-expanded")).toBe("true");
    const focused = document.activeElement;
    expect(focused?.getAttribute("role")).toBe("menuitem");
    expect(focused?.textContent).toBe("Open");
    // The button held the focus when the menu opened, so Escape hands the focus back to it.
    await act(async () => {
      focused?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(menuTrigger(card)?.getAttribute("aria-expanded")).not.toBe("true");
    expect(document.activeElement).toBe(menuTrigger(card));
  });
});

describe("keyboard activation of a chip", () => {
  const tableRows = () => [...(container?.querySelectorAll("tr.tessera-table-row") ?? [])] as HTMLElement[];
  const cards = () => [...(container?.querySelectorAll(".tessera-board-card:not(.tessera-board-card-pending)") ?? [])] as HTMLElement[];

  it("leaves the focus on the real selector that replaced a focused list chip", async () => {
    await mount(datedWorld());
    const row = rows()[2]!;
    await act(async () => {
      chip(row, "state").focus();
    });
    // Enter on a focused button is a click.
    await act(async () => {
      chip(row, "state").click();
    });
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(focused?.getAttribute("role")).toBe("combobox");
    expect(row.contains(focused)).toBe(true);
    expect(focused?.getAttribute("aria-expanded")).toBe("true");
    expect(focused?.textContent).toContain("Todo");
  });

  it("leaves the focus on the real date button that replaced a focused date chip", async () => {
    await mount(datedWorld());
    const row = rows()[2]!;
    await act(async () => {
      chip(row, "target").focus();
    });
    await act(async () => {
      chip(row, "target").click();
    });
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    // The popover opened and moved the focus into its calendar (hasAutoFocus), so the focus is inside the open control.
    expect(row.querySelector('button[aria-label="Target date"]')?.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves the focus on the real selector that replaced a focused table chip", async () => {
    const w = datedWorld();
    w.display.layout = "table";
    await mount(w);
    const row = tableRows()[2]!;
    await act(async () => {
      chip(row, "priority").focus();
    });
    await act(async () => {
      chip(row, "priority").click();
    });
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(focused?.getAttribute("role")).toBe("combobox");
    expect(row.contains(focused)).toBe(true);
    expect(focused?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the focus in the card: on the real menu button that replaced a focused icon button, then in its open menu", async () => {
    const w = world("state");
    w.display.layout = "board";
    await mount(w);
    const card = cards()[3]!;
    const button = card.querySelector<HTMLButtonElement>('button[data-arm-key="menu"]')!;
    await act(async () => {
      button.focus();
    });
    await act(async () => {
      button.click();
    });
    // A keyboard open lets Astryx move the focus to the menu's first item a frame later. Whether that frame already ran
    // depends on the machine's load, so wait for it: the focus then sits inside the open menu of the real button.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const trigger = card.querySelector<HTMLButtonElement>('button[aria-label^="Actions for "]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const focused = document.activeElement;
    expect(focused).not.toBe(document.body);
    expect(card.contains(focused)).toBe(true);
    expect(focused?.getAttribute("role")).toBe("menuitem");
  });
});

describe("the open intent of a clicked chip", () => {
  const tableRows = () => [...(container?.querySelectorAll("tr.tessera-table-row") ?? [])] as HTMLElement[];
  const expanded = (row: HTMLElement) => [...row.querySelectorAll('[aria-expanded="true"]')];

  /** Render the same world again with one property switched off, then on: the control unmounts and mounts again. */
  async function toggleProperty(w: World, property: "state" | "target_date") {
    w.display.properties[property] = false;
    await act(async () => {
      root?.render(tree(w));
    });
    w.display.properties[property] = true;
    await act(async () => {
      root?.render(tree(w));
    });
  }

  it("is spent once the state selector of a list row opened, so a remount stays closed", async () => {
    const w = datedWorld();
    await mount(w);
    await act(async () => {
      chip(rows()[2]!, "state").click();
    });
    expect(expanded(rows()[2]!)).toHaveLength(1);
    await toggleProperty(w, "state");
    // The row is still armed and the state control is back, drawn as the real selector and closed.
    const triggers = [...rows()[2]!.querySelectorAll('[role="combobox"]')];
    expect(triggers.some((trigger) => trigger.textContent?.includes("Todo"))).toBe(true);
    expect(expanded(rows()[2]!)).toHaveLength(0);
  });

  it("is spent once the date popover of a list row opened, so a remount stays closed", async () => {
    const w = datedWorld();
    await mount(w);
    await act(async () => {
      chip(rows()[1]!, "target").click();
    });
    expect(expanded(rows()[1]!)).toHaveLength(1);
    await toggleProperty(w, "target_date");
    expect(rows()[1]!.querySelector('button[aria-label="Target date"]')).not.toBeNull();
    expect(expanded(rows()[1]!)).toHaveLength(0);
  });

  it("is spent once the state selector of a table cell opened, so a remount stays closed", async () => {
    const w = datedWorld();
    w.display.layout = "table";
    await mount(w);
    await act(async () => {
      chip(tableRows()[2]!, "state").click();
    });
    expect(expanded(tableRows()[2]!).filter((element) => element.getAttribute("role") === "combobox")).toHaveLength(1);
    await toggleProperty(w, "state");
    const triggers = [...tableRows()[2]!.querySelectorAll('[role="combobox"]:not([aria-readonly="true"])')];
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    expect(expanded(tableRows()[2]!)).toHaveLength(0);
  });

  it("does not hand the focus to a control that mounts again later", async () => {
    const w = datedWorld();
    await mount(w);
    await act(async () => {
      chip(rows()[2]!, "state").focus();
    });
    await act(async () => {
      chip(rows()[2]!, "state").click();
    });
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });
    await toggleProperty(w, "state");
    expect(document.activeElement).toBe(document.body);
  });
});

describe("a read-only compact date", () => {
  it("shows its full date in a tooltip once the row is armed, and carries none while it is a resting chip", async () => {
    const w = datedWorld();
    w.bundle.project.archived_at = NOW;
    w.items[0]!.target_date = "2026-10-05";
    await mount(w);
    const row = rows()[0]!;
    expect(chip(row, "target").getAttribute("aria-describedby")).toBeNull();
    await act(async () => {
      pointerEnter(row, "mouse");
    });
    const target = chip(row, "target");
    expect(target.hasAttribute("data-arm-key")).toBe(true);
    expect(target.getAttribute("aria-describedby")).not.toBeNull();
    expect(document.getElementById(target.getAttribute("aria-describedby")!)?.textContent).toBe("Target date: 2026-10-05");
  });
});

describe("a resting cycle chip", () => {
  const CYCLE = "88888888-8888-7888-8888-888888888888";

  function cycleWorld(layoutName: "list" | "table"): World {
    const w = datedWorld();
    w.display.layout = layoutName;
    w.bundle.project.cycles_enabled = true;
    w.bundle.cycles = [{ id: CYCLE, project_id: PROJECT, name: "Sprint 4", description: "", status: "current", start_date: "2026-10-12", end_date: "2026-10-26", sort_order: "a0", archived_at: null, ...audit }] as unknown as ProjectBundle["cycles"];
    w.items[0]!.cycle_id = CYCLE;
    return w;
  }

  it.each(["list", "table"] as const)("draws a set cycle as a tinted pill without a clear glyph, as its armed selector does, in a %s", async (layoutName) => {
    await mount(cycleWorld(layoutName));
    const selector = layoutName === "list" ? ".tessera-wi-row" : "tr.tessera-table-row";
    const [first, second] = [...(container?.querySelectorAll(selector) ?? [])] as HTMLElement[];
    // A set cycle is a pill as wide as its name: the chip holds no stand-in for the clear button (the selector's lies over the pill's end).
    expect(chip(first!, "cycle").textContent).toContain("Sprint 4");
    expect(chip(first!, "cycle").classList.contains("tessera-wi-pill")).toBe(true);
    expect(chip(first!, "cycle").querySelector(".tessera-wi-chip-clear")).toBeNull();
    expect(chip(first!, "cycle").hasAttribute("data-empty")).toBe(false);
    // An empty cycle is no pill; it is marked so that it is drawn on a hovered or focused row or cell only.
    expect(chip(second!, "cycle").classList.contains("tessera-wi-pill")).toBe(false);
    expect(chip(second!, "cycle").hasAttribute("data-empty")).toBe(true);
    // The armed selector draws the real clear button and the pill class for the same cycle, and neither for an empty one.
    await act(async () => {
      pointerEnter(first!, "mouse");
      pointerEnter(second!, "mouse");
    });
    expect(first!.querySelector('button[aria-label="Clear Cycle"]')).not.toBeNull();
    expect(first!.querySelector(".astryx-selector.tessera-wi-pill")).not.toBeNull();
    expect(second!.querySelector('button[aria-label="Clear Cycle"]')).toBeNull();
    expect(second!.querySelector(".astryx-selector.tessera-wi-pill")).toBeNull();
  });
});
