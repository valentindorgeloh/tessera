// @vitest-environment jsdom
/**
 * The gantt's date button (GanttDates in GanttLayout.tsx, ModuleDates in
 * planning/ModulesTimeline.tsx) mounts its two DateInputs only while its
 * popover is open. Astryx 0.6.8 Popover keeps closed content mounted, so an
 * always-rendered picker put two full calendars in every draggable row (200
 * rows on an ungrouped page). DateInput is replaced by a stub that renders a
 * marker; the marker count is the number of mounted pickers. Same pattern as
 * tests/ui/date-control-lazy.test.ts.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";
import type { Module, WorkItem } from "@/lib/tessera/types";

const dateInputProps: Record<string, unknown>[] = [];

vi.mock("@astryxdesign/core/DateInput", () => ({
  DateInput: (props: Record<string, unknown>) => {
    dateInputProps.push(props);
    return createElement("input", { "data-date-input-stub": "", "aria-label": String(props.label ?? "") });
  },
}));
vi.mock("@/app/actions/modules", () => ({ updateModuleAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/modules",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@astryxdesign/core/Toast", () => ({ useToast: () => vi.fn() }));

const { GanttDates } = await import("@/components/work-items/GanttLayout");
const { ModuleDates } = await import("@/components/planning/ModulesTimeline");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const bundle = {
  project: { id: "11111111-1111-7111-8111-111111111111", name: "Website", identifier: "WEB" },
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
  week_start: 2,
} as unknown as ProjectBundle;

const item = { id: "i1", key: "WEB-1", name: "Ship", start_date: "2026-10-12", target_date: "2026-10-20" } as unknown as WorkItem;
const launch = { id: "m1", name: "Launch", start_date: "2026-10-05", target_date: "2026-10-09" } as unknown as Module;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(ProjectScope, { bundle } as ComponentProps<typeof ProjectScope>, node));
  });
  return container;
}

/** Pickers mounted anywhere in the document (Astryx may render popover content outside the container). */
const mounted = () => document.querySelectorAll("[data-date-input-stub]").length;
const trigger = (el: HTMLElement, label: string) => {
  const button = el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`no button ${label}`);
  return button;
};
const clearButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Clear dates");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  dateInputProps.length = 0;
});

describe("GanttDates (work-item gantt row)", () => {
  it("mounts no picker while closed, two while open, none after Escape", async () => {
    const onUpdate = vi.fn();
    const el = await render(createElement(GanttDates, { item, onUpdate }));
    expect(mounted()).toBe(0);
    expect(dateInputProps).toHaveLength(0);
    expect(clearButton()).toBeUndefined();

    await act(async () => {
      trigger(el, "Set dates for WEB-1").click();
    });
    expect(mounted()).toBe(2);
    expect(dateInputProps.map((props) => props.label)).toEqual(["Start date", "Target date"]);
    expect(dateInputProps[0]).toMatchObject({ value: "2026-10-12", max: "2026-10-20", weekStartsOn: 2 });
    expect(dateInputProps[1]).toMatchObject({ value: "2026-10-20", min: "2026-10-12" });

    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(mounted()).toBe(0);
    expect(trigger(el, "Set dates for WEB-1").getAttribute("aria-expanded")).toBe("false");
  });

  it("sends the cleared dates and unmounts the pickers on Clear dates", async () => {
    const onUpdate = vi.fn();
    const el = await render(createElement(GanttDates, { item, onUpdate }));
    await act(async () => {
      trigger(el, "Set dates for WEB-1").click();
    });
    await act(async () => {
      clearButton()?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith("i1", { start_date: null, target_date: null });
    expect(mounted()).toBe(0);
  });
});

describe("ModuleDates (modules timeline row)", () => {
  it("mounts no picker while closed and two while open", async () => {
    const onUpdate = vi.fn();
    const el = await render(createElement(ModuleDates, { module: launch, ends: launch, onUpdate }));
    expect(mounted()).toBe(0);
    await act(async () => {
      trigger(el, "Set dates for Launch").click();
    });
    expect(mounted()).toBe(2);
    expect(dateInputProps[0]).toMatchObject({ label: "Start date", value: "2026-10-05", max: "2026-10-09" });
    await act(async () => {
      clearButton()?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith({ start_date: null, target_date: null });
    expect(mounted()).toBe(0);
  });
});
