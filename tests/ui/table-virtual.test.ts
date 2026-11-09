// @vitest-environment jsdom
/**
 * The virtual work items table (decisions 135-137; src/components/work-items/table-virtual.ts, VirtualTable.tsx,
 * table-cells.tsx, TableLayout.tsx):
 * - the spacer rows, `data-index` and the windowed `data` (the rendered rows are the very objects of `allRows`, a
 *   grouped header Proxy included, with spacers for what the window leaves out);
 * - the Astryx plugin: a spacer is an empty `aria-hidden` presentation row, a data row gets `data-index`, its
 *   `aria-rowindex` in the loaded rows and the measuring ref composed with the ref earlier plugins set;
 * - TableLayout's `columns` and `plugins` keep their identity across a re-render with equal inputs, a refreshed
 *   bundle with equal content included (VirtualTable is replaced by a stub that records its props);
 * - the scroller store re-measures when the table body grows: the scroller's first child can be the loaded-rows
 *   note, which never resizes, so the store observes the anchor (the tbody) itself.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BodyCellRenderProps, BodyRowRenderProps, TableColumn, TablePlugin } from "@astryxdesign/core/Table";
import type { VirtualRow } from "@/components/virtual/use-virtual-rows";
import type { TableRow } from "@/components/work-items/table-cells";
import type { LayoutProps, ProjectBundle } from "@/components/work-items/types";
import type { WorkItem } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));
const recorded = vi.hoisted(() => ({ props: [] as { columns: unknown; plugins: unknown; allRows: unknown; idOf: unknown; isVirtual: boolean }[] }));
vi.mock("@/components/work-items/VirtualTable", () => ({
  VirtualTable: (props: { columns: unknown; plugins: unknown; allRows: unknown; idOf: unknown; isVirtual: boolean }) => {
    recorded.props.push(props);
    return null;
  },
}));

const { dataIndexAttr, spacerHeight, spacerRow, virtualTablePlugin, windowedRows } = await import("@/components/work-items/table-virtual");
const { TableLayout } = await import("@/components/work-items/TableLayout");
const { createScrollerStore } = await import("@/components/virtual/VirtualScrollerProvider");
const { ProjectScope } = await import("@/components/work-items/project-provider");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const ROW = 37;
const PROJECT = "11111111-1111-7111-8111-111111111111";

function item(index: number): WorkItem {
  return { id: `item-${index}`, project_id: PROJECT, key: `WEB-${index + 1}`, name: `Item ${index}` } as unknown as WorkItem;
}
function dataRow(index: number, groupKey = ""): TableRow {
  const it = item(index);
  return { id: groupKey ? `${groupKey}:${it.id}` : it.id, item: it, groupKey };
}
/**
 * A stand-in for Astryx's grouped header row: a Proxy that, like the real one (`useTableGroupedRows.js:34-42`), reads
 * "" for any field it does not have.
 */
function header(groupKey: string): TableRow {
  return new Proxy({ groupKey } as unknown as TableRow, { get: (target, prop) => (prop in target ? target[prop as keyof TableRow] : "") });
}
const headerKeys = new WeakMap<object, string>();
function groupedRows(): TableRow[] {
  const rows: TableRow[] = [];
  for (const group of ["a", "b"]) {
    const head = header(group);
    headerKeys.set(head, `group:${group}`);
    rows.push(head);
    for (let i = 0; i < 49; i += 1) rows.push(dataRow(rows.length, group));
  }
  return rows;
}
/** The grouped key function: a header by its group, any other row (data or spacer) by its id. */
const groupedIdOf = (row: TableRow) => headerKeys.get(row) ?? row.id;
const flatIdOf = (row: TableRow) => row.id;

const rendered = (indexes: number[], kept: number[] = []): VirtualRow[] =>
  [...indexes, ...kept].sort((a, b) => a - b).map((index) => (kept.includes(index) ? { index, key: `k${index}`, start: index * ROW, size: ROW, keptTop: index * ROW } : { index, key: `k${index}`, start: index * ROW, size: ROW }));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The data as a readable outline: a row as its index in `allRows`, a spacer as `spacer:<height>`. */
function outline(allRows: readonly TableRow[], data: readonly TableRow[]): (number | string)[] {
  return data.map((row) => {
    const height = spacerHeight(row);
    return height === null ? allRows.indexOf(row) : `spacer:${height}`;
  });
}

