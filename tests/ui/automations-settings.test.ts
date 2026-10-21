// @vitest-environment jsdom
/**
 * Automations tab of the project settings (src/components/project-settings/AutomationsSettings.tsx):
 * a switch sends only its own fields to update_project, and "Run now" reports a
 * normal run, reports a held lease (decision 28) as an info Toast without
 * touching the status, and is disabled and loading while a run is in flight.
 * The Server Action wrappers, the Toast and the router are mocked.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { AutomationStatus, Project, State } from "@/lib/tessera/types";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@astryxdesign/core/Toast")>();
  return { ...real, useToast: () => toast };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/settings/automations",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/app/actions/automations", () => ({
  getAutomationStatusAction: vi.fn(),
  runAutomationsAction: vi.fn(),
  updateAutomationSettingsAction: vi.fn(),
}));

const { ProjectProvider } = await import("@/components/work-items/project-provider");
const { AutomationsSettings, LEASE_HELD_TEXT } = await import("@/components/project-settings/AutomationsSettings");
const { getAutomationStatusAction, runAutomationsAction, updateAutomationSettingsAction } = await import("@/app/actions/automations");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const USER = "55555555-5555-7555-8555-555555555555";
const STATE_OPEN = "66666666-6666-7666-8666-666666666666";
const STATE_CANCELLED = "77777777-7777-7777-8777-777777777777";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: USER, updated_by: USER, deleted_at: null };

const states: State[] = [
  { id: STATE_OPEN, project_id: PROJECT, name: "Backlog", name_key: "backlog", description: "", color: "gray", state_group: "backlog", is_default: true, sort_order: "a0", ...audit },
  { id: STATE_CANCELLED, project_id: PROJECT, name: "Cancelled", name_key: "cancelled", description: "", color: "red", state_group: "cancelled", is_default: false, sort_order: "a1", ...audit },
];

function projectWith(overrides: Partial<Project> = {}): Project {
  return {
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
    ...overrides,
  };
}

function bundleFor(project: Project): ProjectBundle {
  return { project, states, labels: [], cycles: [], modules: [], actors: [], cursor: 1, today: "2026-10-17", estimate: null, intake_open: 0, projects: [] };
}

const status: AutomationStatus = {
  last_run_at: "2026-10-10T08:00:00.000Z",
  last_summary: null,
  next_run_at: null,
  projects: [{ project_id: PROJECT, archive_in_months: 6, close_in_months: null, close_state_id: null, due_close: 2, due_archive: 1 }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(project: Project = projectWith()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const providerProps = { bundle: bundleFor(project) } as ComponentProps<typeof ProjectProvider>;
  const node: ReactNode = createElement(ProjectProvider, providerProps, createElement(AutomationsSettings));
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.trim() === label || el.getAttribute("aria-label") === label);
  if (!button) throw new Error(`no button ${label}`);
  return button;
}

/** The switch whose (visually hidden) <label for> carries `label`. */
function switchByLabel(label: string): HTMLInputElement {
  const labelEl = [...document.querySelectorAll<HTMLLabelElement>("label")].find((el) => el.textContent?.trim() === label);
  const el = labelEl?.htmlFor ? document.getElementById(labelEl.htmlFor) : null;
  if (!(el instanceof HTMLInputElement)) throw new Error(`no switch ${label}`);
  return el;
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

beforeEach(() => {
  vi.mocked(getAutomationStatusAction).mockResolvedValue({ ok: true, data: status, cursor: 1 });
  vi.mocked(updateAutomationSettingsAction).mockResolvedValue({ ok: true, data: projectWith(), cursor: 2 });
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
  vi.clearAllMocks();
});

describe("AutomationsSettings", () => {
  it("shows the status read from get_automation_status", async () => {
    const el = await mount();
    expect(getAutomationStatusAction).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("3 items due");
    expect(el.textContent).toContain("2 to close");
    expect(el.textContent).toContain("1 to archive");
  });

  it("sends only the archive field when the auto-archive switch is turned on", async () => {
    await mount();
    await act(async () => {
      switchByLabel("Auto-archive closed work items").click();
    });
    expect(updateAutomationSettingsAction).toHaveBeenCalledTimes(1);
    expect(updateAutomationSettingsAction).toHaveBeenCalledWith({ project_id: PROJECT, archive_in_months: 6 });
  });

  it("turns auto-archive off with null months", async () => {
    await mount(projectWith({ archive_in_months: 6 }));
    await act(async () => {
      switchByLabel("Auto-archive closed work items").click();
    });
    expect(updateAutomationSettingsAction).toHaveBeenCalledWith({ project_id: PROJECT, archive_in_months: null });
  });

  it("sends the months and the default closed state when auto-close is turned on", async () => {
    await mount();
    await act(async () => {
      switchByLabel("Auto-close inactive work items").click();
    });
    expect(updateAutomationSettingsAction).toHaveBeenCalledWith({ project_id: PROJECT, close_in_months: 3, close_state_id: STATE_CANCELLED });
  });

  it("toasts the failure when a switch cannot be saved", async () => {
    vi.mocked(updateAutomationSettingsAction).mockResolvedValue({ ok: false, code: "RULE", message: "nope" });
    await mount();
    await act(async () => {
      switchByLabel("Auto-archive closed work items").click();
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("Run now reports the closed and archived counts and refreshes the status", async () => {
    vi.mocked(runAutomationsAction).mockResolvedValue({
      ok: true,
      data: { ran_at: NOW, dry_run: false, lease_held: false, projects: [{ project_id: PROJECT, closed: 2, archived: 1, skipped: 0, error: null }] },
      cursor: 3,
    });
    await mount();
    await act(async () => {
      buttonByLabel("Run now").click();
    });
    expect(runAutomationsAction).toHaveBeenCalledWith({ project_id: PROJECT });
    expect(toast).toHaveBeenCalledWith({ type: "info", body: "Automations completed: 2 closed, 1 archived." });
    expect(getAutomationStatusAction).toHaveBeenCalledTimes(2);
  });

  it("Run now reports a held lease and leaves the status alone", async () => {
    vi.mocked(runAutomationsAction).mockResolvedValue({ ok: true, data: { ran_at: NOW, dry_run: false, lease_held: true, projects: [] }, cursor: 3 });
    const el = await mount();
    await act(async () => {
      buttonByLabel("Run now").click();
    });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ type: "info", body: LEASE_HELD_TEXT });
    expect(LEASE_HELD_TEXT).toMatch(/another process/);
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("completed") }));
    // The status was read once on mount and not again.
    expect(getAutomationStatusAction).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("3 items due");
  });

  it("disables Run now and shows it loading while the run is in flight", async () => {
    let finish: (value: Awaited<ReturnType<typeof runAutomationsAction>>) => void = () => {};
    vi.mocked(runAutomationsAction).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await mount();
    await act(async () => {
      buttonByLabel("Run now").click();
    });
    const running = buttonByLabel("Run now");
    expect(running.disabled).toBe(true);
    expect(running.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      running.click();
    });
    expect(runAutomationsAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ok: true, data: { ran_at: NOW, dry_run: false, lease_held: true, projects: [] }, cursor: 3 });
    });
    const done = buttonByLabel("Run now");
    expect(done.disabled).toBe(false);
    expect(done.getAttribute("aria-busy")).not.toBe("true");
  });

  it("disables Run now for an archived project", async () => {
    await mount(projectWith({ archived_at: NOW }));
    expect(buttonByLabel("Run now").disabled).toBe(true);
  });
});
