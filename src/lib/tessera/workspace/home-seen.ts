/**
 * Home seen cursor. Bookkeeping only: it never writes activity and never
 * moves the cursor backwards. Outside the engine barrel, like the AI helpers.
 */
import { eq, max } from "drizzle-orm";
import { nowIso } from "../core/time";
import type { TesseraDb } from "../db/client";
import { activity, workspace_settings } from "../db/schema";
import { ensureWorkspaceSettings, WORKSPACE_ID } from "./settings";

/** Moves last_seen_seq forward to min(seq, latest activity seq) and stamps last_seen_at. */
export function setHomeSeen(db: TesseraDb, seq: number): void {
  ensureWorkspaceSettings(db);
  const latest = db.select({ seq: max(activity.seq) }).from(activity).get()?.seq ?? 0;
  const requested = Number.isFinite(seq) ? Math.trunc(seq) : 0;
  const clamped = Math.min(Math.max(requested, 0), latest);
  const row = db
    .select({ last_seen_seq: workspace_settings.last_seen_seq })
    .from(workspace_settings)
    .where(eq(workspace_settings.id, WORKSPACE_ID))
    .get();
  const stored = row?.last_seen_seq ?? null;
  const next = stored === null ? clamped : Math.max(stored, clamped);
  const now = nowIso();
  db.update(workspace_settings)
    .set({ last_seen_seq: next, last_seen_at: now, updated_at: now })
    .where(eq(workspace_settings.id, WORKSPACE_ID))
    .run();
}
