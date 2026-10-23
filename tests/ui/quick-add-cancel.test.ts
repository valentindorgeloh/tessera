// @vitest-environment jsdom
/**
 * QuickAdd's `onCancel` (src/components/work-items/QuickAdd.tsx): a host that
 * opens the input in a popover (the calendar's narrow day cells) learns when
 * the input is cancelled with Escape or left empty, and closes itself.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QuickAdd } from "@/components/work-items/QuickAdd";

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  root = null;
  document.body.replaceChildren();
});

async function mount(props: { onCancel?: () => void; onSubmit?: (name: string) => void }) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(QuickAdd, { defaultIsActive: true, label: "Add on 2026-10-22", onSubmit: props.onSubmit ?? (() => {}), onCancel: props.onCancel }));
  });
  const input = container.querySelector("input");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

describe("QuickAdd onCancel", () => {
  it("is called when Escape cancels the input", async () => {
    const onCancel = vi.fn();
    const input = await mount({ onCancel });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("is called when an empty input loses focus", async () => {
    const onCancel = vi.fn();
    const input = await mount({ onCancel });
    await act(async () => {
      input.focus();
      input.blur();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("is not needed: Escape without a host still just collapses the input", async () => {
    const input = await mount({});
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector("input")).toBeNull();
  });
});
