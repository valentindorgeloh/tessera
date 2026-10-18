import { type NextRequest } from "next/server";
import { z } from "zod";
import { guardAiRequest } from "@/lib/http-guard";
import {
  DigestKindSchema,
  fromSqliteError,
  generateDigest,
  getDb,
  IdSchema,
  isTrackerError,
  toAiError,
  type TrackerErrorCode,
} from "@/lib/tessera/server";

/**
 * `POST /api/ai/digest` (docs/drafts/p5-plan.md §5): body `{ kind, id }`
 * generates (or returns the stored, still current) digest of a cycle, a
 * module, or an inbox (`id` is the recipient actor id) as `DigestView` JSON.
 * Errors: 400 for a bad body, a tracker RULE
 * (`digest_refused`) 422 `{ code, message }` and the other tracker codes the
 * same statuses as the description beacon, and a model failure 401 / 429 /
 * 502 `{ kind, message }` (`toAiError`). Never cached.
 */

const BodySchema = z.object({ kind: DigestKindSchema, id: IdSchema }).strict();

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
    return Response.json({ code: "VALIDATION", message: "Expected { kind, id }", details: parsed.error.issues }, { status: 400, headers: NO_STORE });
  }

  try {
    const digest = await generateDigest(getDb(), parsed.data.kind, parsed.data.id);
    return Response.json(digest, { headers: NO_STORE });
  } catch (err) {
    return failureResponse(err);
  }
}
