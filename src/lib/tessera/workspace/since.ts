/**
 * "Since you were last here": non-user activity after the Home cursor,
 * collapsed per actor and target. A null cursor means the last 7 days.
 */
import { and, count, desc, eq, gt, gte, inArray, ne } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { formatKey } from "../core/keys";
import { activity, actor, cycle, moduleTable, page, project, work_item } from "../db/schema";
import type { HomeSummary, SinceEntry } from "../types";
import { getWorkspaceSettings } from "./settings";

const MAX_ROWS = 2000;
const MAX_ENTRIES = 20;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TARGET_TYPES = new Set(["work_item", "page", "cycle", "module", "project"]);

type Raw = {
  seq: number;
  entity_type: string;
  entity_id: string;
  work_item_id: string | null;
  verb: string;
  field: string | null;
  actor_id: string;
  created_at: string;
  actor_name: string;
  actor_kind: SinceEntry["actor"]["kind"];
  actor_color: SinceEntry["actor"]["color"];
};

function targetOf(row: Raw): { type: string; id: string } {
  if (row.work_item_id) return { type: "work_item", id: row.work_item_id };
  if (TARGET_TYPES.has(row.entity_type)) return { type: row.entity_type, id: row.entity_id };
  return { type: row.entity_type, id: row.entity_id };
}

type TargetLabel = { label: string; href: string };

function labelsFor(ctx: TesseraContext, targets: { type: string; id: string }[]): Map<string, TargetLabel> {
  const found = new Map<string, TargetLabel>();
  const ids = (type: string) => [...new Set(targets.filter((target) => target.type === type).map((target) => target.id))];
  const workIds = ids("work_item");
  if (workIds.length > 0) {
    for (const row of ctx.db
      .select({ id: work_item.id, name: work_item.name, sequence_id: work_item.sequence_id, project_id: work_item.project_id, identifier: project.identifier })
      .from(work_item)
      .innerJoin(project, eq(work_item.project_id, project.id))
      .where(inArray(work_item.id, workIds))
      .all()) {
      found.set(`work_item:${row.id}`, {
        label: `${formatKey(row.identifier, row.sequence_id)} ${row.name}`,
        href: `/projects/${row.project_id}/work-items/${row.id}`,
      });
    }
  }
  for (const row of pageIds(ctx, ids("page"))) found.set(`page:${row.id}`, { label: row.name, href: `/pages/${row.id}` });
  for (const row of cycleIds(ctx, ids("cycle"))) found.set(`cycle:${row.id}`, { label: row.name, href: `/projects/${row.project_id}/cycles/${row.id}` });
  for (const row of moduleIds(ctx, ids("module"))) found.set(`module:${row.id}`, { label: row.name, href: `/projects/${row.project_id}/modules/${row.id}` });
  const projectIds = ids("project");
  if (projectIds.length > 0) {
    for (const row of ctx.db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(inArray(project.id, projectIds))
      .all()) {
      found.set(`project:${row.id}`, { label: row.name, href: `/projects/${row.id}/work-items` });
    }
  }
  return found;
}

function pageIds(ctx: TesseraContext, ids: string[]) {
  if (ids.length === 0) return [];
  return ctx.db.select({ id: page.id, name: page.name }).from(page).where(inArray(page.id, ids)).all();
}

function cycleIds(ctx: TesseraContext, ids: string[]) {
  if (ids.length === 0) return [];
  return ctx.db.select({ id: cycle.id, name: cycle.name, project_id: cycle.project_id }).from(cycle).where(inArray(cycle.id, ids)).all();
}

function moduleIds(ctx: TesseraContext, ids: string[]) {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: moduleTable.id, name: moduleTable.name, project_id: moduleTable.project_id })
    .from(moduleTable)
    .where(inArray(moduleTable.id, ids))
    .all();
}

export function sinceLastVisit(ctx: TesseraContext, anchor_seq: number | null): HomeSummary["since"] {
  const settings = getWorkspaceSettings(ctx);
  const anchor_at = settings.last_seen_seq === anchor_seq ? settings.last_seen_at : null;
  const cutoff = new Date(new Date(ctx.now()).getTime() - SEVEN_DAYS_MS).toISOString();
  const window = and(ne(actor.kind, "user"), anchor_seq === null ? gte(activity.created_at, cutoff) : gt(activity.seq, anchor_seq));
  const total = ctx.db.select({ n: count() }).from(activity).innerJoin(actor, eq(activity.actor_id, actor.id)).where(window).get()?.n ?? 0;
  const rows = ctx.db
    .select({
      seq: activity.seq,
      entity_type: activity.entity_type,
      entity_id: activity.entity_id,
      work_item_id: activity.work_item_id,
      verb: activity.verb,
      field: activity.field,
      actor_id: activity.actor_id,
      created_at: activity.created_at,
      actor_name: actor.name,
      actor_kind: actor.kind,
      actor_color: actor.color,
    })
    .from(activity)
    .innerJoin(actor, eq(activity.actor_id, actor.id))
    .where(window)
    .orderBy(desc(activity.seq))
    .limit(MAX_ROWS)
    .all();
  const groups = new Map<string, SinceEntry>();
  for (const row of rows) {
    const target = targetOf(row);
    const key = `${row.actor_id}\0${target.type}\0${target.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.verbs.includes(row.verb)) existing.verbs.push(row.verb);
      if (row.field && !existing.fields.includes(row.field)) existing.fields.push(row.field);
      continue;
    }
    groups.set(key, {
      actor: { id: row.actor_id, name: row.actor_name, kind: row.actor_kind, color: row.actor_color },
      target: { type: target.type, id: target.id, label: target.id, href: "" },
      verbs: [row.verb],
      fields: row.field ? [row.field] : [],
      count: 1,
      last_at: row.created_at,
      last_seq: row.seq,
    });
  }
  const collapsed = [...groups.values()];
  const labels = labelsFor(ctx, collapsed.map((entry) => entry.target));
  for (const entry of collapsed) {
    const label = labels.get(`${entry.target.type}:${entry.target.id}`);
    if (!label) continue;
    entry.target.label = label.label;
    entry.target.href = label.href;
  }
  const newest = rows[0]?.seq ?? anchor_seq ?? 0;
  return {
    anchor_seq,
    anchor_at,
    latest_seq: Math.max(newest, anchor_seq ?? 0),
    entries: collapsed.slice(0, MAX_ENTRIES),
    more: Math.max(0, collapsed.length - MAX_ENTRIES) + Math.max(0, total - rows.length),
  };
}

/** Highest seq written by anyone who is not the user actor. The home digest goes stale when this moves. */
export function homeDigestSeq(ctx: TesseraContext): number {
  const row = ctx.db
    .select({ seq: activity.seq })
    .from(activity)
    .innerJoin(actor, eq(activity.actor_id, actor.id))
    .where(ne(actor.kind, "user"))
    .orderBy(desc(activity.seq))
    .limit(1)
    .get();
  return row?.seq ?? 0;
}

export function homeDigestPayload(ctx: TesseraContext): { subject: string; entries: SinceEntry[]; input_seq: number } {
  const settings = getWorkspaceSettings(ctx);
  return { subject: "Home", entries: sinceLastVisit(ctx, settings.last_seen_seq).entries, input_seq: homeDigestSeq(ctx) };
}
