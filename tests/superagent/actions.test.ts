/**
 * The Server Actions in src/app/actions/superagent.ts (decision 145): each validates its input before any
 * runner call, calls `refresh()` outside any failure (also after a runner failure), returns the runner's
 * result as a value, and never leaks the token. `server-only`, `next/cache` and the engine's server entry
 * are mocked, `fetch` is stubbed and the token file is a temp file.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, fixtureRunner, jsonResponse, stubFetch, TOKEN, type Call } from "./support";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/tessera/server", () => ({
  readTessera: async <T>(fn: (ctx: unknown) => T | Promise<T>) => fn({}),
  getWorkspaceSettings: () => ({ agents: null }),
}));

const actions = await import("@/app/actions/superagent");

let dir: string;
let tokenFile: string;
let calls: Call[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tessera-actions-"));
  tokenFile = path.join(dir, "api-token");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  mocks.refresh.mockClear();
  vi.stubEnv("TESSERA_AGENTS_TOKEN_FILE", tokenFile);
  await writeFile(tokenFile, TOKEN);
  useRunner(fixtureRunner);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function useRunner(answer: (call: Call) => Response | Promise<Response>) {
  const stub = stubFetch(answer);
  calls = stub.calls;
  vi.stubGlobal("fetch", stub.fetch);
}

const settings = fixture<{ settings: Record<string, unknown> }>("settings").settings;
const section = { repo: "tessera", section: "scope", text: "Small changes." };

/** Each action with a good input, the runner call it makes, and its body. */
const GOOD: { name: keyof typeof actions; run: () => Promise<unknown>; method: string; path: string; body: unknown }[] = [
  { name: "superagentPauseAction", run: () => actions.superagentPauseAction({ paused: true }), method: "POST", path: "/v1/pause", body: { paused: true } },
  {
    name: "superagentRequestAction",
    run: () => actions.superagentRequestAction({ request_id: "rq_1", action: "lift_hold" }),
    method: "POST",
    path: "/v1/requests/rq_1/lift-hold",
    body: undefined,
  },
  {
    name: "superagentResizeAction",
    run: () => actions.superagentResizeAction({ request_id: "rq_1", size: "L" }),
    method: "POST",
    path: "/v1/requests/rq_1/resize",
    body: { size: "L" },
  },
  {
    name: "superagentBudgetAction",
    run: () => actions.superagentBudgetAction({ request_id: "rq_1", usd: 9.5 }),
    method: "POST",
    path: "/v1/requests/rq_1/budget",
    body: { usd: 9.5 },
  },
  {
    name: "superagentRetryTriageAction",
    run: () => actions.superagentRetryTriageAction({ triage_id: "tri_1" }),
    method: "POST",
    path: "/v1/triage/tri_1/retry",
    body: undefined,
  },
  {
    name: "superagentSaveSettingsAction",
    run: () => actions.superagentSaveSettingsAction({ settings: settings as never, base_revision: 4 }),
    method: "PUT",
    path: "/v1/settings",
    body: { settings, baseRevision: 4 },
  },
  {
    name: "superagentSavePromptsAction",
    run: () => actions.superagentSavePromptsAction({ team_sections: [section as never], base_revision: "r7" }),
    method: "PUT",
    path: "/v1/prompts",
    body: { teamSections: [section], baseRevision: "r7" },
  },
];

/** Inputs each action must refuse before any runner call. */
const BAD: [string, () => Promise<unknown>][] = [
  ["pause: not a boolean", () => actions.superagentPauseAction({ paused: "yes" } as never)],
  ["pause: no input", () => actions.superagentPauseAction(undefined as never)],
  ["request: empty id", () => actions.superagentRequestAction({ request_id: "", action: "approve" })],
  ["request: id over 200 characters", () => actions.superagentRequestAction({ request_id: "x".repeat(201), action: "approve" })],
  ["request: resize is not a request action", () => actions.superagentRequestAction({ request_id: "rq_1", action: "resize" as never })],
  ["request: unknown action", () => actions.superagentRequestAction({ request_id: "rq_1", action: "delete" as never })],
  ["resize: size XL", () => actions.superagentResizeAction({ request_id: "rq_1", size: "XL" as never })],
  ["resize: no id", () => actions.superagentResizeAction({ size: "S" } as never)],
  ["budget: zero", () => actions.superagentBudgetAction({ request_id: "rq_1", usd: 0 })],
  ["budget: negative", () => actions.superagentBudgetAction({ request_id: "rq_1", usd: -1 })],
  ["budget: over 10000", () => actions.superagentBudgetAction({ request_id: "rq_1", usd: 10000.01 })],
  ["budget: NaN", () => actions.superagentBudgetAction({ request_id: "rq_1", usd: Number.NaN })],
  ["budget: a string", () => actions.superagentBudgetAction({ request_id: "rq_1", usd: "5" as never })],
  ["triage: empty id", () => actions.superagentRetryTriageAction({ triage_id: "" })],
  ["settings: missing revision", () => actions.superagentSaveSettingsAction({ settings: settings as never } as never)],
  ["settings: fractional parallelism", () => actions.superagentSaveSettingsAction({ settings: { ...settings, maxParallel: 1.5 } as never, base_revision: 4 })],
  ["settings: a revision of null", () => actions.superagentSaveSettingsAction({ settings: settings as never, base_revision: null as never })],
  ["prompts: unknown section", () => actions.superagentSavePromptsAction({ team_sections: [{ ...section, section: "tone" }] as never, base_revision: 7 })],
  ["prompts: more than 200 sections", () => actions.superagentSavePromptsAction({ team_sections: Array.from({ length: 201 }, () => section) as never, base_revision: 7 })],
];

