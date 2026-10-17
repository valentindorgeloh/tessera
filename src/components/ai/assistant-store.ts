/**
 * Transcript reducer and session storage (docs/drafts/p5-plan.md §6, decision
 * 35). Text turns are what a later request replays; tool calls, notices and
 * proposals stay on the turn so a reload can paint them, then statuses are
 * refreshed from `GET /api/ai/proposals`. At most 50 turns. Storage failures
 * are swallowed. Pure, so Vitest covers it (tests/ui/assistant-store.test.ts).
 */
import { ProposalViewSchema, type AssistantEvent } from "@/lib/tessera/schemas";
import type { ApplyOutcome, AssistMessage, ProposalView } from "@/lib/tessera/types";

export const TRANSCRIPT_STORAGE_KEY = "tessera.assistant.v1";
export const PANEL_STORAGE_KEY = "tessera.assistant-panel.v1";
export const MAX_TURNS = 50;
export const MAX_TURN_CHARS = 20000;
export const DEFAULT_PANEL_WIDTH = 400;
export const MIN_PANEL_WIDTH = 320;
export const MAX_PANEL_WIDTH = 640;
const STOPPED = "Stopped";

export type ToolCallView = {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  summary: string;
};

export type AssistantTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  calls: ToolCallView[];
  notices: string[];
  proposals: ProposalView[];
  streaming: boolean;
  canContinue: boolean;
};

export type Conversation = {
  id: string;
  turns: AssistantTurn[];
};

export type PanelPrefs = { open: boolean; width: number };

export type TranscriptAction =
  | { type: "replace"; conversation: Conversation }
  | { type: "new"; id: string }
  | { type: "ask"; userId: string; assistantId: string; text: string; conversationId: string }
  | { type: "event"; event: AssistantEvent }
  | { type: "stop" }
  | { type: "sync-proposals"; proposals: ProposalView[] }
  | { type: "applying"; ids: string[] }
  | { type: "outcomes"; outcomes: ApplyOutcome[] }
  | { type: "revert-applying"; ids: string[] }
  | { type: "discarded"; proposals: ProposalView[] };

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Registry name as a title: `propose_update_work_item` → "Update work item". */
export function toolCallTitle(name: string): string {
  const bare = name.startsWith("propose_") ? name.slice("propose_".length) : name;
  const words = bare.replace(/_/g, " ").trim();
  if (words === "") return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ProposalPhase = "pending" | "applying" | "applied" | "failed" | "discarded" | "expired";

/** Failed with an expiry message (decision 33, `RULE proposal_expired`) reads as Expired. */
export function proposalPhase(proposal: ProposalView): ProposalPhase {
  if (proposal.status === "failed" && proposal.error !== null && /expired/i.test(proposal.error.message)) return "expired";
  return proposal.status;
}

export function emptyConversation(id = ""): Conversation {
  return { id, turns: [] };
}

function trim(turns: AssistantTurn[]): AssistantTurn[] {
  return turns.length <= MAX_TURNS ? turns : turns.slice(turns.length - MAX_TURNS);
}

function blankAssistant(id: string): AssistantTurn {
  return { id, role: "assistant", content: "", calls: [], notices: [], proposals: [], streaming: true, canContinue: false };
}

function lastAssistantIndex(turns: readonly AssistantTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === "assistant") return index;
  }
  return -1;
}

function withLastAssistant(state: Conversation, update: (turn: AssistantTurn) => AssistantTurn): Conversation {
  const index = lastAssistantIndex(state.turns);
  if (index === -1) {
    return { ...state, turns: trim([...state.turns, update(blankAssistant(`assistant-${state.turns.length}`))]) };
  }
  const turns = state.turns.slice();
  const current = turns[index];
  if (!current) return state;
  turns[index] = update(current);
  return { ...state, turns };
}

function mapProposals(state: Conversation, update: (proposal: ProposalView) => ProposalView): Conversation {
  let changed = false;
  const turns = state.turns.map((turn) => {
    if (turn.proposals.length === 0) return turn;
    const proposals = turn.proposals.map((proposal) => {
      const next = update(proposal);
      if (next !== proposal) changed = true;
      return next;
    });
    return changed ? { ...turn, proposals } : turn;
  });
  return changed ? { ...state, turns } : state;
}

