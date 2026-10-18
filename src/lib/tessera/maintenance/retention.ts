/**
 * Retention plan and purge (decision 122). Derived and delivery state only;
 * no activity rows. The latest undoable assistant batch is never deleted.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import fs from "node:fs";
import { findLatestUndoableBatchId } from "../ai/undo";
import type { TesseraContext } from "../core/context";
import { ai_proposal, export_job, notification, webhook_delivery } from "../db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionCounts = {
  proposals: number;
  notifications: number;
  webhook_deliveries: number;
  export_jobs: number;
};

export type RetentionPlan = RetentionCounts & {
  proposal_ids: string[];
  notification_seqs: number[];
  delivery_ids: string[];
  export_ids: string[];
  export_paths: string[];
};

function ago(now: string, days: number): string {
  return new Date(Date.parse(now) - days * DAY_MS).toISOString();
}

/** Counts (and ids) that retention would remove at `now`. */
export function planRetention(ctx: TesseraContext, now: string): RetentionPlan {
  const keepBatch = findLatestUndoableBatchId(ctx, now);
  const proposalCutoffDiscarded = ago(now, 30);
  const proposalCutoffApplied = ago(now, 90);
  const proposals = ctx.db
    .select({ id: ai_proposal.id, status: ai_proposal.status, decided_at: ai_proposal.decided_at, apply_batch_id: ai_proposal.apply_batch_id })
    .from(ai_proposal)
    .where(
      or(
        and(inArray(ai_proposal.status, ["discarded", "failed"]), lt(ai_proposal.decided_at, proposalCutoffDiscarded)),
        and(eq(ai_proposal.status, "pending"), lt(ai_proposal.created_at, proposalCutoffDiscarded)),
        and(eq(ai_proposal.status, "applied"), lt(ai_proposal.decided_at, proposalCutoffApplied)),
      ),
    )
    .all()
    .filter((row) => row.apply_batch_id === null || row.apply_batch_id !== keepBatch)
    .map((row) => row.id);

  const notifications = ctx.db
    .select({ seq: notification.seq })
    .from(notification)
    .where(
      or(
        and(isNotNull(notification.archived_at), lt(notification.archived_at, ago(now, 90))),
        and(isNotNull(notification.read_at), isNull(notification.archived_at), lt(notification.read_at, ago(now, 180))),
      ),
    )
    .all()
    .map((row) => row.seq);

  const deliveries = ctx.db
    .select({ id: webhook_delivery.id })
    .from(webhook_delivery)
    .where(and(eq(webhook_delivery.status, "delivered"), lt(webhook_delivery.created_at, ago(now, 30))))
    .all()
    .map((row) => row.id);

  const exports = ctx.db
    .select({ id: export_job.id, file_path: export_job.file_path })
    .from(export_job)
    .where(lt(export_job.created_at, ago(now, 30)))
    .all();

  return {
    proposals: proposals.length,
    notifications: notifications.length,
    webhook_deliveries: deliveries.length,
    export_jobs: exports.length,
    proposal_ids: proposals,
    notification_seqs: notifications,
    delivery_ids: deliveries,
    export_ids: exports.map((row) => row.id),
    export_paths: exports.map((row) => row.file_path).filter((p): p is string => p !== null),
  };
}

/** Applies a plan. Safe to call with an empty plan. */
export function applyRetention(ctx: TesseraContext, plan: RetentionPlan): RetentionCounts {
  if (plan.proposal_ids.length > 0) {
    ctx.db.delete(ai_proposal).where(inArray(ai_proposal.id, plan.proposal_ids)).run();
  }
  if (plan.notification_seqs.length > 0) {
    ctx.db.delete(notification).where(inArray(notification.seq, plan.notification_seqs)).run();
  }
  if (plan.delivery_ids.length > 0) {
    ctx.db.delete(webhook_delivery).where(inArray(webhook_delivery.id, plan.delivery_ids)).run();
  }
  for (const file of plan.export_paths) {
    fs.rmSync(file, { force: true });
  }
  if (plan.export_ids.length > 0) {
    ctx.db.delete(export_job).where(inArray(export_job.id, plan.export_ids)).run();
  }
  return {
    proposals: plan.proposals,
    notifications: plan.notifications,
    webhook_deliveries: plan.webhook_deliveries,
    export_jobs: plan.export_jobs,
  };
}

/** Empty plan used when dry-run reporting needs a zero summary. */
export function emptyRetention(): RetentionCounts {
  return { proposals: 0, notifications: 0, webhook_deliveries: 0, export_jobs: 0 };
}
