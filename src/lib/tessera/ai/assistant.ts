/**
 * One assistant turn (decision 35, decision 36). Text history only: the scope
 * block carries this conversation's proposals, and tool calls are not replayed.
 * Stream events and the events tools emit share one queue so they stay in order.
 */
import type { BetaMessage, BetaMessageParam, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import Anthropic from "@anthropic-ai/sdk";
import { AI_BETAS, AI_FALLBACKS, AI_MODEL, aiEffort, assistantContext, getAnthropic, toAiError } from "./client";
import { createEventQueue, type EventQueue } from "./event-queue";
import { describeScope, SYSTEM_PROMPT } from "./prompts";
import { listProposals } from "./proposals";
import type { DbHandles } from "../db/client";
import type { AssistantEvent, AssistRequest } from "../types";
import { buildAssistantTools } from "../tools/anthropic";

const CHAT_MAX_TOKENS = 32_000;
const MAX_ITERATIONS = 12;
/** A paused turn is sent back at most twice; a third pause ends the stream. */
const MAX_PAUSE_RESUMES = 2;

export async function* runAssistant(handles: DbHandles, request: AssistRequest, signal: AbortSignal): AsyncGenerator<AssistantEvent> {
  const queue = createEventQueue<AssistantEvent>();
  const produced = produce(queue, handles, request, signal);
  try {
    yield* queue;
  } finally {
    queue.close();
    await produced;
  }
}

async function produce(queue: EventQueue<AssistantEvent>, handles: DbHandles, request: AssistRequest, signal: AbortSignal): Promise<void> {
  let stopReason = "end_turn";
  let ended = false;
  try {
    if (signal.aborted) {
      queue.push({ type: "done", stop_reason: "aborted" });
      return;
    }
    const ctx = assistantContext(handles);
    const proposals = listProposals(ctx, { conversation_id: request.conversation_id });
    const scopeBlock = describeScope(ctx, request.scope, proposals);
    const tools = buildAssistantTools(handles, {
      toolset: request.toolset ?? "all",
      conversationId: request.conversation_id,
      projectId: request.scope.project_id ?? null,
      emit: (event) => queue.push(event),
    });
    const runner = getAnthropic().beta.messages.toolRunner(
      {
        model: AI_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        stream: true,
        max_iterations: MAX_ITERATIONS,
        thinking: { type: "adaptive" },
        output_config: { effort: aiEffort() },
        betas: [...AI_BETAS],
        fallbacks: AI_FALLBACKS,
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: scopeBlock },
        ],
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
        tools,
      },
      { signal },
    );
    let pauseResumes = 0;
    for await (const messageStream of runner) {
      if (signal.aborted) {
        queue.push({ type: "done", stop_reason: "aborted" });
        ended = true;
        break;
      }
      for await (const event of messageStream) {
        const mapped = mapStreamEvent(event);
        if (mapped) queue.push(mapped);
      }
      const message = await messageStream.finalMessage();
      logUsage(message);
      for (const block of message.content) {
        if (block.type === "fallback") queue.push({ type: "notice", text: `Answered by ${block.to.model}` });
      }
      stopReason = message.stop_reason ?? "end_turn";
      if (stopReason === "refusal") {
        const explanation = message.stop_details?.explanation;
        if (explanation) queue.push({ type: "text_delta", text: explanation });
        queue.push({ type: "done", stop_reason: "refusal" });
        ended = true;
        break;
      }
      if (stopReason === "max_tokens") {
        queue.push({ type: "done", stop_reason: "max_tokens", continue: true });
        ended = true;
        break;
      }
      if (stopReason === "pause_turn") {
        if (pauseResumes >= MAX_PAUSE_RESUMES) {
          queue.push({ type: "done", stop_reason: "pause_turn" });
          ended = true;
          break;
        }
        pauseResumes += 1;
        runner.pushMessages({ role: "assistant", content: message.content as BetaMessageParam["content"] });
      }
    }
    if (!ended) queue.push({ type: "done", stop_reason: stopReason });
  } catch (err) {
    if (isAbort(err, signal)) queue.push({ type: "done", stop_reason: "aborted" });
    else {
      const mapped = toAiError(err);
      queue.push({ type: "error", kind: mapped.kind, message: mapped.message });
    }
  } finally {
    queue.close();
  }
}

function mapStreamEvent(event: BetaRawMessageStreamEvent): AssistantEvent | null {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    return { type: "text_delta", text: event.delta.text };
  }
  if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
    return { type: "tool_use", id: event.content_block.id, name: event.content_block.name };
  }
  return null;
}

function logUsage(message: BetaMessage): void {
  console.info("ai.usage", {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    cache_read: message.usage.cache_read_input_tokens ?? 0,
  });
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof Anthropic.APIUserAbortError;
}
