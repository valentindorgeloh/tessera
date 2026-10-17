/**
 * Transcript reducer and session storage (src/components/ai/assistant-store.ts).
 */
import { describe, expect, it } from "vitest";
import type { ProposalView } from "@/lib/tessera/types";
import {
  emptyConversation,
  MAX_TURNS,
  parsePanelPrefs,
  proposalPhase,
  proposalsByIds,
  readPanelPrefs,
  readTranscript,
  reduceTranscript,
  toAssistMessages,
  toolCallTitle,
  writePanelPrefs,
  writeTranscript,
  TRANSCRIPT_STORAGE_KEY,
  type Conversation,
  type KeyValueStore,
} from "@/components/ai/assistant-store";

const CONVO = "00000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000010";
const ITEM = "00000000-0000-4000-8000-000000000011";

function proposal(patch: Partial<ProposalView> = {}): ProposalView {
  return {
    id: PROPOSAL_ID,
    conversation_id: CONVO,
    source: "assistant",
    tool: "update_work_item",
    title: "Update work item · WEB-1 Fix login",
    input: { id: ITEM },
    preview: {
      title: "Update work item · WEB-1 Fix login",
      target: { type: "work_item", id: ITEM, label: "WEB-1 Fix login" },
      fields: [{ field: "priority", label: "Priority", before: "None", after: "High" }],
      note: "Sets priority",
    },
    destructive: false,
    status: "pending",
    error: null,
    created_at: "2026-10-17T12:00:00.000Z",
    decided_at: null,
    ...patch,
  };
}

function ask(state: Conversation, text: string, n: number): Conversation {
  return reduceTranscript(state, {
    type: "ask",
    userId: `user-${n}`,
    assistantId: `assistant-${n}`,
    text,
    conversationId: CONVO,
  });
}

function memory(): KeyValueStore & { throwOn(method: "getItem" | "setItem"): void } {
  const data = new Map<string, string>();
  let failing: "getItem" | "setItem" | null = null;
  return {
    throwOn(method) {
      failing = method;
    },
    getItem(key) {
      if (failing === "getItem") throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (failing === "setItem") throw new Error("blocked");
      data.set(key, value);
    },
  };
}

