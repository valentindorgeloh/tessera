/**
 * Rich filter trees (decision 20). Lists, counts, views and exports AND this
 * fragment with `buildWhere`. Intake stays on its own filters.
 */
import { and, eq, exists, inArray, isNotNull, isNull, not, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TesseraContext } from "./core/context";
import { validation } from "./core/errors";
import {
  estimate_point,
  mention,
  work_item,
  work_item_assignee,
  work_item_label,
  work_item_module,
  work_item_relation,
  work_item_subscriber,
} from "./db/schema";
import { dateCondition, hasAnyAssignee, hasAnyLabel, hasAnyModule, hasAnySubscriber, mentionsAny, stateIdsInGroups } from "./filters";
import {
  RELATION_DISPLAY_TYPES,
  RICH_FILTER_LIMITS,
  RICH_FILTER_OPS_BY_FIELD,
  countRichConditions,
  type RelationDisplayType,
} from "./rich-filter-spec";
import { DateFilterSchema, PrioritySchema, StateGroupSchema, type RichFilterCondition, type RichFilterField, type RichFilterOp, type RichFilters } from "./schemas";
import type { DateFilter, RelationType, StateGroup } from "./types";

const NONE: SQL = sql`1 = 0`;
const ALL: SQL = sql`1 = 1`;

const ID_FIELDS = ["state", "cycle", "parent", "created_by", "project"] as const;
const ENUM_FIELDS = ["state_group", "priority"] as const;
const MULTI_FIELDS = ["labels", "module", "assignees", "subscriber", "mentions"] as const;
const DATE_FIELDS = ["start_date", "target_date", "created_at", "updated_at", "completed_at"] as const;
const NULLABLE_IDS = new Set<RichFilterField>(["cycle", "parent"]);
const TIMESTAMP_DATES = new Set<RichFilterField>(["created_at", "updated_at", "completed_at"]);

const RELATION_SIDE: Record<RelationDisplayType, { type: RelationType; side: "from" | "to" | "either" }> = {
  blocked_by: { type: "blocked_by", side: "from" },
  blocking: { type: "blocked_by", side: "to" },
  relates_to: { type: "relates_to", side: "either" },
  duplicate: { type: "duplicate", side: "either" },
  start_before: { type: "start_before", side: "from" },
  start_after: { type: "start_before", side: "to" },
  finish_before: { type: "finish_before", side: "from" },
  finish_after: { type: "finish_before", side: "to" },
  implemented_by: { type: "implemented_by", side: "from" },
  implements: { type: "implemented_by", side: "to" },
};

