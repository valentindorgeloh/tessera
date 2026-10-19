/**
 * Human wording for the Advanced filter (decision 93): operator labels per
 * field, option lookups for the pickers, and a one-string summary of any tree.
 * Pure: no React, so Vitest covers it (tests/ui/rich-filter-labels.test.ts).
 */
import { RELATION_DISPLAY_TYPES, RICH_FILTER_FIELD_LABELS } from "@/lib/tessera/schemas";
import type { RelationDisplayType } from "@/lib/tessera/schemas";
import type { Priority, RichFilterField, RichFilterOp, RichFilters, StateGroup } from "@/lib/tessera/types";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import type { ProjectBundle } from "@/components/work-items/types";
import { isDateField, isRelativeToken, toValues, type RelativeToken } from "./rich-filter-tree";

export type FilterOption = { value: string; label: string };

export type FilterLookup = {
  /** Options for the pickers; a field with none shows a disabled picker. */
  options: Partial<Record<RichFilterField, FilterOption[]>>;
  /** Server local date, the starting value of a new date condition. */
  today: string;
};

const PRIORITIES: readonly { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

// ASSUMPTION: same wording as stateGroupLabel in work-items/properties; kept here so this module stays free of React.
const STATE_GROUPS: readonly { value: StateGroup; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "unstarted", label: "Not started" },
  { value: "started", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "triage", label: "Triage" },
];

const RELATION_LABELS: Record<RelationDisplayType, string> = {
  blocked_by: "Blocked by",
  blocking: "Blocking",
  relates_to: "Related to",
  duplicate: "Duplicate of",
  start_before: "Starts before",
  start_after: "Starts after",
  finish_before: "Finishes before",
  finish_after: "Finishes after",
  implemented_by: "Implemented by",
  implements: "Implements",
};

export const RELATIVE_LABELS: Record<RelativeToken, string> = {
  today: "Today",
  "1w": "One week from today",
  "2w": "Two weeks from today",
  "1m": "One month from today",
};

const MULTI_FIELDS: readonly RichFilterField[] = ["labels", "module", "assignees", "subscriber", "mentions"];

const DEFAULT_OPS: Record<RichFilterOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  not_in: "is none of",
  is_null: "is empty",
  is_not_null: "is set",
  contains: "contains",
  before: "is before",
  after: "is after",
  between: "is between",
};

const MULTI_OPS: Partial<Record<RichFilterOp, string>> = {
  eq: "includes",
  neq: "does not include",
  in: "includes any of",
  not_in: "includes none of",
  is_null: "has none",
  is_not_null: "has any",
};

const DATE_OPS: Partial<Record<RichFilterOp, string>> = { is_null: "is not set", is_not_null: "is set" };

const RELATION_OPS: Partial<Record<RichFilterOp, string>> = {
  in: "has any of",
  not_in: "has none of",
  is_null: "has no relations",
  is_not_null: "has relations",
};

const PARENT_OPS: Partial<Record<RichFilterOp, string>> = { is_null: "has no parent", is_not_null: "has a parent" };
const CYCLE_OPS: Partial<Record<RichFilterOp, string>> = { is_null: "is in no cycle", is_not_null: "is in a cycle" };
const ESTIMATE_OPS: Partial<Record<RichFilterOp, string>> = { is_null: "has no estimate", is_not_null: "has an estimate" };

/** Operator wording for one field: "includes any of" for labels, "is before" for dates, "is" for the rest. */
export function operatorLabel(field: RichFilterField, op: RichFilterOp): string {
  let special: Partial<Record<RichFilterOp, string>> | undefined;
  if (MULTI_FIELDS.includes(field)) special = MULTI_OPS;
  else if (isDateField(field)) special = DATE_OPS;
  else if (field === "relation_type") special = RELATION_OPS;
  else if (field === "parent") special = PARENT_OPS;
  else if (field === "cycle") special = CYCLE_OPS;
  else if (field === "estimate_point") special = ESTIMATE_OPS;
  return special?.[op] ?? DEFAULT_OPS[op];
}

export function fieldLabel(field: RichFilterField): string {
  return field === "estimate_point" ? "Estimate" : RICH_FILTER_FIELD_LABELS[field];
}

function scoped<T extends { id: string; name: string; project_id: string }>(rows: readonly T[], suffix: (projectId: string) => string): FilterOption[] {
  return rows.map((row) => ({ value: row.id, label: `${row.name}${suffix(row.project_id)}` }));
}

/**
 * Picker options from the project bundle. Names gain the project identifier
 * when a list spans projects (a workspace list); outside a project route only
 * the fixed enums are available.
 */
