"use client";

/**
 * The reorder wiring both views lists share (decisions 13 and 105): the
 * optimistic manual order, the pointer drag (`usePointerDrag`) and the menu's
 * Move up / Move down as the keyboard path. A move shows at once; when the
 * engine refuses, the transition ends, the optimistic order drops and a Toast
 * names the view and the reason.
 */
import { startTransition, useOptimistic } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import { reorderViewAction } from "@/app/actions/views";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import type { View } from "@/lib/tessera/types";
import { moveView, viewDropInput, viewStep, type ViewDropInput } from "./view-reorder";

/** Controls keep their press; the row's own link does not (a click without travel still opens it). */
const DRAG_IGNORE = 'button, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"]';

export function useViewReorder(views: View[]) {
  const toast = useToast();
  const [ordered, applyMove] = useOptimistic(views, (current: View[], move: { id: string; index: number }) => moveView(current, move.id, move.index));

  const run = (moved: View, index: number, input: ViewDropInput) =>
    startTransition(async () => {
      applyMove({ id: moved.id, index });
      const result = await reorderViewAction(input);
      if (!result.ok) toast({ type: "error", body: `Could not move ${moved.name}: ${result.message}` });
    });

  const onDrop = (event: DragDropEvent) => {
    const input = viewDropInput(event);
    const moved = ordered.find((view) => view.id === event.id);
    if (input === null || moved === undefined) return;
    run(moved, event.index, input);
  };

  /** The menu's Move up / Move down for `id` (the list is in manual order whenever the menu offers it). */
  const onMove = (id: string, direction: "up" | "down") => {
    const moved = ordered.find((view) => view.id === id);
    const step = viewStep(
      ordered.map((view) => view.id),
      id,
      direction,
    );
    if (moved === undefined || step === null) return;
    run(moved, step.index, step.input);
  };

  const pointer = usePointerDrag({
    onDrop,
    itemsOf: () => ordered.map((view) => view.id),
    ignoreSelector: DRAG_IGNORE,
  });
  return { ordered, onMove, ...pointer };
}
