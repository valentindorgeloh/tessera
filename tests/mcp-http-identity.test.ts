/**
 * HTTP identity contract (decision 151): the real `/api/mcp` route, driven by
 * `@modelcontextprotocol/client` 2.3.1 over Streamable HTTP with the client
 * name `superagent`, writes as the agent `mcp:superagent`. The route is
 * stateless (a fresh McpServer per request), so the client must pin protocol
 * revision 2026-07-28: only that era sends the client info in every request's
 * `_meta`. A client left on the default legacy era identifies itself only in
 * `initialize`, and its tool calls land as `mcp:unknown` (second case).
 * `@/lib/tessera/server` is replaced by the engine barrel plus a `getDb` over
 * the test database, and `next/cache` by a no-op `revalidatePath` (no Next
 * request store under Vitest). The route keeps one actor resolver per process,
 * so each test imports a fresh copy of it over its own database.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listActors } from "@/lib/tessera/actors";
import { listComments } from "@/lib/tessera/comments";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles } from "./helpers/db";

const db: { handles: DbHandles | null } = { handles: null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/tessera/server", async () => {
  const engine = await vi.importActual<typeof import("@/lib/tessera")>("@/lib/tessera");
  return {
    ...engine,
    getDb: () => {
      if (db.handles === null) throw new Error("test database not open");
      return db.handles;
    },
  };
});

type Route = typeof import("@/app/api/mcp/route");

const ENDPOINT = "http://127.0.0.1:3000/api/mcp";

/** The revision the superagent pins; the runner's MCP client must use the same. */
const MODERN_REVISION = "2026-07-28";

/** Every transport request goes straight into the route handler, as Next would route it. */
async function routeFetch(route: Route, input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  switch (request.method.toUpperCase()) {
    case "POST":
      return route.POST(request);
    case "GET":
      return route.GET(request);
    case "DELETE":
      return route.DELETE(request);
    default:
      return new Response(null, { status: 405 });
  }
}

let handles: DbHandles;
let route: Route;
const clients: Client[] = [];

beforeEach(async () => {
  handles = createTestDb();
  db.handles = handles;
  vi.resetModules();
  route = await import("@/app/api/mcp/route");
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  handles.sqlite.close();
  db.handles = null;
});

async function connect(name: string, era: "pinned" | "legacy"): Promise<Client> {
  const options = era === "pinned" ? { versionNegotiation: { mode: { pin: MODERN_REVISION } } } : {};
  const client = new Client({ name, version: "1.0.0" }, options);
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { fetch: (input, init) => routeFetch(route, input, init) }));
  clients.push(client);
  return client;
}

function seedItem() {
  const user = createTestContext(handles);
  const project = createProject(user, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(user, { project_id: project.id, name: "Login" });
  return { user, item };
}

describe("POST /api/mcp identity", () => {
  it("writes as mcp:superagent and never registers mcp:unknown", async () => {
    const { user, item } = seedItem();
    const client = await connect("superagent", "pinned");
    const listed = await client.callTool({ name: "tessera_list_projects", arguments: {} });
    expect(listed.isError).toBeFalsy();
    const created = await client.callTool({ name: "tessera_create_comment", arguments: { work_item_id: item.id, body_md: "On it" } });
    expect(created.isError).toBeFalsy();

    const actors = listActors(user);
    expect(actors.map((actor) => actor.name)).toContain("mcp:superagent");
    expect(actors.map((actor) => actor.name)).not.toContain("mcp:unknown");
    const superagent = actors.find((actor) => actor.name === "mcp:superagent");
    expect(superagent?.kind).toBe("agent");
    const [comment] = listComments(user, item.id);
    expect(comment.actor_id).toBe(superagent?.id);
    expect(comment.actor_name).toBe("mcp:superagent");
  });

  it("loses the name on the legacy era, which is why the superagent pins the revision", async () => {
    const { user, item } = seedItem();
    const client = await connect("superagent", "legacy");
    await client.callTool({ name: "tessera_create_comment", arguments: { work_item_id: item.id, body_md: "Who am I" } });
    const names = listActors(user).map((actor) => actor.name);
    expect(names).toContain("mcp:unknown");
    expect(names).not.toContain("mcp:superagent");
  });
});
