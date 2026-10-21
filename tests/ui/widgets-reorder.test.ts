// @vitest-environment jsdom
/**
 * Manage widgets drag reorder (src/components/home/ManageWidgetsDialog.tsx,
 * decision 105) under jsdom with the settings action mocked: a vertical row
 * drag edits the draft (the dialog's Save writes the whole list), the insertion
 * line and the dimmed row follow the drag, and a press on a row's switch or
 * menu never starts one.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { box, drag, stubRects } from "../helpers/pointer-drag-dom";

const ok = { ok: true as const, data: {}, cursor: 1 };
const mocks = vi.hoisted(() => ({ updateWorkspaceSettingsAction: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/actions/workspace-settings", () => ({ updateWorkspaceSettingsAction: mocks.updateWorkspaceSettingsAction }));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => mocks.toast }));

const { ManageWidgetsDialog } = await import("@/components/home/ManageWidgetsDialog");

const WIDGETS = [
  { widget: "since_last_visit", enabled: true },
  { widget: "quick_links", enabled: true },
  { widget: "recents", enabled: false },
  { widget: "your_work", enabled: true },
  { widget: "stickies", enabled: true },
];
const LABELS = ["Since you were last here", "Quick links", "Recent", "Your work", "Stickies"];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreRects: (() => void) | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) =>
      ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // jsdom has no modal dialogs; showModal and close only toggle the attribute here.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  mocks.updateWorkspaceSettingsAction.mockReset();
  mocks.updateWorkspaceSettingsAction.mockResolvedValue(ok);
  mocks.toast.mockReset();
  restoreRects = stubRects((el) => {
    if (el.classList.contains("tessera-widget-row")) {
      const index = rows().indexOf(el as HTMLElement);
      return index < 0 ? null : box(0, index * 50, 380, 48);
    }
    if (el.tagName === "UL" && el.querySelector(".tessera-widget-row")) return box(0, 0, 380, 250);
    return null;
  });
});

afterEach(async () => {
  restoreRects?.();
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

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".tessera-widget-row"));
}

function rowOf(label: string): HTMLElement {
  const row = rows().find((el) => (el.textContent ?? "").includes(label));
  if (!row) throw new Error(`no row ${label}`);
  return row;
}

function order(): string[] {
  return rows().map((row) => LABELS.find((label) => (row.textContent ?? "").includes(label)) ?? "?");
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(ManageWidgetsDialog, { widgets: WIDGETS, isOpen: true, onOpenChange: () => {} }));
  });
}

async function save() {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((el) => (el.textContent ?? "").trim() === "Save");
  if (!button) throw new Error("no Save button");
  await act(async () => {
    button.click();
  });
}

describe("manage widgets drag reorder", () => {
  it("lists the rows in the stored order", async () => {
    await render();
    expect(order()).toEqual(LABELS);
  });

  it("drags a row down and saves the new order", async () => {
    await render();
    // Row 0 (y 0-48) dragged to the lower half of row 3 (y 150-198): slot 4 among the other four.
    await drag(rowOf("Since you were last here"), { x: 20, y: 20 }, [{ x: 20, y: 60 }, { x: 20, y: 190 }]);
    expect(order()).toEqual(["Quick links", "Recent", "Your work", "Since you were last here", "Stickies"]);
    await save();
    expect(mocks.updateWorkspaceSettingsAction).toHaveBeenCalledWith({
      home_widgets: [
        { widget: "quick_links", enabled: true },
        { widget: "recents", enabled: false },
        { widget: "your_work", enabled: true },
        { widget: "since_last_visit", enabled: true },
        { widget: "stickies", enabled: true },
      ],
    });
  });

  it("drags a row to the top and keeps each row's switch", async () => {
    await render();
    await drag(rowOf("Recent"), { x: 20, y: 120 }, [{ x: 20, y: 60 }, { x: 20, y: 4 }]);
    expect(order()).toEqual(["Recent", "Since you were last here", "Quick links", "Your work", "Stickies"]);
    await save();
    const call = mocks.updateWorkspaceSettingsAction.mock.calls[0]?.[0] as { home_widgets: { widget: string; enabled: boolean }[] };
    expect(call.home_widgets[0]).toEqual({ widget: "recents", enabled: false });
  });

  it("marks the dragged row and the insertion line while the pointer is down", async () => {
    await render();
    await drag(rowOf("Since you were last here"), { x: 20, y: 20 }, [{ x: 20, y: 60 }, { x: 20, y: 120 }], { release: false });
    expect(rowOf("Since you were last here").className).toContain("tessera-widget-row--dragging");
    // Pointer in the upper half of "Your work" (y 150-198 -> mid 174 is past 120): the line sits before the row that follows.
    const marked = rows().filter((row) => row.className.includes("tessera-widget-row--before") || row.className.includes("tessera-widget-row--after"));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain("Recent");
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
  });

  it("does not start a drag from the switch or the reorder menu", async () => {
    await render();
    const row = rowOf("Quick links");
    const control = row.querySelector("input, button");
    if (!control) throw new Error("no control");
    await drag(control, { x: 300, y: 70 }, [{ x: 300, y: 120 }, { x: 300, y: 200 }]);
    expect(order()).toEqual(LABELS);
  });

  it("keeps the Reorder menu on every row (the keyboard path)", async () => {
    await render();
    for (const label of LABELS) expect(document.querySelector(`[aria-label="Reorder ${label}"]`)).not.toBeNull();
  });
});
