// @vitest-environment jsdom
/**
 * Dialog from src/components/shell/dialogs.tsx gives focus back to the element
 * that opened it, also when the dialog holds an autofocused field that unmounts
 * on close (the New project dialog, visual audit). Astryx remembers the
 * focused element when its open effect runs, which is by then the autofocused
 * field; the wrapper keeps the last focus outside the dialog.
 */
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Dialog } from "@/components/shell/dialogs";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  // jsdom hides a closed <dialog> and then refuses to focus inside it; Astryx's styles keep it focusable in a browser, which is what lets autoFocus win the race.
  const style = document.createElement("style");
  style.textContent = "dialog:not([open]) { display: block !important; }";
  document.head.appendChild(style);
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

const noop = () => {};
// What React's autoFocus does: focus the field during the commit, before Astryx's open effect makes the dialog modal.
function AutofocusField() {
  useEffect(() => document.getElementById("field")?.focus(), []);
  return createElement("input", { id: "field", "aria-label": "Name" });
}
// children are a prop: Astryx requires it, and createElement's third argument does not satisfy the type.
const dialogProps = (isOpen: boolean) => ({ isOpen, onOpenChange: noop, "aria-label": "Probe", children: isOpen ? createElement(AutofocusField) : null }) as const;
// The form mounts only while open, like CreateProjectDialog, with an autofocused field.
const screen = (isOpen: boolean) =>
  createElement("div", null, [
    createElement("button", { key: "trigger", id: "opener", type: "button" }, "Open"),
    createElement("button", { key: "other", id: "other", type: "button" }, "Other"),
    createElement(Dialog, { key: "dialog", ...dialogProps(isOpen) }),
  ]);

describe("dialog focus return", () => {
  it("returns focus to the opener when the autofocused field unmounts on close", async () => {
    await show(screen(false));
    const opener = document.getElementById("opener") as HTMLButtonElement;
    await act(async () => {
      opener.focus();
    });
    await show(screen(true));
    expect(document.activeElement?.id).toBe("field");
    await show(screen(false));
    expect(document.activeElement).toBe(opener);
  });

  it("does not move focus on a mount where the dialog was never open", async () => {
    await show(screen(false));
    const other = document.getElementById("other") as HTMLButtonElement;
    await act(async () => {
      other.focus();
    });
    await show(screen(false));
    expect(document.activeElement).toBe(other);
  });
});
