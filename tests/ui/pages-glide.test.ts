// @vitest-environment jsdom
/**
 * The page tree glides when a page opens or closes its sub-pages: PagesScreen
 * calls `useAnimatedLayout` on the element that scrolls (PanelPage's
 * `contentRef`) and hands the handle to the TreeList (docs/contracts/ui.md
 * "Motion"). What is pinned, under jsdom (no layout, so no glide runs):
 * - PanelPage's `contentRef` is the scrolling content element, with the page's children inside it;
 * - the tree sits inside that element, and the TreeList gets the hook's handle;
 * - nothing carries a transform or an animation after the first render;
 * - the drag hook still finds every shown row and group by DOM shape after a collapse and an expand, and skips
 *   a group that is only waiting for its collapse to finish (`data-tree-exiting`).
 */
import { act, createElement, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("measures the scroller that holds the tree and gives the TreeList the hook's handle", async () => {
    const el = await mount(screen(pages));
    expect(seen.layouts.length).toBeGreaterThan(0);
    const { containerRef, handle } = seen.layouts[seen.layouts.length - 1];
    const scroller = containerRef.current;
    expect(scroller).toBeInstanceOf(HTMLElement);
    expect(scroller?.querySelector('[role="tree"]')).toBe(el.querySelector('[role="tree"]'));
    expect(handle).toBeDefined();
    expect(seen.treeHandles.length).toBeGreaterThan(0);
    // One handle, kept across renders: no row sees a new prop for it.
    expect(new Set(seen.treeHandles).size).toBe(1);
    expect(seen.treeHandles[0]).toBe(handle);
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
