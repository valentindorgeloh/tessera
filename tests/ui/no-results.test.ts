// @vitest-environment jsdom
/**
 * The no-results state of the list, board and table (docs/contracts/ui.md
 * "Work items screen"): while a filter, a search or an Advanced tree is active
 * an empty result says so and offers "Clear filters"; a project with no items
 * and no filter keeps the first-run state. Also the helpers behind "Clear
 * filters", the Advanced button's condition count and the read-only dialog of
 * a tree the builder cannot show. The router and the actions are mocked.
 */
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clearedUrlState, hasActiveFilters } from "@/components/work-items/clear-filters";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, RichFilters, State } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);
vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: action(), updateWorkItemAction: action(), moveWorkItemAction: action() }));
const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { ListLayout } = await import("@/components/work-items/ListLayout");
const { BoardLayout } = await import("@/components/work-items/BoardLayout");
const { TableLayout } = await import("@/components/work-items/TableLayout");
const { FilterBar } = await import("@/components/work-items/FilterBar");
const { RichFilterDialog } = await import("@/components/filters/RichFilterDialog");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project: Project = {
  id: PROJECT,
  name: "Website",
  name_key: "website",
  identifier: "WEB",
  description_md: "",
  logo: { icon: "Globe", color: "blue" },
  next_sequence: 1,
  cycles_enabled: true,
  modules_enabled: true,
  views_enabled: true,
  pages_enabled: true,
  intake_enabled: false,
  estimates_enabled: false,
  agent_intake_required: false,
  estimate_id: null,
  estimate_type: null,
  default_assignee_id: null,
  archive_in_months: null,
  close_in_months: null,
  close_state_id: null,
  archived_at: null,
  sort_order: "a0",
  ...audit,
  counts: { total: 0, by_state_group: { backlog: 0, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } },
};
const states: State[] = [
  { id: STATE, project_id: PROJECT, name: "Backlog", name_key: "backlog", description: "", color: "gray", state_group: "backlog", is_default: true, sort_order: "a0", ...audit },
];
const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }];
const bundle: ProjectBundle = { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-17", estimate: null, intake_open: 0, projects: [] };

const leaf = (value: string): RichFilters => ({ field: "priority", op: "eq", value: value as never });
const SHALLOW: RichFilters = { and: [leaf("urgent"), leaf("high"), leaf("low")] };
// Three levels of groups: deeper than the builder shows.
const DEEP: RichFilters = { and: [{ or: [{ and: [leaf("urgent"), leaf("low")] }, leaf("high")] }, leaf("urgent")] };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  await act(async () => {
    root?.render(createElement(ProjectProvider, providerProps, node));
  });
  return container;
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

function buttonNamed(el: ParentNode, name: string | RegExp): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((entry) => {
    const text = entry.textContent?.trim() ?? "";
    return typeof name === "string" ? text === name : name.test(text);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
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
  document.body.replaceChildren();
  root = null;
  container = null;
  nav.router.replace.mockClear();
});

describe("hasActiveFilters", () => {
  it("is false for no filter, empty values and a blank search", () => {
    expect(hasActiveFilters({}, null)).toBe(false);
    expect(hasActiveFilters({ priority: [], search: "  " }, undefined)).toBe(false);
  });

  it("is true for a search, a list filter, a date filter or an Advanced tree", () => {
    expect(hasActiveFilters({ search: "x" }, null)).toBe(true);
    expect(hasActiveFilters({ labels: ["l"] }, null)).toBe(true);
    expect(hasActiveFilters({ target_date: { op: "before", to: "2026-11-01" } }, null)).toBe(true);
    expect(hasActiveFilters({}, SHALLOW)).toBe(true);
  });
});

describe("clearedUrlState", () => {
  it("writes explicit empty values, drops the Advanced tree and keeps the display", () => {
    const state = clearedUrlState({ display: { layout: "board" }, filters: { priority: ["high"] } }, { priority: ["high"], search: "x", labels: ["l"] }, SHALLOW);
    expect(state.display).toEqual({ layout: "board" });
    expect(state.filters).toEqual({ priority: [], labels: [], search: "" });
    expect(state.rich_filters).toBeNull();
  });

  it("leaves the tree alone when none applies", () => {
    const state = clearedUrlState({}, { search: "x" }, null);
    expect("rich_filters" in state).toBe(false);
  });
});

describe("no-results state", () => {
  const layouts = [
    ["list", ListLayout],
    ["board", BoardLayout],
    ["table", TableLayout],
  ] as const;

  for (const [name, Layout] of layouts) {
    it(`shows it in the ${name} while a filter is active, with a button that clears`, async () => {
      const onClearFilters = vi.fn();
      const el = await render(createElement(Layout, layoutProps({ display: { ...DEFAULT_DISPLAY, layout: name }, onClearFilters })));
      expect(el.textContent).toContain("No work items match these filters");
      expect(el.textContent).not.toContain("No work items yet");
      const clear = buttonNamed(el, "Clear filters");
      expect(clear).toBeDefined();
      await act(async () => {
        clear?.click();
      });
      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });
  }

  it("keeps the first-run state of the list without a filter", async () => {
    const el = await render(createElement(ListLayout, layoutProps()));
    expect(el.textContent).toContain("No work items yet");
    expect(el.textContent).not.toContain("match these filters");
    expect(buttonNamed(el, "Clear filters")).toBeUndefined();
  });

  it("keeps the table's own empty state without a filter", async () => {
    const el = await render(createElement(TableLayout, layoutProps({ display: { ...DEFAULT_DISPLAY, layout: "table" } })));
    expect(el.textContent).not.toContain("match these filters");
    expect(buttonNamed(el, "Clear filters")).toBeUndefined();
  });

  it("keeps the board's columns without a filter", async () => {
    const el = await render(createElement(BoardLayout, layoutProps({ display: { ...DEFAULT_DISPLAY, layout: "board" } })));
    expect(el.textContent).not.toContain("match these filters");
  });
});

describe("Advanced button", () => {
  const urlState = {};

  it("reads plain Advanced without a tree", async () => {
    const el = await render(createElement(FilterBar, { filters: {}, urlState, richFilters: null }));
    expect(buttonNamed(el, "Advanced")).toBeDefined();
    expect(el.querySelector('[aria-label="Remove Advanced filter"]')).toBeNull();
  });

  it("shows the condition count, also for a tree the builder cannot show", async () => {
    const shallow = await render(createElement(FilterBar, { filters: {}, urlState, richFilters: SHALLOW }));
    expect(buttonNamed(shallow, "Advanced · 3 conditions")).toBeDefined();
    await act(async () => {
      root?.render(createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, createElement(FilterBar, { filters: {}, urlState, richFilters: DEEP })));
    });
    expect(buttonNamed(shallow, "Advanced · 4 conditions")).toBeDefined();
  });

  it("drops the tree from the remove button", async () => {
    const el = await render(createElement(FilterBar, { filters: {}, urlState, richFilters: SHALLOW }));
    const remove = el.querySelector<HTMLButtonElement>('[aria-label="Remove Advanced filter"]');
    expect(remove).not.toBeNull();
    await act(async () => {
      remove?.click();
    });
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
  });
});

