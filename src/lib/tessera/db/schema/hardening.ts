import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AutomationSummary, ExportFormat, ExportScope, ExportStatus, WebhookEvents } from "../../types";
import { auditColumns, createdColumns } from "./columns";
import { actor, work_item, activity } from "./core";

// ===========================================================================
// Hardening (P10)
// ===========================================================================

export const work_item_version = sqliteTable(
  "work_item_version",
  {
    id: text("id").primaryKey(),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description_md: text("description_md").notNull(),
    version: integer("version").notNull(),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("work_item_version_item_version_idx").on(t.work_item_id, t.version)],
);

export const export_job = sqliteTable("export_job", {
  id: text("id").primaryKey(),
  scope: text("scope", { mode: "json" }).$type<ExportScope>().notNull(),
  format: text("format").$type<ExportFormat>().notNull(),
  status: text("status").$type<ExportStatus>().notNull().default("pending"),
  file_path: text("file_path"),
  error: text("error"),
  ...createdColumns(),
  updated_at: text("updated_at").notNull(),
});

export const webhook = sqliteTable("webhook", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events", { mode: "json" }).$type<WebhookEvents>().notNull().default([]),
  secret: text("secret").notNull().default(""),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...auditColumns(),
});

export const webhook_delivery = sqliteTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    webhook_id: text("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    activity_seq: integer("activity_seq")
      .notNull()
      .references(() => activity.seq, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [index("webhook_delivery_webhook_status_idx").on(t.webhook_id, t.status)],
);

/** Singleton row with id "automation": the hourly run guard across processes. The webhook dispatcher uses id "webhooks". */
export const automation_lease = sqliteTable("automation_lease", {
  id: text("id").primaryKey().default("automation"),
  holder: text("holder").notNull(),
  expires_at: text("expires_at").notNull(),
  last_run_at: text("last_run_at"),
  last_summary: text("last_summary", { mode: "json" }).$type<AutomationSummary>(),
});
