// @vitest-environment jsdom
/** The showcase demo seed (scripts/demo): shape, idempotency, activity order and editor-lossless text on an in-memory database. */
import { Editor } from "@tiptap/core";
import { beforeAll, describe, expect, it } from "vitest";
import { editorExtensions } from "@/components/editor/extensions";
import { seedShowcase, type ShowcaseResult } from "../scripts/demo";
import { DEMO_ANCHORS, anchorKey } from "../scripts/demo/shared";
import { createTestDb, type DbHandles } from "./helpers/db";

type Row = Record<string, unknown>;

describe("seedShowcase", () => {
  let handles: DbHandles;
  let result: ShowcaseResult;

  const all = (sql: string, ...params: unknown[]): Row[] => handles.sqlite.prepare(sql).all(...params) as Row[];
  const count = (sql: string, ...params: unknown[]): number => (handles.sqlite.prepare(sql).pluck().get(...params) as number | undefined) ?? 0;

  beforeAll(async () => {
    handles = createTestDb();
    result = await seedShowcase(handles);
  }, 30_000);

  it("creates the four projects with LEG archived", () => {
    expect(result.created).toBe(true);
    const projects = all("SELECT identifier, archived_at FROM project ORDER BY identifier");
    expect(projects.map((p) => p.identifier)).toEqual(["DSN", "LEG", "MOB", "PLAT"]);
    expect(projects.filter((p) => p.archived_at !== null).map((p) => p.identifier)).toEqual(["LEG"]);
  });

  it("creates the 24 anchor items with the right keys and names", () => {
    for (const [identifier, names] of Object.entries(DEMO_ANCHORS)) {
      names.forEach((name, index) => {
        const sequence = index + 1;
        const row = all(
          "SELECT w.name FROM work_item w JOIN project p ON p.id = w.project_id WHERE p.identifier = ? AND w.sequence_id = ?",
          identifier,
          sequence,
        )[0];
        expect(row?.name, anchorKey(identifier as keyof typeof DEMO_ANCHORS, sequence)).toBe(name);
      });
    }
  });

  it("fills pages, intake, comments and the user's unread notifications", () => {
    expect(count("SELECT COUNT(*) FROM page")).toBeGreaterThan(10);
    expect(count("SELECT COUNT(*) FROM intake_item")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) FROM comment")).toBeGreaterThan(20);
    expect(
      count(
        "SELECT COUNT(*) FROM notification n JOIN actor a ON a.id = n.recipient_actor_id WHERE a.kind = 'user' AND n.read_at IS NULL AND n.archived_at IS NULL",
      ),
    ).toBeGreaterThan(0);
    expect(Object.keys(result.counts)).toEqual(["core", "pages", "workspace", "collab"]);
  });

  it("writes nothing on a second call", async () => {
    const before = count("SELECT COUNT(*) FROM activity");
    const again = await seedShowcase(handles);
    expect(again).toEqual({ created: false, counts: {} });
    expect(count("SELECT COUNT(*) FROM activity")).toBe(before);
  });

  it("keeps activity timestamps non-decreasing in seq order", () => {
    const rows = all("SELECT seq, created_at FROM activity ORDER BY seq");
    expect(rows.length).toBeGreaterThan(300);
    const backwards = rows.filter((row, index) => index > 0 && String(row.created_at) < String(rows[index - 1]!.created_at));
    expect(backwards).toEqual([]);
  });

  it("seeds text the editor round-trips without rewriting (no 'markdown would be rewritten' banner)", () => {
    const texts = [
      ...all("SELECT description_md AS t FROM work_item WHERE description_md IS NOT NULL AND description_md != ''"),
      ...all("SELECT description_md AS t FROM page WHERE description_md != ''"),
      ...all("SELECT body_md AS t FROM comment"),
      ...all("SELECT description_md AS t FROM sticky WHERE description_md IS NOT NULL"),
    ].map((row) => String(row.t));
    expect(texts.length).toBeGreaterThan(100);
    const trim = (value: string) => value.replace(/\n+$/, "");
    const lossy = texts.filter((text) => {
      const editor = new Editor({ element: null, extensions: editorExtensions({ compact: false, mentions: null }), content: text, contentType: "markdown" });
      const out = editor.getMarkdown();
      editor.destroy();
      return trim(out) !== trim(text);
    });
    expect(lossy.map((text) => text.slice(0, 80))).toEqual([]);
  });

  it("keeps agents under friendly names and mentions free of raw ids or odd characters", () => {
    const agents = all("SELECT name, client_name FROM actor WHERE kind = 'agent' ORDER BY name");
    expect(agents.map((a) => a.name)).toEqual(["Claude Code", "Docs writer", "Release bot", "Triage agent"]);
    expect(agents.every((a) => !String(a.name).startsWith("mcp:") && a.client_name)).toBe(true);
    expect(count("SELECT COUNT(*) FROM comment WHERE body_md LIKE '%@(actor%' OR body_md LIKE '%\u00b4%'")).toBe(0);
    expect(count("SELECT COUNT(*) FROM work_item WHERE description_md LIKE '%@(actor%' OR description_md LIKE '%[@%](actor:%'")).toBe(0);
  });

  it("gives the hero items sub-items, relations, links and reactions, and a spread of completion days", () => {
    const hero = (key: string, table: string) =>
      count(
        `SELECT COUNT(*) FROM ${table} t JOIN work_item w ON w.id = t.work_item_id JOIN project p ON p.id = w.project_id WHERE p.identifier || '-' || w.sequence_id = ?`,
        key,
      );
    for (const key of ["PLAT-4", "MOB-1"]) {
      expect(hero(key, "work_item_link"), `${key} links`).toBeGreaterThan(0);
      expect(hero(key, "work_item_reaction"), `${key} reactions`).toBeGreaterThan(0);
      expect(
        count("SELECT COUNT(*) FROM work_item c JOIN work_item w ON w.id = c.parent_id JOIN project p ON p.id = w.project_id WHERE p.identifier || '-' || w.sequence_id = ?", key),
        `${key} sub-items`,
      ).toBeGreaterThan(0);
    }
    const days = count("SELECT COUNT(DISTINCT substr(completed_at, 1, 10)) FROM work_item WHERE completed_at IS NOT NULL");
    expect(days).toBeGreaterThan(10);
    expect(count("SELECT COUNT(*) FROM cycle WHERE archived_at IS NOT NULL")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) FROM module WHERE archived_at IS NOT NULL")).toBeGreaterThan(0);
  });
});
