/**
 * Beacon target of the description editor
 * (src/app/api/work-items/[workItemId]/description/route.ts) against an
 * in-memory database: success returns the new version, CONFLICT maps to 409
 * with `current_version`, bad bodies to 400, unknown items to 404, archived
 * items to 423, and the path always names the item. A beacon sent while its
 * page's own save was in flight (`if_current_md`) builds on that save. Only
 * same-origin JSON requests are accepted. `@/lib/tessera/server`
 * is replaced by the engine barrel plus a `getDb` over the test database
 * (the real module's "server-only" guard throws under plain Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { archiveWorkItem, createWorkItem, getWorkItem, updateWorkItemDescription } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type DbHandles } from "../helpers/db";

const db: { handles: DbHandles | null } = { handles: null };

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

const { POST } = await import("@/app/api/work-items/[workItemId]/description/route");
const { isJsonContentType, isSameOriginRequest } = await import("@/app/api/request-guards");

function post(workItemId: string, body: string, headers: Record<string, string> = { "Content-Type": "application/json" }): Promise<Response> {
  const request = new NextRequest(`http://127.0.0.1:3000/api/work-items/${workItemId}/description`, { method: "POST", body, headers });
  return POST(request, { params: Promise.resolve({ workItemId }) });
}

function setup() {
  const handles = createTestDb();
  db.handles = handles;
  const ctx = createTestContext(handles);
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(ctx, { project_id: project.id, name: "Beacon target" });
  const other = createWorkItem(ctx, { project_id: project.id, name: "Bystander" });
  const done = listStates(ctx, project.id).find((state) => state.name === "Done");
  if (!done) throw new Error("the default states include Done");
  const finished = createWorkItem(ctx, { project_id: project.id, name: "Finished", state_id: done.id });
  return { handles, ctx, item, other, finished };
}

let fixture: ReturnType<typeof setup>;

beforeEach(() => {
  fixture = setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fixture.handles.sqlite.close();
  db.handles = null;
  vi.restoreAllMocks();
});

describe("POST /api/work-items/[workItemId]/description", () => {
  it("saves the text and returns the new version and cursor, uncached", async () => {
    const { ctx, item } = fixture;
    const response = await post(item.id, JSON.stringify({ description_md: "Hello **world**", expected_description_version: 0 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { ok: boolean; description_version: number; cursor: number };
    expect(body).toMatchObject({ ok: true, description_version: 1 });
    expect(body.cursor).toBeGreaterThan(0);
    expect(getWorkItem(ctx, item.id)).toMatchObject({ description_md: "Hello **world**", description_version: 1 });
  });

  it("answers a stale version with 409 and the current version, leaving the text alone", async () => {
    const { ctx, item } = fixture;
    updateWorkItemDescription(ctx, item.id, { description_md: "theirs", expected_description_version: 0 });
    const response = await post(item.id, JSON.stringify({ description_md: "mine", expected_description_version: 0 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "CONFLICT", current_version: 1 });
    expect(getWorkItem(ctx, item.id).description_md).toBe("theirs");
  });

  it("rejects a body that is not JSON or does not match the input with 400", async () => {
    const { item } = fixture;
    const notJson = await post(item.id, "description_md=x");
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ ok: false, code: "VALIDATION" });

    const missingVersion = await post(item.id, JSON.stringify({ description_md: "x" }));
    expect(missingVersion.status).toBe(400);
    expect(await missingVersion.json()).toMatchObject({ ok: false, code: "VALIDATION" });

    const extraKey = await post(item.id, JSON.stringify({ description_md: "x", expected_description_version: 0, name: "renamed" }));
    expect(extraKey.status).toBe(400);

    const array = await post(item.id, JSON.stringify(["x"]));
    expect(array.status).toBe(400);
  });

  it("answers an unknown item with 404 and an archived one with 423", async () => {
    const { ctx, finished } = fixture;
    const unknown = await post("01a128aa-0000-7000-8000-00000000ffff", JSON.stringify({ description_md: "x", expected_description_version: 0 }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ ok: false, code: "NOT_FOUND" });

    archiveWorkItem(ctx, finished.id);
    const archived = await post(finished.id, JSON.stringify({ description_md: "x", expected_description_version: 0 }));
    expect(archived.status).toBe(423);
    expect(await archived.json()).toMatchObject({ ok: false, code: "ARCHIVED" });
  });

  it("writes the item the path names even when the body carries another id", async () => {
    const { ctx, item, other } = fixture;
    const response = await post(item.id, JSON.stringify({ work_item_id: other.id, description_md: "path wins", expected_description_version: 0 }));
    expect(response.status).toBe(200);
    expect(getWorkItem(ctx, item.id).description_md).toBe("path wins");
    expect(getWorkItem(ctx, other.id).description_md).toBe("");
  });

  it("builds on the page's own in-flight save that landed first (if_current_md)", async () => {
    const { ctx, item } = fixture;
    // The page had version 0, sent "ab" through the Server Action, then typed "abc" and left: the action lands first.
    updateWorkItemDescription(ctx, item.id, { description_md: "ab", expected_description_version: 0 });
    const response = await post(item.id, JSON.stringify({ description_md: "abc", expected_description_version: 0, if_current_md: "ab" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, description_version: 2 });
    expect(getWorkItem(ctx, item.id)).toMatchObject({ description_md: "abc", description_version: 2 });
  });

  it("applies directly when the in-flight save never landed", async () => {
    const { ctx, item } = fixture;
    const response = await post(item.id, JSON.stringify({ description_md: "abc", expected_description_version: 0, if_current_md: "ab" }));
    expect(response.status).toBe(200);
    expect(getWorkItem(ctx, item.id)).toMatchObject({ description_md: "abc", description_version: 1 });
  });

  it("still answers CONFLICT when somebody else wrote since (other text, or more than one version)", async () => {
    const { ctx, item } = fixture;
    updateWorkItemDescription(ctx, item.id, { description_md: "theirs", expected_description_version: 0 });
    const other = await post(item.id, JSON.stringify({ description_md: "abc", expected_description_version: 0, if_current_md: "ab" }));
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ ok: false, code: "CONFLICT", current_version: 1 });
    expect(getWorkItem(ctx, item.id).description_md).toBe("theirs");

    // "ab" is there, but two versions on: a write landed between our save and the beacon's base.
    updateWorkItemDescription(ctx, item.id, { description_md: "ab", expected_description_version: 1 });
    const skipped = await post(item.id, JSON.stringify({ description_md: "abc", expected_description_version: 0, if_current_md: "ab" }));
    expect(skipped.status).toBe(409);
    expect(getWorkItem(ctx, item.id)).toMatchObject({ description_md: "ab", description_version: 2 });
  });

  it("rejects an if_current_md that is not a string with 400", async () => {
    const { item } = fixture;
    const response = await post(item.id, JSON.stringify({ description_md: "x", expected_description_version: 0, if_current_md: 3 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("refuses bodies that are not application/json with 415 (a cross-site text/plain form post)", async () => {
    const { ctx, item } = fixture;
    // What `<form enctype="text/plain">` with name `{"description_md":"x` and value `y","expected_description_version":0}` sends.
    const formBody = '{"description_md":"x=y","expected_description_version":0}';
    const response = await post(item.id, formBody, { "Content-Type": "text/plain" });
    expect(response.status).toBe(415);
    expect(getWorkItem(ctx, item.id).description_md).toBe("");
    const charset = await post(item.id, JSON.stringify({ description_md: "ok", expected_description_version: 0 }), { "Content-Type": "application/json; charset=UTF-8" });
    expect(charset.status).toBe(200);
  });

  it("refuses browser requests from another origin with 403", async () => {
    const { ctx, item } = fixture;
    const body = JSON.stringify({ description_md: "x", expected_description_version: 0 });
    const crossSite = await post(item.id, body, { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" });
    expect(crossSite.status).toBe(403);
    const sameSite = await post(item.id, body, { "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" });
    expect(sameSite.status).toBe(403);
    const foreignOrigin = await post(item.id, body, { "Content-Type": "application/json", Origin: "https://evil.test", Host: "127.0.0.1:3000" });
    expect(foreignOrigin.status).toBe(403);
    expect(getWorkItem(ctx, item.id).description_md).toBe("");
    const sameOrigin = await post(item.id, body, { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Origin: "http://127.0.0.1:3000" });
    expect(sameOrigin.status).toBe(200);
  });
});

describe("request guards", () => {
  it("accepts same-origin browser requests and requests without browser headers", () => {
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOriginRequest(new Headers({ origin: "https://app.test", host: "internal:3000", "x-forwarded-host": "app.test" }))).toBe(true);
    expect(isSameOriginRequest(new Headers())).toBe(true);
  });

  it("rejects other sites, other origins and malformed origins", () => {
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ origin: "http://127.0.0.1:4000", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ origin: "null", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOriginRequest(new Headers({ origin: "http://127.0.0.1:3000" }))).toBe(false);
  });

  it("recognises JSON content types only", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/jsonx")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});
