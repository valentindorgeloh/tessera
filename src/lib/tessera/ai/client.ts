/**
 * The one Anthropic client (docs/contracts/ai.md, decision 36). The key stays
 * in the environment or the `ant auth login` profile: this module never reads
 * or embeds it. `new Anthropic()` with no arguments is the SDK's own lookup.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_ACTOR_ID } from "../actors";
import { createContext, type TesseraContext } from "../core/context";
import type { DbHandles } from "../db/client";
import { AiEffortSchema } from "../schemas";
import type { AiEffort, AiStatus } from "../types";

export const AI_MODEL = process.env.TESSERA_AI_MODEL ?? "claude-opus-5-5";

/** Beta required for `fallbacks: "default"` (decision 36). */
export const AI_BETAS = ["server-side-fallback-2026-07-01"] as const;

export const AI_FALLBACKS = "default" as const;

const STATUS_OK_MS = 10 * 60_000;
const STATUS_OFFLINE_MS = 30_000;

let singleton: Anthropic | null = null;
let testClient: Anthropic | null = null;
let statusCache: { status: AiStatus; expiresAt: number } | null = null;

/** `TESSERA_AI_EFFORT`, or `high` when unset or not one of the four levels. The model's own default is medium (decision 36). */
export function aiEffort(): AiEffort {
  const parsed = AiEffortSchema.safeParse(process.env.TESSERA_AI_EFFORT ?? "high");
  return parsed.success ? parsed.data : "high";
}

/** Lazy process-wide client. A test client from `setAnthropicForTests` wins. */
export function getAnthropic(): Anthropic {
  if (testClient) return testClient;
  if (!singleton) singleton = new Anthropic();
  return singleton;
}

/** Inject a scripted client. `null` drops it and forgets the status cache. */
export function setAnthropicForTests(client: Anthropic | null): void {
  testClient = client;
  statusCache = null;
}

/** Assistant actor on these handles. Digests, views and tool runs share it. */
export function assistantContext(handles: DbHandles): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
}

/**
 * `models.retrieve` proves the credential and the model. Auth failures and a
 * constructor throw (no key, no profile) are `no_credential`. A missing model
 * is cached for ten minutes; a connection failure only for 30 seconds.
 */
export async function getAiStatus(): Promise<AiStatus> {
  const cached = readStatusCache();
  if (cached) return cached;
  let client: Anthropic;
  try {
    client = getAnthropic();
  } catch {
    return rememberStatus({ available: false, reason: "no_credential" }, STATUS_OK_MS);
  }
  try {
    await client.models.retrieve(AI_MODEL);
    return rememberStatus({ available: true, model: AI_MODEL }, STATUS_OK_MS);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return rememberStatus({ available: false, reason: "no_credential" }, STATUS_OK_MS);
    }
    if (err instanceof Anthropic.NotFoundError) {
      return rememberStatus({ available: false, reason: "model_unavailable" }, STATUS_OK_MS);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return rememberStatus({ available: false, reason: "offline" }, STATUS_OFFLINE_MS);
    }
    return rememberStatus({ available: false, reason: "offline" }, STATUS_OFFLINE_MS);
  }
}

/** Auth and rate limits keep the SDK message. Everything else is "Assistant unavailable" and is logged. */
export function toAiError(err: unknown): { kind: "auth" | "rate_limit" | "unavailable"; message: string } {
  if (err instanceof Anthropic.AuthenticationError) return { kind: "auth", message: err.message };
  if (err instanceof Anthropic.RateLimitError) return { kind: "rate_limit", message: err.message };
  console.error("Assistant unavailable", err);
  return { kind: "unavailable", message: "Assistant unavailable" };
}

function readStatusCache(): AiStatus | null {
  if (!statusCache) return null;
  if (Date.now() >= statusCache.expiresAt) {
    statusCache = null;
    return null;
  }
  return statusCache.status;
}

function rememberStatus(status: AiStatus, ttlMs: number): AiStatus {
  statusCache = { status, expiresAt: Date.now() + ttlMs };
  return status;
}
