/**
 * Inbox notifications (docs/drafts/p7-plan.md, decisions 49-52). `logActivity`
 * calls `notifyFromActivity` inside the same transaction, so a state change or
 * comment cannot land without the subscriber rows. Who never receives is
 * decision 50 (`deliverable`). A new event merges into the recipient's newest
 * row for the same work item and causing actor while that row is unread, not
 * archived, not snoozed and under `COALESCE_WINDOW_MS` old (decision 51);
 * otherwise it adds a row. Rows are listed by `sort_at` (decision 52).
 */
import { and, count, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput, validation } from "./core/errors";
import { newId } from "./core/ids";
import { formatKey } from "./core/keys";
import { assertInTransaction, withTx } from "./core/tx";
import { actor, mention, notification, page, project, work_item, work_item_assignee, work_item_subscriber } from "./db/schema";
import { IdSchema, NotificationKindSchema, type NotificationKind } from "./schemas";
import type { ActivityEntry } from "./activity";
import type { ActorKind } from "./types";

const SNIPPET_LIMIT = 280;
const LIST_LIMIT = 200;
/** Built-in user actor. Duplicated here so this module does not import actors.ts (that module imports activity, which imports this file). */
const USER_ACTOR_ID = "00000000-0000-7000-8000-000000000001";

/** A new event merges into the newest matching row only while its `sort_at` is under this old (decision 51). */
export const COALESCE_WINDOW_MS = 10 * 60_000;
/** Kind rank, 0 = highest: when rows merge the higher-ranked kind wins (decision 51). */
export const NOTIFICATION_KIND_RANK: Readonly<Record<NotificationKind, number>> = Object.fromEntries(
  NotificationKindSchema.options.map((kind, index) => [kind, index]),
) as Record<NotificationKind, number>;
/** Activity verbs that never notify. */
const SILENT_VERBS = new Set(["created", "copied", "reacted", "unreacted"]);

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

/** Writes the notifications this activity row causes. No-op for rows the inbox does not surface. */
export function notifyFromActivity(ctx: TesseraContext, entry: ActivityEntry): void {
  assertInTransaction(ctx, "notifyFromActivity");
  const workItemId = entry.work_item_id ?? null;
  let kind = kindFor(entry);
  // An automation's own note replaces the ordinary state or archive kind (decision 28).
  if (ctx.activityNote && workItemId !== null && (entry.field === "state_id" || entry.verb === "archived")) kind = "automation";
  if (kind === null) return;
  if (workItemId === null) {
    notifyPageMention(ctx, kind, entry);
    return;
  }
  const item = loadItem(ctx, workItemId);
  if (!item) return;
  const recipients = deliverable(ctx, recipientsFor(ctx, kind, workItemId, entry));
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

/** A page mention (decision 53) has no work item: the row names the page and opens it. */
function notifyPageMention(ctx: TesseraContext, kind: NotificationKind, entry: ActivityEntry): void {
  if (kind !== "mentioned" || entry.entity_type !== "page" || typeof entry.new_value !== "string") return;
  const row = ctx.db.select({ id: page.id, name: page.name, project_id: page.project_id }).from(page).where(eq(page.id, entry.entity_id)).get();
  if (!row) return;
  writeRows(ctx, deliverable(ctx, [entry.new_value]), {
    kind,
    title: row.name,
    snippet: snippetOf(entry),
    entity_type: "page",
    entity_id: row.id,
    work_item_id: null,
    project_id: row.project_id,
  });
}

/**
 * Tells the user that someone other than them submitted a work item to Intake.
 * The assistant never announces its own creates. Call inside the create transaction.
 */
export function notifyIntakeReceived(
  ctx: TesseraContext,
  input: { intake_item_id: string; work_item_id: string; project_id: string; title: string; key: string },
): void {
  assertInTransaction(ctx, "notifyIntakeReceived");
  if (ctx.actor.kind === "user" || ctx.actor.kind === "assistant") return;
  writeRows(ctx, [USER_ACTOR_ID], {
    kind: "intake_received",
    title: input.title,
    snippet: `${ctx.actor.name} submitted ${input.key} to Intake`,
    entity_type: "intake_item",
    entity_id: input.intake_item_id,
    work_item_id: input.work_item_id,
    project_id: input.project_id,
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
    .orderBy(desc(notification.sort_at), desc(notification.seq))
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
    event_count: row.note.event_count,
    sort_at: row.note.sort_at,
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
  return withTx(ctx, () => {
    const uids = resolveIds(ctx, data, false);
    const now = ctx.now();
    // A still-snoozed row leaves its future sort_at behind when archived (decision 52). Archive keeps read_at.
    ctx.db
      .update(notification)
      .set({ sort_at: now })
      .where(and(eq(notification.recipient_actor_id, ctx.actor.id), inArray(notification.uid, uids), gt(notification.snoozed_till, now)))
      .run();
    return { updated: apply(ctx, uids, { archived_at: now, snoozed_till: null }) };
  });
}

export function unarchiveNotifications(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { archived_at: null }) }));
}

export function snoozeNotifications(ctx: TesseraContext, input: z.input<typeof SnoozeInput>): { updated: number } {
  const data = validateInput(SnoozeInput, input);
  const until = new Date(data.until).toISOString();
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { snoozed_till: until, sort_at: until, read_at: null }) }));
}

export function unsnoozeNotifications(ctx: TesseraContext, input: z.input<typeof IdsInput>): { updated: number } {
  const data = validateInput(IdsInput, input);
  return withTx(ctx, () => ({ updated: apply(ctx, resolveIds(ctx, data, false), { snoozed_till: null, sort_at: ctx.now() }) }));
}

