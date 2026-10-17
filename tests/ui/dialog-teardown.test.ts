// @vitest-environment jsdom
/**
 * Dialog and AlertDialog from src/components/shell/dialogs.tsx: Next hides the
 * route a navigation leaves under React <Activity mode="hidden">. Astryx opens
 * its native <dialog> with showModal() in an effect that has no cleanup, so a
 * raw dialog stays open (and modal) while hidden. The wrapper closes it in a
 * layout-effect cleanup and Astryx's own effect opens it again when the route
 * is shown, so the same element comes back open.
 */
import { Activity, act, createElement, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog as AstryxDialog } from "@astryxdesign/core/Dialog";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AlertDialog, Dialog } from "@/components/shell/dialogs";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The Dialog's scroll lock restores the scroll position; jsdom does not implement scrolling.
  window.scrollTo = () => {};
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
  // jsdom has no modal dialogs; showModal and close only toggle the attribute here.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
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
  root = null;
  container = null;
});

async function show(node: ReactNode) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(node);
  });
}

type Mode = "visible" | "hidden";
// children go in as the third argument; the cast covers the props object without them.
const route = (mode: Mode, page: ReactNode) => createElement(Activity, { mode } as ComponentProps<typeof Activity>, page);

const noop = () => {};
// children are a prop: Astryx requires it, and createElement's third argument does not satisfy the type.
const dialogProps = { isOpen: true, onOpenChange: noop, "aria-label": "Probe", children: createElement("p", null, "Body") } as const;
const probe = (isOpen = true) => createElement(Dialog, { ...dialogProps, isOpen });
const alertProbe = () =>
  createElement(AlertDialog, {
    isOpen: true,
    onOpenChange: noop,
    title: "Delete?",
    description: "Cannot be undone.",
    actionLabel: "Delete",
    onAction: noop,
  });
const dialogEl = () => document.querySelector<HTMLDialogElement>("dialog");

describe("dialogs wrapper under Activity", () => {
  it("baseline: a raw Astryx Dialog stays open while its route is hidden", async () => {
    const raw = createElement(AstryxDialog, dialogProps);
    await show(route("visible", raw));
    const dialog = dialogEl();
    expect(dialog?.open).toBe(true);
    await show(route("hidden", raw));
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.open).toBe(true);
  });

  it("closes an open Dialog when its route is hidden and opens the same element on show", async () => {
    await show(route("visible", probe()));
    const dialog = dialogEl();
    expect(dialog?.open).toBe(true);
    await show(route("hidden", probe()));
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.open).toBe(false);
    await show(route("visible", probe()));
    expect(dialogEl()).toBe(dialog);
    expect(dialog?.open).toBe(true);
  });

  it("does the same for an AlertDialog", async () => {
    await show(route("visible", alertProbe()));
    const dialog = dialogEl();
    expect(dialog?.open).toBe(true);
    await show(route("hidden", alertProbe()));
    expect(dialog?.open).toBe(false);
    await show(route("visible", alertProbe()));
    expect(dialog?.open).toBe(true);
  });

  it("leaves a closed Dialog closed through hide and show", async () => {
    await show(route("visible", probe(false)));
    const dialog = dialogEl();
    expect(dialog?.open).toBe(false);
    await show(route("hidden", probe(false)));
    await show(route("visible", probe(false)));
    expect(dialog?.open).toBe(false);
  });

  it("keeps a Dialog opened after the route came back working: it hides again", async () => {
    await show(route("visible", probe(false)));
    await show(route("hidden", probe(false)));
    await show(route("visible", probe(true)));
    const dialog = dialogEl();
    expect(dialog?.open).toBe(true);
    await show(route("hidden", probe(true)));
    expect(dialog?.open).toBe(false);
  });

  it("closes the dialog when it unmounts", async () => {
    await show(probe());
    const dialog = dialogEl();
    expect(dialog?.open).toBe(true);
    await show(createElement("p", null, "Elsewhere"));
    // Removed from the document with the component; the cleanup closed it first when it was still open.
    expect(dialog?.isConnected).toBe(false);
    expect(dialog?.open).toBe(false);
  });

  it("still hands the dialog element to the caller's ref", async () => {
    const objectRef = createRef<HTMLDialogElement>();
    let fromCallback: HTMLDialogElement | null = null;
    await show(createElement(Dialog, { ...dialogProps, ref: objectRef }));
    expect(objectRef.current).toBe(dialogEl());
    await show(
      createElement(Dialog, {
        ...dialogProps,
        ref: (node: HTMLDialogElement | null) => {
          fromCallback = node;
        },
      }),
    );
    expect(fromCallback).toBe(dialogEl());
  });
});
