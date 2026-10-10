/**
 * Assignees and subscribers (docs/contracts/service-api.md "assignees.ts").
 * `setAssignees` has replace semantics and auto-subscribes every added actor;
 * `subscribe` / `unsubscribe` default to the calling actor and are idempotent.
 * Like every other write they refuse archived items (schema.md: archived items
 * are read-only except unarchive and delete). The junction logic lives in
 * work-items.ts (this module imports it, never the other way round).
 */
import { z } from "zod";
import type { TesseraContext } from "./core/context";
import { validateInput } from "./core/errors";
import { withTx } from "./core/tx";
import { IdListSchema, IdSchema } from "./schemas";
import { insertSubscriber, loadWorkItem, loadWritableWorkItem, dropSubscriber, syncAssignees, type WorkItem } from "./work-items";

/** Largest assignee list accepted. */
const MAX_ASSIGNEES = 100;

export const SetAssigneesInput = IdListSchema.max(MAX_ASSIGNEES);

/** Replace semantics: the item ends up assigned to exactly `actor_ids` (live actors); added actors are subscribed. */
export function setAssignees(ctx: TesseraContext, id: string, actor_ids: string[]): WorkItem {
  const ids = validateInput(SetAssigneesInput, actor_ids);
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    syncAssignees(ctx, loaded, ids);
    return loadWorkItem(ctx, id);
  });
}

export const SubscribeInput = z
  .object({
    actor_id: IdSchema.optional().describe("Actor to subscribe or unsubscribe; the calling actor when omitted."),
  })
  .strict();

export type SubscribeInputType = z.input<typeof SubscribeInput>;

/** Subscribes `actor_id` (default: the caller) to the item's notifications; a repeat call is a no-op. */
export function subscribe(ctx: TesseraContext, id: string, actor_id?: string): WorkItem {
  const data = validateInput(SubscribeInput, { actor_id });
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    insertSubscriber(ctx, loaded, data.actor_id ?? ctx.actor.id);
    return loadWorkItem(ctx, id);
  });
}

/** Removes the subscription of `actor_id` (default: the caller); a repeat call is a no-op. */
export function unsubscribe(ctx: TesseraContext, id: string, actor_id?: string): WorkItem {
  const data = validateInput(SubscribeInput, { actor_id });
  return withTx(ctx, () => {
    const loaded = loadWritableWorkItem(ctx, id);
    dropSubscriber(ctx, loaded, data.actor_id ?? ctx.actor.id);
    return loadWorkItem(ctx, id);
  });
}
