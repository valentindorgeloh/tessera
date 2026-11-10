/**
 * Standalone FTS5 tables for work items and pages (decision 25). No external
 * content, no triggers: the service writes these rows in the same transaction
 * as the entity row, and `rebuildFts` recreates everything from the base tables.
 *
 * Search matches word starts (decision 154): the tables keep words as written
 * (case and accents folded), and every typed word matches the words that start
 * with it or with its Porter stem. A word therefore keeps its hits at every
 * letter while it is typed ("billi" finds "billing"), and a whole word still
 * finds the other forms of the word ("invoices" finds "invoice").
 */
import SqliteDatabase, { type Database, type Statement } from "better-sqlite3";

/** Words as written, lower-cased, accents removed (decision 154; drizzle/0015_fts_word_starts.sql). */
export const FTS_TOKENIZER = "unicode61 remove_diacritics 2";

/** The query side's stemmer: SQLite's Porter tokenizer over the same word rules. */
const STEM_TOKENIZER = `porter ${FTS_TOKENIZER}`;

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

type TermReader = { clear: Statement; insert: Statement<[string]>; terms: Statement<[], string> };

let termReaders: { raw: TermReader; stem: TermReader } | null = null;

/**
 * The terms SQLite's tokenizers make of a text, read from a private in-memory
 * database (an FTS5 table per tokenizer plus its `fts5vocab` instance table), so
 * the query side stems exactly as SQLite does and the user's database is never written.
 */
function readers(): { raw: TermReader; stem: TermReader } {
  if (termReaders) return termReaders;
  const scratch = new SqliteDatabase(":memory:");
  const reader = (table: string, tokenizer: string): TermReader => {
    scratch.exec(`CREATE VIRTUAL TABLE ${table} USING fts5(text, tokenize = '${tokenizer}'); CREATE VIRTUAL TABLE ${table}_terms USING fts5vocab(${table}, 'instance');`);
    return {
      clear: scratch.prepare(`DELETE FROM ${table}`),
      insert: scratch.prepare<[string]>(`INSERT INTO ${table} (rowid, text) VALUES (1, ?)`),
      terms: scratch.prepare<[], string>(`SELECT term FROM ${table}_terms WHERE doc = 1 ORDER BY offset`).pluck(),
    };
  };
  termReaders = { raw: reader("raw", FTS_TOKENIZER), stem: reader("stem", STEM_TOKENIZER) };
  return termReaders;
}

function termsOf(reader: TermReader, text: string): string {
  reader.clear.run();
  reader.insert.run(text);
  return reader.terms.all().join(" ");
}

/**
 * The quoted prefix terms one typed word may match (decision 154): the word as
 * typed; its Porter stem when that differs ("invoices" → "invoic", so the word
 * "invoice" matches); and for a stem ending in "i" its "y" form ("queries" →
 * "queri" → "query"). Stems come from the tokenizer, so they never hold a quote.
 */
function wordAlternatives(token: string): string[] {
  const { raw, stem } = readers();
  const asWritten = termsOf(raw, token);
  const stemmed = termsOf(stem, token);
  const alternatives = [`"${token}"*`];
  if (stemmed === "" || stemmed === asWritten) return alternatives;
  alternatives.push(`"${stemmed}"*`);
  const yForm = stemmed.endsWith("i") ? `${stemmed.slice(0, -1)}y` : null;
  if (yForm !== null && yForm !== asWritten) alternatives.push(`"${yForm}"*`);
  return alternatives;
}

/**
 * Turns free text into a safe FTS5 MATCH expression: every whitespace-separated
 * token becomes a group of quoted prefix terms (`wordAlternatives`), and the
 * groups are joined with AND, so operators, parentheses and quotes typed by a
 * user can never change the query's structure. Returns null when there is
 * nothing to search for.
 */
export function buildMatchExpression(q: string): string | null {
  const tokens = q
    .split(/\s+/)
    .map((token) => token.replace(/"/g, "").trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens
    .map((token) => {
      const alternatives = wordAlternatives(token);
      return alternatives.length === 1 ? alternatives[0] : `(${alternatives.join(" OR ")})`;
    })
    .join(" AND ");
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
