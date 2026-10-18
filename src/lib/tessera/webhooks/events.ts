/**
 * Event names and payload shaping for outbound webhooks.
 */
import { eq } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { actor, project } from "../db/schema";
import type { ActivityRow } from "../types";

export type WebhookPayload = {
  id: string;
  event: string;
  seq: number | null;
  created_at: string;
  actor: { id: string; name: string; kind: string };
  project: { id: string; identifier: string } | null;
  entity_type: string;
  entity_id: string;
  work_item_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  old_identifier: string | null;
  new_identifier: string | null;
  comment: string | null;
};

/** `"work_item.updated"` from an activity row. */
export function activityEvent(row: Pick<ActivityRow, "entity_type" | "verb">): string {
  return `${row.entity_type}.${row.verb}`;
}

/**
 * True when `event` matches any pattern: `*`, `<entity>.*`, or an exact
 * `<entity>.<verb>` (or `ping`).
 */
export function matchesEvent(patterns: readonly string[], event: string): boolean {
  for (const pattern of patterns) {
    if (pattern === "*" || pattern === event) return true;
    if (pattern.endsWith(".*") && event.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

/** JSON body posted for one activity delivery. */
export function buildPayload(ctx: TesseraContext, row: ActivityRow, deliveryId: string): WebhookPayload {
  const actorRow = ctx.db.select({ id: actor.id, name: actor.name, kind: actor.kind }).from(actor).where(eq(actor.id, row.actor_id)).get();
  const projectRow =
    row.project_id === null
      ? null
      : (ctx.db.select({ id: project.id, identifier: project.identifier }).from(project).where(eq(project.id, row.project_id)).get() ?? null);
  return {
    id: deliveryId,
    event: activityEvent(row),
    seq: row.seq,
    created_at: row.created_at,
    actor: actorRow ?? { id: row.actor_id, name: row.actor_id, kind: "agent" },
    project: projectRow,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    work_item_id: row.work_item_id,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    old_identifier: row.old_identifier,
    new_identifier: row.new_identifier,
    comment: row.comment,
  };
}

/** Minimal ping body for `test_webhook`. */
export function buildPingPayload(deliveryId: string, now: string): WebhookPayload {
  return {
    id: deliveryId,
    event: "ping",
    seq: null,
    created_at: now,
    actor: { id: "", name: "", kind: "system" },
    project: null,
    entity_type: "webhook",
    entity_id: "",
    work_item_id: null,
    field: null,
    old_value: null,
    new_value: null,
    old_identifier: null,
    new_identifier: null,
    comment: null,
  };
}
