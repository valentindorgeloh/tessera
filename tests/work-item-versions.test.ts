import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { activity, work_item_version } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, listWorkItemVersions, restoreWorkItemVersion, updateWorkItemDescription } from "@/lib/tessera/work-items";
import { createTestDb } from "./helpers/db";

describe("work item versions", () => {
  it("skips an empty description, collapses the same actor within five minutes, and starts a row for another actor", () => {
    const handles = createTestDb();
    let now = "2026-10-10T12:00:00.000Z";
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => now, today: () => "2026-10-10" });
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const bare = createWorkItem(ctx, { project_id: project.id, name: "Empty" });
    expect(handles.db.select().from(work_item_version).where(eq(work_item_version.work_item_id, bare.id)).all()).toHaveLength(0);

    const item = createWorkItem(ctx, { project_id: project.id, name: "Design", description_md: "first" });
    now = "2026-10-10T12:02:00.000Z";
    updateWorkItemDescription(ctx, item.id, { description_md: "second", expected_description_version: item.description_version });
    expect(listWorkItemVersions(ctx, { work_item_id: item.id })).toHaveLength(1);

    const assistant = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID, now: () => now, today: () => "2026-10-10" });
    const current = listWorkItemVersions(ctx, { work_item_id: item.id })[0];
    updateWorkItemDescription(assistant, item.id, { description_md: "theirs", expected_description_version: current.version });
    expect(listWorkItemVersions(ctx, { work_item_id: item.id })).toHaveLength(2);
  });

  it("restores the stored description and logs restored", () => {
    const handles = createTestDb();
    let now = "2026-10-10T12:00:00.000Z";
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => now, today: () => "2026-10-10" });
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Design", description_md: "first" });
    now = "2026-10-10T13:00:00.000Z";
    const edited = updateWorkItemDescription(ctx, item.id, { description_md: "second", expected_description_version: item.description_version });
    const original = listWorkItemVersions(ctx, { work_item_id: item.id }).find((row) => row.version === item.description_version);
    expect(original).toBeDefined();
    const restored = restoreWorkItemVersion(ctx, {
      work_item_id: item.id,
      version_id: original!.id,
      expected_description_version: edited.description_version,
    });
    expect(restored.description_md).toBe("first");
    const verbs = handles.db.select({ verb: activity.verb, field: activity.field }).from(activity).where(eq(activity.entity_id, item.id)).all();
    expect(verbs.some((row) => row.verb === "restored" && row.field === "description")).toBe(true);
    expect(() => restoreWorkItemVersion(ctx, { work_item_id: item.id, version_id: original!.id, expected_description_version: 0 })).toThrow(TrackerError);
  });
});