describe("spacer rows and data-index", () => {
  it("makes a spacer row with its id and height, and reads the height back", () => {
    const spacer = spacerRow<TableRow>("virtual:top", 370);
    expect(spacer.id).toBe("virtual:top");
    expect(spacerHeight(spacer)).toBe(370);
  });

  it("reads no height from a data row, a header Proxy or a row with a plain height field", () => {
    expect(spacerHeight(dataRow(0))).toBeNull();
    expect(spacerHeight(header("a"))).toBeNull();
    expect(spacerHeight({ id: "x", height: 12 })).toBeNull();
  });

  it("carries its height in an enumerable field, so Astryx's shallow row memo sees a height change", () => {
    // BaseTable's areRowPropsEqual compares a new row object by Object.keys: same id and position, new height.
    const before = spacerRow<TableRow>("virtual:top", 6771);
    const after = spacerRow<TableRow>("virtual:top", 14171);
    const differs = Object.keys(after).some((key) => (before as Record<string, unknown>)[key] !== (after as Record<string, unknown>)[key]);
    expect(differs).toBe(true);
  });

  it("has no item, so the data-row check and the cells never see it", () => {
    expect((spacerRow<TableRow>("virtual:top", 1) as { item?: unknown }).item).toBeUndefined();
  });

  it("writes data-index as a string attribute", () => {
    expect(dataIndexAttr(7)).toEqual({ "data-index": "7" });
  });
});

