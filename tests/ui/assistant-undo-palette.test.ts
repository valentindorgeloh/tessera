// @vitest-environment jsdom
/**
 * Power K "Undo last assistant change" (decisions 116-117): the row is listed
 * only while an undoable batch exists, shows the batch titles, and selecting it
 * runs the undo and toasts the result. The Server Action wrappers are mocked.
 */
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandBarHandle } from "@/components/shell/CommandBar";

const toast = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({ getBatch: vi.fn(), undo: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
// Every other action wrapper (the Create project dialog's, the shortcuts') is a no-op stub.
vi.mock("@/app/actions/_run", () => ({ toolAction: () => vi.fn() }));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: vi.fn(), discardProposalsAction: vi.fn() }));
vi.mock("@/app/actions/home", () => ({}));
vi.mock("@/app/actions/maintenance", () => ({
  getUndoableAssistantBatchAction: actions.getBatch,
  undoLastAssistantBatchAction: actions.undo,
}));
vi.mock("@/components/ai/AssistantProvider", () => ({ useAssistant: () => ({ status: null, isOpen: false, open: vi.fn(), close: vi.fn(), toggle: vi.fn(), ask: vi.fn() }) }));
vi.mock("@/components/ai/CommandBarAsk", () => ({ useCommandBarAsk: () => ({ isAskShown: false, handoff: vi.fn() }) }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => toast }));
// CommandBar runs the sidebar commands through useShell(), which throws outside TesseraShell.
vi.mock("@/components/shell/TesseraShell", async () => {
  const { DEFAULT_NAV_PREFS } = await import("@/components/shell/nav-prefs");
  const noop = () => {};
  return {
    useShell: () => ({
      navPrefs: DEFAULT_NAV_PREFS,
      isNavCollapsed: false,
      isNavOpen: false,
      setNavCollapsed: noop,
      setNavView: noop,
      setNavDock: noop,
      setNavOpen: noop,
      openCommandBar: noop,
      openShortcuts: noop,
      openCreateProject: noop,
    }),
  };
});

const { CommandBar } = await import("@/components/shell/CommandBar");

const P1 = "11111111-1111-7111-8111-111111111111";
const ok = <T>(data: T) => ({ ok: true as const, data, cursor: 1 });
const BATCH = { batch_id: "b1", applied_at: "2026-10-23T10:00:00.000Z", proposal_ids: [P1], seq_from: 1, seq_to: 2, titles: ["Update work item · AIX-1 Tune the thing"] };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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
  Element.prototype.scrollIntoView ??= () => {};
  window.scrollTo = () => {};
  // jsdom has no <dialog> methods; the palette is a modal dialog.
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

beforeEach(() => {
  toast.mockReset();
  actions.getBatch.mockReset();
  actions.undo.mockReset();
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

async function openPalette(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const handle = createRef<CommandBarHandle>();
  await act(async () => {
    root?.render(createElement(CommandBar, { ref: handle }));
  });
  await act(async () => {
    handle.current?.open();
  });
}

function undoRow(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[role='option']")).find((row) => row.textContent?.includes("Undo last assistant change")) ?? null
  );
}

describe("Power K undo row", () => {
  it("is listed with the batch titles while a batch can be undone, and runs the undo on select", async () => {
    actions.getBatch.mockResolvedValue(ok(BATCH));
    actions.undo.mockResolvedValue(ok({}));
    await openPalette();
    await vi.waitFor(() => expect(undoRow()).not.toBeNull());
    expect(undoRow()?.textContent).toContain("Update work item · AIX-1 Tune the thing");

    await act(async () => {
      undoRow()?.click();
    });
    await vi.waitFor(() => expect(actions.undo).toHaveBeenCalledWith({ confirm: true }));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith({ body: "Undid 1 change" }));
  });

  it("is left out when there is nothing to undo", async () => {
    actions.getBatch.mockResolvedValue(ok(null));
    await openPalette();
    await vi.waitFor(() => expect(document.querySelectorAll("[role='option']").length).toBeGreaterThan(0));
    expect(undoRow()).toBeNull();
  });

  it("is left out when the lookup fails", async () => {
    actions.getBatch.mockRejectedValue(new Error("network"));
    await openPalette();
    await vi.waitFor(() => expect(document.querySelectorAll("[role='option']").length).toBeGreaterThan(0));
    expect(undoRow()).toBeNull();
  });
});
