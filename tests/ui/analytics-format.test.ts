/**
 * Analytics helpers (src/components/charts/analytics-format.ts): the query,
 * narrative id, top-N buckets and KPI links.
 */
import { describe, expect, it } from "vitest";
import {
  analyticsHref,
  asBuckets,
  chartBuckets,
  cyclesForChart,
  kpiHref,
  narrativeId,
  normalizeFilters,
  parseAnalyticsParams,
  parseProjectIds,
  pointsAvailable,
  summarizeTrend,
} from "@/components/charts/analytics-format";
import { CATEGORICAL_TOKENS, paintToken } from "@/components/charts/chart-colors";
import { PALETTE_DATA_TOKEN, STATE_GROUP_PALETTE } from "@/components/charts/palette-colors";
import type { AnalyticsBucket } from "@/components/analytics/types";

const WEB = "00000000-0000-4000-8000-000000000001";
const OPS = "00000000-0000-4000-8000-000000000002";

function bucket(key: string, total: number, segments: Record<string, number> = {}): AnalyticsBucket {
  return { key, label: key, color: null, total, segments };
}

describe("parseAnalyticsParams", () => {
  it("defaults a missing or unknown query", () => {
    expect(parseAnalyticsParams({})).toEqual({
      projectIds: [],
      range: "30d",
      xAxis: "state_group",
      segment: null,
      measure: "count",
    });
    expect(parseAnalyticsParams({ range: "1y", x: "nope", segment: "none", measure: "weight" }).range).toBe("30d");
    expect(parseAnalyticsParams({ range: ["90d", "7d"], x: ["assignee"] })).toMatchObject({ range: "90d", xAxis: "assignee" });
  });

  it("keeps state only for exactly one project and drops a segment equal to the x axis", () => {
    expect(parseAnalyticsParams({ x: "state" }).xAxis).toBe("state_group");
    expect(parseAnalyticsParams({ x: "state", projects: `${WEB},${OPS}` }).xAxis).toBe("state_group");
    expect(parseAnalyticsParams({ x: "state", projects: WEB }).xAxis).toBe("state");
    expect(parseAnalyticsParams({ x: "priority", segment: "priority" }).segment).toBeNull();
    expect(parseAnalyticsParams({ x: "assignee", segment: "priority", measure: "points" })).toMatchObject({
      xAxis: "assignee",
      segment: "priority",
      measure: "points",
    });
  });

  it("reads up to 50 live-shaped project ids and ignores the rest", () => {
    expect(parseProjectIds(` ${WEB}, nope, ${WEB}, ${OPS} `)).toEqual([WEB, OPS]);
    expect(parseProjectIds(undefined)).toEqual([]);
  });
});

describe("analyticsHref and narrativeId", () => {
  it("omits defaults and round-trips a work-items query", () => {
    const filters = parseAnalyticsParams({ projects: `${OPS},${WEB}`, range: "7d", x: "label", segment: "priority", measure: "points" });
    const href = analyticsHref("work-items", filters);
    expect(href.startsWith("/analytics/work-items?")).toBe(true);
    const query = Object.fromEntries(new URL(href, "http://tessera.local").searchParams);
    expect(parseAnalyticsParams(query)).toEqual(filters);
    expect(analyticsHref("overview", parseAnalyticsParams({}))).toBe("/analytics/overview");
  });

  it("sorts project ids and uses all when none are selected", () => {
    expect(narrativeId("overview", { projectIds: [OPS, WEB], range: "365d" })).toBe(`overview:${WEB},${OPS}:365d`);
    expect(narrativeId("cycles", { projectIds: [], range: "30d" })).toBe("cycles:all:30d");
  });
});

describe("normalizeFilters and points", () => {
  it("drops unknown projects and turns points off when an estimate is missing", () => {
    const filters = parseAnalyticsParams({ projects: `${WEB},missing`, x: "state", measure: "points" });
    const projects = [
      { id: WEB, estimate_type: "points" },
      { id: OPS, estimate_type: null },
    ];
    expect(normalizeFilters(filters, [WEB, OPS], pointsAvailable(projects, [WEB]))).toMatchObject({
      projectIds: [WEB],
      xAxis: "state",
      measure: "points",
    });
    expect(pointsAvailable(projects, [])).toBe(false);
    expect(pointsAvailable(projects, [WEB])).toBe(true);
    expect(normalizeFilters(filters, [OPS], false).measure).toBe("count");
  });
});

