/**
 * MCP adapter (docs/contracts/tools.md "MCP"): a Client and a McpServer on an
 * in-memory database, linked by an InMemoryTransport pair. Covers the tool
 * listing, the result shapes, the confirm rule for destructive tools, the
 * TrackerError mapping, the intake note and the `mcp:<client>` actor.
 */
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { listActors } from "@/lib/tessera/actors";
import { listProjects } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createMcpActorResolver, mcpToolName, registerTesseraTools, type RegisterTesseraToolsOptions } from "@/lib/tessera/tools/mcp";
import { listTools } from "@/lib/tessera/tools/registry";
import { getWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles } from "./helpers/db";

const CLIENT_NAME = "vitest-client";
const CLIENT_VERSION = "1.2.3";

type Harness = {
  client: Client;
  handles: DbHandles;
  /** Registry names handed to afterWrite, in order. */
  writes: string[];
  close(): Promise<void>;
};

type ConnectOptions = Partial<Pick<RegisterTesseraToolsOptions, "handles" | "toolset" | "fallbackClientName">> & { clientName?: string };

const open: Harness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function connect(options: ConnectOptions = {}): Promise<Harness> {
  const handles = options.handles ?? createTestDb();
  const writes: string[] = [];
  const server = new McpServer({ name: "tessera-test", version: "0.0.0" });
  registerTesseraTools(server, {
    handles,
    toolset: options.toolset,
    actorResolver: createMcpActorResolver(handles),
    afterWrite: (name) => writes.push(name),
    fallbackClientName: options.fallbackClientName,
  });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const client = new Client({ name: options.clientName ?? CLIENT_NAME, version: CLIENT_VERSION });
  await client.connect(clientEnd);
  const harness: Harness = {
    client,
    handles,
    writes,
    close: async () => {
      await client.close();
      await server.close();
      if (options.handles === undefined) handles.sqlite.close();
    },
  };
  open.push(harness);
  return harness;
}

