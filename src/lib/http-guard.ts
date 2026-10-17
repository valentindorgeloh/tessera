/**
 * Request guard of the AI routes under `/api/ai/` (docs/drafts/p5-plan.md §5).
 * The routes spend the person's model credential, so a request has to come
 * from the page itself: the `Host` must be a loopback name (a DNS rebinding
 * page reaches 127.0.0.1 with its own host name), the browser must say it is
 * same-origin, and a POST must carry JSON (a cross-site form cannot send that
 * Content-Type without a CORS preflight these routes never grant). The origin
 * and JSON checks are the shared ones from `src/app/api/request-guards.ts`.
 * Pure (no engine, no Next), tested in tests/ui/http-guard.test.ts.
 *
 * `assumedExport` only looks up a name. It does not declare an engine API.
 */
import { isJsonContentType, isSameOriginRequest } from "@/app/api/request-guards";

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** True for `127.0.0.1`, `localhost` and `[::1]`, each with an optional port, in any case. */
export function isLoopbackHost(host: string | null): boolean {
  return host !== null && LOOPBACK_HOST.test(host.trim());
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refuse(status: 403 | 415, code: "FORBIDDEN" | "UNSUPPORTED_MEDIA_TYPE", message: string): Response {
  return Response.json({ code, message }, { status, headers: NO_STORE });
}

/**
 * Null when the request may proceed, else the refusal to return as is:
 * 403 `{ code: "FORBIDDEN" }` for a non-loopback Host or a cross-origin
 * browser request, 415 `{ code: "UNSUPPORTED_MEDIA_TYPE" }` for a POST that is
 * not `application/json`. A GET also accepts `Sec-Fetch-Site: none` (the
 * person typed the URL or followed a bookmark). With no `Host` header the
 * host of `request.url` stands in, which Next derives from the Host it got.
 */
export function guardAiRequest(request: Request, { method }: { method: "GET" | "POST" }): Response | null {
  const headers = request.headers;
  let host = headers.get("host");
  if (host === null) {
    try {
      host = new URL(request.url).host;
    } catch {
      host = null;
    }
  }
  if (!isLoopbackHost(host)) return refuse(403, "FORBIDDEN", "The assistant is available on localhost only");

  const sameOrigin = isSameOriginRequest(headers) || (method === "GET" && headers.get("sec-fetch-site") === "none");
  if (!sameOrigin) return refuse(403, "FORBIDDEN", "Cross-origin requests are not accepted");

  if (method === "POST" && !isJsonContentType(headers.get("content-type"))) {
    return refuse(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  return null;
}

/**
 * The export's own type when `Name` is already on `Module`, otherwise
 * `Planned`. Routes use this so a missing engine export still compiles and a
 * later one is checked at the call.
 */
export type PlannedOrExported<Module, Name extends PropertyKey, Planned> = Name extends keyof Module ? Module[Name] : Planned;

/**
 * ASSUMPTION: `name` is a function the p5 plan exports from
 * `@/lib/tessera/server` and that module does not have yet. Returns the
 * property once the engine lane adds it. Throws when the property is missing
 * or not a function, so a route cannot silently call something else.
 */
export function assumedExport<T>(namespace: object, name: string): T {
  const value = (namespace as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`ASSUMPTION: ${name} is not exported from @/lib/tessera/server yet`);
  }
  return value as T;
}
