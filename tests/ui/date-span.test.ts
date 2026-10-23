/**
 * Gantt day-delta and clamp rules (src/components/work-items/date-span.ts)
 * and the calendar grid (src/components/work-items/calendar-math.ts).
 */
import { describe, expect, it } from "vitest";
import { NARROW_CELL_PX, calendarWeeks, itemsByDay, opensQuickAddInPopover, shiftPeriod } from "@/components/work-items/calendar-math";
import { applyDayDelta, barSpan, calendarDropPatch, dayDelta, scheduleOnDay, timelineRange } from "@/components/work-items/date-span";

const span = { start_date: "2026-10-01", target_date: "2026-10-05" };

describe("dayDelta", () => {
  it("rounds pointer travel to whole days", () => {
    expect(dayDelta(20, 10)).toBe(2);
    expect(dayDelta(14, 10)).toBe(1);
    expect(dayDelta(15, 10)).toBe(2);
    expect(dayDelta(4, 10)).toBe(0);
    expect(dayDelta(-14, 10)).toBe(-1);
    expect(dayDelta(-15, 10)).toBe(-1);
    expect(dayDelta(-16, 10)).toBe(-2);
  });

  it("yields 0 when the day width cannot be measured", () => {
    expect(dayDelta(12, 0)).toBe(0);
    expect(dayDelta(12, -4)).toBe(0);
    expect(dayDelta(Number.NaN, 8)).toBe(0);
  });
});

describe("applyDayDelta", () => {
  it("moves both dates by the same number of days in one patch", () => {
    expect(applyDayDelta(span, "move", 3)).toEqual({ start_date: "2026-10-04", target_date: "2026-10-08" });
    expect(applyDayDelta(span, "move", -2)).toEqual({ start_date: "2026-09-29", target_date: "2026-10-03" });
  });

  it("moves a one-date bar by shifting only that date", () => {
    expect(applyDayDelta({ start_date: null, target_date: "2026-10-05" }, "move", 2)).toEqual({ target_date: "2026-10-07" });
    expect(applyDayDelta({ start_date: "2026-10-01", target_date: null }, "move", -1)).toEqual({ start_date: "2026-09-30" });
  });

  it("changes only the dragged edge and never lets the start pass the target", () => {
    expect(applyDayDelta(span, "start", 2)).toEqual({ start_date: "2026-10-03" });
    expect(applyDayDelta(span, "start", 10)).toEqual({ start_date: "2026-10-05" });
    expect(applyDayDelta(span, "end", -2)).toEqual({ target_date: "2026-10-03" });
    expect(applyDayDelta(span, "end", -10)).toEqual({ target_date: "2026-10-01" });
  });

  it("grows a one-day bar from the open end and clamps it against the known date", () => {
    expect(barSpan({ start_date: null, target_date: "2026-10-05" })).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
      openStart: true,
      openEnd: false,
    });
    expect(applyDayDelta({ start_date: null, target_date: "2026-10-05" }, "start", -2)).toEqual({ start_date: "2026-10-03" });
    expect(applyDayDelta({ start_date: null, target_date: "2026-10-05" }, "start", 4)).toEqual({ start_date: "2026-10-05" });
    expect(applyDayDelta({ start_date: "2026-10-01", target_date: null }, "end", 4)).toEqual({ target_date: "2026-10-05" });
    expect(applyDayDelta({ start_date: "2026-10-01", target_date: null }, "end", -4)).toEqual({ target_date: "2026-10-01" });
  });

  it("returns null for a zero delta, a fractional delta, or an undated move", () => {
    expect(applyDayDelta(span, "move", 0)).toBeNull();
    expect(applyDayDelta(span, "start", 1.5)).toBeNull();
    expect(applyDayDelta({ start_date: null, target_date: null }, "move", 2)).toBeNull();
    expect(applyDayDelta({ start_date: null, target_date: null }, "end", 2)).toBeNull();
  });
});

describe("calendarDropPatch", () => {
  it("keeps the span when the item has a start date", () => {
    expect(calendarDropPatch(span, "2026-10-08")).toEqual({ start_date: "2026-10-04", target_date: "2026-10-08" });
  });

  it("is a no-op on the same day and sets a missing target", () => {
    expect(calendarDropPatch(span, "2026-10-05")).toBeNull();
    expect(calendarDropPatch({ start_date: null, target_date: null }, "2026-10-12")).toEqual({ target_date: "2026-10-12" });
    expect(calendarDropPatch({ start_date: "2026-10-20", target_date: null }, "2026-10-12")).toEqual({
      start_date: "2026-10-12",
      target_date: "2026-10-12",
    });
  });
});

describe("scheduleOnDay and timelineRange", () => {
  it("schedules an empty row as a one-day bar", () => {
    expect(scheduleOnDay("2026-10-15")).toEqual({ start_date: "2026-10-15", target_date: "2026-10-15" });
  });

  it("covers 45 days either side of today and pads loaded dates", () => {
    expect(timelineRange([], "2026-10-15")).toEqual({ start: "2026-08-31", end: "2026-11-29" });
    expect(timelineRange(["2026-01-01"], "2026-10-15")).toEqual({ start: "2025-12-18", end: "2026-11-29" });
  });
});

describe("calendarWeeks", () => {
  it("covers October 2026 in whole Monday weeks and can drop weekends", () => {
    const weeks = calendarWeeks("2026-10-15", "month", 1, true);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[4][6]).toBe("2026-11-01");
    const weekdays = calendarWeeks("2026-10-15", "week", 1, false);
    expect(weekdays).toEqual([["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]]);
  });

  it("steps a month to its first day and a week by seven days", () => {
    expect(shiftPeriod("2026-10-15", "month", 1)).toBe("2026-11-01");
    expect(shiftPeriod("2026-10-15", "month", -1)).toBe("2026-09-01");
    expect(shiftPeriod("2026-10-15", "week", 1)).toBe("2026-10-22");
  });

  it("keeps list order inside a day and collects items with no target date", () => {
    const grouped = itemsByDay([
      { id: "a", target_date: "2026-10-02" },
      { id: "b", target_date: null },
      { id: "c", target_date: "2026-10-02" },
    ]);
    expect(grouped.byDay.get("2026-10-02")?.map((item) => item.id)).toEqual(["a", "c"]);
    expect(grouped.unscheduled.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("opensQuickAddInPopover", () => {
  it("opens quick add in a popover for a narrow or unmeasured cell, inline for a wide one", () => {
    expect(NARROW_CELL_PX).toBe(120);
    expect(opensQuickAddInPopover(44)).toBe(true);
    expect(opensQuickAddInPopover(119.9)).toBe(true);
    expect(opensQuickAddInPopover(120)).toBe(false);
    expect(opensQuickAddInPopover(190)).toBe(false);
    expect(opensQuickAddInPopover(undefined)).toBe(true);
  });
});
