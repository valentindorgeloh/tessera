/**
 * Superagent settings (decision 150): `workspace_settings.agents`, normalised on
 * read (`normalizeAgentSettings`), replaced only by the user through
 * `set_agent_settings` / `setAgentSettings`. The service refuses every other actor
 * with `RULE user_only` because Apply runs proposals as the assistant without
 * `assertToolAllowed`.
 */
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { applyProposals, createProposal } from "@/lib/tessera/ai/proposals";
import { ASSISTANT_ACTOR_ID, registerActor, SYSTEM_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, withActor, type TesseraContext } from "@/lib/tessera/core/context";
import { isTrackerError, type TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { archiveProject, createProject, deleteProject } from "@/lib/tessera/projects";
import { AGENT_RUNNER_DEFAULT_URL, AgentRepoSchema, AgentRunnerUrlSchema, AgentSettingsSchema } from "@/lib/tessera/schemas";
import { createMcpActorResolver, mcpToolName, registerTesseraTools } from "@/lib/tessera/tools/mcp";
import { runToolWithContext } from "@/lib/tessera/tools/registry";
import {
  agentRepoFor,
  getWorkspaceSettings,
  normalizeAgentSettings,
  setAgentSettings,
  SetAgentSettingsInput,
  updateWorkspaceSettings,
} from "@/lib/tessera/workspace";
import { createTestContext, createTestDb, type DbHandles } from "../helpers/db";

function thrown(fn: () => unknown): TrackerError | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (isTrackerError(err)) return err;
    throw err;
  }
}

async function thrownAsync(fn: () => Promise<unknown>): Promise<TrackerError | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (isTrackerError(err)) return err;
    throw err;
  }
}

function setup() {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  const api = createProject(ctx, { name: "Api", identifier: "API" });
  return { handles, ctx, web, api };
}

/** The stored column, before normalisation. */
function storedAgents(handles: DbHandles): unknown {
  const row = handles.sqlite.prepare("SELECT agents FROM workspace_settings WHERE id = 'workspace'").get() as { agents: string | null };
  return row.agents === null ? null : JSON.parse(row.agents);
}

const A = newId();
const B = newId();

