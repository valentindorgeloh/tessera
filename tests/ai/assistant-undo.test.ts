/**
 * Assistant-batch undo: Apply stamps a batch id; undo restores fields and
 * refuses a conflict when a later write touched the same field.
 */
import { describe, expect, it } from "vitest";
import { applyProposals, createProposal } from "@/lib/tessera/ai/proposals";
import { findLatestUndoableBatch, undoLastAssistantBatch } from "@/lib/tessera/ai/undo";
import { ASSISTANT_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "../helpers/db";

const CONVERSATION = "22222222-2222-4222-8222-222222222222";

function ruleOrConflict(fn: () => unknown): { code: string; rule?: string } | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) {
      return { code: err.code, rule: (err.details as { rule?: string } | undefined)?.rule };
    }
    throw err;
  }
  return undefined;
}

describe("assistant batch undo", () => {
  it("restores the previous priority from an applied batch", () => {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(user, { project_id: project.id, name: "Ship" });
    const assistant = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
    const proposal = createProposal(assistant, {
      conversation_id: CONVERSATION,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "high" },
      project_id: project.id,
    });
    const outcomes = applyProposals(handles, { ids: [proposal.id], confirmed_ids: [] });
    expect(outcomes[0]?.status).toBe("applied");
    expect(getWorkItem(user, item.id).priority).toBe("high");

    const batch = findLatestUndoableBatch(user);
    expect(batch?.proposal_ids).toEqual([proposal.id]);

    const undone = undoLastAssistantBatch(user);
    expect(undone.batch_id).toBe(batch?.batch_id);
    expect(getWorkItem(user, item.id).priority).toBe("none");
    expect(findLatestUndoableBatch(user)).toBeNull();
    expect(ruleOrConflict(() => undoLastAssistantBatch(user))?.rule).toBe("nothing_to_undo");
  });

  it("refuses undo when a later user write touched the same field", () => {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(user, { project_id: project.id, name: "Ship" });
    const assistant = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
    const proposal = createProposal(assistant, {
      conversation_id: CONVERSATION,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "high" },
      project_id: project.id,
    });
    applyProposals(handles, { ids: [proposal.id], confirmed_ids: [] });
    updateWorkItem(user, item.id, { priority: "urgent" });

    const err = ruleOrConflict(() => undoLastAssistantBatch(user));
    expect(err?.code).toBe("CONFLICT");
    expect(getWorkItem(user, item.id).priority).toBe("urgent");
  });
});
