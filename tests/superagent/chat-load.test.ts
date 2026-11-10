/**
 * `loadSuperagentChat` (src/lib/superagent/chat.ts, decision 146) over a seeded memory database and a stubbed
 * runner: Tessera answers first (so a runner failure is a state, not an error), request-only items are merged,
 * the newest request wins per item, the entries run description first with replies flattened in time order, and the
 * composer's reply target is found by `client_ref`, then by body. `server-only` and the engine's server entry are
 * mocked (the entry is the engine barrel with `readTessera` over the test database); `fetch` is stubbed.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createComment } from "@/lib/tessera/comments";
import { withActor, type TesseraContext } from "@/lib/tessera/core/context";
import { createProject } from "@/lib/tessera/projects";
import { setAgentSettings } from "@/lib/tessera/workspace";
import { createWorkItem } from "@/lib/tessera/work-items";
import type { RequestDetail, RequestSummary } from "@/lib/superagent/types";
import { createTestContext, createTestDb } from "../helpers/db";
import { fixture, jsonResponse, stubFetch, TOKEN, type Call } from "./support";

const holder = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tessera/server", async () => {
  const engine = await import("@/lib/tessera");
  return { ...engine, readTessera: async <T>(fn: (ctx: TesseraContext) => T | Promise<T>) => fn(holder.ctx as TesseraContext) };
});

const { loadSuperagentChat } = await import("@/lib/superagent/chat");

let dir: string;
let tokenFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tessera-chat-"));
  tokenFile = path.join(dir, "api-token");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.stubEnv("TESSERA_AGENTS_TOKEN_FILE", tokenFile);
  await writeFile(tokenFile, `${TOKEN}\n`);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const BASE = fixture<{ requests: RequestSummary[] }>("requests").requests[0];
const DETAIL = fixture<{ request: RequestDetail }>("request-detail").request;
const QUESTION = DETAIL.question as string;

/** A runner request for `itemId`; `over` changes any summary field. */
function request(id: string, itemId: string, projectId: string, over: Partial<RequestSummary> = {}): RequestSummary {
  return { ...BASE, id, workItemId: itemId, itemKey: "X-1", projectId, ...over };
}

/** A fake runner: the list as given, and a detail with `question` for any id (`details` overrides per id). */
function runner(requests: RequestSummary[], question: string | null = null) {
  const stub = stubFetch((call: Call) => {
    const { pathname } = new URL(call.url);
    if (pathname === "/v1/requests") return jsonResponse({ requests });
    const id = decodeURIComponent(pathname.split("/").pop() ?? "");
    const found = requests.find((entry) => entry.id === id);
    return found ? jsonResponse({ request: { ...DETAIL, ...found, question } }) : jsonResponse({ error: { code: "NOT_FOUND", message: "No request" } }, 404);
  });
  vi.stubGlobal("fetch", stub.fetch);
  return stub.calls;
}

function setup(options: { superagent?: boolean } = {}) {
  const ctx = createTestContext(createTestDb());
  holder.ctx = ctx;
  const agent = registerActor(ctx, { kind: "agent", name: options.superagent === false ? "mcp:other" : "mcp:superagent" });
  const agentCtx = withActor(ctx, agent.id);
  const web = createProject(ctx, { name: "Web", identifier: "WEB" });
  const api = createProject(ctx, { name: "Api", identifier: "API" });
  setAgentSettings(ctx, { runner_url: "http://127.0.0.1:3391", projects: [{ project_id: web.id, repo: "web-repo" }] });
  const item = (name: string, extra: { description_md?: string; assigned?: boolean } = {}) => {
    const created = createWorkItem(ctx, { project_id: web.id, name, description_md: extra.description_md });
    if (extra.assigned !== false) setAssignees(ctx, created.id, [agent.id]);
    return created;
  };
  const stamp = (id: string, iso: string) => ctx.sqlite.prepare("UPDATE comment SET created_at = ? WHERE id = ?").run(iso, id);
  return { ctx, agent, agentCtx, web, api, item, stamp };
}

function asItem(load: Awaited<ReturnType<typeof loadSuperagentChat>>) {
  if (load.open?.kind !== "item") throw new Error(`expected an open item, got ${load.open?.kind ?? "null"}`);
  return load.open;
}

