import { beforeEach, describe, expect, it } from "vitest";
import { registerActor } from "@/lib/tessera/actors";
import { subscribe } from "@/lib/tessera/assignees";
import { setAnthropicForTests } from "@/lib/tessera/ai/client";
import { generateDigest } from "@/lib/tessera/ai/digest";
import { DIGEST_SYSTEM, INBOX_DIGEST_SYSTEM } from "@/lib/tessera/ai/prompts";
import { TrackerError } from "@/lib/tessera/core/errors";
import { createCycle } from "@/lib/tessera/cycles";
import { createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "../helpers/db";
import { fakeAnthropic } from "./fake-anthropic";

beforeEach(() => {
  setAnthropicForTests(null);
});

function cycleId(): { handles: ReturnType<typeof createTestDb>; id: string } {
  const handles = createTestDb();
  const ctx = createTestContext(handles);
  const project = createProject(ctx, { name: "Web", identifier: "WEB" });
  const cycle = createCycle(ctx, { project_id: project.id, name: "Sprint" });
  return { handles, id: cycle.id };
}

describe("digests", () => {
  it("stores the model's text and skips a second call when the input seq is unchanged", async () => {
    const { handles, id } = cycleId();
    const fake = fakeAnthropic({ create: { stopReason: "end_turn", text: "WEB-1 needs a decision.", model: "claude-opus-5-5" } });
    setAnthropicForTests(fake.client);
    const first = await generateDigest(handles, "cycle", id);
    expect(first.body_md).toBe("WEB-1 needs a decision.");
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.is_stale).toBe(false);
    const body = fake.createCalls[0];
    expect(body?.max_tokens).toBe(16000);
    expect(body?.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body?.fallbacks).toBe("default");
    expect(body?.system).toBe(DIGEST_SYSTEM);
    expect(body?.thinking).toEqual({ type: "adaptive" });
    expect(body).not.toHaveProperty("tool_choice");
    const again = await generateDigest(handles, "cycle", id);
    expect(again.body_md).toBe(first.body_md);
    expect(fake.createCalls).toHaveLength(1);
  });

  it("refuses with digest_refused and does not store a row", async () => {
    const { handles, id } = cycleId();
    const fake = fakeAnthropic({ create: { stopReason: "refusal", explanation: "Not this one." } });
    setAnthropicForTests(fake.client);
    try {
      await generateDigest(handles, "cycle", id);
      expect.fail("expected a rule");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackerError);
      expect((err as TrackerError).code).toBe("RULE");
      expect((err as TrackerError).details).toEqual({ rule: "digest_refused" });
      expect((err as TrackerError).message).toBe("Not this one.");
    }
    const retry = fakeAnthropic({ create: { stopReason: "end_turn", text: "Now." } });
    setAnthropicForTests(retry.client);
    const stored = await generateDigest(handles, "cycle", id);
    expect(stored.body_md).toBe("Now.");
    expect(retry.createCalls).toHaveLength(1);
  });

  it("writes an inbox digest from unread notifications and skips the model when they have not changed", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Login" });
    const agent = registerActor(ctx, { kind: "agent", name: "mcp:inbox-digest" });
    subscribe(ctx, item.id, agent.id);
    const next = listStates(ctx, project.id).find((state) => state.id !== item.state_id);
    expect(next).toBeDefined();
    updateWorkItem(ctx, item.id, { state_id: next!.id });

    const fake = fakeAnthropic({ create: { stopReason: "end_turn", text: "WEB-1 changed state.", model: "claude-opus-5-5" } });
    setAnthropicForTests(fake.client);
    const first = await generateDigest(handles, "inbox", agent.id);
    expect(first.kind).toBe("inbox");
    expect(first.entity_id).toBe(agent.id);
    expect(first.body_md).toBe("WEB-1 changed state.");
    expect(first.is_stale).toBe(false);
    const body = fake.createCalls[0];
    expect(body?.system).toBe(INBOX_DIGEST_SYSTEM);
    expect(body).not.toHaveProperty("tool_choice");
    const content = (body?.messages as { content: string }[])[0]?.content ?? "";
    expect(content).toContain("state_changed");
    expect(content).toContain("WEB-1");
    expect(content).not.toContain("\"progress\"");

    const again = await generateDigest(handles, "inbox", agent.id);
    expect(again.body_md).toBe(first.body_md);
    expect(fake.createCalls).toHaveLength(1);
  });
});
