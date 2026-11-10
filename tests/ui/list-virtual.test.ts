// @vitest-environment jsdom
/**
 * The windowed list (src/components/work-items/ListGroupRows.tsx and src/components/virtual/use-virtual-rows.ts,
 * decisions 135-137) under jsdom: the server window and its hydration, aria-setsize and the open end, the
 * unchanged markup below the threshold and without a provider, collapsed groups, print, measuring, and the kept
 * row's arrow keys. jsdom has no layout, so the measured phase runs with a scroller whose size is set by hand and a
 * mocked TanStack instance (the real one runs everywhere else).
 */
import { act, createElement, useReducer, useState, type ComponentProps, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Range } from "@tanstack/react-virtual";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Group, Project, State, WorkItem } from "@/lib/tessera/types";

vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: vi.fn(), updateWorkItemAction: vi.fn(), moveWorkItemAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

type FakeOptions = {
  count: number;
  enabled: boolean;
  overscan: number;
  scrollMargin: number;
  getItemKey: (i: number) => string;
  rangeExtractor: (r: Range) => number[];
};
type FakeInstance = {
  range: { startIndex: number; endIndex: number } | null;
  getVirtualItems: () => { index: number; key: string; start: number; end: number; size: number; lane: number }[];
  getTotalSize: () => number;
  scrollToIndex: ReturnType<typeof vi.fn>;
  measureElement: ReturnType<typeof vi.fn>;
  measurementsCache: unknown[];
  indexFromElement: (el: Element) => number;
};
const fake = vi.hoisted(() => ({
  on: false,
  range: { startIndex: 0, endIndex: 13 },
  instances: [] as unknown[],
  rerender: [] as (() => void)[],
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  function useFakeVirtualizer(options: FakeOptions): FakeInstance {
    const [, force] = useReducer((n: number) => n + 1, 0);
    const [instance] = useState<FakeInstance>(() => {
      const created: FakeInstance = {
        range: null,
        getVirtualItems: () => [],
        getTotalSize: () => 0,
        scrollToIndex: vi.fn(),
        measureElement: vi.fn(),
        measurementsCache: [],
        indexFromElement: (el) => Number(el.getAttribute("data-index")),
      };
      fake.instances.push(created);
      fake.rerender.push(force);
      return created;
    });
    const { startIndex, endIndex } = fake.range;
    const indexes = options.enabled && options.count > 0 ? options.rangeExtractor({ startIndex, endIndex, overscan: options.overscan, count: options.count }) : [];
    instance.range = options.enabled ? { startIndex, endIndex } : null;
    instance.getVirtualItems = () => indexes.map((index) => ({ index, key: options.getItemKey(index), start: options.scrollMargin + index * 44, end: options.scrollMargin + (index + 1) * 44, size: 44, lane: 0 }));
    instance.getTotalSize = () => options.count * 44;
    return instance;
  }
  const pick = (): ((o: FakeOptions) => FakeInstance) => (fake.on ? useFakeVirtualizer : (actual.useVirtualizer as unknown as (o: FakeOptions) => FakeInstance));
  return {
    ...actual,
    // Picked per call, never switched while a list is mounted (each test mounts its own).
    useVirtualizer: (options: FakeOptions) => pick()(options),
  };
});

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { ListLayout } = await import("@/components/work-items/ListLayout");
const { VirtualScrollerProvider } = await import("@/components/virtual/VirtualScrollerProvider");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };
const project = { id: PROJECT, name: "Website", identifier: "WEB", cycles_enabled: false, modules_enabled: false, estimates_enabled: false, archived_at: null, ...audit } as unknown as Project;
const stateIds = [0, 1, 2, 3, 4].map((i) => `state-${i}`);
const states: State[] = stateIds.map((id, i) => ({ id, project_id: PROJECT, name: `State ${i}`, name_key: `state ${i}`, description: "", color: "gray", state_group: "unstarted", is_default: i === 0, sort_order: `a${i}`, ...audit }));
const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }];
const bundle = { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] } as unknown as ProjectBundle;

