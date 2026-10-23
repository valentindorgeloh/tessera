import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { RelationType } from "../../types";
import { DELETED_AT_IS_NULL, auditColumns } from "./columns";
import { actor, project, work_item } from "./core";

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
    // Coalescing (decision 51): events merged into this row, and the inbox order key.
    // SQLite's ADD COLUMN ... NOT NULL needs a constant default; the service always writes sort_at.
    event_count: integer("event_count").notNull().default(1),
    sort_at: text("sort_at").notNull().default(""),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("notification_recipient_read_seq_idx").on(t.recipient_actor_id, t.read_at, t.seq),
    index("notification_archived_idx").on(t.archived_at),
    index("notification_inbox_idx").on(t.recipient_actor_id, t.archived_at, t.sort_at),
    index("notification_coalesce_idx").on(t.recipient_actor_id, t.work_item_id, t.actor_id, t.seq),
  ],
);
