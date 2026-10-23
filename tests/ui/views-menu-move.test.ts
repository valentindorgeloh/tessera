// @vitest-environment jsdom
/**
 * The views lists' row menu Move up / Move down (decisions 13 and 105): the new
 * order shows at once (the screen's useOptimistic move, handed to the row as
 * `onMove`) and a refused move snaps back and toasts, like a drag does. Both
 * lists share the wiring (use-view-reorder.ts); the workspace list also gets
 * the drag grip the project list has, and none while it is sorted by name.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { View } from "@/lib/tessera/types";
import { viewStep } from "@/components/views/view-reorder";

const ok = { ok: true as const, data: {}, cursor: 1 };
const actions = vi.hoisted(() => ({ reorderViewAction: vi.fn() }));
vi.mock("@/app/actions/views", () => ({
  reorderViewAction: actions.reorderViewAction,
  createViewAction: vi.fn(async () => ok),
  updateViewAction: vi.fn(async () => ok),
  duplicateViewAction: vi.fn(async () => ok),
  lockViewAction: vi.fn(async () => ok),
  unlockViewAction: vi.fn(async () => ok),
  deleteViewAction: vi.fn(async () => ok),
}));
vi.mock("@/app/actions/favorites", () => ({ addFavoriteAction: vi.fn(async () => ok), removeFavoriteAction: vi.fn(async () => ok) }));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: vi.fn(async () => ok), discardProposalsAction: vi.fn(async () => ok) }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: vi.fn(async () => undefined) }));
vi.mock("@/components/ai/ViewFromPromptDialog", () => ({ ViewFromPromptDialog: () => null }));
vi.mock("@/components/ai/AiStatusProvider", () => ({ useAiStatus: () => ({ status: null, refresh: () => {} }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/views",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { ViewsScreen } = await import("@/components/views/ViewsScreen");
const { WorkspaceViewsScreen } = await import("@/components/views/WorkspaceViewsScreen");

const PROJECT = "11111111-1111-7111-8111-111111111111";

function view(id: string): View {
  return {
    id,
    name: `View ${id}`,
    description: "",
    logo: null,
    is_locked: false,
    filters: {},
    display: { layout: "list", group_by: null },
    rich_filters: null,
  } as unknown as View;
}

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB", archived_at: null, views_enabled: true },
  states: [],
  labels: [],
  cycles: [],
  modules: [],
  actors: [],
  cursor: 1,
  today: "2026-10-17",
  estimate: null,
  intake_open: 0,
  projects: [],
} as unknown as ProjectBundle;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

const projectList = (views: View[]) => {
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  return createElement(ProjectProvider, providerProps, createElement(ViewsScreen, { projectId: PROJECT, views, counts: {}, createOnOpen: false }));
};
const workspaceList = (views: View[]) => createElement(WorkspaceViewsScreen, { views, favoriteIds: [], counts: {}, createOnOpen: false });

/** Saved-view rows in document order (the workspace screen's default views have no row menu). */
const saved = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("li")].filter((row) => row.querySelector('button[aria-label="View actions"]'));
const order = (el: HTMLElement) => saved(el).map((row) => row.textContent?.match(/View [ABC]/)?.[0]);

/** Open the menu of the row named `name` and pick `item` (every row's menu is in the document, in row order). */
async function pick(el: HTMLElement, name: string, item: string) {
  const rows = saved(el);
  const index = rows.findIndex((entry) => entry.textContent?.includes(name));
  await act(async () => {
    rows[index]?.querySelector<HTMLButtonElement>('button[aria-label="View actions"]')?.click();
  });
  const entries = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((node) => node.textContent?.trim().startsWith(item));
  await act(async () => {
    entries[index]?.click();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  actions.reorderViewAction.mockReset();
});

describe("viewStep", () => {
  it("names the optimistic index and the neighbour of one step", () => {
    expect(viewStep(["a", "b", "c"], "c", "up")).toEqual({ index: 1, input: { view_id: "c", after_id: "b" } });
    expect(viewStep(["a", "b", "c"], "a", "down")).toEqual({ index: 1, input: { view_id: "a", before_id: "b" } });
  });

  it("returns null at either end and for an unknown view", () => {
    expect(viewStep(["a", "b"], "a", "up")).toBeNull();
    expect(viewStep(["a", "b"], "b", "down")).toBeNull();
    expect(viewStep(["a", "b"], "zz", "up")).toBeNull();
  });
});

describe.each([
  ["project views list", projectList],
  ["workspace views list", workspaceList],
])("%s row menu moves", (_name, make) => {
  it("Move up reorders the list before the server answers", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.reorderViewAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render(make([view("A"), view("B"), view("C")]));
    expect(order(el)).toEqual(["View A", "View B", "View C"]);
    await pick(el, "View C", "Move up");
    expect(actions.reorderViewAction).toHaveBeenCalledWith({ view_id: "C", after_id: "B" });
    expect(order(el)).toEqual(["View A", "View C", "View B"]);
    await act(async () => {
      finish(ok);
    });
  });

  it("Move down reorders the list before the server answers", async () => {
    let finish: (value: typeof ok) => void = () => {};
    actions.reorderViewAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render(make([view("A"), view("B"), view("C")]));
    await pick(el, "View A", "Move down");
    expect(actions.reorderViewAction).toHaveBeenCalledWith({ view_id: "A", before_id: "B" });
    expect(order(el)).toEqual(["View B", "View A", "View C"]);
    await act(async () => {
      finish(ok);
    });
  });

  it("a refused move snaps back and toasts", async () => {
    let finish: (value: { ok: false; code: string; message: string; details: null }) => void = () => {};
    actions.reorderViewAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const el = await render(make([view("A"), view("B"), view("C")]));
    await pick(el, "View C", "Move up");
    expect(order(el)).toEqual(["View A", "View C", "View B"]);
    await act(async () => {
      finish({ ok: false, code: "RULE", message: "Nope", details: null });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(order(el)).toEqual(["View A", "View B", "View C"]);
    expect(document.body.textContent).toContain("Could not move View C: Nope");
  });
});

describe("workspace views list", () => {
  it("rows carry the drag grip while the list is in manual order", async () => {
    const el = await render(workspaceList([view("A"), view("B")]));
    expect(saved(el).every((row) => row.querySelector(".tessera-row-grip") !== null)).toBe(true);
  });
});
