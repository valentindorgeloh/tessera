import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ActorAccess, ActorKind, CycleProgress, Display, Filters, LinkMetadata, Logo, ModuleStatus, PaletteColor, Priority, RichFilters, StateGroup, ViewSettingsScope } from "../../types";
import { DELETED_AT_IS_NULL, auditColumns } from "./columns";
import { estimate, estimate_point } from "./planning";

// ===========================================================================
// Core (P1)
// ===========================================================================

export const actor = sqliteTable(
  "actor",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<ActorKind>().notNull(),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    color: text("color").$type<PaletteColor>().notNull().default("gray"),
    client_name: text("client_name"),
    /** `write` (default), `intake` or `read`. Meaningful for agents; other kinds stay `write`. */
    access: text("access").$type<ActorAccess>().notNull().default("write"),
    last_seen_at: text("last_seen_at"),
    ...auditColumns(),
  },
  (t) => [uniqueIndex("actor_name_key_uq").on(t.name_key).where(DELETED_AT_IS_NULL)],
);

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    identifier: text("identifier").notNull(),
    description_md: text("description_md").notNull().default(""),
    logo: text("logo", { mode: "json" }).$type<Logo>(),
    next_sequence: integer("next_sequence").notNull().default(1),
    cycles_enabled: integer("cycles_enabled", { mode: "boolean" }).notNull().default(true),
    modules_enabled: integer("modules_enabled", { mode: "boolean" }).notNull().default(true),
    views_enabled: integer("views_enabled", { mode: "boolean" }).notNull().default(true),
    pages_enabled: integer("pages_enabled", { mode: "boolean" }).notNull().default(true),
    intake_enabled: integer("intake_enabled", { mode: "boolean" }).notNull().default(false),
    estimates_enabled: integer("estimates_enabled", { mode: "boolean" }).notNull().default(false),
    agent_intake_required: integer("agent_intake_required", { mode: "boolean" }).notNull().default(false),
    estimate_id: text("estimate_id").references((): AnySQLiteColumn => estimate.id, { onDelete: "set null" }),
    default_assignee_id: text("default_assignee_id").references(() => actor.id, { onDelete: "set null" }),
    archive_in_months: integer("archive_in_months"),
    close_in_months: integer("close_in_months"),
    close_state_id: text("close_state_id").references((): AnySQLiteColumn => state.id, { onDelete: "set null" }),
    archived_at: text("archived_at"),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("project_identifier_uq").on(t.identifier).where(DELETED_AT_IS_NULL),
    uniqueIndex("project_name_key_uq").on(t.name_key).where(DELETED_AT_IS_NULL),
  ],
);

export const state = sqliteTable(
  "state",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").$type<PaletteColor>().notNull().default("gray"),
    state_group: text("state_group").$type<StateGroup>().notNull(),
    is_default: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("state_project_name_key_uq").on(t.project_id, t.name_key).where(DELETED_AT_IS_NULL),
    uniqueIndex("state_project_default_uq").on(t.project_id).where(sql`is_default = 1 AND deleted_at IS NULL`),
    index("state_project_group_idx").on(t.project_id, t.state_group),
  ],
);

export const label = sqliteTable(
  "label",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    parent_id: text("parent_id").references((): AnySQLiteColumn => label.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    color: text("color").$type<PaletteColor>().notNull().default("gray"),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex("label_project_name_key_uq").on(t.project_id, t.name_key).where(DELETED_AT_IS_NULL),
    index("label_parent_idx").on(t.parent_id),
  ],
);

export const work_item = sqliteTable(
  "work_item",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    sequence_id: integer("sequence_id").notNull(),
    name: text("name").notNull(),
    description_md: text("description_md").notNull().default(""),
    description_version: integer("description_version").notNull().default(0),
    state_id: text("state_id")
      .notNull()
      .references(() => state.id, { onDelete: "restrict" }),
    priority: text("priority").$type<Priority>().notNull().default("none"),
    parent_id: text("parent_id").references((): AnySQLiteColumn => work_item.id, { onDelete: "cascade" }),
    cycle_id: text("cycle_id").references((): AnySQLiteColumn => cycle.id, { onDelete: "set null" }),
    estimate_point_id: text("estimate_point_id").references((): AnySQLiteColumn => estimate_point.id, { onDelete: "set null" }),
    start_date: text("start_date"),
    target_date: text("target_date"),
    completed_at: text("completed_at"),
    archived_at: text("archived_at"),
    is_draft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    sort_order: text("sort_order").notNull(),
    external_source: text("external_source"),
    external_id: text("external_id"),
    ...auditColumns(),
  },
  (t) => [
    // Not partial: sequence numbers are never reused, even after delete.
    uniqueIndex("work_item_project_sequence_uq").on(t.project_id, t.sequence_id),
    index("work_item_project_state_idx").on(t.project_id, t.state_id),
    index("work_item_project_cycle_idx").on(t.project_id, t.cycle_id),
    // Cycle detail, list counts and progress read by cycle_id alone (decision 126, migration 0010).
    index("work_item_cycle_idx").on(t.cycle_id).where(sql`cycle_id IS NOT NULL`),
    index("work_item_parent_idx").on(t.parent_id),
    index("work_item_project_sort_idx").on(t.project_id, t.sort_order),
    // Workspace-scope list/count (decision 126): covers deleted_at / archived_at filters.
    index("work_item_project_live_sort_idx").on(t.project_id, t.deleted_at, t.archived_at, t.sort_order),
    // Workspace-scope list page and count (decision 126, migration 0011). The page reads live rows in
    // display order through the first and stops at its limit; the count walks the narrow covering second.
    index("work_item_live_sort_idx").on(t.sort_order, t.sequence_id).where(sql`deleted_at IS NULL AND archived_at IS NULL`),
    index("work_item_live_state_idx").on(t.state_id, t.project_id, t.deleted_at, t.archived_at).where(sql`deleted_at IS NULL AND archived_at IS NULL`),
  ],
);

