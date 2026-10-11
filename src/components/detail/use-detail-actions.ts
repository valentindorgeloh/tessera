"use client";

/**
 * Writes of the detail panel (docs/contracts/ui.md "PropertyRail"): every
 * change calls a Server Action wrapper inside a transition, shows a Toast on
 * `{ ok: false }` and otherwise relies on the `refresh()` inside `runTool` to
 * re-render the host with the new data. Shared by the rail, the title, the
 * header menu and the command context so the pattern lives once.
 *
 * Two guards on top of the QuickDetail pattern: the item is shown through
 * `useOptimistic`, so a picked value stays visible while the action and the
 * refresh run (and a second toggle in an open multi-selector builds on the
 * first one instead of on the stale prop); and every patch is compared with
 * the latest value written, not just with the prop, so a value the Selector
 * re-fires on close or the DateInput reports twice is dropped before a call.
 */
import { startTransition, useCallback, useLayoutEffect, useMemo, useOptimistic, useRef } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import { subscribeWorkItemAction, unsubscribeWorkItemAction } from "@/app/actions/detail";
import { setAssigneesAction, setLabelsAction, setModulesAction, updateWorkItemAction } from "@/app/actions/work-items";
import type { WorkItemDetail } from "@/lib/tessera/types";
import { applyPatch, changedFields, toggleId, type DetailPatch, type OptimisticPatch } from "./patch";

export type { DetailPatch } from "./patch";

/** What every action wrapper resolves to, without importing the server-side runner. */
export type ActionOutcome<T> = { ok: true; data: T; cursor: number } | { ok: false; code: string; message: string; details?: unknown };

export type ActionRunner = <T>(call: () => Promise<ActionOutcome<T>>, onOk?: (data: T) => void, prefix?: string) => void;

/** `run(call, onOk)`: runs a wrapper in a transition and toasts its failure; `fail(message)` toasts directly. */
export function useActionRunner(): { run: ActionRunner; fail: (message: string) => void } {
  const toast = useToast();
  const fail = useCallback((message: string) => void toast({ type: "error", body: message }), [toast]);
  const run = useCallback<ActionRunner>(
    (call, onOk, prefix = "Could not save") => {
      startTransition(async () => {
        const result = await call();
        if (result.ok) onOk?.(result.data);
        else fail(`${prefix}: ${result.message}`);
      });
    },
    [fail],
  );
  return useMemo(() => ({ run, fail }), [run, fail]);
}

export type DetailActions = {
  /** The item with the writes still in flight applied; render from this, not from the prop. */
  view: WorkItemDetail;
  run: ActionRunner;
  fail: (message: string) => void;
  update: (patch: DetailPatch) => void;
  setAssignees: (actorIds: string[]) => void;
  setLabels: (labelIds: string[]) => void;
  setModules: (moduleIds: string[]) => void;
  isSubscribed: boolean;
  /** Subscribes or unsubscribes the current actor; returns whether they are subscribed afterwards. */
  toggleSubscribe: () => boolean;
  assignMe: () => void;
};

type Writer = (patch: OptimisticPatch, call: () => Promise<ActionOutcome<unknown>>, prefix?: string) => void;

export function useDetailActions(item: WorkItemDetail, currentActorId: string): DetailActions {
  const { run, fail } = useActionRunner();
  const [view, addOptimistic] = useOptimistic(item, applyPatch<WorkItemDetail>);

  // The values the last write asked for; reset to the rendered view after every commit (success or rollback).
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  }, [view]);

  const itemId = item.id;
  const write = useCallback<Writer>(
    (patch, call, prefix = "Could not save") => {
      const changed = changedFields<OptimisticPatch>(latest.current, patch);
      if (changed === null) return;
      latest.current = applyPatch<WorkItemDetail>(latest.current, changed);
      startTransition(async () => {
        addOptimistic(changed);
        const result = await call();
        if (!result.ok) fail(`${prefix}: ${result.message}`);
      });
    },
    [addOptimistic, fail],
  );

  const handlers = useMemo(() => {
    const update = (patch: DetailPatch) => {
      const changed = changedFields<DetailPatch>(latest.current, patch);
      if (changed === null) return;
      write(changed, () => updateWorkItemAction({ work_item_id: itemId, ...changed }));
    };
    const setAssignees = (actorIds: string[]) => {
      write({ assignee_ids: actorIds }, () => setAssigneesAction({ work_item_id: itemId, actor_ids: actorIds }));
    };
    return {
      update,
      setAssignees,
      setLabels: (labelIds: string[]) => write({ label_ids: labelIds }, () => setLabelsAction({ work_item_id: itemId, label_ids: labelIds })),
      setModules: (moduleIds: string[]) => write({ module_ids: moduleIds }, () => setModulesAction({ work_item_id: itemId, module_ids: moduleIds })),
      toggleSubscribe: () => {
        const subscribed = latest.current.subscriber_ids.includes(currentActorId);
        const action = subscribed ? unsubscribeWorkItemAction : subscribeWorkItemAction;
        write(
          { subscriber_ids: toggleId(latest.current.subscriber_ids, currentActorId, !subscribed) },
          () => action({ work_item_id: itemId }),
          subscribed ? "Could not unsubscribe" : "Could not subscribe",
        );
        return !subscribed;
      },
      assignMe: () => setAssignees(toggleId(latest.current.assignee_ids, currentActorId, true)),
    };
  }, [currentActorId, itemId, write]);

  const isSubscribed = view.subscriber_ids.includes(currentActorId);
  return useMemo<DetailActions>(() => ({ ...handlers, view, run, fail, isSubscribed }), [fail, handlers, isSubscribed, run, view]);
}
