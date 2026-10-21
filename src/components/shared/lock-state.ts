/**
 * Pure rule behind the lock control's feedback: the "Unlocked" confirmation
 * shows only when the confirmed (server) state flips from locked to unlocked,
 * and a flip back to locked clears it. The caller passes the server value, not
 * the optimistic one, so a rolled-back unlock never reads as an unlock. Kept
 * out of the component so it is testable.
 */
export type LockFeedback = "idle" | "unlocked";

export function nextLockFeedback(previousLocked: boolean, locked: boolean, current: LockFeedback): LockFeedback {
  if (previousLocked === locked) return current;
  return locked ? "idle" : "unlocked";
}
