/**
 * Tessera database schema (Drizzle, SQLite). Implements docs/contracts/schema.md;
 * the contract wins when the two disagree. Migrations are generated from this
 * file by `npm run db:generate`. The FTS5 tables live in a hand-written
 * migration (drizzle/0001_fts.sql) and in db/fts.ts, not here.
 *
 * Conventions: UUIDv7 text ids, ISO text timestamps, `YYYY-MM-DD` dates,
 * booleans as integer({ mode: "boolean" }), JSON as text({ mode: "json" }) typed
 * with the zod-inferred shapes from ../types, enums as plain text validated by
 * zod, soft delete through `deleted_at` with partial unique indexes.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type {
  ActorKind,
  CycleProgress,
  Display,
  EstimateType,
  ExportFormat,
  ExportScope,
  ExportStatus,
  FavoriteEntityType,
  Filters,
  HomeWidgets,
  IntakeSource,
  IntakeStatus,
  LinkMetadata,
  Logo,
  ModuleStatus,
  PageAccess,
  PaletteColor,
  Priority,
  RelationType,
  RichFilters,
  StateGroup,
  ViewSettingsScope,
  WebhookEvents,
  WorkspaceAiSettings,
} from "../types";

const DELETED_AT_IS_NULL = sql`deleted_at IS NULL`;

/** created_at / updated_at / created_by / updated_by / deleted_at on every entity table. */
function auditColumns() {
  return {
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    created_by: text("created_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
    updated_by: text("updated_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
    deleted_at: text("deleted_at"),
  };
}

/** Append-only rows (junctions, reactions, versions) record who and when, nothing else. */
function createdColumns() {
  return {
    created_at: text("created_at").notNull(),
    created_by: text("created_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
  };
}

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
    index("work_item_parent_idx").on(t.parent_id),
    index("work_item_project_sort_idx").on(t.project_id, t.sort_order),
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
  ],
);

// ===========================================================================
// Pages (P6)
// ===========================================================================

export const page = sqliteTable(
  "page",
  {
    id: text("id").primaryKey(),
    // NULL = wiki page.
    project_id: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    parent_id: text("parent_id").references((): AnySQLiteColumn => page.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description_md: text("description_md").notNull().default(""),
    description_version: integer("description_version").notNull().default(0),
    access: text("access").$type<PageAccess>().notNull().default("public"),
    is_locked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    logo: text("logo", { mode: "json" }).$type<Logo>(),
    archived_at: text("archived_at"),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [index("page_project_idx").on(t.project_id), index("page_parent_idx").on(t.parent_id)],
);

export const page_label = sqliteTable(
  "page_label",
  {
    page_id: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    label_id: text("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.page_id, t.label_id] })],
);

export const page_version = sqliteTable(
  "page_version",
  {
    id: text("id").primaryKey(),
    page_id: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description_md: text("description_md").notNull(),
    version: integer("version").notNull(),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("page_version_page_version_idx").on(t.page_id, t.version)],
);

export const page_embed = sqliteTable(
  "page_embed",
  {
    page_id: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    // work_item, page, cycle or module.
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.page_id, t.entity_type, t.entity_id] }),
    index("page_embed_entity_idx").on(t.entity_type, t.entity_id),
  ],
);

// ===========================================================================
// Collaboration (P7)
// ===========================================================================

export const work_item_relation = sqliteTable(
  "work_item_relation",
  {
    id: text("id").primaryKey(),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    related_work_item_id: text("related_work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    relation_type: text("relation_type").$type<RelationType>().notNull(),
    ...auditColumns(),
  },
  (t) => [
    // The service stores one canonical direction per unordered pair.
    uniqueIndex("work_item_relation_pair_uq").on(t.work_item_id, t.related_work_item_id).where(DELETED_AT_IS_NULL),
    index("work_item_relation_related_idx").on(t.related_work_item_id),
  ],
);

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    parent_comment_id: text("parent_comment_id").references((): AnySQLiteColumn => comment.id, { onDelete: "cascade" }),
    body_md: text("body_md").notNull(),
    body_version: integer("body_version").notNull().default(0),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "restrict" }),
    edited_at: text("edited_at"),
    ...auditColumns(),
  },
  (t) => [index("comment_work_item_created_idx").on(t.work_item_id, t.created_at)],
);

export const comment_reaction = sqliteTable(
  "comment_reaction",
  {
    id: text("id").primaryKey(),
    comment_id: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("comment_reaction_uq").on(t.comment_id, t.actor_id, t.reaction)],
);

