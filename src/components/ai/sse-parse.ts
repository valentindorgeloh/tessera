/**
 * Client parser for `POST /api/ai/assist` (docs/drafts/p5-plan.md §6). One
 * `AssistantEvent` is one frame, `event: <type>\ndata: <json>\n\n`. Chunks may
 * split a frame, and a frame may carry several `data:` lines (joined with
 * newlines, per the SSE spec). A frame that is not valid JSON or fails
 * `AssistantEventSchema` is dropped. Pure, so Vitest covers it
 * (tests/ui/sse-parse.test.ts).
 */
import { AssistantEventSchema, type AssistantEvent } from "@/lib/tessera/schemas";

/** Feeds the next decoded chunk. Incomplete frames stay buffered. */
export type SsePush = (chunk: string) => void;

function dispatchFrame(frame: string, onEvent: (event: AssistantEvent) => void): void {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return;
  let json: unknown;
  try {
    json = JSON.parse(data.join("\n"));
  } catch {
    return;
  }
  const parsed = AssistantEventSchema.safeParse(json);
  if (parsed.success) onEvent(parsed.data);
}

/**
 * Incremental parser. Call the returned function with each decoded chunk,
 * and once more with `"\n\n"` when the stream ends, so a final frame that
 * arrived without its blank line is still delivered.
 */
export function createSseParser(onEvent: (event: AssistantEvent) => void): SsePush {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      dispatchFrame(buffer.slice(0, split), onEvent);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
    }
  };
}
