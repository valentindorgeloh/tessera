-- Standalone FTS5 search tables (docs/contracts/schema.md). Hand-written: drizzle-kit does not model FTS5.
-- No external content and no triggers; src/lib/tessera/db/fts.ts keeps the rows in sync inside the writing transaction.
CREATE VIRTUAL TABLE IF NOT EXISTS work_item_fts USING fts5(work_item_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = 'porter unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(page_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = 'porter unicode61 remove_diacritics 2');
