// @vitest-environment jsdom
/**
 * Closed surfaces render nothing (speed batch, closed surfaces): the display
 * menu, the export and shortcuts dialogs, the calendar's popovers and the Power
 * K palette mount their controls only while open. Astryx Switch and
 * SegmentedControl measure layout when they mount, even inside a hidden
 * popover or dialog, so an always-mounted body cost every page load.
 */
import { act, createElement, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { WorkItem } from "@/lib/tessera/types";
import type { CommandBarHandle } from "@/components/shell/CommandBar";
import type { ProjectBundle } from "@/components/work-items/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/app/actions/views", () => ({ saveViewSettingsAction: vi.fn(), resetViewSettingsAction: vi.fn() }));
vi.mock("@/app/actions/exports", () => ({ createExportAction: vi.fn() }));
vi.mock("@/app/actions/_run", () => ({ toolAction: () => vi.fn() }));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: vi.fn(), discardProposalsAction: vi.fn() }));
vi.mock("@/app/actions/home", () => ({}));
vi.mock("@/app/actions/maintenance", () => ({ getUndoableAssistantBatchAction: vi.fn(async () => ({ ok: true, data: null, cursor: 1 })), undoLastAssistantBatchAction: vi.fn() }));
vi.mock("@/components/ai/AssistantProvider", () => ({ useAssistant: () => ({ status: null, isOpen: false, open: vi.fn(), close: vi.fn(), toggle: vi.fn(), ask: vi.fn() }) }));
// The palette's sidebar commands read the shell's actions (decision 131); the test renders CommandBar on its own.
vi.mock("@/components/shell/TesseraShell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/shell/TesseraShell")>()),
  useShell: () => ({ setNavView: vi.fn(), setNavDock: vi.fn(), setNavCollapsed: vi.fn(), setNavOpen: vi.fn(), openCommandBar: vi.fn(), openShortcuts: vi.fn(), openCreateProject: vi.fn() }),
}));
vi.mock("@/components/ai/CommandBarAsk", () => ({ useCommandBarAsk: () => ({ isAskShown: false, handoff: vi.fn() }) }));

const { DisplayMenu } = await import("@/components/work-items/DisplayMenu");
const { ExportDialog } = await import("@/components/exports/ExportDialog");
const { ShortcutsDialog } = await import("@/components/shell/ShortcutsDialog");
const { CommandBar } = await import("@/components/shell/CommandBar");
const { CalendarLayout } = await import("@/components/work-items/CalendarLayout");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: "u", updated_by: "u", deleted_at: null };

function item(sequence: number, target: string | null): WorkItem {
  return {
    id: `00000000-0000-7000-8000-00000000000${sequence}`,
    project_id: PROJECT,
    sequence_id: sequence,
    key: `WEB-${sequence}`,
    name: `Item ${sequence}`,
    description_md: "",
    description_version: 0,
    state_id: STATE,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: target,
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
}

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB", cycles_enabled: true, modules_enabled: true, estimates_enabled: false },
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
  week_start: 1,
} as unknown as ProjectBundle;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function inProject(node: ReactNode) {
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(ProjectScope, scopeProps, node);
}

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

async function rerender(node: ReactNode) {
  await act(async () => {
    root?.render(node);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= () => {};
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
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

const switches = () => document.querySelectorAll("[role='switch']").length;
const fields = () => document.querySelectorAll("input, textarea, [role='radiogroup'], [role='switch']").length;
const buttonNamed = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name);

describe("DisplayMenu", () => {
  const props = { display: DEFAULT_DISPLAY, urlState: {}, settingsScope: { project_id: PROJECT } as never };

  it("renders no switch or selector while closed, and its controls once opened", async () => {
    await render(inProject(createElement(DisplayMenu, props)));
    expect(switches()).toBe(0);
    expect(document.querySelectorAll("[role='checkbox']").length).toBe(0);
    const trigger = buttonNamed("Display");
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.click();
    });
    expect(switches()).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Show sub-items");
    expect(document.body.textContent).toContain("Reset to defaults");
  });
});

