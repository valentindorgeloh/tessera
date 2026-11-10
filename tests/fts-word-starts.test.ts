/**
 * Search matches word starts (decision 154). The index keeps words as written,
 * so a word keeps its hits at every letter while it is typed; a whole word also
 * finds the other forms of the word through its Porter stem. Before decision 154
 * the index stored stems, so "billi" (on the way to "billing", stored as "bill")
 * found nothing, and Power K, the list filter and the pickers lost their results
 * in the middle of a word.
 */
import type { Database as SqliteDatabase } from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildMatchExpression, searchPageIds, searchWorkItemIds, upsertPageFts, upsertWorkItemFts } from "@/lib/tessera/db/fts";
import { createTestDb } from "./helpers/db";

function indexed(): SqliteDatabase {
  const { sqlite } = createTestDb();
  const items: [string, string, string][] = [
    ["billing", "Review billing page", ""],
    ["onboarding", "Polish onboarding", "Settings screen under load"],
    ["bills", "Pay the bills", ""],
    ["cart", "Cart total", ""],
    ["query", "Query builder", ""],
    ["invoice", "Migrate invoice export", ""],
  ];
  for (const [id, name, body] of items) upsertWorkItemFts(sqlite, { id, project_id: "p", name, body });
  return sqlite;
}

function prefixes(word: string): string[] {
  return Array.from({ length: word.length }, (_, index) => word.slice(0, index + 1));
}

describe("search matches word starts (decision 154)", () => {
  it("keeps a word's hits at every letter while it is typed", () => {
    const sqlite = indexed();
    for (const [word, id] of [
      ["billing", "billing"],
      ["onboarding", "onboarding"],
      ["settings", "onboarding"],
    ]) {
      for (const typed of prefixes(word)) expect(searchWorkItemIds(sqlite, typed), typed).toContain(id);
    }
  });

  it("matches where a word starts, not a shorter word with the same stem or the middle of a word", () => {
    const sqlite = indexed();
    expect(searchWorkItemIds(sqlite, "billi")).toEqual(["billing"]);
    expect(searchWorkItemIds(sqlite, "carto")).toEqual([]);
    expect(searchWorkItemIds(sqlite, "art")).toEqual([]);
  });

  it("still finds the other forms of a whole word", () => {
    const sqlite = indexed();
    expect(searchWorkItemIds(sqlite, "invoices")).toEqual(["invoice"]);
    expect(searchWorkItemIds(sqlite, "migration")).toEqual(["invoice"]);
    expect(searchWorkItemIds(sqlite, "queries")).toEqual(["query"]);
    expect(searchWorkItemIds(sqlite, "billing").sort()).toEqual(["billing", "bills"]);
  });

  it("needs every word, each found by its start or by its other forms", () => {
    const sqlite = indexed();
    expect(searchWorkItemIds(sqlite, "reviewing billi")).toEqual(["billing"]);
    expect(searchWorkItemIds(sqlite, "billi pay")).toEqual([]);
  });

  it("applies to pages too", () => {
    const { sqlite } = createTestDb();
    upsertPageFts(sqlite, { id: "pg", project_id: null, name: "Onboarding handbook", body: "Café rules" });
    for (const typed of prefixes("onboarding")) expect(searchPageIds(sqlite, typed), typed).toEqual(["pg"]);
    expect(searchPageIds(sqlite, "handbooks")).toEqual(["pg"]);
    expect(searchPageIds(sqlite, "caf")).toEqual(["pg"]);
  });

  it("indexes the words as written, without the Porter stemmer", () => {
    const { sqlite } = createTestDb();
    const tables = sqlite.prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE name IN ('work_item_fts', 'page_fts')").all();
    expect(tables).toHaveLength(2);
    for (const { sql } of tables) {
      expect(sql).toContain("unicode61 remove_diacritics 2");
      expect(sql).not.toContain("porter");
    }
  });

  it("offers a word's stem and its y form only when they differ from the word", () => {
    expect(buildMatchExpression("billi")).toBe('"billi"*');
    expect(buildMatchExpression("invoices")).toBe('("invoices"* OR "invoic"*)');
    expect(buildMatchExpression("queries")).toBe('("queries"* OR "queri"* OR "query"*)');
    expect(buildMatchExpression("Café PERF-12")).toBe('"Café"* AND "PERF-12"*');
  });
});