describe("the list", () => {
  it("lists the superagent's items from Tessera and puts the runner's failure in requests when it is down", async () => {
    const { item, web, agent } = setup();
    const a = item("Assigned");
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const load = await loadSuperagentChat({ itemKey: a.key });
    expect(load.requests).toMatchObject({ ok: false, failure: { state: "unreachable" } });
    expect(load.superagentActorId).toBe(agent.id);
    expect(load.projects).toEqual([{ id: web.id, name: "Web", identifier: "WEB", repo: "web-repo" }]);
    expect(load.conversations.map((row) => [row.itemKey, row.request])).toEqual([[a.key, null]]);
    expect(asItem(load)).toMatchObject({ itemKey: a.key, request: null, detail: null, replyToCommentId: null });
    expect(load.runnerUrl).toBe("http://127.0.0.1:3391");
  });

  it("is not_set_up, with the list still loaded, when there is no token file", async () => {
    const { item } = setup();
    item("Assigned");
    await rm(tokenFile, { force: true });
    const calls = runner([]);
    const load = await loadSuperagentChat({ itemKey: null });
    expect(calls).toHaveLength(0);
    expect(load.requests).toMatchObject({ ok: false, failure: { state: "not_set_up" } });
    expect(load.conversations).toHaveLength(1);
    expect(load.open).toBeNull();
    expect(load.tokenFile).toBe(tokenFile);
  });

  it("merges items that only have a runner request, and ignores requests of unmapped projects", async () => {
    const { item, web, api } = setup();
    const assigned = item("Assigned");
    const plain = item("Only a request", { assigned: false });
    const elsewhere = createWorkItem(holder.ctx as TesseraContext, { project_id: api.id, name: "Unmapped" });
    const calls = runner([request("rq_a", plain.id, web.id), request("rq_b", elsewhere.id, api.id), request("rq_c", assigned.id, web.id)]);
    const load = await loadSuperagentChat({ itemKey: null });
    expect(load.conversations.map((row) => row.itemKey).sort()).toEqual([assigned.key, plain.key].sort());
    expect(load.conversations.find((row) => row.workItemId === plain.id)?.request?.id).toBe("rq_a");
    expect(load.conversations.find((row) => row.workItemId === assigned.id)?.request?.id).toBe("rq_c");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/requests"]);
  });

  it("picks the newest request (largest createdAt) per item, for the row and for the open item", async () => {
    const { item, web } = setup();
    const a = item("Assigned");
    runner([
      request("rq_old", a.id, web.id, { createdAt: "2026-11-01T00:00:00.000Z" }),
      request("rq_new", a.id, web.id, { createdAt: "2026-11-05T00:00:00.000Z" }),
      request("rq_mid", a.id, web.id, { createdAt: "2026-11-03T00:00:00.000Z" }),
    ]);
    const load = await loadSuperagentChat({ itemKey: a.key });
    expect(load.conversations[0].request?.id).toBe("rq_new");
    const open = asItem(load);
    expect(open.request?.id).toBe("rq_new");
    expect(open.detail).toMatchObject({ ok: true, data: { id: "rq_new" } });
  });

  it("has no conversations without a superagent actor, but still lists the projects and the open item", async () => {
    const { item, web } = setup({ superagent: false });
    const a = item("Assigned");
    runner([request("rq_a", a.id, web.id)]);
    const load = await loadSuperagentChat({ itemKey: a.key });
    expect(load.superagentActorId).toBeNull();
    expect(load.conversations).toEqual([]);
    expect(load.projects).toHaveLength(1);
    expect(asItem(load).workItemId).toBe(a.id);
  });
});

