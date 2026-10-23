// @vitest-environment jsdom
/**
 * A Dialog a screen renders only while it is open (`{dialog ? <Dialog isOpen /> : null}`,
 * opened from a "..." menu row: the states, labels, actor and estimate dialogs of
 * the project settings) is unmounted on close, so Astryx's own close branch never
 * runs. The wrapper in src/components/shell/dialogs.tsx gives focus back to the
 * button that opened the menu (visual audit, settings lane).
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
function AutofocusField() {
  useEffect(() => document.getElementById("field")?.focus(), []);
  return createElement("input", { id: "field", "aria-label": "Name" });
}
const dialog = createElement(Dialog, { key: "dialog", isOpen: true, onOpenChange: noop, "aria-label": "Probe", children: createElement(AutofocusField) } as const);
const trigger = createElement("button", { key: "trigger", id: "kebab", type: "button" }, "Actions");

describe("dialog focus return when the dialog unmounts", () => {
  it("returns focus to the menu button after a menu row opened the dialog", async () => {
    // The menu is open: focus is on its row, inside role=menu.
    await show(createElement("div", null, [trigger, createElement("div", { key: "menu", role: "menu" }, createElement("button", { id: "row", role: "menuitem", type: "button" }, "Edit"))]));
    const kebab = document.getElementById("kebab") as HTMLButtonElement;
    await act(async () => {
      kebab.focus();
    });
    await act(async () => {
      (document.getElementById("row") as HTMLButtonElement).focus();
    });
    // The row click closes the menu (its row unmounts) and mounts the dialog open.
    await show(createElement("div", null, [trigger, dialog]));
    expect(document.activeElement?.id).toBe("field");
    // Escape or Cancel: the screen stops rendering the dialog.
    await show(createElement("div", null, [trigger]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(document.getElementById("kebab"));
  });

  it("leaves focus alone when the dialog unmounts and focus is already somewhere real", async () => {
    await show(createElement("div", null, [trigger, createElement("button", { key: "other", id: "other", type: "button" }, "Other")]));
    await act(async () => {
      (document.getElementById("kebab") as HTMLButtonElement).focus();
    });
    await show(createElement("div", null, [trigger, createElement("button", { key: "other", id: "other", type: "button" }, "Other"), dialog]));
    await act(async () => {
      (document.getElementById("other") as HTMLButtonElement).focus();
    });
    await show(createElement("div", null, [trigger, createElement("button", { key: "other", id: "other", type: "button" }, "Other")]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.id).toBe("other");
  });
});
