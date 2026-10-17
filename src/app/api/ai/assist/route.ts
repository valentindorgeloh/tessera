import { type NextRequest } from "next/server";
import { guardAiRequest } from "@/lib/http-guard";
import { AssistRequestSchema, getDb, runAssistant, toAiError } from "@/lib/tessera/server";
import { SSE_HEADERS, sseStream } from "../sse";

/**
 * `POST /api/ai/assist` (docs/drafts/p5-plan.md §5): the assistant's answer as
 * server-sent events. The body is an `AssistRequest` (400 `{ code: "VALIDATION" }`
 * when it is not). Next streams a route with `new Response(ReadableStream)`
 * that pulls an async iterator; each `AssistantEvent` from `runAssistant` is
 * one frame, enqueued as it arrives. `request.signal` goes to the engine, so
 * the client's Stop (an aborted fetch) ends the model call. Failures after the
 * stream has started travel as an `error` event, since the status line is
 * already sent. A model call is a route handler, not a Server Action, so it
 * never blocks board moves.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: NextRequest): Promise<Response> {
  const refused = guardAiRequest(request, { method: "POST" });
  if (refused !== null) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "VALIDATION", message: "JSON body required" }, { status: 400, headers: NO_STORE });
  }
  const parsed = AssistRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "VALIDATION", message: "Invalid assistant request", details: parsed.error.issues },
      { status: 400, headers: NO_STORE },
    );
  }

  const events = runAssistant(getDb(), parsed.data, request.signal);
  const stream = sseStream(events, request.signal, (err) => {
    const mapped = toAiError(err);
    return { type: "error", kind: mapped.kind, message: mapped.message };
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
