import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL, aiEffort, getAiStatus, setAnthropicForTests, toAiError } from "@/lib/tessera/ai/client";
import { runAssistant } from "@/lib/tessera/ai/assistant";
import { SYSTEM_PROMPT } from "@/lib/tessera/ai/prompts";
import type { AssistantEvent, AssistRequest } from "@/lib/tessera/types";
import { createTestDb } from "../helpers/db";
import { fakeAnthropic, type ScriptedTurn } from "./fake-anthropic";

beforeEach(() => {
  setAnthropicForTests(null);
});

function request(toolset: "core" | "all" = "core"): AssistRequest {
  return {
    conversation_id: crypto.randomUUID(),
    scope: {},
    messages: [{ role: "user", content: "What is open?" }],
    toolset,
  };
}

async function collect(turns: ScriptedTurn[], extra: Parameters<typeof fakeAnthropic>[0] = {}): Promise<{ events: AssistantEvent[]; fake: ReturnType<typeof fakeAnthropic> }> {
  const fake = fakeAnthropic({ turns, ...extra });
  setAnthropicForTests(fake.client);
  const events: AssistantEvent[] = [];
  for await (const event of runAssistant(createTestDb(), request(), new AbortController().signal)) events.push(event);
  return { events, fake };
}

describe("assistant events", () => {
  it("streams text, a tool call and the tool result in order", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { events, fake } = await collect([
      { stopReason: "tool_use", text: "Checking", toolUses: [{ id: "tu_1", name: "list_projects", input: {} }] },
      { stopReason: "end_turn", text: "Nothing is open." },
    ]);
    expect(events.map((event) => event.type)).toEqual(["text_delta", "tool_use", "tool_result", "text_delta", "done"]);
    expect(events[0]).toEqual({ type: "text_delta", text: "Checking" });
    expect(events[1]).toEqual({ type: "tool_use", id: "tu_1", name: "list_projects" });
    expect(events[2]).toMatchObject({ type: "tool_result", id: "tu_1", ok: true });
    expect(events[3]).toEqual({ type: "text_delta", text: "Nothing is open." });
    expect(events[4]).toEqual({ type: "done", stop_reason: "end_turn" });
    expect(info).toHaveBeenCalledWith("ai.usage", expect.objectContaining({ input: 3, output: 2, cache_read: 1 }));
    const body = fake.toolRunnerCalls[0]?.body;
    expect(body?.model).toBe(AI_MODEL);
    expect(body?.max_tokens).toBe(32000);
    expect(body?.stream).toBe(true);
    expect(body?.max_iterations).toBe(12);
    expect(body?.thinking).toEqual({ type: "adaptive" });
    expect(body?.output_config).toEqual({ effort: aiEffort() });
    expect(body?.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body?.fallbacks).toBe("default");
    expect(body).not.toHaveProperty("tool_choice");
    const system = body?.system as { text: string; cache_control?: { type: string } }[];
    expect(system[0]?.text).toBe(SYSTEM_PROMPT);
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(system[1]?.text).toContain("Today:");
    expect(system[1]?.cache_control).toBeUndefined();
    info.mockRestore();
  });

  it("streams a refusal explanation and stops", async () => {
    const { events } = await collect([{ stopReason: "refusal", explanation: "I can't help with that." }]);
    expect(events).toEqual([
      { type: "text_delta", text: "I can't help with that." },
      { type: "done", stop_reason: "refusal" },
    ]);
  });

  it("stops on max_tokens with a tool call and does not run the tool", async () => {
    const { events } = await collect([
      { stopReason: "max_tokens", text: "Partial", toolUses: [{ id: "tu_cut", name: "list_projects", input: {} }] },
      { stopReason: "end_turn", text: "should not appear" },
    ]);
    expect(events.map((event) => event.type)).toEqual(["text_delta", "tool_use", "done"]);
    expect(events.at(-1)).toEqual({ type: "done", stop_reason: "max_tokens", continue: true });
  });

  it("resumes a paused turn", async () => {
    const { events, fake } = await collect([
      { stopReason: "pause_turn", text: "Hold" },
      { stopReason: "end_turn", text: "Resumed" },
    ]);
    expect(events.map((event) => (event.type === "text_delta" ? event.text : event.type))).toEqual(["Hold", "Resumed", "done"]);
    expect(events.at(-1)).toEqual({ type: "done", stop_reason: "end_turn" });
    expect(fake.pushCount).toBe(1);
  });

  it("notices a fallback model", async () => {
    const { events } = await collect([{ stopReason: "end_turn", text: "Hi", fallbackModel: "claude-sonnet-5-5" }]);
    expect(events).toContainEqual({ type: "notice", text: "Answered by claude-sonnet-5-5" });
  });

  it("ends with aborted when the signal is already aborted", async () => {
    const fake = fakeAnthropic({ turns: [{ stopReason: "end_turn", text: "nope" }] });
    setAnthropicForTests(fake.client);
    const signal = new AbortController();
    signal.abort();
    const events: AssistantEvent[] = [];
    for await (const event of runAssistant(createTestDb(), request(), signal.signal)) events.push(event);
    expect(events).toEqual([{ type: "done", stop_reason: "aborted" }]);
    expect(fake.toolRunnerCalls).toHaveLength(0);
  });

  it("treats APIUserAbortError as aborted, not an error", async () => {
    const fake = fakeAnthropic({ abort: true, turns: [{ stopReason: "end_turn", text: "nope" }] });
    setAnthropicForTests(fake.client);
    const events: AssistantEvent[] = [];
    for await (const event of runAssistant(createTestDb(), request(), new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: "done", stop_reason: "aborted" }]);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});

describe("ai status", () => {
  it("reports the model when retrieve succeeds, and caches the answer", async () => {
    let calls = 0;
    const fake = fakeAnthropic({
      retrieve: () => {
        calls += 1;
        return { id: AI_MODEL };
      },
    });
    setAnthropicForTests(fake.client);
    await expect(getAiStatus()).resolves.toEqual({ available: true, model: AI_MODEL });
    await expect(getAiStatus()).resolves.toEqual({ available: true, model: AI_MODEL });
    expect(calls).toBe(1);
  });

  it("maps credential, model and connection failures", async () => {
    const headers = new Headers();
    const auth = fakeAnthropic({ retrieve: () => Promise.reject(new Anthropic.AuthenticationError(401, undefined, "bad key", headers)) });
    setAnthropicForTests(auth.client);
    await expect(getAiStatus()).resolves.toEqual({ available: false, reason: "no_credential" });

    const missing = fakeAnthropic({ retrieve: () => Promise.reject(new Anthropic.NotFoundError(404, undefined, "gone", headers)) });
    setAnthropicForTests(missing.client);
    await expect(getAiStatus()).resolves.toEqual({ available: false, reason: "model_unavailable" });

    const offline = fakeAnthropic({ retrieve: () => Promise.reject(new Anthropic.APIConnectionError({ message: "offline" })) });
    setAnthropicForTests(offline.client);
    await expect(getAiStatus()).resolves.toEqual({ available: false, reason: "offline" });
  });

  it("maps errors for the route", () => {
    const headers = new Headers();
    expect(toAiError(new Anthropic.RateLimitError(429, undefined, "slow down", headers)).kind).toBe("rate_limit");
    expect(toAiError(new Anthropic.RateLimitError(429, undefined, "slow down", headers)).message).toContain("slow down");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(toAiError(new Error("boom"))).toEqual({ kind: "unavailable", message: "Assistant unavailable" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
