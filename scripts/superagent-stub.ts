/**
 * `npx tsx scripts/superagent-stub.ts --port <n> --token-file <path> [--rewound] [--conflict] [--bind <requestId>=<workItemId>,<itemKey>,<projectId>]...`
 *
 * A fake superagent runner for browser acceptance of the Superagent screen
 * (docs/contracts/ui.md "Superagent control", "Fake runner and fixtures"). It
 * answers the runner's API v1 on 127.0.0.1:<port> with the fixtures in
 * tests/fixtures/superagent/ and applies actions in memory, so a restart
 * resets everything. Not part of the app, and it never reads the real token
 * file: pass one you wrote for the acceptance run.
 *
 * Auth, as the runner applies it: an `Origin` header or a Host other than
 * 127.0.0.1:<port> / localhost:<port> is 403, a missing `x-agents-request: 1`
 * is 403, a missing or wrong `Authorization: Bearer <token>` is 401.
 *
 *   --rewound   the runner's cursor is past Tessera's newest change (intake stopped)
 *   --conflict  every PUT is a 409 CONFLICT, and the stored revision moves on as if someone else saved
 *   --bind      repeatable: the request's summary and detail carry that work item id, key and project id, so
 *               acceptance can point the fixtures at real items (docs/contracts/ui.md "Superagent chat")
 *
 * `createStubServer` is exported for tests/superagent/stub.test.ts.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  PausedEnvelopeSchema,
  RequestDetailEnvelopeSchema,
  RequestSizeSchema,
  RequestsEnvelopeSchema,
  RevisionSchema,
  RunnerPromptsDocSchema,
  RunnerSettingsDocSchema,
  RunnerSettingsSchema,
  RunnerStateSchema,
  RunnerStatsSchema,
  TeamSectionSchema,
  TriageListEnvelopeSchema,
  type RequestDetail,
  type RequestSummary,
  type Revision,
  type RunnerAction,
  type StageKind,
} from "@/lib/superagent/schemas";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "superagent");
const TERMINAL_STAGES: StageKind[] = ["done", "dropped", "stopped"];
const MAX_BODY_BYTES = 1_000_000;

/** The stage a request moves to when an action without a body is applied, and what it can do there. */
const AFTER_ACTION = {
  approve: { kind: "working", label: "Working", reason: null, actions: ["stop"] },
  lift_hold: { kind: "working", label: "Working", reason: null, actions: ["stop"] },
  retry: { kind: "queued", label: "Queued", reason: "Waiting for a free slot.", actions: ["stop"] },
  stop: { kind: "stopped", label: "Stopped", reason: "You stopped this request.", actions: [] },
} as const satisfies Record<string, { kind: StageKind; label: string; reason: string | null; actions: readonly RunnerAction[] }>;

type Reply = { status: number; body: unknown };

const ResizeBody = z.object({ size: RequestSizeSchema });
const BudgetBody = z.object({ usd: z.number().gt(0) });

const ok = (body: unknown): Reply => ({ status: 200, body });
const fault = (status: number, code: string, message: string): Reply => ({ status, body: { error: { code, message } } });
const invalid = (error: z.ZodError): Reply => fault(400, "VALIDATION", error.issues[0]?.message ?? "Invalid body");

/** A new revision for the same document; the v1 text leaves the type open, so a string gets a suffix. */
const bump = (revision: Revision): Revision => (typeof revision === "number" ? revision + 1 : `${revision}.1`);