export const work_item_reaction = sqliteTable(
  "work_item_reaction",
  {
    id: text("id").primaryKey(),
    work_item_id: text("work_item_id")
      .notNull()
      .references(() => work_item.id, { onDelete: "cascade" }),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("work_item_reaction_uq").on(t.work_item_id, t.actor_id, t.reaction)],
);

export const mention = sqliteTable(
  "mention",
  {
    // work_item, comment or page.
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    actor_id: text("actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    created_at: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entity_type, t.entity_id, t.actor_id] }), index("mention_actor_idx").on(t.actor_id)],
);

export const notification = sqliteTable(
  "notification",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    uid: text("uid").notNull().unique("notification_uid_uq"),
    recipient_actor_id: text("recipient_actor_id")
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    // assigned, mentioned, commented, state_changed, intake_received, automation, ...
    kind: text("kind").notNull(),
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    work_item_id: text("work_item_id").references(() => work_item.id, { onDelete: "set null" }),
    project_id: text("project_id").references(() => project.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    snippet: text("snippet").notNull().default(""),
    // Who caused the notification; never the recipient.
    actor_id: text("actor_id").references(() => actor.id, { onDelete: "set null" }),
    read_at: text("read_at"),
    archived_at: text("archived_at"),
    snoozed_till: text("snoozed_till"),
    created_at: text("created_at").notNull(),
  },
  (t) => [index("notification_recipient_read_seq_idx").on(t.recipient_actor_id, t.read_at, t.seq)],
);

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

// ===========================================================================
// Workspace (P9)
// ===========================================================================

export const favorite_folder = sqliteTable("favorite_folder", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sort_order: text("sort_order").notNull(),
  ...auditColumns(),
});

export const favorite = sqliteTable(
  "favorite",
  {
    id: text("id").primaryKey(),
    entity_type: text("entity_type").$type<FavoriteEntityType>().notNull(),
    entity_id: text("entity_id").notNull(),
    folder_id: text("folder_id").references(() => favorite_folder.id, { onDelete: "set null" }),
    sort_order: text("sort_order").notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex("favorite_entity_uq").on(t.entity_type, t.entity_id).where(DELETED_AT_IS_NULL)],
);

export const recent_visit = sqliteTable(
  "recent_visit",
  {
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    visited_at: text("visited_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entity_type, t.entity_id] }), index("recent_visit_visited_idx").on(t.visited_at)],
);

export const sticky = sqliteTable("sticky", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  description_md: text("description_md").notNull().default(""),
  color: text("color").$type<PaletteColor>().notNull().default("yellow"),
  sort_order: text("sort_order").notNull(),
  ...auditColumns(),
});

export const quick_link = sqliteTable("quick_link", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  url: text("url").notNull(),
  sort_order: text("sort_order").notNull(),
  ...auditColumns(),
});

/** Singleton row with id "workspace". */
export const workspace_settings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey().default("workspace"),
  name: text("name").notNull().default("Tessera"),
  home_widgets: text("home_widgets", { mode: "json" }).$type<HomeWidgets>().notNull().default([]),
  ai: text("ai", { mode: "json" }).$type<WorkspaceAiSettings>(),
  last_seen_at: text("last_seen_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

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

/** Singleton row with id "automation": the hourly run guard across processes. */
export const automation_lease = sqliteTable("automation_lease", {
  id: text("id").primaryKey().default("automation"),
  holder: text("holder").notNull(),
  expires_at: text("expires_at").notNull(),
});

/** Passed to drizzle(client, { schema }) so relational queries and migrations see every table. */
export const schema = {
  actor,
  project,
  state,
  label,
  work_item,
  work_item_label,
  work_item_module,
  work_item_assignee,
  work_item_subscriber,
  cycle,
  module: moduleTable,
  module_member,
  module_link,
  work_item_link,
  view,
  view_settings,
  activity,
  page,
  page_label,
  page_version,
  page_embed,
  work_item_relation,
  comment,
  comment_reaction,
  work_item_reaction,
  mention,
  notification,
  draft_work_item,
  intake,
  intake_item,
  estimate,
  estimate_point,
  favorite_folder,
  favorite,
  recent_visit,
  sticky,
  quick_link,
  workspace_settings,
  work_item_version,
  export_job,
  webhook,
  webhook_delivery,
  automation_lease,
};

export type TesseraSchema = typeof schema;
