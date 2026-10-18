/**
 * Rich filter matrix shared by the engine and the filter builder (decision 20).
 * Client-safe: no database, no clock. `schemas.ts` re-exports it.
 */
import type { RichFilterField, RichFilterOp, RichFilters } from "./schemas";

export const RICH_FILTER_LIMITS = { depth: 4, conditions: 50, children: 20 } as const;

/** Display names of relations, inverses included. Canonical storage stays in relations.ts. */
export const RELATION_DISPLAY_TYPES = [
  "blocked_by",
  "blocking",
  "relates_to",
  "duplicate",
  "start_before",
  "start_after",
  "finish_before",
  "finish_after",
  "implemented_by",
  "implements",
] as const;

export type RelationDisplayType = (typeof RELATION_DISPLAY_TYPES)[number];

const ID_OPS = ["eq", "neq", "in", "not_in", "is_null", "is_not_null"] as const satisfies readonly RichFilterOp[];
const MULTI_OPS = ["in", "not_in", "eq", "neq", "is_null", "is_not_null"] as const satisfies readonly RichFilterOp[];
const DATE_OPS = ["before", "after", "between", "is_null", "is_not_null"] as const satisfies readonly RichFilterOp[];

/** Operators each field accepts. A wrong pair is VALIDATION. */
export const RICH_FILTER_OPS_BY_FIELD: Record<RichFilterField, readonly RichFilterOp[]> = {
  state: ID_OPS,
  cycle: ID_OPS,
  parent: ID_OPS,
  created_by: ID_OPS,
  project: ID_OPS,
  state_group: ID_OPS,
  priority: ID_OPS,
  labels: MULTI_OPS,
  module: MULTI_OPS,
  assignees: MULTI_OPS,
  subscriber: MULTI_OPS,
  mentions: MULTI_OPS,
  name: ["contains", "eq", "neq"],
  start_date: DATE_OPS,
  target_date: DATE_OPS,
  created_at: DATE_OPS,
  updated_at: DATE_OPS,
  completed_at: DATE_OPS,
  estimate_point: ID_OPS,
  blocked: ["eq"],
  relation_type: ["in", "not_in", "is_null", "is_not_null"],
};

export const RICH_FILTER_FIELD_LABELS: Record<RichFilterField, string> = {
  state: "State",
  state_group: "State group",
  priority: "Priority",
  labels: "Labels",
  cycle: "Cycle",
  module: "Module",
  parent: "Parent",
  assignees: "Assignees",
  created_by: "Created by",
  subscriber: "Subscriber",
  mentions: "Mentions",
  project: "Project",
  name: "Name",
  start_date: "Start date",
  target_date: "Target date",
  created_at: "Created",
  updated_at: "Updated",
  completed_at: "Completed",
  estimate_point: "Estimate",
  blocked: "Blocked",
  relation_type: "Relation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** How many leaf conditions a tree holds. */
export function countRichConditions(tree: RichFilters): number {
  if (!isRecord(tree)) return 0;
  if ("field" in tree) return 1;
  if ("not" in tree) return countRichConditions(tree.not as RichFilters);
  const children = "and" in tree ? tree.and : "or" in tree ? tree.or : [];
  return children.reduce((sum, child) => sum + countRichConditions(child), 0);
}
