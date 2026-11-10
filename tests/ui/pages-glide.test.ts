// @vitest-environment jsdom
/**
 * The page tree glides when a page opens or closes its sub-pages: PagesScreen
 * calls `useAnimatedLayout` on the element that scrolls (PanelPage's
 * `contentRef`) and hands the handle to the TreeList (docs/contracts/ui.md
 * "Motion"). What is pinned, under jsdom (no layout, so no glide runs):
 * - PanelPage's `contentRef` is the scrolling content element, with the page's children inside it;
 * - the tree sits inside that element, and the TreeList gets the hook's handle only while the person toggles a page
 *   (a chevron click or an arrow key), never at rest;
 * - only that toggle makes the tree measure its rows: a search (entering and clearing it), a refresh that gives a page
 *   its first sub-page or takes its last, and a drag-reparent do not, and they keep the open and closed state;
 * - nothing carries a transform or an animation after the first render;
 * - the drag hook still finds every shown row and group by DOM shape after a collapse and an expand, and skips
 *   a group that is only waiting for its collapse to finish (`data-tree-exiting`).
 */
import { act, createElement, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const seen = vi.hoisted(() => ({
  layouts: [] as { containerRef: { current: HTMLElement | null }; handle: unknown }[],
  treeHandles: [] as unknown[],
}));
vi.mock("@astryxdesign/core/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/hooks")>();
  return {
    ...actual,
    useAnimatedLayout: (options: Parameters<typeof actual.useAnimatedLayout>[0]) => {
      const handle = actual.useAnimatedLayout(options);
      seen.layouts.push({ containerRef: options.containerRef, handle });
      return handle;
    },
  };
});
vi.mock("@astryxdesign/core/TreeList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/TreeList")>();
  const TreeList = (props: ComponentProps<typeof actual.TreeList>) => {
    seen.treeHandles.push(props.animatedLayout);
    return createElement(actual.TreeList, props);
  };
  return { ...actual, TreeList };
});
const drag = vi.hoisted(() => ({ onMove: null as null | ((move: { page_id: string; parent_id: string | null }) => void) }));
vi.mock("@/components/pages/use-page-drag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/pages/use-page-drag")>();
  // The real hook, with the drop handler kept so a test can drop a page without pointer events.
  return {
    ...actual,
    usePageDrag: (options: Parameters<typeof actual.usePageDrag>[0]) => {
      drag.onMove = options.onMove;
      return actual.usePageDrag(options);
    },
  };
});
vi.mock("@/app/actions/pages", () => ({
  createPageAction: vi.fn(async () => ok),
  movePageAction: vi.fn(async () => ok),
  archivePageAction: vi.fn(async () => ok),
  unarchivePageAction: vi.fn(async () => ok),
  updatePageAction: vi.fn(async () => ok),
  duplicatePageAction: vi.fn(async () => ok),
  lockPageAction: vi.fn(async () => ok),
  unlockPageAction: vi.fn(async () => ok),
  deletePageAction: vi.fn(async () => ok),
  listPagesAction: vi.fn(async () => ok),
}));
vi.mock("@/app/actions/favorites", () => ({ addFavoriteAction: vi.fn(async () => ok), removeFavoriteAction: vi.fn(async () => ok) }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn(async () => undefined) }));
vi.mock("@/app/actions/history", () => ({
  restorePageVersionAction: vi.fn(async () => ok),
  restoreWorkItemVersionAction: vi.fn(async () => ok),
  listActorsAction: vi.fn(async () => ({ ok: true as const, data: { items: [] }, cursor: 1 })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/wiki",
  useSearchParams: () => new URLSearchParams(""),
}));

const { PagesScreen } = await import("@/components/pages/PagesScreen");
const { PanelPage } = await import("@/components/shell/PanelHeader");
const { findTreeNodes } = await import("@/components/pages/use-page-drag");
/** PanelPage's children go in as createElement's own argument (the lint rule forbids a `children` prop). */
const panelPage = (props: Omit<ComponentProps<typeof PanelPage>, "children">, child: ReactNode) => createElement(PanelPage, props as ComponentProps<typeof PanelPage>, child);

function page(id: string, overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id,
    project_id: null,
    parent_id: null,
    name: `Page ${id}`,
    access: "public",
    is_locked: false,
    logo: null,
    archived_at: null,
    sort_order: id,
    label_ids: [],
    child_count: 0,
    updated_at: "2026-10-11T10:00:00.000Z",
    updated_by: "u",
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** The frame callbacks the page asked for, run by `nextFrame` so a test decides when a frame passes. */
let frames: FrameRequestCallback[] = [];
let frameSpy: { mockRestore: () => void } | null = null;
/** Page ids whose row the glide machinery measured (it reads the rect of the row that changes and of the rows after it). */
let measured: string[] = [];
const realRect = Element.prototype.getBoundingClientRect;
async function nextFrame() {
  const due = frames;
  frames = [];
  await act(async () => {
    for (const callback of due) callback(0);
  });
}
/** Forgets what was measured so far and returns it. */
function takeMeasured() {
  const out = measured;
  measured = [];
  return out;
}

async function mount(node: Parameters<Root["render"]>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}
const screen = (pages: PageSummary[]) => createElement(PagesScreen, { space: { kind: "wiki" }, tab: "public", pages, labels: [], spaces: [] });
const shownIds = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>("li[data-tree-id]")].map((row) => row.dataset.treeId);
const toggleOf = (el: ParentNode, id: string) => el.querySelector<HTMLElement>(`li[data-tree-id="${id}"] [data-tree-toggle]`);
const expandedOf = (el: ParentNode, id: string) => el.querySelector(`li[data-tree-id="${id}"]`)?.getAttribute("aria-expanded");
async function typeQuery(el: ParentNode, value: string) {
  const input = el.querySelector<HTMLInputElement>('input[type="text"]');
  if (input === null) throw new Error("no search field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
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

beforeEach(() => {
  frames = [];
  measured = [];
  frameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.closest("li[data-tree-id]");
    if (row instanceof HTMLElement && row.dataset.treeId !== undefined) measured.push(row.dataset.treeId);
    return realRect.call(this);
  };
});

afterEach(async () => {
  Element.prototype.getBoundingClientRect = realRect;
  frameSpy?.mockRestore();
  frameSpy = null;
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  seen.layouts.length = 0;
  seen.treeHandles.length = 0;
});

describe("PanelPage contentRef", () => {
  it("is the content element that scrolls, with the page's children inside", async () => {
    const contentRef = createRef<HTMLDivElement>();
    await mount(panelPage({ header: createElement("p", null, "Header"), contentRef }, createElement("p", { id: "inside" }, "Body")));
    expect(contentRef.current).toBeInstanceOf(HTMLElement);
    expect(contentRef.current?.querySelector("#inside")).not.toBeNull();
    // The header is not in the scroller.
    expect(contentRef.current?.textContent).not.toContain("Header");
  });

  it("is optional: a page without it renders as before", async () => {
    const el = await mount(panelPage({ header: createElement("p", null, "Header") }, createElement("p", { id: "inside" }, "Body")));
    expect(el.querySelector("#inside")).not.toBeNull();
  });
});

describe("PagesScreen tree glide", () => {
  const pages = [page("A"), page("B"), page("B1", { parent_id: "B" }), page("B2", { parent_id: "B" }), page("C")];

  it("measures the scroller that holds the tree, and hands the TreeList the hook's handle only while the person toggles", async () => {
    const el = await mount(screen(pages));
    expect(seen.layouts.length).toBeGreaterThan(0);
    const { containerRef, handle } = seen.layouts[seen.layouts.length - 1];
    const scroller = containerRef.current;
    expect(scroller).toBeInstanceOf(HTMLElement);
    expect(scroller?.querySelector('[role="tree"]')).toBe(el.querySelector('[role="tree"]'));
    expect(handle).toBeDefined();
    // At rest the tree has no handle, so a change it did not cause cannot glide.
    expect(seen.treeHandles.length).toBeGreaterThan(0);
    expect(seen.treeHandles.every((given) => given === undefined)).toBe(true);
    // One handle, kept across renders: the hook never makes a new one.
    expect(new Set(seen.layouts.map((entry) => entry.handle)).size).toBe(1);

    // The chevron click renders the tree with that handle, and the frame after takes it away again.
    seen.treeHandles.length = 0;
    await act(async () => toggleOf(el, "B")?.click());
    expect(seen.treeHandles).toContain(handle);
    await nextFrame();
    expect(seen.treeHandles[seen.treeHandles.length - 1]).toBeUndefined();
  });

  it("starts still: no transform and no animation on the tree after the first render", async () => {
    const el = await mount(screen(pages));
    expect(shownIds(el)).toEqual(["A", "B", "B1", "B2", "C"]);
    expect(el.querySelectorAll('[role="tree"] [style*="transform"], [role="tree"] [style*="animation"]')).toHaveLength(0);
    expect(el.querySelector('[role="tree"]')?.getAnimations?.({ subtree: true }) ?? []).toHaveLength(0);
  });

  it("collapses and expands a parent, and the drag hook still finds the rows and groups it needs", async () => {
    const el = await mount(screen(pages));
    const before = findTreeNodes(el);
    expect(before.rows.map((entry) => entry.id)).toEqual(["A", "B", "B1", "B2", "C"]);
    expect(before.rows.every((entry) => entry.row !== null)).toBe(true);
    expect(before.rows.find((entry) => entry.id === "B")?.group).not.toBeNull();
    expect(before.tree).toBe(el.querySelector('[role="tree"]'));

    const toggle = () => el.querySelector<HTMLElement>('li[data-tree-id="B"] [data-tree-toggle]');
    await act(async () => toggle()?.click());
    // No layout in jsdom, so the collapse is not held for a glide: the sub-pages go at once.
    expect(shownIds(el)).toEqual(["A", "B", "C"]);
    expect(findTreeNodes(el).rows.map((entry) => entry.id)).toEqual(["A", "B", "C"]);
    expect(findTreeNodes(el).rows.find((entry) => entry.id === "B")?.group).toBeNull();

    await act(async () => toggle()?.click());
    const after = findTreeNodes(el);
    expect(after.rows.map((entry) => entry.id)).toEqual(["A", "B", "B1", "B2", "C"]);
    expect(after.rows.find((entry) => entry.id === "B")?.group).not.toBeNull();
    expect(el.querySelectorAll('[role="tree"] [style*="transform"]')).toHaveLength(0);
  });
});

/** After the tree is up: forgets what mounting measured and which handles it saw, so a test reads only its own change. */
function settle() {
  takeMeasured();
  seen.treeHandles.length = 0;
}
const noHandle = () => seen.treeHandles.every((given) => given === undefined);

describe("only the person's own toggle glides", () => {
  const tree = [page("alpha", { name: "Alpha parent" }), page("alpha1", { name: "Alpha child", parent_id: "alpha" }), page("beta", { name: "Beta" }), page("delta", { name: "Delta" })];

  it("glides when the person closes and opens a page with its chevron: the tree is given the handle and measures the row", async () => {
    const el = await mount(screen(tree));
    settle();
    await act(async () => toggleOf(el, "alpha")?.click());
    expect(seen.treeHandles).toContain(seen.layouts[seen.layouts.length - 1].handle);
    expect(takeMeasured(), "the glide measured the row that closed").toContain("alpha");
    expect(expandedOf(el, "alpha")).toBe("false");
    await nextFrame();
    expect(seen.treeHandles[seen.treeHandles.length - 1], "the handle goes a frame later").toBeUndefined();

    settle();
    await act(async () => toggleOf(el, "alpha")?.click());
    expect(takeMeasured()).toContain("alpha");
    expect(expandedOf(el, "alpha")).toBe("true");
  });

  it("glides when the person closes and opens a page with the arrow keys", async () => {
    const el = await mount(screen(tree));
    const row = el.querySelector<HTMLElement>('li[data-tree-id="alpha"]');
    expect(row?.getAttribute("role")).toBe("treeitem");
    row?.focus();
    settle();
    await act(async () => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(expandedOf(el, "alpha")).toBe("false");
    expect(takeMeasured(), "the arrow key's close was measured").toContain("alpha");
    await nextFrame();
    settle();
    await act(async () => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(expandedOf(el, "alpha")).toBe("true");
    expect(takeMeasured(), "the arrow key's open was measured").toContain("alpha");
  });

  it("does not glide on a search: entering it and clearing it measure no row and give the tree no handle", async () => {
    const el = await mount(screen(tree));
    settle();
    // "t" keeps Alpha parent, Beta and Delta as a flat list: the open parent loses its sub-pages.
    await typeQuery(el, "t");
    expect(shownIds(el)).toEqual(["alpha", "beta", "delta"]);
    expect(takeMeasured(), "no row glides while results filter").toEqual([]);
    expect(noHandle()).toBe(true);
    await nextFrame();
    expect(takeMeasured()).toEqual([]);

    // Clearing it brings the sub-pages back: they are there at once.
    await typeQuery(el, "");
    expect(shownIds(el)).toEqual(["alpha", "alpha1", "beta", "delta"]);
    expect(takeMeasured(), "no row glides back when the search is cleared").toEqual([]);
    expect(noHandle()).toBe(true);

    // A search that matches the sub-page only is the same flat list.
    await typeQuery(el, "child");
    expect(takeMeasured()).toEqual([]);
    await typeQuery(el, "");
    expect(takeMeasured()).toEqual([]);
    expect(noHandle()).toBe(true);
  });

  it("keeps what the person closed through a search", async () => {
    const el = await mount(screen(tree));
    await act(async () => toggleOf(el, "alpha")?.click());
    await nextFrame();
    expect(shownIds(el)).toEqual(["alpha", "beta", "delta"]);
    await typeQuery(el, "Alpha");
    await typeQuery(el, "");
    expect(expandedOf(el, "alpha")).toBe("false");
    expect(shownIds(el)).toEqual(["alpha", "beta", "delta"]);
  });

  it("does not glide when the refresh gives a page its first sub-page or takes its last", async () => {
    const plain = [page("a"), page("b"), page("c")];
    const el = await mount(screen(plain));
    settle();
    await act(async () => {
      root?.render(screen([page("a"), page("b", { child_count: 1 }), page("b1", { parent_id: "b" }), page("c")]));
    });
    expect(shownIds(el)).toEqual(["a", "b", "b1", "c"]);
    expect(takeMeasured(), "the new sub-page row does not slide in").toEqual([]);
    expect(noHandle()).toBe(true);
    await nextFrame();

    await act(async () => {
      root?.render(screen(plain));
    });
    expect(shownIds(el)).toEqual(["a", "b", "c"]);
    expect(takeMeasured(), "the row of a page that lost its last sub-page does not glide").toEqual([]);
    expect(noHandle()).toBe(true);
  });

  it("does not glide when a drag makes another page a parent, and keeps the pages the person closed closed", async () => {
    const pages = [page("s"), page("p", { child_count: 1 }), page("c", { parent_id: "p" }), page("q", { child_count: 1 }), page("d", { parent_id: "q" })];
    const el = await mount(screen(pages));
    await act(async () => toggleOf(el, "q")?.click());
    await nextFrame();
    expect(shownIds(el)).toEqual(["s", "p", "c", "q"]);
    settle();

    // P is dropped on S: S becomes a parent, the set of open pages changes, and Q stays closed.
    await act(async () => {
      drag.onMove?.({ page_id: "p", parent_id: "s" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      root?.render(screen([page("s", { child_count: 1 }), page("p", { parent_id: "s", child_count: 1 }), page("c", { parent_id: "p" }), page("q", { child_count: 1 }), page("d", { parent_id: "q" })]));
    });
    expect(shownIds(el)).toEqual(["s", "p", "c", "q"]);
    expect(expandedOf(el, "s")).toBe("true");
    expect(expandedOf(el, "p")).toBe("true");
    expect(expandedOf(el, "q"), "the page the person closed is still closed").toBe("false");
    expect(takeMeasured(), "the drop does not glide").toEqual([]);
    expect(noHandle()).toBe(true);
  });
});

describe("findTreeNodes", () => {
  /** The TreeList's shape: li[data-tree-id] > div > .tessera-page-row, and li > ul[role=group] for the sub-pages. */
  function tree(exiting: boolean) {
    const host = document.createElement("div");
    host.innerHTML = `
      <ul role="tree">
        <li data-tree-id="A"><div><div class="tessera-page-row"></div></div></li>
        <li data-tree-id="B">
          <div><div class="tessera-page-row"></div></div>
          <ul role="group" ${exiting ? "data-tree-exiting" : ""}>
            <li data-tree-id="B1"><div><div class="tessera-page-row"></div></div></li>
            <li data-tree-id="B2"><div><div class="tessera-page-row"></div></div></li>
          </ul>
        </li>
      </ul>`;
    return host;
  }

  it("lists the rows and the groups that are shown", () => {
    const nodes = findTreeNodes(tree(false));
    expect(nodes.tree).not.toBeNull();
    expect(nodes.rows.map((entry) => entry.id)).toEqual(["A", "B", "B1", "B2"]);
    expect(nodes.rows.map((entry) => entry.group !== null)).toEqual([false, true, false, false]);
  });

  it("skips a group that is still leaving, and the rows inside it, but keeps the parent that is closing", () => {
    const nodes = findTreeNodes(tree(true));
    expect(nodes.rows.map((entry) => entry.id)).toEqual(["A", "B"]);
    expect(nodes.rows.find((entry) => entry.id === "B")?.group).toBeNull();
    expect(nodes.rows.find((entry) => entry.id === "B")?.row).not.toBeNull();
  });
});
