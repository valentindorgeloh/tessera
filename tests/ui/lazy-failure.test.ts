// @vitest-environment jsdom
/**
 * A palette chunk that fails to load must not leave the app stuck (speed batch,
 * review round 1): CommandBar sets `isOpen` before the chunk is in, and while it is
 * open every shortcut is disabled. LazyPalette hands the close back when the import
 * rejects, so the shortcuts work again and the next open retries.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shell/palette-parts", () => {
  throw new Error("offline");
});

const { LazyPalette } = await import("@/components/shell/palette-lazy");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("LazyPalette", () => {
  it("closes itself when the palette chunk fails to load", async () => {
    const onOpenChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(LazyPalette, { isOpen: true, onOpenChange } as never));
    });
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(container.innerHTML).toBe("");
  });
});
