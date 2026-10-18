import { z } from "zod";
import {
  createWebhook,
  CreateWebhookInput,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  ListDeliveriesInput,
  redeliverWebhookDelivery,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
  UpdateWebhookInput,
  WebhookIdInput,
} from "../../webhooks";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";

const DeliveryIdInput = z.object({ delivery_id: IdSchema.describe("Webhook delivery id.") }).strict();

export const webhookTools = [
  defineTool({
    name: "list_webhooks",
    title: "List webhooks",
    description: "Lists outbound webhooks with delivery counts. The signing secret is only included for the user actor.",
    input: z.object({}).strict(),
    mutates: false,
    phase: "P10",
    run: (ctx) => listWebhooks(ctx),
  }),
  defineTool({
    name: "create_webhook",
    title: "Create webhook",
    description: "Creates an outbound webhook with a generated signing secret. The cursor starts at the current activity tip (no backfill). User only.",
    input: CreateWebhookInput,
    mutates: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, input) => createWebhook(ctx, input),
  }),
  defineTool({
    name: "update_webhook",
    title: "Update webhook",
    description: "Updates a webhook's name, URL, events or active flag. User only.",
    input: UpdateWebhookInput,
    mutates: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, input) => updateWebhook(ctx, input),
  }),
  defineTool({
    name: "delete_webhook",
    title: "Delete webhook",
    description: "Soft-deletes a webhook and marks its pending deliveries failed. Destructive: requires confirm: true. User only.",
    input: WebhookIdInput,
    mutates: true,
    destructive: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, { webhook_id }) => {
      deleteWebhook(ctx, webhook_id);
      return { deleted: true };
    },
  }),
  defineTool({
    name: "rotate_webhook_secret",
    title: "Rotate webhook secret",
    description: "Replaces the signing secret and returns the new one. User only.",
    input: WebhookIdInput,
    mutates: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, { webhook_id }) => rotateWebhookSecret(ctx, webhook_id),
  }),
  defineTool({
    name: "test_webhook",
    title: "Test webhook",
    description: "Enqueues a ping delivery due immediately for the webhook. User only.",
    input: WebhookIdInput,
    mutates: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, { webhook_id }) => testWebhook(ctx, webhook_id),
  }),
  defineTool({
    name: "list_webhook_deliveries",
    title: "List webhook deliveries",
    description: "Lists deliveries for one webhook, newest first, optionally filtered by status.",
    input: ListDeliveriesInput,
    mutates: false,
    phase: "P10",
    run: (ctx, input) => listWebhookDeliveries(ctx, input),
  }),
  defineTool({
    name: "redeliver_webhook_delivery",
    title: "Redeliver webhook delivery",
    description: "Resets a delivery to pending with zero attempts so the dispatcher sends it again. User only.",
    input: DeliveryIdInput,
    mutates: true,
    userOnly: true,
    phase: "P10",
    run: (ctx, { delivery_id }) => redeliverWebhookDelivery(ctx, delivery_id),
  }),
];
