/**
 * Client-safe types of the superagent control client (decision 152). The one
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
import type { ActorKind, PaletteColor } from "@/lib/tessera/types";

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

/** Name of the actor the runner's MCP client writes as (decision 152; its client info name is `superagent`). */
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

/** `message` is the runner's own text or a short technical one; `status` is as received and `code` the runner's `error.code` when it is shaped like one (`[A-Z][A-Z0-9_]{0,63}`) and free of the token; both null when there was no answer or no such code. */
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

/** The chat screen's route (decision 153); `/agents/superagent/chat/<itemKey>` opens one conversation. */
export const SUPERAGENT_CHAT_PATH = "/agents/superagent/chat";

/** A live mapped project, with the repository the superagent works in for it. */
export type ChatProject = { id: string; name: string; identifier: string; repo: string };

/** One row of the chat list: a work item the user and the superagent talk on. */
export type ChatConversation = {
  workItemId: string;
  itemKey: string;
  title: string;
  projectId: string;
  projectName: string;
  isArchived: boolean;
  lastMessage: { actorName: string; snippet: string; at: string } | null;
  lastActivityAt: string;
  /** The item's newest runner request (largest createdAt), or null when it has none or the runner list failed. */
  request: RequestSummary | null;
};

/** One message of an open conversation: the item's description or a comment. */
export type ChatEntry = {
  /** The comment id, or `description` for the item's description. */
  id: string;
  kind: "description" | "comment" | "reply";
  actorId: string;
  actorName: string;
  actorKind: ActorKind;
  actorColor: PaletteColor;
  bodyMd: string;
  createdAt: string;
  /** A comment with `edited_at` set; the description never. */
  isEdited: boolean;
};

export type ChatOpen =
  | { kind: "not_found"; itemKey: string }
  | {
      kind: "item";
      workItemId: string;
      itemKey: string;
      title: string;
      projectId: string;
      projectName: string;
      isArchived: boolean;
      entries: ChatEntry[];
      /** The item's project actors, for mention rendering in the comment renderer. */
      mentionActors: { id: string; name: string }[];
      request: RequestSummary | null;
      /** GET /v1/requests/:id of `request`; null when `request` is null. */
      detail: RunnerResult<RequestDetail> | null;
      /** Where the composer's message goes as a reply (the open question's thread root), or null for a top-level comment. */
      replyToCommentId: string | null;
    };

/** Everything the chat screen reads in one go (`loadSuperagentChat`). Plain objects, passed to the client component as props. */
export type SuperagentChatLoad = {
  runnerUrl: string;
  tokenFile: string;
  requests: RunnerResult<RequestSummary[]>;
  /** The live `mcp:superagent` actor (kind agent), or null before the runner first connected. */
  superagentActorId: string | null;
  userActorId: string;
  /** Mapped projects that are live (not archived, not deleted), in mapping order, with their repo. */
  projects: ChatProject[];
  conversations: ChatConversation[];
  /** null on /agents/superagent/chat (no item in the URL). */
  open: ChatOpen | null;
};

/** The setup guide's route (decision 155). */
export const SUPERAGENT_SETUP_PATH = "/agents/superagent/setup";

/** The runner's token file as the setup guide sees it: whether it is there and owner-only. Never its content. */
export type TokenFileStatus =
  | {
      kind: "found";
      /** No group or other permission bits (the runner's doctor wants mode 600); null when the mode could not be read. */
      isPrivate: boolean | null;
    }
  | { kind: "missing" }
  | {
      kind: "unreadable";
      /** The error code, e.g. EACCES. */
      message: string;
    };

/** Everything the setup guide's status block reads (`loadSuperagentSetup`). Plain objects; never the token. */
export type SuperagentSetupLoad = {
  runnerUrl: string;
  tokenFile: string;
  token: TokenFileStatus;
  /** GET /v1/state, or null when there is no readable token to call with. */
  state: RunnerResult<RunnerState> | null;
  /** Mapped projects that are live (not archived, not deleted), in mapping order, with their repo. */
  mappedProjects: ChatProject[];
  /** The live `mcp:superagent` actor exists: the runner has reached Tessera at least once. */
  isConnected: boolean;
};
