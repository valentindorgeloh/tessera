// @vitest-environment jsdom
/**
 * Accessibility smoke test of the P3 planning pieces under jsdom:
 * - the five form dialogs carry an accessible name on the <dialog> itself
 *   (Astryx reads the DialogHeader title only when the <dialog> attaches, and
 *   these forms mount later, when isOpen turns true);
 * - an archive row's relative time is plain text, not a second tab stop
 *   inside the row's link;
 * - the detail headers' panel toggle is disabled with a reason while the peek
 *   holds the panel's place;
 * - the screens sit on the panel header building blocks (docs/contracts/ui.md
 *   "Shell" › "Panel headers"): one sub-header whose title is an h2 with its
 *   count, no second title row, Banners and dialogs outside the header.
 * The Server Action wrappers and the router are mocked, so no database or Next
 * runtime is involved.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Cycle, Link, Module, ModuleDetail, Project, State } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);

vi.mock("@/app/actions/cycles", () => ({
  createCycleAction: action(),
  updateCycleAction: action(),
  archiveCycleAction: action(),
  unarchiveCycleAction: action(),
  deleteCycleAction: action(),
  transferCycleWorkItemsAction: action(),
  addWorkItemsToCycleAction: action(),
}));
vi.mock("@/app/actions/modules", () => ({
  createModuleAction: action(),
  updateModuleAction: action(),
  setModuleMembersAction: action(),
  addModuleLinkAction: action(),
  updateModuleLinkAction: action(),
  removeModuleLinkAction: action(),
}));
// Archived projects reach the assistant actions through the delete dialog, and those import the server entry.
vi.mock("@/app/actions/ai", () => ({
  applyProposalsAction: action(),
  discardProposalsAction: action(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/cycles",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { CycleDialog } = await import("@/components/planning/CycleDialog");
const { TransferDialog } = await import("@/components/planning/TransferDialog");
const { AddExistingItemsDialog } = await import("@/components/planning/AddExistingItemsDialog");
const { ModuleDialog } = await import("@/components/planning/ModuleDialog");
const { ModuleLinks } = await import("@/components/planning/ModuleLinks");
const { ArchivedCycles } = await import("@/components/planning/ArchivedCycles");
const { CycleHeader } = await import("@/components/planning/CycleHeader");
const { CyclesScreen } = await import("@/components/planning/CyclesScreen");
const { ModulesScreen } = await import("@/components/planning/ModulesScreen");
const { ModuleHeader } = await import("@/components/planning/ModuleHeader");
const { ModuleSidePanel } = await import("@/components/planning/ModuleSidePanel");
const { ArchivedProjects } = await import("@/components/planning/ArchivedProjects");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE = "66666666-6666-7666-8666-666666666666";
const CYCLE = "77777777-7777-7777-8777-777777777777";
const MODULE = "88888888-8888-7888-8888-888888888888";
const NOW = "2026-10-11T10:00:00.000Z";

const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const project: Project = {
  id: PROJECT,
  name: "Website",
  name_key: "website",
  identifier: "WEB",
  description_md: "",
  logo: null,
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

function cycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: CYCLE,
    project_id: PROJECT,
    name: "Sprint 1",
    description_md: "",
    start_date: "2026-09-01",
    end_date: "2026-09-14",
    progress_snapshot: null,
    archived_at: null,
    sort_order: "a0",
    ...audit,
    status: "completed",
    progress: { total: 2, completed: 1, cancelled: 0 },
    open_count: 1,
    ...overrides,
  };
}

const bundle: ProjectBundle = { project, states, labels: [], cycles: [cycle()], modules: [], actors, cursor: 1, today: "2026-10-17", estimate: null, intake_open: 0, projects: [] };

const link: Link = {
  id: "link-1",
  parent_type: "module",
  module_id: MODULE,
  work_item_id: null,
  title: "Spec",
  url: "https://docs.example.com/spec",
  metadata: null,
  sort_order: "a0",
  ...audit,
};

function inProject(node: ReactNode) {
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const providerProps = { bundle } as ComponentProps<typeof ProjectProvider>;
  return createElement(ProjectProvider, providerProps, node);
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

/** Renders another tree into the current root (after `render`), so one test can compare two states. */
async function swap(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
  return container as HTMLDivElement;
}

/**
 * Renders the dialog closed, then open: the way the screens use it, and the
 * case where the <dialog> attaches before its header exists.
 */
async function renderOpening(make: (isOpen: boolean) => ReactNode) {
  const el = await render(make(false));
  await act(async () => {
    root?.render(make(true));
  });
  return el;
}

