// @vitest-environment jsdom
/**
 * Keys inside a list row (src/components/work-items/ListLayout.tsx): the list's roving focus moves between the rows'
 * key buttons on ArrowUp, ArrowDown, Home and End, and must leave those keys to a control that took them. A selector
 * takes them (it calls `preventDefault`, open or closed) and the date popover is an open layer; before, the keys also
 * bubbled up to the list, which moved the focus to the first row's key button, closed the listbox and picked nothing.
 * The real WorkItemsScreen renders the real ListLayout (the harness of row-arming.test.ts); jsdom has no layout.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Display, Project, State, WorkItem } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: vi.fn(async () => ok),
  moveWorkItemAction: vi.fn(async () => ok),
  listWorkItemsAction: vi.fn(async () => ({ ok: false as const, message: "unused" })),
  updateWorkItemAction: vi.fn(async () => ok),
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
}

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
  nav.search = "";
  nav.push.mockClear();
});



/** A mouse pointer entering `element`: React derives `onPointerEnter` from `pointerover`. */
function pointerEnter(element: Element) {
  const event = new MouseEvent("pointerover", { bubbles: true, cancelable: true, relatedTarget: null });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  element.dispatchEvent(event);
}

/** `key` pressed on the focused element; the event comes back so a test can read whether a control took it. */
async function press(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

const keyButton = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".tessera-wi-open")!;
const stateSelector = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>('[role="combobox"]')].find((trigger) => trigger.textContent?.includes("Todo"))!;

function datedWorld(): World {
  const w = world();
  w.display.properties.start_date = true;
  w.display.properties.target_date = true;
  return w;
}

describe("keys inside a list row", () => {
  it("moves the active option of an open State selector and keeps the focus on it", async () => {
    await mount(datedWorld());
    await act(async () => {
      rows()[2]!.querySelector<HTMLButtonElement>('button[data-arm-key="state"]')!.click();
    });
    const state = stateSelector(rows()[2]!);
    expect(state.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      state.focus();
    });
    const option = () => state.getAttribute("aria-activedescendant")?.replace(/^.*-item-/, "") ?? null;
    expect(option()).toBeNull();
    const down = await press("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(state);
    expect(state.getAttribute("aria-expanded")).toBe("true");
    expect(option()).toBe("0");
    // Every key the list moves rows on stays with the selector: the focus never leaves it, and the active option follows.
    await press("ArrowDown");
    expect(document.activeElement).toBe(state);
    expect(option()).toBe("1");
    await press("ArrowUp");
    expect(document.activeElement).toBe(state);
    expect(option()).toBe("0");
    await press("End");
    expect(document.activeElement).toBe(state);
    expect(option()).toBe("1");
    await press("Home");
    expect(document.activeElement).toBe(state);
    expect(option()).toBe("0");
    expect(state.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a closed selector on ArrowDown and keeps the focus on it", async () => {
    await mount(datedWorld());
    await act(async () => {
      pointerEnter(rows()[4]!);
    });
    const state = stateSelector(rows()[4]!);
    await act(async () => {
      state.focus();
    });
    expect(state.getAttribute("aria-expanded")).toBe("false");
    await press("ArrowDown");
    expect(document.activeElement).toBe(state);
    expect(state.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves the keys typed in the open date popover to the popover", async () => {
    await mount(datedWorld());
    await act(async () => {
      rows()[1]!.querySelector<HTMLButtonElement>('button[data-arm-key="target"]')!.click();
    });
    // The popover renders inline in the list, as a native popover, and takes the focus when it opens.
    const inside = document.activeElement as HTMLElement;
    expect(inside.closest("[popover]")).not.toBeNull();
    expect(inside.closest(".tessera-wi-list")).not.toBeNull();
    for (const key of ["ArrowDown", "ArrowUp", "End", "Home"]) {
      await press(key);
      expect(document.activeElement).toBe(inside);
    }
  });

  it("still moves between the rows from a row's key button", async () => {
    await mount(datedWorld());
    const all = rows();
    await act(async () => {
      keyButton(all[2]!).focus();
    });
    const down = await press("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(keyButton(all[3]!));
    await press("ArrowDown");
    expect(document.activeElement).toBe(keyButton(all[4]!));
    await press("ArrowUp");
    expect(document.activeElement).toBe(keyButton(all[3]!));
    await press("End");
    expect(document.activeElement).toBe(keyButton(all[all.length - 1]!));
    await press("Home");
    expect(document.activeElement).toBe(keyButton(all[0]!));
  });
});
