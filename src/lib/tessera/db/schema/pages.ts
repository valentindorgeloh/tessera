import { index, integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Logo, PageAccess } from "../../types";
import { auditColumns } from "./columns";
import { actor, project, label } from "./core";

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
