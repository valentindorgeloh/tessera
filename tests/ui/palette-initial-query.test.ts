// @vitest-environment jsdom
/**
 * The printable key typed into the top bar's search field is Power K's first
 * query. Astryx's palette re-runs its empty-query bootstrap in an effect on
 * mount, after the child effects, and that run used to wipe a query seeded by
 * `PaletteInput`'s own mount effect: the first letter was lost (fix round 6).
 * This renders the real Astryx palette with the real `PaletteInput`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import type { SearchSource, SearchableItem } from "@astryxdesign/core/Typeahead";
import { PaletteInput } from "@/components/shell/palette-parts";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const ITEMS: SearchableItem[] = [
  { id: "a", label: "Alpha" },
  { id: "q", label: "Quartz" },
];

const source: SearchSource<SearchableItem> = {
  bootstrap: () => ITEMS,
  search: (query: string) => ITEMS.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  const style = document.createElement("style");
  style.textContent = "dialog:not([open]) { display: block !important; }";
  document.head.appendChild(style);
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

/** Types into the combobox the way a key does: React's change handler reads the input event. */
function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Renders the palette into the test root; the same root re-renders it, as CommandBar does on a close. */
async function renderPalette(initialQuery: string, isOpen: boolean) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(
      createElement(CommandPalette<SearchableItem>, {
        isOpen,
        onOpenChange: () => {},
        searchSource: source,
        value: "",
        onValueChange: () => {},
        label: "Command bar",
        renderItem: (item: SearchableItem) => item.label,
        input: createElement(PaletteInput, { initialQuery, mode: "search", isAskShown: false, onModeChange: () => {} }),
      }),
    );
  });
}

/** Let the bootstrap and the seeded search settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function openWith(initialQuery: string, typedBeforeSeed?: string) {
  // Holding timers back keeps the seed's one-task wait pending until the early key has landed.
  if (typedBeforeSeed !== undefined) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await renderPalette(initialQuery, true);
  if (typedBeforeSeed !== undefined) {
    // The seed waits one task; a key that lands before it (a 0 ms burst) goes into the empty field.
    const early = document.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(early?.value).toBe("");
    await act(async () => {
      if (early) typeInto(early, typedBeforeSeed);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  }
  await settle();
  return document.querySelector<HTMLInputElement>('input[role="combobox"]');
}

describe("Power K first query", () => {
  it("keeps the key typed into the top bar search field as the query", async () => {
    const input = await openWith("q");
    expect(input?.value).toBe("q");
  });

  it("keeps a key typed into the dialog before the seed, after the seeded letter", async () => {
    const input = await openWith("q", "u");
    expect(input?.value).toBe("qu");
  });

  it("starts empty when the palette opens without a key", async () => {
    const input = await openWith("");
    expect(input?.value).toBe("");
  });

  it("does not seed a palette closed before the seed runs", async () => {
    // Astryx's modal Dialog keeps the input mounted while closed and the palette context changes on
    // close, so the seed effect runs again then. A seed armed by that run would search the closed palette.
    const search = vi.spyOn(source, "search");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await renderPalette("q", true);
    // Closed before the seed's one-task wait ends (Escape, or the help dialog after mod+/).
    await renderPalette("q", false);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    await settle();
    expect(search).not.toHaveBeenCalledWith("q");
    expect(document.querySelector<HTMLInputElement>('input[role="combobox"]')?.value).toBe("");
  });
});