type Issue = { path: string; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeaf(node: RichFilters): node is RichFilterCondition {
  return isRecord(node) && "field" in node;
}

function fail(issues: Issue[], path: string, reason: string): void {
  issues.push({ path, reason });
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value;
}

function oneString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** VALIDATION `{ path, reason }` when the tree breaks the depth, size or field/op matrix. */
export function validateRichFilters(tree: RichFilters): void {
  const issues: Issue[] = [];
  walk(tree, "$", 1, issues);
  if (countRichConditions(tree) > RICH_FILTER_LIMITS.conditions) {
    fail(issues, "$", `at most ${RICH_FILTER_LIMITS.conditions} conditions`);
  }
  if (issues.length > 0) throw validation(issues, "Invalid rich filters");
}

function walk(node: RichFilters, path: string, depth: number, issues: Issue[]): void {
  if (depth > RICH_FILTER_LIMITS.depth) {
    fail(issues, path, `depth is above ${RICH_FILTER_LIMITS.depth}`);
    return;
  }
  if (isLeaf(node)) {
    checkLeaf(node, path, issues);
    return;
  }
  if ("not" in node) {
    walk(node.not, `${path}.not`, depth + 1, issues);
    return;
  }
  const key = "and" in node ? "and" : "or" in node ? "or" : null;
  if (key === null) {
    fail(issues, path, "expected and, or, not or a condition");
    return;
  }
  const children = key === "and" && "and" in node ? node.and : "or" in node ? node.or : [];
  if (children.length < 1 || children.length > RICH_FILTER_LIMITS.children) {
    fail(issues, path, `${key} needs 1 to ${RICH_FILTER_LIMITS.children} nodes`);
    return;
  }
  children.forEach((child, index) => walk(child, `${path}.${key}[${index}]`, depth + 1, issues));
}

function checkLeaf(node: RichFilterCondition, path: string, issues: Issue[]): void {
  const ops = RICH_FILTER_OPS_BY_FIELD[node.field];
  if (!ops.includes(node.op)) {
    fail(issues, `${path}.op`, `${node.field} does not take ${node.op}`);
    return;
  }
  if (node.op === "is_null" || node.op === "is_not_null") return;
  if (!valueOk(node)) fail(issues, `${path}.value`, `${node.field} ${node.op} has the wrong value`);
}

function valueOk(node: RichFilterCondition): boolean {
  const { field, op, value } = node;
  if ((ID_FIELDS as readonly string[]).includes(field) || field === "estimate_point") {
    if (op === "eq" || op === "neq") return oneString(value) !== null;
    return strings(value) !== null;
  }
  if ((ENUM_FIELDS as readonly string[]).includes(field)) {
    const allowed = field === "priority" ? PrioritySchema.options : StateGroupSchema.options;
    if (op === "eq" || op === "neq") return typeof value === "string" && (allowed as readonly string[]).includes(value);
    const list = strings(value);
    return list !== null && list.every((entry) => (allowed as readonly string[]).includes(entry));
  }
  if ((MULTI_FIELDS as readonly string[]).includes(field)) {
    if (op === "eq" || op === "neq") return oneString(value) !== null;
    return strings(value) !== null;
  }
  if (field === "name") return typeof value === "string";
  if ((DATE_FIELDS as readonly string[]).includes(field)) return asDateFilter(op, value) !== null;
  if (field === "blocked") return value === true || value === false;
  if (field === "relation_type") {
    const list = strings(value);
    return list !== null && list.every((entry) => (RELATION_DISPLAY_TYPES as readonly string[]).includes(entry));
  }
  return false;
}

function asDateFilter(op: RichFilterOp, value: unknown): DateFilter | null {
  if (op !== "before" && op !== "after" && op !== "between") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (op === "before") return { op, to: value };
    if (op === "after") return { op, from: value };
    return null;
  }
  if (typeof value === "string" && (["today", "1w", "2w", "1m"] as const).includes(value as "today")) {
    return { op, relative: value as DateFilter["relative"] };
  }
  if (!isRecord(value)) return null;
  const parsed = DateFilterSchema.safeParse({ ...value, op });
  return parsed.success ? parsed.data : null;
}

function idColumn(field: (typeof ID_FIELDS)[number]): SQLiteColumn {
  switch (field) {
    case "state":
      return work_item.state_id;
    case "cycle":
      return work_item.cycle_id;
    case "parent":
      return work_item.parent_id;
    case "created_by":
      return work_item.created_by;
    case "project":
      return work_item.project_id;
  }
}

function dateColumn(field: (typeof DATE_FIELDS)[number]): SQLiteColumn {
  switch (field) {
    case "start_date":
      return work_item.start_date;
    case "target_date":
      return work_item.target_date;
    case "created_at":
      return work_item.created_at;
    case "updated_at":
      return work_item.updated_at;
    case "completed_at":
      return work_item.completed_at;
  }
}

function hasAny(ctx: TesseraContext, field: (typeof MULTI_FIELDS)[number], ids: string[]): SQL {
  if (ids.length === 0) return NONE;
  switch (field) {
    case "labels":
      return hasAnyLabel(ctx, ids);
    case "module":
      return hasAnyModule(ctx, ids);
    case "assignees":
      return hasAnyAssignee(ctx, ids);
    case "subscriber":
      return hasAnySubscriber(ctx, ids);
    case "mentions":
      return mentionsAny(ctx, ids);
  }
}

function hasNone(ctx: TesseraContext, field: (typeof MULTI_FIELDS)[number]): SQL {
  switch (field) {
    case "labels":
      return not(exists(ctx.db.select({ one: sql`1` }).from(work_item_label).where(eq(work_item_label.work_item_id, work_item.id))));
    case "module":
      return not(exists(ctx.db.select({ one: sql`1` }).from(work_item_module).where(eq(work_item_module.work_item_id, work_item.id))));
    case "assignees":
      return not(exists(ctx.db.select({ one: sql`1` }).from(work_item_assignee).where(eq(work_item_assignee.work_item_id, work_item.id))));
    case "subscriber":
      return not(exists(ctx.db.select({ one: sql`1` }).from(work_item_subscriber).where(eq(work_item_subscriber.work_item_id, work_item.id))));
    case "mentions":
      return not(
        exists(
          ctx.db
            .select({ one: sql`1` })
            .from(mention)
            .where(and(eq(mention.entity_type, "work_item"), eq(mention.entity_id, work_item.id))),
        ),
      );
  }
}

