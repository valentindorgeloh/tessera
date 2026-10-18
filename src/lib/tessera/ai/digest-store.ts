/**
 * Stored digests (decision 34, decision 37). Rows are bookkeeping: no activity,
 * no change cursor. A digest is stale when newer activity exists.
 *
 * An inbox digest is keyed by the recipient actor id. Its input is that
 * actor's unread inbox (not archived, not snoozed) and the activity rows
 * those notifications point at. Opening a page only reads a stored row.
 */
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { getActor } from "../actors";
import { collapseDescriptionEdits, listActivity, maxFeedSeq, type ActivityLogEntry } from "../changes";
import type { TesseraContext } from "../core/context";
import { formatKey } from "../core/keys";
import { activity, actor, ai_digest, notification, project, work_item } from "../db/schema";
import { getCycle } from "../cycles";
import { getModule } from "../modules";
import type { DigestKind, DigestView } from "../types";

const INBOX_NOTE_LIMIT = 200;
const INBOX_ACTIVITY_LIMIT = 300;

/** One unread inbox row, plus the fields that locate the activity it covers. */
export type InboxDigestNote = {
  kind: string;
  title: string;
  snippet: string;
  work_item_key: string | null;
  actor_name: string | null;
  created_at: string;
};

type UnreadNote = InboxDigestNote & {
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  work_item_id: string | null;
};

export type DigestInputs = {
  subject: string;
  activity: ActivityLogEntry[];
  input_seq: number;
  notifications?: InboxDigestNote[];
};

export function currentDigestSeq(ctx: TesseraContext, kind: DigestKind, id: string): number {
  if (kind === "inbox") return inboxInputs(ctx, id).input_seq;
  return maxFeedSeq(ctx, kind === "cycle" ? { cycle_id: id } : { module_id: id });
}

export function digestInputs(ctx: TesseraContext, kind: DigestKind, id: string): DigestInputs {
  if (kind === "inbox") return inboxInputs(ctx, id);
  const subject = kind === "cycle" ? getCycle(ctx, id).name : getModule(ctx, id).name;
  const activityRows = listActivity(ctx, kind === "cycle" ? { cycle_id: id, limit: 300 } : { module_id: id, limit: 300 });
  return { subject, activity: activityRows, input_seq: currentDigestSeq(ctx, kind, id) };
}

function inboxInputs(ctx: TesseraContext, actorId: string): DigestInputs {
  getActor(ctx, actorId);
  const notes = unreadInbox(ctx, actorId);
  const activityRows = coveredActivity(ctx, notes);
  const input_seq = activityRows.reduce((max, row) => Math.max(max, row.last_seq), 0);
  return {
    subject: "Inbox",
    notifications: notes.map(toDigestNote),
    activity: activityRows,
    input_seq,
  };
}

/** Unread, not archived, and not snoozed past now. Newest first, capped like the inbox list. */
function unreadInbox(ctx: TesseraContext, actorId: string): UnreadNote[] {
  const now = ctx.now();
  const rows = ctx.db
    .select({
      entity_type: notification.entity_type,
      entity_id: notification.entity_id,
      actor_id: notification.actor_id,
      work_item_id: notification.work_item_id,
      kind: notification.kind,
      title: notification.title,
      snippet: notification.snippet,
      identifier: project.identifier,
      sequence_id: work_item.sequence_id,
      actor_name: actor.name,
      created_at: notification.created_at,
    })
    .from(notification)
    .leftJoin(work_item, eq(notification.work_item_id, work_item.id))
    .leftJoin(project, eq(work_item.project_id, project.id))
    .leftJoin(actor, eq(notification.actor_id, actor.id))
    .where(
      and(
        eq(notification.recipient_actor_id, actorId),
        isNull(notification.read_at),
        isNull(notification.archived_at),
        or(isNull(notification.snoozed_till), lte(notification.snoozed_till, now)),
      ),
    )
    .orderBy(desc(notification.seq))
    .limit(INBOX_NOTE_LIMIT)
    .all();
  return rows.map((row) => ({
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    actor_id: row.actor_id,
    work_item_id: row.work_item_id,
    kind: row.kind,
    title: row.title,
    snippet: row.snippet,
    work_item_key: row.identifier !== null && row.sequence_id !== null ? formatKey(row.identifier, row.sequence_id) : null,
    actor_name: row.actor_name,
    created_at: row.created_at,
  }));
}

/**
 * Activity that shares the notification's entity, causing actor and work item.
 * Newest 300, returned oldest first with description edits collapsed, matching
 * the cycle and module feeds.
 */
function coveredActivity(ctx: TesseraContext, notes: UnreadNote[]): ActivityLogEntry[] {
  if (notes.length === 0) return [];
  const matches = notes.map((note) =>
    and(
      eq(activity.entity_type, note.entity_type),
      eq(activity.entity_id, note.entity_id),
      note.actor_id === null ? isNull(activity.actor_id) : eq(activity.actor_id, note.actor_id),
      note.work_item_id === null ? isNull(activity.work_item_id) : eq(activity.work_item_id, note.work_item_id),
    ),
  );
  const rows = ctx.db
    .select({ row: activity, actor_name: actor.name })
    .from(activity)
    .leftJoin(actor, eq(activity.actor_id, actor.id))
    .where(or(...matches))
    .orderBy(desc(activity.seq))
    .limit(INBOX_ACTIVITY_LIMIT)
    .all();
  return collapseDescriptionEdits([...rows].reverse());
}

function toDigestNote(note: UnreadNote): InboxDigestNote {
  return {
    kind: note.kind,
    title: note.title,
    snippet: note.snippet,
    work_item_key: note.work_item_key,
    actor_name: note.actor_name,
    created_at: note.created_at,
  };
}

function toView(row: typeof ai_digest.$inferSelect, current: number): DigestView {
  return {
    kind: row.kind,
    entity_id: row.entity_id,
    body_md: row.body_md,
    input_seq: row.input_seq,
    model: row.model,
    created_at: row.created_at,
    is_stale: current > row.input_seq,
  };
}

export function getStoredDigest(ctx: TesseraContext, kind: DigestKind, id: string): DigestView | null {
  const row = ctx.db.select().from(ai_digest).where(and(eq(ai_digest.kind, kind), eq(ai_digest.entity_id, id))).get();
  if (!row) return null;
  return toView(row, currentDigestSeq(ctx, kind, id));
}

export function saveDigest(ctx: TesseraContext, row: { kind: DigestKind; entity_id: string; input_seq: number; body_md: string; model: string }): DigestView {
  const saved = ctx.db
    .insert(ai_digest)
    .values({ ...row, created_at: ctx.now() })
    .onConflictDoUpdate({
      target: [ai_digest.kind, ai_digest.entity_id],
      set: { input_seq: row.input_seq, body_md: row.body_md, model: row.model, created_at: ctx.now() },
    })
    .returning()
    .get();
  return toView(saved, row.input_seq);
}
