// @vitest-environment jsdom
/**
 * Gantt pixel metrics (src/components/work-items/gantt-metrics.ts): the length
 * parser, and the reader that takes the day column from the first header day,
 * the row height from the first row and the bar inset from the stylesheet's
 * `--tessera-gantt-inset`. jsdom has no layout, so the rectangles are stubs.
 */
import { describe, expect, it } from "vitest";
import { parseCssLength, readGanttMetrics } from "@/components/work-items/gantt-metrics";

describe("parseCssLength", () => {
  it("reads px and rem lengths", () => {
    expect(parseCssLength("4px")).toBe(4);
    expect(parseCssLength(" 0.25rem ")).toBe(4);
    expect(parseCssLength("0.25rem", 20)).toBe(5);
    expect(parseCssLength("2")).toBe(2);
  });

  it("is zero for anything else", () => {
    expect(parseCssLength("")).toBe(0);
    expect(parseCssLength("var(--spacing-1)")).toBe(0);
    expect(parseCssLength("calc(1px + 2px)")).toBe(0);
  });
});

function gantt(dayWidth: number, rowHeight: number, inset: string) {
  const root = document.createElement("div");
  root.style.setProperty("--tessera-gantt-inset", inset);
  const day = document.createElement("div");
  day.className = "tessera-gantt-head-day";
  day.getBoundingClientRect = () => ({ width: dayWidth, height: 0 }) as DOMRect;
  const row = document.createElement("div");
  row.className = "tessera-gantt-row";
  row.getBoundingClientRect = () => ({ width: 0, height: rowHeight }) as DOMRect;
  root.append(day, row);
  document.body.append(root);
  return root;
}

describe("readGanttMetrics", () => {
  it("measures the day column, the row and the bar inset", () => {
    expect(readGanttMetrics(gantt(32, 44, "4px"))).toEqual({ day: 32, row: 44, inset: 4 });
  });

  it("follows a taller touch row", () => {
    expect(readGanttMetrics(gantt(16, 32, "4px"))).toEqual({ day: 16, row: 32, inset: 4 });
  });

  it("is null while there is no layout (a hidden route, the first paint)", () => {
    expect(readGanttMetrics(gantt(0, 0, "4px"))).toBeNull();
    expect(readGanttMetrics(document.createElement("div"))).toBeNull();
  });
});
