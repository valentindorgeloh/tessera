/**
 * Outbound signed webhooks. Writes are user-only at the tool layer; secrets
 * are omitted for non-user list reads.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { latestSeq, logActivity } from "../activity";
import { USER_ACTOR_ID } from "../actors";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import { withTx } from "../core/tx";
import { webhook, webhook_delivery } from "../db/schema";
import { IdSchema, WebhookDeliveryStatusSchema, WebhookEventsInputSchema } from "../schemas";
import type { WebhookDeliveryStatus, WebhookRow } from "../types";
export { activityEvent, buildPayload, buildPingPayload, matchesEvent, type WebhookPayload } from "./events";
export { signPayload } from "./sign";
export { enqueueDeliveries, nextAttemptAt, sendDueDeliveries } from "./dispatch";

export type WebhookView = {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret?: string;
  last_seq: number;
  created_at: string;
  counts: { pending: number; failed: number };
};

export type WebhookDeliveryView = {
  id: string;
  webhook_id: string;
  activity_seq: number | null;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  last_error: string | null;
  response_status: number | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

const UrlSchema = z
  .string()
  .regex(/^https?:\/\/.+/i, "url must be http or https")
  .describe("Delivery URL (http or https).");

export const CreateWebhookInput = z
  .object({
    name: z.string().trim().min(1).max(120).describe("Display name."),
    url: UrlSchema,
    events: WebhookEventsInputSchema.describe("Event patterns to deliver."),
    is_active: z.boolean().optional().describe("Defaults to true."),
  })
  .strict();

export const UpdateWebhookInput = z
  .object({
    webhook_id: IdSchema.describe("Webhook id."),
    name: z.string().trim().min(1).max(120).optional().describe("Display name."),
    url: UrlSchema.optional(),
    events: WebhookEventsInputSchema.optional().describe("Event patterns to deliver."),
    is_active: z.boolean().optional().describe("When false, the dispatcher skips this webhook."),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.url !== undefined || value.events !== undefined || value.is_active !== undefined, {
    message: "at least one of name, url, events or is_active is required",
  });

const WebhookIdInput = z.object({ webhook_id: IdSchema.describe("Webhook id.") }).strict();

const ListDeliveriesInput = z
  .object({
    webhook_id: IdSchema.describe("Webhook id."),
    status: WebhookDeliveryStatusSchema.optional().describe("Filter by delivery status."),
    limit: z.number().int().min(1).max(200).optional().describe("How many rows, newest first. Default 50."),
  })
  .strict();

function newSecret(): string {
  return randomBytes(32).toString("hex");
}

function loadWebhook(ctx: TesseraContext, id: string): WebhookRow {
  const row = ctx.db.select().from(webhook).where(and(eq(webhook.id, id), isNull(webhook.deleted_at))).get();
  if (!row) throw notFound("webhook", id);
  return row;
}

function countsFor(ctx: TesseraContext, webhookId: string): { pending: number; failed: number } {
  const rows = ctx.db
    .select({ status: webhook_delivery.status, n: sql<number>`count(*)` })
    .from(webhook_delivery)
    .where(and(eq(webhook_delivery.webhook_id, webhookId), sql`${webhook_delivery.status} IN ('pending', 'failed')`))
    .groupBy(webhook_delivery.status)
    .all();
  const counts = { pending: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === "pending") counts.pending = Number(row.n);
    if (row.status === "failed") counts.failed = Number(row.n);
  }
  return counts;
}

function toView(ctx: TesseraContext, row: WebhookRow, includeSecret: boolean): WebhookView {
  const view: WebhookView = {
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    is_active: row.is_active,
    last_seq: row.last_seq,
    created_at: row.created_at,
    counts: countsFor(ctx, row.id),
  };
  if (includeSecret) view.secret = row.secret;
  return view;
}

function toDeliveryView(row: typeof webhook_delivery.$inferSelect): WebhookDeliveryView {
  return {
    id: row.id,
    webhook_id: row.webhook_id,
    activity_seq: row.activity_seq,
    event: row.event,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    last_error: row.last_error,
    response_status: row.response_status,
    next_attempt_at: row.next_attempt_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function showSecret(ctx: TesseraContext): boolean {
  return ctx.actor.id === USER_ACTOR_ID;
}

/** Lists webhooks; the secret is only included for the user actor. */
export function listWebhooks(ctx: TesseraContext): WebhookView[] {
  const rows = ctx.db.select().from(webhook).where(isNull(webhook.deleted_at)).orderBy(asc(webhook.created_at)).all();
  const secret = showSecret(ctx);
  return rows.map((row) => toView(ctx, row, secret));
}