function call(harness: Harness, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return harness.client.callTool({ name: mcpToolName(name), arguments: args });
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

function structured<T>(result: CallToolResult): T {
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as T;
}

type ProjectResult = { id: string; identifier: string; name: string };
type WorkItemResult = { id: string; key: string; state_id: string; created_by: string; intake: { status: string } | null };

async function createProject(harness: Harness, features?: Record<string, boolean>): Promise<ProjectResult> {
  return structured<ProjectResult>(await call(harness, "create_project", { name: "Website", identifier: "WEB", ...(features ? { features } : {}) }));
}

describe("tools/list", () => {
  it("lists every registry tool as tessera_<name> with its description", async () => {
    const harness = await connect();
    const { tools } = await harness.client.listTools();
    const expected = listTools({ toolset: "all" });
    expect(tools.map((tool) => tool.name).sort()).toEqual(expected.map((def) => mcpToolName(def.name)).sort());
    for (const def of expected) {
      const tool = tools.find((candidate) => candidate.name === mcpToolName(def.name));
      expect(tool?.description).toContain(def.description);
      expect(tool?.title).toBe(def.title);
    }
  });

  it("toolset core exposes only the core tools", async () => {
    const harness = await connect({ toolset: "core" });
    const { tools } = await harness.client.listTools();
    const core = listTools({ toolset: "core" }).map((def) => mcpToolName(def.name));
    expect(core.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name).sort()).toEqual(core.sort());
  });

  it("destructive tools advertise a confirm field and destructiveHint; reads advertise readOnlyHint", async () => {
    const harness = await connect();
    const { tools } = await harness.client.listTools();
    const del = tools.find((tool) => tool.name === "tessera_delete_project");
    const properties = del?.inputSchema.properties as Record<string, { type?: string; description?: string }> | undefined;
    expect(properties?.confirm?.type).toBe("boolean");
    expect(properties?.confirm?.description).toMatch(/confirm/i);
    expect(del?.annotations?.destructiveHint).toBe(true);
    expect(del?.description).toContain("confirm: true");
    const list = tools.find((tool) => tool.name === "tessera_list_projects");
    expect(list?.annotations?.readOnlyHint).toBe(true);
    expect(list?.annotations?.destructiveHint).toBe(false);
    expect((list?.inputSchema.properties as Record<string, unknown> | undefined)?.confirm).toBeUndefined();
  });

  it("inputs with a recursive rich filter tree advertise rich_filters as a $ref into $defs and validate on call", async () => {
    const harness = await connect();
    const { tools } = await harness.client.listTools();
    for (const name of ["tessera_create_view", "tessera_update_view"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      const properties = tool?.inputSchema.properties as Record<string, { description?: string; anyOf?: { $ref?: string }[] }> | undefined;
      expect(properties?.rich_filters?.description, name).toMatch(/filter tree/);
      const ref = properties?.rich_filters?.anyOf?.find((branch) => branch.$ref)?.$ref;
      expect(ref, name).toMatch(/^#\/\$defs\//);
      const defs = (tool?.inputSchema as { $defs?: Record<string, unknown> }).$defs ?? {};
      expect(Object.keys(defs), name).toContain(ref?.replace("#/$defs/", ""));
    }
    const createView = tools.find((tool) => tool.name === "tessera_create_view");
    const properties = createView?.inputSchema.properties as Record<string, { type?: string; description?: string }> | undefined;
    expect(Object.keys(properties ?? {}).sort()).toEqual(["description", "display", "filters", "logo", "name", "project_id", "rich_filters"]);
    expect(properties?.name?.type).toBe("string");
    expect(properties?.rich_filters?.description).toContain("AND/OR/NOT");
    expect(createView?.inputSchema.required).toEqual(["project_id", "name"]);
    expect(createView?.inputSchema.additionalProperties).toBe(false);
    const project = await createProject(harness);
    const view = structured<{ id: string; rich_filters: unknown }>(
      await call(harness, "create_view", {
        project_id: project.id,
        name: "Urgent",
        rich_filters: { and: [{ field: "priority", op: "eq", value: "urgent" }] },
      }),
    );
    expect(view.rich_filters).toEqual({ and: [{ field: "priority", op: "eq", value: "urgent" }] });
    const invalid = await call(harness, "create_view", { project_id: project.id, name: "Broken", rich_filters: { and: "nope" } });
    expect(invalid.isError).toBe(true);
  });
});

describe("tools/call", () => {
  it("create_project returns the project as JSON text and structuredContent", async () => {
    const harness = await connect();
    const result = await call(harness, "create_project", { name: "Website", identifier: "web" });
    const data = structured<ProjectResult>(result);
    expect(data.identifier).toBe("WEB");
    const parsed = JSON.parse(textOf(result)) as ProjectResult;
    expect(parsed.id).toBe(data.id);
    expect(listProjects(createTestContext(harness.handles), {}).map((row) => row.id)).toEqual([data.id]);
  });

  it("list tools return ListResult objects as structuredContent", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const data = structured<{ items: ProjectResult[]; total: number; cursor: number }>(await call(harness, "list_projects"));
    expect(data.total).toBe(1);
    expect(data.items[0]?.id).toBe(project.id);
    expect(typeof data.cursor).toBe("number");
  });

  it("create_work_item lands in the default state when intake is not required", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const result = await call(harness, "create_work_item", { project_id: project.id, name: "Fix the footer" });
    const item = structured<WorkItemResult>(result);
    expect(item.key).toBe("WEB-1");
    expect(item.intake).toBeNull();
    const state = listStates(createTestContext(harness.handles), project.id).find((row) => row.id === item.state_id);
    expect(state?.is_default).toBe(true);
    expect(textOf(result)).not.toContain("Intake");
  });

  it("create_work_item from an agent lands in triage when agent_intake_required is on, and the text says so", async () => {
    const harness = await connect();
    const project = await createProject(harness, { intake_enabled: true, agent_intake_required: true });
    const result = await call(harness, "create_work_item", { project_id: project.id, name: "Agent idea" });
    const item = structured<WorkItemResult>(result);
    expect(item.intake).toEqual({ status: "pending" });
    const state = listStates(createTestContext(harness.handles), project.id).find((row) => row.id === item.state_id);
    expect(state?.state_group).toBe("triage");
    const text = textOf(result);
    expect(text).toContain(`${item.key} was created in Intake`);
    expect(text).toContain("pending");
    expect(JSON.parse(text.slice(text.indexOf("\n") + 1))).toMatchObject({ id: item.id });
  });

  it("a destructive tool without confirm fails with a helpful message and writes nothing", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const result = await call(harness, "delete_project", { project_id: project.id });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("confirm: true");
    expect(textOf(result)).toContain("tessera_delete_project");
    expect(listProjects(createTestContext(harness.handles), {})).toHaveLength(1);
    expect(harness.writes).not.toContain("delete_project");
  });

  it("a destructive tool with confirm: true runs and strips confirm before the registry", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const data = structured<{ id: string; deleted: boolean }>(await call(harness, "delete_project", { project_id: project.id, confirm: true }));
    expect(data).toEqual({ id: project.id, deleted: true });
    expect(listProjects(createTestContext(harness.handles), {})).toHaveLength(0);
    expect(harness.writes).toContain("delete_project");
  });

  it("confirm: false is not a confirmation", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const result = await call(harness, "delete_project", { project_id: project.id, confirm: false });
    expect(result.isError).toBe(true);
    expect(listProjects(createTestContext(harness.handles), {})).toHaveLength(1);
  });

  it("a TrackerError maps to isError with CODE: message", async () => {
    const harness = await connect();
    const missing = await call(harness, "get_project", { project_id: "00000000-0000-7000-8000-00000000ffff" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^NOT_FOUND: /);
    expect(missing.structuredContent).toBeUndefined();
    await createProject(harness);
    const duplicate = await call(harness, "create_project", { name: "Other", identifier: "WEB" });
    expect(duplicate.isError).toBe(true);
    expect(textOf(duplicate)).toMatch(/^CONFLICT: /);
  });

  it("arguments that fail the tool's schema fail in the SDK before the tool runs", async () => {
    const harness = await connect();
    const result = await call(harness, "create_project", { name: "Website" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("identifier");
    expect(listProjects(createTestContext(harness.handles), {})).toHaveLength(0);
    expect(harness.writes).toEqual([]);
  });

  it("afterWrite runs after successful mutating tools only", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    await call(harness, "list_projects");
    await call(harness, "get_project", { project_id: project.id });
    await call(harness, "create_project", { name: "Other", identifier: "WEB" });
    expect(harness.writes).toEqual(["create_project"]);
    await call(harness, "create_work_item", { project_id: project.id, name: "One" });
    expect(harness.writes).toEqual(["create_project", "create_work_item"]);
  });
});

