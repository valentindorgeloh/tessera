/**
 * The superagent control client (src/lib/superagent/client.ts) against a stubbed `fetch`: every route's
 * method, URL, headers and body, every fixture through the client, and every failure state (decision 152).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunnerClient, RUNNER_TIMEOUT_MS, type RunnerClient } from "@/lib/superagent/client";
import type { RunnerFailureState, RunnerResult } from "@/lib/superagent/types";
import { fixture, jsonResponse, stubFetch, TOKEN, type Call } from "./support";

const BASE = "http://127.0.0.1:3090";

function setup(answer: (call: Call) => Response | Promise<Response>, options: { baseUrl?: string; timeoutMs?: number } = {}) {
  const stub = stubFetch(answer);
  const client = createRunnerClient({ baseUrl: options.baseUrl ?? BASE, token: TOKEN, fetch: stub.fetch, timeoutMs: options.timeoutMs });
  return { client, calls: stub.calls };
}

/** A client whose runner always answers with `body`. */
function answering(body: unknown, status = 200) {
  return setup(() => jsonResponse(body, status));
}

function failureOf<T>(result: RunnerResult<T>) {
  if (result.ok) throw new Error("expected a failure");
  return result.failure;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requests: method, URL, headers and body", () => {
  it("sends the auth headers on every call and no Origin", async () => {
    const { client, calls } = answering(fixture("state"));
    await client.getState();
    const [call] = calls;
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${BASE}/v1/state`);
    expect(call.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call.headers.get("x-agents-request")).toBe("1");
    expect(call.headers.get("accept")).toBe("application/json");
    expect(call.headers.has("origin")).toBe(false);
    expect(call.headers.has("content-type")).toBe(false);
    expect(call.body).toBeUndefined();
    expect(call.init.cache).toBe("no-store");
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops a trailing slash from the base URL", async () => {
    const { client, calls } = setup(() => jsonResponse(fixture("stats")), { baseUrl: `${BASE}/` });
    await client.getStats();
    expect(calls[0].url).toBe(`${BASE}/v1/stats`);
  });

  it("covers every route with the contract's method, path and body", async () => {
    const summary = { request: fixture<{ requests: unknown[] }>("requests").requests[0] };
    const triageRow = { triage: fixture<{ triage: unknown[] }>("triage").triage[0] };
    const settings = fixture<{ settings: { dailyCapUsd: number } }>("settings");
    const prompts = fixture<{ teamSections: unknown[] }>("prompts");
    const routes: { run: (client: RunnerClient) => Promise<unknown>; method: string; path: string; body: unknown; reply: unknown }[] = [
      { run: (c) => c.getState(), method: "GET", path: "/v1/state", body: undefined, reply: fixture("state") },
      { run: (c) => c.listRequests("open"), method: "GET", path: "/v1/requests?scope=open", body: undefined, reply: fixture("requests") },
      { run: (c) => c.listRequests("recent"), method: "GET", path: "/v1/requests?scope=recent", body: undefined, reply: fixture("requests") },
      { run: (c) => c.listRequests("all"), method: "GET", path: "/v1/requests?scope=all", body: undefined, reply: fixture("requests") },
      { run: (c) => c.getRequest("rq_question"), method: "GET", path: "/v1/requests/rq_question", body: undefined, reply: fixture("request-detail") },
      { run: (c) => c.getStats(), method: "GET", path: "/v1/stats", body: undefined, reply: fixture("stats") },
      { run: (c) => c.listTriage(), method: "GET", path: "/v1/triage", body: undefined, reply: fixture("triage") },
      { run: (c) => c.getSettings(), method: "GET", path: "/v1/settings", body: undefined, reply: settings },
      {
        run: (c) => c.putSettings(settings.settings as never, 4),
        method: "PUT",
        path: "/v1/settings",
        body: { settings: settings.settings, baseRevision: 4 },
        reply: settings,
      },
      { run: (c) => c.getPrompts(), method: "GET", path: "/v1/prompts", body: undefined, reply: prompts },
      {
        run: (c) => c.putPrompts(prompts.teamSections as never, 7),
        method: "PUT",
        path: "/v1/prompts",
        body: { teamSections: prompts.teamSections, baseRevision: 7 },
        reply: prompts,
      },
      { run: (c) => c.setPaused(true), method: "POST", path: "/v1/pause", body: { paused: true }, reply: { paused: true } },
      { run: (c) => c.requestAction("rq_a", "approve"), method: "POST", path: "/v1/requests/rq_a/approve", body: undefined, reply: summary },
      { run: (c) => c.requestAction("rq_a", "retry"), method: "POST", path: "/v1/requests/rq_a/retry", body: undefined, reply: summary },
      { run: (c) => c.requestAction("rq_a", "stop"), method: "POST", path: "/v1/requests/rq_a/stop", body: undefined, reply: summary },
      { run: (c) => c.requestAction("rq_a", "lift_hold"), method: "POST", path: "/v1/requests/rq_a/lift-hold", body: undefined, reply: summary },
      { run: (c) => c.resize("rq_a", "L"), method: "POST", path: "/v1/requests/rq_a/resize", body: { size: "L" }, reply: summary },
      { run: (c) => c.setBudget("rq_a", 7.5), method: "POST", path: "/v1/requests/rq_a/budget", body: { usd: 7.5 }, reply: summary },
      { run: (c) => c.retryTriage("tri_a"), method: "POST", path: "/v1/triage/tri_a/retry", body: undefined, reply: triageRow },
    ];
    for (const route of routes) {
      const { client, calls } = answering(route.reply);
      const result = await route.run(client);
      expect(result, `${route.method} ${route.path}`).toMatchObject({ ok: true });
      expect(calls, `${route.method} ${route.path}`).toHaveLength(1);
      const [call] = calls;
      expect([call.method, call.url]).toEqual([route.method, `${BASE}${route.path}`]);
      expect(call.body).toEqual(route.body);
      // A JSON body and its Content-Type go together; the "(empty body)" POSTs send neither.
      expect(call.headers.get("content-type")).toBe(route.body === undefined ? null : "application/json");
      expect(call.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(call.headers.get("x-agents-request")).toBe("1");
    }
  });

  it("passes a string revision back unchanged", async () => {
    const settings = fixture<{ settings: never }>("settings");
    const { client, calls } = answering({ settings: settings.settings, revision: "rev-9" });
    const result = await client.putSettings(settings.settings, "rev-9");
    expect(calls[0].body).toMatchObject({ baseRevision: "rev-9" });
    expect(result).toMatchObject({ ok: true, data: { revision: "rev-9" } });
  });

  it("encodes ids in the path", async () => {
    const { client, calls } = answering(fixture("request-detail"));
    await client.getRequest("a/b c?d");
    expect(calls[0].url).toBe(`${BASE}/v1/requests/a%2Fb%20c%3Fd`);
  });
});

describe("path ids", () => {
  const dotIds = ["", ".", ".."];
  const settings = fixture<{ settings: never }>("settings");
  /** Every method that puts an id in the path. */
  const byId: [string, (client: RunnerClient, id: string) => Promise<unknown>][] = [
    ["getRequest", (c, id) => c.getRequest(id)],
    ["requestAction approve", (c, id) => c.requestAction(id, "approve")],
    ["requestAction retry", (c, id) => c.requestAction(id, "retry")],
    ["requestAction stop", (c, id) => c.requestAction(id, "stop")],
    ["requestAction lift_hold", (c, id) => c.requestAction(id, "lift_hold")],
    ["resize", (c, id) => c.resize(id, "M")],
    ["setBudget", (c, id) => c.setBudget(id, 5)],
    ["retryTriage", (c, id) => c.retryTriage(id)],
  ];

  it.each(byId)("%s refuses an empty, . or .. id as validation without a call", async (_name, run) => {
    for (const id of dotIds) {
      const { client, calls } = answering(fixture("request-detail"));
      const result = (await run(client, id)) as RunnerResult<unknown>;
      expect(failureOf(result), JSON.stringify(id)).toMatchObject({ state: "validation", status: null, code: null });
      expect(failureOf(result).message).not.toBe("");
      expect(calls, JSON.stringify(id)).toHaveLength(0);
    }
  });

  it("still sends an id that only contains dots, is encoded, or merely starts with one", async () => {
    for (const id of ["...", ".a", "a.", "%2e%2e", "a/..", "../x"]) {
      const { client, calls } = answering(fixture("request-detail"));
      await client.getRequest(id);
      expect(calls, id).toHaveLength(1);
      expect(calls[0].url, id).toBe(`${BASE}/v1/requests/${encodeURIComponent(id)}`);
      expect(new URL(calls[0].url).pathname.split("/"), id).toHaveLength(4);
    }
  });

  it("leaves the routes without an id alone", async () => {
    const { client, calls } = answering(settings);
    await client.getSettings();
    expect(calls).toHaveLength(1);
  });
});

describe("fixtures through the client", () => {
  it("returns each fixture's data, unwrapped from its envelope", async () => {
    const requests = fixture<{ requests: { id: string }[] }>("requests");
    const list = await answering(requests).client.listRequests("all");
    expect(list).toMatchObject({ ok: true });
    expect(list.ok && list.data.map((request) => request.id)).toEqual(requests.requests.map((request) => request.id));

    const detail = fixture<{ request: { id: string; sessions: unknown[]; events: unknown[]; question: string } }>("request-detail");
    const one = await answering(detail).client.getRequest(detail.request.id);
    expect(one.ok && one.data.sessions).toHaveLength(detail.request.sessions.length);
    expect(one.ok && one.data.question).toBe(detail.request.question);

    const triage = fixture<{ triage: unknown[] }>("triage");
    const rows = await answering(triage).client.listTriage();
    expect(rows.ok && rows.data).toHaveLength(triage.triage.length);

    expect(await answering(fixture("state")).client.getState()).toMatchObject({ ok: true, data: { paused: false } });
    expect(await answering(fixture("stats")).client.getStats()).toMatchObject({ ok: true, data: { firstPassReviewRate: 0.64 } });
    expect(await answering(fixture("settings")).client.getSettings()).toMatchObject({ ok: true, data: { revision: 4 } });
    expect(await answering(fixture("prompts")).client.getPrompts()).toMatchObject({ ok: true, data: { revision: 7 } });
  });

  it("strips fields the contract does not name instead of failing", async () => {
    const state = { ...fixture<Record<string, unknown>>("state"), futureField: 1 };
    const result = await answering(state).client.getState();
    expect(result.ok).toBe(true);
    expect(result.ok && "futureField" in result.data).toBe(false);
  });
});

describe("bad_response", () => {
  it("is a missing field, named by its path", async () => {
    const requests = fixture<{ requests: { stage?: unknown }[] }>("requests");
    delete requests.requests[2].stage;
    const failure = failureOf(await answering(requests).client.listRequests("all"));
    expect(failure.state).toBe("bad_response");
    expect(failure.status).toBe(200);
    expect(failure.code).toBeNull();
    expect(failure.message).toContain("requests.2.stage");
  });

  it("is an unknown stage kind or action (enums are exact)", async () => {
    const stage = fixture<{ requests: { stage: { kind: string } }[] }>("requests");
    stage.requests[0].stage.kind = "needs_coffee";
    expect(failureOf(await answering(stage).client.listRequests("all")).state).toBe("bad_response");
    const action = fixture<{ requests: { actions: string[] }[] }>("requests");
    action.requests[0].actions.push("explode");
    expect(failureOf(await answering(action).client.listRequests("all")).state).toBe("bad_response");
  });

  it("is a body of the wrong shape, an unwrapped list or a non-JSON answer", async () => {
    expect(failureOf(await answering([]).client.listRequests("all")).state).toBe("bad_response");
    expect(failureOf(await answering({ requests: "none" }).client.listRequests("all")).state).toBe("bad_response");
    const html = setup(() => new Response("<html>nope</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const failure = failureOf(await html.client.getState());
    expect(failure).toMatchObject({ state: "bad_response", status: 200, message: "Response is not JSON" });
    const empty = setup(() => new Response(null, { status: 204 }));
    expect(failureOf(await empty.client.getState()).state).toBe("bad_response");
  });
});

describe("error answers", () => {
  const byCode: [string, number, RunnerFailureState][] = [
    ["UNAUTHORIZED", 401, "unauthorized"],
    ["FORBIDDEN", 403, "forbidden"],
    ["NOT_FOUND", 404, "not_found"],
    ["VALIDATION", 400, "validation"],
    ["CONFLICT", 409, "conflict"],
    ["UNAVAILABLE", 503, "unavailable"],
  ];

  it.each(byCode)("maps the code %s to its state and keeps the runner's message, status and code", async (code, status, state) => {
    const { client } = answering({ error: { code, message: `Runner says ${code}` } }, status);
    const failure = failureOf(await client.getState());
    expect(failure).toEqual({ state, message: `Runner says ${code}`, status, code });
  });

  it("lets the code win over the status", async () => {
    const failure = failureOf(await answering({ error: { code: "NOT_FOUND", message: "No such request" } }, 500).client.getRequest("x"));
    expect(failure).toMatchObject({ state: "not_found", status: 500, code: "NOT_FOUND" });
  });

  it("falls back to the status for a code it does not know", async () => {
    expect(failureOf(await answering({ error: { code: "TEAPOT", message: "short and stout" } }, 409).client.getState())).toMatchObject({
      state: "conflict",
      message: "short and stout",
      code: "TEAPOT",
    });
    expect(failureOf(await answering({ error: { code: "TEAPOT", message: "short and stout" } }, 500).client.getState()).state).toBe("http_error");
  });

  it("keeps only a code shaped like a runner code, and never one that carries the token", async () => {
    const codeOf = async (code: string, token = TOKEN) => {
      const stub = stubFetch(() => jsonResponse({ error: { code, message: "No" } }, 409));
      const result = await createRunnerClient({ baseUrl: BASE, token, fetch: stub.fetch }).getState();
      return { failure: failureOf(result), json: JSON.stringify(result) };
    };
    // Shaped like a code: kept (also an unknown one, which maps by status).
    expect((await codeOf("TEAPOT")).failure).toMatchObject({ state: "conflict", code: "TEAPOT" });
    expect((await codeOf("E".repeat(64))).failure.code).toBe("E".repeat(64));
    // Lowercase junk, free text, a leading digit or underscore, an empty code and an over-long one: null, the state still maps by status.
    for (const junk of ["not_a_code", "Mixed_Case", "HAS SPACE", "9LIVES", "_LEAD", "", "E".repeat(65), "line\nbreak", "ÉCOLE"]) {
      const { failure } = await codeOf(junk);
      expect(failure, JSON.stringify(junk)).toMatchObject({ state: "conflict", status: 409, code: null });
    }
    // A code that carries the token (the shared fake token, and an upper-case one that passes the shape check): null, token nowhere.
    for (const [code, token] of [
      [TOKEN, TOKEN],
      [`CODE_${TOKEN}`, TOKEN],
      ["ERR_SECRETTOKEN42", "SECRETTOKEN42"],
      ["SECRETTOKEN42", "SECRETTOKEN42"],
    ]) {
      const { failure, json } = await codeOf(code, token);
      expect(failure, code).toMatchObject({ state: "conflict", code: null });
      expect(json.includes(token), code).toBe(false);
      expect(json.includes(code), code).toBe(false);
    }
  });

  const byStatus: [number, RunnerFailureState][] = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [400, "validation"],
    [422, "validation"],
    [409, "conflict"],
    [503, "unavailable"],
    [500, "http_error"],
    [502, "http_error"],
    [418, "http_error"],
  ];

  it.each(byStatus)("maps a bare status %i (no error body) to %s", async (status, state) => {
    for (const reply of [() => new Response("boom", { status }), () => jsonResponse({ message: "not the error shape" }, status), () => new Response(null, { status })]) {
      const failure = failureOf(await setup(reply).client.getState());
      expect(failure).toMatchObject({ state, status, code: null });
      expect(failure.message).not.toBe("");
    }
  });

  it("maps a 2xx other than 200 as success and never follows a redirect", async () => {
    expect((await setup(() => jsonResponse(fixture("state"), 201)).client.getState()).ok).toBe(true);
    // `redirect: "error"` makes fetch reject on a 3xx; the stub does the same.
    const redirecting = setup(() => {
      throw new TypeError("fetch failed", { cause: { code: "ERR_UNEXPECTED_REDIRECT" } });
    });
    expect(failureOf(await redirecting.client.getState()).state).toBe("unreachable");
  });
});

describe("transport failures", () => {
  it("is unreachable when fetch rejects, naming the error code and nothing else", async () => {
    const refused = setup(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3090"), { code: "ECONNREFUSED" }) });
    });
    expect(failureOf(await refused.client.getState())).toEqual({
      state: "unreachable",
      message: "Connection failed (ECONNREFUSED)",
      status: null,
      code: null,
    });
    const plain = setup(() => {
      throw new Error("anything");
    });
    expect(failureOf(await plain.client.getState())).toMatchObject({ state: "unreachable", message: "Connection failed" });
  });

  it("is a timeout when fetch rejects with a TimeoutError or an AbortError", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const { client } = setup(() => {
        throw new DOMException("The operation was aborted", name);
      });
      expect(failureOf(await client.getState())).toMatchObject({ state: "timeout", status: null, code: null });
    }
  });

  it("is a timeout when the runner does not answer within timeoutMs", async () => {
    const hang = (call: Call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    const { client } = setup(hang, { timeoutMs: 20 });
    const started = Date.now();
    expect(failureOf(await client.getState())).toMatchObject({ state: "timeout", message: "No answer within 20 ms" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is a timeout when the body stalls after the headers", async () => {
    const stalled = (call: Call) => {
      const signal = call.init.signal as AbortSignal;
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason));
        },
      });
      return new Response(body, { status: 200 });
    };
    const { client } = setup(stalled, { timeoutMs: 20 });
    expect(failureOf(await client.getState()).state).toBe("timeout");
  });

  it("allows 5 seconds by default", () => {
    expect(RUNNER_TIMEOUT_MS).toBe(5000);
  });
});

describe("the token never leaks", () => {
  /** Every result shape a client can produce, each rendered as JSON. */
  async function everyOutcome(): Promise<string[]> {
    const echo = { error: { code: "FORBIDDEN", message: `Rejected token ${TOKEN}` } };
    const clients = [
      answering(fixture("state")),
      answering(echo, 403),
      answering({ error: { code: "TEAPOT", message: `Echo ${TOKEN} twice ${TOKEN}` } }, 500),
      answering({ health: TOKEN }),
      setup(() => new Response(`not json ${TOKEN}`, { status: 200 })),
      setup(() => new Response(`boom ${TOKEN}`, { status: 502 })),
      setup(() => {
        throw new TypeError(`Invalid header value Bearer ${TOKEN}`);
      }),
      setup(() => {
        throw new DOMException(`aborted ${TOKEN}`, "TimeoutError");
      }),
    ];
    const outcomes: string[] = [];
    for (const { client } of clients) outcomes.push(JSON.stringify(await client.getState()));
    return outcomes;
  }

  it("keeps the token out of every result, even when the runner or the runtime echoes it", async () => {
    const outcomes = await everyOutcome();
    expect(outcomes.length).toBeGreaterThan(5);
    for (const outcome of outcomes) expect(outcome.includes(TOKEN)).toBe(false);
  });

  it("writes nothing to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    await everyOutcome();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
