/**
 * The fake runner (scripts/superagent-stub.ts) end to end: the real client against a real `node:http` server on
 * an ephemeral loopback port. Proves the stub applies the v1 auth rules and serves what the client parses, so a
 * fixture or a client change that drifts from the other fails here, not in the browser.
 */
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createStubServer, parseBind, type StubOptions } from "../../scripts/superagent-stub";
import { createRunnerClient, type RunnerClient } from "@/lib/superagent/client";
import type { RunnerResult } from "@/lib/superagent/types";
import { TOKEN } from "./support";

const servers: Server[] = [];

async function start(options: Partial<StubOptions> = {}): Promise<{ port: number; client: RunnerClient }> {
  const server = createStubServer({ token: TOKEN, ...options });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, client: createRunnerClient({ baseUrl: `http://127.0.0.1:${port}`, token: TOKEN }) };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A raw request, for the headers `fetch` will not send (Origin, a foreign Host). */
function raw(port: number, headers: Record<string, string>, path = "/v1/state", method = "GET"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function okData<T>(result: RunnerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.failure.state}: ${result.failure.message}`);
  return result.data;
}

const AUTH = { authorization: `Bearer ${TOKEN}`, "x-agents-request": "1" };

describe("auth rules", () => {
  it("answers 200 with the token, the request header and no Origin", async () => {
    const { port } = await start();
    expect((await raw(port, AUTH)).status).toBe(200);
  });

  it("answers 401 without a token or with a wrong one", async () => {
    const { port } = await start();
    expect((await raw(port, { "x-agents-request": "1" })).status).toBe(401);
    expect((await raw(port, { "x-agents-request": "1", authorization: "Bearer nope" })).status).toBe(401);
    const body = JSON.parse((await raw(port, { "x-agents-request": "1" })).body);
    expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it("answers 403 for an Origin header, a foreign Host or a missing x-agents-request", async () => {
    const { port } = await start();
    expect((await raw(port, { ...AUTH, origin: "http://evil.example" })).status).toBe(403);
    expect((await raw(port, { ...AUTH, host: "evil.example:3090" })).status).toBe(403);
    expect((await raw(port, { authorization: `Bearer ${TOKEN}` })).status).toBe(403);
    expect((await raw(port, { ...AUTH, host: `localhost:${port}` })).status).toBe(200);
  });

  it("answers 404 for an unknown route and 400 for a bad scope or body", async () => {
    const { port, client } = await start();
    expect((await raw(port, AUTH, "/v2/state")).status).toBe(404);
    expect((await raw(port, AUTH, "/v1/requests?scope=never")).status).toBe(400);
    expect((await raw(port, AUTH, "/v1/pause", "POST")).status).toBe(400);
    expect(await client.getRequest("rq_nope")).toMatchObject({ ok: false, failure: { state: "not_found", status: 404 } });
  });

  it("is a wrong token for the client too", async () => {
    const { port } = await start();
    const stranger = createRunnerClient({ baseUrl: `http://127.0.0.1:${port}`, token: "tok-other" });
    expect(await stranger.getState()).toMatchObject({ ok: false, failure: { state: "unauthorized", status: 401, code: "UNAUTHORIZED" } });
  });
});

