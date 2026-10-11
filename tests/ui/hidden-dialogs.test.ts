// @vitest-environment jsdom
/**
 * closeHiddenDialogs (src/components/shell/hidden-dialogs.ts): after a
 * navigation, an open <dialog> without a box (its route hidden by React
 * Activity) is closed; open dialogs that render and closed ones are left alone.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeHiddenDialogs, isRendered } from "@/components/shell/hidden-dialogs";

beforeAll(() => {
  // jsdom has no modal dialogs; showModal and close only toggle the attribute here.
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
});

afterEach(() => {
  document.body.replaceChildren();
});

function dialogIn(parent: HTMLElement, open: boolean): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  parent.append(dialog);
  if (open) dialog.showModal();
  return dialog;
}

describe("closeHiddenDialogs", () => {
  it("closes open dialogs in a hidden subtree or hidden themselves, and nothing else", () => {
    const shown = document.createElement("section");
    const hidden = document.createElement("section");
    // What <Activity mode="hidden"> does to the top host nodes of a route it hides.
    hidden.style.setProperty("display", "none", "important");
    document.body.append(shown, hidden);
    const visibleOpen = dialogIn(shown, true);
    const visibleClosed = dialogIn(shown, false);
    const insideHidden = dialogIn(hidden, true);
    const hiddenItself = dialogIn(shown, true);
    hiddenItself.style.setProperty("display", "none", "important");
    const closedInsideHidden = dialogIn(hidden, false);

    expect(closeHiddenDialogs(document)).toBe(2);
    expect(visibleOpen.open).toBe(true);
    expect(visibleClosed.open).toBe(false);
    expect(insideHidden.open).toBe(false);
    expect(hiddenItself.open).toBe(false);
    expect(closedInsideHidden.open).toBe(false);
    // Nothing left to close on the next navigation.
    expect(closeHiddenDialogs(document)).toBe(0);
  });

  it("only looks under the given root and takes a custom render test", () => {
    const outside = dialogIn(document.body, true);
    const scope = document.createElement("section");
    document.body.append(scope);
    const inside = dialogIn(scope, true);
    expect(closeHiddenDialogs(scope, () => false)).toBe(1);
    expect(inside.open).toBe(false);
    expect(outside.open).toBe(true);
  });
});

describe("isRendered", () => {
  it("is false for an element with display: none on itself or an ancestor", () => {
    const parent = document.createElement("section");
    const child = document.createElement("p");
    parent.append(child);
    document.body.append(parent);
    expect(isRendered(child)).toBe(true);
    parent.style.display = "none";
    expect(isRendered(child)).toBe(false);
    expect(isRendered(parent)).toBe(false);
  });
});
