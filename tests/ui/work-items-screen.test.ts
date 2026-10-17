// @vitest-environment jsdom
/**
 * Render smoke test of the work items screen's panel header
 * (src/components/work-items/WorkItemsScreen.tsx, docs/contracts/ui.md "Work
 * items screen") under jsdom: the sub-header's title and count (props, with
 * "Work items" and the list's total as defaults), "New work item" only while
 * the list can create, and the layout switch saving to the list's own view
 * settings scope (decision 23: a cycle's layout never lands on the project).
 * The Server Action wrappers and the router are mocked, so no database or Next
 * runtime is involved.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, State, WorkItem } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);

vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: action(),
  updateWorkItemAction: action(),
  moveWorkItemAction: action(),
}));
vi.mock("@/app/actions/views", () => ({
  saveViewSettingsAction: action(),
  resetViewSettingsAction: action(),
}));
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { WorkItemsScreen } = await import("@/components/work-items/WorkItemsScreen");
const { saveViewSettingsAction } = await import("@/app/actions/views");
const { DEFAULT_DISPLAY } = await import("@/lib/tessera/schemas");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const CYCLE = "77777777-7777-7777-8777-777777777777";
const ITEM = "22222222-2222-7222-8222-222222222222";
const NOW = "2026-10-11T10:00:00.000Z";

const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project: Project = {
  id: PROJECT,
  name: "Website",
  name_key: "website",
  identifier: "WEB",
  description_md: "",
  logo: { icon: "Globe", color: "blue" },
  next_sequence: 2,
  cycles_enabled: true,
  modules_enabled: true,
  views_enabled: true,
  pages_enabled: true,
  intake_enabled: false,
  estimates_enabled: false,
  agent_intake_required: false,
  estimate_id: null,
  default_assignee_id: null,
  archive_in_months: null,
  close_in_months: null,
  close_state_id: null,
  archived_at: null,
  sort_order: "a0",
  ...audit,
  counts: { total: 1, by_state_group: { backlog: 1, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 } },
};

const states: State[] = [
  { id: STATE, project_id: PROJECT, name: "Backlog", name_key: "backlog", description: "", color: "gray", state_group: "backlog", is_default: true, sort_order: "a0", ...audit },
];

const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, ...audit }];

const bundle: ProjectBundle = { project, states, labels: [], cycles: [], modules: [], actors, cursor: 42, today: "2026-10-17" };

const item: WorkItem = {
  id: ITEM,
  project_id: PROJECT,
  sequence_id: 1,
  key: "WEB-1",
  name: "Set up hosting",
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
};

type ScreenProps = ComponentProps<typeof WorkItemsScreen>;

function screen(props: Partial<ScreenProps> = {}) {
  const screenProps: ScreenProps = {
    projectId: PROJECT,
    result: { items: [item], total: 1, cursor: 42 },
    display: DEFAULT_DISPLAY,
    filters: {},
    settingsDisplay: DEFAULT_DISPLAY,
    createOnOpen: false,
    ...props,
  };
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  return createElement(ProjectProvider, providerProps, createElement(WorkItemsScreen, screenProps));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Partial<ScreenProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(screen(props));
  });
  return container;
}

/** The start group of the sub-header row: its title and count. */
function subheaderStart(el: HTMLElement): string {
  return el.querySelector(".tessera-panel-bar--subheader > .tessera-panel-bar-start")?.textContent?.trim() ?? "";
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
  container?.remove();
  root = null;
  container = null;
  vi.mocked(saveViewSettingsAction).mockClear();
});

describe("WorkItemsScreen panel header", () => {
  it("names the sub-header Work items with the list's total and offers New work item by default", async () => {
    const el = await render();
    expect(subheaderStart(el)).toBe("Work items1");
    expect(el.querySelector('[aria-label="Work items"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Work items list"]')).not.toBeNull();
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.trim() === "New work item")).toBe(true);
    expect(el.querySelector(".tessera-panel-bar--filters")).not.toBeNull();
  });

  it("takes the title and count as props, and hides the count for null", async () => {
    const named = await render({ title: "Sprint items", count: 7 });
    expect(subheaderStart(named)).toBe("Sprint items7");
    expect(named.querySelector('[aria-label="Sprint items list"]')).not.toBeNull();
    await act(async () => {
      root?.render(screen({ count: null }));
    });
    expect(subheaderStart(named)).toBe("Work items");
  });

  it("leaves out New work item in a closed scope", async () => {
    const el = await render({ canCreate: false });
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.trim() === "New work item")).toBe(false);
  });

  it("saves a layout change to the list's own settings scope, not the project's", async () => {
    const el = await render({ settingsScope: { scope_type: "cycle", scope_id: CYCLE }, hiddenGroupFields: ["cycle"] });
    const board = [...el.querySelectorAll<HTMLElement>('[role="radio"], button')].find((element) => element.getAttribute("aria-label") === "Board" || element.textContent?.trim() === "Board");
    expect(board).toBeDefined();
    await act(async () => {
      board?.click();
    });
    expect(saveViewSettingsAction).toHaveBeenCalledWith({ scope_type: "cycle", scope_id: CYCLE, display: { layout: "board" } });
    expect(nav.router.replace).toHaveBeenCalled();
  });
});
