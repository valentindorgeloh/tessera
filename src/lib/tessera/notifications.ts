/**
 * Inbox notifications (docs/drafts/p7-plan.md). `logActivity` calls
 * `notifyFromActivity` inside the same transaction, so a state change or
 * comment cannot land without the subscriber rows. The actor never receives
 * their own notification. An unread row for the same recipient, kind and work
 * item is updated in place.
 */
import { and, count, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey } from "./core/keys";
import { assertInTransaction, withTx } from "./core/tx";
import { actor, mention, notification, project, work_item, work_item_subscriber } from "./db/schema";
import { IdSchema } from "./schemas";
import type { ActivityEntry } from "./activity";
import type { ActorKind } from "./types";

const SNIPPET_LIMIT = 280;
const LIST_LIMIT = 200;

export type NotificationView = {
  uid: string;
  seq: number;
  kind: string;
  title: string;
  snippet: string;
  work_item_id: string | null;
  work_item_key: string | null;
  actor_name: string | null;
  actor_kind: ActorKind | null;
  read_at: string | null;
  archived_at: string | null;
  snoozed_till: string | null;
  is_snoozed: boolean;
  event_count: number;
  sort_at: string;
  created_at: string;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
};

const IdsInput = z
  .object({
    ids: z.array(IdSchema).max(LIST_LIMIT).describe("Notification uids. When all is true and this is empty, every unread unarchived notification for the caller is updated."),
    all: z.boolean().optional().describe("With an empty ids list, mark every unread unarchived notification for the caller."),
  })
  .strict();

const SnoozeInput = IdsInput.extend({
  until: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "expected an ISO-8601 timestamp")
    .describe("ISO-8601 instant when the notification returns to the inbox."),
}).strict();

const ListInput = z
  .object({
    limit: z.number().int().min(1).max(LIST_LIMIT).optional().describe("How many notifications to return, newest first. Defaults to 200."),
  })
  .strict();

type Ids = z.infer<typeof IdsInput>;

/** Writes subscriber notifications for this activity row. No-op for verbs the inbox does not surface. */
export function notifyFromActivity(ctx: TesseraContext, entry: ActivityEntry): void {
  assertInTransaction(ctx, "notifyFromActivity");
  const kind = kindFor(entry);
  const workItemId = entry.work_item_id ?? null;
  if (kind === null || workItemId === null) return;
  const item = loadItem(ctx, workItemId);
  if (!item) return;
  const recipients = recipientsFor(ctx, kind, workItemId, entry);
  writeRows(ctx, recipients, {
    kind,
    title: item.name,
    snippet: snippetOf(entry),
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    work_item_id: item.id,
    project_id: item.project_id,
  });
}

/** One `mentioned` row per actor. Call after the mention rows exist. */
export function notifyMentions(
  ctx: TesseraContext,
  input: { work_item_id: string; entity_type: string; entity_id: string; actor_ids: string[]; snippet: string },
): void {
  assertInTransaction(ctx, "notifyMentions");
  const item = loadItem(ctx, input.work_item_id);
  if (!item) return;
  const recipients = input.actor_ids.filter((id) => id !== ctx.actor.id);
  writeRows(ctx, recipients, {
    kind: "mentioned",
    title: item.name,
    snippet: input.snippet.slice(0, SNIPPET_LIMIT),
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    work_item_id: item.id,
    project_id: item.project_id,
  });
}

/** Count of the caller's notifications that are unread, not archived, and not currently snoozed. */
export function getUnreadCount(ctx: TesseraContext): number {
  const now = ctx.now();
  const row = ctx.db
    .select({ n: count() })
    .from(notification)
    .where(
      and(
        eq(notification.recipient_actor_id, ctx.actor.id),
        isNull(notification.read_at),
        isNull(notification.archived_at),
        or(isNull(notification.snoozed_till), lte(notification.snoozed_till, now)),
      ),
    )
    .get();
  return row?.n ?? 0;
}

export function listNotifications(ctx: TesseraContext, input: z.input<typeof ListInput> = {}): NotificationView[] {
  const data = validateInput(ListInput, input);
  const limit = data.limit ?? LIST_LIMIT;
  const now = ctx.now();
  const rows = ctx.db
    .select({
      note: notification,
      identifier: project.identifier,
      sequence_id: work_item.sequence_id,
      actor_name: actor.name,
      actor_kind: actor.kind,
    })
    .from(notification)
    .leftJoin(work_item, eq(notification.work_item_id, work_item.id))
    .leftJoin(project, eq(work_item.project_id, project.id))
    .leftJoin(actor, eq(notification.actor_id, actor.id))
    .where(eq(notification.recipient_actor_id, ctx.actor.id))
    .orderBy(desc(notification.seq))
    .limit(limit)
    .all();
  return rows.map((row) => ({
    uid: row.note.uid,
    seq: row.note.seq,
    kind: row.note.kind,
    title: row.note.title,
    snippet: row.note.snippet,
    work_item_id: row.note.work_item_id,
    work_item_key: row.identifier !== null && row.sequence_id !== null ? formatKey(row.identifier, row.sequence_id) : null,
    actor_name: row.actor_name,
    actor_kind: row.actor_kind,
    read_at: row.note.read_at,
    archived_at: row.note.archived_at,
    snoozed_till: row.note.snoozed_till,
    is_snoozed: row.note.snoozed_till !== null && row.note.snoozed_till > now,
    event_count: 1,
    sort_at: row.note.created_at,
    created_at: row.note.created_at,
    project_id: row.note.project_id,
    entity_type: row.note.entity_type,
    entity_id: row.note.entity_id,
  }));
}