function applyEvent(state: Conversation, event: AssistantEvent): Conversation {
  return withLastAssistant(state, (turn) => {
    switch (event.type) {
      case "text_delta":
        return { ...turn, content: turn.content + event.text, streaming: true };
      case "tool_use": {
        const existing = turn.calls.some((call) => call.id === event.id);
        const calls = existing
          ? turn.calls.map((call) => (call.id === event.id ? { ...call, name: event.name, status: "running" as const } : call))
          : [...turn.calls, { id: event.id, name: event.name, status: "running" as const, summary: "" }];
        return { ...turn, calls, streaming: true };
      }
      case "tool_result": {
        const existing = turn.calls.some((call) => call.id === event.id);
        const status = event.ok ? ("complete" as const) : ("error" as const);
        const calls = existing
          ? turn.calls.map((call) => (call.id === event.id ? { ...call, status, summary: event.summary } : call))
          : [...turn.calls, { id: event.id, name: event.id, status, summary: event.summary }];
        return { ...turn, calls, streaming: true };
      }
      case "proposal": {
        const known = turn.proposals.some((proposal) => proposal.id === event.proposal.id);
        const proposals = known
          ? turn.proposals.map((proposal) => (proposal.id === event.proposal.id ? event.proposal : proposal))
          : [...turn.proposals, event.proposal];
        return { ...turn, proposals };
      }
      case "notice":
        return turn.notices.includes(event.text) ? turn : { ...turn, notices: [...turn.notices, event.text] };
      case "error":
        return {
          ...turn,
          streaming: false,
          notices: turn.notices.includes(event.message) ? turn.notices : [...turn.notices, event.message],
        };
      case "done": {
        const notices = event.stop_reason === "aborted" && !turn.notices.includes(STOPPED) ? [...turn.notices, STOPPED] : turn.notices;
        return { ...turn, streaming: false, canContinue: event.continue === true, notices };
      }
      default:
        return turn;
    }
  });
}

function placeSynced(state: Conversation, incoming: readonly ProposalView[]): Conversation {
  const pending = new Map(incoming.map((proposal) => [proposal.id, proposal]));
  const turns = state.turns.map((turn) => {
    if (turn.proposals.length === 0) return turn;
    return {
      ...turn,
      proposals: turn.proposals.map((proposal) => {
        const next = pending.get(proposal.id);
        if (!next) return proposal;
        pending.delete(proposal.id);
        // A refresh that left before Apply must not put an in-flight row back to pending.
        if (proposal.status === "applying" && next.status === "pending") return proposal;
        return next;
      }),
    };
  });
  if (pending.size === 0) return { ...state, turns };
  const index = lastAssistantIndex(turns);
  const extras = [...pending.values()];
  if (index === -1) {
    return { ...state, turns: trim([...turns, { ...blankAssistant(`assistant-${turns.length}`), streaming: false, proposals: extras }]) };
  }
  const next = turns.slice();
  const host = next[index];
  if (!host) return { ...state, turns };
  next[index] = { ...host, proposals: [...host.proposals, ...extras] };
  return { ...state, turns: next };
}

/** One transcript step. The caller supplies ids (`crypto.randomUUID` in a handler). */
export function reduceTranscript(state: Conversation, action: TranscriptAction): Conversation {
  switch (action.type) {
    case "replace":
      return { id: action.conversation.id, turns: trim(action.conversation.turns).map(resting) };
    case "new":
      return emptyConversation(action.id);
    case "ask": {
      const settled = state.turns.map((turn) => (turn.streaming || turn.canContinue ? { ...turn, streaming: false, canContinue: false } : turn));
      const user: AssistantTurn = {
        id: action.userId,
        role: "user",
        content: action.text.slice(0, MAX_TURN_CHARS),
        calls: [],
        notices: [],
        proposals: [],
        streaming: false,
        canContinue: false,
      };
      return { id: action.conversationId || state.id, turns: trim([...settled, user, blankAssistant(action.assistantId)]) };
    }
    case "event":
      return applyEvent(state, action.event);
    case "stop":
      return withLastAssistant(state, (turn) => ({
        ...turn,
        streaming: false,
        canContinue: false,
        notices: turn.notices.includes(STOPPED) ? turn.notices : [...turn.notices, STOPPED],
      }));
    case "sync-proposals":
      return placeSynced(state, action.proposals);
    case "applying": {
      const ids = new Set(action.ids);
      return mapProposals(state, (proposal) => (ids.has(proposal.id) && proposal.status === "pending" ? { ...proposal, status: "applying" } : proposal));
    }
    case "outcomes": {
      const byId = new Map(action.outcomes.map((outcome) => [outcome.id, outcome]));
      return mapProposals(state, (proposal) => {
        const outcome = byId.get(proposal.id);
        if (!outcome) return proposal;
        if (outcome.status === "applied") return { ...proposal, status: "applied", error: null };
        if (outcome.status === "failed") {
          return { ...proposal, status: "failed", error: outcome.error ?? { code: "INTERNAL", message: "Could not apply" } };
        }
        return { ...proposal, status: "pending", error: null };
      });
    }
    case "revert-applying": {
      const ids = new Set(action.ids);
      return mapProposals(state, (proposal) => (ids.has(proposal.id) && proposal.status === "applying" ? { ...proposal, status: "pending" } : proposal));
    }
    case "discarded": {
      const byId = new Map(action.proposals.map((proposal) => [proposal.id, proposal]));
      return mapProposals(state, (proposal) => byId.get(proposal.id) ?? proposal);
    }
    default:
      return state;
  }
}

