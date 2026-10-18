import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { addDays, localDayStart } from "@/lib/tessera/core/time";
import { listStates } from "@/lib/tessera/states";
import { createProject } from "@/lib/tessera/projects";
import { getAnalytics } from "@/lib/tessera/analytics";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "../helpers/db";

const TODAY = "2026-10-18";

function at(handles: DbHandles, day: string): TesseraContext {
  return createContext({
    db: handles.db,
    sqlite: handles.sqlite,
    actorId: USER_ACTOR_ID,
    today: () => TODAY,
    now: () => localDayStart(day),
  });
}

describe("analytics trend", () => {
  it("buckets created and completed on local days, and by week for 365d", () => {
    const handles = createTestDb();
    const createdOn = addDays(TODAY, -2);
    const ctx = at(handles, createdOn);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const done = listStates(at(handles, TODAY), project.id).find((state) => state.state_group === "completed");
    if (!done) throw new Error("no completed state");
    updateWorkItem(at(handles, TODAY), item.id, { state_id: done.id });
    const daily = getAnalytics(at(handles, TODAY), { tab: "overview", project_ids: [project.id], range: "7d" });
    if (daily.tab !== "overview") throw new Error("overview");
    expect(daily.trend).toHaveLength(7);
    expect(daily.trend.map((point) => point.date)).toEqual(Array.from({ length: 7 }, (_, index) => addDays(TODAY, index - 6)));
    expect(daily.trend.find((point) => point.date === createdOn)?.created).toBe(1);
    expect(daily.trend.find((point) => point.date === TODAY)?.completed).toBe(1);
    const weekly = getAnalytics(at(handles, TODAY), { tab: "overview", project_ids: [project.id], range: "365d" });
    if (weekly.tab !== "overview") throw new Error("weekly");
    expect(weekly.trend.length).toBeGreaterThan(50);
    expect(weekly.trend.every((point) => point.date <= TODAY)).toBe(true);
    expect(weekly.trend.some((point) => point.created === 1)).toBe(true);
    expect(weekly.trend.some((point) => point.completed === 1)).toBe(true);
  });
});
