import { type NextRequest } from "next/server";
import { isJsonContentType, isSameOriginRequest } from "@/app/api/request-guards";
import {
  createContext,
  fromSqliteError,
  getDb,
  getTool,
  getWorkItem,
  isTrackerError,
  runToolWithContext,
  USER_ACTOR_ID,
  validateInput,
  type ToolInput,
  type TrackerErrorCode,
} from "@/lib/tessera/server";

/**
 * Beacon target of the description editor (docs/contracts/editor.md, "Beacon
 * route"): `POST /api/work-items/[workItemId]/description` with
 * `{ description_md, expected_description_version, if_current_md? }` runs
 * `update_work_item_description` as the user. `navigator.sendBeacon` sends it
 * on `pagehide`, so a reload inside the 400 ms debounce still persists the
 * text. Mirrors `src/app/actions/_run.ts` without `refresh()`, which Next
 * allows in Server Actions only; an open page catches up through the change
 * poller. The response is never cached.
 *
 * `if_current_md`: the page left while its own save was in flight. That save
 * usually commits first and moves the version past `expected`, so a plain
 * compare-and-set would drop the newer text. When the stored text equals
 * `if_current_md` (the in-flight text) one version after `expected`, the
 * only change since `expected` was that save, and the beacon builds on it.
 * Any other text there is somebody else's write: CONFLICT as before.
 *
 * Same-origin only: unlike Server Actions, route handlers get no built-in
 * Origin check, and a cross-site `<form enctype="text/plain">` can produce a
 * body that parses as JSON. The beacon's Blob is `application/json` (415
 * otherwise), and a browser request must come from this origin (403).
 */

const TOOL = "update_work_item_description";

const STATUS: Partial<Record<TrackerErrorCode, number>> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RULE: 422,
  ARCHIVED: 423,
  LOCKED: 423,
  BUSY: 503,
};

type Body = { description_md: string; expected_description_version: number };

export type DescriptionBeaconResponse =
  | { ok: true; description_version: number; cursor: number }
  | { ok: false; code: TrackerErrorCode | "INTERNAL" | "FORBIDDEN" | "UNSUPPORTED_MEDIA_TYPE"; message: string; current_version?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workItemId: string }> }): Promise<Response> {
  const { workItemId } = await params;
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginRequest(request.headers)) {
    const failure: DescriptionBeaconResponse = { ok: false, code: "FORBIDDEN", message: "Cross-origin requests are not accepted" };
    return Response.json(failure, { status: 403, headers });
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    const failure: DescriptionBeaconResponse = { ok: false, code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" };
    return Response.json(failure, { status: 415, headers });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const failure: DescriptionBeaconResponse = { ok: false, code: "VALIDATION", message: "JSON body required" };
    return Response.json(failure, { status: 400, headers });
  }
  // `if_current_md` belongs to this route, not to the tool's strict input.
  const { if_current_md: ifCurrent, ...fields } = isRecord(body) ? body : {};
  if (ifCurrent !== undefined && typeof ifCurrent !== "string") {
    const failure: DescriptionBeaconResponse = { ok: false, code: "VALIDATION", message: "if_current_md must be a string" };
    return Response.json(failure, { status: 400, headers });
  }
  try {
    const def = getTool(TOOL);
    // Validate before touching the database so a bad payload never opens a connection.
    // The path names the item: a `work_item_id` in the body never overrides it.
    const data = validateInput(def.input, { ...fields, work_item_id: workItemId }) as ToolInput<typeof TOOL> & Body;
    const { db, sqlite } = getDb();
    const ctx = createContext({ db, sqlite, actorId: USER_ACTOR_ID });
    const run = await runToolWithContext(ctx, TOOL, data).catch((err: unknown) => {
      const mapped = fromSqliteError(err);
      if (ifCurrent === undefined || !isTrackerError(mapped) || mapped.code !== "CONFLICT") throw err;
      // Our own in-flight save landed first: build on it. A third writer since then still loses nothing (the retry is a CAS too).
      const stored = getWorkItem(ctx, workItemId);
      if (stored.description_md !== ifCurrent || stored.description_version !== data.expected_description_version + 1) throw err;
      return runToolWithContext(ctx, TOOL, { ...data, expected_description_version: stored.description_version });
    });
    const success: DescriptionBeaconResponse = { ok: true, description_version: run.data.description_version, cursor: run.cursor };
    return Response.json(success, { headers });
  } catch (err) {
    const mapped = fromSqliteError(err);
    if (isTrackerError(mapped)) {
      const current = isRecord(mapped.details) && typeof mapped.details.current_version === "number" ? mapped.details.current_version : undefined;
      const failure: DescriptionBeaconResponse = {
        ok: false,
        code: mapped.code,
        message: mapped.message,
        ...(mapped.code === "CONFLICT" && current !== undefined ? { current_version: current } : {}),
      };
      return Response.json(failure, { status: STATUS[mapped.code] ?? 400, headers });
    }
    console.error("[tessera] description beacon failed", mapped);
    const failure: DescriptionBeaconResponse = { ok: false, code: "INTERNAL", message: "Unexpected error" };
    return Response.json(failure, { status: 500, headers });
  }
}