describe("reads", () => {
  it("serves state, stats, triage, settings and prompts that the client parses", async () => {
    const { client } = await start();
    expect(okData(await client.getState())).toMatchObject({ paused: false, counts: { needsYou: 7, working: 1, queued: 1 } });
    expect(okData(await client.getStats()).bySize).toHaveLength(3);
    expect(okData(await client.listTriage()).map((row) => row.status)).toEqual(["unavailable", "queued"]);
    expect(okData(await client.getSettings()).revision).toBe(4);
    expect(okData(await client.getPrompts()).teamSections.length).toBeGreaterThan(1);
  });

  it("filters requests by scope", async () => {
    const { client } = await start();
    const open = okData(await client.listRequests("open"));
    const recent = okData(await client.listRequests("recent"));
    const all = okData(await client.listRequests("all"));
    expect(open.some((entry) => ["done", "dropped", "stopped"].includes(entry.stage.kind))).toBe(false);
    expect(recent.length).toBeGreaterThan(open.length);
    expect(all.length).toBe(13);
  });

  it("serves the detail with its sessions and events, and a plain one for the other requests", async () => {
    const { client } = await start();
    const detail = okData(await client.getRequest("rq_question"));
    expect(detail.sessions.length).toBeGreaterThan(1);
    expect(detail.question).not.toBeNull();
    const plain = okData(await client.getRequest("rq_working"));
    expect(plain.sessions).toEqual([]);
    expect(plain.events).toHaveLength(1);
  });

  it("with --rewound reports the cursor past Tessera's newest change", async () => {
    const { client } = await start({ rewound: true });
    const { intake } = okData(await client.getState());
    expect(intake.rewound).toBe(true);
    expect(intake.latestSeq).toBeLessThan(intake.cursor);
  });
});

describe("actions", () => {
  it("approve and lift hold move a request to working, retry to queued, stop to stopped", async () => {
    const { client } = await start();
    const approved = okData(await client.requestAction("rq_signoff", "approve"));
    expect(approved.stage.kind).toBe("working");
    expect(approved.actions).toEqual(["stop"]);
    expect(okData(await client.requestAction("rq_hold", "lift_hold")).stage.kind).toBe("working");
    expect(okData(await client.requestAction("rq_failed", "retry")).stage.kind).toBe("queued");
    const stopped = okData(await client.requestAction("rq_working", "stop"));
    expect(stopped).toMatchObject({ stage: { kind: "stopped" }, actions: [] });
    // The next read sees the change, and the counts follow.
    expect(okData(await client.getRequest("rq_signoff")).stage.kind).toBe("working");
    expect(okData(await client.getState()).counts).toEqual({ needsYou: 4, working: 2, queued: 2 });
  });

  it("refuses an action the stage does not list, as a conflict", async () => {
    const { client } = await start();
    expect(await client.requestAction("rq_working", "approve")).toMatchObject({ ok: false, failure: { state: "conflict", status: 409 } });
    expect(await client.requestAction("rq_done", "stop")).toMatchObject({ ok: false, failure: { state: "conflict" } });
    expect(await client.resize("rq_working", "L")).toMatchObject({ ok: false, failure: { state: "conflict" } });
  });

  it("resize and budget change the request in place", async () => {
    const { client } = await start();
    expect(okData(await client.resize("rq_blocked", "M")).size).toBe("M");
    const budgeted = okData(await client.setBudget("rq_blocked", 20));
    expect(budgeted.budgetUsd).toBe(20);
    expect(okData(await client.getRequest("rq_blocked"))).toMatchObject({ size: "M", budgetUsd: 20 });
  });

  it("pause toggles the state with a manual reason", async () => {
    const { client } = await start();
    expect(okData(await client.setPaused(true))).toEqual({ paused: true });
    expect(okData(await client.getState())).toMatchObject({ paused: true, pauseReason: "manual" });
    await client.setPaused(false);
    expect(okData(await client.getState())).toMatchObject({ paused: false, pauseReason: null });
  });

  it("triage retry queues the row and counts the attempt", async () => {
    const { client } = await start();
    const row = okData(await client.retryTriage("tri_unavailable"));
    expect(row).toMatchObject({ status: "queued", attempts: 4 });
    expect(await client.retryTriage("tri_nope")).toMatchObject({ ok: false, failure: { state: "not_found" } });
  });
});

