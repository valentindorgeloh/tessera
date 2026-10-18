"use server";

/**
 * Home reads and the last-visit anchor (docs/drafts/p9-plan.md U1).
 * `get_home_summary` is the registry tool. Mark as seen is viewer
 * bookkeeping: it is not a tool, writes no activity and does not move the
 * change cursor beyond the seq already stored.
 */
import { refresh } from "next/cache";
import { parseHomeSeenSeq } from "@/components/home/home-format";
import { fromSqliteError, getDb, isTrackerError, latestSeq, readTessera, setHomeSeen } from "@/lib/tessera/server";
import { toolAction, type ActionFailure, type ActionResult } from "./_run";

export const getHomeSummaryAction = toolAction("get_home_summary");

function failure(err: unknown): ActionFailure {
  const mapped = fromSqliteError(err);
  if (isTrackerError(mapped)) {
    return { ok: false, code: mapped.code, message: mapped.message, details: mapped.details };
  }
  console.error("[tessera] home seen failed", mapped);
  return { ok: false, code: "INTERNAL", message: mapped instanceof Error ? mapped.message : "Unexpected error" };
}

/** Moves the home anchor forward to `seq` (never back) and refreshes Home. */
export async function markHomeSeenAction(seq: number): Promise<ActionResult<null>> {
  let cursor: number;
  try {
    const parsed = parseHomeSeenSeq({ seq });
    if (parsed === null) return { ok: false, code: "VALIDATION", message: "A sequence number is required" };
    setHomeSeen(getDb().db, parsed);
    cursor = await readTessera((ctx) => latestSeq(ctx));
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, data: null, cursor };
}
