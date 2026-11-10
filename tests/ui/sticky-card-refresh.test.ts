// @vitest-environment jsdom
/**
 * Body saves of a sticky card are quiet; a blur flush, or the card closing with
 * a flush still queued, refreshes the page once after the saves that landed.
 * The Server Actions and the editor are stubbed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const updateBody = vi.fn();
const refreshAction = vi.fn(async () => {});

type StubProps = { onChange: (markdown: string) => void; onFlush: () => void };
const stub: { props: StubProps | null } = { props: null };

vi.mock("@/app/actions/shell", () => ({ refreshAction: () => refreshAction() }));
vi.mock("@/app/actions/stickies", () => ({
  updateStickyBodyAction: (input: unknown) => updateBody(input),
  updateStickyAction: vi.fn(async () => ({ ok: true })),
  deleteStickyAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/editor", () => ({
  MarkdownEditor: (props: StubProps) => {
    stub.props = props;
    return null;
  },
}));
vi.mock("@/components/project-settings/PaletteColorSelector", () => ({ PaletteColorSelector: () => null }));
vi.mock("@/components/shell/dialogs", () => ({ AlertDialog: () => null }));
vi.mock("@/components/styles/stickies.css", () => ({}));

const { StickyCard } = await import("@/components/stickies/StickyCard");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const sticky = { id: "s1", name: "Note", color: "yellow", description_md: "a" } as never;
let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(StickyCard, {
        sticky,
        registerItem: () => {},
        handlers: {} as never,
        isDragged: false,
        canMoveEarlier: false,
        canMoveLater: false,
        onStep: () => {},
      }),
    );
  });
}

function props(): StubProps {
  if (stub.props === null) throw new Error("editor did not render");
  return stub.props;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  updateBody.mockReset();
  updateBody.mockResolvedValue({ ok: true, data: {}, cursor: 1 });
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

describe("StickyCard body saves", () => {
  it("a debounced save does not refresh; the blur refreshes once", async () => {
    await mount();
    await act(async () => {
      props().onChange("ab");
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(updateBody).toHaveBeenCalledTimes(1);
    expect(refreshAction).not.toHaveBeenCalled();
    await act(async () => {
      props().onFlush();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });

  it("closing the card with a blur flush still queued refreshes once for the saves that landed", async () => {
    await mount();
    await act(async () => {
      props().onChange("ab");
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(updateBody).toHaveBeenCalledTimes(1);
    // The blur queues its flush timer (delay 0) and the card unmounts before it fires.
    const r = root;
    await act(async () => {
      props().onFlush();
      r?.unmount();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    root = null;
    expect(updateBody).toHaveBeenCalledTimes(1);
    expect(refreshAction).toHaveBeenCalledTimes(1);
  });
});
