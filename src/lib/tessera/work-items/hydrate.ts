import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { notFound } from "../core/errors";
import { formatKey } from "../core/keys";
import {
  intake_item,
  project,
  work_item,
  work_item_assignee,
  work_item_label,
  work_item_link,
  work_item_module,
  work_item_subscriber,
} from "../db/schema";
import type { IntakeStatus, WorkItemLinkRow, WorkItemRow } from "../types";
import { CHUNK, ENTITY, type WorkItem } from "./model";

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

type JoinedRow = { item: WorkItemRow; identifier: string };

export function itemQuery(ctx: TesseraContext) {
  return ctx.db
    .select({ item: work_item, identifier: project.identifier })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .$dynamic();
}

function chunked<T>(values: T[]): T[][] {
  const slices: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) slices.push(values.slice(i, i + CHUNK));
  return slices;
}

function collectLists(ids: string[], fetch: (slice: string[]) => { k: string; v: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const slice of chunked(ids)) {
    for (const row of fetch(slice)) {
      const list = map.get(row.k);
      if (list) list.push(row.v);
      else map.set(row.k, [row.v]);
    }
  }
  return map;
}

function collectCounts(ids: string[], fetch: (slice: string[]) => { k: string | null; n: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const slice of chunked(ids)) {
    for (const row of fetch(slice)) if (row.k !== null) map.set(row.k, row.n);
  }
  return map;
}

export function hydrate(ctx: TesseraContext, rows: JoinedRow[]): WorkItem[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.item.id);
  const labels = collectLists(ids, (slice) =>
    ctx.db.select({ k: work_item_label.work_item_id, v: work_item_label.label_id }).from(work_item_label).where(inArray(work_item_label.work_item_id, slice)).all(),
  );
  const modules = collectLists(ids, (slice) =>
    ctx.db.select({ k: work_item_module.work_item_id, v: work_item_module.module_id }).from(work_item_module).where(inArray(work_item_module.work_item_id, slice)).all(),
  );
  const assignees = collectLists(ids, (slice) =>
    ctx.db
      .select({ k: work_item_assignee.work_item_id, v: work_item_assignee.actor_id })
      .from(work_item_assignee)
      .where(inArray(work_item_assignee.work_item_id, slice))
      .all(),
  );
  const children = collectCounts(ids, (slice) =>
    ctx.db
      .select({ k: work_item.parent_id, n: count() })
      .from(work_item)
      .where(and(inArray(work_item.parent_id, slice), isNull(work_item.deleted_at)))
      .groupBy(work_item.parent_id)
      .all(),
  );
  const links = collectCounts(ids, (slice) =>
    ctx.db
      .select({ k: work_item_link.work_item_id, n: count() })
      .from(work_item_link)
      .where(and(inArray(work_item_link.work_item_id, slice), isNull(work_item_link.deleted_at)))
      .groupBy(work_item_link.work_item_id)
      .all(),
  );
  const intakes = new Map<string, IntakeStatus>();
  for (const slice of chunked(ids)) {
    const found = ctx.db
      .select({ k: intake_item.work_item_id, status: intake_item.status })
      .from(intake_item)
      .where(and(inArray(intake_item.work_item_id, slice), isNull(intake_item.deleted_at)))
      .all();
    for (const row of found) intakes.set(row.k, row.status);
  }
  return rows.map(({ item, identifier }) => {
    const status = intakes.get(item.id);
    return {
      ...item,
      key: formatKey(identifier, item.sequence_id),
      label_ids: labels.get(item.id) ?? [],
      module_ids: modules.get(item.id) ?? [],
      assignee_ids: assignees.get(item.id) ?? [],
      sub_items_count: children.get(item.id) ?? 0,
      links_count: links.get(item.id) ?? 0,
      intake: status === undefined ? null : { status },
    };
  });
}

/** Fresh list view model of one item (deleted rows are NOT_FOUND). */
export function loadWorkItem(ctx: TesseraContext, id: string): WorkItem {
  const row = itemQuery(ctx)
    .where(and(eq(work_item.id, id), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound(ENTITY, id);
  return hydrate(ctx, [row])[0];
}

export function listSubscriberIds(ctx: TesseraContext, id: string): string[] {
  return ctx.db
    .select({ actor_id: work_item_subscriber.actor_id })
    .from(work_item_subscriber)
    .where(eq(work_item_subscriber.work_item_id, id))
    .all()
    .map((row) => row.actor_id);
}

export function listLinks(ctx: TesseraContext, id: string): WorkItemLinkRow[] {
  return ctx.db
    .select()
    .from(work_item_link)
    .where(and(eq(work_item_link.work_item_id, id), isNull(work_item_link.deleted_at)))
    .orderBy(asc(work_item_link.sort_order), asc(work_item_link.created_at))
    .all();
}
