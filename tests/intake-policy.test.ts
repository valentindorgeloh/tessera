/**
 * Exit criterion: an MCP create lands in triage when the project requires it,
 * and stays out of the board and the counts until it is accepted.
 */
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpActorResolver, mcpToolName, registerTesseraTools } from "@/lib/tessera/tools/mcp";
import { createTestDb, type DbHandles } from "./helpers/db";

type Harness = { client: Client; close(): Promise<void> };
const open: Harness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function connect(): Promise<Harness> {
  const handles: DbHandles = createTestDb();
  const server = new McpServer({ name: "tessera-test", version: "0.0.0" });
  registerTesseraTools(server, { handles, actorResolver: createMcpActorResolver(handles) });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const client = new Client({ name: "policy-bot", version: "1.0.0" });
  await client.connect(clientEnd);
  const harness = {
    client,
    close: async () => {
      await client.close();
      await server.close();
      handles.sqlite.close();
    },
  };
  open.push(harness);
  return harness;
}

function call(harness: Harness, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return harness.client.callTool({ name: mcpToolName(name), arguments: args });
}

function data<T>(result: CallToolResult): T {
  expect(result.isError).toBeFalsy();
  return result.structuredContent as T;
}

describe("MCP create lands in triage when required", () => {
  it("MCP create lands in triage when required", async () => {
    const harness = await connect();
    const project = data<{ id: string }>(await call(harness, "create_project", { name: "Website", identifier: "WEB", features: { intake_enabled: true, agent_intake_required: true } }));
    const item = data<{ id: string; key: string; intake: { status: string } | null }>(await call(harness, "create_work_item", { project_id: project.id, name: "Fix login" }));
    expect(item.intake).toEqual({ status: "pending" });
    expect(item.key).toBe("WEB-1");

    const board = data<{ items: { id: string }[]; total: number }>(await call(harness, "list_work_items", { scope: { type: "project", project_id: project.id } }));
    expect(board.items.map((row) => row.id)).not.toContain(item.id);
    expect(board.total).toBe(0);

    const counts = data<{ total: number }>(await call(harness, "get_counts", { scope: { type: "project", project_id: project.id } }));
    expect(counts.total).toBe(0);

    const intake = data<{ items: { work_item_id: string; status: string }[]; counts: { open: number } }>(await call(harness, "list_intake_items", { project_id: project.id }));
    expect(intake.items.map((row) => row.work_item_id)).toEqual([item.id]);
    expect(intake.counts.open).toBe(1);
    expect(intake.items[0]?.status).toBe("pending");
  });

  it("lands on the board when the policy is off, and copy and move follow the policy", async () => {
    const harness = await connect();
    const source = data<{ id: string }>(await call(harness, "create_project", { name: "Website", identifier: "WEB" }));
    const target = data<{ id: string }>(await call(harness, "create_project", { name: "Ops", identifier: "OPS", features: { intake_enabled: true, agent_intake_required: true } }));
    const direct = data<{ intake: { status: string } | null }>(await call(harness, "create_work_item", { project_id: source.id, name: "On the board" }));
    expect(direct.intake).toBeNull();
    const board = data<{ total: number }>(await call(harness, "list_work_items", { scope: { type: "project", project_id: source.id } }));
    expect(board.total).toBe(1);

    const original = data<{ id: string }>(await call(harness, "create_work_item", { project_id: source.id, name: "Move me" }));
    const copied = data<{ intake: { status: string } | null }>(await call(harness, "copy_work_item", { work_item_id: original.id, project_id: target.id }));
    expect(copied.intake).toEqual({ status: "pending" });
    const moved = data<{ intake: { status: string } | null }>(await call(harness, "move_work_item_to_project", { work_item_id: original.id, project_id: target.id, confirm: true }));
    expect(moved.intake).toEqual({ status: "pending" });
    const hidden = data<{ total: number }>(await call(harness, "list_work_items", { scope: { type: "project", project_id: target.id } }));
    expect(hidden.total).toBe(0);
  });
});