function item(id: string, stateId = stateIds[0]): WorkItem {
  return {
    id,
    project_id: PROJECT,
    sequence_id: 1,
    key: `WEB-${id}`,
    name: `Item ${id}`,
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
    sort_order: "a0",
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

const flatItems = (n: number) => Array.from({ length: n }, (_, i) => item(`r${i}`));

/** `groupCount` state groups of `perGroup` rows each; row ids are "g<group>-<row>". */
function grouped(groupCount: number, perGroup: number) {
  const items: WorkItem[] = [];
  const groups: Group[] = [];
  for (let g = 0; g < groupCount; g += 1) {
    const ids = Array.from({ length: perGroup }, (_, i) => `g${g}-${i}`);
    items.push(...ids.map((id) => item(id, stateIds[g])));
    groups.push({ field: "state", id: stateIds[g], name: `State ${g}`, color: null, count: perGroup, item_ids: ids, has_more: false });
  }
  return { result: { items, total: items.length, cursor: 1, groups }, display: { ...DEFAULT_DISPLAY, group_by: "state" as const } };
}

const layoutProps = (extra: Partial<ComponentProps<typeof ListLayout>> = {}): ComponentProps<typeof ListLayout> => ({
  result: { items: [], total: 0, cursor: 1 },
  display: DEFAULT_DISPLAY,
  bundle,
  onMove: () => {},
  onUpdate: () => {},
  onOpen: () => {},
  ...extra,
});

/** The list inside the project provider, and inside a scroller provider unless `scroller` is "none". */
function tree(props: ComponentProps<typeof ListLayout>, scroller: HTMLElement | null | "none" = null): ReactElement {
  const list = createElement(ListLayout, props);
  const inner = scroller === "none" ? list : createElement(VirtualScrollerProvider, { scroller } as ComponentProps<typeof VirtualScrollerProvider>, list);
  return createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, inner);
}

const rows = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>(".tessera-wi-row")];

/** Manual animation frames. */
const frameQueue = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
function runFrames() {
  const callbacks = [...frameQueue.values()];
  frameQueue.clear();
  for (const cb of callbacks) cb(0);
}

type MediaListener = (event: { matches: boolean }) => void;
let printListeners: MediaListener[] = [];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

/** A scroll element with a layout: 600 px tall, at the top of the page. */
function layoutScroller(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  Object.defineProperty(el, "clientHeight", { get: () => 600 });
  Object.defineProperty(el, "offsetParent", { get: () => document.body });
  el.scrollTo = () => {};
  return el;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  printListeners = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: MediaListener) => {
      if (query === "print") printListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      printListeners = printListeners.filter((l) => l !== listener);
    },
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameQueue.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frameQueue.delete(id));
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
  frameQueue.clear();
  fake.on = false;
  fake.range = { startIndex: 0, endIndex: 13 };
  fake.instances = [];
  fake.rerender = [];
  vi.unstubAllGlobals();
});

describe("the server window", () => {
  it("draws the first group's first rows and hydrates without a mismatch", async () => {
    const { result, display } = grouped(5, 50);
    const node = tree(layoutProps({ result, display }));
    const html = renderToString(node);
    container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const drawn = rows(container);
    expect(drawn).toHaveLength(19);
    expect(drawn.every((row) => row.textContent?.includes("Item g0-"))).toBe(true);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, node);
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect(rows(container)).toHaveLength(19);
  });
});

describe("a windowed flat list", () => {
  it("renders the window with the full set size and an open end", async () => {
    const el = await render(tree(layoutProps({ result: { items: flatItems(300), total: 1500, cursor: 1 } })));
    const anchor = el.querySelector(".tessera-virtual");
    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute("data-virtual-open-end")).toBe(true);
    const drawn = rows(el);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(20);
    expect(drawn.every((row) => row.getAttribute("aria-setsize") === "1500")).toBe(true);
    expect(drawn[0].getAttribute("aria-posinset")).toBe("1");
    expect(drawn[0].getAttribute("data-index")).toBe("0");
  });
});

describe("below the threshold and without a provider", () => {
  it("renders all 30 rows with the markup of before", () => {
    const props = layoutProps({ result: { items: flatItems(30), total: 30, cursor: 1 } });
    const windowed = renderToString(tree(props));
    const plain = renderToString(tree(props, "none"));
    expect(windowed).toBe(plain);
    expect(windowed).not.toContain("tessera-virtual");
    const host = document.createElement("div");
    host.innerHTML = windowed;
    expect(rows(host)).toHaveLength(30);
  });

  it("renders all 40 rows without a provider", async () => {
    const el = await render(tree(layoutProps({ result: { items: flatItems(40), total: 40, cursor: 1 } }), "none"));
    expect(rows(el)).toHaveLength(40);
    expect(el.querySelector(".tessera-virtual")).toBeNull();
    expect(el.querySelector("[data-index]")).toBeNull();
  });
});

