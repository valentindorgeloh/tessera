"use client";

/**
 * Assistant state for the shell (docs/drafts/p5-plan.md §6, decisions 35 and
 * 38). `useAssistant` is what Power K Ask calls. The transcript lives in
 * sessionStorage; the panel's open flag and width live in localStorage.
 * Apply of a destructive proposal waits for ConfirmApplyDialog.
 *
 * The panel slides in and out (docs/contracts/ui.md "Motion"). An open after the
 * stored state loaded slides in (`enters`; the stored open state that comes back
 * after a reload does not). `close` runs the CSS exit on the panel's element
 * (`setPanelElement`, the ref AssistantPanel gives its panel) and closes when it ends: the exit is the
 * provider's closing flag (`exit`), `isOpen` stays true until then so the shell
 * keeps the panel mounted, a second close does nothing, and a toggle, an open or
 * an ask during the exit takes it back at once. With no panel element, or under
 * Reduce Motion, it closes at once.
 */
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { useToast, type ToastDismissFn } from "@astryxdesign/core/Toast";
import { z } from "zod";
import { applyProposalsAction, discardProposalsAction } from "@/app/actions/ai";
import { ProposalViewSchema } from "@/lib/tessera/schemas";
import type { AiStatus, AssistantScope, ProposalView } from "@/lib/tessera/types";
import { ignoreCancelled, playExit } from "@/components/motion/play-exit";
import { scopeFromLocation } from "./assistant-scope";
import {
  emptyConversation,
  proposalsByIds,
  readPanelPrefs,
  readTranscript,
  reduceTranscript,
  toAssistMessages,
  writePanelPrefs,
  writeTranscript,
  DEFAULT_PANEL_WIDTH,
  type Conversation,
  type TranscriptAction,
} from "./assistant-store";
import { useAiStatus } from "./AiStatusProvider";
import { undoAssistantBatch } from "./assistant-undo";
import { streamAssist } from "./use-assistant-stream";

export type AssistantValue = {
  status: AiStatus | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  ask: (text: string) => void;
  conversation: Conversation;
  newConversation: () => void;
};

export type AssistantController = AssistantValue & {
  scope: AssistantScope;
  width: number;
  panelLoaded: boolean;
  /** True when the panel was opened after the stored state loaded: AssistantPanel slides in then (not for the stored open state of a reload). */
  enters: boolean;
  /** A ref callback for the panel's element, for the exit `close` plays on it (AssistantPanel hands it to its LayoutPanel). */
  setPanelElement: (element: HTMLDivElement | null) => void;
  setWidth: (width: number) => void;
  composerError: { type: "error"; message: string } | null;
  stop: () => void;
  requestApply: (ids: string[]) => void;
  requestDiscard: (ids: string[]) => void;
  busyIds: ReadonlySet<string>;
  confirmProposals: readonly ProposalView[];
  confirmOpen: boolean;
  confirmLoading: boolean;
  closeConfirm: (isOpen: boolean) => void;
  confirmApply: () => void;
};

const AssistantContext = createContext<AssistantController | null>(null);

function currentScope(): AssistantScope {
  if (typeof window === "undefined") return {};
  return scopeFromLocation(window.location.pathname, new URLSearchParams(window.location.search));
}

type PanelSnapshot = { open: boolean; width: number; loaded: boolean; enters: boolean };

const SERVER_TRANSCRIPT: Conversation = emptyConversation();
const SERVER_PANEL: PanelSnapshot = { open: false, width: DEFAULT_PANEL_WIDTH, loaded: false, enters: false };

let liveTranscript: Conversation = SERVER_TRANSCRIPT;
let livePanel: PanelSnapshot = SERVER_PANEL;
const storeListeners = new Set<() => void>();

function emitStore() {
  for (const listener of storeListeners) listener();
}

function subscribeStore(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/** Reads session and local storage once, after mount, without a render-time setState. */
function loadStoredAssistant() {
  if (livePanel.loaded || typeof window === "undefined") return;
  const stored = readTranscript(window.sessionStorage);
  const prefs = readPanelPrefs(window.localStorage);
  liveTranscript = stored ?? SERVER_TRANSCRIPT;
  livePanel = { open: prefs.open, width: prefs.width, loaded: true, enters: false };
  emitStore();
}

function commitTranscript(next: Conversation) {
  liveTranscript = next;
  if (livePanel.loaded) writeTranscript(window.sessionStorage, next);
  emitStore();
}

function commitPanel(open: boolean, width: number) {
  const loaded = livePanel.loaded;
  // An open that was not there before slides in; a panel that stays open keeps how it came; a closed one has nothing to enter.
  const enters = open && (livePanel.open ? livePanel.enters : true);
  livePanel = { open, width, loaded, enters };
  if (loaded) writePanelPrefs(window.localStorage, { open, width });
  emitStore();
}

function sameScope(left: AssistantScope, right: AssistantScope): boolean {
  return (
    left.project_id === right.project_id &&
    left.work_item_id === right.work_item_id &&
    left.page_id === right.page_id &&
    left.cycle_id === right.cycle_id &&
    left.module_id === right.module_id
  );
}

function ScopeReader({ onScope }: { onScope: (scope: AssistantScope) => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    onScope(scopeFromLocation(pathname, searchParams));
  }, [onScope, pathname, searchParams]);
  return null;
}

