// @vitest-environment jsdom
/**
 * The folding hook of the exports and webhook delivery tables
 * (src/components/workspace-settings/use-narrow-container.ts): narrow means the
 * observed element's content box is under the threshold. jsdom has no layout and
 * no ResizeObserver, so a stub reports the widths.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";

let report: (width: number) => void = () => {};
let disconnected = 0;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
    observe() {
      report = (width) => this.callback([{ contentRect: { width } }]);
    }
    disconnect() {
      disconnected += 1;
    }
  };
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function mount(minWidth: number): { narrow: () => boolean } {
  let narrow = false;
  function Probe() {
    const { ref, isNarrow } = useNarrowContainer(minWidth);
    narrow = isNarrow;
    return createElement("section", { ref });
  }
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(createElement(Probe)));
  return { narrow: () => narrow };
}

describe("useNarrowContainer", () => {
  it("starts wide (the server render) and folds under the threshold", () => {
    const probe = mount(584);
    expect(probe.narrow()).toBe(false);
    act(() => report(325));
    expect(probe.narrow()).toBe(true);
    act(() => report(584));
    expect(probe.narrow()).toBe(false);
    act(() => report(583));
    expect(probe.narrow()).toBe(true);
  });

  it("disconnects its observer on unmount", () => {
    mount(584);
    const before = disconnected;
    act(() => root?.unmount());
    root = null;
    expect(disconnected).toBeGreaterThan(before);
  });
});
