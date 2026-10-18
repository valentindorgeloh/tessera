/**
 * Cross-process lease for the automation run and, later, the webhook
 * dispatcher. One conditional update takes the row; a second holder skips
 * until the lease expires or the holder releases it (decision 28).
 */
import type { Database } from "better-sqlite3";
import { fromSqliteError } from "../core/errors";

const EMPTY_HOLDER = "";
const EXPIRED = "1970-01-01T00:00:00.000Z";

export type LeaseId = "automation" | "webhooks" | "maintenance";

/** How long a crashed runner may keep the row before another process may take it. */
export const LEASE_TTL_MS = 15 * 60 * 1000;

/**
 * Takes the lease when it is free, expired, or already held by `holder`.
 * Returns false when another live holder has it. Commits on its own, so the
 * caller must not already be inside a transaction.
 */
export function acquireLease(db: Database, id: LeaseId, holder: string, now: string, ttlMs: number): boolean {
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
  const take = db.transaction(() => {
    db.prepare(`INSERT INTO automation_lease (id, holder, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`).run(id, EMPTY_HOLDER, EXPIRED);
    const result = db.prepare(
      `UPDATE automation_lease SET holder = ?, expires_at = ? WHERE id = ? AND (expires_at <= ? OR holder = ? OR holder = ?)`,
    ).run(holder, expiresAt, id, now, holder, EMPTY_HOLDER);
    return result.changes === 1;
  });
  try {
    return take.immediate();
  } catch (err) {
    throw fromSqliteError(err);
  }
}

/** Drops the lease when `holder` still owns it. A different holder is left alone. */
export function releaseLease(db: Database, id: string, holder: string): void {
  db.prepare(`UPDATE automation_lease SET holder = ?, expires_at = ? WHERE id = ? AND holder = ?`).run(EMPTY_HOLDER, EXPIRED, id, holder);
}
