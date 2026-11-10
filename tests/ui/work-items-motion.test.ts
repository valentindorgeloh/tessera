// @vitest-environment jsdom
/**
 * Work items motion (docs/contracts/ui.md "Motion"), the parts jsdom can show:
 *
 * - the list hands every group's Collapsible the scroller's `useAnimatedLayout` handle, with one identity across
 *   refreshes (decision 141: no row sees a new prop);
 * - the layout, period and zoom fade runs on a change of the view key, never on a filter, a sort or a refresh;
 * - the quick-add placeholder row and card and the bulk bar use Astryx's `useEntryAnimation` through `xstyle`: no
 *   entry style on the server render, the style on an element that mounts after the first paint, and never on a
 *   real row or card.
 *
 * Layout, spring and drop motion run in a real browser: tests/e2e/motion-work-items.spec.ts.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LayoutProps, ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Display, Project, State, WorkItem } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: vi.fn(async () => ok),
  moveWorkItemAction: vi.fn(async () => ok),
  listWorkItemsAction: vi.fn(async () => ({ ok: false as const, message: "unused" })),
  updateWorkItemAction: vi.fn(async () => ok),
  bulkArchiveWorkItemsAction: vi.fn(async () => ok),
  bulkDeleteWorkItemsAction: vi.fn(async () => ok),
  bulkUnarchiveWorkItemsAction: vi.fn(async () => ok),
  bulkUpdateWorkItemsAction: vi.fn(async () => ok),
}));
vi.mock("@/app/actions/views", () => ({
  saveViewSettingsAction: vi.fn(async () => ok),
  resetViewSettingsAction: vi.fn(async () => ok),
  createViewAction: vi.fn(async () => ok),
  updateViewAction: vi.fn(async () => ok),
}));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// The real hooks, except the animator: a spy handle, so the dip is observable without Web Animations.
const animator = vi.hoisted(() => ({ set: vi.fn(), animate: vi.fn(() => Promise.resolve()), stop: vi.fn() }));
vi.mock("@astryxdesign/core/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/hooks")>();
  return { ...actual, useAnimator: () => animator };
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
const { PendingRow } = await import("@/components/work-items/ListLayout");
const { PendingCard } = await import("@/components/work-items/BoardVirtualCards");
const { BulkBar } = await import("@/components/work-items/BulkBar");
const { optimisticId } = await import("@/components/work-items/optimistic");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const TODO = "66666666-6666-7666-8666-666666666666";
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
    counts: { total: 3, by_state_group: { backlog: 0, unstarted: 3, started: 0, completed: 0, cancelled: 0, triage: 0 } },
    ...audit,
  } as unknown as Project;
  const states = [{ id: TODO, project_id: PROJECT, name: "Todo", name_key: "todo", description: "", color: "gray", state_group: "unstarted", is_default: true, sort_order: "a0", ...audit }] as State[];
  const actors = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }] as ActorRow[];
  return { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] };
}

function makeItem(id: string, index: number): WorkItem {
  return {
    id,
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

const items = [0, 1, 2].map((index) => makeItem(`item-${index}`, index));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type ScreenProps = ComponentProps<typeof WorkItemsScreen>;
function screen(display: Partial<Display>, filters: ScreenProps["filters"] = {}) {
  const shown: Display = { ...DEFAULT_DISPLAY, layout: "list", group_by: "state", ...display };
  const groups = shown.group_by ? [{ field: shown.group_by, id: TODO, name: "Todo", color: null, count: items.length, item_ids: items.map((item) => item.id), has_more: false }] : undefined;
  const result = { items: clone(items), total: items.length, cursor: 1, groups };
  const props: ScreenProps = { projectId: PROJECT, result, display: clone(shown), filters, settingsDisplay: clone(shown), createOnOpen: false };
  return createElement(ProjectProvider, { bundle: makeBundle() } as ComponentProps<typeof ProjectProvider>, createElement(WorkItemsScreen, props));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const hosts: HTMLElement[] = [];

function render(node: ReturnType<typeof createElement>) {
  return act(async () => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    root.render(node);
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
  for (const host of hosts.splice(0)) host.remove();
  container?.remove();
  root = null;
  container = null;
  nav.search = "";
  layout.props = [];
  animator.set.mockClear();
  animator.animate.mockClear();
});

describe("list groups glide", () => {
  it("hands the list one animatedLayout handle that keeps its identity across refreshes", async () => {
    await render(screen({}));
    await render(screen({}));
    await render(screen({}, { priority: ["high"] }));
    const handles = (layout.props as Array<LayoutProps & { animatedLayout?: unknown }>).map((props) => props.animatedLayout);
    expect(handles.length).toBeGreaterThan(1);
    expect(handles[0]).toBeTruthy();
    for (const handle of handles) expect(handle).toBe(handles[0]);
  });
});

describe("the layout, period and zoom fade", () => {
  it("does nothing on the first render and on a refresh with the same view", async () => {
    await render(screen({}));
    await render(screen({}));
    expect(animator.set).not.toHaveBeenCalled();
    expect(animator.animate).not.toHaveBeenCalled();
  });

  it("does nothing when only a filter or the grouping changes", async () => {
    await render(screen({}));
    await render(screen({}, { priority: ["high"] }));
    await render(screen({ group_by: null }, { priority: ["high"] }));
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("dips and fades back when the layout changes", async () => {
    await render(screen({}));
    await render(screen({ layout: "board" }));
    expect(animator.set).toHaveBeenCalledWith({ opacity: 0.4 });
    expect(animator.animate).toHaveBeenCalledWith({ opacity: 1 });
  });

  it("fades when the calendar's period or view changes, but not for another layout's ?cal", async () => {
    await render(screen({ layout: "calendar" }));
    nav.search = "cal=2026-11-02";
    await render(screen({ layout: "calendar" }));
    expect(animator.animate).toHaveBeenCalledTimes(1);
    animator.animate.mockClear();
    await render(screen({ layout: "calendar", calendar: { ...DEFAULT_DISPLAY.calendar, layout: "week" } }));
    expect(animator.animate).toHaveBeenCalledTimes(1);
  });

  it("ignores ?cal outside the calendar", async () => {
    await render(screen({ layout: "board" }));
    nav.search = "cal=2026-11-02";
    await render(screen({ layout: "board" }));
    expect(animator.set).not.toHaveBeenCalled();
  });

  it("fades when the Gantt's zoom changes", async () => {
    await render(screen({ layout: "gantt" }));
    await render(screen({ layout: "gantt", gantt: { ...DEFAULT_DISPLAY.gantt, zoom: "week" } }));
    expect(animator.animate).toHaveBeenCalledTimes(1);
  });
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const classesOf = (element: Element | null | undefined) => (element?.className ?? "").toString().split(/\s+/).filter(Boolean);
function newHost(html = ""): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  return host;
}

/** The element on the server, and the same element mounted after the first paint: the second carries the entry style on top. */
async function entryClasses(make: () => ReturnType<typeof createElement>, find: (host: HTMLElement) => Element | null) {
  const server = newHost(renderToString(make()));
  const onServer = classesOf(find(server));
  await nextFrame(); // past the first paint, so only the server render and hydration keep the hook null
  const host = newHost();
  const hostRoot = createRoot(host);
  await act(async () => hostRoot.render(make()));
  const mounted = classesOf(find(host));
  await act(async () => hostRoot.unmount());
  return { onServer, mounted };
}

