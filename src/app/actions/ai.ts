"use server";

/**
 * Apply and Discard of assistant proposals (docs/drafts/p5-plan.md §5).
 * They are Server Actions, not routes: they are fast and need `refresh()`,
 * unlike the model calls under `/api/ai/`, which would block board moves.
 * Apply runs the stored input of each proposal as actor `assistant`, never
 * anything the client sends beyond the ids. Both return an `ActionResult`
 * and never throw to the client; `refresh()` runs only when at least one
 * proposal was applied, outside the try so a misuse surfaces.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import {
  applyProposals,
  discardProposals,
  fromSqliteError,
  getDb,
  IdSchema,
  isTrackerError,
  latestSeq,
  readTessera,
  validateInput,
  writeTessera,
  type ApplyOutcome,
  type ProposalView,
} from "@/lib/tessera/server";
import type { ActionFailure, ActionResult } from "./_run";

const ApplyInput = z
  .object({
    ids: z.array(IdSchema).min(1).max(50),
    confirmed_ids: z.array(IdSchema).max(50).default([]),
  })
  .strict();

const DiscardInput = z.object({ ids: z.array(IdSchema).min(1).max(50) }).strict();

function failure(err: unknown): ActionFailure {
  const mapped = fromSqliteError(err);
  if (isTrackerError(mapped)) {
    return { ok: false, code: mapped.code, message: mapped.message, details: mapped.details };
  }
  console.error("[tessera] ai action failed", mapped);
  return { ok: false, code: "INTERNAL", message: mapped instanceof Error ? mapped.message : "Unexpected error" };
}

/**
 * Applies the proposals in `ids` order as the assistant; a destructive one
 * applies only when its id is in `confirmed_ids`. One bad proposal does not
 * stop the rest: each outcome says `applied`, `failed` (with the reason) or
 * `pending` (left alone, e.g. a destructive one that was not confirmed).
 */
export async function applyProposalsAction(input: { ids: string[]; confirmed_ids?: string[] }): Promise<ActionResult<ApplyOutcome[]>> {
  let outcomes: ApplyOutcome[];
  let cursor: number;
  try {
    const data = validateInput(ApplyInput, input);
    outcomes = applyProposals(getDb(), data);
    cursor = await readTessera((ctx) => latestSeq(ctx));
  } catch (err) {
    return failure(err);
  }
  if (outcomes.some((outcome) => outcome.status === "applied")) refresh();
  return { ok: true, data: outcomes, cursor };
}

/** Discards the pending proposals in `ids`; proposals in any other state come back unchanged. */
export async function discardProposalsAction(input: { ids: string[] }): Promise<ActionResult<ProposalView[]>> {
  try {
    const data = validateInput(DiscardInput, input);
    const proposals = await writeTessera((ctx) => discardProposals(ctx, data));
    const cursor = await readTessera((ctx) => latestSeq(ctx));
    return { ok: true, data: proposals, cursor };
  } catch (err) {
    return failure(err);
  }
}