describe("settings and prompts", () => {
  it("saves with the current revision and moves it on by one", async () => {
    const { client } = await start();
    const loaded = okData(await client.getSettings());
    const saved = okData(await client.putSettings({ ...loaded.settings, dailyCapUsd: 30 }, loaded.revision));
    expect(saved).toMatchObject({ revision: 5, settings: { dailyCapUsd: 30 } });
    expect(okData(await client.getSettings())).toEqual(saved);
    const prompts = okData(await client.getPrompts());
    const savedPrompts = okData(await client.putPrompts([{ repo: "tessera", section: "scope", text: "New." }], prompts.revision));
    expect(savedPrompts).toEqual({ teamSections: [{ repo: "tessera", section: "scope", text: "New." }], revision: 8 });
  });

  it("answers a stale baseRevision with a conflict and leaves the data alone", async () => {
    const { client } = await start();
    const loaded = okData(await client.getSettings());
    const stale = await client.putSettings({ ...loaded.settings, dailyCapUsd: 99 }, 1);
    expect(stale).toMatchObject({ ok: false, failure: { state: "conflict", status: 409, code: "CONFLICT" } });
    expect(okData(await client.getSettings())).toEqual(loaded);
    expect(await client.putPrompts([], "old")).toMatchObject({ ok: false, failure: { state: "conflict" } });
  });

  it("with --conflict refuses every PUT and moves the stored revision on", async () => {
    const { client } = await start({ conflict: true });
    const loaded = okData(await client.getSettings());
    const first = await client.putSettings(loaded.settings, loaded.revision);
    expect(first).toMatchObject({ ok: false, failure: { state: "conflict" } });
    const reloaded = okData(await client.getSettings());
    expect(reloaded.revision).toBe(5);
    expect(await client.putSettings(reloaded.settings, reloaded.revision)).toMatchObject({ ok: false, failure: { state: "conflict" } });
    const prompts = okData(await client.getPrompts());
    expect(await client.putPrompts(prompts.teamSections, prompts.revision)).toMatchObject({ ok: false, failure: { state: "conflict" } });
  });
});

describe("--bind", () => {
  const WORK_ITEM = "0192f6a8-1000-7000-8000-0000000000aa";
  const PROJECT = "0192f6a8-0000-7000-8000-0000000000bb";
  const bind = parseBind(`rq_question=${WORK_ITEM},WEB-7,${PROJECT}`);

  it("parses requestId=workItemId,itemKey,projectId and refuses anything else", () => {
    expect(bind).toEqual({ requestId: "rq_question", workItemId: WORK_ITEM, itemKey: "WEB-7", projectId: PROJECT });
    for (const bad of ["", "rq_question", "rq_question=a,b", "rq_question=a,b,", "=a,b,c", "rq=a,b,c,d", "rq=a,b,c=d"]) {
      expect(() => parseBind(bad)).toThrow(/--bind expects/);
    }
  });

  it("points the bound request's summary and detail at the item, and leaves the others alone", async () => {
    const { client } = await start({ binds: [bind, parseBind(`rq_working=${WORK_ITEM}x,WEB-8,${PROJECT}`)] });
    const all = okData(await client.listRequests("all"));
    expect(all.find((entry) => entry.id === "rq_question")).toMatchObject({ workItemId: WORK_ITEM, itemKey: "WEB-7", projectId: PROJECT });
    expect(all.find((entry) => entry.id === "rq_working")).toMatchObject({ workItemId: `${WORK_ITEM}x`, itemKey: "WEB-8" });
    expect(all.find((entry) => entry.id === "rq_signoff")?.itemKey).toBe("TES-142");
    const detail = okData(await client.getRequest("rq_question"));
    expect(detail).toMatchObject({ workItemId: WORK_ITEM, itemKey: "WEB-7", projectId: PROJECT });
    expect(detail.question).not.toBeNull();
    expect(okData(await client.getRequest("rq_working"))).toMatchObject({ workItemId: `${WORK_ITEM}x`, itemKey: "WEB-8" });
  });

  it("refuses a request id the fixtures do not have", () => {
    expect(() => createStubServer({ token: TOKEN, binds: [parseBind(`rq_nope=${WORK_ITEM},WEB-7,${PROJECT}`)] })).toThrow(/no fixture request rq_nope/);
  });
});
