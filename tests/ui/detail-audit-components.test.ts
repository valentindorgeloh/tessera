// @vitest-environment jsdom
/**
 * Behaviour behind the detail lane's visual-audit fixes: a RelativeTime inside
 * a row is no tab stop and keeps its absolute time in a title (D6), the digest
 * card insets itself only above a list (D16), and the peek's resize handle goes
 * away while the panel fills its container (D13). jsdom has no layout, so the
 * panel sizes come from stubbed getBoundingClientRect.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DigestView } from "@/lib/tessera/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ai/AiStatusProvider", () => ({
  useAiStatus: () => ({ status: { available: true, model: "test" }, refresh: () => {} }),
}));

const { RelativeTime, absoluteTitle } = await import("@/components/detail/RelativeTime");
const { DigestCard } = await import("@/components/ai/DigestCard");
const { useIsPanelCapped } = await import("@/components/detail/PeekHost");

const NOW = "2026-10-11T10:00:00.000Z";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: ReactNode): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  vi.unstubAllGlobals();
});

describe("RelativeTime in a row (D6)", () => {
  it("adds no tab stop with hasTooltip={false} and keeps the absolute time in a title", async () => {
    const host = await mount(createElement(RelativeTime, { value: NOW, hasTooltip: false }));
    const time = host.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.hasAttribute("tabindex")).toBe(false);
    expect(time?.getAttribute("title")).toBe(absoluteTitle(NOW));
    expect(time?.getAttribute("title")).toMatch(/2026/);
    expect(time?.getAttribute("datetime")).toBe(NOW);
  });

  it("keeps the focusable hover card by default (Created and Updated in the rail)", async () => {
    const host = await mount(createElement(RelativeTime, { value: NOW }));
    const time = host.querySelector("time");
    expect(time?.getAttribute("tabindex")).toBe("0");
    expect(time?.hasAttribute("title")).toBe(false);
  });

  it("reads a Unix-seconds value like Timestamp does and gives nothing for a bad one", () => {
    expect(absoluteTitle(Date.parse(NOW) / 1000)).toBe(absoluteTitle(NOW));
    expect(absoluteTitle("not a date")).toBeUndefined();
  });
});

describe("DigestCard inset (D16)", () => {
  const digest: DigestView = {
    kind: "home",
    entity_id: "workspace",
    body_md: "Two items moved to Done.",
    input_seq: 1,
    model: "test",
    created_at: NOW,
    is_stale: false,
  };

  it("insets above a list by default (inbox, cycle, module)", async () => {
    const host = await mount(createElement(DigestCard, { kind: "inbox", id: "a1", digest }));
    const card = host.querySelector(".tessera-ai-digest");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("tessera-ai-digest--inset")).toBe(true);
  });

  it("fills its column with inset none (Home, Analytics)", async () => {
    const host = await mount(createElement(DigestCard, { kind: "home", id: "workspace", digest, inset: "none" }));
    const card = host.querySelector(".tessera-ai-digest");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("tessera-ai-digest--inset")).toBe(false);
  });
});

describe("peek resize handle (D13)", () => {
  type Sizes = { panel: number; container: number };

  /** A panel inside its container with a probe element inside the panel. Child refs attach first, so sizes come from `data-width` through a stubbed getBoundingClientRect. */
  function Harness({ sizes }: { sizes: Sizes }) {
    const [isCapped, watch] = useIsPanelCapped();
    return createElement(
      "div",
      { "data-width": sizes.container },
      createElement("aside", { className: "tessera-peek-panel", "data-width": sizes.panel }, createElement("div", { ref: watch, "data-capped": String(isCapped) })),
    );
  }

  beforeAll(() => {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
      return { width: Number(this.getAttribute("data-width") ?? 0) } as DOMRect;
    };
  });

  const capped = (host: HTMLElement) => host.querySelector("[data-capped]")?.getAttribute("data-capped");

  it("reports a panel as wide as its container as capped, so the handle is dropped", async () => {
    const host = await mount(createElement(Harness, { sizes: { panel: 357, container: 357 } }));
    expect(capped(host)).toBe("true");
  });

  it("keeps the handle while the panel is narrower than its container", async () => {
    const host = await mount(createElement(Harness, { sizes: { panel: 480, container: 1172 } }));
    expect(capped(host)).toBe("false");
  });

  it("never reports capped without a layout (zero-width container)", async () => {
    const host = await mount(createElement(Harness, { sizes: { panel: 0, container: 0 } }));
    expect(capped(host)).toBe("false");
  });
});
