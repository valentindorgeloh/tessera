/**
 * Scripted Anthropic client for the AI tests. No network. The tool runner
 * yields one stream per turn and runs `tool_use` calls only when the caller
 * asks for the next turn, which is what `runAssistant` relies on for
 * `max_tokens` (it stops without asking).
 */
import Anthropic from "@anthropic-ai/sdk";

export type ScriptedTurn = {
  stopReason: string;
  text?: string;
  toolUses?: { id: string; name: string; input?: Record<string, unknown> }[];
  explanation?: string;
  fallbackModel?: string;
  model?: string;
  usage?: { input?: number; output?: number; cache_read?: number };
};

export type ScriptedParse = {
  parsed: unknown | null;
  stop_reason?: string;
  text?: string;
  explanation?: string;
  model?: string;
};

type Runnable = {
  name: string;
  parse: (content: unknown) => unknown;
  run: (args: unknown, context?: unknown) => unknown;
};

export type FakeAnthropic = {
  client: Anthropic;
  toolRunnerCalls: { body: Record<string, unknown>; options?: { signal?: AbortSignal } }[];
  createCalls: Record<string, unknown>[];
  parseCalls: Record<string, unknown>[];
  retrieveCalls: string[];
  pushCount: number;
};

export function fakeAnthropic(script: {
  turns?: ScriptedTurn[];
  create?: ScriptedTurn;
  parse?: ScriptedParse;
  parseThrows?: string;
  retrieve?: () => unknown | Promise<unknown>;
  /** The runner throws `APIUserAbortError` before the first turn. */
  abort?: boolean;
} = {}): FakeAnthropic {
  const handle: FakeAnthropic = {
    client: null as unknown as Anthropic,
    toolRunnerCalls: [],
    createCalls: [],
    parseCalls: [],
    retrieveCalls: [],
    pushCount: 0,
  };

  const toolRunner = (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
    handle.toolRunnerCalls.push({ body, options });
    const tools = (body.tools ?? []) as Runnable[];
    return scriptedRunner(handle, script.turns ?? [], tools, options?.signal, script.abort === true);
  };

  const create = async (body: Record<string, unknown>) => {
    handle.createCalls.push(body);
    return messageOf(script.create ?? { stopReason: "end_turn", text: "Digest." });
  };

  const parse = async (body: Record<string, unknown>) => {
    handle.parseCalls.push(body);
    if (script.parseThrows) throw new Anthropic.AnthropicError(script.parseThrows);
    const parsed = script.parse;
    const message = messageOf({
      stopReason: parsed?.stop_reason ?? "end_turn",
      text: parsed?.text,
      explanation: parsed?.explanation,
      model: parsed?.model,
    });
    return { ...message, parsed_output: parsed ? parsed.parsed : null };
  };

  const retrieve = async (id: string) => {
    handle.retrieveCalls.push(id);
    if (script.retrieve) return script.retrieve();
    return { id };
  };

  handle.client = {
    beta: { messages: { toolRunner, create } },
    messages: { parse },
    models: { retrieve },
  } as unknown as Anthropic;
  return handle;
}

function scriptedRunner(handle: FakeAnthropic, turns: ScriptedTurn[], tools: Runnable[], signal: AbortSignal | undefined, abort: boolean) {
  let cursor = 0;
  let resumeArmed = false;
  return {
    pushMessages() {
      handle.pushCount += 1;
      resumeArmed = true;
    },
    async *[Symbol.asyncIterator]() {
      if (abort || signal?.aborted) throw new Anthropic.APIUserAbortError();
      while (cursor < turns.length) {
        const turn = turns[cursor];
        cursor += 1;
        resumeArmed = false;
        yield streamOf(messageOf(turn));
        if (turn.stopReason === "tool_use") {
          await runToolUses(turn, tools);
          continue;
        }
        if (turn.stopReason === "pause_turn") {
          if (!resumeArmed) return;
          continue;
        }
        return;
      }
    },
  };
}

async function runToolUses(turn: ScriptedTurn, tools: Runnable[]): Promise<void> {
  for (const call of turn.toolUses ?? []) {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (!tool) continue;
    try {
      const args = tool.parse(call.input ?? {});
      await tool.run(args, { toolUse: { type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} } });
    } catch {
      // The real runner turns a throw into an error tool result and continues.
    }
  }
}

function streamOf(message: ReturnType<typeof messageOf>) {
  const events: unknown[] = [];
  message.content.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block });
    if (block.type === "text") {
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    }
    events.push({ type: "content_block_stop", index });
  });
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    async finalMessage() {
      return message;
    },
  };
}

function messageOf(turn: ScriptedTurn) {
  const content: { type: string; text?: string; id?: string; name?: string; input?: unknown; to?: { model: string }; from?: { model: string } }[] = [];
  if (turn.fallbackModel) {
    content.push({ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: turn.fallbackModel } });
  }
  if (turn.text) content.push({ type: "text", text: turn.text });
  for (const tool of turn.toolUses ?? []) {
    content.push({ type: "tool_use", id: tool.id, name: tool.name, input: tool.input ?? {} });
  }
  return {
    id: "msg_test",
    type: "message" as const,
    role: "assistant" as const,
    model: turn.model ?? "claude-opus-5-5",
    content,
    stop_reason: turn.stopReason,
    stop_sequence: null,
    stop_details: turn.stopReason === "refusal" ? { category: null, explanation: turn.explanation ?? null, fallback_credit_token: null } : null,
    usage: {
      input_tokens: turn.usage?.input ?? 3,
      output_tokens: turn.usage?.output ?? 2,
      cache_read_input_tokens: turn.usage?.cache_read ?? 1,
    },
  };
}
