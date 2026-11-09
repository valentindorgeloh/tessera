/**
 * Calendar zoom math (src/components/work-items/calendar-math.ts, decision 139):
 * calendar quarters, the quarter grid of whole weeks (13 or 14 rows, never 15),
 * the quarter's muted days and day labels, and how many items a cell shows.
 */
import { describe, expect, it } from "vitest";
import {
  CELL_ITEM_LIMIT,
  QUARTER_NARROW_PX,
  calendarWeeks,
  cellItemLimit,
  dayLabel,
  isOutsideMonth,
  isOutsidePeriod,
  periodLabel,
  quarterEnd,
  quarterStart,
  shiftPeriod,
  type WeekStart,
} from "@/components/work-items/calendar-math";
import { addDays } from "@/lib/tessera/core/time";

describe("quarterStart and quarterEnd", () => {
  it("give the first and last day of each calendar quarter", () => {
    expect([quarterStart("2026-02-14"), quarterEnd("2026-02-14")]).toEqual(["2026-01-01", "2026-03-31"]);
    expect([quarterStart("2026-04-01"), quarterEnd("2026-06-30")]).toEqual(["2026-04-01", "2026-06-30"]);
    expect([quarterStart("2026-09-30"), quarterEnd("2026-07-01")]).toEqual(["2026-07-01", "2026-09-30"]);
    expect([quarterStart("2026-11-10"), quarterEnd("2026-11-10")]).toEqual(["2026-10-01", "2026-12-31"]);
  });

  it("keeps Feb 29 in Q1 of a leap year", () => {
    expect(quarterStart("2028-02-29")).toBe("2028-01-01");
    expect(quarterEnd("2028-02-29")).toBe("2028-03-31");
    expect(calendarWeeks("2028-02-29", "quarter", 1, true).flat()).toContain("2028-02-29");
  });
});

describe("shiftPeriod by quarter", () => {
  it("moves one quarter across a year boundary in both directions", () => {
    expect(shiftPeriod("2026-11-10", "quarter", 1)).toBe("2027-01-01");
    expect(shiftPeriod("2027-02-03", "quarter", -1)).toBe("2026-10-01");
  });

  it("lands on the quarter start from a mid-quarter anchor", () => {
    expect(shiftPeriod("2026-05-31", "quarter", 1)).toBe("2026-07-01");
    expect(shiftPeriod("2026-05-31", "quarter", -1)).toBe("2026-01-01");
  });

  it("leaves week and month as they were", () => {
    expect(shiftPeriod("2026-10-14", "week", 1)).toBe("2026-10-21");
    expect(shiftPeriod("2026-10-14", "month", -1)).toBe("2026-09-01");
  });
});

describe("periodLabel", () => {
  it("reads each zoom", () => {
    expect(periodLabel("2026-11-10", "quarter", 1)).toBe("Q4 2026 (Oct – Dec)");
    expect(periodLabel("2027-02-03", "quarter", 1)).toBe("Q1 2027 (Jan – Mar)");
    expect(periodLabel("2026-11-10", "month", 1)).toBe("November 2026");
    expect(periodLabel("2026-11-10", "week", 1)).toBe("Nov 9 – Nov 15, 2026");
  });
});

describe("calendarWeeks for a quarter", () => {
  it("covers the whole weeks that touch Q4 2026 (Monday first): 14 rows", () => {
    const weeks = calendarWeeks("2026-11-10", "quarter", 1, true);
    expect(weeks).toHaveLength(14);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[13][6]).toBe("2027-01-03");
  });

  it("follows the week start", () => {
    const sunday = calendarWeeks("2026-11-10", "quarter", 0, true);
    expect([sunday[0][0], sunday[sunday.length - 1][6], sunday.length]).toEqual(["2026-09-27", "2027-01-02", 14]);
    const saturday = calendarWeeks("2026-11-10", "quarter", 6, true);
    expect([saturday[0][0], saturday[saturday.length - 1][6], saturday.length]).toEqual(["2026-09-26", "2027-01-01", 14]);
  });

  it("drops the weekend columns but keeps the rows", () => {
    const weeks = calendarWeeks("2026-11-10", "quarter", 1, false);
    expect(weeks).toHaveLength(14);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[13]).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("always draws 13 or 14 rows, never 15 (2000–2100, every week start, weekends on and off)", () => {
    const counts = new Set<number>();
    for (let year = 2000; year <= 2100; year += 1) {
      for (const month of ["01", "04", "07", "10"]) {
        for (let start = 0; start < 7; start += 1) {
          for (const showWeekends of [true, false]) {
            const weeks = calendarWeeks(`${year}-${month}-15`, "quarter", start as WeekStart, showWeekends);
            counts.add(weeks.length);
            expect(weeks.length === 13 || weeks.length === 14).toBe(true);
          }
        }
      }
    }
    expect([...counts].sort()).toEqual([13, 14]);
  });
});

describe("isOutsidePeriod", () => {
  it("mutes the days outside the anchor's quarter", () => {
    expect(isOutsidePeriod("2026-09-28", "2026-11-10", "quarter")).toBe(true);
    expect(isOutsidePeriod("2026-10-01", "2026-11-10", "quarter")).toBe(false);
    expect(isOutsidePeriod("2026-12-31", "2026-11-10", "quarter")).toBe(false);
    expect(isOutsidePeriod("2027-01-01", "2026-11-10", "quarter")).toBe(true);
  });

  it("keeps the month rule for week and month", () => {
    for (const day of ["2026-10-31", "2026-11-01", "2026-11-10", "2026-12-01"]) {
      expect(isOutsidePeriod(day, "2026-11-10", "week")).toBe(isOutsideMonth(day, "2026-11-10"));
      expect(isOutsidePeriod(day, "2026-11-10", "month")).toBe(isOutsideMonth(day, "2026-11-10"));
    }
  });
});

describe("dayLabel", () => {
  it("names the month on the 1st in a quarter only", () => {
    expect(dayLabel("2026-11-01", "quarter")).toBe("Nov 1");
    expect(dayLabel("2026-11-02", "quarter")).toBe("2");
    expect(dayLabel("2026-11-01", "month")).toBe("1");
    expect(dayLabel("2026-11-01", "week")).toBe("1");
    expect(dayLabel("2026-11-30", "month")).toBe("30");
  });
});

describe("cellItemLimit", () => {
  it("keeps 4 for week and month and shows 2 in a quarter, or none when narrow", () => {
    expect(CELL_ITEM_LIMIT).toEqual({ week: 4, month: 4, quarter: 2 });
    expect(QUARTER_NARROW_PX).toBe(600);
    expect([cellItemLimit("week", false), cellItemLimit("week", true)]).toEqual([4, 4]);
    expect([cellItemLimit("month", false), cellItemLimit("month", true)]).toEqual([4, 4]);
    expect([cellItemLimit("quarter", false), cellItemLimit("quarter", true)]).toEqual([2, 0]);
  });
});

describe("the quarter grid is contiguous", () => {
  it("steps one day at a time from the first to the last cell", () => {
    const days = calendarWeeks("2028-02-10", "quarter", 1, true).flat();
    for (let index = 1; index < days.length; index += 1) expect(days[index]).toBe(addDays(days[index - 1], 1));
  });
});
