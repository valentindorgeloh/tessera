// @vitest-environment jsdom
/**
 * Recharts loads on demand (speed batch, decision 142): the burndown chart and the
 * analytics bar and area charts draw through `import()`-loaded modules instead of
 * sitting in the route's first load. Until the module is in, the same Skeleton as
 * before hydration holds the height; then the chart replaces it in the next commit
 * with no Suspense boundary (which would hold a revealed fallback for 300 ms).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BarSeriesChart, TrendChart } from "@/components/charts/SeriesCharts";
import { createLazyModule } from "@/components/charts/lazy-module";
import { BurndownChart } from "@/components/planning/BurndownChart";
import type { CycleProgress } from "@/lib/tessera/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
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

async function render(node: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

const progress: CycleProgress = {
  total: 8,
  completed: 3,
  cancelled: 0,
  started: 2,
  unstarted: 2,
  backlog: 1,
  by_state: {},
  by_label: {},
  by_assignee: {},
  completion_chart: { "2026-03-01": 8, "2026-03-02": 6, "2026-03-03": 5 },
  chart_mode: "issues",
};

describe("createLazyModule", () => {
  it("starts the import once, hands out the module after it resolves and retries after a failure", async () => {
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return { value: 42 };
    });
    const lazy = createLazyModule(load);
    lazy.preload();
    lazy.preload();
    expect(load).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    lazy.preload();
    expect(load).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    lazy.preload();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("lazy charts", () => {
  it("draws the burndown chart after its module has loaded", async () => {
    const el = await render(
      createElement(BurndownChart, {
        cycle: { name: "Sprint 1", start_date: "2026-03-01", end_date: "2026-03-05", status: "current" },
        progress,
        kind: "burnup",
        today: "2026-03-03",
        hasDataTable: false,
      }),
    );
    await vi.waitFor(() => expect(el.querySelector("svg.recharts-surface, .recharts-wrapper")).not.toBeNull());
    expect(el.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("Sprint 1");
  });

  it("draws the analytics bar and area charts after their module has loaded", async () => {
    const buckets = [
      { key: "a", label: "Alpha", total: 3, segments: {}, color: null },
      { key: "b", label: "Beta", total: 5, segments: {}, color: null },
    ];
    const el = await render(
      createElement("div", null, [
        createElement(BarSeriesChart, { key: "bar", title: "By state", summary: "Two buckets", buckets: buckets as never, segments: [] }),
        createElement(TrendChart, { key: "trend", summary: "Trend", points: [{ date: "2026-03-01", created: 1, completed: 0 }, { date: "2026-03-02", created: 2, completed: 1 }] as never, today: "2026-03-03" }),
      ]),
    );
    await vi.waitFor(() => expect(el.querySelectorAll(".recharts-wrapper").length).toBe(2));
    expect(el.textContent).toContain("Two buckets");
  });
});
