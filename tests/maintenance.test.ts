/**
 * Retention windows and dry-run maintenance. Uses in-memory databases only.
 */
import { describe, expect, it } from "vitest";
import { applyProposals, createProposal } from "@/lib/tessera/ai/proposals";
import { ASSISTANT_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { ai_proposal } from "@/lib/tessera/db/schema";
import { applyRetention, planRetention } from "@/lib/tessera/maintenance";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";
import { eq } from "drizzle-orm";

describe("retention", () => {
  it("keeps the latest undoable batch and purges old discarded proposals", () => {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(user, { project_id: project.id, name: "Ship" });

    const conversation = "11111111-1111-4111-8111-111111111111";
    const assistant = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
    const proposal = createProposal(assistant, {
      conversation_id: conversation,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "high" },
      project_id: project.id,
    });
    applyProposals(handles, { ids: [proposal.id], confirmed_ids: [] });

    const old = "2026-01-01T00:00:00.000Z";
    handles.db
      .insert(ai_proposal)
      .values({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conversation_id: conversation,
        source: "assistant",
        tool: "update_work_item",
        input: { work_item_id: item.id, priority: "low" },
        preview: { title: "Old", target: null, fields: [] },
        destructive: false,
        status: "discarded",
        project_id: project.id,
        created_at: old,
        decided_at: old,
      })
      .run();

    const now = "2026-10-18T12:00:00.000Z";
    const plan = planRetention(user, now);
    expect(plan.proposals).toBe(1);
    expect(plan.proposal_ids).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    // The applied batch is newer than 90 days and is the undoable batch.
    expect(plan.proposal_ids).not.toContain(proposal.id);

    applyRetention(user, plan);
    const left = handles.db
      .select()
      .from(ai_proposal)
      .where(eq(ai_proposal.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))
      .get();
    expect(left).toBeUndefined();
    expect(handles.db.select().from(ai_proposal).where(eq(ai_proposal.id, proposal.id)).get()).toBeDefined();
  });
});
