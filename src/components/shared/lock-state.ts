/**
 * Pure rule behind the lock control's feedback: the "Unlocked" confirmation
 * shows only when the displayed state flips from locked to unlocked, and a
 * flip back to locked clears it. Kept out of the component so it is testable.
 */
export type LockFeedback = "idle" | "unlocked";

export function nextLockFeedback(previousLocked: boolean, locked: boolean, current: LockFeedback): LockFeedback {
  if (previousLocked === locked) return current;
  return locked ? "idle" : "unlocked";
}
