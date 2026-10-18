/**
 * Workspace stickies. New notes go first. Description edits log one updated
 * row with no old or new value. Search is a LIKE over name and body.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { diffFields, logActivity } from "../activity";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { sortOrderBefore, sortOrderForMove, type OrderedRow } from "../core/order";
import { withTx } from "../core/tx";
import { sticky } from "../db/schema";
import { IdSchema, PaletteColorSchema } from "../schemas";
import type { StickyView } from "../types";

const NAME = z.string().max(200);
const BODY = z.string().max(100_000);

function toView(row: typeof sticky.$inferSelect): StickyView {
  return {
    id: row.id,
    name: row.name,
    description_md: row.description_md,
    color: row.color,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
  };
}

function live(ctx: TesseraContext) {
  return ctx.db.select().from(sticky).where(isNull(sticky.deleted_at)).orderBy(asc(sticky.sort_order)).all();
}

function requireSticky(ctx: TesseraContext, id: string) {
  const row = ctx.db.select().from(sticky).where(and(eq(sticky.id, id), isNull(sticky.deleted_at))).get();
  if (!row) throw notFound("sticky", id);
  return row;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const ListStickiesInput = z
  .object({
    q: z.string().optional().describe("Case-insensitive search over the name and the body."),
    limit: z.number().int().min(1).max(500).optional().describe("Most stickies to return. Defaults to 200."),
  })
  .strict();

export type ListStickiesInputType = z.input<typeof ListStickiesInput>;

export function listStickies(ctx: TesseraContext, input: ListStickiesInputType = {}): StickyView[] {
  const data = validateInput(ListStickiesInput, input);
  const q = data.q?.trim() ?? "";
  const pattern = q === "" ? null : likePattern(q);
  const rows = ctx.db
    .select()
    .from(sticky)
    .where(
      and(
        isNull(sticky.deleted_at),
        pattern === null
          ? undefined
          : sql`(${sticky.name} LIKE ${pattern} ESCAPE '\\' OR ${sticky.description_md} LIKE ${pattern} ESCAPE '\\')`,
      ),
    )
    .orderBy(asc(sticky.sort_order))
    .limit(data.limit ?? 200)
    .all();
  return rows.map(toView);
}

export function recentStickies(ctx: TesseraContext, limit: number): StickyView[] {
  return ctx.db
    .select()
    .from(sticky)
    .where(isNull(sticky.deleted_at))
    .orderBy(desc(sticky.updated_at), desc(sticky.id))
    .limit(limit)
    .all()
    .map(toView);
}

export const CreateStickyInput = z
  .object({
    name: NAME.optional().describe("Sticky title. Empty until named."),
    description_md: BODY.optional().describe("Markdown body."),
    color: PaletteColorSchema.optional().describe("Palette colour. Defaults to yellow."),
  })
  .strict();

export type CreateStickyInputType = z.input<typeof CreateStickyInput>;

export function createSticky(ctx: TesseraContext, input: CreateStickyInputType = {}): StickyView {
  const data = validateInput(CreateStickyInput, input);
  return withTx(ctx, () => {
    const first = live(ctx)[0];
    const now = ctx.now();
    const row = ctx.db
      .insert(sticky)
      .values({
        id: newId(),
        name: data.name ?? "",
        description_md: data.description_md ?? "",
        color: data.color ?? "yellow",
        sort_order: sortOrderBefore(first?.sort_order ?? null),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "sticky", entity_id: row.id, verb: "created", new_identifier: row.name });
    return toView(row);
  });
}

export const UpdateStickyInput = z
  .object({
    name: NAME.optional().describe("New title."),
    description_md: BODY.optional().describe("New markdown body. The activity row stores no old or new value."),
    color: PaletteColorSchema.optional().describe("New palette colour."),
  })
  .strict();

export type UpdateStickyInputType = z.input<typeof UpdateStickyInput>;

export function updateSticky(ctx: TesseraContext, id: string, input: UpdateStickyInputType): StickyView {
  const data = validateInput(UpdateStickyInput, input);
  return withTx(ctx, () => {
    const before = requireSticky(ctx, id);
    const now = ctx.now();
    const after = ctx.db
      .update(sticky)
      .set({
        name: data.name ?? before.name,
        description_md: data.description_md ?? before.description_md,
        color: data.color ?? before.color,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(sticky.id, id))
      .returning()
      .get();
    diffFields(ctx, { project_id: null, entity_type: "sticky", entity_id: id }, before, after, ["name", "color"]);
    if (before.description_md !== after.description_md) {
      logActivity(ctx, { project_id: null, entity_type: "sticky", entity_id: id, verb: "updated", field: "description_md" });
    }
    return toView(after);
  });
}

export const MoveStickyInput = z
  .object({
    sticky_id: IdSchema.describe("Sticky to move."),
    before_id: IdSchema.optional().describe("Sticky that will come directly before this one."),
    after_id: IdSchema.optional().describe("Sticky that will come directly after this one."),
  })
  .strict();

export type MoveStickyInputType = z.input<typeof MoveStickyInput>;

export function moveSticky(ctx: TesseraContext, input: MoveStickyInputType): StickyView {
  const data = validateInput(MoveStickyInput, input);
  return withTx(ctx, () => {
    const before = requireSticky(ctx, data.sticky_id);
    const rows: OrderedRow[] = live(ctx);
    const sort_order =
      data.before_id === undefined && data.after_id === undefined
        ? sortOrderBefore(rows.find((row) => row.id !== before.id)?.sort_order ?? null)
        : sortOrderForMove(rows, before.id, data.before_id, data.after_id, "sticky");
    const now = ctx.now();
    const after = ctx.db
      .update(sticky)
      .set({ sort_order, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(sticky.id, before.id))
      .returning()
      .get();
    if (before.sort_order !== after.sort_order) {
      logActivity(ctx, { project_id: null, entity_type: "sticky", entity_id: before.id, verb: "moved", field: "sort_order" });
    }
    return toView(after);
  });
}

export function deleteSticky(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    requireSticky(ctx, id);
    const now = ctx.now();
    ctx.db.update(sticky).set({ deleted_at: now, updated_at: now, updated_by: ctx.actor.id }).where(eq(sticky.id, id)).run();
    logActivity(ctx, { project_id: null, entity_type: "sticky", entity_id: id, verb: "deleted" });
  });
}
