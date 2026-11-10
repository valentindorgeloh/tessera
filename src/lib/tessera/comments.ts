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
import { conflict, notFound, rule, validation, validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { withTx } from "./core/tx";
import { actor, comment, mention } from "./db/schema";
import { IdSchema } from "./schemas";
import type { ActorKind, CommentRow, PaletteColor } from "./types";
import { bodySnippet, syncMentions } from "./mentions";
import { reactionsFor, type ReactionSummary } from "./reactions";
import { getWorkItemRow, insertSubscriber, loadWritableWorkItem } from "./work-items";

const BODY = z.string().trim().min(1).max(50_000);

/** Idempotency key for a comment (decision 149): printable ASCII without spaces, unique per caller and work item. */
export const ClientRefSchema = z
  .string()
  .regex(/^[\x21-\x7E]{1,200}$/)
  .describe("Idempotency key, 1 to 200 printable ASCII characters without spaces. Repeating the same ref with the same body returns the stored comment; another body is CONFLICT.");

export const CreateCommentInput = z
  .object({
    body_md: BODY.describe("Comment body in markdown, from 1 to 50,000 characters."),
    parent_comment_id: IdSchema.optional().describe("Comment being replied to. A reply to a reply attaches to the root."),
    client_ref: ClientRefSchema.optional(),
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
  actor_color: PaletteColor;
  reactions: ReactionSummary[];
  replies: CommentView[];
};

/** What a repeated `client_ref` returns when its comment has since been deleted (decision 149). */
export type DeletedCommentRef = { id: string; client_ref: string; deleted: true };
export type CreateCommentResult = CommentView | DeletedCommentRef;

type ActorInfo = { name: string; kind: ActorKind; color: PaletteColor };

/** 140-character plain text of a comment body (mentions.ts `bodySnippet`). */
export function commentSnippet(md: string): string {
  return bodySnippet(md);
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
  const rows = ctx.db.select({ id: actor.id, name: actor.name, kind: actor.kind, color: actor.color }).from(actor).where(inArray(actor.id, unique)).all();
  return new Map(rows.map((row) => [row.id, { name: row.name, kind: row.kind, color: row.color }]));
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
      actor_color: info.color,
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
    return { ...row, actor_name: info.name, actor_kind: info.kind, actor_color: info.color, reactions, replies: [] };
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

export function createComment(ctx: TesseraContext, workItemId: string, input: z.input<typeof CreateCommentInput> & { client_ref?: undefined }): CommentView;
export function createComment(ctx: TesseraContext, workItemId: string, input: z.input<typeof CreateCommentInput>): CreateCommentResult;
export function createComment(ctx: TesseraContext, workItemId: string, input: z.input<typeof CreateCommentInput>): CreateCommentResult {
  const data = validateInput(CreateCommentInput, input);
  return withTx(ctx, () => {
    if (data.client_ref !== undefined) {
      // Decision 149: after the item exists, before the archived check, so a repeat on an item archived since still answers. Deleted rows count.
      const item = getWorkItemRow(ctx, workItemId);
      const prior = ctx.db
        .select()
        .from(comment)
        .where(and(eq(comment.actor_id, ctx.actor.id), eq(comment.work_item_id, item.id), eq(comment.client_ref, data.client_ref)))
        .get();
      if (prior) {
        if (prior.deleted_at !== null) return { id: prior.id, client_ref: data.client_ref, deleted: true as const };
        if (prior.body_md !== data.body_md) {
          throw conflict("This client_ref was used with a different body", { comment_id: prior.id, client_ref: data.client_ref });
        }
        return getComment(ctx, prior.id);
      }
    }
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
        client_ref: data.client_ref ?? null,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .run();
    insertSubscriber(ctx, loaded, ctx.actor.id);
    const snippet = commentSnippet(data.body_md);
    // Mentions first: a mentioned actor gets one `mentioned` row and is left out of the `commented` recipients (decision 53).
    syncMentions(ctx, { entity_type: "comment", entity_id: id, work_item_id: loaded.item.id, project_id: loaded.project.id }, data.body_md);
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: "comment",
      entity_id: id,
      work_item_id: loaded.item.id,
      verb: "commented",
      comment: snippet,
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
    // Only mentions added by this edit notify; a mention the edit keeps does not (decision 53).
    syncMentions(ctx, { entity_type: "comment", entity_id: row.id, work_item_id: row.work_item_id, project_id: loaded.project.id }, data.body_md);
    logActivity(ctx, {
      project_id: loaded.project.id,
      entity_type: "comment",
      entity_id: row.id,
      work_item_id: row.work_item_id,
      verb: "updated",
      field: "body_md",
      comment: snippet,
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
