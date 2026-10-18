/**
 * Webhook delivery queue and sender. Enqueue advances each webhook's cursor;
 * send runs outside the mutation that wrote the activity so a delivery failure
 * never rolls back a work-item change.
 */
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { newId } from "../core/ids";
import { activity, webhook, webhook_delivery } from "../db/schema";
import type { ActivityRow, WebhookDeliveryRow } from "../types";
import { activityEvent, buildPayload, buildPingPayload, matchesEvent } from "./events";
import { signPayload } from "./sign";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;
const DEFAULT_SEND_LIMIT = 100;
const FETCH_TIMEOUT_MS = 10_000;

/** Next attempt timestamp after `attempts` failures, or null once the schedule is exhausted. */
export function nextAttemptAt(attempts: number, now: string): string | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return null;
  return new Date(Date.parse(now) + delay).toISOString();
}

/** Turns new activity into pending deliveries for every matching active webhook. */
export function enqueueDeliveries(ctx: TesseraContext, now: string): number {
  const hooks = ctx.db
    .select()
    .from(webhook)
    .where(and(eq(webhook.is_active, true), isNull(webhook.deleted_at)))
    .all();
  let created = 0;
  for (const hook of hooks) {
    const rows = ctx.db
      .select()
      .from(activity)
      .where(gt(activity.seq, hook.last_seq))
      .orderBy(asc(activity.seq))
      .all() as ActivityRow[];
    let maxSeq = hook.last_seq;
    for (const row of rows) {
      maxSeq = row.seq;
      const event = activityEvent(row);
      if (event.startsWith("webhook.")) continue;
      if (!matchesEvent(hook.events, event)) continue;
      ctx.db
        .insert(webhook_delivery)
        .values({
          id: newId(),
          webhook_id: hook.id,
          activity_seq: row.seq,
          event,
          status: "pending",
          attempts: 0,
          last_error: null,
          response_status: null,
          next_attempt_at: now,
          created_at: now,
          updated_at: now,
        })
        .run();
      created += 1;
    }
    if (maxSeq > hook.last_seq) {
      ctx.db.update(webhook).set({ last_seq: maxSeq, updated_at: now }).where(eq(webhook.id, hook.id)).run();
    }
  }
  return created;
}

type DueRow = WebhookDeliveryRow & { url: string; secret: string };

/** Sends up to `limit` due deliveries with a 10 s timeout per request. */
export async function sendDueDeliveries(
  ctx: TesseraContext,
  now: string,
  fetchImpl: typeof fetch,
  limit = DEFAULT_SEND_LIMIT,
): Promise<{ sent: number; delivered: number; failed: number }> {
  const due = ctx.db
    .select({
      id: webhook_delivery.id,
      webhook_id: webhook_delivery.webhook_id,
      activity_seq: webhook_delivery.activity_seq,
      event: webhook_delivery.event,
      status: webhook_delivery.status,
      attempts: webhook_delivery.attempts,
      last_error: webhook_delivery.last_error,
      response_status: webhook_delivery.response_status,
      next_attempt_at: webhook_delivery.next_attempt_at,
      created_at: webhook_delivery.created_at,
      updated_at: webhook_delivery.updated_at,
      url: webhook.url,
      secret: webhook.secret,
    })
    .from(webhook_delivery)
    .innerJoin(webhook, eq(webhook.id, webhook_delivery.webhook_id))
    .where(
      and(
        eq(webhook_delivery.status, "pending"),
        or(isNull(webhook_delivery.next_attempt_at), lte(webhook_delivery.next_attempt_at, now)),
        isNull(webhook.deleted_at),
      ),
    )
    .orderBy(asc(webhook_delivery.activity_seq), asc(webhook_delivery.created_at))
    .limit(limit)
    .all() as DueRow[];

  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    const result = await sendOne(ctx, row, now, fetchImpl);
    if (result === "delivered") delivered += 1;
    else if (result === "failed") failed += 1;
  }
  return { sent: due.length, delivered, failed };
}

async function sendOne(ctx: TesseraContext, row: DueRow, now: string, fetchImpl: typeof fetch): Promise<"delivered" | "failed" | "retry"> {
  const body = JSON.stringify(payloadFor(ctx, row, now));
  const timestamp = now;
  const signature = signPayload(row.secret, timestamp, body);
  let status = 0;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(row.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Tessera-Event": row.event,
          "X-Tessera-Delivery": row.id,
          "X-Tessera-Timestamp": timestamp,
          "X-Tessera-Signature": signature,
        },
        body,
        signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const attempts = row.attempts + 1;
  if (status >= 200 && status < 300) {
    ctx.db
      .update(webhook_delivery)
      .set({ status: "delivered", attempts, response_status: status, last_error: null, next_attempt_at: null, updated_at: now })
      .where(eq(webhook_delivery.id, row.id))
      .run();
    return "delivered";
  }
  if (status === 410) {
    ctx.db
      .update(webhook_delivery)
      .set({ status: "failed", attempts, response_status: status, last_error: error ?? "HTTP 410", next_attempt_at: null, updated_at: now })
      .where(eq(webhook_delivery.id, row.id))
      .run();
    ctx.db.update(webhook).set({ is_active: false, updated_at: now }).where(eq(webhook.id, row.webhook_id)).run();
    return "failed";
  }
  const next = nextAttemptAt(attempts, now);
  if (next === null) {
    ctx.db
      .update(webhook_delivery)
      .set({
        status: "failed",
        attempts,
        response_status: status || null,
        last_error: error ?? "delivery failed",
        next_attempt_at: null,
        updated_at: now,
      })
      .where(eq(webhook_delivery.id, row.id))
      .run();
    return "failed";
  }
  ctx.db
    .update(webhook_delivery)
    .set({ status: "pending", attempts, response_status: status || null, last_error: error, next_attempt_at: next, updated_at: now })
    .where(eq(webhook_delivery.id, row.id))
    .run();
  return "retry";
}

function payloadFor(ctx: TesseraContext, row: DueRow, now: string) {
  if (row.event === "ping" || row.activity_seq === null) return buildPingPayload(row.id, now);
  const activityRow = ctx.db.select().from(activity).where(eq(activity.seq, row.activity_seq)).get();
  if (!activityRow) return buildPingPayload(row.id, now);
  return buildPayload(ctx, activityRow as ActivityRow, row.id);
}