describe("actors", () => {
  it("registers mcp:<client name> as an agent on first contact", async () => {
    const harness = await connect();
    await call(harness, "list_projects");
    const agent = listActors(createTestContext(harness.handles)).find((row) => row.name === `mcp:${CLIENT_NAME}`);
    expect(agent?.kind).toBe("agent");
    expect(agent?.client_name).toBe(`${CLIENT_NAME} ${CLIENT_VERSION}`);
    expect(agent?.last_seen_at).not.toBeNull();
  });

  it("writes over MCP are attributed to the client actor", async () => {
    const harness = await connect();
    const project = await createProject(harness);
    const item = structured<WorkItemResult>(await call(harness, "create_work_item", { project_id: project.id, name: "Mine" }));
    const ctx = createTestContext(harness.handles);
    const agent = listActors(ctx).find((row) => row.name === `mcp:${CLIENT_NAME}`);
    expect(item.created_by).toBe(agent?.id);
    expect(getWorkItem(ctx, item.id).created_by).toBe(agent?.id);
  });

  it("a reconnecting client reuses its actor row", async () => {
    const handles = createTestDb();
    try {
      const first = await connect({ handles });
      await call(first, "list_projects");
      await first.close();
      open.splice(open.indexOf(first), 1);
      const second = await connect({ handles });
      await call(second, "list_projects");
      await call(second, "list_projects");
      const agents = listActors(createTestContext(handles)).filter((row) => row.name === `mcp:${CLIENT_NAME}`);
      expect(agents).toHaveLength(1);
    } finally {
      handles.sqlite.close();
    }
  });

  it("falls back to mcp:<fallbackClientName> when the client sent no name", async () => {
    const harness = await connect({ clientName: "", fallbackClientName: "stdio" });
    await call(harness, "list_projects");
    const names = listActors(createTestContext(harness.handles)).map((row) => row.name);
    expect(names).toContain("mcp:stdio");
    expect(names).not.toContain("mcp:");
  });
});