/** Text history for `POST /api/ai/assist`, oldest first, empty turns left out. */
export function toAssistMessages(conversation: Conversation): AssistMessage[] {
  const messages: AssistMessage[] = [];
  for (const turn of conversation.turns) {
    const content = turn.content.trim().slice(0, MAX_TURN_CHARS);
    if (content === "") continue;
    messages.push({ role: turn.role, content });
  }
  return messages.length <= MAX_TURNS ? messages : messages.slice(messages.length - MAX_TURNS);
}

/** Proposals of `ids`, in transcript order. */
export function proposalsByIds(conversation: Conversation, ids: readonly string[]): ProposalView[] {
  const wanted = new Set(ids);
  const found: ProposalView[] = [];
  for (const turn of conversation.turns) {
    for (const proposal of turn.proposals) {
      if (wanted.has(proposal.id)) found.push(proposal);
    }
  }
  return found;
}

function resting(turn: AssistantTurn): AssistantTurn {
  return turn.streaming || turn.canContinue ? { ...turn, streaming: false, canContinue: false } : turn;
}

function isCall(value: unknown): value is ToolCallView {
  if (typeof value !== "object" || value === null) return false;
  const call = value as { id?: unknown; name?: unknown; status?: unknown; summary?: unknown };
  return (
    typeof call.id === "string" &&
    typeof call.name === "string" &&
    (call.status === "running" || call.status === "complete" || call.status === "error") &&
    typeof call.summary === "string"
  );
}

function parseTurn(value: unknown): AssistantTurn | null {
  if (typeof value !== "object" || value === null) return null;
  const turn = value as Partial<AssistantTurn>;
  if (typeof turn.id !== "string" || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return null;
  const proposals: ProposalView[] = [];
  if (Array.isArray(turn.proposals)) {
    for (const proposal of turn.proposals) {
      const parsed = ProposalViewSchema.safeParse(proposal);
      if (parsed.success) proposals.push(parsed.data);
    }
  }
  return resting({
    id: turn.id,
    role: turn.role,
    content: turn.content.slice(0, MAX_TURN_CHARS),
    calls: Array.isArray(turn.calls) ? turn.calls.filter(isCall) : [],
    notices: Array.isArray(turn.notices) ? turn.notices.filter((notice): notice is string => typeof notice === "string") : [],
    proposals,
    streaming: false,
    canContinue: false,
  });
}

/** Stored transcript, or null when it is missing or malformed. */
export function parseTranscript(raw: unknown): Conversation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { id?: unknown; turns?: unknown };
  if (typeof record.id !== "string" || !Array.isArray(record.turns)) return null;
  const turns: AssistantTurn[] = [];
  for (const turn of record.turns) {
    const parsed = parseTurn(turn);
    if (parsed) turns.push(parsed);
  }
  return { id: record.id, turns: trim(turns) };
}

export function readTranscript(store: KeyValueStore): Conversation | null {
  try {
    const raw = store.getItem(TRANSCRIPT_STORAGE_KEY);
    if (raw === null || raw === "") return null;
    return parseTranscript(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeTranscript(store: KeyValueStore, conversation: Conversation): void {
  try {
    const stored = { id: conversation.id, turns: trim(conversation.turns).map(resting) };
    store.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full quota: the conversation stays in memory.
  }
}

function clampWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PANEL_WIDTH;
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(value)));
}

export function parsePanelPrefs(raw: unknown): PanelPrefs {
  if (typeof raw !== "object" || raw === null) return { open: false, width: DEFAULT_PANEL_WIDTH };
  const record = raw as { open?: unknown; width?: unknown };
  return { open: record.open === true, width: clampWidth(record.width) };
}

export function readPanelPrefs(store: KeyValueStore): PanelPrefs {
  try {
    const raw = store.getItem(PANEL_STORAGE_KEY);
    if (raw === null || raw === "") return { open: false, width: DEFAULT_PANEL_WIDTH };
    return parsePanelPrefs(JSON.parse(raw));
  } catch {
    return { open: false, width: DEFAULT_PANEL_WIDTH };
  }
}

export function writePanelPrefs(store: KeyValueStore, prefs: PanelPrefs): void {
  try {
    store.setItem(PANEL_STORAGE_KEY, JSON.stringify({ open: prefs.open, width: clampWidth(prefs.width) }));
  } catch {
    // Not persisted; the session still honours it.
  }
}