function compareIds(ctx: TesseraContext, field: (typeof ID_FIELDS)[number], op: RichFilterOp, value: unknown): SQL {
  const column = idColumn(field);
  if (op === "is_null") return NULLABLE_IDS.has(field) ? isNull(column) : NONE;
  if (op === "is_not_null") return NULLABLE_IDS.has(field) ? isNotNull(column) : ALL;
  const nullable = NULLABLE_IDS.has(field);
  if (op === "eq" || op === "neq") {
    const text = oneString(value) ?? "";
    const match = nullable ? and(isNotNull(column), eq(column, text)) : eq(column, text);
    return op === "eq" ? (match ?? NONE) : not(match ?? NONE);
  }
  const list = strings(value) ?? [];
  if (list.length === 0) return op === "in" ? NONE : ALL;
  const match = nullable ? and(isNotNull(column), inArray(column, list)) : inArray(column, list);
  return op === "in" ? (match ?? NONE) : not(match ?? NONE);
}

function compareEnums(ctx: TesseraContext, field: (typeof ENUM_FIELDS)[number], op: RichFilterOp, value: unknown): SQL {
  if (op === "is_null") return NONE;
  if (op === "is_not_null") return ALL;
  const list = op === "eq" || op === "neq" ? [oneString(value) ?? ""] : (strings(value) ?? []);
  if (field === "priority") {
    if (list.length === 0) return op === "in" || op === "eq" ? NONE : ALL;
    const match = inArray(work_item.priority, list as ("urgent" | "high" | "medium" | "low" | "none")[]);
    return op === "eq" || op === "in" ? match : not(match);
  }
  const groups = list.filter((entry): entry is StateGroup => (StateGroupSchema.options as readonly string[]).includes(entry));
  if (groups.length === 0) return op === "in" || op === "eq" ? NONE : ALL;
  const match = stateIdsInGroups(ctx, groups);
  return op === "eq" || op === "in" ? match : not(match);
}

function compareMulti(ctx: TesseraContext, field: (typeof MULTI_FIELDS)[number], op: RichFilterOp, value: unknown): SQL {
  if (op === "is_null") return hasNone(ctx, field);
  if (op === "is_not_null") return not(hasNone(ctx, field));
  const ids = op === "eq" || op === "neq" ? [oneString(value) ?? ""] : (strings(value) ?? []);
  const match = hasAny(ctx, field, ids.filter((id) => id !== ""));
  if (op === "eq" || op === "in") return match;
  return not(match);
}

