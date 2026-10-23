// @vitest-environment jsdom
/**
 * Nested dialogs and the focus fallback in src/components/shell/dialogs.tsx
 * (guarded in a browser by tests/e2e/coverage-dialogs.spec.ts, "after Save draft,
 * focus returns to the button that opened the create dialog"). The "Save this
 * draft?" dialog remembers a field of the create dialog as its opener. After
 * "Save draft" both dialogs close and that field unmounts with the create
 * dialog, so restoreFocus falls back to the last element focused outside any
 * dialog: the button that opened the create dialog. The inner dialog sits either
 * beside the outer one (CreateWorkItemDialog renders SaveDraftDialog as a
 * sibling) or inside it as a child.
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
  // jsdom hides a closed <dialog> and then refuses to focus inside it; Astryx's styles keep it focusable in a browser.
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
// Children travel as a prop because Astryx's types require them and createElement's rest arguments do not satisfy that.
const dialogProps = (isOpen: boolean, label: string, children: ReactNode) => ({ isOpen, onOpenChange: noop, "aria-label": label, children }) as const;

/** The create dialog's Name field: autofocused, and gone when the dialog closes. */
function NameField() {
  useEffect(() => document.getElementById("name")?.focus(), []);
  return createElement("input", { id: "name", "aria-label": "Name" });
}

/** What Astryx does for the "Save this draft?" dialog: focus its first button as it opens. */
function SaveDraftButtons() {
  useEffect(() => document.getElementById("save-draft")?.focus(), []);
  return createElement(
    "div",
    null,
    createElement("button", { id: "save-draft", type: "button" }, "Save draft"),
    createElement("button", { id: "keep-editing", type: "button" }, "Keep editing"),
  );
}

type Layout = "sibling" | "child" | "child-mounted-while-open";

/** The inner dialog. `child-mounted-while-open` renders it only while it is open, so closing the outer dialog unmounts it open. */
function inner(isOpen: boolean, layout: Layout): ReactNode {
  if (layout === "child-mounted-while-open" && !isOpen) return null;
  return createElement(Dialog, { key: "inner", ...dialogProps(isOpen, "Save this draft?", isOpen ? createElement(SaveDraftButtons) : null) });
}

function screen(state: { outer: boolean; inner: boolean }, layout: Layout) {
  const field = state.outer ? createElement(NameField, { key: "field" }) : null;
  const outerDialog = createElement(Dialog, {
    key: "outer",
    ...dialogProps(state.outer, "New work item", layout === "sibling" ? field : [field, inner(state.inner, layout)]),
  });
  return createElement(
    "div",
    null,
    createElement("button", { key: "opener", id: "opener", type: "button" }, "New work item"),
    outerDialog,
    layout === "sibling" ? inner(state.inner, layout) : null,
  );
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

/** Click "New work item", type in the Name field, press Escape: the Save draft dialog is on top. */
async function openBoth(layout: Layout) {
  await show(screen({ outer: false, inner: false }, layout));
  await act(async () => el("opener").focus());
  await show(screen({ outer: true, inner: false }, layout));
  expect(document.activeElement).toBe(el("name"));
  await show(screen({ outer: true, inner: true }, layout));
  expect(document.activeElement).toBe(el("save-draft"));
}

describe.each<Layout>(["sibling", "child", "child-mounted-while-open"])("a Save draft dialog as the create dialog's %s", (layout) => {
  it("after Save draft closes both dialogs, focus returns to the button that opened the create dialog", async () => {
    await openBoth(layout);
    // The Name field and the Save draft button both leave with their dialogs; the field was the inner dialog's opener.
    await show(screen({ outer: false, inner: false }, layout));
    expect(document.getElementById("name")).toBeNull();
    expect(document.activeElement).toBe(el("opener"));
  });

  it("closing only the Save draft dialog (Keep editing) returns focus to the field it was opened from", async () => {
    // child-mounted-while-open is not reachable here in a browser without unmounting the dialog; the closed state covers the other two.
    if (layout === "child-mounted-while-open") return;
    await openBoth(layout);
    await show(screen({ outer: true, inner: false }, layout));
    expect(document.activeElement).toBe(el("name"));
    // Then the create dialog closes too: still the original opener.
    await show(screen({ outer: false, inner: false }, layout));
    expect(document.activeElement).toBe(el("opener"));
  });
});

/**
 * The wrapper-owned create dialog above also restores focus to its own opener, which hides the fallback: whichever
 * of the two runs first, the focus ends on the opener. Here the outer dialog is a plain element (it restores nothing),
 * so only the inner dialog's fallback to the last element focused outside any dialog can put the focus back.
 */
describe("the fallback on its own (the outer dialog restores nothing)", () => {
  function plainScreen(state: { outer: boolean; inner: boolean }, layout: "sibling" | "child") {
    const innerDialog = inner(state.inner, layout);
    const outer = state.outer
      ? createElement(
          "dialog",
          { key: "outer", open: true, "aria-label": "New work item" },
          createElement("input", { id: "name", "aria-label": "Name" }),
          layout === "child" ? innerDialog : null,
        )
      : null;
    return createElement(
      "div",
      null,
      createElement("button", { key: "opener", id: "opener", type: "button" }, "New work item"),
      outer,
      layout === "sibling" ? innerDialog : null,
    );
  }

  it.each(["sibling", "child"] as const)("with the Save draft dialog as the outer one's %s, focus lands on the opener, not <body>", async (layout) => {
    await show(plainScreen({ outer: true, inner: false }, layout));
    await act(async () => el("opener").focus());
    // The user works in the field: it is the Save draft dialog's remembered opener.
    await act(async () => el("name").focus());
    await show(plainScreen({ outer: true, inner: true }, layout));
    expect(document.activeElement).toBe(el("save-draft"));
    await show(plainScreen({ outer: false, inner: false }, layout));
    // The microtask of an unmounted-while-open dialog runs after the act above.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.getElementById("name")).toBeNull();
    expect(document.activeElement).toBe(el("opener"));
  });
});
