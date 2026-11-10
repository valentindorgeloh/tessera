// @vitest-environment jsdom
/**
 * Save queue of the page body editor (src/components/pages/PageBodyEditor.tsx):
 * the body save is quiet, and a blur, mod+s or unmount refreshes the page once
 * after the saves, also when the flush arrives while a save is in flight.
 * The Server Actions and the Tiptap editor are stubbed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";

const updateAction = vi.fn();
const refreshAction = vi.fn(async () => {});

type StubProps = { onChange: (markdown: string) => void; onFlush: () => void };
const stub: { props: StubProps | null } = { props: null };

vi.mock("@/app/actions/pages", () => ({ updatePageBodyAction: (input: unknown) => updateAction(input) }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: () => refreshAction() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/shared/EntryBanner", () => ({ EntryBanner: () => null }));
vi.mock("@/components/editor", () => ({
  DESCRIPTION_SAVE_DELAY_MS: 800,
  entityRoute: () => null,
  MarkdownEditor: forwardRef(function StubEditor(props: StubProps, ref) {
    stub.props = props;
    useImperativeHandle(ref, () => ({
      getMarkdown: () => "",
      setMarkdown: () => {},
      hasLocalEdits: () => false,
      isFocused: () => false,
      focus: () => {},
      setMode: () => {},
    }));
    return null;
  }),
}));

const { PageBodyEditor } = await import("@/components/pages/PageBodyEditor");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SAVE_DELAY = 800;
let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PageBodyEditor, { pageId: "page-1", text: "a", version: 1 }));
  });
}

function props(): StubProps {
  if (stub.props === null) throw new Error("editor did not render");
  return stub.props;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  updateAction.mockReset();
  refreshAction.mockClear();
  stub.props = null;
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => {
      r.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe("PageBodyEditor save queue", () => {
  it("a save does not refresh; the blur refreshes once", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    await mount();
    await act(async () => {
      props().onChange("ab");
    });
    await tick(SAVE_DELAY);
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(refreshAction).not.toHaveBeenCalled();
    await act(async () => {
      props().onFlush();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });

  it("a blur flush while a save is in flight still refreshes once when that save has landed", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    updateAction.mockImplementationOnce(() => new Promise((resolve) => (resolveSave = resolve)));
    await mount();
    await act(async () => {
      props().onChange("ab");
    });
    await tick(SAVE_DELAY);
    expect(updateAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      props().onFlush();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshAction).not.toHaveBeenCalled();
    await act(async () => {
      resolveSave({ ok: true, data: { description_version: 2 }, cursor: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });
});
