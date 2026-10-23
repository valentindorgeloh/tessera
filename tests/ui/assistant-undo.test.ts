// @vitest-environment jsdom
/**
 * Undo of an assistant Apply from the UI (decisions 116-117): the Undo control
 * on the "Applied N changes" toast, the shared undo path (success, refused
 * second undo, CONFLICT wording, the stale-batch guard) and the Power K row.
 * The Server Action wrappers and the toast are mocked; jsdom has no layout.
 */
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchesCommand } from "@/components/shell/command-source";
import { writeTranscript, type Conversation } from "@/components/ai/assistant-store";
import type { AppliedBatch, ProposalView } from "@/lib/tessera/types";

const toast = vi.hoisted(() => vi.fn());
const dismiss = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({ apply: vi.fn(), discard: vi.fn(), getBatch: vi.fn(), undo: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: actions.apply, discardProposalsAction: actions.discard }));
vi.mock("@/app/actions/maintenance", () => ({
  getUndoableAssistantBatchAction: actions.getBatch,
  undoLastAssistantBatchAction: actions.undo,
}));
vi.mock("@/components/ai/AiStatusProvider", () => ({ useAiStatus: () => ({ status: { available: true, model: "fake" }, refresh: vi.fn() }) }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()), useToast: () => toast }));

const { buildUndoCommand, UNDO_ASSISTANT_ID } = await import("@/components/shell/command-source");
const { fetchUndoableBatch, undoAssistantBatch, UNDO_CONFLICT_MESSAGE, UNDO_GONE_MESSAGE } = await import("@/components/ai/assistant-undo");
const { AssistantProvider, useAssistantController } = await import("@/components/ai/AssistantProvider");

const P1 = "11111111-1111-7111-8111-111111111111";
const P2 = "22222222-2222-7222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function batch(ids: string[], titles: string[] = ["Update work item · AIX-1 Tune the thing"]): AppliedBatch {
  return { batch_id: "b1", applied_at: "2026-10-23T10:00:00.000Z", proposal_ids: ids, seq_from: 1, seq_to: 2, titles };
}

const ok = <T>(data: T) => ({ ok: true as const, data, cursor: 1 });
const fail = (code: string, message: string) => ({ ok: false as const, code, message });

function proposal(id: string): ProposalView {
  return {
    id,
    conversation_id: CONVERSATION,
    source: "assistant",
    tool: "update_work_item",
    title: "Update work item · AIX-1 Tune the thing",
    input: {},
    preview: { title: "Update work item · AIX-1 Tune the thing", target: null, fields: [] },
    destructive: false,
    status: "pending",
    error: null,
    created_at: "2026-10-23T09:00:00.000Z",
    decided_at: null,
  };
}

beforeEach(() => {
  toast.mockReset();
  dismiss.mockReset();
  toast.mockReturnValue(dismiss);
  for (const mock of Object.values(actions)) mock.mockReset();
});

describe("buildUndoCommand", () => {
  it("is empty without a batch", () => {
    expect(buildUndoCommand(null)).toEqual([]);
  });

  it("lists one Actions row whose hint is the batch titles", () => {
    const items = buildUndoCommand(batch([P1, P2], ["Update work item · AIX-1", "Update work item · AIX-2"]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: UNDO_ASSISTANT_ID,
      label: "Undo last assistant change",
      auxiliaryData: { group: "Actions", kind: "command", hint: "Update work item · AIX-1, Update work item · AIX-2" },
    });
  });

  it("matches undo, assistant and revert", () => {
    const [item] = buildUndoCommand(batch([P1]));
    for (const word of ["undo", "assistant", "revert"]) expect(matchesCommand(item, word)).toBe(true);
    expect(matchesCommand(item, "zzz")).toBe(false);
  });
});

describe("fetchUndoableBatch", () => {
  it("returns the batch, and null for no batch, a failure or a throw", async () => {
    actions.getBatch.mockResolvedValueOnce(ok(batch([P1])));
    expect(await fetchUndoableBatch()).toMatchObject({ proposal_ids: [P1] });
    actions.getBatch.mockResolvedValueOnce(ok(null));
    expect(await fetchUndoableBatch()).toBeNull();
    actions.getBatch.mockResolvedValueOnce(fail("INTERNAL", "boom"));
    expect(await fetchUndoableBatch()).toBeNull();
    actions.getBatch.mockRejectedValueOnce(new Error("network"));
    expect(await fetchUndoableBatch()).toBeNull();
  });
});

