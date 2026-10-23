// @vitest-environment jsdom
/**
 * Gantt connectors and bar colour (decisions 90-92, visual audit T1, T5):
 * the connector layer is drawn in CSS pixels from the measured day column and
 * row height (no scaled viewBox), every path ends in an arrowhead marker (the
 * error colour's marker for a conflict), and a bar carries its state group and
 * the colour token the stylesheet mixes into its fill. jsdom has no layout, so
 * the day and row rectangles are stubs and the ResizeObserver reports at once.
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
  states: [{ id: STATE, name: "In progress", state_group: "started" }],
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

const DAY = 32;
const ROW = 44;

function gantt(display: Display = DEFAULT_DISPLAY): ReactNode {
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(
    ProjectScope,
    scopeProps,
    createElement(GanttLayout, { result: { items, total: items.length, cursor: 1, relations }, display, bundle, onMove: vi.fn(), onUpdate: vi.fn(), onOpen: vi.fn() }),
  );
}

async function render(node: ReactNode) {
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
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  // Reports once as soon as it observes, like the real one.
  class ImmediateObserver {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([]);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ImmediateObserver as unknown as typeof ResizeObserver;
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const box = (width: number, height: number) => ({ left: 0, width, right: width, top: 0, bottom: height, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("tessera-gantt-head-day")) return box(DAY, 20);
    if (this.classList.contains("tessera-gantt-row")) return box(1000, ROW);
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
});

describe("gantt connector layer", () => {
  it("draws in CSS pixels: the viewBox is days by day width and rows by row height", async () => {
    const el = await render(gantt());
    const svg = el.querySelector("svg.tessera-gantt-connectors");
    expect(svg).not.toBeNull();
    const days = Number((el.querySelector(".tessera-gantt") as HTMLElement).style.getPropertyValue("--tessera-gantt-days"));
    expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${days * DAY} ${items.length * ROW}`);
    expect(svg?.hasAttribute("preserveAspectRatio")).toBe(false);
  });

  it("hands the stylesheet the row count that gives the layer its height", async () => {
    const el = await render(gantt());
    expect((el.querySelector(".tessera-gantt") as HTMLElement).style.getPropertyValue("--tessera-gantt-rows")).toBe(String(items.length));
  });

  it("ends every path in an arrowhead, the conflict marker for a conflict", async () => {
    const el = await render(gantt());
    const path = el.querySelector<SVGPathElement>("path.tessera-gantt-edge");
    expect(path).not.toBeNull();
    expect(path?.hasAttribute("data-conflict")).toBe(true);
    const ref = /^url\(#(.+)\)$/.exec(path?.getAttribute("marker-end") ?? "")?.[1];
    expect(ref).toBeTruthy();
    const marker = el.ownerDocument.getElementById(ref ?? "");
    expect(marker?.tagName.toLowerCase()).toBe("marker");
    expect(marker?.hasAttribute("data-conflict")).toBe(true);
    expect(marker?.getAttribute("orient")).toBe("auto");
    expect(marker?.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });

  it("gives each gantt its own marker ids", async () => {
    const el = await render(gantt());
    const ids = [...el.querySelectorAll("marker")].map((marker) => marker.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => !id.includes(":"))).toBe(true);
  });

  it("draws no connector layer when dependencies are hidden", async () => {
    await render(gantt({ ...DEFAULT_DISPLAY, gantt: { ...DEFAULT_DISPLAY.gantt, show_relations: false } }));
    expect(document.querySelector("svg.tessera-gantt-connectors")).toBeNull();
  });
});

describe("gantt bar colour", () => {
  it("carries the state group and its colour token", async () => {
    const el = await render(gantt());
    const bar = el.querySelector<HTMLElement>('.tessera-gantt-bar[aria-label^="WEB-3 "]');
    expect(bar?.getAttribute("data-state-group")).toBe("started");
    expect(bar?.style.getPropertyValue("--tessera-bar-color")).toBe("var(--color-accent)");
  });

  it("names the bar's label so the stylesheet can stick and hide it", async () => {
    const el = await render(gantt());
    expect(el.querySelectorAll(".tessera-gantt-bar .tessera-gantt-bar-label")).toHaveLength(items.length);
  });
});
