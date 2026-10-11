// @vitest-environment jsdom
/**
 * Save queue of the description editor (src/components/editor/
 * useDescriptionSave.ts): 400 ms debounce, one request in flight,
 * compare-and-set versions, CONFLICT → "Keep mine" / "Load theirs",
 * silent accept of server text while clean, "theirs" while dirty, lossy
 * gating and the pagehide beacon. The Server Actions are mocked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";

const updateAction = vi.fn();
const refreshAction = vi.fn(async () => {});
const toast = vi.fn();

vi.mock("@/app/actions/work-items", () => ({ updateWorkItemDescriptionAction: (input: unknown) => updateAction(input) }));
vi.mock("@/app/actions/shell", () => ({ refreshAction: () => refreshAction() }));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => toast }));

const { BEACON_MARKER_KEY, BEACON_MARKER_MAX_AGE_MS, DESCRIPTION_SAVE_DELAY_MS, beaconPayload, parseBeaconMarker, renderedBeforeBeacon, useDescriptionSave } = await import(
  "@/components/editor/useDescriptionSave"
);
type Result = ReturnType<typeof useDescriptionSave>;

declare global {
  // React reads this global to silence the act() warning.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ITEM = "019505a0-7c5e-7000-8000-00000000aaaa";

type FakeEditor = MarkdownEditorHandle & { text: string; focused: boolean; local: boolean; mode: "rich" | "source" };

function fakeEditor(text: string): FakeEditor {
  const editor: FakeEditor = {
    text,
    focused: false,
    local: false,
    mode: "rich",
    getMarkdown: () => editor.text,
    setMarkdown: (markdown) => {
      editor.text = markdown;
      editor.local = false;
    },
    hasLocalEdits: () => editor.local,
    isFocused: () => editor.focused,
    focus: () => {
      editor.focused = true;
    },
    setMode: (mode) => {
      editor.mode = mode;
    },
  };
  return editor;
}

type HarnessProps = { serverText: string; serverVersion: number; editor: RefObject<MarkdownEditorHandle | null>; sinkRef: { current: Result | null } };

function Harness({ serverText, serverVersion, editor, sinkRef }: HarnessProps) {
  const result = useDescriptionSave({ workItemId: ITEM, serverText, serverVersion, editor });
  useEffect(() => {
    sinkRef.current = result;
  });
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount(props: Omit<HarnessProps, "sinkRef">): Promise<{ sink: { current: Result | null }; rerender: (next: Omit<HarnessProps, "sinkRef">) => Promise<void> }> {
  const sink: { current: Result | null } = { current: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness, { ...props, sinkRef: sink }));
  });
  return {
    sink,
    rerender: async (next) => {
      await act(async () => {
        root?.render(createElement(Harness, { ...next, sinkRef: sink }));
      });
    },
  };
}

function current(sink: { current: Result | null }): Result {
  if (sink.current === null) throw new Error("hook did not render");
  return sink.current;
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
  window.sessionStorage.clear();
  vi.useFakeTimers();
  updateAction.mockReset();
  refreshAction.mockClear();
  toast.mockClear();
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

describe("useDescriptionSave", () => {
  it("saves 400 ms after the last change with the version it read and adopts the new one", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 4 }, cursor: 10 });
    const editor = fakeEditor("hello");
    const { sink } = await mount({ serverText: "hello", serverVersion: 3, editor: { current: editor } });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 3 });

    await act(async () => {
      current(sink).onChange("hello w");
    });
    expect(current(sink).state.status).toBe("dirty");
    await tick(DESCRIPTION_SAVE_DELAY_MS - 50);
    await act(async () => {
      current(sink).onChange("hello world");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS - 50);
    // The timer restarted: nothing sent yet.
    expect(updateAction).not.toHaveBeenCalled();
    await tick(60);
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "hello world", expected_description_version: 3 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 4, conflict: null, error: null });
  });

  it("keeps one request in flight and resends a change that arrived meanwhile", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    updateAction.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    updateAction.mockResolvedValueOnce({ ok: true, data: { description_version: 6 }, cursor: 12 });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 4, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(current(sink).state.status).toBe("saving");
    await act(async () => {
      current(sink).onChange("abc");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    // Still one in flight.
    expect(updateAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst({ ok: true, data: { description_version: 5 }, cursor: 11 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updateAction).toHaveBeenCalledTimes(2);
    expect(updateAction.mock.calls[1][0]).toEqual({ work_item_id: ITEM, description_md: "abc", expected_description_version: 5 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 6 });
  });

  it("skips the send when the text equals the last saved text", async () => {
    const editor = fakeEditor("same");
    const { sink } = await mount({ serverText: "same", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("same");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(updateAction).not.toHaveBeenCalled();
    expect(current(sink).state.status).toBe("clean");
  });

  it("turns CONFLICT into the conflict state and 'Keep mine' resends with the current version", async () => {
    updateAction.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "changed", details: { id: ITEM, current_version: 7 } });
    updateAction.mockResolvedValueOnce({ ok: true, data: { description_version: 8 }, cursor: 20 });
    const editor = fakeEditor("mine");
    const { sink } = await mount({ serverText: "base", serverVersion: 2, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("mine");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(current(sink).state).toMatchObject({ status: "conflict", conflict: { current_version: 7 } });
    // Further edits do not resend while the conflict waits for the user.
    await act(async () => {
      current(sink).onChange("mine more");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(updateAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await current(sink).keepMine();
    });
    expect(updateAction).toHaveBeenCalledTimes(2);
    expect(updateAction.mock.calls[1][0]).toEqual({ work_item_id: ITEM, description_md: "mine more", expected_description_version: 7 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 8, conflict: null });
  });

  it("'Load theirs' applies the server text when it is known and refreshes when it is not", async () => {
    updateAction.mockResolvedValueOnce({ ok: false, code: "CONFLICT", message: "changed", details: { id: ITEM, current_version: 7 } });
    const editor = fakeEditor("mine");
    editor.focused = true;
    const { sink, rerender } = await mount({ serverText: "base", serverVersion: 2, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("mine");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(current(sink).state.status).toBe("conflict");
    act(() => {
      current(sink).loadTheirs();
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
    // The refresh delivers the server text through the props.
    await rerender({ serverText: "theirs", serverVersion: 7, editor: { current: editor } });
    expect(editor.text).toBe("theirs");
    expect(current(sink).state).toMatchObject({ status: "clean", version: 7, conflict: null, theirs: null });
  });

  it("accepts server text silently while clean and unfocused, and holds it as 'theirs' while dirty", async () => {
    const editor = fakeEditor("v1");
    const { sink, rerender } = await mount({ serverText: "v1", serverVersion: 1, editor: { current: editor } });
    await rerender({ serverText: "v2", serverVersion: 2, editor: { current: editor } });
    expect(editor.text).toBe("v2");
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2, theirs: null });

    await act(async () => {
      current(sink).onChange("v2 mine");
    });
    await rerender({ serverText: "v3", serverVersion: 3, editor: { current: editor } });
    expect(editor.text).toBe("v2");
    expect(current(sink).state.theirs).toEqual({ version: 3, text: "v3" });
    // The debounced save is held until the user chooses.
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(updateAction).not.toHaveBeenCalled();
    // "Keep mine" builds on the server's version.
    updateAction.mockResolvedValueOnce({ ok: true, data: { description_version: 4 }, cursor: 30 });
    await act(async () => {
      await current(sink).keepMine();
    });
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "v2 mine", expected_description_version: 3 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 4, theirs: null });
  });

  it("holds server text as 'theirs' while the editor is focused and applies it on 'Load theirs'", async () => {
    const editor = fakeEditor("v1");
    editor.focused = true;
    const { sink, rerender } = await mount({ serverText: "v1", serverVersion: 1, editor: { current: editor } });
    await rerender({ serverText: "v2", serverVersion: 2, editor: { current: editor } });
    expect(editor.text).toBe("v1");
    expect(current(sink).state.theirs).toEqual({ version: 2, text: "v2" });
    act(() => {
      current(sink).loadTheirs();
    });
    expect(editor.text).toBe("v2");
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2, theirs: null });
    expect(refreshAction).not.toHaveBeenCalled();
  });

  it("ignores its own save landing through refresh before the promise resolved", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    updateAction.mockImplementationOnce(() => new Promise((resolve) => (resolveSave = resolve)));
    const editor = fakeEditor("a");
    editor.focused = true;
    const { sink, rerender } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(current(sink).state.status).toBe("saving");
    await rerender({ serverText: "ab", serverVersion: 2, editor: { current: editor } });
    expect(current(sink).state.theirs).toBeNull();
    await act(async () => {
      resolveSave({ ok: true, data: { description_version: 2 }, cursor: 5 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2, theirs: null });
  });

  it("reports other failures as error with a toast and retries on the next edit", async () => {
    updateAction.mockResolvedValueOnce({ ok: false, code: "ARCHIVED", message: "This entity is archived and read-only" });
    updateAction.mockResolvedValueOnce({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(current(sink).state).toMatchObject({ status: "error", error: "This entity is archived and read-only" });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ type: "error" });
    await act(async () => {
      current(sink).onChange("abc");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS);
    expect(updateAction).toHaveBeenCalledTimes(2);
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2, error: null });
  });

  it("blocks saves while lossy until 'Edit anyway' or 'View source'", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    act(() => {
      current(sink).onLossyParse("a rewritten");
    });
    expect(current(sink).state.lossy).toBe("a rewritten");
    await act(async () => {
      await current(sink).flush();
    });
    expect(updateAction).not.toHaveBeenCalled();
    act(() => {
      current(sink).viewSource();
    });
    expect(editor.mode).toBe("source");
    expect(current(sink).state.lossy).toBeNull();
    act(() => {
      current(sink).onLossyParse("again");
    });
    act(() => {
      current(sink).editAnyway();
    });
    expect(current(sink).state.lossy).toBeNull();
  });

  it("flush sends right away and pagehide sends no beacon when nothing is unsaved", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    await act(async () => {
      await current(sink).flush();
    });
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "ab", expected_description_version: 1 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2 });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("the pagehide beacon carries the unsaved text and no Server Action races it", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    // Unsaved text at pagehide → beacon with the version the editor builds on.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe(`/api/work-items/${ITEM}/description`);
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({ description_md: "ab", expected_description_version: 1 });

    // The visibilitychange that follows pagehide, the debounce timer and an explicit flush stay quiet.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await current(sink).flush();
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS * 2);
    expect(updateAction).not.toHaveBeenCalled();
  });

  it("pagehide during a save sends the newer text with the in-flight text, so the route can build on that save", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    updateAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    // "ab" goes out at version 1 and is still in flight when "abc" is typed and the page goes away.
    await act(async () => {
      current(sink).onChange("ab");
      void current(sink).flush();
    });
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "ab", expected_description_version: 1 });
    await act(async () => {
      current(sink).onChange("abc");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(JSON.parse(await blob.text())).toEqual({ description_md: "abc", expected_description_version: 1, if_current_md: "ab" });
    // The marker counts the in-flight save: a page rendered with "ab" at version 2 still refreshes until it has "abc".
    const marker = parseBeaconMarker(window.sessionStorage.getItem(BEACON_MARKER_KEY));
    expect(marker).toMatchObject({ workItemId: ITEM, text: "abc", version: 2 });
    expect(renderedBeforeBeacon(marker, { workItemId: ITEM, serverText: "ab", serverVersion: 2 }, Date.now())).toBe(true);
    expect(renderedBeforeBeacon(marker, { workItemId: ITEM, serverText: "abc", serverVersion: 3 }, Date.now())).toBe(false);
    // The save returning after pagehide sends nothing more (the beacon has the text).
    await act(async () => {
      resolveSave({ ok: true, data: { description_version: 2 }, cursor: 4 });
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS * 2);
    expect(updateAction).toHaveBeenCalledTimes(1);
  });

  it("a page rendered with the in-flight save but not the beacon refreshes until the beacon's text arrives", async () => {
    window.sessionStorage.setItem(BEACON_MARKER_KEY, JSON.stringify({ workItemId: ITEM, text: "abc", version: 2, at: Date.now() }));
    const reloaded = fakeEditor("ab");
    const props = { serverText: "ab", serverVersion: 2, editor: { current: reloaded } };
    const { sink, rerender } = await mount(props);
    await tick(300);
    expect(refreshAction).toHaveBeenCalledTimes(1);
    await rerender({ ...props, serverText: "abc", serverVersion: 3 });
    expect(reloaded.text).toBe("abc");
    expect(current(sink).state).toMatchObject({ status: "clean", version: 3 });
    await tick(1500);
    expect(refreshAction).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(BEACON_MARKER_KEY)).toBeNull();
  });

  it("a page restored from the back/forward cache after a beacon refreshes and adopts the server version", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 3 }, cursor: 4 });
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const editor = fakeEditor("a");
    const props = { serverText: "a", serverVersion: 1, editor: { current: editor } };
    const { sink, rerender } = await mount(props);
    await act(async () => {
      current(sink).onChange("ab");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(refreshAction).toHaveBeenCalledTimes(1);
    // The refresh brings the beacon's text with its version: adopted silently, no Banner.
    editor.local = true;
    await rerender({ ...props, serverText: "ab", serverVersion: 2 });
    expect(current(sink).state).toMatchObject({ status: "clean", version: 2, theirs: null, conflict: null });
    // The next edit builds on that version.
    await act(async () => {
      current(sink).onChange("abc");
    });
    await tick(DESCRIPTION_SAVE_DELAY_MS + 10);
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "abc", expected_description_version: 2 });
  });

  it("on unmount during a save, sends the newer text once the save returns, on the version it returned", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    updateAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    updateAction.mockResolvedValueOnce({ ok: true, data: { description_version: 3 }, cursor: 5 });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
      void current(sink).flush();
    });
    expect(updateAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      current(sink).onChange("abc");
    });
    const r = root;
    await act(async () => {
      r?.unmount();
    });
    root = null;
    // Still one request in flight: nothing new yet.
    expect(updateAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst({ ok: true, data: { description_version: 2 }, cursor: 4 });
    });
    expect(updateAction).toHaveBeenCalledTimes(2);
    expect(updateAction).toHaveBeenLastCalledWith({ work_item_id: ITEM, description_md: "abc", expected_description_version: 2 });
  });

  it("sends a pending change on unmount", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    const r = root;
    await act(async () => {
      r?.unmount();
    });
    root = null;
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(updateAction).toHaveBeenCalledWith({ work_item_id: ITEM, description_md: "ab", expected_description_version: 1 });
  });

  it("a reload that rendered the text from before the beacon refreshes until the server has it", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { description_version: 2 }, cursor: 3 });
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    const editor = fakeEditor("a");
    const { sink } = await mount({ serverText: "a", serverVersion: 1, editor: { current: editor } });
    await act(async () => {
      current(sink).onChange("ab");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(parseBeaconMarker(window.sessionStorage.getItem(BEACON_MARKER_KEY))).toMatchObject({ workItemId: ITEM, text: "ab", version: 1 });

    // The reloaded page: the server answered before the beacon landed.
    const r = root;
    await act(async () => {
      r?.unmount();
    });
    root = null;
    const reloaded = fakeEditor("a");
    const props = { serverText: "a", serverVersion: 1, editor: { current: reloaded } };
    const next = await mount(props);
    expect(refreshAction).not.toHaveBeenCalled();
    await tick(300);
    expect(refreshAction).toHaveBeenCalledTimes(1);
    // The refresh brings the beacon's text: applied silently, the marker is settled at the next check.
    await next.rerender({ ...props, serverText: "ab", serverVersion: 2 });
    expect(reloaded.text).toBe("ab");
    expect(current(next.sink).state).toMatchObject({ status: "clean", version: 2 });
    await tick(1500);
    expect(refreshAction).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(BEACON_MARKER_KEY)).toBeNull();
  });

  it("a page rendered after the beacon landed neither refreshes nor keeps the marker", async () => {
    window.sessionStorage.setItem(BEACON_MARKER_KEY, JSON.stringify({ workItemId: ITEM, text: "ab", version: 1, at: Date.now() }));
    await mount({ serverText: "ab", serverVersion: 2, editor: { current: fakeEditor("ab") } });
    await tick(2000);
    expect(refreshAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(BEACON_MARKER_KEY)).toBeNull();
  });
});

describe("beacon payload", () => {
  it("builds on the editor's version and carries no in-flight text when nothing is in flight", () => {
    expect(beaconPayload({ latest: "ab", version: 1, inFlight: null })).toEqual({
      body: { description_md: "ab", expected_description_version: 1 },
      markerVersion: 1,
    });
  });

  it("carries the in-flight text and counts that save in the marker version", () => {
    expect(beaconPayload({ latest: "abc", version: 1, inFlight: "ab" })).toEqual({
      body: { description_md: "abc", expected_description_version: 1, if_current_md: "ab" },
      markerVersion: 2,
    });
  });
});

describe("beacon marker", () => {
  const page = { workItemId: ITEM, serverText: "a", serverVersion: 1 };
  const marker = { workItemId: ITEM, text: "ab", version: 1, at: 1_000_000 };

  it("parses only well-formed markers", () => {
    expect(parseBeaconMarker(JSON.stringify(marker))).toEqual(marker);
    expect(parseBeaconMarker(null)).toBeNull();
    expect(parseBeaconMarker("not json")).toBeNull();
    expect(parseBeaconMarker("null")).toBeNull();
    expect(parseBeaconMarker(JSON.stringify({ ...marker, version: "1" }))).toBeNull();
    expect(parseBeaconMarker(JSON.stringify({ workItemId: ITEM, text: "ab", version: 1 }))).toBeNull();
  });

  it("flags a page rendered before a recent beacon for the same item", () => {
    expect(renderedBeforeBeacon(marker, page, marker.at + 50)).toBe(true);
    // Older server versions count too (the beacon built on the version the page had).
    expect(renderedBeforeBeacon({ ...marker, version: 3 }, { ...page, serverVersion: 3 }, marker.at)).toBe(true);
  });

  it("ignores other items, settled pages, missing and expired markers", () => {
    expect(renderedBeforeBeacon(null, page, marker.at)).toBe(false);
    expect(renderedBeforeBeacon({ ...marker, workItemId: "other" }, page, marker.at)).toBe(false);
    expect(renderedBeforeBeacon(marker, { ...page, serverVersion: 2 }, marker.at)).toBe(false);
    expect(renderedBeforeBeacon(marker, { ...page, serverText: "ab" }, marker.at)).toBe(false);
    expect(renderedBeforeBeacon(marker, page, marker.at + BEACON_MARKER_MAX_AGE_MS + 1)).toBe(false);
    expect(renderedBeforeBeacon(marker, page, marker.at - 1)).toBe(false);
  });
});
