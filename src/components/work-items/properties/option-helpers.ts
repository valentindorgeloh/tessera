/**
 * Plain helpers of the property controls: the state group's dot variant and label, the priority options and the
 * label colour. No directive and no Astryx component import (types only), like `date-format.ts`: the home widget, the
 * planning panels and the page meta take these through this module, so their first-load JS does not carry the
 * selectors, popovers and date pickers of the control files. The control files re-export them, so `./properties`
 * (the barrel) stays compatible.
 */
import type { IconType } from "@astryxdesign/core/Icon";
import type { StatusDotProps } from "@astryxdesign/core/StatusDot";
import type { PaletteColor, Priority, StateGroup } from "@/lib/tessera/types";
import { PriorityHighIcon, PriorityLowIcon, PriorityMediumIcon, PriorityNoneIcon, PriorityUrgentIcon } from "@/themes/catppuccin/icons";

const GROUP_VARIANT: Record<StateGroup, StatusDotProps["variant"]> = {
  backlog: "neutral",
  unstarted: "neutral",
  started: "accent",
  completed: "success",
  cancelled: "error",
  triage: "warning",
};

const GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "Backlog",
  unstarted: "Not started",
  started: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  triage: "Triage",
};

/** StatusDot variant for a state group (docs/contracts/ui.md: backlog/unstarted neutral, started accent, completed success, cancelled error). */
export function stateGroupVariant(group: StateGroup): StatusDotProps["variant"] {
  return GROUP_VARIANT[group];
}

export function stateGroupLabel(group: StateGroup): string {
  return GROUP_LABEL[group];
}

export type PriorityOption = { value: Priority; label: string; icon: IconType };

/** Urgent first, like the ordering rank in core/group.ts. */
export const PRIORITY_OPTIONS: readonly PriorityOption[] = [
  { value: "urgent", label: "Urgent", icon: PriorityUrgentIcon },
  { value: "high", label: "High", icon: PriorityHighIcon },
  { value: "medium", label: "Medium", icon: PriorityMediumIcon },
  { value: "low", label: "Low", icon: PriorityLowIcon },
  { value: "none", label: "No priority", icon: PriorityNoneIcon },
];

const BY_VALUE = new Map(PRIORITY_OPTIONS.map((option) => [option.value, option]));

export function isPriority(value: string): value is Priority {
  return BY_VALUE.has(value as Priority);
}

export function priorityOption(value: string): PriorityOption {
  return BY_VALUE.get(isPriority(value) ? value : "none") ?? PRIORITY_OPTIONS[PRIORITY_OPTIONS.length - 1];
}

/** Palette keys are exactly Token's colour names (docs/contracts/schema.md, decision 22); null falls back to gray. */
export function paletteTokenColor(color: PaletteColor | null | undefined): PaletteColor {
  return color ?? "gray";
}
