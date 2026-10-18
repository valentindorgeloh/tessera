"use client";

/**
 * Optimistic lock state for the page screen, the page row menu and the view
 * menu. The displayed value is the server value (the prop, fresh after the
 * action's refresh()) until a lock or unlock runs; inside the action's
 * transition it flips at once, and React drops the optimistic value when the
 * transition ends, so a failed action snaps back on its own.
 */
import { useOptimistic, useTransition } from "react";

type LockOutcome = { ok: true } | { ok: false; message: string };

export function useOptimisticLock(
  serverLocked: boolean,
  onError: (verb: "lock" | "unlock", message: string) => void,
): readonly [locked: boolean, setLocked: (next: boolean, run: () => Promise<LockOutcome>) => void] {
  const [locked, setOptimistic] = useOptimistic(serverLocked, (_current, next: boolean) => next);
  const [, startTransition] = useTransition();
  const setLocked = (next: boolean, run: () => Promise<LockOutcome>) =>
    startTransition(async () => {
      setOptimistic(next);
      const result = await run();
      if (!result.ok) onError(next ? "lock" : "unlock", result.message);
    });
  return [locked, setLocked] as const;
}
