/**
 * Server-sent-event framing of `POST /api/ai/assist` (docs/drafts/p5-plan.md
 * §5). One `AssistantEvent` is one frame, `event: <type>\ndata: <json>\n\n`;
 * `JSON.stringify` never emits a raw newline, so `data:` is always one line
 * (the client parser, src/components/ai/sse-parse.ts, reads it back). Pure:
 * no engine and no Next imports, so Vitest loads it
 * (tests/ui/sse-encode.test.ts).
 */
import type { AssistantEvent } from "@/lib/tessera/types";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  // Stops a reverse proxy from buffering the stream until it ends.
  "X-Accel-Buffering": "no",
} as const;

/** One SSE frame for `event`. */
export function encodeSse(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * A byte stream that enqueues one frame per event as the generator yields it
 * (nothing is collected first, so the browser sees the answer build up).
 * `onError` turns a throw from the generator into the final event; it is not
 * called when `signal` is aborted or the client has cancelled, because a
 * stopped answer is not an error. Cancelling the stream closes the generator.
 */
export function sseStream(
  events: AsyncIterable<AssistantEvent>,
  signal: AbortSignal,
  onError: (err: unknown) => AssistantEvent,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (closed) return;
        if (next.done === true) {
          closed = true;
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeSse(next.value)));
      } catch (err) {
        if (closed) return;
        closed = true;
        if (!signal.aborted) controller.enqueue(encoder.encode(encodeSse(onError(err))));
        controller.close();
      }
    },
    async cancel() {
      closed = true;
      await iterator.return?.();
    },
  });
}
