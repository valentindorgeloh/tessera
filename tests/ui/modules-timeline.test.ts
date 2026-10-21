// @vitest-environment jsdom
/**
 * Modules timeline (src/components/planning/ModulesTimeline.tsx, decision 108)
 * under jsdom: the gantt's drag rules over `update_module`. A bar body moves
 * both dates by the same whole-day delta in one call, an edge writes only its
 * own date and never crosses the other, a click on an undated row's empty
 * track sets both dates, a failed write reverts the bar and toasts, and the
 * Today button, `t` and the first open centre the today line (decision 90).
 * jsdom has no layout: the day column is 32px wide through a stub.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { Module } from "@/lib/tessera/types";

type ActionResult = { ok: true; data: object; cursor: number } | { ok: false; code: string; message: string };
const updateModuleAction = vi.fn<(input: Record<string, unknown>) => Promise<ActionResult>>(async () => ({ ok: true, data: {}, cursor: 1 }));
const push = vi.fn();
const toast = vi.fn();

vi.mock("@/app/actions/modules", () => ({ updateModuleAction: (input: Record<string, unknown>) => updateModuleAction(input) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/modules",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => toast }));

const { ModulesTimeline } = await import("@/components/planning/ModulesTimeline");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: "u", updated_by: "u", deleted_at: null };
const TODAY = "2026-10-17";
const DAY = 32;

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB" },
  states: [],
  labels: [],
  cycles: [],
  modules: [],
  actors: [],
  cursor: 1,
  today: TODAY,
  estimate: null,
  intake_open: 0,
  projects: [],
} as unknown as ProjectBundle;

function moduleRow(id: string, name: string, start: string | null, target: string | null): Module {
  return {
    id,
    project_id: PROJECT,
    name,
    name_key: name.toLowerCase(),
    description_md: "",
    status: "planned",
    lead_actor_id: null,
    start_date: start,
    target_date: target,
    archived_at: null,
    sort_order: "a0",
    ...audit,
    member_ids: [],
    links_count: 0,
    progress: { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 } as unknown as Module["progress"],
  };
}

const launch = moduleRow("m1", "Launch", "2026-10-05", "2026-10-09");
const undated = moduleRow("m2", "Later", null, null);

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const scrolls: { left?: number; behavior?: string }[] = [];

function timeline(modules: Module[], readOnly = false): ReactNode {
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(ProjectScope, scopeProps, createElement(ModulesTimeline, { projectId: PROJECT, modules, today: TODAY, readOnly }));
}

async function render(node: ReactNode) {
  container = document.createElement("div");
  container.style.overflowX = "auto";
  Object.defineProperty(container, "clientWidth", { value: 800 });
  Object.defineProperty(container, "scrollWidth", { value: 5000 });
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
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture = () => {};
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const box = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    if (this.classList.contains("tessera-gantt-head-day")) return box(0, DAY);
    if (this.classList.contains("tessera-gantt-today")) return box(2000 - (container?.scrollLeft ?? 0), 1);
    if (this.classList.contains("tessera-gantt-label")) return box(0, 200);
    if (this === container) return box(0, 800);
    if (this.classList.contains("tessera-gantt-track")) return box(0, 5000);
    return real.call(this);
  };
});

beforeEach(() => {
  updateModuleAction.mockClear();
  updateModuleAction.mockImplementation(async () => ({ ok: true, data: {}, cursor: 1 }));
  push.mockClear();
  toast.mockClear();
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

function bar(el: HTMLElement, name: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(`.tessera-gantt-bar[aria-label^="${name},"]`);
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function pointer(type: string, target: EventTarget, clientX: number) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX }));
}

/** Presses on `target`, moves by `dx` pixels and releases. */
async function drag(target: HTMLElement, dx: number) {
  await act(async () => {
    pointer("pointerdown", target, 100);
  });
  await act(async () => {
    pointer("pointermove", window, 100 + dx);
  });
  await act(async () => {
    pointer("pointerup", window, 100 + dx);
  });
}

