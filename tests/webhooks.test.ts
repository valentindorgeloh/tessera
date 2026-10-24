/**
 * Signed webhook delivery: pattern matching, HMAC, cursor, enqueue, retries,
 * 410 deactivation, no webhook.* loops, user-only writes, and a delivery
 * failure that does not roll back a work-item change.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR_ID, registerActor } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { isTrackerError } from "@/lib/tessera/core/errors";
import { createProject } from "@/lib/tessera/projects";
import { runToolWithContext } from "@/lib/tessera/tools/registry";
import { createWorkItem, getWorkItem, updateWorkItem } from "@/lib/tessera/work-items";
import {
  createWebhook,
  enqueueDeliveries,
  listWebhookDeliveries,
  listWebhooks,
  matchesEvent,
  nextAttemptAt,
  sendDueDeliveries,
  signPayload,
  testWebhook,
} from "@/lib/tessera/webhooks";
import { createTestContext, createTestDb } from "./helpers/db";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

describe("matchesEvent", () => {
  it("matches *, entity.*, exact verbs and ping", () => {
    expect(matchesEvent(["*"], "work_item.updated")).toBe(true);
    expect(matchesEvent(["work_item.*"], "work_item.updated")).toBe(true);
    expect(matchesEvent(["work_item.*"], "comment.created")).toBe(false);
    expect(matchesEvent(["work_item.updated"], "work_item.updated")).toBe(true);
    expect(matchesEvent(["work_item.updated"], "work_item.created")).toBe(false);
    expect(matchesEvent(["ping"], "ping")).toBe(true);
    expect(matchesEvent(["ping"], "work_item.updated")).toBe(false);
  });
});

describe("signPayload", () => {
  it("matches a fixed HMAC-SHA256 vector", () => {
    const secret = "a".repeat(64);
    const timestamp = "2026-10-18T12:00:00.000Z";
    const body = '{"event":"ping"}';
    const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
    expect(signPayload(secret, timestamp, body)).toBe(expected);
  });
});

describe("nextAttemptAt", () => {
  it("follows 1m, 5m, 30m, 2h, 12h then null", () => {
    const now = "2026-10-18T12:00:00.000Z";
    expect(nextAttemptAt(1, now)).toBe("2026-10-18T12:01:00.000Z");
    expect(nextAttemptAt(2, now)).toBe("2026-10-18T12:05:00.000Z");
    expect(nextAttemptAt(3, now)).toBe("2026-10-18T12:30:00.000Z");
    expect(nextAttemptAt(4, now)).toBe("2026-10-18T14:00:00.000Z");
    expect(nextAttemptAt(5, now)).toBe("2026-10-19T00:00:00.000Z");
    expect(nextAttemptAt(6, now)).toBeNull();
  });
});

describe("webhooks", () => {
  it("starts the cursor at creation and enqueues only matching activity", () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const prior = createWorkItem(ctx, { project_id: project.id, name: "Prior" });
    updateWorkItem(ctx, prior.id, { name: "Prior renamed" });
    const hook = createWebhook(ctx, {
      name: "Updates",
      url: "http://127.0.0.1:9/hook",
      events: ["work_item.updated"],
    });
    expect(hook.last_seq).toBeGreaterThan(0);
    expect(hook.secret).toMatch(/^[0-9a-f]{64}$/);
    // No backfill: activity at or before last_seq is not delivered.
    expect(enqueueDeliveries(ctx, ctx.now())).toBe(0);

    const item = createWorkItem(ctx, { project_id: project.id, name: "After hook" });
    // create is work_item.created — not subscribed.
    expect(enqueueDeliveries(ctx, ctx.now())).toBe(0);
    updateWorkItem(ctx, item.id, { name: "Renamed after" });
    expect(enqueueDeliveries(ctx, ctx.now())).toBe(1);
    const deliveries = listWebhookDeliveries(ctx, { webhook_id: hook.id });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].event).toBe("work_item.updated");
    expect(deliveries[0].status).toBe("pending");
  });

  it("a create with assignees emits work_item.created then work_item.added, a create without only work_item.created (decisions 50, 51)", () => {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const project = createProject(user, { name: "Web", identifier: "WEB" });
    const agent = registerActor(user, { kind: "agent", name: "mcp:creator" });
    const creator = createTestContext(handles, agent.id);
    const hook = createWebhook(user, { name: "Items", url: "http://127.0.0.1:9/hook", events: ["work_item.*"] });
    const eventsSince = (seen: Set<string>) =>
      listWebhookDeliveries(user, { webhook_id: hook.id })
        .filter((delivery) => !seen.has(delivery.id))
        .sort((a, b) => (a.activity_seq ?? 0) - (b.activity_seq ?? 0));

    // A plain create: one delivery. The project has no default assignee, so nothing is added.
    createWorkItem(creator, { project_id: project.id, name: "Plain" });
    expect(enqueueDeliveries(user, user.now())).toBe(1);
    const first = eventsSince(new Set());
    expect(first.map((delivery) => delivery.event)).toEqual(["work_item.created"]);

    // A create with an assignee: created, then added, in activity order (list order is not sequence order).
    createWorkItem(creator, { project_id: project.id, name: "Assigned", assignee_ids: [agent.id] });
    expect(enqueueDeliveries(user, user.now())).toBe(2);
    const second = eventsSince(new Set(first.map((delivery) => delivery.id)));
    expect(second.map((delivery) => delivery.event)).toEqual(["work_item.created", "work_item.added"]);
  });

  it("never enqueues webhook.* activity", () => {
    const ctx = createTestContext(createTestDb());
    const hook = createWebhook(ctx, {
      name: "All",
      url: "http://127.0.0.1:9/hook",
      events: ["*"],
    });
    createWebhook(ctx, { name: "Other", url: "http://127.0.0.1:9/other", events: ["ping"] });
    expect(enqueueDeliveries(ctx, ctx.now())).toBe(0);
    expect(listWebhookDeliveries(ctx, { webhook_id: hook.id })).toHaveLength(0);
  });

  it("records a failed delivery without rolling back the work-item change", async () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const hook = createWebhook(ctx, {
      name: "Failing",
      url: "http://127.0.0.1:9/hook",
      events: ["work_item.updated"],
    });
    const item = createWorkItem(ctx, { project_id: project.id, name: "Original" });
    updateWorkItem(ctx, item.id, { name: "Kept" });
    enqueueDeliveries(ctx, ctx.now());

    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 });
    const result = await sendDueDeliveries(ctx, ctx.now(), fetchImpl);
    expect(result.sent).toBe(1);
    expect(result.delivered).toBe(0);

    const deliveries = listWebhookDeliveries(ctx, { webhook_id: hook.id });
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].attempts).toBe(1);
    expect(deliveries[0].last_error).toMatch(/500/);
    expect(deliveries[0].next_attempt_at).not.toBeNull();

    expect(getWorkItem(ctx, item.id).name).toBe("Kept");
  });

  it("marks delivered on 2xx and deactivates on 410", async () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const hook = createWebhook(ctx, {
      name: "Ok",
      url: "http://127.0.0.1:9/hook",
      events: ["work_item.updated"],
    });
    const item = createWorkItem(ctx, { project_id: project.id, name: "A" });
    updateWorkItem(ctx, item.id, { name: "B" });
    enqueueDeliveries(ctx, ctx.now());

    const okFetch: typeof fetch = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(String(headers["X-Tessera-Signature"] ?? "").startsWith("sha256=")).toBe(true);
      return new Response("ok", { status: 200 });
    };
    expect((await sendDueDeliveries(ctx, ctx.now(), okFetch)).delivered).toBe(1);
    expect(listWebhookDeliveries(ctx, { webhook_id: hook.id })[0].status).toBe("delivered");

    // A separate webhook so the 410 only touches this delivery.
    const gone = createWebhook(ctx, {
      name: "Gone",
      url: "http://127.0.0.1:9/gone",
      events: ["work_item.updated"],
    });
    updateWorkItem(ctx, item.id, { name: "C" });
    enqueueDeliveries(ctx, ctx.now());
    const routedFetch: typeof fetch = async (url) => {
      if (String(url).includes("/gone")) return new Response("gone", { status: 410 });
      return new Response("ok", { status: 200 });
    };
    const result = await sendDueDeliveries(ctx, ctx.now(), routedFetch);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(listWebhooks(ctx).find((row) => row.id === gone.id)?.is_active).toBe(false);
  });

  it("fails after the retry schedule is exhausted", async () => {
    const ctx = createTestContext(createTestDb());
    const project = createProject(ctx, { name: "Web", identifier: "WEB" });
    const hook = createWebhook(ctx, {
      name: "Retries",
      url: "http://127.0.0.1:9/hook",
      events: ["work_item.updated"],
    });
    const item = createWorkItem(ctx, { project_id: project.id, name: "A" });
    updateWorkItem(ctx, item.id, { name: "B" });
    enqueueDeliveries(ctx, ctx.now());
    const failFetch: typeof fetch = async () => new Response("err", { status: 503 });

    // Five delays, then the sixth failure marks the delivery failed.
    let now = ctx.now();
    for (let i = 0; i < 6; i += 1) {
      await sendDueDeliveries(ctx, now, failFetch);
      const row = listWebhookDeliveries(ctx, { webhook_id: hook.id })[0];
      expect(row.attempts).toBe(i + 1);
      if (i < 5) {
        expect(row.status).toBe("pending");
        now = row.next_attempt_at!;
      } else {
        expect(row.status).toBe("failed");
        expect(row.next_attempt_at).toBeNull();
      }
    }
  });

  it("test_webhook enqueues a ping due now", () => {
    const ctx = createTestContext(createTestDb());
    const hook = createWebhook(ctx, {
      name: "Ping",
      url: "http://127.0.0.1:9/hook",
      events: ["ping"],
    });
    const before = ctx.now();
    const delivery = testWebhook(ctx, hook.id);
    expect(delivery.event).toBe("ping");
    expect(delivery.status).toBe("pending");
    expect(delivery.activity_seq).toBeNull();
    expect(delivery.next_attempt_at).not.toBeNull();
    expect(delivery.next_attempt_at! >= before).toBe(true);
    expect(delivery.next_attempt_at! <= ctx.now()).toBe(true);
  });

  it("delivers a signed work_item.updated POST to a live local echo", async () => {
    const received: Array<{ event: string; signature: string; timestamp: string; body: string }> = [];
    const server = createServer((req, res) => {
      void (async () => {
        const body = await readBody(req);
        received.push({
          event: String(req.headers["x-tessera-event"] ?? ""),
          signature: String(req.headers["x-tessera-signature"] ?? ""),
          timestamp: String(req.headers["x-tessera-timestamp"] ?? ""),
          body,
        });
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const ctx = createTestContext(createTestDb());
      const project = createProject(ctx, { name: "Web", identifier: "WEB" });
      const hook = createWebhook(ctx, {
        name: "Live echo",
        url: `http://127.0.0.1:${port}/hook`,
        events: ["work_item.*"],
      });
      const item = createWorkItem(ctx, { project_id: project.id, name: "Echo me" });
      updateWorkItem(ctx, item.id, { name: "Echoed" });
      // work_item.* matches both created and updated.
      expect(enqueueDeliveries(ctx, ctx.now())).toBe(2);

      const result = await sendDueDeliveries(ctx, ctx.now(), fetch);
      expect(result).toEqual({ sent: 2, delivered: 2, failed: 0 });
      const deliveries = listWebhookDeliveries(ctx, { webhook_id: hook.id });
      expect(deliveries.every((row) => row.status === "delivered" && row.response_status === 200)).toBe(true);

      expect(received).toHaveLength(2);
      for (const hit of received) {
        expect(hit.signature.startsWith("sha256=")).toBe(true);
        const expected = signPayload(hook.secret!, hit.timestamp, hit.body);
        const left = Buffer.from(hit.signature);
        const right = Buffer.from(expected);
        expect(left.length).toBe(right.length);
        expect(timingSafeEqual(left, right)).toBe(true);
      }
      const updated = received.find((hit) => hit.event === "work_item.updated");
      expect(updated).toBeDefined();
      const payload = JSON.parse(updated!.body) as { event: string; new_value: string | null };
      expect(payload.event).toBe("work_item.updated");
      expect(payload.new_value).toBe("Echoed");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("refuses create_webhook for a non-user actor and hides the secret from agents", async () => {
    const handles = createTestDb();
    const user = createTestContext(handles);
    const hook = createWebhook(user, {
      name: "Secret",
      url: "http://127.0.0.1:9/hook",
      events: ["*"],
    });
    expect(hook.secret).toBeTruthy();

    const agent = registerActor(user, { name: "bot-a", kind: "agent" });
    const agentCtx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: agent.id });
    const listed = listWebhooks(agentCtx);
    expect(listed.find((row) => row.id === hook.id)?.secret).toBeUndefined();

    try {
      await runToolWithContext(agentCtx, "create_webhook", {
        name: "Nope",
        url: "http://127.0.0.1:9/x",
        events: ["*"],
      });
      expect.unreachable("create_webhook should refuse agents");
    } catch (err) {
      expect(isTrackerError(err)).toBe(true);
      if (isTrackerError(err)) {
        expect(err.code).toBe("RULE");
        expect((err.details as { rule: string }).rule).toBe("user_only");
      }
    }

    // Assistant is also refused.
    const assistantCtx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
    try {
      await runToolWithContext(assistantCtx, "test_webhook", { webhook_id: hook.id });
      expect.unreachable("test_webhook should refuse the assistant");
    } catch (err) {
      expect(isTrackerError(err) && (err.details as { rule: string }).rule).toBe("user_only");
    }
  });
});
