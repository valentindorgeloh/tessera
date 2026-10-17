/**
 * Display names shared by the project settings screens (docs/drafts/p4-ui.md
 * "Shared pieces"). Pure and directive-free.
 */
import type { PaletteColor, StateGroup } from "@/lib/tessera/types";

export const PALETTE_COLOR_LABELS: Record<PaletteColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  gray: "Gray",
};

/** A state group's name in the States settings and the delete-and-move selector (triage is never shown there). */
export const SETTINGS_STATE_GROUP_LABELS: Record<Exclude<StateGroup, "triage">, string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** The groups the States tab lists, in order. */
export const SETTINGS_STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"] as const satisfies readonly Exclude<StateGroup, "triage">[];