describe("RichFilterDialog", () => {
  async function open(tree: RichFilters | null) {
    const make = (isOpen: boolean) => createElement(RichFilterDialog, { isOpen, onOpenChange: () => {}, tree, onApply: () => {} });
    await render(make(false));
    await act(async () => {
      root?.render(createElement(ProjectProvider, { bundle } as ComponentProps<typeof ProjectProvider>, make(true)));
    });
    const dialog = [...document.querySelectorAll("dialog")].find((entry) => entry.open);
    expect(dialog).toBeDefined();
    return dialog as HTMLDialogElement;
  }

  it("offers Add condition and Add group while the tree is editable", async () => {
    const dialog = await open(SHALLOW);
    expect(buttonNamed(dialog, "Add condition")).toBeDefined();
    expect(buttonNamed(dialog, "Add group")).toBeDefined();
    expect(buttonNamed(dialog, "Apply")).toBeDefined();
    expect(buttonNamed(dialog, "Cancel")).toBeDefined();
  });

  it("is read-only for a tree that is too deep: the summary and Clear all, nothing to add", async () => {
    const dialog = await open(DEEP);
    expect(dialog.textContent).toContain("more nested than the builder can edit");
    expect(buttonNamed(dialog, "Add condition")).toBeUndefined();
    expect(buttonNamed(dialog, "Add group")).toBeUndefined();
    expect(buttonNamed(dialog, "Apply")).toBeUndefined();
    expect(buttonNamed(dialog, "Cancel")).toBeUndefined();
    expect(buttonNamed(dialog, "Clear all")).toBeDefined();
    expect(buttonNamed(dialog, "Close")).toBeDefined();
  });
});