/**
 * The provider's value with `status` read through `useAiStatus`, a store read
 * with a null server snapshot, instead of from the value itself. The value
 * changes when the status lands, and a page that hydrates after that (the page
 * area streams behind the frame's boundary, decision 156: the intake's Triage
 * button, the views page's Describe dialog) would otherwise hydrate with the new
 * status against server HTML rendered without it (error 418, docs/contracts/ui.md
 * "Shell").
 */
function useControllerWithLiveStatus(value: AssistantController | null, hook: string): AssistantController {
  const { status } = useAiStatus();
  const live = useMemo(() => (value === null || status === value.status ? value : { ...value, status }), [status, value]);
  if (!live) throw new Error(`${hook} must be used inside AssistantProvider`);
  return live;
}

/** The assistant: open state, the conversation, and `ask` for Power K. */
export function useAssistant(): AssistantValue {
  return useControllerWithLiveStatus(useContext(AssistantContext), "useAssistant");
}

/** Panel controls. The shell's public hook is `useAssistant`. */
export function useAssistantController(): AssistantController {
  return useControllerWithLiveStatus(useContext(AssistantContext), "useAssistantController");
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { status, refresh } = useAiStatus();
  const toast = useToast();
  const conversation = useSyncExternalStore(subscribeStore, () => liveTranscript, () => SERVER_TRANSCRIPT);
  const panel = useSyncExternalStore(subscribeStore, () => livePanel, () => SERVER_PANEL);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setPanelElement = useCallback((element: HTMLDivElement | null) => {
    panelRef.current = element;
  }, []);
  /** The running close: set from the start of the exit until it ends or is taken back. */
  const exit = useRef<AbortController | null>(null);
  const [scope, setScope] = useState<AssistantScope>({});
  const [composerError, setComposerError] = useState<{ type: "error"; message: string } | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const update = useCallback((action: TranscriptAction): Conversation => {
    const next = reduceTranscript(liveTranscript, action);
    commitTranscript(next);
    return next;
  }, []);

  const rememberScope = useCallback((next: AssistantScope) => {
    setScope((current) => (sameScope(current, next) ? current : next));
  }, []);

  useEffect(() => {
    loadStoredAssistant();
  }, []);

  useEffect(() => {
    const id = conversation.id;
    if (id === "") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/ai/proposals?conversation_id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
        if (!response.ok) return;
        const parsed = z.array(ProposalViewSchema).safeParse(await response.json());
        if (!cancelled && parsed.success) update({ type: "sync-proposals", proposals: parsed.data });
      } catch {
        // The rows already on the transcript stay; statuses refresh on the next open.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation.id, panel.open, update]);

  const setWidth = useCallback((next: number) => {
    commitPanel(livePanel.open, next);
  }, []);

  /** Takes a running close back: the panel shows as it is and stays open. True when there was one. */
  const cancelExit = useCallback((): boolean => {
    const running = exit.current;
    if (running === null) return false;
    exit.current = null;
    running.abort();
    return true;
  }, []);

  const close = useCallback(() => {
    if (!livePanel.open || exit.current !== null) return;
    const element = panelRef.current;
    if (element === null) {
      commitPanel(false, livePanel.width);
      return;
    }
    const controller = new AbortController();
    exit.current = controller;
    const finished = () => {
      if (exit.current !== controller) return;
      exit.current = null;
      commitPanel(false, livePanel.width);
    };
    // A cancelled exit (taken back, or the panel unmounted) closes nothing.
    playExit(element, { signal: controller.signal }).then(finished, (error: unknown) => {
      if (exit.current === controller) exit.current = null;
      ignoreCancelled(error);
    });
  }, []);

  const open = useCallback(() => {
    if (status?.available !== true) {
      refresh();
      return;
    }
    cancelExit();
    commitPanel(true, livePanel.width);
  }, [cancelExit, refresh, status]);

  const toggle = useCallback(() => {
    // A toggle while the panel is leaving reopens it at once.
    if (cancelExit()) return;
    if (livePanel.open) close();
    else open();
  }, [cancelExit, close, open]);

  // The provider goes (the shell unmounts): a running exit is cancelled and closes nothing.
  useEffect(
    () => () => {
      exit.current?.abort();
    },
    [],
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    update({ type: "stop" });
  }, [update]);

  const newConversation = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setComposerError(null);
    setConfirmIds(null);
    update({ type: "new", id: crypto.randomUUID() });
  }, [update]);

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "" || status?.available !== true) return;
      cancelExit();
      commitPanel(true, livePanel.width);
      setComposerError(null);
      const conversationId = liveTranscript.id || crypto.randomUUID();
      const next = update({
        type: "ask",
        userId: crypto.randomUUID(),
        assistantId: crypto.randomUUID(),
        text: trimmed,
        conversationId,
      });
      const scopeNow = currentScope();
      rememberScope(scopeNow);
      const generation = ++generationRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void streamAssist({ conversation_id: conversationId, scope: scopeNow, messages: toAssistMessages(next), toolset: "all" }, controller.signal, (event) => {
        if (generationRef.current !== generation) return;
        if (event.type === "error") {
          setComposerError({ type: "error", message: event.message });
          if (event.kind === "auth" || event.kind === "rate_limit") toast({ type: "error", body: event.message });
        }
        update({ type: "event", event });
      });
    },
    [cancelExit, rememberScope, status, toast, update],
  );

  const releaseBusy = useCallback((ids: readonly string[]) => {
    setBusyIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const commitApply = useCallback(
    async (ids: string[], confirmed: string[]) => {
      const confirmedSet = new Set(confirmed);
      const marking = proposalsByIds(liveTranscript, ids)
        .filter((proposal) => proposal.status === "pending" && (!proposal.destructive || confirmedSet.has(proposal.id)))
        .map((proposal) => proposal.id);
      setBusyIds((current) => new Set([...current, ...ids]));
      setConfirmLoading(true);
      update({ type: "applying", ids: marking });
      try {
        const result = await applyProposalsAction({ ids, confirmed_ids: confirmed });
        if (!result.ok) {
          toast({ type: "error", body: result.message });
          update({ type: "revert-applying", ids: marking });
          return;
        }
        update({ type: "outcomes", outcomes: result.data });
        const applied = result.data.filter((outcome) => outcome.status === "applied");
        const failed = result.data.find((outcome) => outcome.status === "failed");
        if (failed?.error) toast({ type: "error", body: failed.error.message });
        else if (applied.length > 0) {
          // Undo (decisions 116-117) names the ids this toast applied, so a toast left over from an earlier Apply
          // never undoes a newer batch. Power K ("Undo last assistant change") is the path once the toast is gone.
          const appliedIds = applied.map((outcome) => outcome.id);
          let dismiss: ToastDismissFn | null = null;
          dismiss = toast({
            type: "info",
            body: applied.length === 1 ? "Applied 1 change" : `Applied ${applied.length} changes`,
            endContent: (
              <Button
                size="sm"
                variant="ghost"
                label="Undo"
                onClick={() => {
                  dismiss?.();
                  void undoAssistantBatch(appliedIds, toast);
                }}
              />
            ),
          });
        }
        setConfirmIds(null);
      } catch {
        toast({ type: "error", body: "Could not apply" });
        update({ type: "revert-applying", ids: marking });
      } finally {
        setConfirmLoading(false);
        releaseBusy(ids);
      }
    },
    [releaseBusy, toast, update],
  );

  const requestApply = useCallback(
    (ids: string[]) => {
      const pending = proposalsByIds(liveTranscript, ids).filter((proposal) => proposal.status === "pending");
      if (pending.length === 0) return;
      if (pending.some((proposal) => proposal.destructive)) {
        setConfirmIds(pending.map((proposal) => proposal.id));
        return;
      }
      void commitApply(
        pending.map((proposal) => proposal.id),
        [],
      );
    },
    [commitApply],
  );

  const requestDiscard = useCallback(
    (ids: string[]) => {
      const pending = proposalsByIds(liveTranscript, ids).filter((proposal) => proposal.status === "pending");
      if (pending.length === 0) return;
      const pendingIds = pending.map((proposal) => proposal.id);
      setBusyIds((current) => new Set([...current, ...pendingIds]));
      void (async () => {
        try {
          const result = await discardProposalsAction({ ids: pendingIds });
          if (!result.ok) {
            toast({ type: "error", body: result.message });
            return;
          }
          update({ type: "discarded", proposals: result.data });
        } catch {
          toast({ type: "error", body: "Could not discard" });
        } finally {
          releaseBusy(pendingIds);
        }
      })();
    },
    [releaseBusy, toast, update],
  );

  const confirmProposals = confirmIds === null ? [] : proposalsByIds(conversation, confirmIds).filter((proposal) => proposal.destructive);
  const closeConfirm = useCallback(
    (next: boolean) => {
      if (!next && !confirmLoading) setConfirmIds(null);
    },
    [confirmLoading],
  );
  const confirmApply = useCallback(() => {
    if (confirmIds === null) return;
    const destructive = proposalsByIds(liveTranscript, confirmIds)
      .filter((proposal) => proposal.destructive)
      .map((proposal) => proposal.id);
    void commitApply(confirmIds, destructive);
  }, [commitApply, confirmIds]);

  const value: AssistantController = {
    status,
    isOpen: panel.open,
    open,
    close,
    toggle,
    ask,
    conversation,
    newConversation,
    scope,
    width: panel.width,
    panelLoaded: panel.loaded,
    enters: panel.enters,
    setPanelElement,
    setWidth,
    composerError,
    stop,
    requestApply,
    requestDiscard,
    busyIds,
    confirmProposals,
    confirmOpen: confirmIds !== null,
    confirmLoading,
    closeConfirm,
    confirmApply,
  };

  return (
    <AssistantContext.Provider value={value}>
      <Suspense fallback={null}>
        <ScopeReader onScope={rememberScope} />
      </Suspense>
      {children}
    </AssistantContext.Provider>
  );
}
