// @vitest-environment jsdom
/**
 * Visual-audit fixes of the list screen (lane L), under jsdom:
 * - a grouped list whose filter matches nothing shows NoResults, not empty groups (L12);
 * - a row shows at most two labels and a "+N" chip, an overdue target date carries data-overdue,
 *   a selected row carries data-selected (L11, L4, L9);
 * - the pure helpers behind them (isOverdue, summarizeNames).
 * jsdom has no layout; the stylesheet rules are read in list-touch-css.test.ts.
 */
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isOverdue } from "@/components/work-items/properties/date-format";
import { splitShownNames, summarizeNames } from "@/components/work-items/properties/membership-rules";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Group, Project, State, WorkItem } from "@/lib/tessera/types";

vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: vi.fn(), updateWorkItemAction: vi.fn(), moveWorkItemAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { ListLayout } = await import("@/components/work-items/ListLayout");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const DONE = "77777777-7777-7777-8777-777777777777";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project = {
  id: PROJECT,
  name: "Website",
  identifier: "WEB",
  cycles_enabled: false,
  modules_enabled: false,
  estimates_enabled: false,
  archived_at: null,
  ...audit,
} as unknown as Project;
const states: State[] = [
  { id: STATE, project_id: PROJECT, name: "Todo", name_key: "todo", description: "", color: "gray", state_group: "unstarted", is_default: true, sort_order: "a0", ...audit },
  { id: DONE, project_id: PROJECT, name: "Done", name_key: "done", description: "", color: "green", state_group: "completed", is_default: false, sort_order: "a1", ...audit },
];
const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, access: "write", ...audit }];
const labels = ["Frontend", "Backend", "API", "Design", "Bug"].map((name, index) => ({ id: `label-${index}`, project_id: PROJECT, name, name_key: name.toLowerCase(), color: "blue", sort_order: `a${index}`, ...audit }));
const bundle = { project, states, labels, cycles: [], modules: [], actors, cursor: 1, today: "2026-10-22", estimate: null, intake_open: 0, projects: [] } as unknown as ProjectBundle;

function item(id: string, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    project_id: PROJECT,
    sequence_id: 1,
    key: "WEB-1",
    name: `Item ${id}`,
    description_md: "",
    description_version: 0,
    state_id: STATE,
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
    ...extra,
  } as WorkItem;
}

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
  document.body.replaceChildren();
  root = null;
  container = null;
});

const emptyGroup = (id: string, name: string): Group => ({ field: "state", id, name, color: null, count: 0, item_ids: [], has_more: false });

describe("isOverdue", () => {
  it("is true for a target date before today on an open item", () => {
    expect(isOverdue("2026-10-17", "2026-10-22", "unstarted")).toBe(true);
    expect(isOverdue("2026-10-17", "2026-10-22", "started")).toBe(true);
    expect(isOverdue("2026-10-17", "2026-10-22", undefined)).toBe(true);
  });

  it("is false for today, a later date, no date, and a finished item", () => {
    expect(isOverdue("2026-10-22", "2026-10-22", "unstarted")).toBe(false);
    expect(isOverdue("2026-10-30", "2026-10-22", "unstarted")).toBe(false);
    expect(isOverdue(null, "2026-10-22", "unstarted")).toBe(false);
    expect(isOverdue("2026-10-17", "2026-10-22", "completed")).toBe(false);
    expect(isOverdue("2026-10-17", "2026-10-22", "cancelled")).toBe(false);
  });
});

describe("label overflow", () => {
  it("keeps two names and counts the rest", () => {
    expect(splitShownNames(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], hidden: 2 });
    expect(splitShownNames(["a"])).toEqual({ shown: ["a"], hidden: 0 });
  });

  it("joins the shown names and ends with +N", () => {
    expect(summarizeNames(["Frontend", "Backend", "API", "Design", "Bug", "Docs"])).toBe("Frontend, Backend +4");
    expect(summarizeNames(["Frontend", "Backend"])).toBe("Frontend, Backend");
    expect(summarizeNames([])).toBe("");
  });
});

