/**
 * SSE framing of POST /api/ai/assist (src/app/api/ai/sse.ts): one event is
 * `event: <type>\ndata: <json>\n\n`, frames leave the stream as the generator
 * yields them, and a throw becomes the final error event unless the client
 * stopped or went away.
 */
import { describe, expect, it } from "vitest";
import { encodeSse, SSE_HEADERS, sseStream } from "@/app/api/ai/sse";
import type { AssistantEvent } from "@/lib/tessera/types";

const errorEvent = { type: "error", kind: "unavailable", message: "Assistant unavailable" } as const;

describe("encodeSse", () => {
  it("frames an event as one SSE record", () => {
    const event = { type: "text_delta", text: "Hello" } as const;
    expect(encodeSse(event)).toBe(`event: text_delta\ndata: ${JSON.stringify(event)}\n\n`);
  });

  it("keeps data on one line when the text contains a newline", () => {
    const event = { type: "text_delta", text: "a\nb" } as const;
    expect(encodeSse(event).split("\n")).toEqual(["event: text_delta", `data: ${JSON.stringify(event)}`, "", ""]);
  });

  it("uses the event type as the SSE event name", () => {
    const event = { type: "done", stop_reason: "end_turn", continue: true } as const;
    expect(encodeSse(event).startsWith("event: done\n")).toBe(true);
    expect(encodeSse(event)).toContain(JSON.stringify(event));
  });
});

describe("SSE_HEADERS", () => {
  it("asks intermediaries not to buffer the stream", () => {
    expect(SSE_HEADERS).toEqual({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
  });
});

describe("sseStream", () => {
  it("enqueues each event as the generator yields it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* events(): AsyncGenerator<AssistantEvent> {
      yield { type: "text_delta", text: "a" };
      await gate;
      yield { type: "done", stop_reason: "end_turn" };
    }
    const stream = sseStream(events(), new AbortController().signal, () => {
      throw new Error("onError should not run");
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe(encodeSse({ type: "text_delta", text: "a" }));

    let settled = false;
    const second = reader.read().then((chunk) => {
      settled = true;
      return chunk;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    const next = await second;
    expect(decoder.decode(next.value)).toBe(encodeSse({ type: "done", stop_reason: "end_turn" }));
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("turns a generator throw into the final error event", async () => {
    const seen: unknown[] = [];
    async function* events(): AsyncGenerator<AssistantEvent> {
      yield { type: "notice", text: "hi" };
      throw new Error("model down");
    }
    const stream = sseStream(events(), new AbortController().signal, (err) => {
      seen.push(err);
      return errorEvent;
    });
    const text = await new Response(stream).text();
    expect(text).toBe(encodeSse({ type: "notice", text: "hi" }) + encodeSse(errorEvent));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
  });

  it("does not call onError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    async function* events(): AsyncGenerator<AssistantEvent> {
      throw new Error("aborted");
    }
    const stream = sseStream(events(), controller.signal, () => {
      called = true;
      return errorEvent;
    });
    expect(await new Response(stream).text()).toBe("");
    expect(called).toBe(false);
  });

  it("closes the generator when the stream is cancelled", async () => {
    let returned = false;
    const iterator: AsyncIterator<AssistantEvent> = {
      next() {
        return Promise.resolve({ done: false, value: { type: "text_delta", text: "a" } });
      },
      return() {
        returned = true;
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    const events: AsyncIterable<AssistantEvent> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    const stream = sseStream(events, new AbortController().signal, () => {
      throw new Error("onError should not run");
    });
    await stream.cancel();
    expect(returned).toBe(true);
  });

  it("does not report an error when the client cancels mid-event", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    async function* events(): AsyncGenerator<AssistantEvent> {
      await gate;
      yield { type: "text_delta", text: "late" };
    }
    const stream = sseStream(events(), new AbortController().signal, () => {
      calls += 1;
      return errorEvent;
    });
    const reader = stream.getReader();
    const pending = reader.read();
    await reader.cancel();
    release();
    await pending;
    expect(calls).toBe(0);
  });
});
