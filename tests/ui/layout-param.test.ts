// @vitest-environment jsdom
/**
 * The `?layout=` param (src/components/work-items/layout-param.ts): the pure
 * helpers, and the effect on WorkItemsScreen that merges a valid layout into
 * `q`, drops the param, keeps every other param, ignores a bogus value and
 * stays off for table-only screens (workspace views). The Server Action
 * wrappers and the router are mocked.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hrefWithLayout, layoutFromParam } from "@/components/work-items/layout-param";
import { decodeUrlState, encodeUrlState } from "@/components/work-items/url-state";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, State } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);
vi.mock("@/app/actions/work-items", () => ({ createWorkItemAction: action(), updateWorkItemAction: action(), moveWorkItemAction: action() }));
vi.mock("@/app/actions/views", () => ({ saveViewSettingsAction: action(), resetViewSettingsAction: action(), createViewAction: action(), updateViewAction: action() }));
vi.mock("@/components/work-items/ListLayout", () => ({ ListLayout: () => null }));
const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { WorkItemsScreen } = await import("@/components/work-items/WorkItemsScreen");
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

type ScreenProps = ComponentProps<typeof WorkItemsScreen>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(search: string, props: Partial<ScreenProps> = {}) {
  nav.search = search;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const screenProps: ScreenProps = {
    projectId: PROJECT,
    result: { items: [], total: 0, cursor: 1 },
    display: DEFAULT_DISPLAY,
    filters: {},
    settingsDisplay: DEFAULT_DISPLAY,
    createOnOpen: false,
    ...props,
  };
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  await act(async () => {
    root?.render(createElement(ProjectProvider, providerProps, createElement(WorkItemsScreen, screenProps)));
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
  container?.remove();
  root = null;
  container = null;
  nav.router.replace.mockClear();
  nav.search = "";
});

/** The `q` display half and the other params of an href the screen replaced the URL with. */
function parts(href: string) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  return { path, params, state: decodeUrlState(params.get("q") ?? undefined) };
}

describe("layoutFromParam", () => {
  it("accepts the five layouts and ignores everything else", () => {
    for (const layout of ["list", "board", "table", "calendar", "gantt"] as const) expect(layoutFromParam(layout)).toBe(layout);
    for (const bogus of ["kanban", "", "BOARD", null, undefined]) expect(layoutFromParam(bogus)).toBeNull();
  });
});

describe("hrefWithLayout", () => {
  it("merges the layout into q's display and drops the layout param", () => {
    const { path, params, state } = parts(hrefWithLayout("/projects/p/work-items", "layout=board", {}, "board"));
    expect(path).toBe("/projects/p/work-items");
    expect(params.has("layout")).toBe(false);
    expect(state.display?.layout).toBe("board");
  });

  it("keeps the other params, the filters and the other display keys", () => {
    const urlState = { filters: { priority: ["high" as const] }, display: { group_by: "state" as const, layout: "list" as const } };
    const { params, state } = parts(hrefWithLayout("/p", `peek=abc&layout=table&q=${encodeUrlState(urlState)}`, urlState, "table"));
    expect(params.get("peek")).toBe("abc");
    expect(params.has("layout")).toBe(false);
    expect(state.filters).toEqual({ priority: ["high"] });
    expect(state.display).toMatchObject({ group_by: "state", layout: "table" });
  });
});

describe("the ?layout= effect on WorkItemsScreen", () => {
  it("replaces the URL once with the layout merged into q", async () => {
    await render("layout=board&peek=abc");
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    const [href, options] = nav.router.replace.mock.calls[0] as unknown as [string, { scroll: boolean }];
    const { params, state } = parts(href);
    expect(params.has("layout")).toBe(false);
    expect(params.get("peek")).toBe("abc");
    expect(state.display?.layout).toBe("board");
    expect(options).toEqual({ scroll: false });
  });

  it("keeps the filters already in q", async () => {
    const q = encodeUrlState({ filters: { search: "hosting" } });
    await render(`layout=table&q=${q}`);
    const { state } = parts(nav.router.replace.mock.calls[0]?.[0] as string);
    expect(state.filters).toEqual({ search: "hosting" });
    expect(state.display?.layout).toBe("table");
  });

  it("ignores a bogus layout", async () => {
    await render("layout=kanban");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("does nothing without the param", async () => {
    await render("");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("stays off for a table-only screen (no layout switch)", async () => {
    await render("layout=board", { showLayoutSwitch: false });
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});
