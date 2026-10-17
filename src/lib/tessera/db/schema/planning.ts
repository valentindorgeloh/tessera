import { index, integer, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { EstimateType, IntakeSource, IntakeStatus, Priority } from "../../types";
import { auditColumns } from "./columns";
import { actor, project, state, work_item, cycle } from "./core";

// ===========================================================================
// Planning extras (P8)
// ===========================================================================

export const draft_work_item = sqliteTable(
  "draft_work_item",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id").references(() => project.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description_md: text("description_md").notNull().default(""),
    state_id: text("state_id").references(() => state.id, { onDelete: "set null" }),
    priority: text("priority").$type<Priority>().notNull().default("none"),
    parent_id: text("parent_id").references(() => work_item.id, { onDelete: "set null" }),
    cycle_id: text("cycle_id").references(() => cycle.id, { onDelete: "set null" }),
    label_ids: text("label_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    module_ids: text("module_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    assignee_ids: text("assignee_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    estimate_point_id: text("estimate_point_id").references((): AnySQLiteColumn => estimate_point.id, { onDelete: "set null" }),
    start_date: text("start_date"),
    target_date: text("target_date"),
    ...auditColumns(),
  },
  (t) => [index("draft_work_item_project_idx").on(t.project_id)],
);

export const intake = sqliteTable(
  "intake",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    is_default: integer("is_default", { mode: "boolean" }).notNull().default(false),
    ...auditColumns(),
  },
  (t) => [index("intake_project_idx").on(t.project_id)],
);

export const intake_item = sqliteTable(
  "intake_item",
  {
    id: text("id").primaryKey(),
    intake_id: text("intake_id")
      .notNull()
      .references(() => intake.id, { onDelete: "cascade" }),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    status: text("status").$type<IntakeStatus>().notNull().default("pending"),
    snoozed_till: text("snoozed_till"),
    duplicate_to_id: text("duplicate_to_id").references(() => work_item.id, { onDelete: "set null" }),
    source: text("source").$type<IntakeSource>().notNull().default("in_app"),
    created_by_actor_id: text("created_by_actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (t) => [index("intake_item_intake_status_idx").on(t.intake_id, t.status), index("intake_item_work_item_idx").on(t.work_item_id)],
);

export const estimate = sqliteTable(
  "estimate",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<EstimateType>().notNull().default("points"),
    last_used: integer("last_used", { mode: "boolean" }).notNull().default(false),
    archived_at: text("archived_at"),
    ...auditColumns(),
  },
  (t) => [index("estimate_project_idx").on(t.project_id)],
);

export const estimate_point = sqliteTable(
  "estimate_point",
  {
    id: text("id").primaryKey(),
    estimate_id: text("estimate_id")
      .notNull()
      .references(() => estimate.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    value: text("value").notNull(),
    description: text("description").notNull().default(""),
    ...auditColumns(),
  },
  (t) => [index("estimate_point_estimate_position_idx").on(t.estimate_id, t.position)],
);
