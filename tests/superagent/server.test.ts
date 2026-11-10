/**
 * `withRunner` and `loadSuperagent` (src/lib/superagent/server.ts): the token file is read on every call, the
 * runner URL comes from the workspace settings (decision 151), and a missing or unreadable token never makes a
 * request. `server-only` and the engine's server entry are mocked; `fetch` is stubbed; token files are temp files.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_RUNNER_DEFAULT_URL } from "@/lib/tessera/schemas";
import { fixture, fixtureRunner, jsonResponse, stubFetch, TOKEN } from "./support";

const engine = vi.hoisted(() => ({ agents: null as { runner_url: string; projects: unknown[] } | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tessera/server", () => ({
  readTessera: async <T>(fn: (ctx: unknown) => T | Promise<T>) => fn({}),
  getWorkspaceSettings: () => ({ agents: engine.agents }),
}));

const { loadSuperagent, withRunner } = await import("@/lib/superagent/server");

let dir: string;
let tokenFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tessera-server-"));
  tokenFile = path.join(dir, "api-token");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  engine.agents = null;
  vi.stubEnv("TESSERA_AGENTS_TOKEN_FILE", tokenFile);
  await writeFile(tokenFile, `${TOKEN}\n`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(tokenFile, { recursive: true, force: true });
});

function runner(answer = fixtureRunner) {
  const stub = stubFetch(answer);
  vi.stubGlobal("fetch", stub.fetch);
  return stub.calls;
}

describe("withRunner", () => {
  it("calls the default runner URL with the token from the file", async () => {
    const calls = runner();
    const result = await withRunner((client) => client.getState());
    expect(result).toMatchObject({ ok: true, data: { paused: false } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${AGENT_RUNNER_DEFAULT_URL}/v1/state`);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers.get("x-agents-request")).toBe("1");
  });

  it("uses the runner URL of the workspace's agent settings", async () => {
    engine.agents = { runner_url: "http://localhost:3391", projects: [] };
    const calls = runner();
    await withRunner((client) => client.getStats());
    expect(calls[0].url).toBe("http://localhost:3391/v1/stats");
  });

  it("reads the token file on every call", async () => {
    const calls = runner();
    await withRunner((client) => client.getState());
    await writeFile(tokenFile, "tok-rotated");
    await withRunner((client) => client.getState());
    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([`Bearer ${TOKEN}`, "Bearer tok-rotated"]);
  });

  it("is not_set_up, with no request, when the token file is missing, empty or blank", async () => {
    const calls = runner();
    for (const content of [null, "", "  \n"]) {
      if (content === null) await rm(tokenFile, { force: true });
      else await writeFile(tokenFile, content);
      const result = await withRunner((client) => client.getState());
      expect(result).toEqual({ ok: false, failure: { state: "not_set_up", message: "No runner token file", status: null, code: null } });
    }
    expect(calls).toHaveLength(0);
  });

  it("is token_unreadable, with no request, when the file cannot be read", async () => {
    const calls = runner();
    // A directory where the file should be: EISDIR for every user, root included.
    await rm(tokenFile, { force: true });
    await mkdir(tokenFile);
    const result = await withRunner((client) => client.getState());
    expect(result).toEqual({ ok: false, failure: { state: "token_unreadable", message: "EISDIR", status: null, code: null } });
    expect(calls).toHaveLength(0);
  });

  it("returns the runner's failure as a value", async () => {
    runner(() => jsonResponse({ error: { code: "UNAUTHORIZED", message: "Wrong token" } }, 401));
    const result = await withRunner((client) => client.getState());
    expect(result).toEqual({ ok: false, failure: { state: "unauthorized", message: "Wrong token", status: 401, code: "UNAUTHORIZED" } });
  });
});

describe("loadSuperagent", () => {
  it("reads state, requests, triage, stats, settings and prompts, and no request detail without an id", async () => {
    const calls = runner();
    const load = await loadSuperagent({ scope: "open" });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}${new URL(call.url).search}`).sort()).toEqual([
      "GET /v1/prompts",
      "GET /v1/requests?scope=open",
      "GET /v1/settings",
      "GET /v1/state",
      "GET /v1/stats",
      "GET /v1/triage",
    ]);
    expect(load.runnerUrl).toBe(AGENT_RUNNER_DEFAULT_URL);
    expect(load.tokenFile).toBe(tokenFile);
    expect(load.request).toBeNull();
    expect(load.state).toMatchObject({ ok: true, data: { health: { status: "degraded" } } });
    expect(load.requests.ok && load.requests.data).toHaveLength(fixture<{ requests: unknown[] }>("requests").requests.length);
    expect(load.triage.ok && load.triage.data).toHaveLength(2);
    expect(load.stats).toMatchObject({ ok: true });
    expect(load.settings).toMatchObject({ ok: true, data: { revision: 4 } });
    expect(load.prompts).toMatchObject({ ok: true, data: { revision: 7 } });
  });

  it("also reads the selected request, and passes the scope on", async () => {
    engine.agents = { runner_url: "http://127.0.0.1:3391", projects: [] };
    const calls = runner();
    const load = await loadSuperagent({ scope: "recent", requestId: "rq_question" });
    expect(calls).toHaveLength(7);
    expect(calls.some((call) => call.url === "http://127.0.0.1:3391/v1/requests?scope=recent")).toBe(true);
    expect(calls.some((call) => call.url === "http://127.0.0.1:3391/v1/requests/rq_question")).toBe(true);
    expect(load.runnerUrl).toBe("http://127.0.0.1:3391");
    expect(load.request).toMatchObject({ ok: true, data: { question: expect.any(String) } });
    expect((await loadSuperagent({ scope: "all", requestId: null })).request).toBeNull();
  });

  it("fails each part on its own: a bad answer for one does not touch the others", async () => {
    runner((call) => (call.url.endsWith("/v1/stats") ? jsonResponse({ nope: true }) : fixtureRunner(call)));
    const load = await loadSuperagent({ scope: "open" });
    expect(load.stats).toMatchObject({ ok: false, failure: { state: "bad_response" } });
    expect(load.state.ok && load.requests.ok && load.triage.ok && load.settings.ok && load.prompts.ok).toBe(true);
  });

  it("is not_set_up in every part, with no request, but still names the URL and the token file", async () => {
    const calls = runner();
    await rm(tokenFile, { force: true });
    const load = await loadSuperagent({ scope: "open", requestId: "rq_question" });
    expect(calls).toHaveLength(0);
    expect(load.runnerUrl).toBe(AGENT_RUNNER_DEFAULT_URL);
    expect(load.tokenFile).toBe(tokenFile);
    for (const part of [load.state, load.requests, load.triage, load.stats, load.settings, load.prompts, load.request]) {
      expect(part).toMatchObject({ ok: false, failure: { state: "not_set_up" } });
    }
  });

  it("returns plain data that survives serialisation (it is passed to a client component as props)", async () => {
    runner();
    const load = await loadSuperagent({ scope: "open", requestId: "rq_question" });
    expect(JSON.parse(JSON.stringify(load))).toEqual(load);
    expect(JSON.stringify(load)).not.toContain(TOKEN);
  });
});
