import { type NextRequest } from "next/server";
import { isTrackerError, readTessera, SEARCH_TYPES, searchAll, type SearchHit, type SearchType } from "@/lib/tessera/server";

/**
 * Search endpoint for the client (docs/contracts/ui.md "Power K and shortcuts
 * (D4)"), pattern of `src/app/api/changes/route.ts`. `GET /api/search?q=…`
 * returns `{ hits: SearchHit[] }` from `searchAll`; `scope` narrows to one
 * project, `types` is a comma list of entity kinds and `limit` caps the hits
 * (1–200, default 20). A missing or over-long `q`, a bad `types` or `limit`
 * and an engine VALIDATION error answer 400 `{ error }`. Never cached, and
 * no `refresh()`: that is Server-Action-only. Consumers: Power K, `#`
 * mentions, the parent picker and entity-link resolution.
 */

const MAX_QUERY_LENGTH = 500;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400, headers: NO_STORE });
}

function isSearchType(value: string): value is SearchType {
  return (SEARCH_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;

  const q = params.get("q");
  if (q === null) return badRequest("q is required");
  if (q.length > MAX_QUERY_LENGTH) return badRequest(`q must be at most ${MAX_QUERY_LENGTH} characters`);

  const scope = params.get("scope");

  const typesRaw = params.get("types");
  let types: SearchType[] | undefined;
  if (typesRaw !== null) {
    const parts = typesRaw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (parts.length === 0 || !parts.every(isSearchType)) {
      return badRequest(`types must be a comma-separated list of ${SEARCH_TYPES.join(", ")}`);
    }
    types = parts;
  }

  const limitRaw = params.get("limit");
  let limit: number | undefined;
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) return badRequest(`limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
    limit = Number(limitRaw);
    if (limit < MIN_LIMIT || limit > MAX_LIMIT) return badRequest(`limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }

  let hits: SearchHit[];
  try {
    hits = await readTessera((ctx) => searchAll(ctx, q, { scope: scope ? { project_id: scope } : undefined, types, limit }));
  } catch (err) {
    if (isTrackerError(err) && err.code === "VALIDATION") return badRequest(err.message);
    throw err;
  }
  return Response.json({ hits }, { headers: NO_STORE });
}
