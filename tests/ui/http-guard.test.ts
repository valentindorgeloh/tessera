/**
 * guardAiRequest (src/lib/http-guard.ts): loopback Host, same-origin, JSON on
 * POST. 403 `{ code: "FORBIDDEN" }` for host and origin, 415 for the content
 * type, null when the request may proceed.
 */
import { describe, expect, it } from "vitest";
import { assumedExport, guardAiRequest, isLoopbackHost } from "@/lib/http-guard";

function req(method: "GET" | "POST", headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/ai/status", { method, headers, body: method === "POST" ? "{}" : undefined });
}

const JSON_TYPE = { "content-type": "application/json" };

describe("isLoopbackHost", () => {
  it("accepts the loopback names with an optional port, in any case", () => {
    for (const host of ["127.0.0.1", "127.0.0.1:3000", "localhost", "localhost:3000", "LocalHost:8080", "[::1]", "[::1]:3000"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const host of [
      null,
      "",
      "evil.example",
      "evil.example:3000",
      "localhost.evil.example",
      "127.0.0.1.evil.example",
      "127.0.0.2",
      "0.0.0.0:3000",
      "[::2]",
      "::1",
      "localhost:",
      "localhost:99999x",
      "user@localhost",
      "localhost/evil",
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe("guardAiRequest", () => {
  it("lets a same-origin JSON POST on a loopback host through", () => {
    const request = req("POST", { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin", ...JSON_TYPE });
    expect(guardAiRequest(request, { method: "POST" })).toBeNull();
  });

  it("lets a script without Fetch Metadata through (curl)", () => {
    expect(guardAiRequest(req("POST", { host: "localhost:3000", ...JSON_TYPE }), { method: "POST" })).toBeNull();
    expect(guardAiRequest(req("GET", { host: "[::1]:3000" }), { method: "GET" })).toBeNull();
  });

  it("falls back to the request URL when there is no Host header", () => {
    expect(guardAiRequest(req("GET", {}), { method: "GET" })).toBeNull();
    const foreign = new Request("http://evil.example/api/ai/status");
    expect(guardAiRequest(foreign, { method: "GET" })?.status).toBe(403);
  });

  it("answers 403 FORBIDDEN for a foreign Host", async () => {
    const response = guardAiRequest(req("GET", { host: "evil.example" }), { method: "GET" });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("checks the Host before anything else", () => {
    const request = req("POST", { host: "evil.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" });
    expect(guardAiRequest(request, { method: "POST" })?.status).toBe(403);
  });

  it("answers 403 for a cross-site or same-site browser request", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = guardAiRequest(req("POST", { host: "127.0.0.1:3000", "sec-fetch-site": site, ...JSON_TYPE }), { method: "POST" });
      expect(response?.status, site).toBe(403);
      expect(await response?.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("answers 403 for a foreign Origin when Sec-Fetch-Site is absent", () => {
    const foreign = req("POST", { host: "127.0.0.1:3000", origin: "http://evil.example", ...JSON_TYPE });
    expect(guardAiRequest(foreign, { method: "POST" })?.status).toBe(403);
    const own = req("POST", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", ...JSON_TYPE });
    expect(guardAiRequest(own, { method: "POST" })).toBeNull();
  });

  it("allows Sec-Fetch-Site none on GET only", () => {
    const get = req("GET", { host: "127.0.0.1:3000", "sec-fetch-site": "none" });
    expect(guardAiRequest(get, { method: "GET" })).toBeNull();
    const post = req("POST", { host: "127.0.0.1:3000", "sec-fetch-site": "none", ...JSON_TYPE });
    expect(guardAiRequest(post, { method: "POST" })?.status).toBe(403);
  });

  it("still refuses a cross-site GET", () => {
    expect(guardAiRequest(req("GET", { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }), { method: "GET" })?.status).toBe(403);
  });

  it("answers 415 for a POST that is not JSON", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const response = guardAiRequest(req("POST", { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin", "content-type": type }), { method: "POST" });
      expect(response?.status, type).toBe(415);
      expect(await response?.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    }
  });

  it("answers 415 when a POST has no Content-Type, and accepts JSON with parameters", () => {
    // A string body gets text/plain from Request, so build one without a body type.
    const bare = new Request("http://127.0.0.1:3000/api/ai/assist", { method: "POST", headers: { host: "127.0.0.1:3000" } });
    expect(guardAiRequest(bare, { method: "POST" })?.status).toBe(415);
    const charset = req("POST", { host: "127.0.0.1:3000", "content-type": "Application/JSON; charset=utf-8" });
    expect(guardAiRequest(charset, { method: "POST" })).toBeNull();
  });

  it("does not ask a GET for a Content-Type", () => {
    expect(guardAiRequest(req("GET", { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" }), { method: "GET" })).toBeNull();
  });
});

describe("assumedExport", () => {
  it("returns the named function", () => {
    const fn = () => 1;
    expect(assumedExport<() => number>({ fn }, "fn")).toBe(fn);
  });

  it("throws ASSUMPTION when the name is missing or not a function", () => {
    expect(() => assumedExport({}, "runAssistant")).toThrow(/ASSUMPTION: runAssistant is not exported from @\/lib\/tessera\/server yet/);
    expect(() => assumedExport({ runAssistant: 1 }, "runAssistant")).toThrow(/ASSUMPTION: runAssistant/);
  });
});
