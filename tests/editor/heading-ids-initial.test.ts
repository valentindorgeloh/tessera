// @vitest-environment jsdom
/**
 * The page Outline needs heading ids at once, not after the first keystroke:
 * a MarkdownEditor mounted on a body with H1-H3 gives every heading its id
 * without reporting a change (the id is not part of the Markdown, so the page
 * must not save) and without an undo step.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
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
  if (typeof document.createRange === "function") {
    const range = document.createRange();
    if (typeof range.getClientRects !== "function") {
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  }
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) container.remove();
});

describe("heading ids on the initial content", () => {
  it("assigns unique ids to H1-H3 at mount without reporting a change", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(MarkdownEditor, { value: "# Intro\n\ntext\n\n## Setup\n\n### Intro", onChange, ref, compact: true }));
    });
    // The editor's `create` event fires on a timer.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const ids = Array.from(container.querySelectorAll("h1, h2, h3")).map((heading) => heading.id);
    expect(ids).toEqual(["intro", "setup", "intro-2"]);
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current?.hasLocalEdits()).toBe(false);
    expect(ref.current?.getMarkdown().trimEnd()).toBe("# Intro\n\ntext\n\n## Setup\n\n### Intro");
  });
});
