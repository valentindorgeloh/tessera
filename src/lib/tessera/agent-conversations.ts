/**
 * Superagent chat list (decision 146; docs/contracts/ui.md "Superagent chat"):
 * the work items an actor is in a conversation on, with the newest live
 * comment of each. A plain service read, not a tool. An item qualifies when
 * the actor is an assignee, is mentioned in the item or in one of its live
 * comments, or its id is passed as an extra (an item with a runner request).
 */
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { TesseraContext } from "./core/context";
import { formatKey } from "./core/keys";
import { actor, comment, mention, project, work_item, work_item_assignee } from "./db/schema";
import { commentSnippet } from "./comments";

export type AgentConversationRow = {
  work_item_id: string;
  /** `formatKey(project.identifier, sequence_id)`. */
  key: string;
  name: string;
  project_id: string;
  project_name: string;
  is_archived: boolean;
  /** The newest live comment, `snippet` being `commentSnippet(body_md)`. */
  last_comment: { actor_id: string; actor_name: string; snippet: string; created_at: string } | null;
  /** The later of the item's `updated_at` and `last_comment.created_at`. */
  last_activity_at: string;
};

const MAX_ROWS = 200;

/** Items of `project_ids` (archived included; deleted items, drafts and deleted projects never) the actor is in a conversation on, newest activity first, then key, at most 200. */
export function listAgentConversations(
  ctx: TesseraContext,
  input: { actor_id: string; project_ids: readonly string[]; extra_work_item_ids?: readonly string[] },
): AgentConversationRow[] {
  if (input.project_ids.length === 0) return [];
  const { db } = ctx;
  const qualifies: SQL[] = [
    inArray(work_item.id, db.select({ id: work_item_assignee.work_item_id }).from(work_item_assignee).where(eq(work_item_assignee.actor_id, input.actor_id))),
    inArray(work_item.id, db.select({ id: mention.entity_id }).from(mention).where(and(eq(mention.entity_type, "work_item"), eq(mention.actor_id, input.actor_id)))),
    inArray(
      work_item.id,
      db
        .select({ id: comment.work_item_id })
        .from(mention)
        .innerJoin(comment, eq(comment.id, mention.entity_id))
        .where(and(eq(mention.entity_type, "comment"), eq(mention.actor_id, input.actor_id), isNull(comment.deleted_at))),
    ),
  ];
  if (input.extra_work_item_ids && input.extra_work_item_ids.length > 0) qualifies.push(inArray(work_item.id, [...input.extra_work_item_ids]));
  const items = db
    .select({
      id: work_item.id,
      name: work_item.name,
      sequence_id: work_item.sequence_id,
      archived_at: work_item.archived_at,
      updated_at: work_item.updated_at,
      project_id: project.id,
      project_name: project.name,
      identifier: project.identifier,
    })
    .from(work_item)
    .innerJoin(project, eq(project.id, work_item.project_id))
    .where(and(inArray(project.id, [...input.project_ids]), isNull(project.deleted_at), isNull(work_item.deleted_at), eq(work_item.is_draft, false), or(...qualifies)))
    .all();
  if (items.length === 0) return [];

  // The newest live comment per item: rows come oldest first, so the last one seen wins.
  const newest = new Map<string, { actor_id: string; body_md: string; created_at: string }>();
  const comments = db
    .select({ work_item_id: comment.work_item_id, actor_id: comment.actor_id, body_md: comment.body_md, created_at: comment.created_at })
    .from(comment)
    .where(and(inArray(comment.work_item_id, items.map((item) => item.id)), isNull(comment.deleted_at)))
    .orderBy(asc(comment.created_at), asc(comment.id))
    .all();
  for (const row of comments) newest.set(row.work_item_id, row);
  const actorIds = [...new Set([...newest.values()].map((row) => row.actor_id))];
  const names = new Map(actorIds.length === 0 ? [] : db.select({ id: actor.id, name: actor.name }).from(actor).where(inArray(actor.id, actorIds)).all().map((row) => [row.id, row.name]));

  const rows = items.map((item): AgentConversationRow => {
    const last = newest.get(item.id);
    return {
      work_item_id: item.id,
      key: formatKey(item.identifier, item.sequence_id),
      name: item.name,
      project_id: item.project_id,
      project_name: item.project_name,
      is_archived: item.archived_at !== null,
      last_comment: last
        ? { actor_id: last.actor_id, actor_name: names.get(last.actor_id) ?? "", snippet: commentSnippet(last.body_md), created_at: last.created_at }
        : null,
      last_activity_at: last && last.created_at > item.updated_at ? last.created_at : item.updated_at,
    };
  });
  rows.sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  return rows.slice(0, MAX_ROWS);
}
