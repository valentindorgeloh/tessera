import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { applyProposals, createProposal, discardProposals } from "@/lib/tessera/ai/proposals";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, getWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "../helpers/db";

const CONV = "11111111-1111-4111-8111-111111111111";

function setup() {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
  return { handles, ctx, item };
}

describe("proposals", () => {
  it("stores a proposal without writing activity", () => {
    const { ctx, item } = setup();
    const before = latestSeq(ctx);
    const proposal = createProposal(ctx, {
      conversation_id: CONV,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "high" },
    });
    expect(proposal.status).toBe("pending");
    expect(proposal.preview.title).toContain("WEB-1");
    expect(latestSeq(ctx)).toBe(before);
    expect(getWorkItem(ctx, item.id).priority).toBe("none");
  });

  it("refuses a read tool", () => {
    const { ctx, item } = setup();
    expect(() => createProposal(ctx, { conversation_id: CONV, source: "assistant", tool: "get_work_item", input: { work_item_id: item.id } })).toThrow(TrackerError);
  });

  it("applies once as the assistant and records the activity range", () => {
    const { handles, ctx, item } = setup();
    const proposal = createProposal(ctx, {
      conversation_id: CONV,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "high" },
    });
    const [first] = applyProposals(handles, { ids: [proposal.id] });
    expect(first?.status).toBe("applied");
    expect(getWorkItem(ctx, item.id).priority).toBe("high");
    const again = applyProposals(handles, { ids: [proposal.id] });
    expect(again[0]?.status).toBe("failed");
    expect(again[0]?.error?.code).toBe("CONFLICT");
  });

  it("leaves a destructive proposal pending until it is confirmed", () => {
    const { handles, ctx, item } = setup();
    const proposal = createProposal(ctx, {
      conversation_id: CONV,
      source: "assistant",
      tool: "delete_work_item",
      input: { work_item_id: item.id },
    });
    expect(proposal.destructive).toBe(true);
    const [held] = applyProposals(handles, { ids: [proposal.id] });
    expect(held?.status).toBe("pending");
    expect(getWorkItem(ctx, item.id).deleted_at).toBeNull();
    const [done] = applyProposals(handles, { ids: [proposal.id], confirmed_ids: [proposal.id] });
    expect(done?.status).toBe("applied");
  });

  it("discards only pending rows", () => {
    const { ctx, item } = setup();
    const proposal = createProposal(ctx, {
      conversation_id: CONV,
      source: "assistant",
      tool: "update_work_item",
      input: { work_item_id: item.id, priority: "low" },
    });
    const [discarded] = discardProposals(ctx, { ids: [proposal.id] });
    expect(discarded?.status).toBe("discarded");
    const [again] = discardProposals(ctx, { ids: [proposal.id] });
    expect(again?.status).toBe("discarded");
  });
});
