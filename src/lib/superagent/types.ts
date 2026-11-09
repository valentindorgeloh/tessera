/**
 * Client-safe types of the superagent control client (decision 145). The one
 * module of `@/lib/superagent` that components and "use client" files may
 * import (eslint, `componentPatterns`): types from ./schemas and plain
 * constants only, no zod, no file system.
 */
import type {
  RequestDetail,
  RequestSummary,
  RunnerPromptsDoc,
  RunnerSettingsDoc,
  RunnerState,
  RunnerStats,
  TriageRow,
} from "./schemas";

export type {
  Deliverable,
  PullRequest,
  RequestDetail,
  RequestEvent,
  RequestSize,
  RequestSummary,
  Revision,
  RunnerAction,
  RunnerPromptsDoc,
  RunnerSettings,
  RunnerSettingsDoc,
  RunnerState,
  RunnerStats,
  Session,
  SimpleAction,
  Stage,
  StageKind,
  TeamSection,
  TriageRow,
} from "./schemas";

/** Name of the actor the runner's MCP client writes as (decision 145; its client info name is `superagent`). */
export const SUPERAGENT_ACTOR_NAME = "mcp:superagent";

/** Why a runner call failed, as a state the screen can word. Never a thrown error. */
export const RUNNER_FAILURE_STATES = [
  "not_set_up",
  "token_unreadable",
  "unreachable",
  "timeout",
  "unauthorized",
  "forbidden",
  "not_found",
  "validation",
  "conflict",
  "unavailable",
  "bad_response",
  "http_error",
] as const;
export type RunnerFailureState = (typeof RUNNER_FAILURE_STATES)[number];

/** `message` is the runner's own text or a short technical one; `status` and `code` are as received (null when there was no answer). */
export type RunnerFailure = { state: RunnerFailureState; message: string; status: number | null; code: string | null };
export type RunnerResult<T> = { ok: true; data: T } | { ok: false; failure: RunnerFailure };

/** The list filter of `GET /v1/requests` and of the screen's `?scope=`. */
export const REQUEST_SCOPES = ["open", "recent", "all"] as const;
export type RequestScope = (typeof REQUEST_SCOPES)[number];

/** Everything the screen reads from the runner in one go (`loadSuperagent`). Plain objects, passed to the client component as props. */
export type SuperagentLoad = {
  runnerUrl: string;
  tokenFile: string;
  state: RunnerResult<RunnerState>;
  requests: RunnerResult<RequestSummary[]>;
  triage: RunnerResult<TriageRow[]>;
  stats: RunnerResult<RunnerStats>;
  settings: RunnerResult<RunnerSettingsDoc>;
  prompts: RunnerResult<RunnerPromptsDoc>;
  /** The selected request's detail, or null when no request is selected. */
  request: RunnerResult<RequestDetail> | null;
};
