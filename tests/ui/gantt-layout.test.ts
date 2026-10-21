// @vitest-environment jsdom
/**
 * Gantt layout (src/components/work-items/GanttLayout.tsx) under jsdom:
 * - the Today button, the `t` hotkey and the first open centre the today line
 *   in the scroller's bar area, in every zoom (decision 90);
 * - a bar in date conflict carries the blockers' keys and end dates in an
 *   Astryx Tooltip, a hidden description its `aria-describedby` points at, and
 *   stays a focusable button (decision 92).
 * jsdom has no layout, so the scroller and the line report stub geometry.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, WorkItem } from "@/lib/tessera/types";
import type { ProjectBundle } from "@/components/work-items/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

const { GanttLayout } = await import("@/components/work-items/GanttLayout");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: "u", updated_by: "u", deleted_at: null };

function item(id: string, sequence: number, start: string | null, target: string | null): WorkItem {
  return {
    id,
    project_id: PROJECT,
    sequence_id: sequence,
    key: `WEB-${sequence}`,
    name: `Item ${sequence}`,
    description_md: "",
    description_version: 0,
    state_id: STATE,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: start,
    target_date: target,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: "a0",
    external_source: null,
    external_id: null,
    label_ids: [],
    module_ids: [],
    assignee_ids: [],
    sub_items_count: 0,
    links_count: 0,
    intake: null,
    ...audit,
  };
}

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB" },
  states: [],
  labels: [],
  cycles: [],
  modules: [],
  actors: [],
  cursor: 1,
  today: "2026-10-17",
  estimate: null,
  intake_open: 0,
  projects: [],
} as unknown as ProjectBundle;

/** WEB-1 starts Oct 2 but is blocked by WEB-2, which ends Oct 10: a conflict. WEB-3 is unrelated. */
const items = [item("a", 1, "2026-10-02", "2026-10-04"), item("b", 2, "2026-10-01", "2026-10-10"), item("c", 3, "2026-10-12", "2026-10-14")];
const relations = [{ from_id: "a", to_id: "b", type: "blocked_by" as const }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const LABEL = 256;
const LINE_X = 3000;
const VIEWPORT = 1000;
const scrolls: { left?: number; behavior?: string }[] = [];

function gantt(display: Display = DEFAULT_DISPLAY): ReactNode {
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(
    ProjectScope,
    scopeProps,
    createElement(GanttLayout, { result: { items, total: items.length, cursor: 1, relations }, display, bundle, onMove: vi.fn(), onUpdate: vi.fn(), onOpen: vi.fn() }),
  );
}

async function render(node: ReactNode) {
  container = document.createElement("div");
  container.style.overflowX = "auto";
  Object.defineProperty(container, "clientWidth", { value: VIEWPORT });
  Object.defineProperty(container, "scrollWidth", { value: 6000 });
  container.scrollTo = ((options: ScrollToOptions) => {
    scrolls.push({ left: options.left, behavior: options.behavior });
    (container as HTMLDivElement).scrollLeft = options.left ?? 0;
  }) as typeof container.scrollTo;
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
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const box = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("tessera-gantt-today")) return box(LINE_X - (container?.scrollLeft ?? 0), 1);
    if (this.classList.contains("tessera-gantt-label")) return box(0, LABEL);
    if (this === container) return box(0, VIEWPORT);
    return real.call(this);
  };
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  scrolls.length = 0;
});

/** Scroll position that puts the line at the middle of the bar area (256 + 372). */
const CENTRED = LINE_X - (LABEL + (VIEWPORT - LABEL) / 2);

describe("gantt today scroll", () => {
  it("centres the today line once on first open", async () => {
    await render(gantt());
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
  });

  it("the Today button scrolls the line back to the middle in the default month zoom", async () => {
    const el = await render(gantt());
    expect(DEFAULT_DISPLAY.gantt.zoom).toBe("month");
    el.scrollLeft = 0;
    scrolls.length = 0;
    const button = [...el.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Today");
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
  });

  it("the t hotkey does the same", async () => {
    const el = await render(gantt());
    el.scrollLeft = 0;
    scrolls.length = 0;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    });
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
  });

  it.each(["week", "quarter"] as const)("centres again when the zoom changes to %s", async (zoom) => {
    await render(gantt());
    scrolls.length = 0;
    await act(async () => {
      root?.render(gantt({ ...DEFAULT_DISPLAY, gantt: { ...DEFAULT_DISPLAY.gantt, zoom } }));
    });
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]?.left).toBe(CENTRED);
  });

  it("does not undo the reader's scroll on a plain re-render", async () => {
    await render(gantt());
    scrolls.length = 0;
    await act(async () => {
      root?.render(gantt());
    });
    expect(scrolls).toEqual([]);
  });
});

describe("gantt conflict tooltip", () => {
  const bar = (el: HTMLElement, key: string) => el.querySelector<HTMLElement>(`.tessera-gantt-bar[aria-label^="${key} "]`);

  it("describes a conflicting bar with the blocker's key and end date, for assistive technology", async () => {
    const el = await render(gantt());
    const blocked = bar(el, "WEB-1");
    expect(blocked).not.toBeNull();
    expect(blocked?.getAttribute("aria-label")).toContain("date conflict");
    expect(blocked?.getAttribute("role")).toBe("button");
    expect(blocked?.tabIndex).toBe(0);
    const ids = (blocked?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    // One description, not the text twice.
    expect(ids).toHaveLength(1);
    const text = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(text).toContain("Blocked by WEB-2, which ends 2026-10-10");
  });

  it("describes the blocker too, and leaves a bar without a conflict alone", async () => {
    const el = await render(gantt());
    const blocker = bar(el, "WEB-2");
    const ids = (blocker?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain("Blocks WEB-1, which starts 2026-10-02");
    const clear = bar(el, "WEB-3");
    expect(clear?.getAttribute("aria-label")).not.toContain("conflict");
    expect(clear?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("drops the description, and the dangling reference, when dependencies are hidden", async () => {
    const el = await render(gantt());
    expect(bar(el, "WEB-1")?.hasAttribute("aria-describedby")).toBe(true);
    await act(async () => {
      root?.render(gantt({ ...DEFAULT_DISPLAY, gantt: { ...DEFAULT_DISPLAY.gantt, show_relations: false } }));
    });
    expect(bar(el, "WEB-1")?.hasAttribute("aria-describedby")).toBe(false);
    expect(bar(el, "WEB-1")?.getAttribute("aria-label")).not.toContain("conflict");
  });
});
