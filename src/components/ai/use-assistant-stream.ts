/**
 * `POST /api/ai/assist` as a stream of `AssistantEvent`s (docs/drafts/p5-plan.md
 * §6, decision 39). Stop aborts `signal`; an abort is not an error event.
 */
import type { AssistantEvent, AssistRequest } from "@/lib/tessera/types";
import { createSseParser } from "./sse-parse";

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === "AbortError";
}

function errorEvent(status: number, body: unknown): AssistantEvent {
  const record = typeof body === "object" && body !== null ? (body as { kind?: unknown; message?: unknown }) : {};
  const kind =
    record.kind === "auth" || record.kind === "rate_limit" || record.kind === "unavailable"
      ? record.kind
      : status === 401
        ? "auth"
        : status === 429
          ? "rate_limit"
          : "unavailable";
  const message = typeof record.message === "string" && record.message !== "" ? record.message : "Assistant unavailable";
  return { type: "error", kind, message };
}

/**
 * Reads the response body and calls `onEvent` for each validated frame.
 * A non-OK response becomes one error event. Aborting `signal` returns
 * without one.
 */
export async function streamAssist(body: AssistRequest, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/ai/assist", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    onEvent({ type: "error", kind: "unavailable", message: "Assistant unavailable" });
    return;
  }
  if (!response.ok || response.body === null) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    onEvent(errorEvent(response.status, payload));
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const push = createSseParser(onEvent);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      push(decoder.decode(next.value, { stream: true }));
    }
    push(decoder.decode());
    push("\n\n");
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    onEvent({ type: "error", kind: "unavailable", message: "Assistant unavailable" });
  }
}