describe("chartBuckets", () => {
  it("keeps 11 buckets and folds the rest into Other", () => {
    const buckets = Array.from({ length: 13 }, (_, index) => bucket(`b${index}`, index + 1, { urgent: index }));
    const chart = chartBuckets(buckets);
    expect(chart).toHaveLength(12);
    expect(chart[11]).toMatchObject({ key: "other", label: "Other", total: 12 + 13, segments: { urgent: 11 + 12 } });
    expect(chartBuckets(buckets.slice(0, 11))).toHaveLength(11);
  });

  it("turns a count record into labelled buckets in a fixed order", () => {
    const rows = asBuckets({ started: 2, backlog: 4 }, { order: ["backlog", "unstarted", "started"], color: (key) => STATE_GROUP_PALETTE[key] ?? null });
    expect(rows.map((row) => row.key)).toEqual(["backlog", "started"]);
    expect(rows[0]).toMatchObject({ label: "Backlog", color: "gray", total: 4 });
    expect(rows[1].color).toBe("yellow");
  });
});

describe("cyclesForChart", () => {
  it("keeps the 12 newest end dates first", () => {
    const rows = [
      { name: "Old", end_date: "2026-01-01" },
      { name: "New", end_date: "2026-06-01" },
      { name: "Open", end_date: null },
    ];
    expect(cyclesForChart(rows).map((row) => row.name)).toEqual(["New", "Old", "Open"]);
  });
});

describe("kpiHref", () => {
  it("links one project to its work items and a workspace filter to the all view", () => {
    expect(kpiHref("projects", [], "2026-10-18")).toBe("/projects");
    expect(kpiHref("work_items", [WEB], "2026-10-18")).toBe(`/projects/${WEB}/work-items`);
    expect(kpiHref("completed", [WEB], "2026-10-18")).toContain(`/projects/${WEB}/work-items?q=`);
    expect(kpiHref("active_cycles", [], "2026-10-18")).toBe("/active-cycles");
    expect(kpiHref("active_agents", [WEB], "2026-10-18")).toBe("/agents");
    const overdue = kpiHref("overdue", [], "2026-10-18");
    expect(overdue.startsWith("/workspace-views/all?q=")).toBe(true);
  });
});

describe("summarizeTrend", () => {
  it("names days, and weeks for a year", () => {
    expect(summarizeTrend([{ date: "2026-10-01", created: 2, completed: 1 }], "7d")).toBe(
      "Created versus completed: 2 created and 1 completed across 1 day.",
    );
    expect(summarizeTrend([], "30d")).toBe("Created versus completed: nothing in this range.");
    expect(summarizeTrend([{ date: "2026-01-05", created: 1, completed: 0 }], "365d")).toContain("1 week");
  });
});

describe("chart colours", () => {
  it("lists ten categorical tokens with green and orange last", () => {
    expect(CATEGORICAL_TOKENS).toHaveLength(10);
    expect(CATEGORICAL_TOKENS[0]).toBe("--color-data-categorical-blue");
    expect(CATEGORICAL_TOKENS[8]).toBe("--color-data-categorical-orange");
    expect(CATEGORICAL_TOKENS[9]).toBe("--color-data-categorical-green");
    for (const name of Object.values(PALETTE_DATA_TOKEN)) expect(name).toMatch(/^--color-[a-z-]+$/);
  });

  it("resolves a token and falls back to the CSS variable", () => {
    expect(paintToken({ "--color-data-categorical-blue": "rgb(1, 2, 3)" }, "--color-data-categorical-blue")).toBe("rgb(1, 2, 3)");
    expect(paintToken({}, "--color-border")).toBe("var(--color-border)");
  });
});
