/**
 * Comments on work items. Threads are one level deep: a reply to a reply
 * attaches to its root. An update is author-only and compare-and-swaps
 * body_version. A delete is allowed to the author and to the user, and
 * soft-deletes the replies too. Archived items are read-only.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { getActor } from "./actors";
import type { TesseraContext } from "./core/context";
import { conflict, isTrackerError, notFound, rule, validation, validateInput } from "./core/errors";
import { isId, newId } from "./core/ids";
import { withTx } from "./core/tx";
import { actor, comment, mention } from "./db/schema";
import { IdSchema } from "./schemas";
import type { ActorKind, CommentRow } from "./types";
import { notifyMentions } from "./notifications";
import { reactionsFor, type ReactionSummary } from "./reactions";
import { getWorkItemRow, insertSubscriber, loadWritableWorkItem } from "./work-items";

const BODY = z.string().trim().min(1).max(50_000);
const SNIPPET_LIMIT = 140;

export const CreateCommentInput = z
  .object({
    body_md: BODY.describe("Comment body in markdown, from 1 to 50,000 characters."),
    parent_comment_id: IdSchema.optional().describe("Comment being replied to. A reply to a reply attaches to the root."),
  })
  .strict();

export const UpdateCommentInput = z
  .object({
    body_md: BODY.describe("Replacement comment body in markdown, from 1 to 50,000 characters."),
    expected_body_version: z.number().int().min(0).describe("body_version the caller last read. A mismatch is CONFLICT."),
  })
  .strict();

export type CommentView = CommentRow & {
  actor_name: string;
  actor_kind: ActorKind;
  reactions: ReactionSummary[];
  replies: CommentView[];
};

type ActorInfo = { name: string; kind: ActorKind };

/** Drops code fences, link targets and markdown marks, then keeps 140 characters. */
export function commentSnippet(md: string): string {
  let text = md.replace(/\r\n/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/```[\s\S]*$/g, " ");
  text = stripMarks(text);
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\s+/g, " ").trim();
  return clip(text, SNIPPET_LIMIT);
}

function stripMarks(text: string): string {
  let next = text;
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    const stripped = next.replace(/(\*\*|__|~~|`)([\s\S]*?)\1/g, "$2").replace(/(^|\s)([*_])(\S(?:.*?\S)?)\2(?=\s|$)/g, "$1$3");
    if (stripped === next) return next;
    next = stripped;
  }
  return next;
}

/** Actor ids written as `[@Name](actor:<id>)`. Unknown ids are dropped by `syncMentions`. */
function mentionedActorIds(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\]\(actor:([^)]+)\)/gi)) {
    const id = match[1];
    if (isId(id)) found.add(id);
  }
  return [...found];
}

