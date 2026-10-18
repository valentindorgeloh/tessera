import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TrackerError } from "@/lib/tessera/core/errors";
import { activity } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { UNDO_NOTE, archiveWorkItem, createWorkItem, getWorkItem, undoLastWorkItemChange, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function ruleName(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError && err.code === "RULE") return (err.details as { rule: string }).rule;
    throw err;
  }
  return undefined;
}

describe("undoLastWorkItemChange", () => {
  it("restores the previous priority from the activity row and refuses a second undo", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Ship" });
    updateWorkItem(ctx, item.id, { priority: "high" });

    const undone = undoLastWorkItemChange(ctx, item.id);
    expect(undone.verb).toBe("updated");
    expect(undone.field).toBe("priority");
    expect(getWorkItem(ctx, item.id).priority).toBe("none");

    const latest = ctx.db.select().from(activity).where(eq(activity.work_item_id, item.id)).orderBy(desc(activity.seq)).limit(1).get();
    expect(latest?.comment).toBe(UNDO_NOTE);
    expect(latest?.old_value).toBe("high");
    expect(latest?.new_value).toBe("none");
    expect(ruleName(() => undoLastWorkItemChange(ctx, item.id))).toBe("undo_already_applied");
  });

  it("unarchives the latest archive", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const done = listStates(ctx, project.id).find((state) => state.name === "Done");
    if (!done) throw new Error("expected a Done state");
    const item = createWorkItem(ctx, { project_id: project.id, name: "Ship", state_id: done.id });
    archiveWorkItem(ctx, item.id);
    expect(getWorkItem(ctx, item.id).archived_at).not.toBeNull();

    const undone = undoLastWorkItemChange(ctx, item.id);
    expect(undone.verb).toBe("archived");
    expect(getWorkItem(ctx, item.id).archived_at).toBeNull();
    expect(ruleName(() => undoLastWorkItemChange(ctx, item.id))).toBe("undo_already_applied");
  });

  it("refuses to undo a create, which has no stored inverse", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Ship" });
    expect(ruleName(() => undoLastWorkItemChange(ctx, item.id))).toBe("not_undoable");
    expect(getWorkItem(ctx, item.id).name).toBe("Ship");
  });
});