export function markNotificationsRead(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, true), { read_at: ctx.now() }) }));
}

export function markNotificationsUnread(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { read_at: null }) }));
}

export function archiveNotifications(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { archived_at: ctx.now(), snoozed_till: null }) }));
}

export function unarchiveNotifications(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { archived_at: null }) }));
}

export function snoozeNotifications(ctx: TesseraContext, input: z.input<typeof SnoozeInput>): { updated: number } {
  const data = validateInput(SnoozeInput, input);
  const until = new Date(data.until).toISOString();
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { snoozed_till: until }) }));
}

export function unsnoozeNotifications(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { snoozed_till: null }) }));
}

function kindFor(entry: ActivityEntry): string | null {
  if (entry.verb === "commented") return "commented";
  if (entry.field === "state_id") return "state_changed";
  if (entry.field === "assignees" && entry.verb === "added") return "assigned";
  return null;
}

function recipientsFor(ctx: TesseraContext, kind: string, workItemId: string, entry: ActivityEntry): string[] {
  if (kind === "assigned") {
    const id = entry.new_value;
    return typeof id === "string" && id !== ctx.actor.id ? [id] : [];
  }
  const mentioned = mentionedActors(ctx, entry);
  return subscriberIds(ctx, workItemId).filter((id) => id !== ctx.actor.id && !mentioned.has(id));
}

function mentionedActors(ctx: TesseraContext, entry: ActivityEntry): Set<string> {
  if (entry.verb !== "commented" || entry.entity_type !== "comment") return new Set();
  const rows = ctx.db
    .select({ actor_id: mention.actor_id })
    .from(mention)
    .where(and(eq(mention.entity_type, "comment"), eq(mention.entity_id, entry.entity_id)))
    .all();
  return new Set(rows.map((row) => row.actor_id));
}

function subscriberIds(ctx: TesseraContext, workItemId: string): string[] {
  return ctx.db
    .select({ actor_id: work_item_subscriber.actor_id })
    .from(work_item_subscriber)
    .where(eq(work_item_subscriber.work_item_id, workItemId))
    .all()
    .map((row) => row.actor_id);
}

function loadItem(ctx: TesseraContext, id: string): { id: string; name: string; project_id: string } | undefined {
  return ctx.db
    .select({ id: work_item.id, name: work_item.name, project_id: work_item.project_id })
    .from(work_item)
    .where(eq(work_item.id, id))
    .get();
}

function snippetOf(entry: ActivityEntry): string {
  const raw = entry.comment ?? entry.new_identifier ?? "";
  return raw.slice(0, SNIPPET_LIMIT);
}

type Draft = {
  kind: string;
  title: string;
  snippet: string;
  entity_type: string;
  entity_id: string;
  work_item_id: string;
  project_id: string;
};

function writeRows(ctx: TesseraContext, recipients: string[], draft: Draft): void {
  const now = ctx.now();
  for (const recipient of new Set(recipients)) {
    const existing = ctx.db
      .select({ uid: notification.uid })
      .from(notification)
      .where(
        and(
          eq(notification.recipient_actor_id, recipient),
          eq(notification.kind, draft.kind),
          eq(notification.work_item_id, draft.work_item_id),
          isNull(notification.read_at),
          isNull(notification.archived_at),
          isNull(notification.snoozed_till),
        ),
      )
      .get();
    if (existing) {
      ctx.db
        .update(notification)
        .set({
          title: draft.title,
          snippet: draft.snippet,
          actor_id: ctx.actor.id,
          entity_type: draft.entity_type,
          entity_id: draft.entity_id,
          created_at: now,
        })
        .where(eq(notification.uid, existing.uid))
        .run();
      continue;
    }
    ctx.db
      .insert(notification)
      .values({
        uid: newId(),
        recipient_actor_id: recipient,
        kind: draft.kind,
        entity_type: draft.entity_type,
        entity_id: draft.entity_id,
        work_item_id: draft.work_item_id,
        project_id: draft.project_id,
        title: draft.title,
        snippet: draft.snippet,
        actor_id: ctx.actor.id,
        created_at: now,
      })
      .run();
  }
}

function resolveIds(ctx: TesseraContext, input: Ids, unreadWhenAll: boolean): string[] {
  if (unreadWhenAll && input.all === true && input.ids.length === 0) {
    return ctx.db
      .select({ uid: notification.uid })
      .from(notification)
      .where(and(eq(notification.recipient_actor_id, ctx.actor.id), isNull(notification.read_at), isNull(notification.archived_at)))
      .all()
      .map((row) => row.uid);
  }
  if (input.ids.length === 0) throw validation({ ids: "required" }, "Pick at least one notification");
  const owned = ctx.db
    .select({ uid: notification.uid })
    .from(notification)
    .where(and(eq(notification.recipient_actor_id, ctx.actor.id), inArray(notification.uid, input.ids)))
    .all()
    .map((row) => row.uid);
  if (owned.length === 0) throw notFound("notification", input.ids[0]);
  return owned;
}

function apply(ctx: TesseraContext, uids: string[], patch: Partial<typeof notification.$inferInsert>): number {
  if (uids.length === 0) return 0;
  const result = ctx.db
    .update(notification)
    .set(patch)
    .where(and(eq(notification.recipient_actor_id, ctx.actor.id), inArray(notification.uid, uids)))
    .run();
  return result.changes;
}
