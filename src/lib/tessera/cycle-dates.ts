/** Cycle date rules (moved verbatim from cycles.ts): both dates or none, start <= end, no overlap. */
import { and, asc, eq, gte, isNotNull, isNull, lte, ne } from "drizzle-orm";
import type { TesseraContext } from "./core/context";
import { conflict, validation } from "./core/errors";
import { cycle } from "./db/schema";

type DateRange = { start_date: string | null; end_date: string | null };

export function dateIssue(path: string, message: string): { code: "custom"; path: string[]; message: string }[] {
  return [{ code: "custom", path: [path], message }];
}

/** Both dates or none, and start_date <= end_date (VALIDATION). */
export function checkDates(range: DateRange): void {
  const hasStart = range.start_date !== null;
  const hasEnd = range.end_date !== null;
  if (hasStart !== hasEnd) {
    const message = "start_date and end_date must be set together";
    throw validation(dateIssue(hasStart ? "end_date" : "start_date", message), `Invalid input: ${message}`);
  }
  if (range.start_date !== null && range.end_date !== null && range.start_date > range.end_date) {
    const message = "end_date must be on or after start_date";
    throw validation(dateIssue("end_date", message), `Invalid input: ${message}`);
  }
}

/** CONFLICT when a non-archived cycle of the project intersects `range` (inclusive at both ends). */
export function assertNoOverlap(ctx: TesseraContext, projectId: string, range: DateRange, exceptId: string | null): void {
  if (range.start_date === null || range.end_date === null) return;
  const rows = ctx.db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(
      and(
        eq(cycle.project_id, projectId),
        isNull(cycle.deleted_at),
        isNull(cycle.archived_at),
        isNotNull(cycle.start_date),
        isNotNull(cycle.end_date),
        lte(cycle.start_date, range.end_date),
        gte(cycle.end_date, range.start_date),
        exceptId === null ? undefined : ne(cycle.id, exceptId),
      ),
    )
    .orderBy(asc(cycle.start_date))
    .all();
  if (rows.length > 0) {
    throw conflict(`The dates overlap cycle "${rows[0].name}"`, { ids: rows.map((row) => row.id) });
  }
}
