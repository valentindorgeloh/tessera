/**
 * SSE parser for the assistant stream (src/components/ai/sse-parse.ts).
 * Split chunks, multi-line data, and frames that fail AssistantEventSchema.
 */
import { describe, expect, it } from "vitest";
import type { AssistantEvent } from "@/lib/tessera/types";
import { createSseParser } from "@/components/ai/sse-parse";

function collect(chunks: string[]): AssistantEvent[] {
  const events: AssistantEvent[] = [];
  const push = createSseParser((event) => events.push(event));
  for (const chunk of chunks) push(chunk);
  return events;
}

describe("createSseParser", () => {
  it("parses one frame", () => {
    expect(collect(['event: text_delta\ndata: {"type":"text_delta","text":"Hello"}\n\n'])).toEqual([{ type: "text_delta", text: "Hello" }]);
  });

  it("joins a frame split across chunks, including a line broken in the middle", () => {
    const events = collect(['data: {"type":"text_del', 'ta","text":"Hi"}\n\n']);
    expect(events).toEqual([{ type: "text_delta", text: "Hi" }]);
  });

  it("joins multi-line data fields and accepts CRLF frames", () => {
    const events = collect(['event: text_delta\r\ndata: {"type":\r\ndata: "text_delta","text":"Yo"}\r\n\r\n']);
    expect(events).toEqual([{ type: "text_delta", text: "Yo" }]);
  });

  it("delivers several frames from one chunk and keeps a trailing partial frame", () => {
    const events: AssistantEvent[] = [];
    const push = createSseParser((event) => events.push(event));
    push('data: {"type":"notice","text":"Answered by claude"}\n\ndata: {"type":"text_del');
    expect(events).toEqual([{ type: "notice", text: "Answered by claude" }]);
    push('ta","text":"x"}\n\n');
    expect(events).toEqual([
      { type: "notice", text: "Answered by claude" },
      { type: "text_delta", text: "x" },
    ]);
  });

  it("drops comments, empty frames, invalid JSON and events that fail the schema", () => {
    const events = collect([
      ": keep-alive\n\n",
      "\n\n",
      "data: not-json\n\n",
      'data: {"type":"nope"}\n\n',
      'data: {"type":"done","stop_reason":"end_turn"}\n\n',
    ]);
    expect(events).toEqual([{ type: "done", stop_reason: "end_turn" }]);
  });

  it("flushes a final frame when the caller sends the closing blank line", () => {
    const events = collect(['data: {"type":"error","kind":"unavailable","message":"Assistant unavailable"}\n', "\n"]);
    expect(events).toEqual([{ type: "error", kind: "unavailable", message: "Assistant unavailable" }]);
  });
});