describe("ExportDialog", () => {
  const scope = { project_id: PROJECT, filters: {}, rich_filters: null, order_by: "manual" as const };
  const dialog = (isOpen: boolean) => createElement(ExportDialog, { isOpen, onOpenChange: vi.fn(), title: "Website", scope: scope as never });

  it("renders no form field while closed, and a fresh form each time it opens", async () => {
    await render(dialog(false));
    expect(fields()).toBe(0);
    await rerender(dialog(true));
    expect(document.querySelector("input")?.getAttribute("value")).toBe("Website");
    expect(switches()).toBe(1);
    await rerender(dialog(false));
    expect(fields()).toBe(0);
  });
});

describe("ShortcutsDialog", () => {
  const dialog = (isOpen: boolean) => createElement(ShortcutsDialog, { isOpen, onOpenChange: vi.fn(), singleKeys: true });

  it("renders no switch or shortcut row while closed, and keeps its accessible name", async () => {
    await render(dialog(false));
    expect(switches()).toBe(0);
    expect(document.querySelectorAll("[role='listitem'], li").length).toBe(0);
    await rerender(dialog(true));
    expect(switches()).toBe(1);
    expect(document.body.textContent).toContain("Collapse or expand the sidebar");
    expect(document.querySelector("dialog")?.getAttribute("aria-label")).toBe("Keyboard shortcuts");
  });
});

describe("CommandBar", () => {
  it("renders no palette until the first open, then keeps it mounted", async () => {
    const handle = createRef<CommandBarHandle>();
    await render(createElement(CommandBar, { ref: handle }));
    expect(document.querySelector("[role='combobox']")).toBeNull();
    const before = document.querySelectorAll("dialog").length; // the Create project and shortcuts dialogs

    await act(async () => {
      handle.current?.open("ab");
    });
    await vi.waitFor(() => expect(document.querySelector("[role='combobox']")).not.toBeNull());
    expect(document.querySelectorAll("dialog").length).toBe(before + 1);
    // The palette module loads on demand, so the open can land before it: the typed key is kept and seeded once the palette mounts.
    await vi.waitFor(() => expect((document.querySelector("[role='combobox']") as HTMLInputElement).value).toBe("ab"));
    expect(document.activeElement).toBe(document.querySelector("[role='combobox']"));

    // Close from outside the palette (the help dialog takes over): the palette element stays.
    await act(async () => {
      handle.current?.openHelp();
    });
    expect(document.querySelectorAll("dialog").length).toBe(before + 1); // still mounted behind the help dialog
    await act(async () => {
      handle.current?.open();
    });
    await vi.waitFor(() => expect((document.querySelector("[role='combobox']") as HTMLInputElement | null)?.value).toBe(""));
  });
});

describe("CalendarLayout popovers", () => {
  const items = [1, 2, 3, 4, 5, 6].map((n) => item(n, "2026-10-17")).concat(item(7, null));
  const calendar = () =>
    inProject(
      createElement(CalendarLayout, {
        result: { items, total: items.length, cursor: 1, relations: [] },
        display: DEFAULT_DISPLAY,
        bundle,
        onMove: vi.fn(),
        onUpdate: vi.fn(),
        onOpen: vi.fn(),
        readOnly: false,
      }),
    );
  const popoverRows = () => document.querySelectorAll(".tessera-cal-more").length;
  const dateInputs = () => document.querySelectorAll("[aria-label='Move to date'], input[aria-label='Move to date']").length;

  it("mounts the unscheduled list, the overflow list and the move picker only while their popover is open", async () => {
    await render(calendar());
    expect(popoverRows()).toBe(0);
    expect(dateInputs()).toBe(0);

    await act(async () => {
      buttonNamed("1 unscheduled")?.click();
    });
    expect(popoverRows()).toBe(1);
    await act(async () => {
      buttonNamed("1 unscheduled")?.click();
    });
    expect(popoverRows()).toBe(0);

    await act(async () => {
      buttonNamed("+2 more")?.click();
    });
    expect(popoverRows()).toBe(1);
  });
});
