/**
 * Scripted Anthropic client, no network (decision 124). Two users share it:
 * the Vitest AI tests (`fakeAnthropic`, re-exported by tests/ai/fake-anthropic.ts)
 * and the Playwright server (`createReplayClient`), which replays the recorded
 * turns in `tests/e2e/fixtures/ai/*.json` when `TESSERA_AI_FAKE=<dir>` is set.
 *
 * The tool runner yields one stream per turn and runs `tool_use` calls only
 * when the caller asks for the next turn, which is what `runAssistant` relies
 * on for `max_tokens` (it stops without asking).
 *
 * Recorded tool inputs may carry two placeholders, resolved when the tool runs:
 * `{{result:<tool_use_id>.<dot.path>}}` reads a field of an earlier tool result
 * in the same conversation turn, and `{{scope:<name>}}` reads the uuid that ends
 * the scope line `<name> (...) <uuid>` (a state, label, cycle or module).
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DB_PATH, resolveDbPath } from "../db/client";

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

export type FakeScript = {
  /** A function picks the turns from the request body (the replay client matches the last user message). */
  turns?: ScriptedTurn[] | ((body: Record<string, unknown>) => ScriptedTurn[]);
  create?: ScriptedTurn;
  parse?: ScriptedParse;
  parseThrows?: string;
  retrieve?: () => unknown | Promise<unknown>;
  /** The runner throws `APIUserAbortError` before the first turn. */
  abort?: boolean;
};

export function fakeAnthropic(script: FakeScript = {}): FakeAnthropic {
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
    const turns = typeof script.turns === "function" ? script.turns(body) : (script.turns ?? []);
    return scriptedRunner(handle, turns, tools, options?.signal, script.abort === true, scopeTextOf(body));
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

function scriptedRunner(
  handle: FakeAnthropic,
  turns: ScriptedTurn[],
  tools: Runnable[],
  signal: AbortSignal | undefined,
  abort: boolean,
  scopeText: string,
) {
  let cursor = 0;
  let resumeArmed = false;
  const results = new Map<string, unknown>();
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
          await runToolUses(turn, tools, results, scopeText);
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

async function runToolUses(turn: ScriptedTurn, tools: Runnable[], results: Map<string, unknown>, scopeText: string): Promise<void> {
  for (const call of turn.toolUses ?? []) {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (!tool) continue;
    try {
      const input = resolveTemplates(call.input ?? {}, results, scopeText) as Record<string, unknown>;
      const args = tool.parse(input);
      const output = await tool.run(args, { toolUse: { type: "tool_use", id: call.id, name: call.name, input } });
      results.set(call.id, parseJson(output));
    } catch {
      // The real runner turns a throw into an error tool result and continues.
    }
  }
}

function parseJson(output: unknown): unknown {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

const TEMPLATE = /^\{\{(result|scope):(.+)\}\}$/;

function resolveTemplates(value: unknown, results: Map<string, unknown>, scopeText: string): unknown {
  if (typeof value === "string") {
    const match = TEMPLATE.exec(value);
    if (!match) return value;
    return match[1] === "result" ? fromResult(match[2], results) : fromScope(match[2], scopeText);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveTemplates(entry, results, scopeText));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveTemplates(entry, results, scopeText)]));
  }
  return value;
}

function fromResult(spec: string, results: Map<string, unknown>): unknown {
  const [toolUseId, ...segments] = spec.split(".");
  let current: unknown = results.get(toolUseId);
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function fromScope(name: string, scopeText: string): string | undefined {
  for (const line of scopeText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${name} `)) continue;
    const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i.exec(trimmed);
    if (id) return id[1];
  }
  return undefined;
}

/** The text of the system blocks: the scope block lists the project's states, labels, cycles and modules with ids. */
function scopeTextOf(body: Record<string, unknown>): string {
  const system = body.system;
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return "";
  return system.map((block) => (block && typeof block === "object" ? String((block as { text?: unknown }).text ?? "") : "")).join("\n");
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

/** One recorded conversation. `match` is a case-insensitive substring of the last user message; a file without one answers everything else. */
export type Recording = {
  match?: string;
  turns?: ScriptedTurn[];
  create?: ScriptedTurn;
  parse?: ScriptedParse;
};

/** Every `*.json` file of `dir`, in file-name order. A file holds one recording or an array of them. */
export function loadRecordings(dir: string): Recording[] {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.flatMap((name) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Recording | Recording[];
    return Array.isArray(raw) ? raw : [raw];
  });
}

function lastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  }
  return "";
}

/** The recording whose `match` is in the prompt, else the first one without `match`. */
export function pickRecording(recordings: Recording[], prompt: string): Recording | undefined {
  const lowered = prompt.toLowerCase();
  const hit = recordings.find((recording) => recording.turns && recording.match && lowered.includes(recording.match.toLowerCase()));
  return hit ?? recordings.find((recording) => recording.turns && !recording.match);
}

/** The Anthropic client for `TESSERA_AI_FAKE=<dir>`: chat turns, digest (`create`) and view parse replay the recordings. */
export function createReplayClient(dir: string): Anthropic {
  const recordings = loadRecordings(dir);
  return fakeAnthropic({
    turns: (body) => pickRecording(recordings, lastUserText(body))?.turns ?? [{ stopReason: "end_turn", text: "No recorded turn matches this prompt." }],
    create: recordings.find((recording) => recording.create)?.create,
    parse: recordings.find((recording) => recording.parse)?.parse,
  }).client;
}

/**
 * Decision 124: the fake never answers the user's real workspace. It is refused
 * in a production build whose database is the default `data/tessera.db`.
 * `env` is a parameter so the guard is testable without touching `process.env`.
 */
export function assertFakeAiAllowed(env: Record<string, string | undefined> = process.env): void {
  if (!env.TESSERA_AI_FAKE) return;
  if (env.NODE_ENV !== "production") return;
  const configured = resolveDbPath(env.TESSERA_DB_PATH ?? DEFAULT_DB_PATH);
  if (configured === resolveDbPath(DEFAULT_DB_PATH)) {
    throw new Error("TESSERA_AI_FAKE is refused in production on the default database (data/tessera.db), decision 124.");
  }
}
