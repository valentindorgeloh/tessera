/**
 * Request checks for route handlers that write (the description beacon,
 * src/app/api/work-items/[workItemId]/description/route.ts). Server Actions
 * get an Origin check from Next; route handlers do not, so a write route
 * refuses browser requests from other origins and bodies that are not JSON
 * (a cross-site `<form enctype="text/plain">` can produce a body that parses
 * as JSON, but never with this Content-Type, and a cross-site fetch with it
 * needs a CORS preflight these routes never grant). Pure, tested in
 * tests/editor/description-route.test.ts.
 */

/**
 * False for a browser request from another site or origin: `Sec-Fetch-Site`
 * when the browser sends it (only `same-origin` passes), else the `Origin`
 * host against the `Host` the request came in on. Requests with neither
 * header (curl, scripts) are not cross-site browser requests and pass.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = headers.get("origin");
  if (origin === null) return true;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True for `application/json`, with or without parameters (`; charset=utf-8`), in any case. */
export function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json\s*(;|$)/i.test(value.trim());
}