describe("agent settings schemas", () => {
  it("AgentRunnerUrlSchema takes loopback http with a port and an optional trailing slash only", () => {
    for (const ok of ["http://127.0.0.1:3090", "http://localhost:3090", "http://localhost:3090/", "http://127.0.0.1:1", "http://localhost:65535"]) {
      expect(AgentRunnerUrlSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      "https://127.0.0.1:3090",
      "http://127.0.0.2:3090",
      "http://127.0.0.1",
      "http://127.0.0.1:",
      "http://localhost",
      "http://example.com:3090",
      "http://127.0.0.1:3090/path",
      "http://127.0.0.1:3090//",
      "http://127.0.0.1:123456",
      "http://user@127.0.0.1:3090",
      "http://127.0.0.1:3090@evil.example:80",
      "http://localhost.evil.example:3090",
      "http://[::1]:3090",
      "http://0.0.0.0:3090",
      " http://127.0.0.1:3090",
      "127.0.0.1:3090",
      "",
    ]) {
      expect(AgentRunnerUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("AgentRepoSchema takes name or owner/name from letters, digits, underscore, dot and hyphen, at most 140 characters", () => {
    for (const ok of ["tessera", "valentin/tessera", "a.b_c-d/E.F", "x".repeat(140)]) expect(AgentRepoSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "a/b/c", "owner/", "/name", "owner name", "owner/na me", "o@wner/name", "https://github.com/o/n", "x".repeat(141), "café/n"]) {
      expect(AgentRepoSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("AgentRunnerUrlSchema takes ports 1 to 65535 only", () => {
    for (const port of ["1", "80", "3090", "9999", "10000", "59999", "60000", "64999", "65000", "65499", "65500", "65529", "65530", "65535"]) {
      for (const host of ["127.0.0.1", "localhost"]) expect(AgentRunnerUrlSchema.safeParse(`http://${host}:${port}`).success, `${host}:${port}`).toBe(true);
    }
    expect(AgentRunnerUrlSchema.safeParse("http://localhost:65535/").success).toBe(true);
    for (const port of ["0", "00", "03090", "65536", "65540", "69999", "70000", "99999", "100000"]) {
      for (const host of ["127.0.0.1", "localhost"]) expect(AgentRunnerUrlSchema.safeParse(`http://${host}:${port}`).success, `${host}:${port}`).toBe(false);
    }
  });

  it("AgentRepoSchema keeps the repo inside one folder: no . or .. segment, no leading hyphen, owner not starting with . or -", () => {
    for (const ok of ["tessera", "owner/tessera", "owner/.github", "my_org/repo-1.2", "_x/_y", "9lives/n", "a/b...", "owner/a-b"]) {
      expect(AgentRepoSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [".", "..", "../..", "owner/..", "owner/.", "../name", "./name", "-rf", "owner/-x", "-owner/name", ".owner/name", "-", "owner/-"]) {
      expect(AgentRepoSchema.safeParse(bad).success, bad).toBe(false);
    }
    const refused = AgentRepoSchema.safeParse("..");
    expect(refused.success ? "" : refused.error.issues[0]?.message).toContain("owner/name");
  });

  it("AgentSettingsSchema allows at most 50 projects and describes every field", () => {
    const entry = (n: number) => ({ project_id: newId(), repo: `repo-${n}` });
    expect(AgentSettingsSchema.safeParse({ runner_url: AGENT_RUNNER_DEFAULT_URL, projects: Array.from({ length: 50 }, (_, n) => entry(n)) }).success).toBe(true);
    expect(AgentSettingsSchema.safeParse({ runner_url: AGENT_RUNNER_DEFAULT_URL, projects: Array.from({ length: 51 }, (_, n) => entry(n)) }).success).toBe(false);
    expect(AGENT_RUNNER_DEFAULT_URL).toBe("http://127.0.0.1:3090");
    for (const field of [AgentRunnerUrlSchema, AgentRepoSchema, AgentSettingsSchema.shape.projects]) {
      expect((field.description ?? "").length).toBeGreaterThan(10);
    }
  });
});

describe("normalizeAgentSettings", () => {
  it("keeps null and undefined as null (never set)", () => {
    expect(normalizeAgentSettings(null)).toBeNull();
    expect(normalizeAgentSettings(undefined)).toBeNull();
  });

  it("fills the default URL and an empty map for anything else that is not a settings object", () => {
    const empty = { runner_url: AGENT_RUNNER_DEFAULT_URL, projects: [] };
    expect(normalizeAgentSettings({})).toEqual(empty);
    expect(normalizeAgentSettings("nope")).toEqual(empty);
    expect(normalizeAgentSettings(7)).toEqual(empty);
    expect(normalizeAgentSettings([1, 2])).toEqual(empty);
    expect(normalizeAgentSettings({ projects: "nope" })).toEqual(empty);
  });

  it("returns a good value as stored, dropping a trailing slash from the URL", () => {
    const value = { runner_url: "http://localhost:4100", projects: [{ project_id: A, repo: "owner/name" }] };
    expect(normalizeAgentSettings(value)).toEqual(value);
    expect(normalizeAgentSettings({ ...value, runner_url: "http://localhost:4100/" })).toEqual(value);
  });

  it("replaces a bad URL with the default and keeps the projects", () => {
    for (const runner_url of ["https://127.0.0.1:3090", "http://127.0.0.2:3090", "http://127.0.0.1", "http://example.com:3090", 3090, null, undefined]) {
      expect(normalizeAgentSettings({ runner_url, projects: [{ project_id: A, repo: "r" }] }), String(runner_url)).toEqual({
        runner_url: AGENT_RUNNER_DEFAULT_URL,
        projects: [{ project_id: A, repo: "r" }],
      });
    }
  });

  it("drops a stored entry that the repo rules refuse, and a stored URL with a port out of range", () => {
    const result = normalizeAgentSettings({
      runner_url: "http://127.0.0.1:65536",
      projects: [
        { project_id: A, repo: ".." },
        { project_id: B, repo: "owner/.." },
        { project_id: newId(), repo: "-rf" },
        { project_id: newId(), repo: ".owner/name" },
        { project_id: newId(), repo: "owner/.github" },
      ],
    });
    expect(result?.runner_url).toBe(AGENT_RUNNER_DEFAULT_URL);
    expect(result?.projects.map((entry) => entry.repo)).toEqual(["owner/.github"]);
  });

  it("drops bad and repeated project entries and keeps the first of a repeat, in order", () => {
    const result = normalizeAgentSettings({
      runner_url: "http://127.0.0.1:3090",
      projects: [
        { project_id: A, repo: "first" },
        { project_id: "not-a-uuid", repo: "bad-id" },
        { project_id: B, repo: "bad repo" },
        { project_id: B, repo: "second" },
        { project_id: A, repo: "repeat" },
        { project_id: newId() },
        null,
        "text",
        { project_id: newId(), repo: "extra", branch: "main" },
      ],
    });
    expect(result?.projects).toEqual([
      { project_id: A, repo: "first" },
      { project_id: B, repo: "second" },
    ]);
  });
});

describe("agentRepoFor", () => {
  it("returns the mapped repo, or null for an unmapped project or no settings", () => {
    const agents = { runner_url: AGENT_RUNNER_DEFAULT_URL, projects: [{ project_id: A, repo: "owner/name" }] };
    expect(agentRepoFor(agents, A)).toBe("owner/name");
    expect(agentRepoFor(agents, B)).toBeNull();
    expect(agentRepoFor({ runner_url: AGENT_RUNNER_DEFAULT_URL, projects: [] }, A)).toBeNull();
    expect(agentRepoFor(null, A)).toBeNull();
  });
});

describe("setAgentSettings", () => {
  it("a fresh database has agents null, stored null, and get_workspace_settings returns null", async () => {
    const { handles, ctx } = setup();
    expect(getWorkspaceSettings(ctx).agents).toBeNull();
    expect(storedAgents(handles)).toBeNull();
    const result = await runToolWithContext(ctx, "get_workspace_settings", {});
    expect(result.data.agents).toBeNull();
  });

  it("sets the map, defaults the URL when none is stored, and reads back through get_workspace_settings", async () => {
    const { ctx, web, api } = setup();
    const view = setAgentSettings(ctx, {
      projects: [
        { project_id: web.id, repo: "valentin/web" },
        { project_id: api.id, repo: "api" },
      ],
    });
    const expected = {
      runner_url: AGENT_RUNNER_DEFAULT_URL,
      projects: [
        { project_id: web.id, repo: "valentin/web" },
        { project_id: api.id, repo: "api" },
      ],
    };
    expect(view.agents).toEqual(expected);
    expect((await runToolWithContext(ctx, "get_workspace_settings", {})).data.agents).toEqual(expected);
    expect(getWorkspaceSettings(ctx).agents).toEqual(expected);
    expect(agentRepoFor(view.agents, web.id)).toBe("valentin/web");
  });

  it("runs as the set_agent_settings tool and returns the whole workspace view", async () => {
    const { ctx, web } = setup();
    const result = await runToolWithContext(ctx, "set_agent_settings", { runner_url: "http://localhost:4100/", projects: [{ project_id: web.id, repo: "web" }] });
    expect(result.data.agents).toEqual({ runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
    expect(result.data.name).toBe("Tessera");
    expect(result.data.home_widgets.length).toBeGreaterThan(0);
  });

  it("stores the URL without its trailing slash", () => {
    const { handles, ctx } = setup();
    setAgentSettings(ctx, { runner_url: "http://127.0.0.1:3091/", projects: [] });
    expect(storedAgents(handles)).toEqual({ runner_url: "http://127.0.0.1:3091", projects: [] });
  });

  it("keeps the stored URL when the input omits it, and replaces it when given", () => {
    const { ctx, web, api } = setup();
    setAgentSettings(ctx, { runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
    const kept = setAgentSettings(ctx, { projects: [{ project_id: api.id, repo: "api" }] });
    expect(kept.agents).toEqual({ runner_url: "http://localhost:4100", projects: [{ project_id: api.id, repo: "api" }] });
    const changed = setAgentSettings(ctx, { runner_url: "http://127.0.0.1:5000", projects: [{ project_id: api.id, repo: "api" }] });
    expect(changed.agents?.runner_url).toBe("http://127.0.0.1:5000");
  });

  it("[] clears the map but keeps the settings (and the URL) set", () => {
    const { ctx, web } = setup();
    setAgentSettings(ctx, { runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
    const cleared = setAgentSettings(ctx, { projects: [] });
    expect(cleared.agents).toEqual({ runner_url: "http://localhost:4100", projects: [] });
  });

  it("replaces the whole map, not merges into it", () => {
    const { ctx, web, api } = setup();
    setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "web" }] });
    const next = setAgentSettings(ctx, { projects: [{ project_id: api.id, repo: "api" }] });
    expect(next.agents?.projects).toEqual([{ project_id: api.id, repo: "api" }]);
  });

  it("writes no activity row and leaves the change cursor alone, but moves updated_at", () => {
    const { handles, web } = setup();
    let now = "2026-11-09T10:00:00.000Z";
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => now });
    const before = latestSeq(ctx);
    const touched = () => (handles.sqlite.prepare("SELECT updated_at FROM workspace_settings").get() as { updated_at: string }).updated_at;
    getWorkspaceSettings(ctx);
    now = "2026-11-09T11:30:00.000Z";
    setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "web" }] });
    expect(latestSeq(ctx)).toBe(before);
    expect(touched()).toBe("2026-11-09T11:30:00.000Z");
  });

  it("refuses non-loopback, https, 127.0.0.2, portless and path URLs with VALIDATION and stores nothing", () => {
    const { handles, ctx } = setup();
    for (const runner_url of [
      "http://example.com:3090",
      "https://127.0.0.1:3090",
      "http://127.0.0.2:3090",
      "http://127.0.0.1",
      "http://localhost",
      "http://127.0.0.1:3090/api",
      "http://127.0.0.1:1234567",
      "",
    ]) {
      expect(thrown(() => setAgentSettings(ctx, { runner_url, projects: [] }))?.code, runner_url).toBe("VALIDATION");
    }
    expect(storedAgents(handles)).toBeNull();
  });

  it("refuses a bad repo, an extra key, a missing map and more than 50 projects with VALIDATION", () => {
    const { ctx, web } = setup();
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "a/b/c" }] }))?.code).toBe("VALIDATION");
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "https://github.com/o/n" }] }))?.code).toBe("VALIDATION");
    for (const repo of [".", "..", "owner/..", "-rf"]) expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: web.id, repo }] }))?.code, repo).toBe("VALIDATION");
    for (const runner_url of ["http://127.0.0.1:0", "http://localhost:65536"]) expect(thrown(() => setAgentSettings(ctx, { runner_url, projects: [] }))?.code, runner_url).toBe("VALIDATION");
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "web", branch: "main" } as never] }))?.code).toBe("VALIDATION");
    expect(thrown(() => setAgentSettings(ctx, { projects: [], token: "secret" } as never))?.code).toBe("VALIDATION");
    expect(thrown(() => setAgentSettings(ctx, {} as never))?.code).toBe("VALIDATION");
    const many = Array.from({ length: 51 }, (_, n) => ({ project_id: newId(), repo: `r${n}` }));
    expect(thrown(() => setAgentSettings(ctx, { projects: many }))?.code).toBe("VALIDATION");
  });

  it("an unknown or deleted project is NOT_FOUND and nothing is stored", () => {
    const { handles, ctx, web, api } = setup();
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "web" }, { project_id: newId(), repo: "ghost" }] }))?.code).toBe("NOT_FOUND");
    expect(storedAgents(handles)).toBeNull();
    deleteProject(ctx, api.id);
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: api.id, repo: "api" }] }))?.code).toBe("NOT_FOUND");
    expect(storedAgents(handles)).toBeNull();
  });

  it("an archived project may be mapped", () => {
    const { ctx, web } = setup();
    archiveProject(ctx, web.id);
    expect(setAgentSettings(ctx, { projects: [{ project_id: web.id, repo: "web" }] }).agents?.projects).toHaveLength(1);
  });

  it("a repeated project is VALIDATION, before any project lookup", () => {
    const { handles, ctx, web } = setup();
    const err = thrown(() =>
      setAgentSettings(ctx, {
        projects: [
          { project_id: web.id, repo: "one" },
          { project_id: web.id, repo: "two" },
        ],
      }),
    );
    expect(err?.code).toBe("VALIDATION");
    expect(err?.message).toBe("A project can be mapped once");
    expect(storedAgents(handles)).toBeNull();
    // The check is on the ids as given, so it also fires for ids that do not exist.
    const ghost = newId();
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: ghost, repo: "a" }, { project_id: ghost, repo: "b" }] }))?.code).toBe("VALIDATION");
  });

  it("a failed call keeps the settings stored before", () => {
    const { ctx, web } = setup();
    setAgentSettings(ctx, { runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
    expect(thrown(() => setAgentSettings(ctx, { projects: [{ project_id: newId(), repo: "ghost" }] }))?.code).toBe("NOT_FOUND");
    expect(getWorkspaceSettings(ctx).agents).toEqual({ runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
  });

  it("reads normalise a damaged stored value the way home_widgets do", () => {
    const { handles, ctx, web } = setup();
    handles.sqlite
      .prepare("UPDATE workspace_settings SET agents = ?")
      .run(JSON.stringify({ runner_url: "http://evil.example:80", projects: [{ project_id: web.id, repo: "web" }, { project_id: web.id, repo: "again" }, { project_id: "x", repo: "y" }] }));
    expect(getWorkspaceSettings(ctx).agents).toEqual({ runner_url: AGENT_RUNNER_DEFAULT_URL, projects: [{ project_id: web.id, repo: "web" }] });
  });

  it("update_workspace_settings does not take agents and leaves them alone", async () => {
    const { ctx, web } = setup();
    setAgentSettings(ctx, { runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
    expect(thrown(() => updateWorkspaceSettings(ctx, { agents: { runner_url: "http://localhost:1", projects: [] } } as never))?.code).toBe("VALIDATION");
    const updated = updateWorkspaceSettings(ctx, { name: "Studio" });
    expect(updated.name).toBe("Studio");
    expect(updated.agents).toEqual({ runner_url: "http://localhost:4100", projects: [{ project_id: web.id, repo: "web" }] });
  });

  it("SetAgentSettingsInput is strict and its URL is optional", () => {
    expect(SetAgentSettingsInput.safeParse({ projects: [] }).success).toBe(true);
    expect(SetAgentSettingsInput.safeParse({ projects: [], extra: 1 }).success).toBe(false);
    expect(SetAgentSettingsInput.safeParse({ runner_url: "http://localhost:3090" }).success).toBe(false);
  });
});

describe("only the user may set agent settings (RULE user_only)", () => {
  /** Every refusal leaves the stored settings as the user set them. */
  function arrange() {
    const fixture = setup();
    setAgentSettings(fixture.ctx, { runner_url: "http://localhost:4100", projects: [{ project_id: fixture.web.id, repo: "web" }] });
    const keep = { runner_url: "http://localhost:4100", projects: [{ project_id: fixture.web.id, repo: "web" }] };
    return { ...fixture, keep };
  }

  it("an agent through runToolWithContext", async () => {
    const { ctx, handles, web, keep } = arrange();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:rogue" });
    const agentCtx = withActor(ctx, agent.id);
    const err = await thrownAsync(() => runToolWithContext(agentCtx, "set_agent_settings", { projects: [{ project_id: web.id, repo: "stolen" }] }));
    expect(err?.code).toBe("RULE");
    expect(err?.details).toEqual({ rule: "user_only" });
    expect(storedAgents(handles)).toEqual(keep);
  });

  it("every non-user actor through the service, even with an invalid input (the user check comes first)", () => {
    const { ctx, handles, web, keep } = arrange();
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:direct" });
    for (const actorId of [agent.id, ASSISTANT_ACTOR_ID, SYSTEM_ACTOR_ID]) {
      const other: TesseraContext = withActor(ctx, actorId);
      const valid = thrown(() => setAgentSettings(other, { projects: [{ project_id: web.id, repo: "stolen" }] }));
      expect(valid?.code, actorId).toBe("RULE");
      expect(valid?.details, actorId).toEqual({ rule: "user_only" });
      expect(valid?.message).toContain("superagent");
      const invalid = thrown(() => setAgentSettings(other, { runner_url: "https://evil.example", projects: "nope" } as never));
      expect(invalid?.code, actorId).toBe("RULE");
    }
    expect(storedAgents(handles)).toEqual(keep);
  });

  it("the assistant through applyProposals: the proposal fails with RULE and nothing changes", () => {
    const { ctx, handles, web, keep } = arrange();
    const proposal = createProposal(ctx, {
      conversation_id: "11111111-1111-4111-8111-111111111111",
      source: "assistant",
      tool: "set_agent_settings",
      input: { projects: [{ project_id: web.id, repo: "assistant-pick" }] },
    });
    expect(proposal.status).toBe("pending");
    const [outcome] = applyProposals(handles, { ids: [proposal.id] });
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error?.code).toBe("RULE");
    expect(outcome?.error?.message).toContain("superagent settings");
    expect(storedAgents(handles)).toEqual(keep);
  });

  describe("an MCP client through the in-memory adapter", () => {
    const open: { close(): Promise<void> }[] = [];
    afterEach(async () => {
      for (const entry of open.splice(0)) await entry.close();
    });

    async function connect(handles: DbHandles, name: string): Promise<Client> {
      const server = new McpServer({ name: "tessera-test", version: "0.0.0" });
      registerTesseraTools(server, { handles, actorResolver: createMcpActorResolver(handles) });
      const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
      await server.connect(serverEnd);
      const client = new Client({ name, version: "1.0.0" });
      await client.connect(clientEnd);
      open.push({
        close: async () => {
          await client.close();
          await server.close();
        },
      });
      return client;
    }

    function text(result: CallToolResult): string {
      const block = result.content[0];
      if (!block || block.type !== "text") throw new Error("expected a text content block");
      return block.text;
    }

    it("gets RULE user_only and can still read the settings", async () => {
      const { handles, web, keep } = arrange();
      const client = await connect(handles, "superagent");
      const refused = (await client.callTool({
        name: mcpToolName("set_agent_settings"),
        arguments: { projects: [{ project_id: web.id, repo: "from-mcp" }] },
      })) as CallToolResult;
      expect(refused.isError).toBe(true);
      expect(text(refused)).toMatch(/^RULE: /);
      expect(storedAgents(handles)).toEqual(keep);

      const read = (await client.callTool({ name: mcpToolName("get_workspace_settings"), arguments: {} })) as CallToolResult;
      expect(read.isError).toBeFalsy();
      expect((read.structuredContent as { agents: unknown }).agents).toEqual(keep);
    });

    it("lists set_agent_settings and no tool that names the superagent or the runner", async () => {
      const { handles } = arrange();
      const client = await connect(handles, "lister");
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain(mcpToolName("set_agent_settings"));
      expect(names.filter((name) => /superagent|runner/.test(name))).toEqual([]);
    });
  });
});
