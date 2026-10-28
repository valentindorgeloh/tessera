// @vitest-environment jsdom
/**
 * List row render identity (decision 141, docs/as-built/work-items.md "Render identity"): the real
 * WorkItemsScreen renders the real ListLayout with 20 rows, and a `ListItem` wrapper counts how often each row's
 * WorkItemRow rendered. A row must skip its render when nothing it shows changed (a refresh with equal data, a
 * tick elsewhere, a write that only moved the cursor and the counts) and must still update when its item, its
 * tick, its project row context or the display properties it shows change. The Server Actions and the router
 * are mocked; jsdom has no layout.
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

async function refresh(w: World) {
  counts.byName.clear();
  await act(async () => {
    root?.render(tree(w));
  });
}

const rowRenders = () => [...counts.byName.values()].reduce((sum, n) => sum + n, 0);
const rows = () => [...(container?.querySelectorAll(".tessera-wi-row") ?? [])] as HTMLElement[];
const lastProps = () => layout.props[layout.props.length - 1] as LayoutProps;

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
});

describe("a memoized list row", () => {
  it("renders every row once on the first draw", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(tree(world()));
    });
    expect(rows()).toHaveLength(20);
    expect(counts.byName.size).toBe(20);
    expect([...counts.byName.values()].every((n) => n === 1)).toBe(true);
  });

  it("skips every row on a refresh with equal data, even though the server hands in fresh copies and a bundle that moved", async () => {
    const w = world();
    await mount(w);
    const written = world();
    written.bundle.cursor = 9;
    written.bundle.project.counts.total = 21;
    written.bundle.project.next_sequence = 22;
    written.bundle.actors[0]!.last_seen_at = "2026-10-12T10:00:00.000Z";
    await refresh(written);
    expect(rows()).toHaveLength(20);
    expect(rowRenders()).toBe(0);
  });

  it("gives the layout handlers one identity across refreshes", async () => {
    await mount(world());
    await refresh(world());
    await refresh(world());
    const [first, ...later] = layout.props as LayoutProps[];
    expect(later.length).toBeGreaterThan(0);
    for (const props of later) {
      expect(props.onUpdate).toBe(first!.onUpdate);
      expect(props.onOpen).toBe(first!.onOpen);
      expect(props.selection?.onToggle).toBe(first!.selection?.onToggle);
      expect(props.display).toBe(first!.display);
    }
  });

  it("renders one row when one item changed, and shows the change", async () => {
    const w = world();
    await mount(w);
    const changed = world();
    changed.items[3]!.name = "Item 3 renamed";
    changed.items[3]!.state_id = DONE;
    await refresh(changed);
    expect(rowRenders()).toBe(1);
    expect(counts.byName.get("Item 3 renamed")).toBe(1);
    expect(rows()[3]!.textContent).toContain("Item 3 renamed");
    expect(rows()[3]!.textContent).toContain("Done");
    expect(rows()[4]!.textContent).toContain("Todo");
  });

  it("renders one row when a new item arrives at the top (an agent created it)", async () => {
    await mount(world());
    const grown = world();
    grown.items.unshift({ ...makeItems()[0]!, id: "item-new", name: "Item new", key: "WEB-21", sort_order: "a" });
    await refresh(grown);
    expect(rows()).toHaveLength(21);
    expect(rowRenders()).toBe(1);
    expect(counts.byName.get("Item new")).toBe(1);
  });

  it("renders one row when its checkbox is ticked, and shows the tick", async () => {
    await mount(world());
    const box = rows()[2]!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box).not.toBeNull();
    await act(async () => {
      box!.click();
    });
    expect(rowRenders()).toBe(1);
    expect(counts.byName.get("Item 2")).toBe(1);
    expect(rows()[2]!.hasAttribute("data-selected")).toBe(true);
    expect(rows()[3]!.hasAttribute("data-selected")).toBe(false);
    expect(container?.querySelector(".tessera-wi-list--selecting")).not.toBeNull();
  });

  it("renders one row for an inline edit, shows it at once, and keeps the others", async () => {
    await mount(world());
    await act(async () => {
      lastProps().onUpdate("item-5", { priority: "urgent" });
    });
    // The write is still in flight: the optimistic copy is on screen.
    expect(update.release).not.toBeNull();
    expect(counts.byName.get("Item 5")).toBeGreaterThanOrEqual(1);
    expect([...counts.byName.keys()]).toEqual(["Item 5"]);
    expect(rows()[5]!.querySelector('[aria-label="Urgent"]')).not.toBeNull();
    expect(rows()[6]!.querySelector('[aria-label="Urgent"]')).toBeNull();
    await act(async () => {
      update.release?.();
    });
  });

  it("still draws a renamed state on every row that shows it, without rendering the rows", async () => {
    await mount(world());
    expect(rows()[0]!.textContent).toContain("Todo");
    const renamed = world();
    renamed.bundle.states[0]!.name = "To do";
    await refresh(renamed);
    expect(rowRenders()).toBe(0);
    for (const row of rows()) {
      expect(row.textContent).toContain("To do");
      expect(row.textContent).not.toContain("Todo");
    }
  });

  it("redraws every row when the display's properties change", async () => {
    const w = world();
    expect(w.display.properties.priority).toBe(true);
    await mount(w);
    expect(rows()[0]!.querySelector('[aria-label="No priority"]')).not.toBeNull();
    const hidden = world();
    hidden.display.properties.priority = false;
    await refresh(hidden);
    expect(rowRenders()).toBe(20);
    for (const row of rows()) expect(row.querySelector('[aria-label="No priority"]')).toBeNull();
  });

  it("marks the scroller grouped exactly while the list draws group bands", async () => {
    await mount(world());
    expect(container?.querySelector(".tessera-wi-scroller")).not.toBeNull();
    expect(container?.querySelector(".tessera-wi-scroller--grouped")).toBeNull();
    expect(container?.querySelector(".tessera-wi-group")).toBeNull();
    await refresh(world("state"));
    expect(container?.querySelector(".tessera-wi-group")).not.toBeNull();
    expect(container?.querySelector(".tessera-wi-scroller.tessera-wi-scroller--grouped")).not.toBeNull();
    await refresh(world());
    expect(container?.querySelector(".tessera-wi-scroller--grouped")).toBeNull();
  });

  it("opens the peek with the URL of the latest render, not the one the row was drawn with", async () => {
    await mount(world());
    const first = lastProps().onOpen;
    nav.search = "q=abc";
    await refresh(world());
    expect(lastProps().onOpen).toBe(first);
    first("item-4");
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(String(nav.push.mock.calls[0]![0])).toBe("/projects/p/work-items?q=abc&peek=item-4");
  });
});
