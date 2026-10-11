import { describe, expect, it } from "vitest";
import {
  buildChartModel,
  currentDate,
  effectiveUnit,
  formatAmount,
  formatNumber,
  idealSeries,
  paceOf,
  summarizeChart,
  todayLabelPosition,
  type BuildChartInput,
} from "@/components/planning/burndown";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import type { CycleProgress } from "@/lib/tessera/types";

/**
 * Burndown and burnup model (src/components/planning/burndown.ts,
 * docs/contracts/ui.md "Burndown and burnup chart"): the ideal line, the
 * burnup derived from the pending series and the flat scope, the today marker,
 * one row per day, the pace and the unit fallback when a cycle has no points.
 */

function progress(overrides: Partial<CycleProgress> = {}): CycleProgress {
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
    completion_chart: {},
    chart_mode: "issues",
    ...overrides,
  };
}

/** A five-day cycle Mar 1–5 with today on Mar 3: pending 8, 6, 5 on the first three days. */
function input(overrides: Partial<BuildChartInput> = {}): BuildChartInput {
  return {
    start_date: "2026-03-01",
    end_date: "2026-03-05",
    status: "current",
    today: "2026-03-03",
    progress: progress({ completion_chart: { "2026-03-01": 8, "2026-03-02": 6, "2026-03-03": 5 } }),
    kind: "burndown",
    ...overrides,
  };
}

describe("idealSeries", () => {
  it("runs straight from the scope to zero over the days", () => {
    expect(idealSeries(8, 5)).toEqual([8, 6, 4, 2, 0]);
    expect(idealSeries(3, 4)).toEqual([3, 2, 1, 0]);
  });

  it("is [0] for a one-day cycle and empty without days", () => {
    expect(idealSeries(5, 1)).toEqual([0]);
    expect(idealSeries(5, 0)).toEqual([]);
  });
});