describe("the module", () => {
  it("exports only async functions (a Server Actions file)", () => {
    const exported = Object.entries(actions);
    expect(exported.map(([name]) => name).sort()).toEqual([
      "superagentBudgetAction",
      "superagentPauseAction",
      "superagentRefreshAction",
      "superagentRequestAction",
      "superagentResizeAction",
      "superagentRetryTriageAction",
      "superagentSavePromptsAction",
      "superagentSaveSettingsAction",
    ]);
    for (const [name, value] of exported) {
      expect(typeof value, name).toBe("function");
      expect((value as { constructor: { name: string } }).constructor.name, name).toBe("AsyncFunction");
    }
  });
});

describe("a good input", () => {
  it.each(GOOD.map((entry) => [entry.name, entry] as const))("%s makes its runner call, refreshes once and returns the data", async (_name, entry) => {
    const result = await entry.run();
    expect(result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect([calls[0].method, new URL(calls[0].url).pathname]).toEqual([entry.method, entry.path]);
    expect(calls[0].body).toEqual(entry.body);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("accepts the edges of the budget range", async () => {
    expect(await actions.superagentBudgetAction({ request_id: "rq_1", usd: 0.01 })).toMatchObject({ ok: true });
    expect(await actions.superagentBudgetAction({ request_id: "rq_1", usd: 10000 })).toMatchObject({ ok: true });
  });

  it("accepts all four actions without a body", async () => {
    for (const action of ["approve", "retry", "stop", "lift_hold"] as const) {
      expect(await actions.superagentRequestAction({ request_id: "rq_1", action })).toMatchObject({ ok: true });
    }
    expect(calls.map((call) => new URL(call.url).pathname.split("/").pop())).toEqual(["approve", "retry", "stop", "lift-hold"]);
  });

  it("strips fields the schema does not name before they reach the runner", async () => {
    await actions.superagentSaveSettingsAction({
      settings: { ...settings, token: "x" } as never,
      base_revision: 4,
      extra: true,
    } as never);
    expect(calls[0].body).toEqual({ settings, baseRevision: 4 });
  });

  it("answers the runner's data", async () => {
    expect(await actions.superagentPauseAction({ paused: false })).toEqual({ ok: true, data: { paused: false } });
    const saved = await actions.superagentSaveSettingsAction({ settings: settings as never, base_revision: 4 });
    expect(saved).toEqual({ ok: true, data: { settings, revision: 5 } });
  });
});

describe("a bad input", () => {
  it.each(BAD)("%s is a validation failure with no runner call and no refresh", async (_label, run) => {
    const result = await run();
    expect(result).toMatchObject({ ok: false, failure: { state: "validation", status: null, code: null } });
    expect((result as { failure: { message: string } }).failure.message).not.toBe("");
    expect(calls).toHaveLength(0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("names the field in the message", async () => {
    const result = await actions.superagentBudgetAction({ request_id: "rq_1", usd: -1 });
    expect(result).toMatchObject({ ok: false, failure: { message: expect.stringContaining("usd") } });
  });
});

describe("a runner failure", () => {
  it("comes back as a value, after a refresh, so the screen shows what the runner now says", async () => {
    useRunner(() => jsonResponse({ error: { code: "CONFLICT", message: "approve is not allowed in stage working" } }, 409));
    const result = await actions.superagentRequestAction({ request_id: "rq_1", action: "approve" });
    expect(result).toEqual({
      ok: false,
      failure: { state: "conflict", message: "approve is not allowed in stage working", status: 409, code: "CONFLICT" },
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("is a stale revision as conflict, for settings and prompts", async () => {
    useRunner(() => jsonResponse({ error: { code: "CONFLICT", message: "Changed elsewhere" } }, 409));
    const saved = await actions.superagentSaveSettingsAction({ settings: settings as never, base_revision: 3 });
    expect(saved).toMatchObject({ ok: false, failure: { state: "conflict" } });
    const prompts = await actions.superagentSavePromptsAction({ team_sections: [], base_revision: 3 });
    expect(prompts).toMatchObject({ ok: false, failure: { state: "conflict" } });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("is unreachable or a timeout without throwing", async () => {
    useRunner(() => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    expect(await actions.superagentPauseAction({ paused: true })).toMatchObject({ ok: false, failure: { state: "unreachable" } });
    useRunner(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await actions.superagentPauseAction({ paused: true })).toMatchObject({ ok: false, failure: { state: "timeout" } });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("is not_set_up with no request when there is no token file, and still refreshes", async () => {
    await rm(tokenFile, { force: true });
    const result = await actions.superagentPauseAction({ paused: true });
    expect(result).toMatchObject({ ok: false, failure: { state: "not_set_up" } });
    expect(calls).toHaveLength(0);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not put the token in any result, even when the runner echoes it", async () => {
    useRunner(() => jsonResponse({ error: { code: "FORBIDDEN", message: `bad token ${TOKEN}` } }, 403));
    const failed = await actions.superagentResizeAction({ request_id: "rq_1", size: "S" });
    expect(JSON.stringify(failed).includes(TOKEN)).toBe(false);
    for (const entry of GOOD) {
      expect(JSON.stringify(await entry.run()).includes(TOKEN)).toBe(false);
    }
  });
});

describe("superagentRefreshAction", () => {
  it("only refreshes: no runner call, no token read", async () => {
    await rm(tokenFile, { force: true });
    expect(await actions.superagentRefreshAction()).toBeUndefined();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
