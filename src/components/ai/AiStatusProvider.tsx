"use client";

/**
 * `GET /api/ai/status` once on mount (docs/drafts/p5-plan.md §5). The shell
 * layout stays free of the fetch: this provider is a client child of it.
 * A failed request is `offline`, so entry points stay hidden.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AiStatusSchema } from "@/lib/tessera/schemas";
import { assistantUnavailableCopy, type AiStatus } from "./ai-status";

export type { AiStatus };
export { assistantUnavailableCopy };

type AiStatusContextValue = {
  status: AiStatus | null;
  refresh: () => void;
};

const AiStatusContext = createContext<AiStatusContextValue | null>(null);

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
  const value = useContext(AiStatusContext);
  if (!value) throw new Error("useAiStatus must be used inside AiStatusProvider");
  return value;
}

export function AiStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(() => {
    void loadStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<AiStatusContextValue>(() => ({ status, refresh }), [status, refresh]);
  return <AiStatusContext.Provider value={value}>{children}</AiStatusContext.Provider>;
}