describe("buildChartModel", () => {
  it("has one row per day from start to end, inclusive", () => {
    const model = buildChartModel(input());
    expect(model.rows.map((row) => row.date)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
    expect(model.rows.map((row) => row.ideal)).toEqual([8, 6, 4, 2, 0]);
  });

  it("burndown: the actual line is the pending series and stops after today", () => {
    const model = buildChartModel(input());
    expect(model.rows.map((row) => row.actual)).toEqual([8, 6, 5, null, null]);
    expect(model.scope).toBe(8);
    expect(model.unit).toBe("issues");
  });

  it("burnup: actual is scope minus pending, the ideal rises to the scope", () => {
    const model = buildChartModel(input({ kind: "burnup" }));
    expect(model.rows.map((row) => row.actual)).toEqual([0, 2, 3, null, null]);
    expect(model.rows.map((row) => row.ideal)).toEqual([0, 2, 4, 6, 8]);
    expect(model.scope).toBe(8);
    expect(model.current).toEqual({ actual: 3, ideal: 4 });
  });

  it("scope is total minus cancelled", () => {
    const model = buildChartModel(input({ progress: progress({ total: 10, cancelled: 2, completion_chart: { "2026-03-01": 8 } }) }));
    expect(model.scope).toBe(8);
  });

  it("marks today only inside the range", () => {
    expect(buildChartModel(input()).today).toBe("2026-03-03");
    expect(buildChartModel(input({ today: "2026-03-01" })).today).toBe("2026-03-01");
    expect(buildChartModel(input({ today: "2026-03-05" })).today).toBe("2026-03-05");
    const completed = buildChartModel(
      input({
        today: "2026-03-09",
        status: "completed",
        progress: progress({ completion_chart: { "2026-03-01": 8, "2026-03-02": 6, "2026-03-03": 5, "2026-03-04": 3, "2026-03-05": 1 } }),
      }),
    );
    expect(completed.today).toBeNull();
    // A completed cycle reads at its end date.
    expect(completed.current).toEqual({ actual: 1, ideal: 0 });
    expect(currentDate(completed)).toBe("2026-03-05");
  });

  it("current and pace compare pending with the ideal at min(today, end)", () => {
    const model = buildChartModel(input());
    expect(model.current).toEqual({ actual: 5, ideal: 4 });
    expect(model.pace).toEqual({ status: "on_track", delta: 1 });
    const behind = buildChartModel(input({ progress: progress({ completion_chart: { "2026-03-01": 8, "2026-03-02": 8, "2026-03-03": 7 } }) }));
    expect(behind.pace).toEqual({ status: "behind", delta: 3 });
    const ahead = buildChartModel(input({ progress: progress({ completion_chart: { "2026-03-01": 8, "2026-03-02": 4, "2026-03-03": 1 } }) }));
    expect(ahead.pace).toEqual({ status: "ahead", delta: -3 });
  });

  it("reports drafts, upcoming cycles and cycles without items as empty", () => {
    expect(buildChartModel(input({ start_date: null, end_date: null, status: "draft" })).empty).toBe("draft");
    expect(buildChartModel(input({ start_date: null, end_date: null, status: "draft" })).rows).toEqual([]);
    expect(buildChartModel(input({ status: "upcoming", today: "2026-02-20", progress: progress() })).empty).toBe("upcoming");
    const noItems = buildChartModel(input({ progress: progress({ total: 2, cancelled: 2, completion_chart: { "2026-03-01": 0 } }) }));
    expect(noItems.empty).toBe("no_items");
    expect(noItems.pace).toBeNull();
    expect(buildChartModel(input()).empty).toBeNull();
  });

  it("a one-day cycle has a single row with ideal 0", () => {
    const model = buildChartModel(input({ start_date: "2026-03-03", end_date: "2026-03-03", progress: progress({ completion_chart: { "2026-03-03": 4 } }) }));
    expect(model.rows).toEqual([{ date: "2026-03-03", actual: 4, ideal: 0 }]);
  });
});

describe("points and the issues fallback", () => {
  const points = { total: 20, completed: 4.5, cancelled: 2, started: 6, unstarted: 4, backlog: 3.5 };

  it("draws points when the progress says so, scope from the point totals", () => {
    const model = buildChartModel(
      input({ progress: progress({ points, chart_mode: "points", completion_chart: { "2026-03-01": 18, "2026-03-02": 15.5, "2026-03-03": 13.5 } }) }),
    );
    expect(model.unit).toBe("points");
    expect(model.scope).toBe(18);
    expect(model.rows[2].actual).toBe(13.5);
  });

  it("falls back to work items when the progress has no points series", () => {
    // A points request answered with the items series (no estimate, or a snapshot frozen before P3).
    const model = buildChartModel(input({ progress: progress({ points, chart_mode: "issues", completion_chart: { "2026-03-01": 8 } }) }));
    expect(model.unit).toBe("issues");
    expect(model.scope).toBe(8);
    const legacy = buildChartModel(input({ progress: progress({ chart_mode: undefined, completion_chart: { "2026-03-01": 8 } }) }));
    expect(legacy.unit).toBe("issues");
  });

  it("effectiveUnit keeps a stored points choice only for cycles with points", () => {
    expect(effectiveUnit("points", true)).toBe("points");
    expect(effectiveUnit("points", false)).toBe("issues");
    expect(effectiveUnit("issues", true)).toBe("issues");
  });
});

describe("text", () => {
  it("formats amounts with one decimal at most", () => {
    expect(formatAmount(1, "issues")).toBe("1 work item");
    expect(formatAmount(3, "issues")).toBe("3 work items");
    expect(formatAmount(4.5, "points")).toBe("4.5 points");
    expect(formatAmount(1, "points")).toBe("1 point");
    expect(formatAmount(4.25, "points")).toBe("4.3 points");
    expect(formatNumber(4)).toBe("4");
    expect(formatNumber(2.0)).toBe("2");
  });

  it("paceOf is on track within max(1, 5% of scope)", () => {
    expect(paceOf(5, 4, 8)?.status).toBe("on_track");
    expect(paceOf(6, 4, 8)?.status).toBe("behind");
    expect(paceOf(2, 4, 8)?.status).toBe("ahead");
    // 5% of a scope of 100 is a wider band than 1.
    expect(paceOf(50, 45, 100)?.status).toBe("on_track");
    expect(paceOf(51, 45, 100)).toEqual({ status: "behind", delta: 6 });
    expect(paceOf(39, 45, 100)).toEqual({ status: "ahead", delta: -6 });
  });

  it("summarizes the burndown in one sentence", () => {
    const behind = buildChartModel(input({ progress: progress({ completion_chart: { "2026-03-01": 8, "2026-03-02": 8, "2026-03-03": 7 } }) }));
    expect(summarizeChart(behind, "Sprint 1")).toBe(`Burndown of Sprint 1: 7 of 8 work items pending on ${formatShortDate("2026-03-03")}, ideal 4. Behind by 3.`);
    expect(summarizeChart(buildChartModel(input()), "Sprint 1")).toBe(`Burndown of Sprint 1: 5 of 8 work items pending on ${formatShortDate("2026-03-03")}, ideal 4. On track.`);
  });

  it("summarizes the burnup as work done", () => {
    const model = buildChartModel(input({ kind: "burnup" }));
    expect(summarizeChart(model, "Sprint 1")).toBe(`Burnup of Sprint 1: 3 of 8 work items done on ${formatShortDate("2026-03-03")}, ideal 4. On track.`);
  });

  it("names the empty states", () => {
    expect(summarizeChart(buildChartModel(input({ start_date: null, end_date: null, status: "draft" })), "Draft")).toBe("Burndown of Draft: add dates to see the chart.");
    expect(summarizeChart(buildChartModel(input({ status: "upcoming", today: "2026-02-20" })))).toBe(`Burndown: starts ${formatShortDate("2026-03-01")}.`);
  });
});

describe("todayLabelPosition", () => {
  it("puts the label right of the marker in the first half, so it never runs over the y-axis", () => {
    // Today is the first day: a label left of the line would be clipped by the axis.
    expect(todayLabelPosition(buildChartModel(input({ today: "2026-03-01" })))).toBe("insideTopLeft");
    expect(todayLabelPosition(buildChartModel(input({ today: "2026-03-02" })))).toBe("insideTopLeft");
  });

  it("puts it left of the marker from the middle on, so it stays inside the plot on the last day", () => {
    expect(todayLabelPosition(buildChartModel(input({ today: "2026-03-03" })))).toBe("insideTopRight");
    expect(todayLabelPosition(buildChartModel(input({ today: "2026-03-05" })))).toBe("insideTopRight");
  });

  it("keeps the default when there is no marker or a single day", () => {
    expect(todayLabelPosition(buildChartModel(input({ status: "completed", today: "2026-03-09" })))).toBe("insideTopRight");
    expect(todayLabelPosition({ rows: [{ date: "2026-03-01", actual: 1, ideal: 0 }], today: "2026-03-01" })).toBe("insideTopRight");
  });
});
