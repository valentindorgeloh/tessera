/**
 * Reactions on a work item or a comment. The set is eight emoji. Adding a
 * reaction the actor already has is a no-op; removing one that is absent is
 * a no-op. A real add or remove writes activity (`reacted` / `unreacted`)
 * so open tabs refresh, and never writes a notification.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { withTx } from "./core/tx";
import { comment, comment_reaction, work_item_reaction } from "./db/schema";
import { IdSchema } from "./schemas";
import { loadWritableWorkItem } from "./work-items";

export const REACTION_EMOJI = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"] as const;

export const ReactionSchema = z.enum(REACTION_EMOJI);
export const ReactionTargetSchema = z.enum(["work_item", "comment"]);

export type Reaction = z.infer<typeof ReactionSchema>;
export type ReactionTarget = z.infer<typeof ReactionTargetSchema>;

export type ReactionSummary = {
  reaction: Reaction;
  count: number;
  actor_ids: string[];
};

export const ReactionInput = z
  .object({
    target: ReactionTargetSchema.describe("work_item or comment."),
    target_id: IdSchema.describe("Id of the work item or comment."),
    reaction: ReactionSchema.describe("One of 👍 👎 😄 🎉 😕 ❤️ 🚀 👀."),
  })
  .strict();

type ReactionRow = { target_id: string; actor_id: string; reaction: string; created_at: string };

const EMOJI_ORDER = new Map<string, number>(REACTION_EMOJI.map((emoji, index) => [emoji, index]));

export function reactionsFor(ctx: TesseraContext, target: ReactionTarget, ids: readonly string[]): Map<string, ReactionSummary[]> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ReactionSummary[]>(unique.map((id) => [id, []]));
  if (unique.length === 0) return map;
  const grouped = new Map<string, Map<string, { actor_id: string; created_at: string }[]>>();
  for (const row of reactionRows(ctx, target, unique)) {
    const byEmoji = grouped.get(row.target_id) ?? new Map();
    const actors = byEmoji.get(row.reaction) ?? [];
    actors.push({ actor_id: row.actor_id, created_at: row.created_at });
    byEmoji.set(row.reaction, actors);
    grouped.set(row.target_id, byEmoji);
  }
  for (const id of unique) {
    const byEmoji = grouped.get(id);
    if (!byEmoji) continue;
    const summaries: ReactionSummary[] = [];
    for (const [reaction, actors] of byEmoji) {
      if (!isReaction(reaction)) continue;
      actors.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.actor_id.localeCompare(b.actor_id));
      summaries.push({ reaction, count: actors.length, actor_ids: actors.map((entry) => entry.actor_id) });
    }
    summaries.sort((a, b) => (EMOJI_ORDER.get(a.reaction) ?? 0) - (EMOJI_ORDER.get(b.reaction) ?? 0));
    map.set(id, summaries);
  }
  return map;
}

export function addReaction(ctx: TesseraContext, input: z.input<typeof ReactionInput>): ReactionSummary[] {
  const data = validateInput(ReactionInput, input);
  return withTx(ctx, () => {
    const place = resolveTarget(ctx, data.target, data.target_id);
    if (!hasReaction(ctx, data.target, data.target_id, ctx.actor.id, data.reaction)) {
      insertReaction(ctx, data.target, data.target_id, data.reaction);
      logActivity(ctx, { ...place, verb: "reacted", field: "reaction", new_value: data.reaction });
    }
    return reactionsFor(ctx, data.target, [data.target_id]).get(data.target_id) ?? [];
  });
}

export function removeReaction(ctx: TesseraContext, input: z.input<typeof ReactionInput>): ReactionSummary[] {
  const data = validateInput(ReactionInput, input);
  return withTx(ctx, () => {
    const place = resolveTarget(ctx, data.target, data.target_id);
    const removed = deleteReaction(ctx, data.target, data.target_id, data.reaction);
    if (removed) logActivity(ctx, { ...place, verb: "unreacted", field: "reaction", old_value: data.reaction });
    return reactionsFor(ctx, data.target, [data.target_id]).get(data.target_id) ?? [];
  });
}

function isReaction(value: string): value is Reaction {
  return EMOJI_ORDER.has(value);
}

function reactionRows(ctx: TesseraContext, target: ReactionTarget, ids: string[]): ReactionRow[] {
  if (target === "work_item") {
    return ctx.db
      .select({
        target_id: work_item_reaction.work_item_id,
        actor_id: work_item_reaction.actor_id,
        reaction: work_item_reaction.reaction,
        created_at: work_item_reaction.created_at,
      })
      .from(work_item_reaction)
      .where(inArray(work_item_reaction.work_item_id, ids))
      .all();
  }
  return ctx.db
    .select({
      target_id: comment_reaction.comment_id,
      actor_id: comment_reaction.actor_id,
      reaction: comment_reaction.reaction,
      created_at: comment_reaction.created_at,
    })
    .from(comment_reaction)
    .where(inArray(comment_reaction.comment_id, ids))
    .all();
}

function resolveTarget(ctx: TesseraContext, target: ReactionTarget, targetId: string): { project_id: string; entity_type: string; entity_id: string; work_item_id: string } {
  if (target === "work_item") {
    const loaded = loadWritableWorkItem(ctx, targetId);
    return { project_id: loaded.project.id, entity_type: "work_item", entity_id: loaded.item.id, work_item_id: loaded.item.id };
  }
  const row = ctx.db
    .select()
    .from(comment)
    .where(and(eq(comment.id, targetId), isNull(comment.deleted_at)))
    .get();
  if (!row) throw notFound("comment", targetId);
  const loaded = loadWritableWorkItem(ctx, row.work_item_id);
  return { project_id: loaded.project.id, entity_type: "comment", entity_id: row.id, work_item_id: loaded.item.id };
}

function hasReaction(ctx: TesseraContext, target: ReactionTarget, targetId: string, actorId: string, reaction: string): boolean {
  if (target === "work_item") {
    return (
      ctx.db
        .select({ id: work_item_reaction.id })
        .from(work_item_reaction)
        .where(and(eq(work_item_reaction.work_item_id, targetId), eq(work_item_reaction.actor_id, actorId), eq(work_item_reaction.reaction, reaction)))
        .get() !== undefined
    );
  }
  return (
    ctx.db
      .select({ id: comment_reaction.id })
      .from(comment_reaction)
      .where(and(eq(comment_reaction.comment_id, targetId), eq(comment_reaction.actor_id, actorId), eq(comment_reaction.reaction, reaction)))
      .get() !== undefined
  );
}

function insertReaction(ctx: TesseraContext, target: ReactionTarget, targetId: string, reaction: string): void {
  const now = ctx.now();
  if (target === "work_item") {
    ctx.db.insert(work_item_reaction).values({ id: newId(), work_item_id: targetId, actor_id: ctx.actor.id, reaction, created_at: now }).run();
    return;
  }
  ctx.db.insert(comment_reaction).values({ id: newId(), comment_id: targetId, actor_id: ctx.actor.id, reaction, created_at: now }).run();
}

function deleteReaction(ctx: TesseraContext, target: ReactionTarget, targetId: string, reaction: string): boolean {
  if (target === "work_item") {
    const result = ctx.db
      .delete(work_item_reaction)
      .where(and(eq(work_item_reaction.work_item_id, targetId), eq(work_item_reaction.actor_id, ctx.actor.id), eq(work_item_reaction.reaction, reaction)))
      .run();
    return result.changes > 0;
  }
  const result = ctx.db
    .delete(comment_reaction)
    .where(and(eq(comment_reaction.comment_id, targetId), eq(comment_reaction.actor_id, ctx.actor.id), eq(comment_reaction.reaction, reaction)))
    .run();
  return result.changes > 0;
}
