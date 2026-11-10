// @vitest-environment jsdom
/**
 * Keys typed while the palette chunk is still arriving are kept (speed batch, browser check): the
 * palette opens before its code is in, and a key pressed in that window used to go nowhere (Meta+K
 * then "wik" opened the palette with "ik"). LazyPalette keeps the printable keys and Backspace
 * until the module resolves, then mounts the palette with the opening's query plus those keys.
 * The module here is held back by a gate, so every test below runs "before the chunk arrived";
 * the last one runs after the gate opened and checks no key is taken any more.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
});

vi.mock("@/components/shell/palette-parts", async () => {
  await gate.promise;
  const { createElement: h } = await import("react");
  return { PalettePanel: (props: { initialQuery: string }) => h("output", { "data-testid": "palette" }, props.initialQuery) };
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

async function mount(props: { isOpen: boolean; initialQuery: string; onOpenChange?: (isOpen: boolean) => void }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(LazyPalette, { onOpenChange: () => undefined, ...props } as never));
  });
}

/** One key press as the browser delivers it: a cancelable keydown that bubbles from the focused element. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

async function releaseModule() {
  await act(async () => {
    gate.release();
    // The import resolves over a few macrotasks; the store notifies React when it lands.
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The module store is shared by the whole file and the gate opens once, so the tests that need the chunk
// to be missing come first and the one that opens it comes last.
describe("LazyPalette keys before the module is in", () => {
  it("passes every key that is not text", async () => {
    await mount({ isOpen: true, initialQuery: "" });
    expect(press("k", { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("a", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press("a", { altKey: true }).defaultPrevented).toBe(false);
    for (const key of ["ArrowDown", "Enter", "Tab", "Dead", "Process"]) expect(press(key).defaultPrevented).toBe(false);
  });

  it("takes no key while the palette is closed", async () => {
    await mount({ isOpen: false, initialQuery: "" });
    expect(press("w").defaultPrevented).toBe(false);
    expect(press("Backspace").defaultPrevented).toBe(false);
  });

  it("closes the opening on Escape", async () => {
    const onOpenChange = vi.fn();
    await mount({ isOpen: true, initialQuery: "", onOpenChange });
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("mounts the palette with the opening's query plus the keys typed meanwhile, and takes no key after", async () => {
    await mount({ isOpen: true, initialQuery: "q" });
    expect(container?.innerHTML).toBe("");
    for (const key of ["w", "i", "k"]) expect(press(key).defaultPrevented).toBe(true);
    // Backspace takes back the last kept character.
    expect(press("Backspace").defaultPrevented).toBe(true);
    press("i");
    press(" ");
    press("X", { shiftKey: true });
    await releaseModule();
    expect(container?.querySelector("[data-testid=palette]")?.textContent).toBe("qwii X");
    // The module is in: the palette owns the keys now.
    expect(press("a").defaultPrevented).toBe(false);
    expect(press("Backspace").defaultPrevented).toBe(false);
    expect(container?.querySelector("[data-testid=palette]")?.textContent).toBe("qwii X");
  });
});
