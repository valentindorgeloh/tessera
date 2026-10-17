// @vitest-environment jsdom
/**
 * Render smoke test of the project frame (src/components/work-items/ProjectFrame.tsx,
 * docs/contracts/ui.md "Project routes" and P3 "Integration (E4)") under jsdom:
 * the panel header row holds the token, the name, the project's tabs (Cycles
 * and Modules follow the feature toggles, Archives always shows) and the
 * project menu at its end; the tab under the route is selected; an archived
 * project shows its Banner under the header, not inside it; a route of a
 * feature that is turned off selects no tab and names the content by the
 * project. The Server Action wrappers and the router are mocked.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, State } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);

vi.mock("@/app/actions/projects", () => ({
  archiveProjectAction: action(),
  unarchiveProjectAction: action(),
  deleteProjectAction: action(),
}));
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { ProjectFrame } = await import("@/components/work-items/ProjectFrame");

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

const actors: ActorRow[] = [{ id: USER, kind: "user", name: "Valentin", name_key: "valentin", color: "blue", client_name: null, last_seen_at: null, ...audit }];

function frame(overrides: Partial<Project> = {}) {
  const bundle: ProjectBundle = { project: { ...project, ...overrides }, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-17" };
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  const frameProps = {} as ComponentProps<typeof ProjectFrame>;
  return createElement(ProjectProvider, providerProps, createElement(ProjectFrame, frameProps, createElement("output", { "data-testid": "page" })));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(pathname: string, overrides: Partial<Project> = {}) {
  nav.pathname = pathname;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(frame(overrides));
  });
  return container;
}

/** The link tabs as [value, selected]: a selected link tab carries aria-current. */
function tabs(el: HTMLElement): [string, boolean][] {
  return [...el.querySelectorAll<HTMLElement>(".tessera-project-tabs a[data-tab-value]")].map((tab) => [tab.dataset.tabValue ?? "", tab.getAttribute("aria-current") === "true"]);
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
});

describe("ProjectFrame", () => {
  it("puts the token, the name, the tabs and the project menu in one header row, the route's tab selected", async () => {
    const el = await render(`/projects/${PROJECT}/cycles`);
    const row = el.querySelector(".tessera-panel-bar--header");
    // PanelTitle: the page's level-1 heading, set at the working size.
    expect(row?.querySelector('h1, [aria-level="1"]')?.textContent).toBe("Website");
    expect(row?.textContent).toContain("WEB");
    expect(tabs(el)).toEqual([
      ["work-items", false],
      ["cycles", true],
      ["modules", false],
      ["archives", false],
    ]);
    expect(row?.querySelector(".tessera-panel-bar-end button[aria-label='Project actions']")).not.toBeNull();
    expect(el.querySelector(`a[href="/projects/${PROJECT}/archives"]`)).not.toBeNull();
    expect(el.textContent).not.toContain("This project is archived");
  });

  it("follows the feature toggles and keeps Archives, selecting no tab on a route that is turned off", async () => {
    const el = await render(`/projects/${PROJECT}/cycles`, { cycles_enabled: false, modules_enabled: false });
    expect(tabs(el)).toEqual([
      ["work-items", false],
      ["archives", false],
    ]);
    // The content landmark falls back to the project's name.
    expect(el.querySelector('[aria-label="Website"] [data-testid="page"]')).not.toBeNull();
  });

  it("shows an archived project's Banner under the header row, outside it", async () => {
    const el = await render(`/projects/${PROJECT}/work-items`, { archived_at: NOW });
    expect(el.textContent).toContain("This project is archived");
    const banner = [...el.querySelectorAll<HTMLElement>("*")].find((node) => node.textContent === "This project is archived" && node.children.length === 0);
    expect(banner).toBeDefined();
    expect(banner?.closest(".tessera-panel-bar")).toBeNull();
    expect(banner?.closest('[data-testid="page"]')).toBeNull();
    expect(tabs(el)[0]).toEqual(["work-items", true]);
  });
});
