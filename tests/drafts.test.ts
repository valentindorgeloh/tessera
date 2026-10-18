import { describe, expect, it } from "vitest";
import { registerActor, updateActor } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createCycle } from "@/lib/tessera/cycles";
import { createLabel, deleteLabel } from "@/lib/tessera/labels";
import { createModule } from "@/lib/tessera/modules";
import { createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { createDraft, getDraft, listDrafts, moveDraftToProject, updateDraft } from "@/lib/tessera/drafts";
import { getWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

describe("drafts", () => {
  it("keeps a workspace draft, refuses project fields without a project, and clears them when the project changes", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const draft = createDraft(ctx, { name: "" });
    expect(draft.project).toBeNull();
    expect(draft.name).toBe("");
    expect(() => updateDraft(ctx, draft.id, { state_id: project.id })).toThrow(TrackerError);
    const withProject = updateDraft(ctx, draft.id, { project_id: project.id, name: "Named" });
    expect(withProject.project?.id).toBe(project.id);
    const other = createProject(ctx, { name: "Ops", identifier: "OPS" });
    const label = createLabel(ctx, { project_id: project.id, name: "bug" });
    updateDraft(ctx, draft.id, { label_ids: [label.id] });
    const moved = updateDraft(ctx, draft.id, { project_id: other.id });
    expect(moved.label_ids).toEqual([]);
    expect(moved.project_id).toBe(other.id);
    handles.sqlite.close();
  });

  it("moves a draft into a work item, reports a stale label, and refuses an empty name", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const label = createLabel(ctx, { project_id: project.id, name: "bug" });
    const cycle = createCycle(ctx, { project_id: project.id, name: "Sprint", start_date: "2099-01-01", end_date: "2099-01-14" });
    const launch = createModule(ctx, { project_id: project.id, name: "Launch" });
    const draft = createDraft(ctx, { project_id: project.id, name: "Ship it", label_ids: [label.id], cycle_id: cycle.id, module_ids: [launch.id] });
    const stale = createLabel(ctx, { project_id: project.id, name: "old" });
    updateDraft(ctx, draft.id, { label_ids: [label.id, stale.id] });
    deleteLabel(ctx, stale.id);
    const empty = createDraft(ctx, { project_id: project.id, name: "   " });
    expect(() => moveDraftToProject(ctx, empty.id, {})).toThrow(TrackerError);
    const result = moveDraftToProject(ctx, draft.id, {});
    expect(result.dropped).toContain(stale.id);
    expect(result.work_item.label_ids).toEqual([label.id]);
    expect(result.work_item.cycle_id).toBe(cycle.id);
    expect(result.work_item.module_ids).toEqual([launch.id]);
    expect(() => getDraft(ctx, draft.id)).toThrow(TrackerError);
    expect(listDrafts(ctx).items).toHaveLength(1);
    expect(getWorkItem(ctx, result.work_item.id).name).toBe("Ship it");
    handles.sqlite.close();
  });

  it("sends an intake agent's move into Intake", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    updateProjectFeatures(ctx, project.id, { intake_enabled: true });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:drafter" });
    updateActor(ctx, agent.id, { access: "intake" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    const draft = createDraft(actx, { project_id: project.id, name: "Idea" });
    const result = moveDraftToProject(actx, draft.id, {});
    expect(result.work_item.intake).toEqual({ status: "pending" });
    handles.sqlite.close();
  });
});
