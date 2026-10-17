import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FavoriteEntityType, HomeWidgets, PaletteColor, WorkspaceAiSettings } from "../../types";
import { DELETED_AT_IS_NULL, auditColumns } from "./columns";

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
