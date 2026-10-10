/**
 * Actors (decision 8): the human `user`, the `assistant`, `system` for
 * automations and one `agent` row per MCP client. The three built-in rows have
 * fixed ids so every database and every test agrees on them.
 *
 * MCP clients register as `agent` with the name `mcp:<client_name>` (see
 * `mcpActorName`); `registerActor` is idempotent on `name_key`, so a client
 * that reconnects reuses its row and only `last_seen_at` moves.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput } from "./core/errors";
import { newId } from "./core/ids";
import { nameKey } from "./core/keys";
import { nowIso } from "./core/time";
import { withTx } from "./core/tx";
import type { TesseraDb } from "./db/client";
import { actor } from "./db/schema";
import { PaletteColorSchema } from "./schemas";
import type { ActorRow } from "./types";

export const USER_ACTOR_ID = "00000000-0000-7000-8000-000000000001";
export const ASSISTANT_ACTOR_ID = "00000000-0000-7000-8000-000000000002";
export const SYSTEM_ACTOR_ID = "00000000-0000-7000-8000-000000000003";

export const SYSTEM_ACTORS = [
  { id: USER_ACTOR_ID, kind: "user", name: "You", color: "blue" },
  { id: ASSISTANT_ACTOR_ID, kind: "assistant", name: "Assistant", color: "purple" },
  { id: SYSTEM_ACTOR_ID, kind: "system", name: "System", color: "gray" },
] as const;

export const MCP_ACTOR_PREFIX = "mcp:";

/** Actor name for an MCP client: `mcp:<client_name>`. */
export function mcpActorName(clientName: string): string {
  return `${MCP_ACTOR_PREFIX}${clientName.trim()}`;
}

/** Inserts the built-in actors when missing; safe to call on every open. */
export function ensureSystemActors(db: TesseraDb): void {
  const now = nowIso();
  db.insert(actor)
    .values(
      SYSTEM_ACTORS.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        name_key: nameKey(row.name),
        color: row.color,
        created_at: now,
        updated_at: now,
        created_by: row.id,
        updated_by: row.id,
      })),
    )
    .onConflictDoNothing()
    .run();
}

export function listActors(ctx: TesseraContext): ActorRow[] {
  return ctx.db.select().from(actor).where(isNull(actor.deleted_at)).orderBy(asc(actor.created_at), asc(actor.name_key)).all();
}

export function getActor(ctx: TesseraContext, id: string): ActorRow {
  const row = ctx.db
    .select()
    .from(actor)
    .where(and(eq(actor.id, id), isNull(actor.deleted_at)))
    .get();
  if (!row) throw notFound("actor", id);
  return row;
}

function findActorByNameKey(ctx: TesseraContext, key: string): ActorRow | undefined {
  return ctx.db
    .select()
    .from(actor)
    .where(and(eq(actor.name_key, key), isNull(actor.deleted_at)))
    .get();
}

export const RegisterActorInput = z.object({
  kind: z.literal("agent").describe("Only agents register themselves; the built-in actors are seeded."),
  name: z.string().trim().min(1).max(120).describe("Display name; MCP clients use mcp:<client_name>."),
  client_name: z.string().trim().min(1).max(200).optional().describe("Raw MCP client name and version for display."),
  color: PaletteColorSchema.optional().describe("Palette colour; defaults to teal."),
});

export type RegisterActorInputType = z.input<typeof RegisterActorInput>;

/** Creates the agent row or, when an actor with the same name_key exists, touches it and returns it. */
export function registerActor(ctx: TesseraContext, input: RegisterActorInputType): ActorRow {
  const data = validateInput(RegisterActorInput, input);
  return withTx(ctx, () => {
    const key = nameKey(data.name);
    const existing = findActorByNameKey(ctx, key);
    const now = ctx.now();
    if (existing) {
      return ctx.db
        .update(actor)
        .set({
          last_seen_at: now,
          client_name: data.client_name ?? existing.client_name,
          updated_at: now,
          updated_by: ctx.actor.id,
        })
        .where(eq(actor.id, existing.id))
        .returning()
        .get();
    }
    const row = ctx.db
      .insert(actor)
      .values({
        id: newId(),
        kind: data.kind,
        name: data.name,
        name_key: key,
        color: data.color ?? "teal",
        client_name: data.client_name ?? null,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { entity_type: "actor", entity_id: row.id, verb: "registered", new_identifier: row.name });
    return row;
  });
}

/** Moves `last_seen_at` without touching updated_at or writing activity. */
export function touchActor(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const result = ctx.db.update(actor).set({ last_seen_at: ctx.now() }).where(and(eq(actor.id, id), isNull(actor.deleted_at))).run();
    if (result.changes === 0) throw notFound("actor", id);
  });
}

export const UpdateActorInput = z
  .object({
    name: z.string().trim().min(1).max(120).describe("New display name."),
    color: PaletteColorSchema.describe("New palette colour."),
  })
  .partial();

export type UpdateActorInputType = z.input<typeof UpdateActorInput>;

export function updateActor(ctx: TesseraContext, id: string, patch: UpdateActorInputType): ActorRow {
  const data = validateInput(UpdateActorInput, patch);
  return withTx(ctx, () => {
    const before = getActor(ctx, id);
    const now = ctx.now();
    const after = ctx.db
      .update(actor)
      .set({
        name: data.name ?? before.name,
        name_key: data.name ? nameKey(data.name) : before.name_key,
        color: data.color ?? before.color,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(actor.id, id))
      .returning()
      .get();
    for (const field of ["name", "color"] as const) {
      if (before[field] === after[field]) continue;
      logActivity(ctx, {
        entity_type: "actor",
        entity_id: id,
        verb: "updated",
        field,
        old_value: before[field],
        new_value: after[field],
      });
    }
    return after;
  });
}
