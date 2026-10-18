// @vitest-environment jsdom
/**
 * Accessible names of the form dialogs outside the P3 planning screens (the
 * planning ones are in tests/ui/planning-a11y.test.ts). Astryx Dialog names
 * itself from its DialogHeader title only when the <dialog> element attaches;
 * these dialogs mount their form (and so the header) later, when isOpen turns
 * true, so each one carries an aria-label matching its visible title:
 * - "New work item" (CreateWorkItemDialog, opened by the project, cycle and
 *   module lists through the button, `c` and `?create=1`);
 * - "New project" (CreateProjectDialog);
 * - "Add link" and "Edit link" (the work item detail's LinksList).
 * The Server Action wrappers and the router are mocked, so no database or Next
 * runtime is involved.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { ActorRow, Project, State, WorkItemLinkRow } from "@/lib/tessera/types";

const ok = { ok: true as const, data: {}, cursor: 1 };
const action = () => vi.fn(async () => ok);

vi.mock("@/app/actions/work-items", () => ({
  createWorkItemAction: action(),
  updateWorkItemAction: action(),
  updateWorkItemDescriptionAction: action(),
  moveWorkItemAction: action(),
  deleteWorkItemAction: action(),
  setLabelsAction: action(),
  setAssigneesAction: action(),
  setModulesAction: action(),
}));
vi.mock("@/app/actions/projects", () => ({
  createProjectAction: action(),
}));
vi.mock("@/app/actions/detail", () => ({
  subscribeWorkItemAction: action(),
  unsubscribeWorkItemAction: action(),
  copyWorkItemAction: action(),
  addLinkAction: action(),
  updateLinkAction: action(),
  removeLinkAction: action(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { CreateWorkItemDialog } = await import("@/components/work-items/CreateWorkItemDialog");
const { CreateProjectDialog } = await import("@/components/projects/CreateProjectDialog");
const { LinksList } = await import("@/components/detail/LinksList");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const ITEM = "22222222-2222-7222-8222-222222222222";
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

const bundle: ProjectBundle = { project, states, labels: [], cycles: [], modules: [], actors, cursor: 1, today: "2026-10-17" };

const link: WorkItemLinkRow = { id: "link-1", work_item_id: ITEM, title: "Spec", url: "https://docs.example.com/spec", metadata: null, sort_order: "a0", ...audit };

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

/** The visible DialogHeader title of the one open <dialog>. */
function openDialogHeading(): string | null {
  const dialog = [...document.querySelectorAll("dialog")].find((entry) => entry.open);
  return dialog?.querySelector("h1, h2, h3, h4, h5, h6")?.textContent?.trim() ?? null;
}

async function clickButton(el: HTMLElement, name: string) {
  const button = [...el.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name);
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
  });
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

describe("form dialogs outside the planning screens", () => {
  it("names the new work item dialog after its title", async () => {
    await renderOpening((isOpen) => inProject(createElement(CreateWorkItemDialog, { projectId: PROJECT, isOpen, onOpenChange: noop })));
    expect(openDialogName()).toBe("New work item");
    expect(openDialogHeading()).toBe("New work item");
  });

  it("names the new project dialog after its title", async () => {
    await renderOpening((isOpen) => createElement(CreateProjectDialog, { isOpen, onOpenChange: noop }));
    expect(openDialogName()).toBe("New project");
    expect(openDialogHeading()).toBe("New project");
  });

  it("names the work item link dialog Add link when adding", async () => {
    const el = await render(inProject(createElement(LinksList, { workItemId: ITEM, links: [link] })));
    await clickButton(el, "Add link");
    expect(openDialogName()).toBe("Add link");
    expect(openDialogHeading()).toBe("Add link");
  });

  it("names the work item link dialog Edit link when editing", async () => {
    const el = await render(inProject(createElement(LinksList, { workItemId: ITEM, links: [link] })));
    // The row menu's Edit entry: open the menu, then pick the item.
    await clickButton(el, "Link options for Spec");
    const edit = [...document.querySelectorAll('[role="menuitem"]')].find((entry) => entry.textContent?.trim() === "Edit");
    expect(edit).toBeDefined();
    await act(async () => {
      (edit as HTMLElement | undefined)?.click();
    });
    expect(openDialogName()).toBe("Edit link");
    expect(openDialogHeading()).toBe("Edit link");
  });
});
