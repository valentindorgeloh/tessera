/**
 * Exit criterion: bulk archive refuses a mixed group and archives nothing.
 */
import { describe, expect, it } from "vitest";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { createLabel } from "@/lib/tessera/labels";
import { createProject, type Project } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import type { StateRow } from "@/lib/tessera/types";
import { createWorkItem, getWorkItem } from "@/lib/tessera/work-items";
import { bulkArchiveWorkItems, bulkDeleteWorkItems, bulkUpdateWorkItems } from "@/lib/tessera/work-items/bulk";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

function setup(): { ctx: TesseraContext; project: Project; states: Record<string, StateRow> } {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, project.id).map((state) => [state.name, state]));
  return { ctx, project, states };
}

function ruleName(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError && err.code === "RULE") return (err.details as { rule: string }).rule;
    throw err;
  }
  return undefined;
}

describe("bulk archive refuses mixed groups", () => {
  it("bulk archive refuses mixed groups and archives nothing", () => {
    const { ctx, project, states } = setup();
    const done = createWorkItem(ctx, { project_id: project.id, name: "Done", state_id: states.Done.id });
    const open = createWorkItem(ctx, { project_id: project.id, name: "Open", state_id: states.Backlog.id });
    expect(ruleName(() => bulkArchiveWorkItems(ctx, [done.id, open.id]))).toBe("archive_open_item");
    expect(getWorkItem(ctx, done.id).archived_at).toBeNull();
    expect(getWorkItem(ctx, open.id).archived_at).toBeNull();
    const archived = bulkArchiveWorkItems(ctx, [done.id]);
    expect(archived[0]?.archived_at).not.toBeNull();
    expect(getWorkItem(ctx, open.id).archived_at).toBeNull();
  });

  it("adds and removes labels without touching the others, and refuses an id in both", () => {
    const { ctx, project } = setup();
    const bug = createLabel(ctx, { project_id: project.id, name: "bug" });
    const keep = createLabel(ctx, { project_id: project.id, name: "keep" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "A", label_ids: [keep.id] });
    const updated = bulkUpdateWorkItems(ctx, { ids: [item.id], add_label_ids: [bug.id] });
    expect(updated[0]?.label_ids.sort()).toEqual([bug.id, keep.id].sort());
    const removed = bulkUpdateWorkItems(ctx, { ids: [item.id], remove_label_ids: [bug.id] });
    expect(removed[0]?.label_ids).toEqual([keep.id]);
    expect(() => bulkUpdateWorkItems(ctx, { ids: [item.id], add_label_ids: [bug.id], remove_label_ids: [bug.id] })).toThrow(TrackerError);
  });

  it("deletes a subtree, rolls back when one id is missing, and refuses 501 ids", () => {
    const { ctx, project } = setup();
    const parent = createWorkItem(ctx, { project_id: project.id, name: "Parent" });
    const child = createWorkItem(ctx, { project_id: project.id, name: "Child", parent_id: parent.id });
    const other = createWorkItem(ctx, { project_id: project.id, name: "Other" });
    expect(() => bulkDeleteWorkItems(ctx, [parent.id, newId()])).toThrow(TrackerError);
    expect(getWorkItem(ctx, parent.id).id).toBe(parent.id);
    expect(getWorkItem(ctx, child.id).id).toBe(child.id);
    bulkDeleteWorkItems(ctx, [parent.id]);
    expect(() => getWorkItem(ctx, parent.id)).toThrow(TrackerError);
    expect(() => getWorkItem(ctx, child.id)).toThrow(TrackerError);
    expect(getWorkItem(ctx, other.id).id).toBe(other.id);
    const ids = Array.from({ length: 501 }, () => newId());
    expect(() => bulkArchiveWorkItems(ctx, ids)).toThrow(TrackerError);
  });
});