export const work_item_label = sqliteTable(
  "work_item_label",
  {
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    label_id: text("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.work_item_id, t.label_id] }), index("work_item_label_label_idx").on(t.label_id)],
);

export const work_item_module = sqliteTable(
  "work_item_module",
  {
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    module_id: text("module_id")
      .notNull()
      .references((): AnySQLiteColumn => moduleTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.work_item_id, t.module_id] }), index("work_item_module_module_idx").on(t.module_id)],
);

export const work_item_assignee = sqliteTable(
  "work_item_assignee",
  {
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.work_item_id, t.actor_id] }), index("work_item_assignee_actor_idx").on(t.actor_id)],
);

export const work_item_subscriber = sqliteTable(
  "work_item_subscriber",
  {
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.work_item_id, t.actor_id] }), index("work_item_subscriber_actor_idx").on(t.actor_id)],
);

export const cycle = sqliteTable(
  "cycle",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description_md: text("description_md").notNull().default(""),
    start_date: text("start_date"),
    end_date: text("end_date"),
    progress_snapshot: text("progress_snapshot", { mode: "json" }).$type<CycleProgress>(),
    archived_at: text("archived_at"),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [index("cycle_project_start_idx").on(t.project_id, t.start_date)],
);

// Exported as `moduleTable`: a binding named `module` collides with the CommonJS module object in bundled output.
export const moduleTable = sqliteTable(
  "module",
  {
    id: text("id").primaryKey(),
    project_id: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    description_md: text("description_md").notNull().default(""),
    status: text("status").$type<ModuleStatus>().notNull().default("planned"),
    lead_actor_id: text("lead_actor_id").references(() => actor.id, { onDelete: "set null" }),
    start_date: text("start_date"),
    target_date: text("target_date"),
    archived_at: text("archived_at"),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex("module_project_name_key_uq").on(t.project_id, t.name_key).where(DELETED_AT_IS_NULL)],
);

export const module_member = sqliteTable(
  "module_member",
  {
    module_id: text("module_id")
      .notNull()
      .references(() => moduleTable.id, { onDelete: "cascade" }),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.module_id, t.actor_id] })],
);

export const module_link = sqliteTable(
  "module_link",
  {
    id: text("id").primaryKey(),
    module_id: text("module_id")
      .notNull()
      .references(() => moduleTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    url: text("url").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<LinkMetadata>(),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [index("module_link_module_idx").on(t.module_id)],
);

export const work_item_link = sqliteTable(
  "work_item_link",
  {
    id: text("id").primaryKey(),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    url: text("url").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<LinkMetadata>(),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [index("work_item_link_work_item_idx").on(t.work_item_id)],
);

export const view = sqliteTable(
  "view",
  {
    id: text("id").primaryKey(),
    // NULL = workspace view. SQLite treats NULLs as distinct in the unique
    // index, so the service checks workspace-view names itself.
    project_id: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    name_key: text("name_key").notNull(),
    description: text("description").notNull().default(""),
    filters: text("filters", { mode: "json" }).$type<Filters>().notNull(),
    rich_filters: text("rich_filters", { mode: "json" }).$type<RichFilters>(),
    display: text("display", { mode: "json" }).$type<Display>().notNull(),
    is_locked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    logo: text("logo", { mode: "json" }).$type<Logo>(),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex("view_project_name_key_uq").on(t.project_id, t.name_key).where(DELETED_AT_IS_NULL)],
);

export const view_settings = sqliteTable(
  "view_settings",
  {
    scope_type: text("scope_type").$type<ViewSettingsScope>().notNull(),
    // "workspace" for the workspace scope, otherwise the project / cycle / module / actor id.
    scope_id: text("scope_id").notNull(),
    filters: text("filters", { mode: "json" }).$type<Filters>().notNull(),
    display: text("display", { mode: "json" }).$type<Display>().notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope_type, t.scope_id] })],
);

export const activity = sqliteTable(
  "activity",
  {
    // The global change cursor (decision 24).
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    uid: text("uid").notNull().unique("activity_uid_uq"),
    project_id: text("project_id").references(() => project.id, { onDelete: "set null" }),
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    work_item_id: text("work_item_id").references(() => work_item.id, { onDelete: "set null" }),
    verb: text("verb").notNull(),
    field: text("field"),
    old_value: text("old_value"),
    new_value: text("new_value"),
    old_identifier: text("old_identifier"),
    new_identifier: text("new_identifier"),
    comment: text("comment"),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("activity_project_seq_idx").on(t.project_id, t.seq),
    index("activity_work_item_seq_idx").on(t.work_item_id, t.seq),
    index("activity_actor_seq_idx").on(t.actor_id, t.seq),
    // Decision 109 workspaceRev: MAX(seq) WHERE project_id IS NULL.
    index("activity_workspace_seq_idx").on(t.seq).where(sql`project_id IS NULL`),
  ],
);
