/**
 * The Advanced filter builder's editable shape (decisions 20 and 93). A tree
 * deeper than one nested group, or a `not` around a group, cannot be edited
 * here; the dialog shows its text summary instead (./describe-rich-filters.ts).
 */
import type { RichFilterField, RichFilterOp, RichFilters } from "@/lib/tessera/types";
import { RICH_FILTER_LIMITS, RICH_FILTER_OPS_BY_FIELD } from "@/lib/tessera/schemas";

export type EditableCondition = {
  field: RichFilterField;
  op: RichFilterOp;
  /**
   * What the pickers hold, as strings. One entry for a single value (an id, a
   * priority, a date, a name), many for `in` / `not_in`, `[from, to]` for an
   * absolute `between`, one relative token for a relative date, `["true"]` or
   * `["false"]` for blocked, none for `is_null` / `is_not_null`.
   */
  value: string[];
  not: boolean;
};

export type EditableGroup = { match: "and" | "or"; conditions: EditableCondition[] };

export type EditableTree = {
  match: "and" | "or";
  conditions: EditableCondition[];
  groups: EditableGroup[];
};

export const DATE_FIELDS: readonly RichFilterField[] = ["start_date", "target_date", "created_at", "updated_at", "completed_at"];
export const RELATIVE_TOKENS = ["today", "1w", "2w", "1m"] as const;
export type RelativeToken = (typeof RELATIVE_TOKENS)[number];

export function isDateField(field: RichFilterField): boolean {
  return DATE_FIELDS.includes(field);
}

export function isRelativeToken(value: string | undefined): value is RelativeToken {
  return value !== undefined && (RELATIVE_TOKENS as readonly string[]).includes(value);
}

export function opTakesValue(op: RichFilterOp): boolean {
  return op !== "is_null" && op !== "is_not_null";
}

/** `in` and `not_in` hold a list; every other operator holds one value (a date range is still one value). */
export function isListOp(op: RichFilterOp): boolean {
  return op === "in" || op === "not_in";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLeaf(node: RichFilters): node is Extract<RichFilters, { field: RichFilterField }> {
  return isRecord(node) && "field" in node;
}

/** The pickers' strings for a stored value. */
export function toValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.map(String);
  if (isRecord(value)) {
    if (typeof value.relative === "string") return [value.relative];
    if (typeof value.from === "string" && typeof value.to === "string") return [value.from, value.to];
    if (typeof value.to === "string") return [value.to];
    if (typeof value.from === "string") return [value.from];
  }
  return [];
}

function asCondition(node: RichFilters): EditableCondition | null {
  if (isLeaf(node)) return { field: node.field, op: node.op, value: toValues(node.value), not: false };
  if (isRecord(node) && "not" in node && isLeaf(node.not as RichFilters)) {
    const leaf = node.not as { field: RichFilterField; op: RichFilterOp; value?: unknown };
    return { field: leaf.field, op: leaf.op, value: toValues(leaf.value), not: true };
  }
  return null;
}

function conditionsOf(nodes: RichFilters[]): EditableCondition[] | null {
  const out: EditableCondition[] = [];
  for (const node of nodes) {
    const condition = asCondition(node);
    if (!condition) return null;
    out.push(condition);
  }
  return out;
}

/** Null when the builder cannot show the tree. A bare condition becomes a one-row All group. */
export function toEditable(tree: RichFilters): EditableTree | null {
  const alone = asCondition(tree);
  if (alone) return { match: "and", conditions: [alone], groups: [] };
  if (!isRecord(tree) || !("and" in tree || "or" in tree)) return null;
  const match = "and" in tree ? "and" : "or";
  const children = (tree as { and?: RichFilters[]; or?: RichFilters[] })[match] ?? [];
  const conditions: EditableCondition[] = [];
  const groups: EditableTree["groups"] = [];
  for (const child of children) {
    const condition = asCondition(child);
    if (condition) {
      conditions.push(condition);
      continue;
    }
    if (!isRecord(child) || !("and" in child || "or" in child)) return null;
    const nestedMatch = "and" in child ? "and" : "or";
    const nested = conditionsOf((child as { and?: RichFilters[]; or?: RichFilters[] })[nestedMatch] ?? []);
    if (!nested) return null;
    groups.push({ match: nestedMatch, conditions: nested });
  }
  return { match, conditions, groups };
}

