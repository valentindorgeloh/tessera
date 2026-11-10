/**
 * `loadSuperagentSetup` (src/lib/superagent/setup.ts, decision 155) over a seeded memory database, a temp token
 * file and a stubbed runner: the token file's existence and mode (never its content), one `GET /v1/state`, the
 * live mapped projects and the `mcp:superagent` actor. A runner failure is a state, never thrown. `server-only`
 * and the engine's server entry are mocked (the entry is the engine barrel with `readTessera` over the test
 * database); `fetch` is stubbed.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import type { TesseraContext } from "@/lib/tessera/core/context";
import { archiveProject, createProject } from "@/lib/tessera/projects";
import { setAgentSettings } from "@/lib/tessera/workspace";
import type { RunnerState } from "@/lib/superagent/types";
import { createTestContext, createTestDb } from "../helpers/db";
import { fixture, fixtureRunner, jsonResponse, stubFetch, TOKEN } from "./support";

const holder = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tessera/server", async () => {
  const engine = await import("@/lib/tessera");
  return { ...engine, readTessera: async <T>(fn: (ctx: TesseraContext) => T | Promise<T>) => fn(holder.ctx as TesseraContext) };
});

const { loadSuperagentSetup } = await import("@/lib/superagent/setup");

const RUNNER_URL = "http://127.0.0.1:3391";

let dir: string;
let tokenFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tessera-setup-"));
  tokenFile = path.join(dir, "api-token");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.stubEnv("TESSERA_AGENTS_TOKEN_FILE", tokenFile);
  await rm(tokenFile, { force: true });
  await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  await chmod(tokenFile, 0o600);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A memory database with a live project mapped to `web-repo`, and the superagent actor unless `superagent` is false. */
function setup(options: { superagent?: boolean; mapped?: boolean } = {}) {
  const ctx = createTestContext(createTestDb());
  holder.ctx = ctx;
  if (options.superagent !== false) registerActor(ctx, { kind: "agent", name: "mcp:superagent" });
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  if (options.mapped !== false) setAgentSettings(ctx, { runner_url: RUNNER_URL, projects: [{ project_id: web.id, repo: "web-repo" }] });
  else setAgentSettings(ctx, { runner_url: RUNNER_URL, projects: [] });
  return { ctx, web };
}

/** The fixture runner, recording its calls. */
function runner() {
  const stub = stubFetch(fixtureRunner);
  vi.stubGlobal("fetch", stub.fetch);
  return stub.calls;
}

describe("loadSuperagentSetup", () => {
  it("reads a healthy setup with one state call and never returns the token", async () => {
    const { web } = setup();
    const calls = runner();
    const load = await loadSuperagentSetup();
    expect(load.token).toEqual({ kind: "found", isPrivate: true });
    expect(load.state?.ok).toBe(true);
    expect(load.mappedProjects).toEqual([{ id: web.id, name: "Web", identifier: "WEB", repo: "web-repo" }]);
    expect(load.isConnected).toBe(true);
    expect(load.runnerUrl).toBe(RUNNER_URL);
    expect(load.tokenFile).toBe(tokenFile);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${RUNNER_URL}/v1/state`);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(load)).not.toContain(TOKEN);
  });

  it("reports a token file that other users can read, and still asks the runner", async () => {
    setup();
    await chmod(tokenFile, 0o644);
    const calls = runner();
    const load = await loadSuperagentSetup();
    expect(load.token).toEqual({ kind: "found", isPrivate: false });
    expect(calls).toHaveLength(1);
  });

  it("is missing, with no state and no request, when there is no token file", async () => {
    setup();
    await rm(tokenFile, { force: true });
    const calls = runner();
    const load = await loadSuperagentSetup();
    expect(load.token).toEqual({ kind: "missing" });
    expect(load.state).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.skipIf(process.getuid?.() === 0)("is unreadable, naming the error code, with no state and no request, when the file has no permissions", async () => {
    setup();
    await chmod(tokenFile, 0o000);
    try {
      const calls = runner();
      const load = await loadSuperagentSetup();
      expect(load.token).toEqual({ kind: "unreadable", message: "EACCES" });
      expect(load.state).toBeNull();
      expect(calls).toHaveLength(0);
    } finally {
      await chmod(tokenFile, 0o600);
    }
  });

  it("puts a runner that is down in state and keeps the token found", async () => {
    setup();
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const load = await loadSuperagentSetup();
    expect(load.state).toMatchObject({ ok: false, failure: { state: "unreachable" } });
    expect(load.token).toEqual({ kind: "found", isPrivate: true });
  });

  it("scrubs the token from a runner error that echoes it", async () => {
    setup();
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ error: { code: "UNAVAILABLE", message: `token ${TOKEN} leaked` } }, 500)).fetch);
    const load = await loadSuperagentSetup();
    expect(load.state?.ok).toBe(false);
    expect(JSON.stringify(load)).not.toContain(TOKEN);
  });

  it("accepts the real runner's state, with a null cursor and latestSeq", async () => {
    setup();
    const state = fixture<RunnerState>("state");
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ ...state, intake: { rewound: false, cursor: null, latestSeq: null } })).fetch);
    const load = await loadSuperagentSetup();
    expect(load.state?.ok).toBe(true);
  });

  it("has no mapped project and no connection on a fresh Tessera", async () => {
    setup({ superagent: false, mapped: false });
    runner();
    const load = await loadSuperagentSetup();
    expect(load.mappedProjects).toEqual([]);
    expect(load.isConnected).toBe(false);
  });

  it("leaves an archived mapped project out", async () => {
    const { ctx, web } = setup();
    archiveProject(ctx, web.id);
    runner();
    const load = await loadSuperagentSetup();
    expect(load.mappedProjects).toEqual([]);
  });
});
