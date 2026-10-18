import { describe, expect, it } from "vitest";
import { getCounts } from "@/lib/tessera/counts";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createEstimate, deleteEstimate, updateEstimate, validateEstimateValues } from "@/lib/tessera/estimates";
import { createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function ruleOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code === "RULE" ? (err.details as { rule: string }).rule : err.code;
    throw err;
  }
  return undefined;
}

describe("estimates", () => {
  it("refuses 1 or 7 points and values that break the type", () => {
    expect(ruleOf(() => validateEstimateValues("points", ["1"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("points", ["1", "2", "3", "4", "5", "6", "7"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("points", ["1", "1"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("points", ["1", "1.555"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("categories", ["A", "a"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("time", ["0", "30"]))).toBe("VALIDATION");
    expect(ruleOf(() => validateEstimateValues("time", ["30", "10081"]))).toBe("VALIDATION");
    expect(() => validateEstimateValues("points", ["1", "2", "3"])).not.toThrow();
  });

  it("keeps one active system, remaps the same type, and clears a different type", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    updateProjectFeatures(ctx, project.id, { estimates_enabled: true });
    const first = createEstimate(ctx, { project_id: project.id, name: "Story", type: "points", points: [{ value: "1" }, { value: "2" }, { value: "3" }] });
    const five = first.points[2];
    const item = createWorkItem(ctx, { project_id: project.id, name: "A", estimate_point_id: five.id });
    const second = createEstimate(ctx, { project_id: project.id, name: "Story 2", type: "points", points: [{ value: "1" }, { value: "3" }, { value: "5" }] });
    expect(first.id).not.toBe(second.id);
    expect(getWorkItem(ctx, item.id).estimate_point_id).toBe(second.points.find((point) => point.value === "3")?.id);
    const shirts = createEstimate(ctx, {
      project_id: project.id,
      name: "Shirts",
      type: "categories",
      points: [{ value: "S" }, { value: "M" }],
    });
    expect(getWorkItem(ctx, item.id).estimate_point_id).toBeNull();
    expect(shirts.points.map((point) => point.value)).toEqual(["S", "M"]);
    const counts = getCounts(ctx, { type: "project", project_id: project.id });
    expect(counts.total_points).toBeUndefined();
    handles.sqlite.close();
  });

  it("keeps ids, requires a remap for a used point, clears on delete, and refuses an inactive point", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    updateProjectFeatures(ctx, project.id, { estimates_enabled: true });
    const system = createEstimate(ctx, { project_id: project.id, name: "Story", type: "points", points: [{ value: "1" }, { value: "3" }, { value: "5" }] });
    const low = system.points[0];
    const mid = system.points[1];
    const high = system.points[2];
    const item = createWorkItem(ctx, { project_id: project.id, name: "A", estimate_point_id: high.id });
    const states = listStates(ctx, project.id);
    const done = states.find((state) => state.state_group === "completed");
    updateWorkItem(ctx, item.id, { state_id: done?.id });
    expect(ruleOf(() => updateEstimate(ctx, system.id, { points: [low, mid].map((point) => ({ id: point.id, value: point.value })) }))).toBe("estimate_point_in_use");
    expect(getWorkItem(ctx, item.id).estimate_point_id).toBe(high.id);
    const edited = updateEstimate(ctx, system.id, {
      points: [low, mid].map((point) => ({ id: point.id, value: point.value })),
      remap: { [high.id]: mid.id },
    });
    expect(edited.points.map((point) => point.id)).toEqual([low.id, mid.id]);
    expect(getWorkItem(ctx, item.id).estimate_point_id).toBe(mid.id);
    createEstimate(ctx, { project_id: project.id, name: "Next", type: "points", points: [{ value: "2" }, { value: "4" }] });
    expect(ruleOf(() => updateWorkItem(ctx, item.id, { estimate_point_id: mid.id }))).toBe("estimate_point_inactive");
    const active = createEstimate(ctx, { project_id: project.id, name: "Live", type: "points", points: [{ value: "1" }, { value: "2" }] });
    deleteEstimate(ctx, active.id);
    expect(getWorkItem(ctx, item.id).estimate_point_id).toBeNull();
    const points = createEstimate(ctx, { project_id: project.id, name: "Points", type: "points", points: [{ value: "1" }, { value: "2" }] });
    const another = createWorkItem(ctx, { project_id: project.id, name: "B", estimate_point_id: points.points[1].id });
    const counted = getCounts(ctx, { type: "project", project_id: project.id });
    expect(counted.total_points).toBe(2);
    expect(counted.completed_points).toBe(0);
    expect(another.estimate_point_id).toBe(points.points[1].id);
    handles.sqlite.close();
  });
});
