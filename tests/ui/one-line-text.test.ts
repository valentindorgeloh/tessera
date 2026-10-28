// @vitest-environment jsdom
/**
 * OneLineText (src/components/work-items/OneLineText.tsx): the list row title,
 * the table's Name and Project cells and the gantt labels. It measures nothing
 * when it mounts (Astryx 0.6.8 Text maxLines measured every Text, a forced
 * layout each) and shows the full text in a tooltip only after the mouse has
 * rested on a cut line for the tooltip delay. jsdom has no layout, so the
 * widths come from stubbed getters, which also count the measurements.
 */
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const { OneLineText } = await import("@/components/work-items/OneLineText");

const TITLE = "A very long work item title that does not fit on one line";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let scrollWidth: MockInstance<() => number>;
let clientWidth: MockInstance<() => number>;

async function render(cut: boolean) {
  scrollWidth.mockReturnValue(cut ? 600 : 200);
  clientWidth.mockReturnValue(200);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
    const props = { className: "tessera-wi-title", weight: "medium" } as ComponentProps<typeof OneLineText>;
    root?.render(createElement(OneLineText, props, TITLE));
  });
  const text = container.querySelector<HTMLElement>(".tessera-wi-title");
  if (!text) throw new Error("no text");
  return text;
}

async function pointer(target: HTMLElement, type: "pointerover" | "pointerout" | "pointerdown", pointerType = "mouse") {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, pointerId: 1 }));
  });
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const tips = () => [...document.querySelectorAll('[role="tooltip"]')].map((tip) => tip.textContent);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  vi.useFakeTimers();
  scrollWidth = vi.spyOn(Element.prototype, "scrollWidth", "get");
  clientWidth = vi.spyOn(Element.prototype, "clientWidth", "get");
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OneLineText", () => {
  it("renders the whole text with the caller's one-line class and measures nothing on mount", async () => {
    const text = await render(true);
    expect(text.textContent).toBe(TITLE);
    await wait(1000);
    expect(scrollWidth).not.toHaveBeenCalled();
    expect(clientWidth).not.toHaveBeenCalled();
    expect(tips()).toEqual([]);
  });

  it("shows the full text in a tooltip once the mouse rests on a cut line, and hides it on leave", async () => {
    const text = await render(true);
    await pointer(text, "pointerover");
    await wait(150);
    expect(tips()).toEqual([]);
    await wait(100);
    expect(scrollWidth).toHaveBeenCalledTimes(1);
    expect(tips()).toEqual([TITLE]);
    expect(text.getAttribute("aria-describedby")).toBeTruthy();
    await pointer(text, "pointerout");
    expect(tips()).toEqual([]);
    expect(text.getAttribute("aria-describedby")).toBeNull();
  });

  it("opens nothing for a line that fits", async () => {
    const text = await render(false);
    await pointer(text, "pointerover");
    await wait(300);
    expect(scrollWidth).toHaveBeenCalledTimes(1);
    expect(tips()).toEqual([]);
  });

  it("opens nothing when the mouse leaves before the delay", async () => {
    const text = await render(true);
    await pointer(text, "pointerover");
    await wait(100);
    await pointer(text, "pointerout");
    await wait(300);
    expect(scrollWidth).not.toHaveBeenCalled();
    expect(tips()).toEqual([]);
  });

  // Escape goes through Astryx's layer stack, which asks the DOM for `:popover-open`; jsdom cannot answer that, so the
  // browser check covers it (the perf report's tooltip probe).
  it("closes on a press, and opens again on the next hover", async () => {
    const text = await render(true);
    await pointer(text, "pointerover");
    await wait(250);
    expect(tips()).toEqual([TITLE]);
    await pointer(text, "pointerdown");
    expect(tips()).toEqual([]);
    await wait(300);
    expect(tips()).toEqual([]);

    await pointer(text, "pointerout");
    await pointer(text, "pointerover");
    await wait(250);
    expect(tips()).toEqual([TITLE]);
  });

  it("opens nothing for a touch", async () => {
    const text = await render(true);
    await pointer(text, "pointerover", "touch");
    await wait(300);
    expect(scrollWidth).not.toHaveBeenCalled();
    expect(tips()).toEqual([]);
  });
});
