import { describe, expect, it } from "vitest";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject } from "@/lib/tessera/projects";
import { bulkTransferWorkItems, createWorkItem, getWorkItem, listWorkItems } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function setup() {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  const ops = createProject(ctx, { name: "Ops", identifier: "OPS" });
  const items = ["A", "B", "C"].map((name) => createWorkItem(ctx, { project_id: web.id, name }));
  return { ctx, web, ops, items };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

describe("bulkTransferWorkItems (decision 107)", () => {
  it("copies every item into the target project and leaves the originals", () => {
    const { ctx, web, ops, items } = setup();
    const result = bulkTransferWorkItems(ctx, { work_item_ids: items.map((i) => i.id), project_id: ops.id, mode: "copy" });
    expect(result.map((r) => r.key)).toEqual(["OPS-1", "OPS-2", "OPS-3"]);
    expect(getWorkItem(ctx, items[0].id).project_id).toBe(web.id);
    expect(getWorkItem(ctx, result[0].id).name).toBe("A (Copy)");
  });

  it("moves every item, keeps ids and needs confirm", () => {
    const { ctx, ops, items } = setup();
    const ids = items.slice(0, 2).map((i) => i.id);
    expect(code(() => bulkTransferWorkItems(ctx, { work_item_ids: ids, project_id: ops.id, mode: "move" }))).toBe("VALIDATION");
    const result = bulkTransferWorkItems(ctx, { work_item_ids: [...ids, ids[0]], project_id: ops.id, mode: "move", confirm: true });
    expect(result.map((r) => r.id)).toEqual(ids);
    expect(result.map((r) => r.key)).toEqual(["OPS-1", "OPS-2"]);
    expect(getWorkItem(ctx, ids[0]).project_id).toBe(ops.id);
  });

  it("is all or nothing: one refused item rolls back the others", () => {
    const { ctx, web, ops, items } = setup();
    const inOps = createWorkItem(ctx, { project_id: ops.id, name: "Already there" });
    const before = listWorkItems(ctx, { scope: { type: "project", project_id: ops.id } }).total;
    expect(code(() => bulkTransferWorkItems(ctx, { work_item_ids: [items[0].id, inOps.id], project_id: ops.id, mode: "move", confirm: true }))).toBe("RULE");
    expect(getWorkItem(ctx, items[0].id).project_id).toBe(web.id);
    expect(listWorkItems(ctx, { scope: { type: "project", project_id: ops.id } }).total).toBe(before);
  });

  it("rejects an empty list and more than 100 ids", () => {
    const { ctx, ops, items } = setup();
    expect(code(() => bulkTransferWorkItems(ctx, { work_item_ids: [], project_id: ops.id, mode: "copy" }))).toBe("VALIDATION");
    const many = Array.from({ length: 101 }, () => items[0].id);
    expect(code(() => bulkTransferWorkItems(ctx, { work_item_ids: many, project_id: ops.id, mode: "copy" }))).toBe("VALIDATION");
  });
});
