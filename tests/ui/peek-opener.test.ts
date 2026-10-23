// @vitest-environment jsdom
/**
 * Opener of a side peek (src/components/detail/peek-cover.ts `useCoverFocus`, decision 11): Safari does not focus a
 * button on click, so no focus event names the row that opened the peek. The hook also records the closest control
 * under a pointer-down inside the list region, and closing the peek returns the focus to it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useCoverFocus, type CoverFocusState } from "@/components/detail/peek-cover";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let detail: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  container?.remove();
  detail?.remove();
  root = null;
  container = null;
  detail = null;
});

type HarnessProps = CoverFocusState & { detailNode: HTMLElement | null };

/** A list region with two row buttons (the second wrapped in a span) and plain text, wired like PeekHost's LayoutContent. */
function Harness({ detailNode, ...state }: HarnessProps) {
  const handlers = useCoverFocus(state, detailNode);
  return createElement(
    "div",
    { id: "region", ...handlers },
    createElement("button", { id: "row-a" }, "WEB-1"),
    createElement("button", { id: "row-b" }, createElement("span", { id: "row-b-label" }, "WEB-2")),
    createElement("p", { id: "plain" }, "Some text"),
  );
}

async function render(props: HarnessProps) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(createElement(Harness, props)));
}

/** The peek's detail, outside the list region, with a Close button as its first control. */
function mountDetail(): HTMLElement {
  detail = document.createElement("section");
  const close = document.createElement("button");
  close.textContent = "Close";
  detail.appendChild(close);
  document.body.appendChild(detail);
  return detail;
}

async function pointerDown(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const CLOSED: CoverFocusState = { isOpen: false, isModal: false, isCovering: false };
const OPEN_COVERING: CoverFocusState = { isOpen: true, isModal: false, isCovering: true };

/** Open the covering peek, check the focus moved into it, close it, and report where the focus landed. */
async function openThenClose(): Promise<Element | null> {
  const node = mountDetail();
  await render({ ...CLOSED, detailNode: null });
  await render({ ...OPEN_COVERING, detailNode: node });
  expect(node.contains(document.activeElement)).toBe(true);
  node.remove();
  detail = null;
  await render({ ...CLOSED, detailNode: null });
  return document.activeElement;
}

describe("peek opener without a focus event (Safari)", () => {
  it("returns the focus to the row that was pressed but never focused", async () => {
    await render({ ...CLOSED, detailNode: null });
    expect(document.activeElement).toBe(document.body);
    await pointerDown(el("row-a"));
    // The browser did not focus the button; only the pointer-down named it.
    expect(document.activeElement).toBe(document.body);
    expect(await openThenClose()).toBe(el("row-a"));
  });

  it("records the closest control when the pointer lands on a child of the row button", async () => {
    await render({ ...CLOSED, detailNode: null });
    await pointerDown(el("row-b-label"));
    expect(await openThenClose()).toBe(el("row-b"));
  });

  it("keeps the previous opener when the pointer lands on no control (ASSUMPTION)", async () => {
    await render({ ...CLOSED, detailNode: null });
    await pointerDown(el("row-a"));
    await pointerDown(el("plain"));
    expect(await openThenClose()).toBe(el("row-a"));
  });

  it("lets the latest press win over an earlier focus", async () => {
    await render({ ...CLOSED, detailNode: null });
    await act(async () => el("row-a").focus());
    await pointerDown(el("row-b"));
    expect(await openThenClose()).toBe(el("row-b"));
  });

  it("still remembers a focused row when no pointer was involved (keyboard)", async () => {
    await render({ ...CLOSED, detailNode: null });
    await act(async () => el("row-a").focus());
    expect(await openThenClose()).toBe(el("row-a"));
  });
});
