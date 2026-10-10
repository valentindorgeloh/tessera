/**
 * Date and time helpers (decision 6). Client-safe: no node imports.
 * Timestamps are ISO-8601 UTC; dates are `YYYY-MM-DD`; "today" is the local date
 * of the machine running the code (the server, in practice). A timestamp maps
 * to a calendar day through that same local time zone (`localDateOf`,
 * `localDayStart`) so "created today" means the day `today()` names.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function nowIso(): string {
  return new Date().toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Local calendar date of this process, `YYYY-MM-DD`. */
export function todayLocal(): string {
  return formatLocalDate(new Date());
}

/** Local calendar date (`YYYY-MM-DD`) on which the ISO-8601 instant `iso` falls. */
export function localDateOf(iso: string): string {
  return formatLocalDate(new Date(iso));
}

/** ISO-8601 UTC instant at which the local calendar day `date` begins. */
export function localDayStart(date: string): string {
  const { year, month, day } = parseIsoDate(date);
  return new Date(year, month - 1, day).toISOString();
}

/** True when `value` is a well-formed `YYYY-MM-DD` that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE_PATTERN.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const m = ISO_DATE_PATTERN.exec(value);
  if (!m) throw new RangeError(`expected YYYY-MM-DD, got "${value}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Adds `n` calendar days (negative to subtract). Uses UTC arithmetic so DST never shifts the result. */
export function addDays(date: string, n: number): string {
  const { year, month, day } = parseIsoDate(date);
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + n)));
}

/** -1, 0 or 1; `YYYY-MM-DD` strings compare correctly as text. */
export function compareDates(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isBefore(a: string, b: string): boolean {
  return compareDates(a, b) < 0;
}

export function isAfter(a: string, b: string): boolean {
  return compareDates(a, b) > 0;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}
