import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { registerActor, SYSTEM_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { acquireLease, dueForClose, getAutomationStatus, releaseLease, runAutomations } from "@/lib/tessera/automations";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { addMonthsIso } from "@/lib/tessera/core/time";
import { openDatabase } from "@/lib/tessera/db/client";
import { activity, work_item } from "@/lib/tessera/db/schema";
import { listNotifications } from "@/lib/tessera/notifications";
import { createProject, updateProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestDb, withTempFileDb } from "./helpers/db";
import { withTimeZone } from "./helpers/time-zone";

const NOW = "2026-10-18T12:00:00.000Z";
const OLD = "2026-01-15T12:00:00.000Z";
const TODAY = "2026-10-18";

function setup() {
  const handles = createTestDb();
  const ctx = createContext({
    db: handles.db,
    sqlite: handles.sqlite,
    actorId: USER_ACTOR_ID,
    now: () => NOW,
    today: () => TODAY,
  });
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const states = Object.fromEntries(listStates(ctx, project.id).map((row) => [row.name, row]));
  return { handles, ctx, project, states };
}

function stamp(ctx: TesseraContext, id: string, updatedAt: string, completedAt?: string | null): void {
  ctx.db
    .update(work_item)
    .set({ updated_at: updatedAt, ...(completedAt === undefined ? {} : { completed_at: completedAt }) })
    .where(eq(work_item.id, id))
    .run();
}

function systemActivity(ctx: TesseraContext, workItemId: string) {
  return ctx.db
    .select()
    .from(activity)
    .where(and(eq(activity.actor_id, SYSTEM_ACTOR_ID), eq(activity.work_item_id, workItemId)))
    .all();
}

describe("runAutomations", () => {
  it("logs a system activity row when the close rule matches and writes nothing when it does not", () => {
    withTimeZone("UTC", () => {
      const { ctx, project, states } = setup();
      updateProject(ctx, project.id, { close_in_months: 1 });
      const stale = createWorkItem(ctx, { project_id: project.id, name: "Stale" });
      const recent = createWorkItem(ctx, { project_id: project.id, name: "Recent" });
      stamp(ctx, stale.id, OLD);

      const dry = runAutomations(ctx, { project_id: project.id, dry_run: true });
      expect(dry).toMatchObject({ dry_run: true, lease_held: false, projects: [{ closed: 1, archived: 0, error: null }] });
      expect(systemActivity(ctx, stale.id)).toEqual([]);
      expect(ctx.db.select().from(work_item).where(eq(work_item.id, stale.id)).get()?.state_id).toBe(stale.state_id);

      const applied = runAutomations(ctx, { project_id: project.id });
      expect(applied.projects[0]).toMatchObject({ closed: 1, archived: 0, skipped: 0, error: null });
      expect(systemActivity(ctx, stale.id)).toEqual([
        expect.objectContaining({
          actor_id: SYSTEM_ACTOR_ID,
          verb: "updated",
          field: "state_id",
          comment: "Closed automatically after 1 month without activity",
        }),
      ]);
      expect(ctx.db.select().from(work_item).where(eq(work_item.id, stale.id)).get()?.state_id).toBe(states.Cancelled.id);
      expect(systemActivity(ctx, recent.id)).toEqual([]);
      expect(ctx.db.select().from(work_item).where(eq(work_item.id, recent.id)).get()?.state_id).toBe(recent.state_id);

      const notes = listNotifications(ctx);
      expect(notes.some((note) => note.kind === "automation" && note.work_item_id === stale.id)).toBe(true);
      const status = getAutomationStatus(ctx);
      expect(status.last_run_at).toBe(NOW);
      expect(status.projects.find((row) => row.project_id === project.id)?.due_close).toBe(0);
    });
  });

  it("writes no system activity when the project has no close or archive rule", () => {
    withTimeZone("UTC", () => {
      const { ctx, project } = setup();
      const stale = createWorkItem(ctx, { project_id: project.id, name: "Stale" });
      stamp(ctx, stale.id, OLD);
      const summary = runAutomations(ctx, { project_id: project.id });
      expect(summary.projects[0]).toMatchObject({ closed: 0, archived: 0, error: null });
      expect(systemActivity(ctx, stale.id)).toEqual([]);
      expect(ctx.db.select().from(work_item).where(eq(work_item.id, stale.id)).get()?.state_id).toBe(stale.state_id);
    });
  });

  it("archives completed items by completed_at and cancelled items by updated_at, and leaves triage alone", () => {
    withTimeZone("UTC", () => {
      const handles = createTestDb();
      const ctx = createContext({
        db: handles.db,
        sqlite: handles.sqlite,
        actorId: USER_ACTOR_ID,
        now: () => NOW,
        today: () => TODAY,
      });
      const project = createProject(ctx, {
        name: "Web",
        identifier: "WEB",
        features: { intake_enabled: true, agent_intake_required: true },
      });
      updateProject(ctx, project.id, { archive_in_months: 1, close_in_months: 1 });
      const states = Object.fromEntries(listStates(ctx, project.id).map((row) => [row.name, row]));
      const done = createWorkItem(ctx, { project_id: project.id, name: "Done" });
      updateWorkItem(ctx, done.id, { state_id: states.Done.id });
      stamp(ctx, done.id, OLD, OLD);
      const cancelled = createWorkItem(ctx, { project_id: project.id, name: "Cancelled" });
      updateWorkItem(ctx, cancelled.id, { state_id: states.Cancelled.id });
      stamp(ctx, cancelled.id, OLD, null);
      const fresh = createWorkItem(ctx, { project_id: project.id, name: "Fresh done" });
      updateWorkItem(ctx, fresh.id, { state_id: states.Done.id });
      const agent = registerActor(ctx, { kind: "agent", name: "mcp:auto" });
      const agentCtx = createContext({
        db: handles.db,
        sqlite: handles.sqlite,
        actorId: agent.id,
        now: () => NOW,
        today: () => TODAY,
      });
      const intake = createWorkItem(agentCtx, { project_id: project.id, name: "Waiting" });
      stamp(ctx, intake.id, OLD);

      const summary = runAutomations(ctx, { project_id: project.id });
      expect(summary.projects[0]).toMatchObject({ archived: 2, error: null });
      expect(systemActivity(ctx, done.id)).toEqual([
        expect.objectContaining({
          actor_id: SYSTEM_ACTOR_ID,
          verb: "archived",
          comment: "Archived automatically 1 month after closing",
        }),
      ]);
      expect(systemActivity(ctx, cancelled.id)).toEqual([expect.objectContaining({ verb: "archived", actor_id: SYSTEM_ACTOR_ID })]);
      expect(systemActivity(ctx, fresh.id)).toEqual([]);
      expect(systemActivity(ctx, intake.id)).toEqual([]);
      expect(ctx.db.select().from(work_item).where(eq(work_item.id, intake.id)).get()?.state_id).toBe(states.Triage.id);
    });
  });

  it("does not apply a second runner while the lease is held", async () => {
    await withTempFileDb((filePath) => {
      withTimeZone("UTC", () => {
        const first = openDatabase(filePath);
        const second = openDatabase(filePath);
        try {
          const ctx = createContext({
            db: first.db,
            sqlite: first.sqlite,
            actorId: USER_ACTOR_ID,
            now: () => NOW,
            today: () => TODAY,
          });
          const project = createProject(ctx, { name: "Web", identifier: "WEB" });
          updateProject(ctx, project.id, { close_in_months: 1 });
          const item = createWorkItem(ctx, { project_id: project.id, name: "Stale" });
          stamp(ctx, item.id, OLD);
          expect(acquireLease(first.sqlite, "automation", "runner-a", NOW, 15 * 60 * 1000)).toBe(true);
          expect(acquireLease(second.sqlite, "automation", "runner-b", NOW, 15 * 60 * 1000)).toBe(false);

          const other = createContext({
            db: second.db,
            sqlite: second.sqlite,
            actorId: USER_ACTOR_ID,
            now: () => NOW,
            today: () => TODAY,
          });
          const blocked = runAutomations(other, { project_id: project.id });
          expect(blocked.lease_held).toBe(true);
          expect(blocked.projects).toEqual([]);
          expect(systemActivity(other, item.id)).toEqual([]);

          releaseLease(first.sqlite, "automation", "runner-a");
          const applied = runAutomations(other, { project_id: project.id });
          expect(applied.lease_held).toBe(false);
          expect(applied.projects[0]).toMatchObject({ closed: 1, error: null });
          expect(systemActivity(other, item.id)).toHaveLength(1);
          const again = runAutomations(other, { project_id: project.id });
          expect(again.projects[0]?.closed).toBe(0);
          expect(systemActivity(other, item.id)).toHaveLength(1);
        } finally {
          first.sqlite.close();
          second.sqlite.close();
        }
      });
    });
  });

  it("caps the items selected for one rule", () => {
    withTimeZone("UTC", () => {
      const { ctx, project } = setup();
      const updated = updateProject(ctx, project.id, { close_in_months: 1 });
      const first = createWorkItem(ctx, { project_id: project.id, name: "One" });
      const second = createWorkItem(ctx, { project_id: project.id, name: "Two" });
      stamp(ctx, first.id, OLD);
      stamp(ctx, second.id, OLD);
      expect(dueForClose(ctx, updated, NOW, 1)).toHaveLength(1);
      expect(dueForClose(ctx, updated, NOW, 5)).toHaveLength(2);
    });
  });

  it("refuses a close state that is not completed or cancelled", () => {
    const { ctx, project, states } = setup();
    expect(() => updateProject(ctx, project.id, { close_state_id: states.Todo.id })).toThrow(TrackerError);
    try {
      updateProject(ctx, project.id, { close_state_id: states.Todo.id });
    } catch (err) {
      expect(err).toMatchObject({ code: "RULE", details: { rule: "close_state_group" } });
    }
    expect(updateProject(ctx, project.id, { close_state_id: states.Done.id }).close_state_id).toBe(states.Done.id);
  });
});

describe("addMonthsIso", () => {
  it("clamps the day to the target month", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsIso("2026-10-18", -1)).toBe("2026-09-18");
  });
});
