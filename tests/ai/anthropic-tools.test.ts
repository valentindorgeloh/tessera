import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { newId } from "@/lib/tessera/core/ids";
import { activity, ai_proposal, work_item } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { PROPOSE_PREFIX, buildAssistantTools } from "@/lib/tessera/tools/anthropic";
import { listTools } from "@/lib/tessera/tools/registry";
import type { AssistantEvent } from "@/lib/tessera/types";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import type { BetaToolRunContext } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { createTestContext, createTestDb } from "../helpers/db";

function tally(ctx: ReturnType<typeof createTestContext>, table: typeof activity | typeof work_item | typeof ai_proposal): number {
  return ctx.db.select({ n: count() }).from(table).get()?.n ?? 0;
}

function context(id: string, name: string): BetaToolRunContext {
  return { toolUse: { type: "tool_use", id, name, input: {} } } as BetaToolRunContext;
}

describe("assistant tools", () => {
  it("exposes one tool per registry entry, with propose_ only on mutating tools", () => {
    const handles = createTestDb();
    const defs = listTools({ toolset: "all" });
    const tools = buildAssistantTools(handles, {
      toolset: "all",
      conversationId: crypto.randomUUID(),
      projectId: null,
      emit: () => undefined,
    });
    expect(tools.map((tool) => tool.name)).toEqual(defs.map((def) => (def.mutates ? `${PROPOSE_PREFIX}${def.name}` : def.name)));
    expect(tools.every((tool) => tool.name.length <= 64)).toBe(true);
    expect(tools.some((tool) => tool.name === "list_projects")).toBe(true);
    expect(tools.some((tool) => tool.name === "propose_create_work_item")).toBe(true);
    expect(tools.some((tool) => tool.name === "create_work_item")).toBe(false);
  });

  it("turns a read tool's TrackerError into a ToolError", async () => {
    const handles = createTestDb();
    const events: AssistantEvent[] = [];
    const tools = buildAssistantTools(handles, {
      toolset: "core",
      conversationId: crypto.randomUUID(),
      projectId: null,
      emit: (event) => events.push(event),
    });
    const tool = tools.find((candidate) => candidate.name === "get_work_item");
    expect(tool).toBeDefined();
    const id = newId();
    await expect(tool!.run({ work_item_id: id }, context("tu_read", "get_work_item"))).rejects.toBeInstanceOf(ToolError);
    try {
      await tool!.run({ work_item_id: id }, context("tu_read", "get_work_item"));
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).content).toMatch(/^NOT_FOUND: /);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", id: "tu_read", ok: false }));
  });

  it("writes only a proposal when a propose_ tool runs", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const events: AssistantEvent[] = [];
    const tools = buildAssistantTools(handles, {
      toolset: "all",
      conversationId: crypto.randomUUID(),
      projectId: project.id,
      emit: (event) => events.push(event),
    });
    const tool = tools.find((candidate) => candidate.name === "propose_create_work_item");
    expect(tool).toBeDefined();
    const before = { seq: latestSeq(ctx), items: tally(ctx, work_item), activity: tally(ctx, activity), proposals: tally(ctx, ai_proposal) };
    const raw = tool!.run({ project_id: project.id, name: "From the assistant" }, context("tu_propose", "propose_create_work_item"));
    expect(raw).not.toBeInstanceOf(Promise);
    const result = JSON.parse(raw as string) as { proposal_id: string; status: string };
    expect(result.status).toBe("pending");
    expect(latestSeq(ctx)).toBe(before.seq);
    expect(tally(ctx, work_item)).toBe(before.items);
    expect(tally(ctx, activity)).toBe(before.activity);
    expect(tally(ctx, ai_proposal)).toBe(before.proposals + 1);
    expect(events).toContainEqual(expect.objectContaining({ type: "proposal" }));
  });
});
