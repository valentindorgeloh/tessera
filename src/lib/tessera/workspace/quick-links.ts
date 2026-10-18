/**
 * Home quick links. A url is http(s) or an app path starting with /.
 * Removing a link is not destructive.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { sortOrderAfter, sortOrderForMove, type OrderedRow } from "../core/order";
import { withTx } from "../core/tx";
import { quick_link } from "../db/schema";
import { IdSchema, QuickLinkUrlSchema } from "../schemas";
import type { QuickLinkView } from "../types";

const TITLE = z.string().max(200);

function toView(row: typeof quick_link.$inferSelect): QuickLinkView {
  return { id: row.id, title: row.title, url: row.url, sort_order: row.sort_order };
}

function live(ctx: TesseraContext) {
  return ctx.db.select().from(quick_link).where(isNull(quick_link.deleted_at)).orderBy(asc(quick_link.sort_order)).all();
}

function requireLink(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(quick_link).where(and(eq(quick_link.id, id), isNull(quick_link.deleted_at))).get();
  if (!row) throw notFound("quick_link", id);
  return row;
}

export function listQuickLinks(ctx: TesseraContext): QuickLinkView[] {
  return live(ctx).map(toView);
}

export const AddQuickLinkInput = z
  .object({
    url: QuickLinkUrlSchema.describe("http(s) URL or an app path starting with /."),
    title: TITLE.optional().describe("Label. Empty shows the host or the path."),
  })
  .strict();

export type AddQuickLinkInputType = z.input<typeof AddQuickLinkInput>;

export function addQuickLink(ctx: TesseraContext, input: AddQuickLinkInputType): QuickLinkView {
  const data = validateInput(AddQuickLinkInput, input);
  return withTx(ctx, () => {
    const rows = live(ctx);
    const now = ctx.now();
    const row = ctx.db
      .insert(quick_link)
      .values({
        id: newId(),
        title: data.title ?? "",
        url: data.url,
        sort_order: sortOrderAfter(rows.at(-1)?.sort_order ?? null),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    return toView(row);
  });
}

export const UpdateQuickLinkInput = z
  .object({
    url: QuickLinkUrlSchema.optional().describe("New http(s) URL or app path."),
    title: TITLE.optional().describe("New label. Empty shows the host or the path."),
  })
  .strict();

export type UpdateQuickLinkInputType = z.input<typeof UpdateQuickLinkInput>;

export function updateQuickLink(ctx: TesseraContext, id: string, input: UpdateQuickLinkInputType): QuickLinkView {
  const data = validateInput(UpdateQuickLinkInput, input);
  return withTx(ctx, () => {
    const before = requireLink(ctx, id);
    const now = ctx.now();
    const row = ctx.db
      .update(quick_link)
      .set({ url: data.url ?? before.url, title: data.title ?? before.title, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(quick_link.id, id))
      .returning()
      .get();
    return toView(row);
  });
}

export const MoveQuickLinkInput = z
  .object({
    quick_link_id: IdSchema.describe("Quick link to move."),
    before_id: IdSchema.optional().describe("Link that will come directly before this one."),
    after_id: IdSchema.optional().describe("Link that will come directly after this one."),
  })
  .strict();

export type MoveQuickLinkInputType = z.input<typeof MoveQuickLinkInput>;

export function moveQuickLink(ctx: TesseraContext, input: MoveQuickLinkInputType): QuickLinkView {
  const data = validateInput(MoveQuickLinkInput, input);
  return withTx(ctx, () => {
    const before = requireLink(ctx, data.quick_link_id);
    const rows: OrderedRow[] = live(ctx);
    const sort_order =
      data.before_id === undefined && data.after_id === undefined
        ? sortOrderAfter(rows.filter((row) => row.id !== before.id).at(-1)?.sort_order ?? null)
        : sortOrderForMove(rows, before.id, data.before_id, data.after_id, "quick_link");
    const now = ctx.now();
    const row = ctx.db
      .update(quick_link)
      .set({ sort_order, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(quick_link.id, before.id))
      .returning()
      .get();
    return toView(row);
  });
}

export function removeQuickLink(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    requireLink(ctx, id);
    const now = ctx.now();
    ctx.db.update(quick_link).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(quick_link.id, id)).run();
  });
}
