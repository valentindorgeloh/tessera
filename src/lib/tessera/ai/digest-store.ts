/**
 * Stored digests (decision 34, decision 37). Rows are bookkeeping: no activity,
 * no change cursor. A digest is stale when newer activity exists.
 */
import { and, eq } from "drizzle-orm";
import { listActivity, maxFeedSeq } from "../changes";
import type { TesseraContext } from "../core/context";
import { ai_digest } from "../db/schema";
import type { DigestKind, DigestView } from "../types";
import { getCycle } from "../cycles";
import { getModule } from "../modules";

export function currentDigestSeq(ctx: TesseraContext, kind: DigestKind, id: string): number {
  return maxFeedSeq(ctx, kind === "cycle" ? { cycle_id: id } : { module_id: id });
}

export function digestInputs(ctx: TesseraContext, kind: DigestKind, id: string): { subject: string; activity: ReturnType<typeof listActivity>; input_seq: number } {
  const subject = kind === "cycle" ? getCycle(ctx, id).name : getModule(ctx, id).name;
  const activity = listActivity(ctx, kind === "cycle" ? { cycle_id: id, limit: 300 } : { module_id: id, limit: 300 });
  return { subject, activity, input_seq: currentDigestSeq(ctx, kind, id) };
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
