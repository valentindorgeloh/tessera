-- Search matches word starts (decision 154). Hand-written: drizzle-kit does not model FTS5.
-- The FTS tables of 0001_fts.sql stored Porter stems, so a word lost its hits partway through typing it ("billing" is
-- stored as "bill", and "billi"* matched nothing). They are recreated keeping words as written (case and accents folded)
-- and refilled from the base tables like rebuildFts; src/lib/tessera/db/fts.ts adds each typed word's stem at query time.
DROP TABLE IF EXISTS work_item_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE work_item_fts USING fts5(work_item_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO work_item_fts (work_item_id, project_id, name, body) SELECT id, project_id, name, description_md FROM work_item WHERE deleted_at IS NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS page_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE page_fts USING fts5(page_id UNINDEXED, project_id UNINDEXED, name, body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO page_fts (page_id, project_id, name, body) SELECT id, project_id, name, description_md FROM page WHERE deleted_at IS NULL;
