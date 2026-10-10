/**
 * Fractional-index sort keys (decision 4). Keys are plain strings that sort
 * lexicographically, so `ORDER BY sort_order` and SQL `max()` both work and a
 * drop rewrites exactly one row. A pair of neighbours that is not in order
 * (equal keys, or reversed) is reported as VALIDATION rather than as the
 * library's bare Error.
 */
import { max, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { generateKeyBetween } from "fractional-indexing";
import type { TesseraDb } from "../db/client";
import { notFound, validation } from "./errors";

function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw validation({ before, after }, `Cannot place a sort key between ${before ?? "start"} and ${after ?? "end"}: ${reason}`);
  }
}

export function firstSortOrder(): string {
  return keyBetween(null, null);
}

/** Key after the current last one; `null` when the list is empty. */
export function sortOrderAfter(last: string | null): string {
  return keyBetween(last, null);
}

/** Key before the current first one; `null` when the list is empty. */
export function sortOrderBefore(first: string | null): string {
  return keyBetween(null, first);
}

/** Key strictly between two neighbours; either side may be `null` for the list edge. */
export function sortOrderBetween(before: string | null, after: string | null): string {
  return keyBetween(before, after);
}

type TableWithSortOrder = SQLiteTable & { sort_order: SQLiteColumn };

/** Highest existing `sort_order` among the rows matching `where` (or all rows), or `null` when there are none. */
export function lastSortOrder(db: TesseraDb, table: TableWithSortOrder, where?: SQL): string | null {
  const query = db.select({ last: max(table.sort_order) }).from(table);
  const row = where ? query.where(where).get() : query.get();
  const last = row?.last;
  return typeof last === "string" ? last : null;
}

/** A row of an ordered list; `archived_at` is set on lists whose archived rows stay in the table (cycles, modules). */
export type OrderedRow = { id: string; sort_order: string; archived_at?: string | null };

function keyAt(rows: OrderedRow[], index: number): string | null {
  const row = rows[index];
  return row === undefined ? null : row.sort_order;
}

/**
 * Sort key that places `id` directly after `beforeId` and/or directly before
 * `afterId`. `rows` holds every live row of the list in display order,
 * archived ones included, so the new key never ties with a hidden row; the
 * named neighbours themselves must be active (NOT_FOUND otherwise) because
 * that is the list the caller sees, and when both are given they must be
 * adjacent in that visible list (VALIDATION). A missing side is filled with
 * the real neighbour in the full list.
 */
export function sortOrderForMove(rows: OrderedRow[], id: string, beforeId: string | undefined, afterId: string | undefined, entity: string): string {
  const others = rows.filter((row) => row.id !== id);
  const active = others.filter((row) => row.archived_at === undefined || row.archived_at === null);
  const beforeIndex = beforeId === undefined ? -1 : active.findIndex((row) => row.id === beforeId);
  const afterIndex = afterId === undefined ? -1 : active.findIndex((row) => row.id === afterId);
  if (beforeId !== undefined && beforeIndex < 0) throw notFound(entity, beforeId);
  if (afterId !== undefined && afterIndex < 0) throw notFound(entity, afterId);
  if (beforeIndex >= 0 && afterIndex >= 0 && afterIndex !== beforeIndex + 1) {
    throw validation({ before_id: beforeId, after_id: afterId }, "before_id and after_id must be adjacent neighbours");
  }
  if (beforeIndex >= 0) {
    const fullIndex = others.findIndex((row) => row.id === beforeId);
    return keyBetween(keyAt(others, fullIndex), keyAt(others, fullIndex + 1));
  }
  const fullIndex = others.findIndex((row) => row.id === afterId);
  return keyBetween(keyAt(others, fullIndex - 1), keyAt(others, fullIndex));
}
