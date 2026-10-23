/**
 * Undo of an assistant Apply from the UI (decisions 116-117). The toast after
 * Apply and Power K ("Undo last assistant change") share this one path.
 * `undo_last_assistant_batch` always reverses the NEWEST batch, so the caller
 * names the proposal ids it expects to undo and a stale toast or palette row
 * that no longer matches the newest batch stops with a message instead of
 * undoing someone else's change.
 */
import { getUndoableAssistantBatchAction, undoLastAssistantBatchAction } from "@/app/actions/maintenance";
import type { AppliedBatch } from "@/lib/tessera/types";

/** The slice of Astryx's toast function the undo uses; a test passes a stub. */
export type UndoToast = (options: { body: string; type?: "info" | "error" }) => unknown;

export const UNDO_GONE_MESSAGE = "This change can no longer be undone";
export const UNDO_CONFLICT_MESSAGE = "Could not undo: a later change touched the same work items";
export const UNDO_FAILED_MESSAGE = "Could not undo";

export function undidMessage(count: number): string {
  return count === 1 ? "Undid 1 change" : `Undid ${count} changes`;
}

/** The newest undoable batch, or null when there is none or the lookup failed. */
export async function fetchUndoableBatch(): Promise<AppliedBatch | null> {
  try {
    const result = await getUndoableAssistantBatchAction({});
    return result.ok ? (result.data ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Undo the newest assistant batch when it holds every id in `expectedIds`,
 * then toast the outcome. Never throws.
 */
export async function undoAssistantBatch(expectedIds: readonly string[], toast: UndoToast): Promise<void> {
  try {
    const found = await getUndoableAssistantBatchAction({});
    if (!found.ok) {
      toast({ type: "error", body: found.message });
      return;
    }
    const batch = found.data;
    if (!batch || !expectedIds.every((id) => batch.proposal_ids.includes(id))) {
      toast({ type: "error", body: UNDO_GONE_MESSAGE });
      return;
    }
    const result = await undoLastAssistantBatchAction({ confirm: true });
    if (result.ok) {
      toast({ body: undidMessage(batch.proposal_ids.length) });
      return;
    }
    // The engine's CONFLICT message is the bare "undo_blocked"; say what it means.
    toast({ type: "error", body: result.code === "CONFLICT" ? UNDO_CONFLICT_MESSAGE : result.message });
  } catch {
    toast({ type: "error", body: UNDO_FAILED_MESSAGE });
  }
}
