import { type NextRequest } from "next/server";
import { z } from "zod";
import { guardAiRequest } from "@/lib/http-guard";
import { isTrackerError, listProposals, readTessera } from "@/lib/tessera/server";

/**
 * `GET /api/ai/proposals?conversation_id=<uuid>` (docs/drafts/p5-plan.md §5):
 * the conversation's proposals as `ProposalView[]`, oldest first. The panel
 * re-syncs statuses from it after a reload. A GET route, not a Server Action
 * (client reads use GET routes). 400 `{ code: "VALIDATION" }` when
 * `conversation_id` is missing or not a uuid. Never cached.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: NextRequest): Promise<Response> {
  const refused = guardAiRequest(request, { method: "GET" });
  if (refused !== null) return refused;

  const parsed = z.uuid().safeParse(request.nextUrl.searchParams.get("conversation_id"));
  if (!parsed.success) {
    return Response.json({ code: "VALIDATION", message: "conversation_id must be a uuid" }, { status: 400, headers: NO_STORE });
  }

  try {
    const proposals = await readTessera((ctx) => listProposals(ctx, { conversation_id: parsed.data }));
    return Response.json(proposals, { headers: NO_STORE });
  } catch (err) {
    if (isTrackerError(err) && err.code === "VALIDATION") {
      return Response.json({ code: err.code, message: err.message }, { status: 400, headers: NO_STORE });
    }
    throw err;
  }
}
