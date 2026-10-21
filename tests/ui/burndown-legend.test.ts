// @vitest-environment jsdom
/**
 * Legend of the burndown and burnup chart (src/components/planning/BurndownChart.tsx,
 * docs/contracts/ui.md "Burndown and burnup chart"): a legend under the
 * plot (outside the chart's role=img frame) names every line (Scope, Ideal and Completed on a burnup; Pending and Ideal
 * on a burndown) with its token colour and dash pattern, and the lines carry no
 * inline labels: the burnup's "Scope" label sat under the dashed Ideal line.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BurndownChart, ChartLegend, actualSeriesName, legendEntries } from "@/components/planning/BurndownChart";
import { CHART_TOKENS } from "@/components/planning/chart-colors";
import type { CycleProgress } from "@/lib/tessera/types";

function progress(): CycleProgress {
  return {
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
}

describe("legendEntries", () => {
  it("names Completed, Ideal and Scope on a burnup, each on its own token", () => {
    const entries = legendEntries("burnup");
    expect(entries.map((entry) => entry.label)).toEqual(["Completed", "Ideal", "Scope"]);
    expect(entries.map((entry) => CHART_TOKENS[entry.color])).toEqual(["--color-data-categorical-blue", "--color-text-secondary", "--color-data-categorical-purple"]);
    // Never colour alone: solid, dashed and dotted.
    expect(entries.map((entry) => entry.dash)).toEqual([undefined, "4 4", "2 4"]);
  });

  it("names Pending and Ideal on a burndown, with no Scope line", () => {
    expect(legendEntries("burndown").map((entry) => entry.label)).toEqual(["Pending", "Ideal"]);
    expect(actualSeriesName("burndown")).toBe("Pending");
    expect(actualSeriesName("burnup")).toBe("Completed");
  });
});

describe("ChartLegend", () => {
  it("renders one swatch and one name per line", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(ChartLegend, { kind: "burnup" }));
    expect(container.textContent).toBe("CompletedIdealScope");
    const dashes = [...container.querySelectorAll("line")].map((line) => line.getAttribute("stroke-dasharray"));
    expect(dashes).toEqual([null, "4 4", "2 4"]);
    for (const line of container.querySelectorAll("line")) expect(line.getAttribute("stroke")).toBeTruthy();
  });
});

describe("BurndownChart", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

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
    root = null;
    container = null;
  });

  it("keeps its one-sentence accessible name and draws no inline Scope label", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(BurndownChart, {
          cycle: { name: "Sprint 1", start_date: "2026-03-01", end_date: "2026-03-05", status: "current" },
          progress: progress(),
          kind: "burnup",
          today: "2026-03-03",
          hasDataTable: false,
        }),
      );
    });
    const frame = container.querySelector('[role="img"]');
    expect(frame?.getAttribute("aria-label")).toContain("Sprint 1");
    // No SVG text node says "Scope": the legend names the line instead.
    const svgTexts = [...container.querySelectorAll("svg text")].map((node) => node.textContent);
    expect(svgTexts).not.toContain("Scope");
  });

  it("keeps the legend outside the role=img frame so assistive technology reads the series key", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(BurndownChart, {
          cycle: { name: "Sprint 1", start_date: "2026-03-01", end_date: "2026-03-05", status: "current" },
          progress: progress(),
          kind: "burnup",
          today: "2026-03-03",
          hasDataTable: false,
        }),
      );
    });
    const legend = container.querySelector(".tessera-planning-chart-legend");
    expect(legend?.textContent).toBe("CompletedIdealScope");
    expect(legend?.closest('[role="img"]')).toBeNull();
  });
});