describe("grouped list with a filter that matches nothing", () => {
  const grouped = { ...DEFAULT_DISPLAY, group_by: "state" as const, show_empty_groups: true };
  const groups = [emptyGroup(STATE, "Todo"), emptyGroup(DONE, "Done")];

  it("shows the no-results state instead of empty groups and their quick-add rows", async () => {
    const onClearFilters = vi.fn();
    const el = await render(
      createElement(ListLayout, layoutProps({ display: grouped, result: { items: [], total: 0, cursor: 1, groups }, onClearFilters, onQuickAdd: () => {} })),
    );
    expect(el.textContent).toContain("No work items match these filters");
    expect(el.querySelectorAll(".tessera-wi-group")).toHaveLength(0);
    expect(el.textContent).not.toContain("New work item");
    const clear = [...el.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Clear filters");
    expect(clear).toBeDefined();
    await act(async () => {
      clear?.click();
    });
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty groups while no filter applies", async () => {
    const el = await render(createElement(ListLayout, layoutProps({ display: grouped, result: { items: [], total: 0, cursor: 1, groups }, onQuickAdd: () => {} })));
    expect(el.querySelectorAll(".tessera-wi-group")).toHaveLength(2);
    expect(el.textContent).not.toContain("No work items match these filters");
  });

  it("still lists the groups that hold items under a filter", async () => {
    const rows = [item("a", { name: "Found" })];
    const el = await render(
      createElement(
        ListLayout,
        layoutProps({
          display: grouped,
          result: { items: rows, total: 1, cursor: 1, groups: [{ ...emptyGroup(STATE, "Todo"), count: 1, item_ids: ["a"] }, emptyGroup(DONE, "Done")] },
          onClearFilters: () => {},
        }),
      ),
    );
    expect(el.textContent).toContain("Found");
    expect(el.textContent).not.toContain("No work items match these filters");
  });
});

describe("list rows", () => {
  it("shows two labels and a +N chip for the rest, and no chip for two", async () => {
    const many = item("many", { label_ids: labels.map((label) => label.id), name: "Many labels" });
    const two = item("two", { label_ids: labels.slice(0, 2).map((label) => label.id), name: "Two labels", sequence_id: 2, key: "WEB-2" });
    const display = { ...DEFAULT_DISPLAY, properties: { ...DEFAULT_DISPLAY.properties, labels: true } };
    const el = await render(createElement(ListLayout, layoutProps({ display, result: { items: [many, two], total: 2, cursor: 1 } })));
    const rows = [...el.querySelectorAll(".tessera-wi-row")];
    expect(rows).toHaveLength(2);
    const tokens = (row: Element) => [...row.querySelectorAll(".astryx-token")].map((token) => token.textContent?.trim());
    expect(tokens(rows[0])).toEqual(["Frontend", "Backend", "+3"]);
    expect(tokens(rows[1])).toEqual(["Frontend", "Backend"]);
  });

  it("marks an overdue target date on an open item and not on a done one", async () => {
    const late = item("late", { target_date: "2026-10-17", name: "Late" });
    const finished = item("finished", { target_date: "2026-10-17", state_id: DONE, name: "Finished", sequence_id: 2, key: "WEB-2" });
    const future = item("future", { target_date: "2026-10-30", name: "Future", sequence_id: 3, key: "WEB-3" });
    const display = { ...DEFAULT_DISPLAY, properties: { ...DEFAULT_DISPLAY.properties, target_date: true } };
    const el = await render(createElement(ListLayout, layoutProps({ display, result: { items: [late, finished, future], total: 3, cursor: 1 } })));
    const chip = (row: Element) => [...row.querySelectorAll(".tessera-wi-chip")].find((entry) => entry.textContent?.includes("Target"));
    const rows = [...el.querySelectorAll(".tessera-wi-row")];
    expect(chip(rows[0])?.hasAttribute("data-overdue")).toBe(true);
    expect(chip(rows[1])?.hasAttribute("data-overdue")).toBe(false);
    expect(chip(rows[2])?.hasAttribute("data-overdue")).toBe(false);
  });

  it("marks the selected rows", async () => {
    const a = item("a");
    const b = item("b", { sequence_id: 2, key: "WEB-2" });
    const el = await render(
      createElement(
        ListLayout,
        layoutProps({
          result: { items: [a, b], total: 2, cursor: 1 },
          selection: { selected: new Set(["b"]), onToggle: () => {}, onToggleIds: () => {} },
        }),
      ),
    );
    const rows = [...el.querySelectorAll(".tessera-wi-row")];
    expect(rows[0].hasAttribute("data-selected")).toBe(false);
    expect(rows[1].hasAttribute("data-selected")).toBe(true);
  });
});
