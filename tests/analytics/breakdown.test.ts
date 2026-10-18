import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject } from "@/lib/tessera/projects";
import { getAnalytics } from "@/lib/tessera/analytics";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestDb } from "../helpers/db";

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

describe("analytics breakdown", () => {
  it("segments multi-valued dimensions, keeps a none bucket, and refuses state or points when they do not apply", () => {
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => "2026-10-18" });
    const web = createProject(ctx, { name: "Web", identifier: "WEB" });
    const ops = createProject(ctx, { name: "Ops", identifier: "OPS" });
    const assigned = createWorkItem(ctx, { project_id: web.id, name: "Login", priority: "high" });
    createWorkItem(ctx, { project_id: web.id, name: "Empty" });
    setAssignees(ctx, assigned.id, [USER_ACTOR_ID]);
    const segmented = getAnalytics(ctx, { tab: "work-items", project_ids: [web.id], x_axis: "assignee", segment: "priority" });
    if (segmented.tab !== "work-items") throw new Error("tab");
    const none = segmented.buckets.find((bucket) => bucket.key === "none");
    const you = segmented.buckets.find((bucket) => bucket.key === USER_ACTOR_ID);
    expect(none?.total).toBe(1);
    expect(you?.segments.high).toBe(1);
    expect(segmented.segment_keys.some((key) => key.key === "high")).toBe(true);
    expect(errorCode(() => getAnalytics(ctx, { tab: "work-items", project_ids: [web.id, ops.id], x_axis: "state" }))).toBe("VALIDATION");
    expect(errorCode(() => getAnalytics(ctx, { tab: "work-items", x_axis: "assignee", segment: "assignee" }))).toBe("VALIDATION");
    const points = errorCode(() => getAnalytics(ctx, { tab: "work-items", project_ids: [web.id], measure: "points" }));
    expect(points).toBe("RULE");
    try {
      getAnalytics(ctx, { tab: "work-items", project_ids: [web.id], measure: "points" });
    } catch (err) {
      expect(err).toBeInstanceOf(TrackerError);
      expect((err as TrackerError).details).toMatchObject({ rule: "points_unavailable" });
    }
  });
});
