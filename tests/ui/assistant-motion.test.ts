// @vitest-environment jsdom
/**
 * The assistant panel's motion (src/components/ai/AssistantProvider.tsx, AssistantPanel.tsx; docs/contracts/ui.md
 * "Motion"): an open after the stored state loaded slides in (`enters`), the stored open state of a reload does not;
 * `close` plays the CSS exit on the panel element and closes when it ends, `isOpen` stays true meanwhile, a second
 * close does nothing, a toggle, an open or an ask during the exit takes it back at once, a cancelled exit closes
 * nothing, and with no panel element (or no animation) it closes at once. jsdom runs no CSS animation: `getAnimations`
 * is stubbed with a fake exit the test finishes or cancels. tests/e2e/motion-panels.spec.ts runs the real stylesheet.
 */
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_STORAGE_KEY } from "@/components/ai/assistant-store";
import type { AssistantController } from "@/components/ai/AssistantProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: vi.fn(), discardProposalsAction: vi.fn() }));
vi.mock("@/components/ai/use-assistant-stream", () => ({ streamAssist: vi.fn() }));
vi.mock("@/components/ai/AiStatusProvider", () => ({ useAiStatus: () => ({ status: { available: true, model: "fake" }, refresh: vi.fn() }) }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => vi.fn() }));

const { AssistantProvider, useAssistantController } = await import("@/components/ai/AssistantProvider");

/** The newest controller the probe rendered. */
const seen = { controller: null as AssistantController | null };
/** Whether the probe renders a panel element while the assistant is open (the shell does; the first tests have none). */
const shell = { hasPanel: true };

/** What the shell does: a panel element, registered through `setPanelElement`, while `isOpen`. */
function Probe() {
  const controller = useAssistantController();
  useEffect(() => {
    seen.controller = controller;
  });
  return controller.isOpen && shell.hasPanel ? createElement("div", { ref: controller.setPanelElement, "data-testid": "panel", className: "tessera-ai-panel tessera-motion-slide-end" }) : null;
}

/** What `getAnimations` returns for an element marked `data-exiting`: a fake exit the test settles. */
const exit = { current: null as null | { finish: () => void; cancel: () => void }, animation: null as Animation | null };
function runExit() {
  let finish!: () => void;
  let cancel!: () => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    cancel = () => reject(new DOMException("cancelled", "AbortError"));
  });
  finished.catch(() => {});
  exit.current = { finish, cancel };
  exit.animation = { animationName: "tessera-slide-out-end", finished } as unknown as Animation;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.getAnimations = function getAnimations(this: Element) {
    return this.hasAttribute("data-exiting") && exit.animation !== null ? [exit.animation] : [];
  };
});

beforeEach(() => {
  exit.current = null;
  exit.animation = null;
  shell.hasPanel = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  seen.controller = null;
  window.sessionStorage.clear();
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AssistantProvider as (props: { children: ReactNode }) => ReactNode, null, createElement(Probe)));
  });
}

const controller = () => seen.controller as AssistantController;
const panel = () => document.querySelector<HTMLElement>('[data-testid="panel"]');

/** Leaves the store closed, the way the next test expects it (the store is module state; with no panel element a close is at once). */
async function reset() {
  shell.hasPanel = false;
  await act(async () => controller().close());
  shell.hasPanel = true;
  await act(async () => {});
  expect(controller().isOpen).toBe(false);
}

describe("the stored state and the first open", () => {
  it("does not slide in for the open state that comes back after a reload, and slides in for an open after that", async () => {
    window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ open: true, width: 400 }));
    await mount();
    expect(controller().panelLoaded).toBe(true);
    expect(controller().isOpen).toBe(true);
    expect(controller().enters).toBe(false);
    // A width change keeps how the panel came.
    await act(async () => controller().setWidth(450));
    expect(controller().enters).toBe(false);

    await act(async () => controller().close()); // the probe mounted a panel element, but no animation runs here: closes at once
    await act(async () => {});
    expect(controller().isOpen).toBe(false);
    expect(controller().enters).toBe(false);
    await act(async () => controller().open());
    expect(controller().isOpen).toBe(true);
    expect(controller().enters).toBe(true);
    await act(async () => controller().setWidth(420));
    expect(controller().enters).toBe(true);
    await reset();
  });
});

describe("closing", () => {
  it("closes at once when there is no panel element", async () => {
    await mount();
    shell.hasPanel = false;
    await act(async () => controller().open());
    expect(controller().isOpen).toBe(true);
    expect(panel()).toBeNull();
    await act(async () => controller().close());
    expect(controller().isOpen).toBe(false);
  });

  it("plays the exit on the panel, stays open until it ends, then closes", async () => {
    await mount();
    await act(async () => controller().open());
    expect(panel()).not.toBeNull();
    runExit();
    await act(async () => controller().close());
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    expect(controller().isOpen).toBe(true);
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(false);
    expect(panel()).toBeNull();
  });

  it("closes at once when nothing animates (Reduce Motion, no Web Animations)", async () => {
    await mount();
    await act(async () => controller().open());
    await act(async () => controller().close());
    await act(async () => {});
    expect(controller().isOpen).toBe(false);
  });

  it("does nothing on a second close during the exit", async () => {
    await mount();
    await act(async () => controller().open());
    runExit();
    await act(async () => controller().close());
    const first = exit.current;
    await act(async () => controller().close());
    expect(controller().isOpen).toBe(true);
    await act(async () => first?.finish());
    expect(controller().isOpen).toBe(false);
  });

  it("reopens at once when toggled during the exit", async () => {
    await mount();
    await act(async () => controller().open());
    runExit();
    await act(async () => controller().close());
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    await act(async () => controller().toggle());
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
    expect(controller().isOpen).toBe(true);
    // The exit that was taken back closes nothing when it would have ended.
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(true);
    // The next toggle closes again.
    runExit();
    await act(async () => controller().toggle());
    expect(panel()?.hasAttribute("data-exiting")).toBe(true);
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(false);
  });

  it("reopens at once when opened or asked during the exit", async () => {
    await mount();
    await act(async () => controller().open());
    runExit();
    await act(async () => controller().close());
    await act(async () => controller().open());
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
    expect(controller().isOpen).toBe(true);
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(true);

    runExit();
    await act(async () => controller().close());
    await act(async () => controller().ask("What changed?"));
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(true);
    await reset();
  });

  it("closes nothing when the exit is cancelled (the panel went away), and a later close works", async () => {
    await mount();
    await act(async () => controller().open());
    runExit();
    await act(async () => controller().close());
    await act(async () => exit.current?.cancel());
    expect(controller().isOpen).toBe(true);
    expect(panel()?.hasAttribute("data-exiting")).toBe(false);
    runExit();
    await act(async () => controller().close());
    await act(async () => exit.current?.finish());
    expect(controller().isOpen).toBe(false);
  });

  it("closes nothing when the provider unmounts during the exit", async () => {
    await mount();
    await act(async () => controller().open());
    runExit();
    await act(async () => controller().close());
    const pending = exit.current;
    await act(async () => root?.unmount());
    root = null;
    await act(async () => pending?.finish());
    // Nothing threw, and the stored state still says open (the close never committed).
    expect(JSON.parse(window.localStorage.getItem(PANEL_STORAGE_KEY) ?? "{}")).toMatchObject({ open: true });
  });
});
