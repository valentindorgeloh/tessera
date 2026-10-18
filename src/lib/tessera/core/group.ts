/**
 * Grouping and ordering vocabulary shared by `DisplaySchema`, the list query
 * and the UI. Client-safe: constants and types only, no zod, no database.
 */

/** Fields a list can be grouped (and sub-grouped) by. Multi-valued fields duplicate an item into every group. */
export const GROUPABLE_FIELDS = [
  "state",
  "state_group",
  "priority",
  "labels",
  "cycle",
  "module",
  "assignees",
  "created_by",
  "start_date",
  "target_date",
  "created_at",
  "project",
] as const;

export type GroupBy = (typeof GROUPABLE_FIELDS)[number];

/** Fields that duplicate an item into several groups; `moveWorkItem` adds or removes the value instead of replacing it. */
export const MULTI_VALUED_GROUP_FIELDS = ["labels", "assignees", "module"] as const satisfies readonly GroupBy[];

export function isMultiValuedGroup(field: GroupBy): boolean {
  return (MULTI_VALUED_GROUP_FIELDS as readonly string[]).includes(field);
}

/** Joins a group id and a sub-group id into the key `group_limits` uses for one board cell (decision 112). Ids never contain a slash. */
export function groupLimitKey(groupId: string, subGroupId?: string): string {
  return subGroupId === undefined ? groupId : `${groupId}/${subGroupId}`;
}

/** Fields a list can be ordered by; prefix with `-` for descending (`-created_at`). */
export const ORDERABLE_FIELDS = [
  "sort_order",
  "created_at",
  "updated_at",
  "priority",
  "start_date",
  "target_date",
  "name",
  "sequence_id",
  "estimate",
] as const;

export type OrderableField = (typeof ORDERABLE_FIELDS)[number];
export type OrderBy = OrderableField | `-${OrderableField}`;

/** Every accepted `order_by` value: each orderable field ascending and descending. */
export const ORDER_BY_VALUES = ORDERABLE_FIELDS.flatMap((field) => [field, `-${field}` as const]) as [OrderBy, ...OrderBy[]];

export type ParsedOrderBy = { field: OrderableField; direction: "asc" | "desc" };

export function parseOrderBy(value: OrderBy): ParsedOrderBy {
  if (value.startsWith("-")) {
    return { field: value.slice(1) as OrderableField, direction: "desc" };
  }
  return { field: value as OrderableField, direction: "asc" };
}

/** Priority rank used for ordering (urgent first). */
export const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 } as const;
