/**
 * `POST /api/ai/digest` accepts the keys the cards send: a uuid for a cycle,
 * module or inbox, "workspace" for the Home digest (decision 73) and
 * `<tab>:<projects>:<range>` for the Analytics narrative (decision 81). The
 * Home and Analytics cards used to answer 400 because the body schema wanted a
 * uuid for every kind. `@/lib/tessera/server` is replaced by the engine barrel
 * plus a `getDb` over the test database (the real module's "server-only" guard
 * throws under plain Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setAnthropicForTests } from "@/lib/tessera/ai/client";
import { createProject } from "@/lib/tessera/projects";
import { DigestViewSchema } from "@/lib/tessera/schemas";
import { createTestContext, createTestDb, type DbHandles } from "../helpers/db";
import { fakeAnthropic } from "./fake-anthropic";

const db: { handles: DbHandles | null } = { handles: null };

vi.mock("@/lib/tessera/server", async () => {
  const engine = await vi.importActual<typeof import("@/lib/tessera")>("@/lib/tessera");
  const ai = await vi.importActual<typeof import("@/lib/tessera/ai")>("@/lib/tessera/ai");
  return {
    ...engine,
    generateDigest: ai.generateDigest,
    toAiError: ai.toAiError,
    getDb: () => {
      if (db.handles === null) throw new Error("test database not open");
      return db.handles;
    },
  };
});

const { POST } = await import("@/app/api/ai/digest/route");

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://127.0.0.1:3000/api/ai/digest", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  db.handles = createTestDb();
  setAnthropicForTests(fakeAnthropic({ create: { stopReason: "end_turn", text: "Everything is quiet." } }).client);
});

afterEach(() => {
  setAnthropicForTests(null);
  db.handles = null;
});

describe("POST /api/ai/digest", () => {
  it("summarises the Home digest under the id workspace", async () => {
    const response = await post({ kind: "home", id: "workspace" });
    expect(response.status).toBe(200);
    const parsed = DigestViewSchema.parse(await response.json());
    expect(parsed).toMatchObject({ kind: "home", entity_id: "workspace", body_md: "Everything is quiet." });
  });

  it("summarises an Analytics narrative under its tab:projects:range key", async () => {
    const project = createProject(createTestContext(db.handles as DbHandles), { name: "Web", identifier: "WEB" });
    for (const id of ["work-items:all:30d", `work-items:${project.id}:30d`]) {
      const response = await post({ kind: "analytics", id });
      expect(response.status, id).toBe(200);
      expect(DigestViewSchema.parse(await response.json()).entity_id).toBe(id);
    }
  });

  it("still wants a uuid for a cycle, a module and an inbox", async () => {
    for (const kind of ["cycle", "module", "inbox"]) {
      const response = await post({ kind, id: "workspace" });
      expect(response.status, kind).toBe(400);
    }
  });

  it("answers 400 for an empty id and 400 from the engine for a malformed analytics key", async () => {
    expect((await post({ kind: "home", id: "" })).status).toBe(400);
    expect((await post({ kind: "analytics", id: "nonsense" })).status).toBe(400);
  });
});
