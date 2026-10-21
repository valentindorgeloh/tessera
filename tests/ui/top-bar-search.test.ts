// @vitest-environment jsdom
/**
 * The top bar's search field (src/components/shell/TopBar.tsx `SearchTrigger`,
 * docs/contracts/ui.md "Shell"): at its full width it shows the long
 * placeholder and the ⌘K chip; below 600px (the drawer's search at 375px) the
 * chip is left out and the placeholder reads "Search", so it no longer clips to
 * "Search v…" in a 47px input. The shell and assistant contexts are mocked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shell/TesseraShell", () => ({ useShell: () => ({}) }));
vi.mock("@/components/ai/AssistantProvider", () => ({ useAssistant: () => ({ status: null, toggle: () => {} }) }));

const { SearchTrigger } = await import("@/components/shell/TopBar");

const media = { narrow: false };
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("max-width: 599px") ? media.narrow : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function render(narrow: boolean) {
  media.narrow = narrow;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SearchTrigger, { onOpen: () => {} }));
  });
  return container;
}

describe("SearchTrigger", () => {
  it("shows the long placeholder and the ⌘K chip at full width", async () => {
    const el = await render(false);
    expect(el.querySelector("input")?.getAttribute("placeholder")).toBe("Search work items, or type a command");
    expect(el.textContent).toMatch(/K/);
    expect(el.querySelector("kbd")).not.toBeNull();
  });

  it("reads \"Search\" with no chip below 600px", async () => {
    const el = await render(true);
    expect(el.querySelector("input")?.getAttribute("placeholder")).toBe("Search");
    expect(el.querySelector("kbd")).toBeNull();
  });
});