describe("windowedRows (the windowed table data)", () => {
  const flat = Array.from({ length: 100 }, (_, i) => dataRow(i));

  it("at the top: the window, then one spacer for the rest", () => {
    const data = windowedRows(flat, rendered(range(0, 9)), 100 * ROW, 0);
    expect(outline(flat, data)).toEqual([...range(0, 9), `spacer:${90 * ROW}`]);
  });

  it("in the middle: a spacer on each side", () => {
    const data = windowedRows(flat, rendered(range(40, 49)), 100 * ROW, 0);
    expect(outline(flat, data)).toEqual([`spacer:${40 * ROW}`, ...range(40, 49), `spacer:${50 * ROW}`]);
  });

  it("at the end: a spacer before, none after", () => {
    const data = windowedRows(flat, rendered(range(90, 99)), 100 * ROW, 0);
    expect(outline(flat, data)).toEqual([`spacer:${90 * ROW}`, ...range(90, 99)]);
  });

  it("keeps a kept row before the window in flow, between split spacers", () => {
    const data = windowedRows(flat, rendered(range(40, 49), [5]), 100 * ROW, 0);
    expect(outline(flat, data)).toEqual([`spacer:${5 * ROW}`, 5, `spacer:${34 * ROW}`, ...range(40, 49), `spacer:${50 * ROW}`]);
  });

  it("keeps a kept row after the window in flow, between split spacers", () => {
    const data = windowedRows(flat, rendered(range(0, 9), [80]), 100 * ROW, 0);
    expect(outline(flat, data)).toEqual([...range(0, 9), `spacer:${70 * ROW}`, 80, `spacer:${19 * ROW}`]);
  });

  it("gives the same spacers whatever the scroll margin (the head above the anchor)", () => {
    const data = windowedRows(flat, rendered(range(40, 49)), 100 * ROW, 30);
    expect(outline(flat, data)).toEqual([`spacer:${40 * ROW}`, ...range(40, 49), `spacer:${50 * ROW}`]);
  });

  it("uses the very row objects of allRows, never copies", () => {
    const data = windowedRows(flat, rendered(range(40, 49), [5]), 100 * ROW, 0);
    expect(data[1]).toBe(flat[5]);
    expect(data[3]).toBe(flat[40]);
    expect(data[12]).toBe(flat[49]);
  });

  it("grouped: a header row in the window is the same Proxy object", () => {
    const rows = groupedRows();
    const data = windowedRows(rows, rendered(range(45, 55)), rows.length * ROW, 0);
    const headerAt = data.findIndex((row) => headerKeys.has(row));
    expect(headerAt).toBeGreaterThan(0);
    expect(data[headerAt]).toBe(rows[50]);
    expect(outline(rows, data)).toEqual([`spacer:${45 * ROW}`, ...range(45, 55), `spacer:${44 * ROW}`]);
  });

  it("grouped: a kept header row before the window stays the same object", () => {
    const rows = groupedRows();
    const data = windowedRows(rows, rendered(range(60, 70), [0]), rows.length * ROW, 0);
    expect(data[0]).toBe(rows[0]);
    expect(outline(rows, data)).toEqual([0, `spacer:${59 * ROW}`, ...range(60, 70), `spacer:${29 * ROW}`]);
  });

  it("keys come from idOf: unique, the header by its group, a row by its id, a spacer by its own id", () => {
    const rows = groupedRows();
    const data = windowedRows(rows, rendered(range(45, 55), [0]), rows.length * ROW, 0);
    const keys = data.map(groupedIdOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("group:a");
    expect(keys).toContain("group:b");
    expect(keys).toContain("virtual:gap-1");
    expect(keys).toContain("virtual:bottom");
    expect(keys).toContain(rows[45].id);
    expect(data.filter((row) => spacerHeight(row) === null).map(groupedIdOf)).toEqual([0, ...range(45, 55)].map((i) => groupedIdOf(rows[i])));
    const flatData = windowedRows(flat, rendered(range(0, 9)), 100 * ROW, 0);
    expect(flatData.map(flatIdOf)).toEqual([...range(0, 9).map((i) => `item-${i}`), "virtual:bottom"]);
  });
});

describe("virtualTablePlugin", () => {
  const rows = [dataRow(0), dataRow(1), dataRow(2)];
  const indexOf = (row: TableRow) => rows.indexOf(row);
  /** The plugin's transforms with the arguments it reads (Astryx also passes the row and column indexes). */
  type Transforms = {
    transformBodyRow: (props: BodyRowRenderProps, row: TableRow) => BodyRowRenderProps;
    transformBodyCell: (props: BodyCellRenderProps, column: TableColumn<TableRow>, row: TableRow) => BodyCellRenderProps;
  };
  const transforms = (plugin: TablePlugin<TableRow>): Transforms => plugin as unknown as Transforms;
  const make = (measureRef?: (el: Element | null) => void) => transforms(virtualTablePlugin<TableRow>({ indexOf, measureRef, onFocusCapture: vi.fn(), onKeyDownCapture: vi.fn() }));
  const rowProps = (extra: Partial<BodyRowRenderProps> = {}) => ({ htmlProps: { className: "tessera-table-row", title: "kept" }, ...extra }) as BodyRowRenderProps;

  it("turns a spacer into an empty aria-hidden presentation row of its height", () => {
    const out = make().transformBodyRow(rowProps(), spacerRow<TableRow>("virtual:top", 74));
    expect(out.htmlProps).toMatchObject({ className: "tessera-table-spacer", "aria-hidden": true, role: "presentation" });
    expect((out.htmlProps as { style: Record<string, string> }).style["--tessera-virtual-spacer" as never]).toBe("74px");
    // The row's own classes and handlers are dropped: no hover, no click, no selection highlight.
    expect((out.htmlProps as { title?: string }).title).toBeUndefined();
  });

  it("suppresses the content of a spacer's cells and leaves data cells alone", () => {
    const plugin = make();
    const cell = { htmlProps: {} } as BodyCellRenderProps;
    const column = { key: "name" } as TableColumn<TableRow>;
    expect(plugin.transformBodyCell(cell, column, spacerRow<TableRow>("virtual:top", 1))).toMatchObject({ isContentSuppressed: true });
    expect(plugin.transformBodyCell(cell, column, rows[1])).toBe(cell);
  });

  it("gives a data row data-index and aria-rowindex from allRows, keeping its other props", () => {
    const out = make().transformBodyRow(rowProps(), rows[2]);
    expect(out.htmlProps).toMatchObject({ className: "tessera-table-row", title: "kept", "data-index": "2", "aria-rowindex": 3 });
  });

  it("leaves a row it does not know alone", () => {
    const props = rowProps();
    expect(make().transformBodyRow(props, dataRow(9))).toBe(props);
  });

  it("passes the measuring ref when no earlier plugin set a ref, and none before measuring", () => {
    const measure = vi.fn();
    expect(make(measure).transformBodyRow(rowProps(), rows[0]).ref).toBe(measure);
    expect(make(undefined).transformBodyRow(rowProps(), rows[0]).ref).toBeUndefined();
  });

  it("composes the measuring ref with an earlier callback ref, one stable function per earlier ref", () => {
    const measure = vi.fn();
    const earlier = vi.fn();
    const plugin = make(measure);
    const first = plugin.transformBodyRow(rowProps({ ref: earlier }), rows[0]).ref as (el: Element | null) => void;
    const again = plugin.transformBodyRow(rowProps({ ref: earlier }), rows[0]).ref;
    expect(again).toBe(first);
    const el = document.createElement("tr");
    first(el);
    expect(earlier).toHaveBeenCalledWith(el);
    expect(measure).toHaveBeenCalledWith(el);
  });

  it("composes with an earlier object ref", () => {
    const measure = vi.fn();
    const earlier = { current: null as HTMLTableRowElement | null };
    const ref = make(measure).transformBodyRow(rowProps({ ref: earlier }), rows[0]).ref as (el: HTMLTableRowElement | null) => void;
    const el = document.createElement("tr");
    ref(el);
    expect(earlier.current).toBe(el);
    expect(measure).toHaveBeenCalledWith(el);
  });

  it("keeps an earlier ref unchanged before measuring", () => {
    const earlier = vi.fn();
    expect(make(undefined).transformBodyRow(rowProps({ ref: earlier }), rows[0]).ref).toBe(earlier);
  });

  it("adds the focus and key handlers to the scroll wrapper, keeping its props", () => {
    const onFocusCapture = vi.fn();
    const onKeyDownCapture = vi.fn();
    const plugin = virtualTablePlugin<TableRow>({ indexOf, measureRef: undefined, onFocusCapture, onKeyDownCapture });
    const out = plugin.transformScrollWrapper?.({ htmlProps: { className: "wrap" } } as never) as unknown as { htmlProps: Record<string, unknown> };
    expect(out.htmlProps).toMatchObject({ className: "wrap", onFocusCapture, onKeyDownCapture });
  });
});

describe("TableLayout identity (decision 136)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (typeof window.matchMedia !== "function") {
      window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    }
  });
  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    recorded.props.length = 0;
  });

  const makeBundle = () =>
    ({
      project: { id: PROJECT, name: "Website", identifier: "WEB", estimates_enabled: false },
      states: [],
      labels: [],
      cycles: [],
      modules: [],
      actors: [],
      cursor: 1,
      today: "2026-10-17",
      estimate: null,
      intake_open: 0,
      projects: [{ id: PROJECT, name: "Website" }],
    }) as unknown as ProjectBundle;
  const items = Array.from({ length: 40 }, (_, i) => item(i));
  const handlers = { onMove: vi.fn(), onUpdate: vi.fn(), onOpen: vi.fn(), onOrderChange: vi.fn(), onLoadMore: vi.fn(), isLoadingMore: vi.fn(() => false) };
  // One display object, as the screen hands down (WorkItemsScreen shares its identity while its content is equal).
  const display = { ...DEFAULT_DISPLAY, layout: "table" as const };
  const result = { items, total: 200, cursor: 1 };
  const groups = [
    { field: "priority" as const, id: "high", name: "High", color: null, count: 20, item_ids: items.slice(0, 20).map((i) => i.id), has_more: false },
    { field: "priority" as const, id: "none", name: "None", color: null, count: 20, item_ids: items.slice(20).map((i) => i.id), has_more: false },
  ];
  const groupedResult = { items, total: 40, cursor: 1, groups };
  const groupedDisplay = { ...display, group_by: "priority" as const };

  function table(bundle: ProjectBundle, extra: Partial<LayoutProps> = {}): ReactNode {
    const props = { result, display, bundle, ...handlers, ...extra } as LayoutProps;
    return createElement(ProjectScope, { bundle } as ComponentProps<typeof ProjectScope>, createElement(TableLayout, props));
  }
  async function render(node: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(node));
  }
  async function rerender(node: ReactNode) {
    await act(async () => root?.render(node));
  }

  it("keeps columns and plugins across a re-render with the same inputs", async () => {
    const bundle = makeBundle();
    await render(table(bundle));
    await rerender(table(bundle));
    const [first, last] = [recorded.props[0], recorded.props.at(-1)];
    expect(recorded.props.length).toBeGreaterThanOrEqual(2);
    expect(last?.columns).toBe(first?.columns);
    expect(last?.plugins).toBe(first?.plugins);
    expect(last?.allRows).toBe(first?.allRows);
    expect(last?.idOf).toBe(first?.idOf);
    expect(first?.isVirtual).toBe(true);
  });

  it("keeps them across a refreshed bundle with equal content (the project column on)", async () => {
    await render(table(makeBundle(), { showProject: true }));
    const first = recorded.props.at(-1);
    await rerender(table(makeBundle(), { showProject: true }));
    const last = recorded.props.at(-1);
    expect(last).not.toBe(first);
    expect(last?.columns).toBe(first?.columns);
    expect(last?.plugins).toBe(first?.plugins);
  });

  it("grouped: keeps columns, plugins, rows and the key function across a re-render with the same inputs", async () => {
    const bundle = makeBundle();
    await render(table(bundle, { result: groupedResult, display: groupedDisplay }));
    const first = recorded.props.at(-1);
    await rerender(table(makeBundle(), { result: groupedResult, display: groupedDisplay }));
    const last = recorded.props.at(-1);
    expect(last).not.toBe(first);
    expect((first?.plugins as Record<string, unknown>).grouped).toBeDefined();
    expect(last?.columns).toBe(first?.columns);
    expect(last?.plugins).toBe(first?.plugins);
    expect(last?.allRows).toBe(first?.allRows);
    expect(last?.idOf).toBe(first?.idOf);
    // 40 rows and 2 group headers.
    expect((last?.allRows as unknown[]).length).toBe(42);
  });

  it("rebuilds the columns when the display properties change", async () => {
    const bundle = makeBundle();
    await render(table(bundle));
    const first = recorded.props.at(-1);
    await rerender(table(bundle, { display: { ...display, properties: { ...display.properties, priority: !display.properties.priority } } }));
    expect(recorded.props.at(-1)?.columns).not.toBe(first?.columns);
  });

  it("keeps the table unwindowed at the threshold (30 rows)", async () => {
    const bundle = makeBundle();
    await render(createElement(ProjectScope, { bundle } as ComponentProps<typeof ProjectScope>, createElement(TableLayout, { result: { items: items.slice(0, 30), total: 30, cursor: 1 }, display, bundle, ...handlers } as LayoutProps)));
    expect(recorded.props.at(-1)?.isVirtual).toBe(false);
  });
});