/** The accessible name of the one open <dialog>: its aria-label, or the text aria-labelledby points at. */
function openDialogName(): string | null {
  const dialogs = [...document.querySelectorAll("dialog")].filter((dialog) => dialog.open);
  expect(dialogs).toHaveLength(1);
  const dialog = dialogs[0];
  const label = dialog.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = dialog.getAttribute("aria-labelledby");
  return labelledBy ? (document.getElementById(labelledBy)?.textContent ?? null) : null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no modal dialogs; showModal and close only toggle the attribute here.
  // jsdom does not scroll; the dialogs' focus handling calls it.
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
});

const noop = () => {};

describe("planning dialogs", () => {
  it("names the new cycle dialog", async () => {
    await renderOpening((isOpen) => inProject(createElement(CycleDialog, { projectId: PROJECT, isOpen, onOpenChange: noop })));
    expect(openDialogName()).toBe("New cycle");
  });

  it("names the edit cycle dialog after the cycle", async () => {
    await renderOpening((isOpen) => inProject(createElement(CycleDialog, { projectId: PROJECT, isOpen, onOpenChange: noop, cycle: cycle({ status: "upcoming" }) })));
    expect(openDialogName()).toBe("Edit Sprint 1");
  });

  it("names the transfer dialog", async () => {
    await renderOpening((isOpen) => inProject(createElement(TransferDialog, { isOpen, onOpenChange: noop, cycle: cycle() })));
    expect(openDialogName()).toBe("Transfer open items");
  });

  it("names the add existing items dialog after its visible title", async () => {
    await renderOpening((isOpen) =>
      inProject(
        createElement(AddExistingItemsDialog, {
          isOpen,
          onOpenChange: noop,
          title: "Add work items to Sprint 1",
          target: { type: "cycle", cycle_id: CYCLE },
          candidates: [],
          onAdd: async () => true,
        }),
      ),
    );
    expect(openDialogName()).toBe("Add work items to Sprint 1");
  });

  it("names the new module dialog", async () => {
    await renderOpening((isOpen) => inProject(createElement(ModuleDialog, { projectId: PROJECT, isOpen, onOpenChange: noop })));
    expect(openDialogName()).toBe("New module");
  });

  it("names the edit module dialog", async () => {
    const editable = {
      id: MODULE,
      name: "Launch",
      description_md: "",
      status: "planned" as const,
      lead_actor_id: null,
      start_date: null,
      target_date: null,
      member_ids: [],
    };
    await renderOpening((isOpen) => inProject(createElement(ModuleDialog, { projectId: PROJECT, isOpen, onOpenChange: noop, module: editable })));
    expect(openDialogName()).toBe("Edit module");
  });

  it("names the module link dialog after its title", async () => {
    const el = await render(inProject(createElement(ModuleLinks, { moduleId: MODULE, links: [link], readOnly: false })));
    const add = [...el.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add link");
    expect(add).toBeDefined();
    await act(async () => {
      add?.click();
    });
    expect(openDialogName()).toBe("Add link");
  });
});

describe("archive rows", () => {
  it("shows the archived time as plain text inside the row link, with no tab stop of its own", async () => {
    const el = await render(inProject(createElement(ArchivedCycles, { projectId: PROJECT, cycles: [cycle({ archived_at: NOW })] })));
    const time = el.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.closest("a")).not.toBeNull();
    expect(time?.hasAttribute("tabindex")).toBe(false);
    expect(time?.hasAttribute("aria-haspopup")).toBe(false);
    expect(el.querySelectorAll("a [tabindex], a button, a a")).toHaveLength(0);
  });
});

