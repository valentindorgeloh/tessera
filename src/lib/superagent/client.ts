/**
 * Control client for the superagent runner's local HTTP API v1 (decision 151;
 * docs/contracts/ui.md "Superagent control"). Every method resolves to a
 * `RunnerResult`: a failure is a state (`unreachable`, `unauthorized`, ...),
 * never a thrown error, and the token never appears in a result. No file
 * system and no `server-only`, so Vitest imports it and the server wrapper
 * (./server.ts) adds the token and the URL.
 */
import type { z } from "zod";
import {
  PausedEnvelopeSchema,
  RequestDetailEnvelopeSchema,
  RequestEnvelopeSchema,
  RequestsEnvelopeSchema,
  RunnerErrorBodySchema,
  RunnerPromptsDocSchema,
  RunnerSettingsDocSchema,
  RunnerStateSchema,
  RunnerStatsSchema,
  TriageEnvelopeSchema,
  TriageListEnvelopeSchema,
  type RequestDetail,
  type RequestSize,
  type RequestSummary,
  type Revision,
  type RunnerPromptsDoc,
  type RunnerSettings,
  type RunnerSettingsDoc,
  type RunnerState,
  type RunnerStats,
  type SimpleAction,
  type TeamSection,
  type TriageRow,
} from "./schemas";
import type { RequestScope, RunnerFailureState, RunnerResult } from "./types";

export type { RunnerFailure, RunnerFailureState, RunnerResult } from "./types";

/** How long one runner call may take before it is a `timeout` failure. */
export const RUNNER_TIMEOUT_MS = 5000;

export type RunnerClient = {
  /** GET /v1/state */
  getState(): Promise<RunnerResult<RunnerState>>;
  /** GET /v1/requests?scope=<scope> */
  listRequests(scope: RequestScope): Promise<RunnerResult<RequestSummary[]>>;
  /** GET /v1/requests/:id */
  getRequest(id: string): Promise<RunnerResult<RequestDetail>>;
  /** GET /v1/stats */
  getStats(): Promise<RunnerResult<RunnerStats>>;
  /** GET /v1/triage */
  listTriage(): Promise<RunnerResult<TriageRow[]>>;
  /** GET /v1/settings */
  getSettings(): Promise<RunnerResult<RunnerSettingsDoc>>;
  /** PUT /v1/settings; a stale `baseRevision` is a `conflict`. */
  putSettings(settings: RunnerSettings, baseRevision: Revision): Promise<RunnerResult<RunnerSettingsDoc>>;
  /** GET /v1/prompts */
  getPrompts(): Promise<RunnerResult<RunnerPromptsDoc>>;
  /** PUT /v1/prompts; a stale `baseRevision` is a `conflict`. */
  putPrompts(teamSections: TeamSection[], baseRevision: Revision): Promise<RunnerResult<RunnerPromptsDoc>>;
  /** POST /v1/pause */
  setPaused(paused: boolean): Promise<RunnerResult<{ paused: boolean }>>;
  /** POST /v1/requests/:id/{approve|retry|stop|lift-hold}, no body. */
  requestAction(id: string, action: SimpleAction): Promise<RunnerResult<RequestSummary>>;
  /** POST /v1/requests/:id/resize */
  resize(id: string, size: RequestSize): Promise<RunnerResult<RequestSummary>>;
  /** POST /v1/requests/:id/budget */
  setBudget(id: string, usd: number): Promise<RunnerResult<RequestSummary>>;
  /** POST /v1/triage/:id/retry, no body. */
  retryTriage(id: string): Promise<RunnerResult<TriageRow>>;
};

export type RunnerClientOptions = {
  /** `http://127.0.0.1:3090`; a trailing `/` is dropped. */
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type Method = "GET" | "POST" | "PUT";

/** `error.code` of a runner error body to the failure state it names. */
const STATE_BY_CODE = new Map<string, RunnerFailureState>([
  ["UNAUTHORIZED", "unauthorized"],
  ["FORBIDDEN", "forbidden"],
  ["NOT_FOUND", "not_found"],
  ["VALIDATION", "validation"],
  ["CONFLICT", "conflict"],
  ["UNAVAILABLE", "unavailable"],
]);

/** The state for an error answer whose body is not a runner error body (or names an unknown code). */
function stateByStatus(status: number): RunnerFailureState {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 400:
    case 422:
      return "validation";
    case 409:
      return "conflict";
    case 503:
      return "unavailable";
    default:
      return "http_error";
  }
}

function errorName(error: unknown): string | null {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string" ? error.name : null;
}

/** A Node error code such as ECONNREFUSED, from the error or its cause. Never its message, which can echo a header value. */
function errorCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; depth < 3 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof current.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(current.code)) return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