describe("collapsed groups", () => {
  const collapseFirst = async (el: HTMLElement) => {
    const trigger = el.querySelector<HTMLElement>('[aria-expanded="true"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
  };

  it("mount no rows below the threshold", async () => {
    const { result, display } = grouped(2, 3);
    const el = await render(tree(layoutProps({ result, display })));
    expect(rows(el)).toHaveLength(6);
    await collapseFirst(el);
    const drawn = rows(el);
    expect(drawn).toHaveLength(3);
    expect(drawn.some((row) => row.textContent?.includes("Item g0-"))).toBe(false);
  });

  it("keep their rows while a gliding group closes, then unmount them (docs/contracts/ui.md \"Motion\")", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { result, display } = grouped(2, 3);
      const { useAnimatedLayout } = await import("@astryxdesign/core/hooks");
      const { useRef } = await import("react");
      // The scroller's handle, as WorkItemsScreen makes it (jsdom has no layout, so nothing glides).
      function Gliding() {
        const containerRef = useRef<HTMLElement | null>(null);
        const animatedLayout = useAnimatedLayout({ containerRef });
        return createElement(ListLayout, layoutProps({ result, display, animatedLayout }));
      }
      const el = await render(createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, createElement(Gliding)));
      await collapseFirst(el);
      expect(rows(el).some((row) => row.textContent?.includes("Item g0-")), "held while the conceal runs").toBe(true);
      await act(async () => {
        // The hold is the motion token and half again: jsdom has no theme, so 300 ms fallback, 450 ms.
        vi.advanceTimersByTime(449);
      });
      expect(rows(el).some((row) => row.textContent?.includes("Item g0-")), "still held just before the end").toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(rows(el).some((row) => row.textContent?.includes("Item g0-")), "gone once the hold ends").toBe(false);
      expect(rows(el)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("mount no rows above the threshold", async () => {
    const { result, display } = grouped(2, 50);
    const el = await render(tree(layoutProps({ result, display })));
    await collapseFirst(el);
    const drawn = rows(el);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.some((row) => row.textContent?.includes("Item g0-"))).toBe(false);
  });
});

describe("printing", () => {
  it("renders every loaded row while print matches", async () => {
    const el = await render(tree(layoutProps({ result: { items: flatItems(45), total: 45, cursor: 1 } })));
    expect(rows(el).length).toBeLessThanOrEqual(20);
    expect(printListeners.length).toBeGreaterThan(0);
    await act(async () => printListeners.forEach((l) => l({ matches: true })));
    expect(rows(el)).toHaveLength(45);
    expect(el.querySelector(".tessera-virtual")).toBeNull();
    await act(async () => printListeners.forEach((l) => l({ matches: false })));
    expect(rows(el).length).toBeLessThanOrEqual(20);
  });
});

describe("the measured window (mocked instance)", () => {
  async function measured(count: number) {
    fake.on = true;
    const scroller = layoutScroller();
    const el = await render(tree(layoutProps({ result: { items: flatItems(count), total: count, cursor: 1 } }), scroller));
    const instance = fake.instances[0] as FakeInstance;
    return { el, instance };
  }

  it("measures no row of the initial window, then every rendered row once", async () => {
    const { el, instance } = await measured(100);
    expect(rows(el).length).toBe(20);
    expect(instance.measureElement).not.toHaveBeenCalled();
    await act(async () => runFrames());
    const drawn = rows(el);
    expect(drawn).toHaveLength(18);
    const measuredEls = instance.measureElement.mock.calls.map((call) => call[0]).filter(Boolean);
    expect(measuredEls).toHaveLength(drawn.length);
    expect(new Set(measuredEls)).toEqual(new Set(drawn));
  });

  it("keeps the focused row and turns its arrow keys into a scroll", async () => {
    const { el, instance } = await measured(100);
    await act(async () => runFrames());
    const row = el.querySelector<HTMLElement>('[data-index="2"]');
    const open = row?.querySelector<HTMLElement>(".tessera-wi-open");
    expect(open).toBeTruthy();
    await act(async () => open?.focus());
    fake.range = { startIndex: 40, endIndex: 53 };
    await act(async () => fake.rerender.forEach((force) => force()));
    const kept = el.querySelector<HTMLElement>('[data-index="2"]');
    expect(kept).toBe(row);
    expect(kept?.classList.contains("tessera-virtual-kept")).toBe(true);
    expect(kept?.style.getPropertyValue("--tessera-virtual-top")).toBe("88px");
    expect(document.activeElement).toBe(open);

    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await act(async () => open?.dispatchEvent(down));
    expect(instance.scrollToIndex).toHaveBeenCalledWith(2, { align: "auto" });
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(open);

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => open?.dispatchEvent(enter));
    expect(instance.scrollToIndex).toHaveBeenCalledTimes(1);
  });
});