function fixture<S extends z.ZodType>(name: string, schema: S): z.output<S> {
  return schema.parse(JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")));
}

/** Points one fixture request at a real work item (`--bind`). */
export type StubBind = { requestId: string; workItemId: string; itemKey: string; projectId: string };

export type StubOptions = { token: string; rewound?: boolean; conflict?: boolean; binds?: readonly StubBind[]; log?: (line: string) => void };

/** Parses one `--bind <requestId>=<workItemId>,<itemKey>,<projectId>` value; every part must be non-empty. */
export function parseBind(value: string): StubBind {
  const [requestId, rest = "", ...extra] = value.split("=");
  const [workItemId, itemKey, projectId, ...more] = rest.split(",");
  if (extra.length > 0 || more.length > 0 || !requestId || !workItemId || !itemKey || !projectId) {
    throw new Error(`--bind expects <requestId>=<workItemId>,<itemKey>,<projectId>, got "${value}"`);
  }
  return { requestId, workItemId, itemKey, projectId };
}

export function createStubServer(options: StubOptions): Server {
  const state = fixture("state.json", RunnerStateSchema);
  const requests: RequestSummary[] = fixture("requests.json", RequestsEnvelopeSchema).requests;
  const detail: RequestDetail = fixture("request-detail.json", RequestDetailEnvelopeSchema).request;
  const triage = fixture("triage.json", TriageListEnvelopeSchema).triage;
  const stats = fixture("stats.json", RunnerStatsSchema);
  let settings = fixture("settings.json", RunnerSettingsDocSchema);
  let prompts = fixture("prompts.json", RunnerPromptsDocSchema);
  if (options.rewound === true) {
    state.intake.rewound = true;
    state.intake.latestSeq = Math.max(0, state.intake.cursor - 30);
  }

  const find = (id: string) => requests.find((request) => request.id === id);

  for (const bind of options.binds ?? []) {
    const bound = find(bind.requestId);
    if (bound === undefined) throw new Error(`--bind: no fixture request ${bind.requestId}`);
    Object.assign(bound, { workItemId: bind.workItemId, itemKey: bind.itemKey, projectId: bind.projectId });
  }

  function currentState() {
    const count = (match: (kind: StageKind) => boolean) => requests.filter((request) => match(request.stage.kind)).length;
    const working = count((kind) => kind === "working");
    return {
      ...state,
      slots: { ...state.slots, running: working },
      counts: { needsYou: count((kind) => kind.startsWith("needs_")), working, queued: count((kind) => kind === "queued") },
    };
  }

  function listRequests(scope: string | null): Reply {
    if (scope !== "open" && scope !== "recent" && scope !== "all") return fault(400, "VALIDATION", "scope must be open, recent or all");
    if (scope === "all") return ok({ requests });
    const open = requests.filter((request) => !TERMINAL_STAGES.includes(request.stage.kind));
    if (scope === "open") return ok({ requests: open });
    const ended = requests.filter((request) => TERMINAL_STAGES.includes(request.stage.kind));
    ended.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok({ requests: [...open, ...ended.slice(0, 3)] });
  }

  function getRequest(id: string): Reply {
    const summary = find(id);
    if (summary === undefined) return fault(404, "NOT_FOUND", `No request ${id}`);
    const extra =
      id === detail.id
        ? { scope: detail.scope, question: detail.question, planPageId: detail.planPageId, sessions: detail.sessions, events: detail.events }
        : {
            scope: `Work on ${summary.title}.`,
            question: null,
            planPageId: null,
            sessions: [],
            events: [{ at: summary.createdAt, kind: "created", text: "Request created." }],
          };
    return ok({ request: { ...summary, ...extra } });
  }

  /** An action on one request: 404, then 400 for a bad body, then 409 when the stage does not list it. */
  function act(id: string, action: RunnerAction, body: unknown): Reply {
    const request = find(id);
    if (request === undefined) return fault(404, "NOT_FOUND", `No request ${id}`);
    const listed = request.actions.includes(action);
    const notAllowed = fault(409, "CONFLICT", `${action} is not allowed in stage ${request.stage.kind}`);
    if (action === "resize") {
      const parsed = ResizeBody.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      if (!listed) return notAllowed;
      request.size = parsed.data.size;
    } else if (action === "budget") {
      const parsed = BudgetBody.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      if (!listed) return notAllowed;
      request.budgetUsd = parsed.data.usd;
    } else {
      if (!listed) return notAllowed;
      const after = AFTER_ACTION[action];
      request.stage = { kind: after.kind, label: after.label, reason: after.reason };
      request.actions = [...after.actions];
    }
    request.updatedAt = new Date().toISOString();
    return ok({ request });
  }

  function retryTriage(id: string): Reply {
    const row = triage.find((entry) => entry.id === id);
    if (row === undefined) return fault(404, "NOT_FOUND", `No triage row ${id}`);
    row.status = "queued";
    row.attempts += 1;
    row.updatedAt = new Date().toISOString();
    return ok({ triage: row });
  }

  const SettingsPut = z.object({ settings: RunnerSettingsSchema, baseRevision: RevisionSchema });
  const PromptsPut = z.object({ teamSections: z.array(TeamSectionSchema), baseRevision: RevisionSchema });

  /** A PUT is stale when its `baseRevision` is not the stored one (always with --conflict, which also moves the revision on, as if someone else saved). */
  const isStale = (base: Revision, current: Revision) => options.conflict === true || base !== current;
  const stale = (): Reply => fault(409, "CONFLICT", "Changed elsewhere");

  function putSettings(body: unknown): Reply {
    const parsed = SettingsPut.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    if (isStale(parsed.data.baseRevision, settings.revision)) {
      if (options.conflict === true) settings = { ...settings, revision: bump(settings.revision) };
      return stale();
    }
    settings = { settings: parsed.data.settings, revision: bump(settings.revision) };
    return ok(settings);
  }

  function putPrompts(body: unknown): Reply {
    const parsed = PromptsPut.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    if (isStale(parsed.data.baseRevision, prompts.revision)) {
      if (options.conflict === true) prompts = { ...prompts, revision: bump(prompts.revision) };
      return stale();
    }
    prompts = { teamSections: parsed.data.teamSections, revision: bump(prompts.revision) };
    return ok(prompts);
  }

  function route(method: string, url: URL, body: unknown): Reply {
    const { pathname } = url;
    if (method === "GET" && pathname === "/v1/state") return ok(currentState());
    if (method === "GET" && pathname === "/v1/requests") return listRequests(url.searchParams.get("scope"));
    if (method === "GET" && pathname === "/v1/stats") return ok(stats);
    if (method === "GET" && pathname === "/v1/triage") return ok({ triage });
    if (method === "GET" && pathname === "/v1/settings") return ok(settings);
    if (method === "GET" && pathname === "/v1/prompts") return ok(prompts);
    if (method === "PUT" && pathname === "/v1/settings") return putSettings(body);
    if (method === "PUT" && pathname === "/v1/prompts") return putPrompts(body);
    if (method === "POST" && pathname === "/v1/pause") {
      const parsed = PausedEnvelopeSchema.safeParse(body);
      if (!parsed.success) return fault(400, "VALIDATION", "paused must be a boolean");
      state.paused = parsed.data.paused;
      state.pauseReason = parsed.data.paused ? "manual" : null;
      return ok({ paused: state.paused });
    }
    const one = /^\/v1\/requests\/([^/]+)$/.exec(pathname);
    if (method === "GET" && one !== null) return getRequest(decodeURIComponent(one[1]));
    const verb = /^\/v1\/requests\/([^/]+)\/(approve|retry|stop|lift-hold|resize|budget)$/.exec(pathname);
    if (method === "POST" && verb !== null) return act(decodeURIComponent(verb[1]), verb[2].replace("-", "_") as RunnerAction, body);
    const retry = /^\/v1\/triage\/([^/]+)\/retry$/.exec(pathname);
    if (method === "POST" && retry !== null) return retryTriage(decodeURIComponent(retry[1]));
    return fault(404, "NOT_FOUND", `No route ${method} ${pathname}`);
  }

  /** The v1 auth rules; null when the request may go on. */
  function authorize(request: IncomingMessage, port: number): Reply | null {
    if (request.headers.origin !== undefined) return fault(403, "FORBIDDEN", "Requests with an Origin header are refused");
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) return fault(403, "FORBIDDEN", "Host not allowed");
    if (request.headers["x-agents-request"] !== "1") return fault(403, "FORBIDDEN", "Missing x-agents-request header");
    if (request.headers.authorization !== `Bearer ${options.token}`) return fault(401, "UNAUTHORIZED", "Missing or wrong token");
    return null;
  }

  /** Parses a JSON body; `undefined` for none. Throws on text that is not JSON. */
  const parseBody = (chunks: Buffer[]): unknown => {
    const text = Buffer.concat(chunks).toString("utf8");
    return text === "" ? undefined : JSON.parse(text);
  };

  function reply(request: IncomingMessage, chunks: Buffer[], tooLarge: boolean, port: number): Reply {
    const denied = authorize(request, port);
    if (denied !== null) return denied;
    try {
      if (tooLarge) return fault(400, "VALIDATION", "Body too large");
      return route(request.method ?? "GET", new URL(request.url ?? "/", "http://stub.invalid"), parseBody(chunks));
    } catch {
      return fault(400, "VALIDATION", "Malformed request");
    }
  }

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      const answer = reply(request, chunks, size > MAX_BODY_BYTES, (server.address() as AddressInfo).port);
      options.log?.(`${request.method} ${(request.url ?? "").split("?")[0]} ${answer.status}`);
      response.writeHead(answer.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(answer.body));
    });
  });
  return server;
}

function main(): void {
  const { values } = parseArgs({
    options: { port: { type: "string" }, "token-file": { type: "string" }, rewound: { type: "boolean" }, conflict: { type: "boolean" }, bind: { type: "string", multiple: true } },
    strict: true,
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port <1-65535> is required");
  const tokenFile = values["token-file"];
  if (tokenFile === undefined) throw new Error("--token-file <path> is required");
  const token = readFileSync(tokenFile, "utf8").trim();
  if (token === "") throw new Error(`${tokenFile} is empty`);
  const binds = (values.bind ?? []).map(parseBind);
  const server = createStubServer({ token, rewound: values.rewound, conflict: values.conflict, binds, log: (line) => console.log(line) });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Fake superagent runner on http://127.0.0.1:${port} (token from ${tokenFile})`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