function expectEntryStyle({ onServer, mounted }: { onServer: string[]; mounted: string[] }) {
  expect(onServer.length).toBeGreaterThan(0);
  expect(mounted.length).toBeGreaterThan(onServer.length);
  for (const name of onServer) expect(mounted).toContain(name);
}

describe("appearances use Astryx's useEntryAnimation through xstyle", () => {
  const bundle = makeBundle();
  const inProject = (child: ReturnType<typeof createElement>) => createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, child);
  const placeholder = { ...makeItem(optimisticId(), 0), sequence_id: 0 };
  const display = { ...DEFAULT_DISPLAY, layout: "list" as const };

  it("the quick-add placeholder row: no entry style on the server render, fadeIn after the first paint", async () => {
    const make = () => inProject(createElement(PendingRow, { item: placeholder, display, onUpdate: () => {} }));
    expectEntryStyle(await entryClasses(make, (host) => host.querySelector(".tessera-wi-row-pending")));
  });

  it("the quick-add placeholder card: no entry style on the server render, fadeIn after the first paint", async () => {
    const make = () => inProject(createElement(PendingCard, { item: placeholder, properties: display.properties }));
    expectEntryStyle(await entryClasses(make, (host) => host.querySelector(".tessera-board-card-pending")));
  });

  it("the bulk bar: no entry style on the server render, slideUp after the first paint", async () => {
    const make = () => inProject(createElement(BulkBar, { items, selected: new Set([items[0]!.id]), onClear: () => {} }));
    expectEntryStyle(await entryClasses(make, (host) => host.querySelector(".tessera-bulk-bar")));
  });

  it("the preset of each is its own", async () => {
    const row = await entryClasses(() => inProject(createElement(PendingRow, { item: placeholder, display, onUpdate: () => {} })), (host) => host.querySelector(".tessera-wi-row-pending"));
    const bar = await entryClasses(() => inProject(createElement(BulkBar, { items, selected: new Set([items[0]!.id]), onClear: () => {} })), (host) => host.querySelector(".tessera-bulk-bar"));
    const extra = (entry: { onServer: string[]; mounted: string[] }) => entry.mounted.filter((name) => !entry.onServer.includes(name)).join(" ");
    expect(extra(row)).not.toBe(extra(bar));
  });

  /**
   * The classes of what `selector` matches in the server render of `make()` (where the hook is null, so there is no entry
   * style), and in the same tree rendered on the client after the first paint, the way rows mount on scroll, on "Show
   * more" and on the agent refresh. A row or card that called `useEntryAnimation` would carry the style in the second
   * and not in the first. (Rendering twice on the client cannot show it: both renders would carry it.)
   */
  async function plainClasses(make: () => ReturnType<typeof createElement>, selector: string) {
    const onServer = [...newHost(renderToString(make())).querySelectorAll(selector)].map(classesOf);
    await nextFrame(); // past the first paint, so only the server render and hydration keep the hook null
    await render(make());
    const mounted = [...container!.querySelectorAll(selector)].map(classesOf);
    return { onServer, mounted };
  }

  it("a real list row never takes an entry style: its classes match the server render's", async () => {
    const { onServer, mounted } = await plainClasses(() => screen({}), ".tessera-wi-row");
    expect(onServer).toHaveLength(items.length);
    expect(mounted).toEqual(onServer);
  });

  it("a real board card never takes an entry style: its classes match the server render's", async () => {
    const { onServer, mounted } = await plainClasses(() => screen({ layout: "board" }), ".tessera-board-card");
    expect(onServer).toHaveLength(items.length);
    expect(mounted).toEqual(onServer);
  });
});
