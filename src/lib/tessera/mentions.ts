/**
 * Mentions (decision 53): `[@Name](actor:<id>)` links in a work item
 * description, a comment or a page body. `syncMentions` runs on every save of
 * such a body. It diffs the entity's `mention` rows against the live actors
 * the body links to; each ADDED actor logs an activity row (`added`, field
 * `mention`), which notifies `mentioned` (notifications.ts) and, when the
 * entity belongs to a work item, subscribes the actor. A REMOVED actor logs a
 * `removed` row, which notifies nobody (decision 51). The saving actor is never
 * added, and a re-save of the same body changes nothing.
 */
import { and, eq, inArray } from "drizzle-orm";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { isId } from "./core/ids";
import { assertInTransaction } from "./core/tx";
import { actor, mention } from "./db/schema";
import { insertSubscriber } from "./work-items/membership";
import { loadWritableWorkItem } from "./work-items/model";

const SNIPPET_LIMIT = 140;

export type MentionTarget = {
  entity_type: "work_item" | "comment" | "page";
  entity_id: string;
  /** The work item the entity rolls up to; null for a page. */
  work_item_id: string | null;
  project_id: string | null;
};

/** Drops code fences, link targets and markdown marks, then keeps 140 characters. */
export function bodySnippet(md: string): string {
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

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const tail = text.charCodeAt(end - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/** Blanks fenced blocks (``` or ~~~, an unclosed one runs to the end) and inline code spans. */
function withoutCode(md: string): string {
  const kept: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open?.[1]) {
        fence = { char: open[1][0] ?? "`", length: open[1].length };
        continue;
      }
      kept.push(line);
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close?.[1] && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
  }
  return kept.join("\n").replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, " ");
}

/** Unique actor ids written as `[@Name](actor:<id>)`, outside fenced and inline code. Ids are not checked against the database. */
export function extractActorMentions(md: string): string[] {
  const found = new Set<string>();
  for (const match of withoutCode(md).matchAll(/\]\(actor:([^)\s]+)\)/gi)) {
    const id = match[1];
    if (id !== undefined && isId(id)) found.add(id.toLowerCase());
  }
  return [...found];
}

/**
 * Replaces the entity's mention rows with the live actors `body` links to and
 * logs the difference. Inside withTx. Returns the ids added and removed.
 * `silent` writes the rows only (no activity, no subscription, no
 * notification) and returns nothing added: a copy of a page (duplicatePage)
 * records who its body links to, so a later save of the same body adds nothing
 * (decision 53), without telling anyone twice.
 */
export function syncMentions(
  ctx: TesseraContext,
  target: MentionTarget,
  body: string,
  options: { silent?: boolean } = {},
): { added: string[]; removed: string[] } {
  assertInTransaction(ctx, "syncMentions");
  const linked = extractActorMentions(body);
  const names = new Map(
    (linked.length === 0 ? [] : ctx.db.select({ id: actor.id, name: actor.name, deleted_at: actor.deleted_at }).from(actor).where(inArray(actor.id, linked)).all())
      .filter((row) => row.deleted_at === null)
      .map((row) => [row.id, row.name] as const),
  );
  const existing = ctx.db
    .select({ actor_id: mention.actor_id })
    .from(mention)
    .where(and(eq(mention.entity_type, target.entity_type), eq(mention.entity_id, target.entity_id)))
    .all()
    .map((row) => row.actor_id);
  const had = new Set(existing);
  const added = [...names.keys()].filter((id) => !had.has(id) && id !== ctx.actor.id);
  const removed = existing.filter((id) => !names.has(id));
  if (added.length === 0 && removed.length === 0) return { added, removed };
  if (options.silent === true) {
    if (removed.length > 0) {
      ctx.db.delete(mention).where(and(eq(mention.entity_type, target.entity_type), eq(mention.entity_id, target.entity_id), inArray(mention.actor_id, removed))).run();
    }
    for (const id of added) {
      ctx.db.insert(mention).values({ entity_type: target.entity_type, entity_id: target.entity_id, actor_id: id, created_at: ctx.now() }).run();
    }
    return { added: [], removed: [] };
  }
  const base = { entity_type: target.entity_type, entity_id: target.entity_id, work_item_id: target.work_item_id, project_id: target.project_id };
  if (removed.length > 0) {
    const removedNames = new Map(ctx.db.select({ id: actor.id, name: actor.name }).from(actor).where(inArray(actor.id, removed)).all().map((row) => [row.id, row.name] as const));
    ctx.db.delete(mention).where(and(eq(mention.entity_type, target.entity_type), eq(mention.entity_id, target.entity_id), inArray(mention.actor_id, removed))).run();
    for (const id of removed) {
      logActivity(ctx, { ...base, verb: "removed", field: "mention", old_value: id, old_identifier: removedNames.get(id) ?? null });
    }
  }
  const snippet = bodySnippet(body);
  const loaded = added.length > 0 && target.work_item_id !== null ? loadWritableWorkItem(ctx, target.work_item_id, { allowArchived: true }) : null;
  for (const id of added) {
    const name = names.get(id) ?? null;
    ctx.db.insert(mention).values({ entity_type: target.entity_type, entity_id: target.entity_id, actor_id: id, created_at: ctx.now() }).run();
    if (loaded) insertSubscriber(ctx, loaded, id);
    logActivity(ctx, { ...base, verb: "added", field: "mention", new_value: id, new_identifier: name, comment: snippet });
  }
  return { added, removed };
}