describe("cycle header panel toggle", () => {
  const header = (isPanelOpen: boolean, isPanelBlocked: boolean) =>
    inProject(
      createElement(CycleHeader, {
        projectId: PROJECT,
        cycle: cycle({ status: "current", end_date: "2026-10-20", start_date: "2026-10-01", open_count: 0 }),
        today: "2026-10-11",
        isPanelOpen,
        isPanelBlocked,
        onTogglePanel: noop,
        isEditOpen: false,
        onEditOpenChange: noop,
        onDeleted: noop,
      }),
    );

  it("is enabled and reads Hide progress while the panel shows", async () => {
    const el = await render(header(true, false));
    const toggle = el.querySelector('button[aria-label="Hide progress"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-disabled")).toBeNull();
    expect(toggle?.hasAttribute("disabled")).toBe(false);
  });

  it("is disabled and reads Show progress while the peek holds the panel's place", async () => {
    const el = await render(header(false, true));
    const toggle = el.querySelector('button[aria-label="Show progress"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-disabled") === "true" || toggle?.hasAttribute("disabled")).toBe(true);
  });
});

const noProgress = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };

function module(overrides: Partial<Module> = {}): Module {
  return {
    id: MODULE,
    project_id: PROJECT,
    name: "Launch",
    name_key: "launch",
    description_md: "",
    status: "planned",
    lead_actor_id: null,
    start_date: null,
    target_date: null,
    archived_at: null,
    sort_order: "a0",
    ...audit,
    member_ids: [],
    links_count: 0,
    progress: noProgress,
    ...overrides,
  };
}

function moduleDetail(overrides: Partial<Module> = {}): ModuleDetail {
  return {
    ...module(overrides),
    progress: { ...noProgress, by_state: {}, by_label: {}, by_assignee: {}, assignees: [], labels: [] },
    links: [],
    work_item_ids: [],
  };
}

/**
 * The panel header (a LayoutHeader labelled after the screen), the text of its
 * first row's start group and the heading there (an h4 announced at level 2:
 * `Heading level={4} accessibilityLevel={2}`).
 */
function panelHeader(el: HTMLElement, label: string) {
  const header = el.querySelector(`[aria-label="${label}"]`);
  expect(header).not.toBeNull();
  const start = header?.querySelector(".tessera-panel-bar-start") ?? null;
  return { header, start: start?.textContent ?? null, heading: start?.querySelector('[aria-level="2"]')?.textContent ?? null };
}

/** Headings announced at a level: hN without an aria-level, or any heading with that aria-level. */
function headingsAt(el: HTMLElement, level: number): Element[] {
  return [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => Number(h.getAttribute("aria-level") ?? h.tagName.slice(1)) === level);
}

describe("panel headers", () => {
  it("gives the cycles list one sub-header: the h2 with the count and New cycle, no h1", async () => {
    const cycles = [cycle({ status: "upcoming", start_date: "2026-11-01", end_date: "2026-11-14" }), cycle({ id: "c2", name: "Sprint 0" })];
    const el = await render(inProject(createElement(CyclesScreen, { projectId: PROJECT, cycles, active: null, today: "2026-10-11", createOnOpen: false })));
    const { header, start, heading } = panelHeader(el, "Cycles");
    expect(start).toBe("Cycles2");
    expect(heading).toBe("Cycles");
    expect([...(header?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim())).toContain("New cycle");
    expect(headingsAt(el, 1)).toHaveLength(0);
    // The section lists carry no heading of their own; the closed dialogs' titles are not in the page.
    expect(headingsAt(el, 2).filter((h) => h.closest("dialog") === null)).toHaveLength(1);
  });

  it("gives the modules list the same sub-header, also when it is empty", async () => {
    const el = await render(inProject(createElement(ModulesScreen, { projectId: PROJECT, modules: [], today: "2026-10-11", createOnOpen: false })));
    const { start, heading } = panelHeader(el, "Modules");
    expect(start).toBe("Modules0");
    expect(heading).toBe("Modules");
    expect(el.textContent).toContain("No modules yet");
    expect(headingsAt(el, 1)).toHaveLength(0);
  });

  it("lists modules under the sub-header with the count", async () => {
    const el = await render(inProject(createElement(ModulesScreen, { projectId: PROJECT, modules: [module()], today: "2026-10-11", createOnOpen: false })));
    expect(panelHeader(el, "Modules").start).toBe("Modules1");
    expect(el.querySelector('ul[aria-label="Modules"]')).not.toBeNull();
  });

  const cycleHeader = (overrides: Partial<Cycle>) =>
    inProject(
      createElement(CycleHeader, {
        projectId: PROJECT,
        cycle: cycle(overrides),
        today: "2026-10-11",
        isPanelOpen: false,
        onTogglePanel: noop,
        isEditOpen: false,
        onEditOpenChange: noop,
        onDeleted: noop,
      }),
    );

  it("titles the cycle detail with the cycle's h2 and keeps the read-only line under the header", async () => {
    const el = await render(cycleHeader({ status: "completed", open_count: 1 }));
    const { header, heading } = panelHeader(el, "Sprint 1");
    expect(heading).toBe("Sprint 1");
    expect(header?.querySelector('button[aria-label="Show progress"]')).not.toBeNull();
    expect(header?.textContent).not.toContain("read-only");
    expect(el.textContent).toContain("Completed cycles are read-only. Transfer the open items to keep working on them.");
  });

  it("shows an archived cycle's Banner under the header", async () => {
    const el = await render(cycleHeader({ archived_at: NOW }));
    const { header } = panelHeader(el, "Sprint 1");
    expect(header?.textContent).not.toContain("This cycle is archived");
    expect(el.textContent).toContain("This cycle is archived");
    expect(el.textContent).not.toContain("read-only");
  });

  const buttonLabels = (el: HTMLElement) => [...el.querySelectorAll("button")].map((button) => button.textContent?.trim());

  it("offers Restore on an archived cycle, and not once the project is archived too (F3.4)", async () => {
    const el = await render(cycleHeader({ archived_at: NOW }));
    expect(buttonLabels(el)).toContain("Restore");
    const readOnly = await swap(
      inProject(
        createElement(CycleHeader, {
          projectId: PROJECT,
          cycle: cycle({ archived_at: NOW }),
          today: "2026-10-11",
          isPanelOpen: false,
          onTogglePanel: noop,
          isEditOpen: false,
          onEditOpenChange: noop,
          onDeleted: noop,
          readOnly: true,
        }),
      ),
    );
    expect(readOnly.textContent).toContain("This cycle is archived");
    expect(buttonLabels(readOnly)).not.toContain("Restore");
  });

  it("keeps a completed cycle's read-only line in an archived project", async () => {
    const el = await render(
      inProject(
        createElement(CycleHeader, {
          projectId: PROJECT,
          cycle: cycle({ status: "completed", open_count: 0 }),
          today: "2026-10-11",
          isPanelOpen: false,
          onTogglePanel: noop,
          isEditOpen: false,
          onEditOpenChange: noop,
          onDeleted: noop,
          readOnly: true,
        }),
      ),
    );
    expect(el.textContent).toContain("Completed cycles are read-only.");
  });

  const moduleHeader = (overrides: Partial<Module>, readOnly = false) =>
    inProject(
      createElement(ModuleHeader, {
        projectId: PROJECT,
        module: moduleDetail(overrides),
        writer: { update: noop, setMembers: noop },
        readOnly,
        candidates: [],
        isPanelOpen: true,
        onTogglePanel: noop,
      }),
    );

  it("takes Add existing out of an active module's header in an archived project (F3.4)", async () => {
    expect(buttonLabels(await render(moduleHeader({})))).toContain("Add existing");
    const el = await swap(moduleHeader({}, true));
    expect(buttonLabels(el)).not.toContain("Add existing");
    expect(el.querySelector('dialog[aria-label="Add work items to Launch"]')).toBeNull();
  });

  it("offers Restore on an archived module, and not once the project is archived too (F3.4)", async () => {
    const el = await render(moduleHeader({ archived_at: NOW }));
    expect(buttonLabels(el)).toContain("Restore");
    const readOnly = await swap(moduleHeader({ archived_at: NOW }, true));
    expect(readOnly.textContent).toContain("This module is archived");
    expect(buttonLabels(readOnly)).not.toContain("Restore");
  });

  it("renders the module side panel's controls and links read-only in an archived project (F3.4)", async () => {
    const panel = (readOnly: boolean) => inProject(createElement(ModuleSidePanel, { module: moduleDetail({}), writer: { update: noop, setMembers: noop }, readOnly }));
    expect(buttonLabels(await render(panel(false)))).toContain("Add link");
    const el = await swap(panel(true));
    expect(buttonLabels(el)).not.toContain("Add link");
  });

  it("titles the module detail with the module's h2 and keeps the add dialog out of the header", async () => {
    const el = await render(moduleHeader({}));
    const { header, heading } = panelHeader(el, "Launch");
    expect(heading).toBe("Launch");
    expect(header?.querySelector('button[aria-label="Hide details"]')).not.toBeNull();
    const add = el.querySelector('dialog[aria-label="Add work items to Launch"]');
    expect(add).not.toBeNull();
    expect(header?.contains(add ?? null)).toBe(false);
  });

  it("shows an archived module's Banner under the header, without Add existing", async () => {
    const el = await render(moduleHeader({ status: "completed", archived_at: NOW }));
    const { header } = panelHeader(el, "Launch");
    expect(header?.textContent).not.toContain("This module is archived");
    expect(el.textContent).toContain("This module is archived");
    expect([...el.querySelectorAll("button")].map((button) => button.textContent?.trim())).not.toContain("Add existing");
  });

  it("leaves the archived projects title to the page's panel header", async () => {
    const el = await render(createElement(ArchivedProjects, { projects: [] }));
    expect(headingsAt(el, 1)).toHaveLength(0);
    expect(el.textContent).toContain("No archived projects");
  });
});
