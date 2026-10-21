import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAiStatus, getAnthropic, setAnthropicForTests } from "@/lib/tessera/ai/client";
import { runAssistant } from "@/lib/tessera/ai/assistant";
import { assertFakeAiAllowed, loadRecordings, pickRecording } from "@/lib/tessera/ai/fake-client";
import { listProposals } from "@/lib/tessera/ai/proposals";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, getWorkItem } from "@/lib/tessera/work-items";
import type { AssistantEvent } from "@/lib/tessera/types";
import { createTestContext, createTestDb } from "../helpers/db";

const FIXTURES = path.resolve("tests/e2e/fixtures/ai");

beforeEach(() => {
  setAnthropicForTests(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setAnthropicForTests(null);
});

describe("TESSERA_AI_FAKE guard (decision 124)", () => {
  it("refuses a production server on the default database", () => {
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "production" })).toThrow(/decision 124/);
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "production", TESSERA_DB_PATH: "data/tessera.db" })).toThrow(/decision 124/);
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "production", TESSERA_DB_PATH: path.resolve("data/tessera.db") })).toThrow(/decision 124/);
  });

  it("allows production on another database, and any other mode", () => {
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "production", TESSERA_DB_PATH: "data/e2e.db" })).not.toThrow();
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "production", TESSERA_DB_PATH: ":memory:" })).not.toThrow();
    expect(() => assertFakeAiAllowed({ TESSERA_AI_FAKE: "x", NODE_ENV: "development" })).not.toThrow();
    expect(() => assertFakeAiAllowed({ NODE_ENV: "production" })).not.toThrow();
  });

  it("stops getAnthropic before it builds the fake client", () => {
    vi.stubEnv("TESSERA_AI_FAKE", FIXTURES);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TESSERA_DB_PATH", "data/tessera.db");
    expect(() => getAnthropic()).toThrow(/decision 124/);
  });
});

describe("replay client", () => {
  it("reports the assistant as available without a network call", async () => {
    vi.stubEnv("TESSERA_AI_FAKE", FIXTURES);
    vi.stubEnv("TESSERA_DB_PATH", ":memory:");
    // The cached singleton from an earlier test would hide the env switch.
    const status = await getAiStatus();
    expect(status.available).toBe(true);
  });

  it("matches a recording by the last user message and falls back to the default", () => {
    const recordings = loadRecordings(FIXTURES);
    expect(pickRecording(recordings, "Please RAISE the priority of AIX-1")?.match).toBe("raise the priority of AIX-1");
    expect(pickRecording(recordings, "something else")?.match).toBeUndefined();
  });

  it("proposes the recorded update and writes nothing until Apply", async () => {
    vi.stubEnv("TESSERA_AI_FAKE", FIXTURES);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "AI check", identifier: "AIX" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Tune the thing" });
    expect(item.priority).toBe("none");

    const events: AssistantEvent[] = [];
    const conversation = crypto.randomUUID();
    for await (const event of runAssistant(
      handles,
      { conversation_id: conversation, scope: { project_id: project.id }, messages: [{ role: "user", content: "Raise the priority of AIX-1 to urgent" }], toolset: "core" },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    info.mockRestore();

    expect(events.at(-1)).toEqual({ type: "done", stop_reason: "end_turn" });
    const proposal = events.find((event) => event.type === "proposal");
    expect(proposal).toBeDefined();
    expect(getWorkItem(ctx, item.id).priority).toBe("none");
    expect(listProposals(ctx, { conversation_id: conversation })).toHaveLength(1);
  });
});
