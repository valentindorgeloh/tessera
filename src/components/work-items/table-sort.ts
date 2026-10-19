/**
 * Table header sort <-> `display.order_by` (decision 114 follow-up). A header
 * click sets the display's order and the server re-fetches, so a sort covers
 * the whole filtered list, not only the loaded rows. Pure and client-safe.
 */
import { parseOrderBy, type OrderBy, type OrderableField } from "@/lib/tessera/core/group";

/** Column key -> engine field. State and project have no engine order, so those columns are not sortable. */
export const TABLE_SORT_FIELDS: Readonly<Record<string, OrderableField>> = {
  key: "sequence_id",
  name: "name",
  priority: "priority",
  estimate: "estimate",
  start_date: "start_date",
  target_date: "target_date",
  created_at: "created_at",
  updated_at: "updated_at",
};

export type TableSortEntry = { sortKey: string; direction: "ascending" | "descending" };

/** The Astryx sort state a stored order shows: none for the manual order or a field the table has no column for. */
export function sortFromOrderBy(orderBy: OrderBy): TableSortEntry[] {
  const { field, direction } = parseOrderBy(orderBy);
  if (field === "sort_order") return [];
  const sortKey = Object.keys(TABLE_SORT_FIELDS).find((key) => TABLE_SORT_FIELDS[key] === field);
  if (sortKey === undefined) return [];
  return [{ sortKey, direction: direction === "desc" ? "descending" : "ascending" }];
}

/** The order a header click asks for: the primary entry's field, or the manual order when sorting is cleared. */
export function orderByFromSort(sort: readonly TableSortEntry[]): OrderBy {
  const first = sort[0];
  if (first === undefined) return "sort_order";
  const field = TABLE_SORT_FIELDS[first.sortKey];
  if (field === undefined) return "sort_order";
  return first.direction === "descending" ? `-${field}` : field;
}