/** The first zod issue as `path: text`, for a `bad_response` message. */
function issueText(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "Invalid response";
  const path = issue.path.map(String).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

/** What `failure.code` may hold from a runner error body: an upper-case code, short, so free text cannot ride along. */
const RUNNER_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const same = <T>(data: T): T => data;

export function createRunnerClient(options: RunnerClientOptions): RunnerClient {
  const { token } = options;
  const root = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? RUNNER_TIMEOUT_MS;

  /**
   * Every failure goes through here, so the token cannot reach a message or a code even if the runner echoes it.
   * A `code` that is not shaped like a runner code, or that carries the token, becomes null.
   */
  function fail(state: RunnerFailureState, message: string, status: number | null = null, code: string | null = null): RunnerResult<never> {
    const keepCode = code !== null && RUNNER_CODE.test(code) && (token === "" || !code.includes(token));
    return { ok: false, failure: { state, message: token === "" ? message : message.split(token).join("[token]"), status, code: keepCode ? code : null } };
  }

  /** Runs `run` with the id encoded for a path. An id that is empty, `.` or `..` is `validation` with no call: encoding keeps dots and fetch would resolve them to another route. */
  function withId<T>(id: string, run: (encoded: string) => Promise<RunnerResult<T>>): Promise<RunnerResult<T>> {
    if (id === "" || id === "." || id === "..") return Promise.resolve(fail("validation", "Invalid id"));
    return run(encodeURIComponent(id));
  }

  function thrown(error: unknown): RunnerResult<never> {
    const name = errorName(error);
    if (name === "TimeoutError" || name === "AbortError") return fail("timeout", `No answer within ${timeoutMs} ms`);
    const code = errorCode(error);
    return fail("unreachable", code === null ? "Connection failed" : `Connection failed (${code})`);
  }

  function httpFailure(status: number, body: unknown): RunnerResult<never> {
    const parsed = RunnerErrorBodySchema.safeParse(body);
    if (!parsed.success) return fail(stateByStatus(status), "No error body", status);
    const { code, message } = parsed.data.error;
    return fail(STATE_BY_CODE.get(code) ?? stateByStatus(status), message === "" ? "No error message" : message, status, code);
  }

  /** One call: `schema` parses the body, `pick` takes the part the method returns. `body` goes out as JSON. */
  async function call<S extends z.ZodType, T>(
    method: Method,
    path: string,
    schema: S,
    pick: (data: z.output<S>) => T,
    body?: unknown,
  ): Promise<RunnerResult<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "x-agents-request": "1",
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let status: number;
    let text: string;
    try {
      // Resolved per call so a stubbed global fetch is seen. The signal covers reading the body too.
      const response = await (options.fetch ?? fetch)(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      return thrown(error);
    }
    let json: unknown;
    let isJson = true;
    try {
      json = JSON.parse(text);
    } catch {
      isJson = false;
    }
    if (status < 200 || status > 299) return httpFailure(status, json);
    if (!isJson) return fail("bad_response", "Response is not JSON", status);
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail("bad_response", issueText(parsed.error), status);
    return { ok: true, data: pick(parsed.data) };
  }

  return {
    getState: () => call("GET", "/v1/state", RunnerStateSchema, same),
    listRequests: (scope) =>
      call("GET", `/v1/requests?scope=${encodeURIComponent(scope)}`, RequestsEnvelopeSchema, (envelope) => envelope.requests),
    getRequest: (id) => withId(id, (key) => call("GET", `/v1/requests/${key}`, RequestDetailEnvelopeSchema, (envelope) => envelope.request)),
    getStats: () => call("GET", "/v1/stats", RunnerStatsSchema, same),
    listTriage: () => call("GET", "/v1/triage", TriageListEnvelopeSchema, (envelope) => envelope.triage),
    getSettings: () => call("GET", "/v1/settings", RunnerSettingsDocSchema, same),
    putSettings: (settings, baseRevision) => call("PUT", "/v1/settings", RunnerSettingsDocSchema, same, { settings, baseRevision }),
    getPrompts: () => call("GET", "/v1/prompts", RunnerPromptsDocSchema, same),
    putPrompts: (teamSections, baseRevision) => call("PUT", "/v1/prompts", RunnerPromptsDocSchema, same, { teamSections, baseRevision }),
    setPaused: (paused) => call("POST", "/v1/pause", PausedEnvelopeSchema, same, { paused }),
    requestAction: (id, action) =>
      withId(id, (key) =>
        call("POST", `/v1/requests/${key}/${action === "lift_hold" ? "lift-hold" : action}`, RequestEnvelopeSchema, (envelope) => envelope.request),
      ),
    resize: (id, size) =>
      withId(id, (key) => call("POST", `/v1/requests/${key}/resize`, RequestEnvelopeSchema, (envelope) => envelope.request, { size })),
    setBudget: (id, usd) =>
      withId(id, (key) => call("POST", `/v1/requests/${key}/budget`, RequestEnvelopeSchema, (envelope) => envelope.request, { usd })),
    retryTriage: (id) =>
      withId(id, (key) => call("POST", `/v1/triage/${key}/retry`, TriageEnvelopeSchema, (envelope) => envelope.triage)),
  };
}
