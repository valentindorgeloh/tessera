import { type NextRequest } from "next/server";
import { guardAiRequest } from "@/lib/http-guard";
import { getAiStatus, type AiStatus } from "@/lib/tessera/server";

/**
 * `GET /api/ai/status` (docs/drafts/p5-plan.md §5): `AiStatus` JSON. Every AI
 * entry point in the UI stays hidden unless `available` is true, so this
 * answers `{ available: false, reason }` rather than an error status when the
 * credential or the model is missing. A GET also accepts `Sec-Fetch-Site:
 * none` (the person opens the URL by hand). Never cached.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const refused = guardAiRequest(request, { method: "GET" });
  if (refused !== null) return refused;

  let status: AiStatus;
  try {
    status = await getAiStatus();
  } catch (err) {
    // getAiStatus classifies its own failures; anything else is a bug, and the assistant stays off.
    console.error("[tessera] ai status failed", err);
    status = { available: false, reason: "offline" };
  }
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
