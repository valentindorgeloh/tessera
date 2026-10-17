import { type NextRequest } from "next/server";
import { z } from "zod";
import { guardAiRequest } from "@/lib/http-guard";
import {
  fromSqliteError,
  getDb,
  IdSchema,
  isTrackerError,
  toAiError,
  viewFromPrompt,
  type TrackerErrorCode,
} from "@/lib/tessera/server";

/**
 * `POST /api/ai/view` (docs/drafts/p5-plan.md §5): body
 * `{ project_id, prompt (1–2000 characters), conversation_id }` asks the model
 * for one saved view and returns it as a pending `create_view` proposal
 * (`ProposalView` JSON). Nothing is written until the person applies it.
 * Errors as in `/api/ai/digest`: 400 for a bad body, a tracker RULE
 * (`view_not_generated`) 422 `{ code, message }`, a model failure 401 / 429 /
 * 502 `{ kind, message }`. Never cached.
 */

const BodySchema = z
  .object({
    project_id: IdSchema,
    prompt: z.string().trim().min(1).max(2000),
    conversation_id: z.uuid(),
  })
  .strict();

const NO_STORE = { "Cache-Control": "no-store" } as const;

const TRACKER_STATUS: Record<TrackerErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RULE: 422,
  ARCHIVED: 423,
  LOCKED: 423,
  BUSY: 503,
};

function failureResponse(err: unknown): Response {
  const mapped = fromSqliteError(err);
  if (isTrackerError(mapped)) {
    return Response.json({ code: mapped.code, message: mapped.message }, { status: TRACKER_STATUS[mapped.code] ?? 400, headers: NO_STORE });
  }
  const ai = toAiError(mapped);
  const status = ai.kind === "auth" ? 401 : ai.kind === "rate_limit" ? 429 : 502;
  return Response.json({ kind: ai.kind, message: ai.message }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<Response> {
  const refused = guardAiRequest(request, { method: "POST" });
  if (refused !== null) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "VALIDATION", message: "JSON body required" }, { status: 400, headers: NO_STORE });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "VALIDATION", message: "Expected { project_id, prompt, conversation_id }", details: parsed.error.issues },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const proposal = await viewFromPrompt(getDb(), parsed.data);
    return Response.json(proposal, { headers: NO_STORE });
  } catch (err) {
    return failureResponse(err);
  }
}
