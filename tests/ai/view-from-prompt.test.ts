import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setAnthropicForTests } from "@/lib/tessera/ai/client";
import { ViewSpecSchema, viewFromPrompt } from "@/lib/tessera/ai/view-from-prompt";
import { TrackerError } from "@/lib/tessera/core/errors";
import { view } from "@/lib/tessera/db/schema";
import { createProject } from "@/lib/tessera/projects";
import { createTestContext, createTestDb } from "../helpers/db";
import { fakeAnthropic } from "./fake-anthropic";

const REJECTED_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "uniqueItems",
  "default",
  "propertyNames",
  "contains",
];

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

beforeEach(() => {
  setAnthropicForTests(null);
});

describe("view from prompt", () => {
  it("produces a JSON schema without keywords the API rejects", () => {
    const schema = zodOutputFormat(ViewSpecSchema).schema as unknown;
    const problems: string[] = [];
    walk(schema, "", problems);
    expect(problems).toEqual([]);
    expect(JSON.stringify(schema)).toContain("list");
  });

  it("stores a create_view proposal and puts the rationale on the note", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const before = ctx.db.select({ n: count() }).from(view).get()?.n ?? 0;
    const fake = fakeAnthropic({
      parse: {
        parsed: {
          name: "Open high priority",
          filters: { priority: ["high"] },
          display: { layout: "board" },
          rationale: "A board of high-priority work.",
        },
      },
    });
    setAnthropicForTests(fake.client);
    const proposal = await viewFromPrompt(handles, {
      project_id: project.id,
      prompt: "Open high-priority items as a board",
      conversation_id: crypto.randomUUID(),
    });
    expect(proposal.tool).toBe("create_view");
    expect(proposal.source).toBe("view_from_prompt");
    expect(proposal.status).toBe("pending");
    expect(proposal.preview.note).toContain("A board of high-priority work.");
    expect(ctx.db.select({ n: count() }).from(view).get()?.n ?? 0).toBe(before);
    const body = fake.parseCalls[0];
    expect(body).not.toHaveProperty("betas");
    expect(body).not.toHaveProperty("fallbacks");
    expect(body?.max_tokens).toBe(16000);
    expect(body?.thinking).toEqual({ type: "adaptive" });
    const format = (body?.output_config as { format?: { type?: string } } | undefined)?.format;
    expect(format?.type).toBe("json_schema");
  });

  it("refuses when the model returns no view", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const fake = fakeAnthropic({ parse: { parsed: null, stop_reason: "end_turn", text: "I need a project." } });
    setAnthropicForTests(fake.client);
    await expect(
      viewFromPrompt(handles, { project_id: project.id, prompt: "Something vague", conversation_id: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "RULE", details: { rule: "view_not_generated" } });
  });

  it("turns a structured-output parse failure into view_not_generated", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const fake = fakeAnthropic({ parseThrows: "Failed to parse structured output: bad" });
    setAnthropicForTests(fake.client);
    try {
      await viewFromPrompt(handles, { project_id: project.id, prompt: "A board", conversation_id: crypto.randomUUID() });
      expect.fail("expected a rule");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackerError);
      expect((err as TrackerError).details).toEqual({ rule: "view_not_generated" });
    }
  });
});

function walk(node: unknown, path: string, problems: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, `${path}/${index}`, problems));
    return;
  }
  const record = node as Record<string, unknown>;
  for (const key of REJECTED_KEYWORDS) {
    if (key in record) problems.push(`${path} ${key}`);
  }
  if ("minItems" in record && record.minItems !== 0 && record.minItems !== 1) problems.push(`${path} minItems`);
  if ("additionalProperties" in record && record.additionalProperties !== false) problems.push(`${path} additionalProperties`);
  if (typeof record.format === "string" && !SUPPORTED_FORMATS.has(record.format)) problems.push(`${path} format ${record.format}`);
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object") walk(value, `${path}/${key}`, problems);
  }
}
