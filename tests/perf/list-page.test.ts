/**
 * Lists a few thousand work items in memory. This is not the 10k browser
 * budget; it checks that the first page stays bounded on an in-memory database.
 */
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { newId } from "@/lib/tessera/core/ids";
import { sortOrderAfter } from "@/lib/tessera/core/order";
import { work_item } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { listWorkItems } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "../helpers/db";

const ITEM_COUNT = 3000;
const PAGE_SIZE = 200;
/** Wall-clock ceiling for one warmed first page. Loose on purpose so a busy machine does not flake. */
const PAGE_BUDGET_MS = 1500;

describe("listWorkItems performance", () => {
  it("returns the first page of a few thousand items under the budget", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Perf", identifier: "PRF" });
    const backlog = listStates(ctx, project.id).find((state) => state.name === "Backlog");
    if (!backlog) throw new Error("expected a Backlog state");

    const now = "2026-10-18T12:00:00.000Z";
    let sort: string | null = null;
    const rows: (typeof work_item.$inferInsert)[] = [];
    for (let n = 1; n <= ITEM_COUNT; n += 1) {
      sort = sortOrderAfter(sort);
      rows.push({
        id: newId(),
        project_id: project.id,
        sequence_id: n,
        name: `Item ${n}`,
        description_md: "",
        description_version: 0,
        state_id: backlog.id,
        priority: "none",
        sort_order: sort,
        is_draft: false,
        created_at: now,
        updated_at: now,
        created_by: USER_ACTOR_ID,
        updated_by: USER_ACTOR_ID,
      });
    }
    const chunk = 200;
    ctx.sqlite.transaction(() => {
      for (let i = 0; i < rows.length; i += chunk) {
        ctx.db.insert(work_item).values(rows.slice(i, i + chunk)).run();
      }
    })();

    const input = { scope: { type: "project" as const, project_id: project.id }, limit: PAGE_SIZE };
    listWorkItems(ctx, input);
    const started = performance.now();
    const page = listWorkItems(ctx, input);
    const elapsed = performance.now() - started;

    expect(page.total).toBe(ITEM_COUNT);
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(elapsed).toBeLessThan(PAGE_BUDGET_MS);

    const plan = handles.sqlite
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM work_item WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT ?")
      .all(project.id, PAGE_SIZE) as { detail: string }[];
    const details = plan.map((row) => row.detail).join("\n");
    expect(details).not.toMatch(/SCAN work_item/);
  });
});
