/**
 * The Advanced filter builder's editable shape (decision 20). A tree deeper
 * than one nested group, or a `not` around a group, cannot be edited here.
 */
import type { RichFilterField, RichFilterOp, RichFilters } from "@/lib/tessera/types";
import { RICH_FILTER_OPS_BY_FIELD } from "@/lib/tessera/schemas";

export type EditableCondition = {
  field: RichFilterField;
  op: RichFilterOp;
  /** Comma-separated for `in` / `not_in`; a date, `from..to`, or a relative token for dates; `true` / `false` for blocked. */
  value: string;
  not: boolean;
};

export type EditableTree = {
  match: "and" | "or";
  conditions: EditableCondition[];
  groups: { match: "and" | "or"; conditions: EditableCondition[] }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLeaf(node: RichFilters): node is Extract<RichFilters, { field: RichFilterField }> {
  return isRecord(node) && "field" in node;
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (isRecord(value)) {
    if (typeof value.relative === "string") return value.relative;
    if (typeof value.from === "string" && typeof value.to === "string") return `${value.from}..${value.to}`;
    if (typeof value.to === "string") return value.to;
    if (typeof value.from === "string") return value.from;
  }
  return "";
}

function asCondition(node: RichFilters): EditableCondition | null {
  if (isLeaf(node)) return { field: node.field, op: node.op, value: valueText(node.value), not: false };
  if (isRecord(node) && "not" in node && isLeaf(node.not as RichFilters)) {
    const leaf = node.not as { field: RichFilterField; op: RichFilterOp; value?: unknown };
    return { field: leaf.field, op: leaf.op, value: valueText(leaf.value), not: true };
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

function parseValue(field: RichFilterField, op: RichFilterOp, text: string): unknown {
  if (op === "is_null" || op === "is_not_null") return undefined;
  const trimmed = text.trim();
  if (field === "blocked") return trimmed === "true";
  if (op === "in" || op === "not_in") return trimmed.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (field.endsWith("_date") || field.endsWith("_at")) {
    if (trimmed === "today" || trimmed === "1w" || trimmed === "2w" || trimmed === "1m") return { op, relative: trimmed };
    if (op === "between" && trimmed.includes("..")) {
      const [from, to] = trimmed.split("..").map((part) => part.trim());
      return { op, from, to };
    }
    if (op === "before") return { op, to: trimmed };
    if (op === "after") return { op, from: trimmed };
    return { op, from: trimmed, to: trimmed };
  }
  return trimmed;
}

function leaf(condition: EditableCondition): RichFilters {
  const op = RICH_FILTER_OPS_BY_FIELD[condition.field].includes(condition.op) ? condition.op : RICH_FILTER_OPS_BY_FIELD[condition.field][0];
  const value = parseValue(condition.field, op, condition.value);
  const node = (value === undefined ? { field: condition.field, op } : { field: condition.field, op, value }) as RichFilters;
  return condition.not ? { not: node } : node;
}

export function fromEditable(tree: EditableTree): RichFilters {
  const nodes = [
    ...tree.conditions.map(leaf),
    ...tree.groups.filter((group) => group.conditions.length > 0).map((group) => ({ [group.match]: group.conditions.map(leaf) }) as RichFilters),
  ];
  if (nodes.length === 0) return { [tree.match]: [{ field: "name", op: "contains", value: "" }] } as RichFilters;
  return { [tree.match]: nodes } as RichFilters;
}

export function blankCondition(): EditableCondition {
  return { field: "priority", op: "eq", value: "urgent", not: false };
}
