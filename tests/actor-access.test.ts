import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, registerActor, updateActor } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createProject, updateProjectFeatures } from "@/lib/tessera/projects";
import { createMcpActorResolver, mcpToolName, registerTesseraTools } from "@/lib/tessera/tools/mcp";
import { runToolWithContext } from "@/lib/tessera/tools/registry";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

function ruleOf(err: unknown): string | undefined {
  return err instanceof TrackerError && err.code === "RULE" ? (err.details as { rule: string }).rule : undefined;
}

describe("actor access", () => {
  it("defaults existing actors to write", () => {
    const handles = createTestDb();
    const row = handles.sqlite.prepare("SELECT access FROM actor LIMIT 1").get() as { access: string };
    expect(row.access).toBe("write");
    handles.sqlite.close();
  });

  it("a read agent cannot mutate, and can still mark its own notifications", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "A" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:reader" });
    updateActor(ctx, agent.id, { access: "read" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    await expect(runToolWithContext(actx, "update_work_item", { work_item_id: item.id, priority: "high" })).rejects.toSatisfy((err: unknown) => ruleOf(err) === "actor_read_only");
    const marked = await runToolWithContext(actx, "mark_notifications_read", { ids: [], all: true });
    expect(marked.data).toEqual({ updated: 0 });

    const server = new McpServer({ name: "tessera-test", version: "0.0.0" });
    registerTesseraTools(server, { handles, actorResolver: createMcpActorResolver(handles) });
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    await server.connect(serverEnd);
    const client = new Client({ name: "reader", version: "1.0.0" });
    await client.connect(clientEnd);
    const registered = (await client.callTool({ name: mcpToolName("list_actors"), arguments: {} })) as CallToolResult;
    const actors = (registered.structuredContent as { items: { name: string; id: string }[] }).items;
    const mcpActor = actors.find((row) => row.name === "mcp:reader");
    expect(mcpActor).toBeDefined();
    updateActor(ctx, mcpActor!.id, { access: "read" });
    const refused = (await client.callTool({ name: mcpToolName("update_work_item"), arguments: { work_item_id: item.id, priority: "low" } })) as CallToolResult;
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).toContain("read-only");
    const listed = (await client.callTool({ name: mcpToolName("list_notifications"), arguments: {} })) as CallToolResult;
    expect(listed.isError).toBeFalsy();
    await client.close();
    await server.close();
    handles.sqlite.close();
  });

  it("an intake agent lands in triage even when the project policy is off, and cannot update", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    updateProjectFeatures(ctx, project.id, { intake_enabled: true, agent_intake_required: false });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:intake" });
    updateActor(ctx, agent.id, { access: "intake" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    const created = await runToolWithContext(actx, "create_work_item", { project_id: project.id, name: "From intake" });
    expect((created.data as { intake: { status: string } | null }).intake).toEqual({ status: "pending" });
    await expect(runToolWithContext(actx, "update_work_item", { work_item_id: (created.data as { id: string }).id, priority: "high" })).rejects.toSatisfy(
      (err: unknown) => ruleOf(err) === "actor_intake_only",
    );
    const closed = createProject(ctx, { name: "Closed", identifier: "CLS" });
    await expect(runToolWithContext(actx, "create_work_item", { project_id: closed.id, name: "No" })).rejects.toSatisfy((err: unknown) => ruleOf(err) === "intake_disabled");
    handles.sqlite.close();
  });

  it("refuses an agent changing access, and the user changing a built-in actor", () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:self" });
    const actx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    try {
      updateActor(actx, agent.id, { access: "write" });
      throw new Error("expected a refusal");
    } catch (err) {
      expect(ruleOf(err)).toBe("actor_access_forbidden");
    }
    try {
      updateActor(ctx, ASSISTANT_ACTOR_ID, { access: "read" });
      throw new Error("expected a refusal");
    } catch (err) {
      expect(ruleOf(err)).toBe("builtin_actor");
    }
    const updated = updateActor(ctx, agent.id, { access: "read" });
    expect(updated.access).toBe("read");
    handles.sqlite.close();
  });
});