export function createWebhook(ctx: TesseraContext, input: z.input<typeof CreateWebhookInput>): WebhookView {
  const data = validateInput(CreateWebhookInput, input);
  return withTx(ctx, () => {
    const now = ctx.now();
    const row = ctx.db
      .insert(webhook)
      .values({
        id: newId(),
        name: data.name,
        url: data.url,
        events: data.events,
        secret: newSecret(),
        is_active: data.is_active ?? true,
        last_seq: latestSeq(ctx),
        created_at: now,
        updated_at: now,
        created_by: ctx.actor.id,
        updated_by: ctx.actor.id,
      })
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "webhook", entity_id: row.id, verb: "created", new_identifier: row.name });
    return toView(ctx, row, true);
  });
}

export function updateWebhook(ctx: TesseraContext, input: z.input<typeof UpdateWebhookInput>): WebhookView {
  const data = validateInput(UpdateWebhookInput, input);
  return withTx(ctx, () => {
    const before = loadWebhook(ctx, data.webhook_id);
    const now = ctx.now();
    const row = ctx.db
      .update(webhook)
      .set({
        name: data.name ?? before.name,
        url: data.url ?? before.url,
        events: data.events ?? before.events,
        is_active: data.is_active ?? before.is_active,
        updated_at: now,
        updated_by: ctx.actor.id,
      })
      .where(eq(webhook.id, before.id))
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "webhook", entity_id: row.id, verb: "updated", new_identifier: row.name });
    return toView(ctx, row, showSecret(ctx));
  });
}

export function deleteWebhook(ctx: TesseraContext, id: string): void {
  withTx(ctx, () => {
    const row = loadWebhook(ctx, id);
    const now = ctx.now();
    ctx.db
      .update(webhook)
      .set({ deleted_at: now, is_active: false, updated_at: now, updated_by: ctx.actor.id })
      .where(eq(webhook.id, row.id))
      .run();
    ctx.db
      .update(webhook_delivery)
      .set({ status: "failed", last_error: "webhook deleted", next_attempt_at: null, updated_at: now })
      .where(and(eq(webhook_delivery.webhook_id, row.id), eq(webhook_delivery.status, "pending")))
      .run();
    logActivity(ctx, { project_id: null, entity_type: "webhook", entity_id: row.id, verb: "deleted", old_identifier: row.name });
  });
}

export function rotateWebhookSecret(ctx: TesseraContext, id: string): WebhookView {
  return withTx(ctx, () => {
    const before = loadWebhook(ctx, id);
    const now = ctx.now();
    const row = ctx.db
      .update(webhook)
      .set({ secret: newSecret(), updated_at: now, updated_by: ctx.actor.id })
      .where(eq(webhook.id, before.id))
      .returning()
      .get();
    logActivity(ctx, { project_id: null, entity_type: "webhook", entity_id: row.id, verb: "updated", field: "secret" });
    return toView(ctx, row, true);
  });
}

/** Enqueues a ping delivery due immediately. */
export function testWebhook(ctx: TesseraContext, id: string): WebhookDeliveryView {
  return withTx(ctx, () => {
    const row = loadWebhook(ctx, id);
    const now = ctx.now();
    const delivery = ctx.db
      .insert(webhook_delivery)
      .values({
        id: newId(),
        webhook_id: row.id,
        activity_seq: null,
        event: "ping",
        status: "pending",
        attempts: 0,
        last_error: null,
        response_status: null,
        next_attempt_at: now,
        created_at: now,
        updated_at: now,
      })
      .returning()
      .get();
    return toDeliveryView(delivery);
  });
}

export function listWebhookDeliveries(ctx: TesseraContext, input: z.input<typeof ListDeliveriesInput>): WebhookDeliveryView[] {
  const data = validateInput(ListDeliveriesInput, input);
  loadWebhook(ctx, data.webhook_id);
  const limit = data.limit ?? 50;
  const rows =
    data.status === undefined
      ? ctx.db
          .select()
          .from(webhook_delivery)
          .where(eq(webhook_delivery.webhook_id, data.webhook_id))
          .orderBy(desc(webhook_delivery.created_at))
          .limit(limit)
          .all()
      : ctx.db
          .select()
          .from(webhook_delivery)
          .where(and(eq(webhook_delivery.webhook_id, data.webhook_id), eq(webhook_delivery.status, data.status)))
          .orderBy(desc(webhook_delivery.created_at))
          .limit(limit)
          .all();
  return rows.map(toDeliveryView);
}

export function redeliverWebhookDelivery(ctx: TesseraContext, deliveryId: string): WebhookDeliveryView {
  return withTx(ctx, () => {
    const row = ctx.db.select().from(webhook_delivery).where(eq(webhook_delivery.id, deliveryId)).get();
    if (!row) throw notFound("webhook_delivery", deliveryId);
    loadWebhook(ctx, row.webhook_id);
    const now = ctx.now();
    const updated = ctx.db
      .update(webhook_delivery)
      .set({ status: "pending", attempts: 0, last_error: null, response_status: null, next_attempt_at: now, updated_at: now })
      .where(eq(webhook_delivery.id, row.id))
      .returning()
      .get();
    return toDeliveryView(updated);
  });
}

export { WebhookIdInput, ListDeliveriesInput };