/** The notification kind an activity row causes, or null (decision 51). */
function kindFor(entry: ActivityEntry): NotificationKind | null {
  if (SILENT_VERBS.has(entry.verb)) return null;
  // sort_order is a drag. subscribers rows are bookkeeping (ASSUMPTION: an agent's first comment logs "added subscribers" before "commented", which would otherwise merge into "commented 2 times").
  if (entry.field === "sort_order" || entry.field === "subscribers") return null;
  if (entry.field === "mention") return entry.verb === "added" ? "mentioned" : null;
  if (entry.verb === "commented") return "commented";
  if (entry.field === "state_id") return "state_changed";
  if (entry.field === "assignees" && entry.verb === "added") return "assigned";
  // Any other change to the work item itself. Comment edits and deletes, intake and draft rows stay silent (ASSUMPTION).
  return entry.entity_type === "work_item" ? "updated" : null;
}

/** Decision 50: never the causing actor, system or assistant actors, deleted actors, nor the user when the assistant caused it. */
function deliverable(ctx: TesseraContext, ids: readonly string[]): string[] {
  const wanted = [...new Set(ids)].filter((id) => id !== ctx.actor.id);
  if (wanted.length === 0) return [];
  const rows = ctx.db.select({ id: actor.id, kind: actor.kind, deleted_at: actor.deleted_at }).from(actor).where(inArray(actor.id, wanted)).all();
  return rows
    .filter((row) => row.deleted_at === null && row.kind !== "system" && row.kind !== "assistant" && !(ctx.actor.kind === "assistant" && row.kind === "user"))
    .map((row) => row.id);
}

/** Actors that get no `updated` row while `withoutUpdatedFor` runs, per connection. */
const heldBack = new WeakMap<object, Set<string>>();

/**
 * Runs `fn` so the `updated` rows it logs skip `ids`. A description save that
 * newly mentions an actor tells them once (`mentioned`), not also "updated this"
 * (decision 53): the caller passes the ids `syncMentions` just added.
 */
export function withoutUpdatedFor<T>(ctx: TesseraContext, ids: readonly string[], fn: () => T): T {
  const previous = heldBack.get(ctx.sqlite);
  heldBack.set(ctx.sqlite, new Set([...(previous ?? []), ...ids]));
  try {
    return fn();
  } finally {
    if (previous) heldBack.set(ctx.sqlite, previous);
    else heldBack.delete(ctx.sqlite);
  }
}

function recipientsFor(ctx: TesseraContext, kind: NotificationKind, workItemId: string, entry: ActivityEntry): string[] {
  if (kind === "assigned" || kind === "mentioned") return typeof entry.new_value === "string" ? [entry.new_value] : [];
  if (kind === "automation") return [...new Set([...subscriberIds(ctx, workItemId), ...assigneeIds(ctx, workItemId)])];
  const mentioned = mentionedActors(ctx, entry);
  const held = kind === "updated" ? heldBack.get(ctx.sqlite) : undefined;
  return subscriberIds(ctx, workItemId).filter((id) => !mentioned.has(id) && !held?.has(id));
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

function assigneeIds(ctx: TesseraContext, workItemId: string): string[] {
  return ctx.db
    .select({ actor_id: work_item_assignee.actor_id })
    .from(work_item_assignee)
    .where(eq(work_item_assignee.work_item_id, workItemId))
    .all()
    .map((row) => row.actor_id);
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
  kind: NotificationKind;
  title: string;
  snippet: string;
  entity_type: string;
  entity_id: string;
  work_item_id: string | null;
  project_id: string | null;
};

function rankOf(kind: string): number {
  return NOTIFICATION_KIND_RANK[kind as NotificationKind] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The recipient's newest row for this work item and causing actor, when it may
 * still absorb a new event: unread, not archived, not snoozed, and its
 * `sort_at` strictly under the window old (decision 51). Older rows never merge.
 */
function coalesceTarget(ctx: TesseraContext, recipient: string, workItemId: string, now: string) {
  const newest = ctx.db
    .select()
    .from(notification)
    .where(and(eq(notification.recipient_actor_id, recipient), eq(notification.work_item_id, workItemId), eq(notification.actor_id, ctx.actor.id)))
    .orderBy(desc(notification.seq))
    .limit(1)
    .get();
  if (!newest || newest.read_at !== null || newest.archived_at !== null) return undefined;
  if (newest.snoozed_till !== null && newest.snoozed_till > now) return undefined;
  const age = Date.parse(now) - Date.parse(newest.sort_at);
  return age < COALESCE_WINDOW_MS ? newest : undefined;
}

function writeRows(ctx: TesseraContext, recipients: string[], draft: Draft): void {
  const now = ctx.now();
  for (const recipient of new Set(recipients)) {
    // A row without a work item (a page mention) never coalesces.
    const target = draft.work_item_id === null ? undefined : coalesceTarget(ctx, recipient, draft.work_item_id, now);
    if (target) {
      ctx.db
        .update(notification)
        .set({
          kind: rankOf(draft.kind) < rankOf(target.kind) ? draft.kind : target.kind,
          title: draft.title,
          snippet: draft.snippet,
          entity_type: draft.entity_type,
          entity_id: draft.entity_id,
          event_count: target.event_count + 1,
          sort_at: now,
        })
        .where(eq(notification.uid, target.uid))
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
        event_count: 1,
        sort_at: now,
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
      .where(
        and(
          eq(notification.recipient_actor_id, ctx.actor.id),
          isNull(notification.read_at),
          isNull(notification.archived_at),
          // A snoozed row stays unread until it wakes (decision 52).
          or(isNull(notification.snoozed_till), lte(notification.snoozed_till, ctx.now())),
        ),
      )
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
