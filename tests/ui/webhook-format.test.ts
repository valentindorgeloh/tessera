import { describe, expect, it } from "vitest";
import {
  customWebhookEvents,
  eventSegments,
  eventsSummary,
  parseCustomEvents,
  webhookEventError,
  webhookNameError,
  webhookUrlError,
} from "@/components/webhooks/webhook-format";

describe("eventsSummary", () => {
  it("summarises empty, star, short and long lists", () => {
    expect(eventsSummary([])).toBe("No events");
    expect(eventsSummary(["*"])).toBe("Everything");
    expect(eventsSummary(["work_item.*", "comment.*"])).toBe("work_item.*, comment.*");
    expect(eventsSummary(["a", "b", "c"])).toBe("a, b +1");
  });
});

describe("customWebhookEvents", () => {
  it("keeps only non-common patterns", () => {
    expect(customWebhookEvents(["work_item.*", "ping", "comment.created"])).toEqual(["ping", "comment.created"]);
  });
});

describe("webhook validation", () => {
  it("accepts http URLs and rejects empty or bare hosts", () => {
    expect(webhookUrlError("https://example.com/hook")).toBeNull();
    expect(webhookUrlError("http://127.0.0.1:4010")).toBeNull();
    expect(webhookUrlError("")).toBe("A URL is required");
    expect(webhookUrlError("ftp://x")).toBe("Use an http or https URL");
  });

  it("requires a name within 120 characters", () => {
    expect(webhookNameError("Hooks")).toBeNull();
    expect(webhookNameError("  ")).toBe("A name is required");
    expect(webhookNameError("x".repeat(121))).toBe("Use 120 characters or fewer");
  });

  it("parses custom event patterns", () => {
    expect(parseCustomEvents("ping, comment.created")).toEqual({ events: ["ping", "comment.created"], error: null });
    expect(parseCustomEvents("not-a-pattern").error).toMatch(/not a valid event pattern/);
    expect(webhookEventError("work_item.updated")).toBeNull();
    expect(webhookEventError("Nope")).toMatch(/Use \*/);
  });
});

describe("eventSegments", () => {
  it("splits after each dot so a narrow cell breaks at a dot, never inside a word", () => {
    expect(eventSegments("work_item.updated")).toEqual(["work_item.", "updated"]);
    expect(eventSegments("a.b.c")).toEqual(["a.", "b.", "c"]);
    expect(eventSegments("*")).toEqual(["*"]);
    expect(eventSegments("work_item.updated").join("")).toBe("work_item.updated");
  });
});
