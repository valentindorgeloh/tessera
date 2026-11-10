"use client";

/**
 * `GET /api/ai/status` once on mount (docs/drafts/p5-plan.md §5). The shell
 * layout stays free of the fetch: this provider is a client child of it.
 * A failed request is `offline`, so entry points stay hidden.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AiStatusSchema } from "@/lib/tessera/schemas";
import { assistantUnavailableCopy, type AiStatus } from "./ai-status";

export type { AiStatus };
export { assistantUnavailableCopy };

type AiStatusContextValue = {
  status: AiStatus | null;
  refresh: () => void;
};

/**
 * The status lives in a small store the provider owns; the context carries the
 * store, which never changes. A consumer reads the status through
 * `useSyncExternalStore` with a null server snapshot, so a status that lands
 * before a streamed boundary hydrates (the page area now streams behind the
 * frame's boundary, decision 155) hydrates against the server's null instead of
 * a changed context value (error 418, docs/contracts/ui.md "Shell").
 */
type StatusStore = {
  get: () => AiStatus | null;
  set: (next: AiStatus) => void;
  subscribe: (listener: () => void) => () => void;
};

function createStatusStore(): StatusStore {
  let current: AiStatus | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const AiStatusContext = createContext<StatusStore | null>(null);

const SERVER_STATUS = (): null => null;

async function loadStatus(): Promise<AiStatus> {
  try {
    const response = await fetch("/api/ai/status", { headers: { accept: "application/json" } });
    if (!response.ok) return { available: false, reason: "offline" };
    const parsed = AiStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { available: false, reason: "offline" };
  } catch {
    return { available: false, reason: "offline" };
  }
}

/** Status of the assistant. `status` is null until the first response. */
export function useAiStatus(): AiStatusContextValue {
  const store = useContext(AiStatusContext);
  if (!store) throw new Error("useAiStatus must be used inside AiStatusProvider");
  const status = useSyncExternalStore(store.subscribe, store.get, SERVER_STATUS);
  const refresh = useCallback(() => {
    void loadStatus().then(store.set);
  }, [store]);
  return useMemo<AiStatusContextValue>(() => ({ status, refresh }), [status, refresh]);
}

export function AiStatusProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStatusStore);
  useEffect(() => {
    void loadStatus().then(store.set);
  }, [store]);
  return <AiStatusContext.Provider value={store}>{children}</AiStatusContext.Provider>;
}
