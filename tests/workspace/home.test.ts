import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { latestSeq } from "@/lib/tessera/activity";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { addDays } from "@/lib/tessera/core/time";
import { getCounts } from "@/lib/tessera/counts";
import { activity } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { getHomeSummary, getWorkspaceSettings, sinceLastVisit } from "@/lib/tessera/workspace";
import { setHomeSeen } from "@/lib/tessera/workspace/home-seen";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, type DbHandles } from "../helpers/db";

const TODAY = "2026-10-18";

function context(handles: DbHandles, actorId: string, now: string): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId, today: () => TODAY, now: () => now });
}

describe("home", () => {
  it("excludes the user actor, collapses per target, and caps the list", () => {
    const handles = createTestDb();
    const user = context(handles, USER_ACTOR_ID, "2026-10-18T10:00:00.000Z");
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const items = Array.from({ length: 21 }, (_, index) => createWorkItem(user, { project_id: project.id, name: `Item ${index}` }));
    const bot = context(handles, ASSISTANT_ACTOR_ID, "2026-10-18T12:00:00.000Z");
    for (const item of items) updateWorkItem(bot, item.id, { priority: "low" });
    updateWorkItem(bot, items[0].id, { name: "Item 0 renamed" });
    const since = sinceLastVisit(user, null);
    expect(since.entries.every((entry) => entry.actor.kind !== "user" && entry.actor.id !== USER_ACTOR_ID)).toBe(true);
    const first = since.entries.find((entry) => entry.target.id === items[0].id);
    expect(first?.count).toBe(2);
    expect(first?.actor.id).toBe(ASSISTANT_ACTOR_ID);
    expect(since.entries).toHaveLength(20);
    expect(since.more).toBe(1);
  });

  it("uses the last 7 days when the anchor is null, and setHomeSeen never moves back or writes activity", () => {
    const handles = createTestDb();
    const oldBot = context(handles, ASSISTANT_ACTOR_ID, "2026-10-01T10:00:00.000Z");
    const project = createProject(context(handles, USER_ACTOR_ID, "2026-10-18T10:00:00.000Z"), { name: "Web", identifier: "WEB" });
    const item = createWorkItem(oldBot, { project_id: project.id, name: "Old" });
    updateWorkItem(oldBot, item.id, { name: "Old edit" });
    const user = context(handles, USER_ACTOR_ID, "2026-10-18T10:00:00.000Z");
    expect(sinceLastVisit(user, null).entries.filter((entry) => entry.actor.kind !== "user")).toEqual([]);
    const recentBot = context(handles, ASSISTANT_ACTOR_ID, "2026-10-18T11:00:00.000Z");
    updateWorkItem(recentBot, item.id, { priority: "urgent" });
    expect(sinceLastVisit(user, null).entries.some((entry) => entry.target.id === item.id)).toBe(true);
    const before = latestSeq(user);
    const activityBefore = handles.db.select({ n: count() }).from(activity).get()?.n ?? 0;
    setHomeSeen(handles.db, before);
    setHomeSeen(handles.db, 1);
    expect(getWorkspaceSettings(user).last_seen_seq).toBe(before);
    expect(handles.db.select({ n: count() }).from(activity).get()?.n).toBe(activityBefore);
    expect(sinceLastVisit(user, before).entries).toEqual([]);
    const summary = getHomeSummary(user);
    const assigned = getCounts(user, { type: "profile", actor_id: USER_ACTOR_ID, tab: "assigned" });
    const created = getCounts(user, { type: "profile", actor_id: USER_ACTOR_ID, tab: "created" });
    const subscribed = getCounts(user, { type: "profile", actor_id: USER_ACTOR_ID, tab: "subscribed" });
    const open = (counts: { total: number; by_state_group: { completed: number; cancelled: number } }) =>
      counts.total - counts.by_state_group.completed - counts.by_state_group.cancelled;
    expect(summary.your_work.assigned_open).toBe(open(assigned));
    expect(summary.your_work.created_open).toBe(open(created));
    expect(summary.your_work.subscribed_open).toBe(open(subscribed));
    expect(summary.your_work.by_state_group).toEqual(assigned.by_state_group);
    expect(summary.digest).toBeNull();
    expect(addDays(TODAY, -7)).toBe("2026-10-11");
  });
});
