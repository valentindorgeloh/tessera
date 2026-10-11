// @vitest-environment jsdom
/**
 * Smoke test of the MarkdownEditor component (src/components/editor/
 * MarkdownEditor.tsx) rendered with react-dom/client under jsdom: the handle
 * serialises what setMarkdown loaded, external values are accepted while
 * the editor is clean, local edits block them, the source toggle keeps
 * the text, and the full-width editor offers table controls inside a table.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorProps } from "@/components/editor/MarkdownEditor";

declare global {
  // React reads this global to silence the act() warning.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the bubble menu and drag handle use it through floating-ui.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // Astryx menus (the table actions) pick their presentation from a media query.
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
  // ProseMirror measures the DOM when it mounts.
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

async function mount(props: MarkdownEditorProps): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(createElement(MarkdownEditor, props));
  });
  return { root, container };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) container.remove();
});

describe("MarkdownEditor", () => {
  it("mounts, exposes the handle and round-trips setMarkdown", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = await mount({ value: "# Hello\n\nWorld", onChange, ref, compact: true });
    expect(container.querySelector(".tessera-editor-content")).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Hello");
    expect(ref.current).not.toBeNull();
    expect(ref.current?.getMarkdown()).toBe("# Hello\n\nWorld");
    expect(ref.current?.hasLocalEdits()).toBe(false);

    await act(async () => {
      ref.current?.setMarkdown("- [ ] task\n- [x] done\n\n[WEB-1](work:WEB-1)");
    });
    expect(ref.current?.getMarkdown()).toBe("- [ ] task\n- [x] done\n\n[WEB-1](work:WEB-1)");
    expect(container.querySelector('a[href="work:WEB-1"]')?.textContent).toBe("WEB-1");
    // setMarkdown never reports a change.
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current?.hasLocalEdits()).toBe(false);
  });

  it("accepts a new value prop while clean and reports nothing", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { root } = await mount({ value: "first", onChange, ref, compact: true });
    await act(async () => {
      root.render(createElement(MarkdownEditor, { value: "second", onChange, ref, compact: true }));
    });
    expect(ref.current?.getMarkdown()).toBe("second");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the non-compact chrome (drag handle, toolbar) without throwing", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = await mount({ value: "Text", onChange: () => {}, ref });
    expect(container.querySelector(".tessera-editor-toolbar")).not.toBeNull();
    expect(container.querySelector(".tessera-editor--compact")).toBeNull();
    expect(ref.current?.getMarkdown()).toBe("Text");
  });

  it("reports the lossy serialisation once after mount", async () => {
    const onLossyParse = vi.fn();
    await mount({ value: "Bare https://example.com link", onChange: () => {}, onLossyParse, compact: true });
    expect(onLossyParse).toHaveBeenCalledTimes(1);
    expect(onLossyParse.mock.calls[0][0]).toContain("[https://example.com](https://example.com)");
  });

  it("does not report lossy for text the serialiser keeps", async () => {
    const onLossyParse = vi.fn();
    await mount({ value: "# Title\n\nPlain text.\n", onChange: () => {}, onLossyParse, compact: true });
    expect(onLossyParse).not.toHaveBeenCalled();
  });

  it("switches to source mode and back without losing the text", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    const { container } = await mount({ value: "# Title\n\nBody", onChange, ref, compact: true });
    await act(async () => {
      ref.current?.setMode("source");
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe("# Title\n\nBody");
    expect(ref.current?.getMarkdown()).toBe("# Title\n\nBody");
    await act(async () => {
      ref.current?.setMode("rich");
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(ref.current?.getMarkdown()).toBe("# Title\n\nBody");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("honours readOnly through setEditable", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const { root, container } = await mount({ value: "Text", onChange: () => {}, ref, compact: true, readOnly: true });
    expect(container.querySelector(".tessera-editor-content")?.getAttribute("contenteditable")).toBe("false");
    await act(async () => {
      root.render(createElement(MarkdownEditor, { value: "Text", onChange: () => {}, ref, compact: true, readOnly: false }));
    });
    expect(container.querySelector(".tessera-editor-content")?.getAttribute("contenteditable")).toBe("true");
  });

  it("offers table controls on the full-width editor while the selection is in a table, and none when compact", async () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const ref = createRef<MarkdownEditorHandle>();
    const onChange = vi.fn();
    // The initial selection sits in the first cell.
    const { container } = await mount({ value: table, onChange, ref });
    const below = container.querySelector<HTMLButtonElement>('button[aria-label="Insert row below"]');
    expect(below).not.toBeNull();
    for (const label of ["Insert row above", "Insert column left", "Insert column right", "More table actions"]) {
      expect(container.querySelector(`button[aria-label="${label}"]`), label).not.toBeNull();
    }
    await act(async () => {
      below?.click();
    });
    expect((ref.current?.getMarkdown().match(/^\|/gm) ?? []).length).toBe(4);
    expect(onChange).toHaveBeenCalled();

    const compact = await mount({ value: table, onChange: () => {}, compact: true });
    expect(compact.container.querySelector('button[aria-label="Insert row below"]')).toBeNull();
    const readOnly = await mount({ value: table, onChange: () => {}, readOnly: true });
    expect(readOnly.container.querySelector('button[aria-label="Insert row below"]')).toBeNull();
  });

  it("shows no table controls outside a table", async () => {
    const { container } = await mount({ value: "Text first\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", onChange: () => {} });
    expect(container.querySelector('button[aria-label="Insert row below"]')).toBeNull();
  });
});