function likeContains(raw: string): SQL {
  const escaped = raw.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`);
  return sql`lower(${work_item.name}) LIKE ${"%" + escaped + "%"} ESCAPE '\\'`;
}

function compareName(op: RichFilterOp, value: unknown): SQL {
  const text = oneString(value) ?? "";
  if (op === "contains") return likeContains(text);
  if (op === "eq") return eq(work_item.name, text);
  return not(eq(work_item.name, text));
}

function compareDate(field: (typeof DATE_FIELDS)[number], op: RichFilterOp, value: unknown, today: string): SQL {
  const column = dateColumn(field);
  if (op === "is_null") return isNull(column);
  if (op === "is_not_null") return isNotNull(column);
  const filter = asDateFilter(op, value);
  return dateCondition(column, TIMESTAMP_DATES.has(field), filter ?? undefined, today) ?? NONE;
}

function pointEquals(ctx: TesseraContext, values: string[]): SQL {
  if (values.length === 0) return NONE;
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(estimate_point)
      .where(and(eq(estimate_point.id, work_item.estimate_point_id), inArray(estimate_point.value, values), isNull(estimate_point.deleted_at))),
  );
}

function comparePoint(ctx: TesseraContext, op: RichFilterOp, value: unknown): SQL {
  if (op === "is_null") return isNull(work_item.estimate_point_id);
  if (op === "is_not_null") return isNotNull(work_item.estimate_point_id);
  const values = op === "eq" || op === "neq" ? [oneString(value) ?? ""] : (strings(value) ?? []);
  const match = pointEquals(ctx, values);
  if (op === "eq" || op === "in") return match;
  return or(isNull(work_item.estimate_point_id), not(match)) ?? not(match);
}

function relationExists(ctx: TesseraContext, display: RelationDisplayType): SQL {
  const mapped = RELATION_SIDE[display];
  const live = isNull(work_item_relation.deleted_at);
  const typed = eq(work_item_relation.relation_type, mapped.type);
  const from = and(eq(work_item_relation.work_item_id, work_item.id), typed, live);
  const to = and(eq(work_item_relation.related_work_item_id, work_item.id), typed, live);
  const where = mapped.side === "from" ? from : mapped.side === "to" ? to : or(from, to);
  return exists(ctx.db.select({ one: sql`1` }).from(work_item_relation).where(where));
}

function anyRelation(ctx: TesseraContext): SQL {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(work_item_relation)
      .where(
        and(
          isNull(work_item_relation.deleted_at),
          or(eq(work_item_relation.work_item_id, work_item.id), eq(work_item_relation.related_work_item_id, work_item.id)),
        ),
      ),
  );
}

function compareRelation(ctx: TesseraContext, op: RichFilterOp, value: unknown): SQL {
  if (op === "is_null") return not(anyRelation(ctx));
  if (op === "is_not_null") return anyRelation(ctx);
  const list = (strings(value) ?? []).filter((entry): entry is RelationDisplayType => (RELATION_DISPLAY_TYPES as readonly string[]).includes(entry));
  if (list.length === 0) return op === "in" ? NONE : ALL;
  const match = or(...list.map((entry) => relationExists(ctx, entry))) ?? NONE;
  return op === "in" ? match : not(match);
}

function blocked(want: boolean): SQL {
  // Raw SQL so the outer work_item row is not shadowed by the blocker join.
  const match = sql`EXISTS (
    SELECT 1 FROM work_item_relation AS rel
    INNER JOIN work_item AS blocker ON blocker.id = rel.related_work_item_id
    INNER JOIN state AS blocker_state ON blocker_state.id = blocker.state_id
    WHERE rel.work_item_id = ${work_item.id}
      AND rel.relation_type = 'blocked_by'
      AND rel.deleted_at IS NULL
      AND blocker.deleted_at IS NULL
      AND blocker_state.state_group NOT IN ('completed', 'cancelled')
  )`;
  return want ? match : not(match);
}

function leaf(ctx: TesseraContext, node: RichFilterCondition, today: string): SQL {
  const { field, op, value } = node;
  if ((ID_FIELDS as readonly string[]).includes(field)) return compareIds(ctx, field as (typeof ID_FIELDS)[number], op, value);
  if ((ENUM_FIELDS as readonly string[]).includes(field)) return compareEnums(ctx, field as (typeof ENUM_FIELDS)[number], op, value);
  if ((MULTI_FIELDS as readonly string[]).includes(field)) return compareMulti(ctx, field as (typeof MULTI_FIELDS)[number], op, value);
  if (field === "name") return compareName(op, value);
  if ((DATE_FIELDS as readonly string[]).includes(field)) return compareDate(field as (typeof DATE_FIELDS)[number], op, value, today);
  if (field === "estimate_point") return comparePoint(ctx, op, value);
  if (field === "blocked") return blocked(value === true);
  return compareRelation(ctx, op, value);
}

function compile(ctx: TesseraContext, node: RichFilters, today: string): SQL {
  if (isLeaf(node)) return leaf(ctx, node, today);
  if ("not" in node) return not(compile(ctx, node.not, today));
  const children = ("and" in node ? node.and : "or" in node ? node.or : []).map((child) => compile(ctx, child, today));
  return ("and" in node ? and(...children) : or(...children)) ?? NONE;
}

/** WHERE fragment for a validated tree. `today` resolves relative date tokens. */
export function buildRichWhere(ctx: TesseraContext, tree: RichFilters, options: { today: string }): SQL {
  validateRichFilters(tree);
  return compile(ctx, tree, options.today);
}