function syncMentions(ctx: TesseraContext, loaded: ReturnType<typeof loadWritableWorkItem>, commentId: string, body: string): string[] {
  const ids = mentionedActorIds(body).filter((id) => id !== ctx.actor.id);
  ctx.db.delete(mention).where(and(eq(mention.entity_type, "comment"), eq(mention.entity_id, commentId))).run();
  const live: string[] = [];
  for (const id of ids) {
    try {
      getActor(ctx, id);
    } catch (err) {
      if (isTrackerError(err) && err.code === "NOT_FOUND") continue;
      throw err;
    }
    ctx.db.insert(mention).values({ entity_type: "comment", entity_id: commentId, actor_id: id, created_at: ctx.now() }).run();
    insertSubscriber(ctx, loaded, id);
    live.push(id);
  }
  return live;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const tail = text.charCodeAt(end - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function loadLiveComment(ctx: TesseraContext, id: string): CommentRow {
  const row = ctx.db
    .select()
    .from(comment)
    .where(and(eq(comment.id, id), isNull(comment.deleted_at)))
    .get();
  if (!row) throw notFound("comment", id);
  return row;
}

function loadLiveForItem(ctx: TesseraContext, workItemId: string): CommentRow[] {
  return ctx.db
    .select()
    .from(comment)
    .where(and(eq(comment.work_item_id, workItemId), isNull(comment.deleted_at)))
    .orderBy(asc(comment.created_at), asc(comment.id))
    .all();
}

function actorsById(ctx: TesseraContext, ids: readonly string[]): Map<string, ActorInfo> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = ctx.db.select({ id: actor.id, name: actor.name, kind: actor.kind }).from(actor).where(inArray(actor.id, unique)).all();
  return new Map(rows.map((row) => [row.id, { name: row.name, kind: row.kind }]));
}

function nest(ctx: TesseraContext, rows: CommentRow[]): CommentView[] {
  const actors = actorsById(ctx, rows.map((row) => row.actor_id));
  const reactions = reactionsFor(ctx, "comment", rows.map((row) => row.id));
  const live = new Set(rows.map((row) => row.id));
  const replies = new Map<string, CommentView[]>();
  const roots: CommentView[] = [];
  for (const row of rows) {
    const info = actors.get(row.actor_id);
    if (!info) throw notFound("actor", row.actor_id);
    const view: CommentView = {
      ...row,
      actor_name: info.name,
      actor_kind: info.kind,
      reactions: reactions.get(row.id) ?? [],
      replies: [],
    };
    const parentId = row.parent_comment_id;
    if (parentId && live.has(parentId)) {
      const list = replies.get(parentId) ?? [];
      list.push(view);
      replies.set(parentId, list);
    } else {
      roots.push(view);
    }
  }
  for (const root of roots) root.replies = replies.get(root.id) ?? [];
  return roots;
}

function viewOf(ctx: TesseraContext, row: CommentRow): CommentView {
  if (row.parent_comment_id) {
    const info = getActor(ctx, row.actor_id);
    const reactions = reactionsFor(ctx, "comment", [row.id]).get(row.id) ?? [];
    return { ...row, actor_name: info.name, actor_kind: info.kind, reactions, replies: [] };
  }
  const found = nest(ctx, loadLiveForItem(ctx, row.work_item_id)).find((view) => view.id === row.id);
  if (!found) throw notFound("comment", row.id);
  return found;
}

/** Roots oldest first, replies nested under them. Live comments only. */
export function listComments(ctx: TesseraContext, workItemId: string): CommentView[] {
  getWorkItemRow(ctx, workItemId);
  return nest(ctx, loadLiveForItem(ctx, workItemId));
}

export function getComment(ctx: TesseraContext, id: string): CommentView {
  return viewOf(ctx, loadLiveComment(ctx, id));
}

/** Walks to the root so a reply to a reply stays one level deep. */
function resolveParentId(ctx: TesseraContext, workItemId: string, parentId: string): string {
  let current = loadLiveComment(ctx, parentId);
  const seen = new Set<string>();
  while (current.parent_comment_id) {
    if (current.work_item_id !== workItemId) {
      throw validation({ parent_comment_id: parentId }, "A reply must be on the same work item");
    }
    if (seen.has(current.id)) throw validation({ parent_comment_id: parentId }, "Comment thread is cyclic");
    seen.add(current.id);
    current = loadLiveComment(ctx, current.parent_comment_id);
  }
  if (current.work_item_id !== workItemId) {
    throw validation({ parent_comment_id: parentId }, "A reply must be on the same work item");
  }
  return current.id;
}

export function createComment(ctx: TesseraContext, workItemId: string, input: z.input<typeof CreateCommentInput>): CommentView {
  const data = validateInput(CreateCommentInput, input);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, workItemId);
    const parentId = data.parent_comment_id ? resolveParentId(ctx, loaded.item.id, data.parent_comment_id) : null;
    const id = newId();
    const now = ctx.now();
    ctx.db
      .insert(comment)
      .values({
        id,
        work_item_id: loaded.item.id,
        parent_comment_id: parentId,
        body_md: data.body_md,
        body_version: 0,
        actor_id: ctx.actor.id,
        edited_at: null,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .run();
    insertSubscriber(ctx, loaded, ctx.actor.id);
    const snippet = commentSnippet(data.body_md);
    const mentioned = syncMentions(ctx, loaded, id, data.body_md);
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: "comment",
      entity_id: id,
      work_item_id: loaded.item.id,
      verb: "commented",
      comment: snippet,
    });
    notifyMentions(ctx, {
      work_item_id: loaded.item.id,
      entity_type: "comment",
      entity_id: id,
      actor_ids: mentioned,
      snippet,
    });
    return getComment(ctx, id);
  });
}

export function updateComment(ctx: TesseraContext, id: string, input: z.input<typeof UpdateCommentInput>): CommentView {
  const data = validateInput(UpdateCommentInput, input);
  return withTx(ctx, () => {
    const row = loadLiveComment(ctx, id);
    const loaded = loadWritableWorkItem(ctx, row.work_item_id);
    if (row.actor_id !== ctx.actor.id) throw rule("author_only", "Only the author can update this comment");
    if (row.body_version !== data.expected_body_version) {
      throw conflict("This comment changed", { current_version: row.body_version });
    }
    const version = row.body_version + 1;
    const now = ctx.now();
    const result = ctx.db
      .update(comment)
      .set({
        body_md: data.body_md,
        body_version: version,
        edited_at: now,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(and(eq(comment.id, row.id), eq(comment.body_version, data.expected_body_version), isNull(comment.deleted_at)))
      .run();
    if (result.changes === 0) throw conflict("This comment changed", { current_version: loadLiveComment(ctx, row.id).body_version });
    const snippet = commentSnippet(data.body_md);
    const mentioned = syncMentions(ctx, loaded, row.id, data.body_md);
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: "comment",
      entity_id: row.id,
      work_item_id: row.work_item_id,
      verb: "updated",
      field: "body_md",
      comment: snippet,
    });
    notifyMentions(ctx, {
      work_item_id: row.work_item_id,
      entity_type: "comment",
      entity_id: row.id,
      actor_ids: mentioned,
      snippet,
    });
    return getComment(ctx, row.id);
  });
}

export function deleteComment(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const row = loadLiveComment(ctx, id);
    const loaded = loadWritableWorkItem(ctx, row.work_item_id);
    if (row.actor_id !== ctx.actor.id && ctx.actor.kind !== "user") {
      throw rule("author_or_user", "Only the author or the user can delete this comment");
    }
    const replies = ctx.db
      .select()
      .from(comment)
      .where(and(eq(comment.parent_comment_id, row.id), isNull(comment.deleted_at)))
      .all();
    const ids = [row.id, ...replies.map((reply) => reply.id)];
    const now = ctx.now();
    ctx.db
      .update(comment)
      .set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id })
      .where(inArray(comment.id, ids))
      .run();
    ctx.db.delete(mention).where(and(eq(mention.entity_type, "comment"), inArray(mention.entity_id, ids))).run();
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: "comment",
      entity_id: row.id,
      work_item_id: row.work_item_id,
      verb: "deleted",
      comment: commentSnippet(row.body_md),
    });
  });
}