describe("undoAssistantBatch", () => {
  it("undoes the newest batch and toasts the count", async () => {
    actions.getBatch.mockResolvedValue(ok(batch([P1])));
    actions.undo.mockResolvedValue(ok({}));
    await undoAssistantBatch([P1], toast);
    expect(actions.undo).toHaveBeenCalledWith({ confirm: true });
    expect(toast).toHaveBeenCalledWith({ body: "Undid 1 change" });
  });

  it("says Undid N changes for a batch of several", async () => {
    actions.getBatch.mockResolvedValue(ok(batch([P1, P2])));
    actions.undo.mockResolvedValue(ok({}));
    await undoAssistantBatch([P1, P2], toast);
    expect(toast).toHaveBeenCalledWith({ body: "Undid 2 changes" });
  });

  it("shows the engine's message when a second undo is refused", async () => {
    actions.getBatch.mockResolvedValue(ok(batch([P1])));
    actions.undo.mockResolvedValue(fail("RULE", "There is no assistant batch to undo"));
    await undoAssistantBatch([P1], toast);
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "There is no assistant batch to undo" });
  });

  it("words a CONFLICT instead of showing the bare undo_blocked", async () => {
    actions.getBatch.mockResolvedValue(ok(batch([P1])));
    actions.undo.mockResolvedValue(fail("CONFLICT", "undo_blocked"));
    await undoAssistantBatch([P1], toast);
    expect(toast).toHaveBeenCalledWith({ type: "error", body: UNDO_CONFLICT_MESSAGE });
    expect(UNDO_CONFLICT_MESSAGE).toBe("Could not undo: a later change touched the same work items");
  });

  it("stops when there is no batch", async () => {
    actions.getBatch.mockResolvedValue(ok(null));
    await undoAssistantBatch([P1], toast);
    expect(actions.undo).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ type: "error", body: UNDO_GONE_MESSAGE });
  });

  it("stops when the newest batch is not the one the toast applied", async () => {
    actions.getBatch.mockResolvedValue(ok(batch([P2])));
    await undoAssistantBatch([P1], toast);
    expect(actions.undo).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ type: "error", body: "This change can no longer be undone" });
  });

  it("toasts the lookup's message and survives a throw", async () => {
    actions.getBatch.mockResolvedValueOnce(fail("INTERNAL", "db is locked"));
    await undoAssistantBatch([P1], toast);
    expect(toast).toHaveBeenLastCalledWith({ type: "error", body: "db is locked" });
    actions.getBatch.mockRejectedValueOnce(new Error("network"));
    await undoAssistantBatch([P1], toast);
    expect(toast).toHaveBeenLastCalledWith({ type: "error", body: "Could not undo" });
    expect(actions.undo).not.toHaveBeenCalled();
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

function Probe({ ids }: { ids: string[] }) {
  const controller = useAssistantController();
  const { requestApply, panelLoaded } = controller;
  useEffect(() => {
    if (panelLoaded) requestApply(ids);
  }, [panelLoaded, requestApply, ids]);
  return null;
}

describe("the Applied toast", () => {
  it("carries an Undo button that dismisses the toast and undoes the applied batch", async () => {
    const conversation: Conversation = {
      id: CONVERSATION,
      turns: [{ id: "t1", role: "assistant", content: "Proposed.", calls: [], notices: [], proposals: [proposal(P1)], streaming: false, canContinue: false }],
    };
    writeTranscript(window.sessionStorage, conversation);
    actions.apply.mockResolvedValue(ok([{ id: P1, status: "applied" }]));
    actions.getBatch.mockResolvedValue(ok(batch([P1])));
    actions.undo.mockResolvedValue(ok({}));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const ids = [P1];
    await act(async () => {
      root?.render(createElement(AssistantProvider as (props: { children: ReactNode }) => ReactNode, null, createElement(Probe, { ids })));
    });
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());

    const applied = toast.mock.calls[0][0] as { body: string; endContent: ReactNode };
    expect(applied.body).toBe("Applied 1 change");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const toastRoot = createRoot(host);
    await act(async () => {
      toastRoot.render(applied.endContent);
    });
    const button = host.querySelector("button");
    expect(button?.textContent).toContain("Undo");
    await act(async () => {
      button?.click();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith({ body: "Undid 1 change" }));
    expect(actions.undo).toHaveBeenCalledWith({ confirm: true });
    await act(async () => {
      toastRoot.unmount();
    });
    host.remove();
  });
});
