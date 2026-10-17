import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { newId } from "@/lib/tessera/core/ids";
import { createWorkItem } from "@/lib/tessera/work-items";
import { describeScope, SYSTEM_PROMPT } from "@/lib/tessera/ai/prompts";
import { createProject } from "@/lib/tessera/projects";
import type { ProposalView } from "@/lib/tessera/types";
import { createTestDb } from "../helpers/db";

describe("prompts", () => {
  it("keeps the date and the scope out of the frozen prompt", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SYSTEM_PROMPT).not.toContain("{today}");
    expect(SYSTEM_PROMPT).not.toContain("{scope}");
    expect(SYSTEM_PROMPT.toLowerCase()).not.toContain("today is");
    expect(SYSTEM_PROMPT).toContain("A proposal cannot use the id of an item another proposal would create; put all fields into the create proposal.");
  });

  it("lists proposals with their status and error, and names the open work item", () => {
    const handles = createTestDb();
    const ctx = createContext({
      db: handles.db,
      sqlite: handles.sqlite,
      actorId: USER_ACTOR_ID,
      today: () => "2026-10-17",
    });
    const project = createProject(ctx, { name: "Website", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Fix login" });
    const failed: ProposalView = {
      id: newId(),
      conversation_id: crypto.randomUUID(),
      source: "assistant",
      tool: "update_work_item",
      title: "Update work item · WEB-1 Fix login",
      input: {},
      preview: { title: "Update work item · WEB-1 Fix login", target: null, fields: [] },
      destructive: false,
      status: "failed",
      error: { code: "CONFLICT", message: "Description changed" },
      created_at: "2026-10-17T00:00:00.000Z",
      decided_at: "2026-10-17T00:01:00.000Z",
    };
    const pending: ProposalView = {
      ...failed,
      id: newId(),
      title: "Create work item · Expected",
      status: "pending",
      error: null,
      decided_at: null,
    };
    const text = describeScope(ctx, { project_id: project.id, work_item_id: item.id }, [failed, pending]);
    expect(text).toContain("Today: 2026-10-17");
    expect(text).toContain("Project: WEB Website");
    expect(text).toContain("States:");
    expect(text).toContain("Backlog (backlog)");
    expect(text).toContain(`Work item: ${item.key} Fix login`);
    expect(text).toContain("- Update work item · WEB-1 Fix login — failed: Description changed");
    expect(text).toContain("- Create work item · Expected — pending");
    expect(SYSTEM_PROMPT).not.toContain("2026-10-17");
  });
});
