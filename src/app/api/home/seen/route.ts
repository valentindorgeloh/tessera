import { type NextRequest } from "next/server";
import { isJsonContentType, isSameOriginRequest } from "@/app/api/request-guards";
import { parseHomeSeenSeq } from "@/components/home/home-format";
import { getDb, setHomeSeen } from "@/lib/tessera/server";

/**
 * Beacon for Home (docs/drafts/p9-plan.md U1): `POST /api/home/seen` with
 * `{ seq }` moves the last-visit anchor forward. `navigator.sendBeacon` sends
 * it on `pagehide`, and the widget's layout-effect cleanup sends it when
 * Next hides the route. No `refresh()`: the page that sent it is going away.
 * Same-origin and JSON, like the description beacon. Success is 204.
 */

export async function POST(request: NextRequest): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginRequest(request.headers)) {
    return Response.json({ ok: false, message: "Cross-origin requests are not accepted" }, { status: 403, headers });
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return Response.json({ ok: false, message: "Content-Type must be application/json" }, { status: 415, headers });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "JSON body required" }, { status: 400, headers });
  }
  const seq = parseHomeSeenSeq(body);
  if (seq === null) {
    return Response.json({ ok: false, message: "A sequence number is required" }, { status: 400, headers });
  }
  try {
    setHomeSeen(getDb().db, seq);
  } catch (err) {
    console.error("[tessera] home seen failed", err);
    return Response.json({ ok: false, message: "Could not update the last visit" }, { status: 500, headers });
  }
  return new Response(null, { status: 204, headers });
}
