/**
 * Pure helpers for the webhooks settings UI (docs/drafts/p10-plan.md U2).
 */
import { WebhookEventSchema } from "@/lib/tessera/schemas";
import type { WebhookDeliveryStatus, WebhookEvent } from "@/lib/tessera/types";

/** Common event patterns offered as checkboxes in the create/edit dialog. */
export const COMMON_WEBHOOK_EVENTS: readonly { value: WebhookEvent; label: string }[] = [
  { value: "*", label: "Everything (*)" },
  { value: "work_item.*", label: "Work items (work_item.*)" },
  { value: "work_item.created", label: "Work item created" },
  { value: "work_item.updated", label: "Work item updated" },
  { value: "work_item.archived", label: "Work item archived" },
  { value: "comment.*", label: "Comments (comment.*)" },
  { value: "page.*", label: "Pages (page.*)" },
  { value: "cycle.*", label: "Cycles (cycle.*)" },
  { value: "module.*", label: "Modules (module.*)" },
  { value: "project.*", label: "Projects (project.*)" },
];

const COMMON_SET = new Set(COMMON_WEBHOOK_EVENTS.map((entry) => entry.value));

export function isCommonWebhookEvent(value: string): value is WebhookEvent {
  return COMMON_SET.has(value as WebhookEvent);
}

/** Patterns not covered by the common checkboxes. */
export function customWebhookEvents(events: readonly string[]): string[] {
  return events.filter((event) => !isCommonWebhookEvent(event));
}

/** One-line summary for a list row. */
export function eventsSummary(events: readonly string[]): string {
  if (events.length === 0) return "No events";
  if (events.includes("*")) return "Everything";
  if (events.length <= 2) return events.join(", ");
  return `${events.slice(0, 2).join(", ")} +${events.length - 2}`;
}

/** Validates a custom pattern string; null when valid. */
export function webhookEventError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = WebhookEventSchema.safeParse(trimmed);
  return parsed.success ? null : "Use *, entity.*, entity.verb, or ping";
}

export function parseCustomEvents(value: string): { events: WebhookEvent[]; error: string | null } {
  const parts = value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const events: WebhookEvent[] = [];
  for (const part of parts) {
    const parsed = WebhookEventSchema.safeParse(part);
    if (!parsed.success) return { events: [], error: `“${part}” is not a valid event pattern` };
    if (!events.includes(parsed.data)) events.push(parsed.data);
  }
  return { events, error: null };
}

export function webhookUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A URL is required";
  if (!/^https?:\/\/.+/i.test(trimmed)) return "Use an http or https URL";
  return null;
}

export function webhookNameError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A name is required";
  if (trimmed.length > 120) return "Use 120 characters or fewer";
  return null;
}

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatus, string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
};

export function deliveryStatusVariant(status: WebhookDeliveryStatus): "accent" | "success" | "error" {
  if (status === "delivered") return "success";
  if (status === "failed") return "error";
  return "accent";
}
