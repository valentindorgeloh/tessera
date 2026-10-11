import { type NextRequest } from "next/server";
import { listChanges, readTessera, USER_ACTOR_ID } from "@/lib/tessera/server";

/**
 * Change feed for the client poller (docs/contracts/ui.md "Route groups").
 * `GET /api/changes?since=<seq>` returns `{ changes, cursor }` with every
 * activity row after `since` that was not written by the user, so the open
 * page only refreshes on external writes (MCP clients, the assistant,
 * automations). The response is never cached.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get("since");
  if (raw === null || !/^\d{1,15}$/.test(raw)) {
    return Response.json(
      { error: "since must be a non-negative integer" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const since = Number(raw);
  const result = await readTessera((ctx) => listChanges(ctx, since, { excludeActors: [USER_ACTOR_ID] }));
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