export function buildFilterLookup(bundle: ProjectBundle | null): FilterLookup {
  const options: Partial<Record<RichFilterField, FilterOption[]>> = {
    priority: PRIORITIES.map((entry) => ({ value: entry.value, label: entry.label })),
    state_group: STATE_GROUPS.map((entry) => ({ value: entry.value, label: entry.label })),
    relation_type: RELATION_DISPLAY_TYPES.map((value) => ({ value, label: RELATION_LABELS[value] })),
  };
  if (!bundle) return { options, today: "" };
  const identifiers = new Map(bundle.projects.map((project) => [project.id, project.identifier]));
  const spansProjects = new Set(bundle.states.map((state) => state.project_id)).size > 1;
  const suffix = (projectId: string) => {
    const code = spansProjects ? identifiers.get(projectId) : undefined;
    return code ? ` · ${code}` : "";
  };
  const actors = bundle.actors.filter((actor) => !actor.deleted_at).map((actor) => ({ value: actor.id, label: actor.name }));
  options.state = scoped(bundle.states, suffix);
  options.labels = scoped(bundle.labels, suffix);
  options.cycle = scoped(bundle.cycles, suffix);
  options.module = scoped(bundle.modules, suffix);
  options.assignees = actors;
  options.created_by = actors;
  options.subscriber = actors;
  options.mentions = actors;
  options.project = bundle.projects.map((project) => ({ value: project.id, label: project.name }));
  // The engine compares estimate point values, not ids (decision 93).
  if (bundle.estimate) options.estimate_point = bundle.estimate.points.map((point) => ({ value: point.value, label: formatEstimateValue(bundle.estimate!.type, point.value) }));
  return { options, today: bundle.today };
}

/** Options with every selected value present, so a removed or out-of-scope id still shows up (and can be unticked). */
export function withSelected(options: FilterOption[], selected: readonly string[]): FilterOption[] {
  const known = new Set(options.map((option) => option.value));
  const extra = selected.filter((value) => value !== "" && !known.has(value)).map((value) => ({ value, label: `Unavailable (${value.slice(0, 8)})` }));
  return extra.length === 0 ? options : [...options, ...extra];
}

function optionLabel(lookup: FilterLookup, field: RichFilterField, value: string): string {
  return lookup.options[field]?.find((option) => option.value === value)?.label ?? value;
}

function relativeText(token: RelativeToken): string {
  return RELATIVE_LABELS[token].toLowerCase();
}

function valueText(lookup: FilterLookup, field: RichFilterField, op: RichFilterOp, value: unknown): string {
  const values = toValues(value);
  if (isDateField(field)) {
    if (isRelativeToken(values[0])) return op === "between" ? `today and ${relativeText(values[0])}` : relativeText(values[0]);
    return op === "between" ? values.join(" and ") : (values[0] ?? "");
  }
  if (field === "blocked") return values[0] === "true" ? "yes" : "no";
  if (field === "name") return `"${values[0] ?? ""}"`;
  if (field === "parent") return values.join(", ");
  return values.map((entry) => optionLabel(lookup, field, entry)).join(", ");
}

function describeNode(node: RichFilters, lookup: FilterLookup): string {
  if (typeof node !== "object" || node === null) return "";
  if ("field" in node) {
    const op = operatorLabel(node.field, node.op);
    if (node.op === "is_null" || node.op === "is_not_null") return `${fieldLabel(node.field)} ${op}`;
    return `${fieldLabel(node.field)} ${op} ${valueText(lookup, node.field, node.op, node.value)}`;
  }
  if ("not" in node) {
    const inner = describeNode(node.not, lookup);
    return "field" in node.not ? `not ${inner}` : `not (${inner})`;
  }
  const key = "and" in node ? "and" : "or";
  const children = key === "and" && "and" in node ? node.and : "or" in node ? node.or : [];
  if (children.length === 0) return "nothing";
  const joiner = key === "and" ? " and " : " or ";
  return children.map((child) => (isGroup(child) ? `(${describeNode(child, lookup)})` : describeNode(child, lookup))).join(joiner);
}

function isGroup(node: RichFilters): boolean {
  return typeof node === "object" && node !== null && ("and" in node || "or" in node) && !("field" in node);
}

/**
 * One readable sentence for any tree, however deep: "Priority is Urgent and
 * (Labels includes any of Bug, Chore or Target date is before 2026-10-31)".
 * Unknown ids show as they are.
 */
export function describeRichFilters(tree: RichFilters, lookup: FilterLookup = { options: {}, today: "" }): string {
  return describeNode(tree, lookup);
}
