import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createContext } from "@/lib/tessera/core/context";
import { getCounts } from "@/lib/tessera/counts";
import { createProject } from "@/lib/tessera/projects";
import { getProfileSummary, listAgentProfiles } from "@/lib/tessera/workspace";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestDb } from "../helpers/db";

describe("profiles", () => {
  it("matches getCounts for assigned, created and subscribed", () => {
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, today: () => "2026-10-18" });
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    setAssignees(ctx, item.id, [USER_ACTOR_ID]);
    const summary = getProfileSummary(ctx, { actor_id: USER_ACTOR_ID });
    expect(summary.assigned).toEqual(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID, tab: "assigned" }));
    expect(summary.created).toEqual(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID, tab: "created" }));
    expect(summary.subscribed).toEqual(getCounts(ctx, { type: "profile", actor_id: USER_ACTOR_ID, tab: "subscribed" }));
    expect(summary.projects).toEqual([{ project_id: project.id, name: "Web", assigned_open: summary.assigned.total - summary.assigned.by_state_group.completed - summary.assigned.by_state_group.cancelled }]);
    expect(listAgentProfiles(ctx).map((row) => row.actor.kind).sort()).toEqual(["assistant", "system"]);
    expect(listAgentProfiles(ctx).every((row) => row.actor.kind !== "user")).toBe(true);
  });
});
