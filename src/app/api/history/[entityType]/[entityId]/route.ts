import { type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/app/api/request-guards";
import { getHistory, isTrackerError, readTessera } from "@/lib/tessera/server";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refuse(): Response {
  return Response.json({ code: "FORBIDDEN", message: "Cross-origin requests are refused" }, { status: 403, headers: NO_STORE });
}

/** Newest versions (and, for a page, activity) for the version history dialog. */
export async function GET(request: NextRequest, context: { params: Promise<{ entityType: string; entityId: string }> }): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) return refuse();
  const { entityType, entityId } = await context.params;
  if (entityType !== "work_item" && entityType !== "page") {
    return Response.json({ code: "VALIDATION", message: "entityType must be work_item or page" }, { status: 400, headers: NO_STORE });
  }
  try {
    const history = await readTessera((ctx) => getHistory(ctx, { entity_type: entityType, entity_id: entityId }));
    return Response.json(history, { headers: NO_STORE });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) {
      return Response.json({ code: err.code, message: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 400, headers: NO_STORE });
    }
    throw err;
  }
}