describe("the scroller store observes the table body", () => {
  class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    observed = new Set<Element>();
    constructor(public callback: () => void) {
      FakeResizeObserver.last = this;
    }
    observe(el: Element) {
      this.observed.add(el);
    }
    unobserve(el: Element) {
      this.observed.delete(el);
    }
    disconnect() {
      this.observed.clear();
    }
  }
  const frames = () => {
    const queue: FrameRequestCallback[] = [];
    return {
      requestAnimationFrame: (cb: FrameRequestCallback) => queue.push(cb),
      cancelAnimationFrame: () => {},
      run: () => queue.splice(0).forEach((cb) => cb(0)),
    };
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  /** The work items scroller with the table layout's children: the loaded-rows note first, then the table. */
  function tableScroller(bodyHeight: { value: number }) {
    const el = document.createElement("section");
    const note = document.createElement("p");
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    table.append(tbody);
    el.append(note, table);
    document.body.append(el);
    Object.defineProperty(el, "clientHeight", { get: () => 500 });
    Object.defineProperty(el, "clientTop", { get: () => 0 });
    Object.defineProperty(el, "offsetParent", { get: () => document.body });
    el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    tbody.getBoundingClientRect = () => ({ top: 66 - el.scrollTop, height: bodyHeight.value }) as DOMRect;
    return { el, note, tbody };
  }

  it("observes the registered tbody, so loading more rows updates its height and keeps it near the viewport", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const f = frames();
    const store = createScrollerStore(768, true, f);
    const height = { value: 200 * ROW };
    const { el, note, tbody } = tableScroller(height);
    store.attach(el);
    const unregister = store.register("table", tbody, 4 * ROW);
    f.run();
    const observer = FakeResizeObserver.last;
    expect(observer?.observed.has(note)).toBe(true);
    expect(observer?.observed.has(tbody)).toBe(true);
    // 1 800 rows loaded: the tbody grows, the note does not. Its resize schedules a measure.
    height.value = 1800 * ROW;
    observer?.callback();
    f.run();
    el.scrollTop = 1700 * ROW;
    store.scrollNow();
    expect(store.isNear("table")).toBe(true);
    unregister();
    expect(observer?.observed.has(tbody)).toBe(false);
  });

  it("observes an anchor registered before the scroller is attached", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const store = createScrollerStore(768, true, frames());
    const { el, tbody } = tableScroller({ value: ROW });
    store.register("table", tbody, 0);
    store.attach(el);
    expect(FakeResizeObserver.last?.observed.has(tbody)).toBe(true);
  });
});
