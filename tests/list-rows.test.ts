import { describe, expect, it } from "vitest";
import { slimListResult, slimListRows } from "@/app/(tessera)/work-items/list-rows";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { seedDemo } from "@/lib/tessera/seed";
import { createWorkItem, listWorkItems } from "@/lib/tessera/work-items";
import { createTestDb } from "./helpers/db";

const BLANKED = ["description_md", "description_version", "external_source", "external_id", "is_draft", "deleted_at", "updated_by"] as const;

function demoList() {
  const handles = createTestDb();
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => "2026-10-10" });
  const { project } = seedDemo(ctx);
  createWorkItem(ctx, { project_id: project.id, name: "Long description", description_md: "word ".repeat(400) });
  return listWorkItems(ctx, { scope: { type: "project", project_id: project.id }, display: { order_by: "-updated_at" } });
}

describe("slimListRows", () => {
  it("blanks the fields a list row never draws and keeps the rest", () => {
    const list = demoList();
    expect(list.items.length).toBeGreaterThan(10);
    expect(list.items.some((item) => item.description_md !== "")).toBe(true);
    const slim = slimListRows(list.items);
    expect(slim).toHaveLength(list.items.length);
    slim.forEach((row, index) => {
      const original = list.items[index];
      expect(row.description_md).toBe("");
      expect(row.description_version).toBe(0);
      expect(row.external_source).toBeNull();
      expect(row.external_id).toBeNull();
      expect(row.is_draft).toBe(false);
      expect(row.deleted_at).toBeNull();
      expect(row.updated_by).toBe("");
      // Everything else, the key, state, dates, label and assignee ids, stays equal.
      const { ...kept } = row;
      for (const field of BLANKED) delete (kept as Partial<typeof row>)[field];
      const expected = { ...original };
      for (const field of BLANKED) delete (expected as Partial<typeof original>)[field];
      expect(kept).toEqual(expected);
    });
  });

  it("does not change its input and makes the payload smaller", () => {
    const list = demoList();
    const before = JSON.stringify(list.items);
    const slim = slimListRows(list.items);
    expect(JSON.stringify(list.items)).toBe(before);
    expect(JSON.stringify(slim).length).toBeLessThan(before.length);
  });

  it("slimListResult keeps total, cursor and groups", () => {
    const list = demoList();
    const slim = slimListResult(list);
    expect(slim.total).toBe(list.total);
    expect(slim.cursor).toBe(list.cursor);
    expect(slim.groups).toEqual(list.groups);
    expect(slim.items.every((item) => item.description_md === "")).toBe(true);
  });
});