describe("the open item", () => {
  it("is not_found for an unknown key and null without a key", async () => {
    setup();
    runner([]);
    expect((await loadSuperagentChat({ itemKey: "WEB-999" })).open).toEqual({ kind: "not_found", itemKey: "WEB-999" });
    expect((await loadSuperagentChat({ itemKey: "nonsense" })).open).toEqual({ kind: "not_found", itemKey: "nonsense" });
    expect((await loadSuperagentChat({ itemKey: null })).open).toBeNull();
  });

  it("puts the description first, then every comment and reply in time order", async () => {
    const { ctx, agentCtx, item, stamp } = setup();
    const a = item("Assigned", { description_md: "The brief" });
    const root1 = createComment(ctx, a.id, { body_md: "first" });
    const root2 = createComment(agentCtx, a.id, { body_md: "second" });
    const reply = createComment(ctx, a.id, { body_md: "reply to first", parent_comment_id: root1.id });
    stamp(root1.id, "2026-01-02T00:00:00.000Z");
    stamp(reply.id, "2026-01-03T00:00:00.000Z");
    stamp(root2.id, "2026-01-04T00:00:00.000Z");
    runner([]);
    const open = asItem(await loadSuperagentChat({ itemKey: a.key }));
    expect(open.entries.map((entry) => [entry.id === "description" ? "description" : entry.bodyMd, entry.kind])).toEqual([
      ["description", "description"],
      ["first", "comment"],
      ["reply to first", "reply"],
      ["second", "comment"],
    ]);
    expect(open.entries[0]).toMatchObject({ actorId: a.created_by, bodyMd: "The brief", createdAt: a.created_at, isEdited: false });
    expect(open.entries[3]).toMatchObject({ actorKind: "agent", actorName: "mcp:superagent" });
    expect(open.mentionActors.map((actor) => actor.name)).toContain("mcp:superagent");
    expect(open.projectName).toBe("Web");
    expect(open.isArchived).toBe(false);
  });

  it("leaves the description out when it is blank, and marks edited comments", async () => {
    const { ctx, item } = setup();
    const a = item("Assigned", { description_md: "   " });
    const note = createComment(ctx, a.id, { body_md: "draft" });
    ctx.sqlite.prepare("UPDATE comment SET edited_at = ? WHERE id = ?").run("2026-01-05T00:00:00.000Z", note.id);
    runner([]);
    const open = asItem(await loadSuperagentChat({ itemKey: a.key }));
    expect(open.entries.map((entry) => [entry.kind, entry.isEdited])).toEqual([["comment", true]]);
  });
});

describe("replyToCommentId", () => {
  /** An item with a root comment of the user and a question reply of the superagent, `ref` as its client_ref. */
  function questionItem(ref: string | undefined, body = QUESTION) {
    const s = setup();
    const a = s.item("Assigned");
    const root = createComment(s.ctx, a.id, { body_md: "please do it" });
    const asked = createComment(s.agentCtx, a.id, { body_md: body, parent_comment_id: root.id, client_ref: ref });
    return { ...s, a, root, asked };
  }

  it("is the question comment's thread root, found by the client_ref prefix", async () => {
    const { a, web, root } = questionItem("question:rq_q:q1", "Reworded by the runner");
    runner([request("rq_q", a.id, web.id)], QUESTION);
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBe(root.id);
  });

  it("prefers the newest comment with the prefix, and ignores other requests' questions", async () => {
    const { ctx, agentCtx, a, web } = questionItem("question:rq_q:q1");
    const other = createComment(agentCtx, a.id, { body_md: "another request", client_ref: "question:rq_other:q1" });
    const newer = createComment(agentCtx, a.id, { body_md: "asked again", client_ref: "question:rq_q:q2" });
    ctx.sqlite.prepare("UPDATE comment SET created_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(newer.id);
    runner([request("rq_q", a.id, web.id)], QUESTION);
    const open = asItem(await loadSuperagentChat({ itemKey: a.key }));
    expect(open.replyToCommentId).toBe(newer.id);
    expect(open.replyToCommentId).not.toBe(other.id);
  });

  it("falls back to the comment whose trimmed body equals the question", async () => {
    const { a, web, root } = questionItem(undefined, `  ${QUESTION}\n`);
    runner([request("rq_q", a.id, web.id)], QUESTION);
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBe(root.id);
  });

  it("is the comment itself when the question comment is a root", async () => {
    const { ctx, agentCtx, item, web } = setup();
    const a = item("Assigned");
    createComment(ctx, a.id, { body_md: "something" });
    const asked = createComment(agentCtx, a.id, { body_md: "a question", client_ref: "question:rq_q:q1" });
    runner([request("rq_q", a.id, web.id)], "a question");
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBe(asked.id);
  });

  it("is null when no comment matches, when the runner has no open question, and when the detail failed", async () => {
    const { a, web } = questionItem("question:rq_zzz:q1", "something else");
    runner([request("rq_q", a.id, web.id)], QUESTION);
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBeNull();
    runner([request("rq_q", a.id, web.id)], null);
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBeNull();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/requests") return jsonResponse({ requests: [request("rq_q", a.id, web.id)] });
      return jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500);
    });
    const open = asItem(await loadSuperagentChat({ itemKey: a.key }));
    expect(open.detail).toMatchObject({ ok: false });
    expect(open.replyToCommentId).toBeNull();
  });

  it("only counts comments by the superagent actor", async () => {
    const { ctx, item, web } = setup();
    const a = item("Assigned");
    createComment(ctx, a.id, { body_md: QUESTION });
    runner([request("rq_q", a.id, web.id)], QUESTION);
    expect(asItem(await loadSuperagentChat({ itemKey: a.key })).replyToCommentId).toBeNull();
  });
});

