"use server";

import { toolAction } from "./_run";

export const createWebhookAction = toolAction("create_webhook");
export const updateWebhookAction = toolAction("update_webhook");
export const deleteWebhookAction = toolAction("delete_webhook");
export const rotateWebhookSecretAction = toolAction("rotate_webhook_secret");
export const testWebhookAction = toolAction("test_webhook");
export const redeliverWebhookDeliveryAction = toolAction("redeliver_webhook_delivery");
