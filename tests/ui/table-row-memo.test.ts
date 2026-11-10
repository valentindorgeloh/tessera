// @vitest-environment jsdom
/**
 * Table row render identity (decision 141, docs/as-built/work-items.md "Render identity"): the real WorkItemsScreen
 * renders the real TableLayout with 20 rows. Astryx's Table re-renders a row when the item, the `columns` array or a plugin
 * changes identity, so the screen and the table keep those still across a refresh with equal data and a write that
 * moves only the cursor and the counts. A counting wrapper of the name cell's `OneLineText` records how often each row's
 * cells are drawn (a skipped row does not call its `renderCell`). The Server Actions and the router are mocked; jsdom
 * has no layout.
 */
import { act, createElement, type ComponentProps } from "react";
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

// Count the draws of each row's name cell by its text: one per row render (the table calls `renderCell` only for a row it draws).
const counts = vi.hoisted(() => ({ byName: new Map<string, number>() }));
vi.mock("@/components/work-items/OneLineText", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/work-items/OneLineText")>();
  const Counted = (props: ComponentProps<typeof actual.OneLineText>) => {
    counts.byName.set(props.children, (counts.byName.get(props.children) ?? 0) + 1);
    return createElement(actual.OneLineText, props);
  };
  return { ...actual, OneLineText: Counted };
});
// Record the props the screen hands the list, and render the real one.
const layout = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("@/components/work-items/TableLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/work-items/TableLayout")>();
  return {
    ...actual,
    TableLayout: (props: LayoutProps) => {
      layout.props.push(props);
      return createElement(actual.TableLayout, props);
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
  return { items: makeItems(), display: { ...DEFAULT_DISPLAY, layout: "table", group_by: groupBy }, bundle: makeBundle() };
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


const rowCount = () => container?.querySelectorAll("tr.tessera-table-row").length ?? 0;

describe("a memoized table row", () => {
  it("draws every row once on the first draw", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(tree(world()));
    });
    expect(rowCount()).toBe(20);
    expect(counts.byName.size).toBe(20);
    expect([...counts.byName.values()].every((n) => n === 1)).toBe(true);
  });

  it("skips every row on a refresh with equal data, even though the server hands in fresh copies and a bundle that moved", async () => {
    await mount(world());
    const written = world();
    written.bundle.cursor = 9;
    written.bundle.project.counts.total = 21;
    written.bundle.project.next_sequence = 22;
    written.bundle.actors[0]!.last_seen_at = "2026-10-12T10:00:00.000Z";
    await refresh(written);
    expect(rowCount()).toBe(20);
    expect(rowRenders()).toBe(0);
    await refresh(world());
    expect(rowRenders()).toBe(0);
  });

  it("gives the table's inputs one identity across refreshes", async () => {
    await mount(world());
    await refresh(world());
    await refresh(world());
    const [first, ...later] = layout.props as LayoutProps[];
    expect(later.length).toBeGreaterThan(0);
    for (const props of later) {
      expect(props.onUpdate).toBe(first!.onUpdate);
      expect(props.onOpen).toBe(first!.onOpen);
      expect(props.onMove).toBe(first!.onMove);
      expect(props.onQuickAdd).toBe(first!.onQuickAdd);
      expect(props.onOrderChange).toBe(first!.onOrderChange);
      expect(props.display).toBe(first!.display);
      expect(props.display.properties).toBe(first!.display.properties);
    }
  });

  it("gives the clear-filters handler one identity while filters apply", async () => {
    const seen: unknown[] = [];
    await mount(world());
    const filtered = (items: number) => {
      const w = world();
      w.items = w.items.slice(0, items);
      const props = { projectId: PROJECT, result: { items: clone(w.items), total: items, cursor: 1, groups: undefined }, display: clone(w.display), filters: { priority: ["urgent"] }, settingsDisplay: clone(w.display), createOnOpen: false } as unknown as ScreenProps;
      return createElement(ProjectProvider, { bundle: clone(w.bundle) } as ComponentProps<typeof ProjectProvider>, createElement(WorkItemsScreen, props));
    };
    await act(async () => {
      root?.render(filtered(5));
    });
    seen.push(lastProps().onClearFilters);
    await act(async () => {
      root?.render(filtered(4));
    });
    seen.push(lastProps().onClearFilters);
    expect(seen[0]).toBeTypeOf("function");
    expect(seen[1]).toBe(seen[0]);
  });

  it("draws one row when one item changed, and shows the change", async () => {
    await mount(world());
    const changed = world();
    changed.items[3]!.name = "Item 3 renamed";
    changed.items[3]!.state_id = DONE;
    await refresh(changed);
    expect(rowRenders()).toBe(1);
    expect(counts.byName.get("Item 3 renamed")).toBe(1);
    const rows = [...(container?.querySelectorAll("tr.tessera-table-row") ?? [])];
    expect(rows[3]!.textContent).toContain("Item 3 renamed");
    expect(rows[3]!.textContent).toContain("Done");
    expect(rows[4]!.textContent).toContain("Todo");
  });

  it("draws one row for an inline edit and keeps the others", async () => {
    await mount(world());
    await act(async () => {
      lastProps().onUpdate("item-5", { priority: "urgent" });
    });
    expect(update.release).not.toBeNull();
    expect([...counts.byName.keys()]).toEqual(["Item 5"]);
    await act(async () => {
      update.release?.();
    });
  });

  it("draws one row when a new item arrives at the end (an insert above moves every row's index, which Astryx compares)", async () => {
    await mount(world());
    const grown = world();
    grown.items.push({ ...makeItems()[0]!, id: "item-new", name: "Item new", key: "WEB-21", sort_order: "b" });
    await refresh(grown);
    expect(rowCount()).toBe(21);
    expect(counts.byName.get("Item new")).toBe(1);
    expect(rowRenders()).toBe(1);
  });

  it("draws each row at most once when the peek moves, and none when the peeked row does not change", async () => {
    await mount(world());
    nav.search = "peek=item-2";
    await refresh(world());
    expect(rowCount()).toBe(20);
    expect([...counts.byName.values()].every((n) => n <= 1)).toBe(true);
    expect(container?.querySelectorAll('tr[aria-current="true"]')).toHaveLength(1);
    await refresh(world());
    expect(rowRenders()).toBe(0);
  });

  it("still skips every grouped row on a write that moves only the counters", async () => {
    await mount(world("state"));
    expect(rowCount()).toBe(20);
    const written = world("state");
    written.bundle.cursor = 9;
    written.bundle.project.counts.total = 21;
    written.bundle.actors[0]!.last_seen_at = "2026-10-12T10:00:00.000Z";
    await refresh(written);
    expect(rowRenders()).toBe(0);
  });
});