describe("reduceTranscript", () => {
  it("appends text, tool calls, a notice and a proposal onto the assistant turn", () => {
    let state = ask(emptyConversation(), "Set WEB-1 to high", 1);
    state = reduceTranscript(state, { type: "event", event: { type: "text_delta", text: "Done" } });
    state = reduceTranscript(state, { type: "event", event: { type: "text_delta", text: "." } });
    state = reduceTranscript(state, { type: "event", event: { type: "tool_use", id: "tool-1", name: "propose_update_work_item" } });
    state = reduceTranscript(state, { type: "event", event: { type: "tool_result", id: "tool-1", ok: false, summary: "Missing id" } });
    state = reduceTranscript(state, { type: "event", event: { type: "notice", text: "Answered by claude" } });
    state = reduceTranscript(state, { type: "event", event: { type: "proposal", proposal: proposal() } });
    state = reduceTranscript(state, { type: "event", event: { type: "done", stop_reason: "max_tokens", continue: true } });
    const assistant = state.turns[1];
    expect(assistant?.content).toBe("Done.");
    expect(assistant?.streaming).toBe(false);
    expect(assistant?.canContinue).toBe(true);
    expect(assistant?.calls).toEqual([{ id: "tool-1", name: "propose_update_work_item", status: "error", summary: "Missing id" }]);
    expect(assistant?.notices).toEqual(["Answered by claude"]);
    expect(assistant?.proposals).toHaveLength(1);
    expect(toAssistMessages(state)).toEqual([
      { role: "user", content: "Set WEB-1 to high" },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("marks a stopped turn and drops turns past the cap", () => {
    let state = ask(emptyConversation(), "Hello", 1);
    state = reduceTranscript(state, { type: "stop" });
    expect(state.turns[1]?.notices).toEqual(["Stopped"]);
    expect(state.turns[1]?.streaming).toBe(false);
    for (let n = 2; n <= MAX_TURNS; n += 1) state = ask(state, `Question ${n}`, n);
    expect(state.turns).toHaveLength(MAX_TURNS);
    expect(state.turns.some((turn) => turn.content === "Hello")).toBe(false);
    expect(state.turns[0]?.role).toBe("user");
    const messages = toAssistMessages(state);
    expect(messages.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(messages.some((message) => message.content === "Hello")).toBe(false);
  });

  it("updates proposal rows from apply outcomes, discard and a status sync", () => {
    let state = ask(emptyConversation(), "Delete WEB-4", 1);
    const row = proposal({ destructive: true });
    state = reduceTranscript(state, { type: "event", event: { type: "proposal", proposal: row } });
    state = reduceTranscript(state, { type: "applying", ids: [PROPOSAL_ID] });
    expect(proposalsByIds(state, [PROPOSAL_ID])[0]?.status).toBe("applying");
    state = reduceTranscript(state, {
      type: "outcomes",
      outcomes: [{ id: PROPOSAL_ID, status: "failed", error: { code: "RULE", message: "proposal_expired" } }],
    });
    const failed = proposalsByIds(state, [PROPOSAL_ID])[0];
    expect(failed ? proposalPhase(failed) : null).toBe("expired");
    state = reduceTranscript(state, { type: "revert-applying", ids: [PROPOSAL_ID] });
    expect(proposalsByIds(state, [PROPOSAL_ID])[0]?.status).toBe("failed");
    const discarded = proposal({ status: "discarded", decided_at: "2026-10-17T13:00:00.000Z" });
    state = reduceTranscript(state, { type: "sync-proposals", proposals: [discarded] });
    expect(proposalsByIds(state, [PROPOSAL_ID])[0]?.status).toBe("discarded");
    state = reduceTranscript(state, { type: "new", id: "00000000-0000-4000-8000-000000000099" });
    expect(state.turns).toEqual([]);
  });

  it("titles a tool call from its registry name", () => {
    expect(toolCallTitle("propose_update_work_item")).toBe("Update work item");
    expect(toolCallTitle("get_work_item_by_key")).toBe("Get work item by key");
  });
});

describe("session storage", () => {
  it("round-trips the transcript and the panel prefs, and ignores a bad or blocked store", () => {
    const store = memory();
    let state = ask(emptyConversation(), "Hello", 1);
    state = reduceTranscript(state, { type: "event", event: { type: "proposal", proposal: proposal() } });
    state = reduceTranscript(state, { type: "event", event: { type: "text_delta", text: "Hi" } });
    writeTranscript(store, state);
    const read = readTranscript(store);
    expect(read?.id).toBe(CONVO);
    expect(read?.turns[1]?.content).toBe("Hi");
    expect(read?.turns[1]?.streaming).toBe(false);
    expect(read?.turns[1]?.proposals[0]?.id).toBe(PROPOSAL_ID);

    store.setItem(TRANSCRIPT_STORAGE_KEY, "{");
    expect(readTranscript(store)).toBeNull();
    store.throwOn("getItem");
    expect(readTranscript(store)).toBeNull();
    store.throwOn("setItem");
    expect(() => writeTranscript(store, state)).not.toThrow();

    const prefs = memory();
    expect(parsePanelPrefs({ open: true, width: 900 })).toEqual({ open: true, width: 640 });
    expect(parsePanelPrefs(null)).toEqual({ open: false, width: 400 });
    writePanelPrefs(prefs, { open: true, width: 480 });
    expect(readPanelPrefs(prefs)).toEqual({ open: true, width: 480 });
    prefs.throwOn("getItem");
    expect(readPanelPrefs(prefs)).toEqual({ open: false, width: 400 });
  });
});
