/**
 * Standalone FTS5 tables for work items and pages (decision 25). No external
 * content, no triggers: the service writes these rows in the same transaction
 * as the entity row, and `rebuildFts` recreates everything from the base tables.
 */
import type { Database } from "better-sqlite3";

export const FTS_TOKENIZER = "porter unicode61 remove_diacritics 2";

export const WORK_ITEM_FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS work_item_fts USING fts5(work_item_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = '${FTS_TOKENIZER}')`;

export const PAGE_FTS_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(page_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = '${FTS_TOKENIZER}')`;

export type FtsDocument = {
  id: string;
  project_id: string | null;
  name: string;
  body: string | null;
};

export type SearchOptions = {
  project_id?: string | null;
  limit?: number;
};

const DEFAULT_LIMIT = 50;

export function ensureFtsTables(sqlite: Database): void {
  sqlite.exec(WORK_ITEM_FTS_SQL);
  sqlite.exec(PAGE_FTS_SQL);
}

export function upsertWorkItemFts(sqlite: Database, doc: FtsDocument): void {
  sqlite.prepare("DELETE FROM work_item_fts WHERE work_item_id = ?").run(doc.id);
  sqlite
    .prepare("INSERT INTO work_item_fts (work_item_id, project_id, name, body) VALUES (?, ?, ?, ?)")
    .run(doc.id, doc.project_id, doc.name, doc.body ?? "");
}

export function deleteWorkItemFts(sqlite: Database, workItemId: string): void {
  sqlite.prepare("DELETE FROM work_item_fts WHERE work_item_id = ?").run(workItemId);
}

export function upsertPageFts(sqlite: Database, doc: FtsDocument): void {
  sqlite.prepare("DELETE FROM page_fts WHERE page_id = ?").run(doc.id);
  sqlite
    .prepare("INSERT INTO page_fts (page_id, project_id, name, body) VALUES (?, ?, ?, ?)")
    .run(doc.id, doc.project_id, doc.name, doc.body ?? "");
}

export function deletePageFts(sqlite: Database, pageId: string): void {
  sqlite.prepare("DELETE FROM page_fts WHERE page_id = ?").run(pageId);
}

/** Drops every FTS row and re-indexes the non-deleted work items and pages. Run after a migration that recreates either table. */
export function rebuildFts(sqlite: Database): { work_items: number; pages: number } {
  ensureFtsTables(sqlite);
  const run = sqlite.transaction(() => {
    sqlite.exec("DELETE FROM work_item_fts");
    const items = sqlite
      .prepare(
        "INSERT INTO work_item_fts (work_item_id, project_id, name, body) SELECT id, project_id, name, description_md FROM work_item WHERE deleted_at IS NULL",
      )
      .run();
    sqlite.exec("DELETE FROM page_fts");
    const pages = sqlite
      .prepare("INSERT INTO page_fts (page_id, project_id, name, body) SELECT id, project_id, name, description_md FROM page WHERE deleted_at IS NULL")
      .run();
    return { work_items: items.changes, pages: pages.changes };
  });
  return run();
}

/**
 * Turns free text into a safe FTS5 MATCH expression: every whitespace-separated
 * token becomes a quoted prefix term ("tok"*), so operators, parentheses and
 * quotes typed by a user can never change the query's structure. Returns null
 * when there is nothing to search for.
 */
export function buildMatchExpression(q: string): string | null {
  const tokens = q
    .split(/\s+/)
    .map((token) => token.replace(/"/g, "").trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}

function search(sqlite: Database, table: "work_item_fts" | "page_fts", idColumn: string, q: string, options: SearchOptions): string[] {
  const match = buildMatchExpression(q);
  if (!match) return [];
  const limit = options.limit ?? DEFAULT_LIMIT;
  const projectId = options.project_id ?? null;
  // Column weights: ids 0, name 4, body 1 (bm25 wants one weight per column in table order).
  const rows = sqlite
    .prepare<[string, string | null, string | null, number], { id: string }>(
      `SELECT ${idColumn} AS id FROM ${table} WHERE ${table} MATCH ? AND (? IS NULL OR project_id = ?) ORDER BY bm25(${table}, 0, 0, 4, 1) LIMIT ?`,
    )
    .all(match, projectId, projectId, limit);
  return rows.map((row) => row.id);
}

/** Work item ids ranked by relevance (best first); `project_id` narrows the search. */
export function searchWorkItemIds(sqlite: Database, q: string, options: SearchOptions = {}): string[] {
  return search(sqlite, "work_item_fts", "work_item_id", q, options);
}

/** Page ids ranked by relevance (best first); `project_id` narrows the search. */
export function searchPageIds(sqlite: Database, q: string, options: SearchOptions = {}): string[] {
  return search(sqlite, "page_fts", "page_id", q, options);
}