describe("module timeline drag", () => {
  it("moves both dates by the same whole-day delta in one update_module call", async () => {
    const el = await render(timeline([launch]));
    await drag(bar(el, "Launch"), DAY * 2 + 6);
    expect(updateModuleAction).toHaveBeenCalledTimes(1);
    expect(updateModuleAction).toHaveBeenCalledWith({ module_id: "m1", start_date: "2026-10-07", target_date: "2026-10-11" });
  });

  it("moves backwards too", async () => {
    const el = await render(timeline([launch]));
    await drag(bar(el, "Launch"), -DAY * 3);
    expect(updateModuleAction).toHaveBeenCalledWith({ module_id: "m1", start_date: "2026-10-02", target_date: "2026-10-06" });
  });

  it("writes only the start date from the start edge", async () => {
    const el = await render(timeline([launch]));
    const handle = bar(el, "Launch").querySelector<HTMLElement>('[data-edge="start"]');
    await drag(handle as HTMLElement, -DAY);
    expect(updateModuleAction).toHaveBeenCalledWith({ module_id: "m1", start_date: "2026-10-04" });
  });

  it("writes only the target date from the end edge", async () => {
    const el = await render(timeline([launch]));
    const handle = bar(el, "Launch").querySelector<HTMLElement>('[data-edge="end"]');
    await drag(handle as HTMLElement, DAY * 3);
    expect(updateModuleAction).toHaveBeenCalledWith({ module_id: "m1", target_date: "2026-10-12" });
  });

  it("clamps an edge so the start never passes the target", async () => {
    const el = await render(timeline([launch]));
    const handle = bar(el, "Launch").querySelector<HTMLElement>('[data-edge="start"]');
    await drag(handle as HTMLElement, DAY * 10);
    expect(updateModuleAction).toHaveBeenCalledWith({ module_id: "m1", start_date: "2026-10-09" });
  });

  it("ignores a press that never leaves the dead zone, and opens the module on click", async () => {
    const el = await render(timeline([launch]));
    await drag(bar(el, "Launch"), 2);
    expect(updateModuleAction).not.toHaveBeenCalled();
    await act(async () => {
      bar(el, "Launch").click();
    });
    expect(push).toHaveBeenCalledWith(`/projects/${PROJECT}/modules/m1`);
  });

  it("does not drag a read-only timeline", async () => {
    const el = await render(timeline([launch], true));
    await drag(bar(el, "Launch"), DAY * 2);
    expect(updateModuleAction).not.toHaveBeenCalled();
    expect(el.querySelector(".tessera-gantt-handle")).toBeNull();
  });

  it("shows the new dates at once and puts the old ones back, with a toast, when the write fails", async () => {
    updateModuleAction.mockImplementation(async () => ({ ok: false, code: "CONFLICT", message: "Module is locked" }));
    const el = await render(timeline([launch]));
    await drag(bar(el, "Launch"), DAY * 2);
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "Module is locked" });
    expect(bar(el, "Launch").getAttribute("aria-label")).toBe("Launch, 2026-10-05 to 2026-10-09");
  });

  it("keeps the new dates after a successful write", async () => {
    const el = await render(timeline([launch]));
    await drag(bar(el, "Launch"), DAY * 2);
    expect(bar(el, "Launch").getAttribute("aria-label")).toBe("Launch, 2026-10-07 to 2026-10-11");
  });
});

describe("module timeline scheduling", () => {
  it("sets both dates to the clicked day on an undated module", async () => {
    const el = await render(timeline([undated]));
    const track = el.querySelector<HTMLElement>(".tessera-gantt-track");
    expect(track).not.toBeNull();
    // The range starts 45 days before today (2026-09-02); the track stub starts at x = 0, so five days in is day index 5.
    await act(async () => {
      track?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: DAY * 5 + 4 }));
    });
    expect(updateModuleAction).toHaveBeenCalledTimes(1);
    const call = updateModuleAction.mock.calls[0]?.[0] as { module_id: string; start_date: string; target_date: string };
    expect(call.module_id).toBe("m2");
    expect(call.start_date).toBe("2026-09-07");
    expect(call.target_date).toBe(call.start_date);
  });

  it("does not schedule a module that already has dates", async () => {
    const el = await render(timeline([launch]));
    await act(async () => {
      el.querySelector(".tessera-gantt-track")?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: DAY * 5 }));
    });
    expect(updateModuleAction).not.toHaveBeenCalled();
  });
});

describe("module timeline today scroll", () => {
  // The line is at 2000px; the bar area is 800 - 200 = 600px, so it centres at 200 + 300 = 500px.
  const CENTRED = 2000 - 500;

  it("centres the today line on first open, on the Today button and on t", async () => {
    const el = await render(timeline([launch]));
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
    el.scrollLeft = 0;
    scrolls.length = 0;
    const button = [...el.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Today");
    await act(async () => {
      button?.click();
    });
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
    el.scrollLeft = 0;
    scrolls.length = 0;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    });
    expect(scrolls).toEqual([{ left: CENTRED, behavior: "instant" }]);
  });
});
