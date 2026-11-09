/**
 * Shared helpers of the superagent tests: the fixtures (`tests/fixtures/superagent/`, the same files the fake
 * runner serves) and a recording `fetch` stub. Not a test file, so Vitest never runs it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

export const TOKEN = "tok-SECRET-0123456789abcdef";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "superagent");

/** One fixture file, parsed but not validated (a fresh copy per call, so a test may edit it). */
export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8")) as T;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export type Call = { url: string; method: string; headers: Headers; body: unknown; init: RequestInit };

/** A `fetch` double: records every call and answers with `answer(call)` (a Response, or a thrown error). */
export function stubFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const text = typeof init?.body === "string" ? init.body : undefined;
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: text === undefined ? undefined : JSON.parse(text),
      init: init ?? {},
    };
    calls.push(call);
    return answer(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** Answers the v1 routes from the fixtures, statelessly: enough for a test that only needs a well-formed runner. */
export function fixtureRunner(call: Call): Response {
  const { pathname } = new URL(call.url);
  const route = `${call.method} ${pathname}`;
  const requests = fixture<{ requests: unknown[] }>("requests").requests;
  const body = call.body as { paused?: boolean; settings?: unknown; teamSections?: unknown; baseRevision?: number | string } | undefined;
  /** The runner moves a numeric revision on; a string one comes back as it was sent. */
  const next = (revision: number | string | undefined) => (typeof revision === "number" ? revision + 1 : revision);
  if (route === "GET /v1/state") return jsonResponse(fixture("state"));
  if (route === "GET /v1/requests") return jsonResponse({ requests });
  if (route === "GET /v1/stats") return jsonResponse(fixture("stats"));
  if (route === "GET /v1/triage") return jsonResponse(fixture("triage"));
  if (route === "GET /v1/settings") return jsonResponse(fixture("settings"));
  if (route === "GET /v1/prompts") return jsonResponse(fixture("prompts"));
  if (route === "PUT /v1/settings") return jsonResponse({ settings: body?.settings, revision: next(body?.baseRevision) });
  if (route === "PUT /v1/prompts") return jsonResponse({ teamSections: body?.teamSections, revision: next(body?.baseRevision) });
  if (route === "POST /v1/pause") return jsonResponse({ paused: body?.paused });
  if (call.method === "GET" && /^\/v1\/requests\/[^/]+$/.test(pathname)) return jsonResponse(fixture("request-detail"));
  if (call.method === "POST" && /^\/v1\/requests\/[^/]+\/(approve|retry|stop|lift-hold|resize|budget)$/.test(pathname)) {
    return jsonResponse({ request: requests[0] });
  }
  if (call.method === "POST" && /^\/v1\/triage\/[^/]+\/retry$/.test(pathname)) {
    return jsonResponse({ triage: fixture<{ triage: unknown[] }>("triage").triage[0] });
  }
  return jsonResponse({ error: { code: "NOT_FOUND", message: `No route ${route}` } }, 404);
}