function parseValue(field: RichFilterField, op: RichFilterOp, values: string[]): unknown {
  if (!opTakesValue(op)) return undefined;
  const cleaned = values.map((part) => part.trim()).filter((part) => part !== "");
  if (field === "blocked") return cleaned[0] === "true";
  if (isDateField(field)) {
    const first = cleaned[0] ?? "";
    if (isRelativeToken(first)) return { op, relative: first };
    if (op === "between") return { op, from: first, to: cleaned[1] ?? first };
    if (op === "before") return { op, to: first };
    return { op, from: first };
  }
  if (isListOp(op)) return cleaned;
  return (values[0] ?? "").trim();
}

function leaf(condition: EditableCondition): RichFilters {
  const ops = RICH_FILTER_OPS_BY_FIELD[condition.field];
  const op = ops.includes(condition.op) ? condition.op : ops[0];
  const value = parseValue(condition.field, op, condition.value);
  const node = (value === undefined ? { field: condition.field, op } : { field: condition.field, op, value }) as RichFilters;
  return condition.not ? { not: node } : node;
}

/** Null when the builder holds no condition: applying it clears the filter. */
export function fromEditable(tree: EditableTree): RichFilters | null {
  const nodes = [
    ...tree.conditions.map(leaf),
    ...tree.groups.filter((group) => group.conditions.length > 0).map((group) => ({ [group.match]: group.conditions.map(leaf) }) as RichFilters),
  ];
  if (nodes.length === 0) return null;
  return { [tree.match]: nodes } as RichFilters;
}

/** True when a condition has everything its operator needs; the dialog blocks Apply until every row is. */
export function isConditionComplete(condition: EditableCondition): boolean {
  if (!opTakesValue(condition.op)) return true;
  const cleaned = condition.value.map((part) => part.trim());
  if (condition.field === "blocked") return cleaned[0] === "true" || cleaned[0] === "false";
  if (isDateField(condition.field)) {
    if (isRelativeToken(cleaned[0])) return true;
    if (condition.op === "between") return (cleaned[0] ?? "") !== "" && (cleaned[1] ?? "") !== "";
    return (cleaned[0] ?? "") !== "";
  }
  if (isListOp(condition.op)) return cleaned.some((part) => part !== "");
  return (cleaned[0] ?? "") !== "";
}

export function treeIsComplete(tree: EditableTree): boolean {
  return tree.conditions.every(isConditionComplete) && tree.groups.every((group) => group.conditions.every(isConditionComplete));
}

/** Leaf conditions in the editable tree; the builder stops adding at the engine's limit (decision 93). */
export function editableConditionCount(tree: EditableTree): number {
  return tree.conditions.length + tree.groups.reduce((sum, group) => sum + group.conditions.length, 0);
}

export const MAX_CONDITIONS = RICH_FILTER_LIMITS.conditions;
export const MAX_CHILDREN = RICH_FILTER_LIMITS.children;

/**
 * Carries a condition's value over to a new operator: a list keeps its first
 * entry when the operator takes one value, a single value becomes a one-item
 * list, and a date range turns into a single date or the other way round.
 */
export function valueForOp(condition: EditableCondition, op: RichFilterOp): string[] {
  const current = condition.value;
  if (!opTakesValue(op)) return [];
  if (isDateField(condition.field)) {
    if (isRelativeToken(current[0])) return [current[0]];
    if (op === "between") return current.length >= 2 ? current : [current[0] ?? "", ""];
    return current[0] === undefined ? [] : [current[0]];
  }
  if (isListOp(op)) return current;
  return current.slice(0, 1);
}

/** What a freshly chosen field starts with: its first option, or today for dates. */
export function defaultValue(field: RichFilterField, op: RichFilterOp, firstOption: string | undefined, today: string): string[] {
  if (!opTakesValue(op)) return [];
  if (field === "blocked") return ["true"];
  if (isDateField(field)) return op === "between" ? [today, ""] : [today];
  if (field === "name" || field === "parent") return [""];
  return firstOption === undefined ? [] : [firstOption];
}

export function blankCondition(): EditableCondition {
  return { field: "priority", op: "eq", value: ["urgent"], not: false };
}
