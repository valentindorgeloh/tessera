/** Local calendar helpers for analytics trends and target weeks. */
import { addDays } from "../core/time";
import type { AnalyticsRange } from "../types";

const RANGE_DAYS: Record<AnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

export function rangeWindow(today: string, range: AnalyticsRange): { from: string; to: string; weekly: boolean } {
  const days = RANGE_DAYS[range];
  return { from: addDays(today, -(days - 1)), to: today, weekly: range === "365d" };
}

/** Monday of the ISO week that contains `date`, as YYYY-MM-DD. */
export function isoWeekStart(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}

/** ISO week key `YYYY-Www`. The week-year is the year of that week's Thursday. */
export function isoWeekKey(date: string): string {
  const start = isoWeekStart(date);
  const thursday = addDays(start, 3);
  const isoYear = thursday.slice(0, 4);
  const weekOne = isoWeekStart(`${isoYear}-01-04`);
  const weeks = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${weekOne}T00:00:00Z`)) / 86_400_000 / 7) + 1;
  return `${isoYear}-W${String(weeks).padStart(2, "0")}`;
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function eachWeek(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let day = isoWeekStart(from); day <= isoWeekStart(to); day = addDays(day, 7)) weeks.push(day);
  return weeks;
}
